# Itinerary sharing, adoption and collaboration: discovery

**Status:** discovery only. Nothing is implemented, migrated or deployed, and the MCP tools, Skills and the plugin submission are untouched. Every claim about current behaviour was checked against source at the commit below; file references are to `server.js` unless noted otherwise.

| Baseline | |
|---|---|
| Branch | `master` |
| HEAD | `9c270dc` (v2.68.0, the P0 activation increment), clean working tree |
| Deployed | Production's latest deploy is 4 Oct 2026 14:57 UTC. By date, that's v2.67.1. v2.68.0 is built but not deployed. |
| Migrations | Through `061-display-alias`. Relevant ones: `041-itineraries`, `049` (cascade-deletion provenance), `051-itinerary-stop-notes`, `052-adoptions`, `053-recommendations`, `054-deletion-deresolves`, `055-recommendation-origin`, `056-mark-identity`, `058-stop-place-snapshot`, `059`/`060` (signup source, activation) |
| MCP | 68 tools, frozen for review. 19 of them read or write itineraries. |

---

## 1. Executive summary

The itinerary layer is a **single-owner model**, held together by **three ownership chokepoints**: `itinOwned`, `stopOwned` and `groupOwned` (§2). That's good news, because collaboration can be introduced at a few doors rather than everywhere. The hard part isn't authorization; it's the **content model**.

- **A Stop's place lives in one member's personal Mark.** `itinerary_stops.mark_uid` must point at the acting member's own Mark (`stopAdd`, `stopResolveToMark` both enforce `mk.user_id === user.id`). In a shared plan, "this plan includes this place" and "Brian keeps this place" are therefore the same row today. Collaboration needs an **itinerary-scoped place reference** on the Stop, with **per-member Mark links** beside it. The pattern already exists twice in the codebase:
  - Ensemble components (`state unresolved|linked`, `label`, non-FK `note_uid`, `source_url`);
  - the Recommendation proposition columns (`maker`, `product`, `place_name`, `locality`, `address`, `lat`/`lng`, `url`).

  No shared canonical object model is needed.
- **Destination objects have the same problem.** `itinerary_stop_notes` binds a Stop to one member's Note. The same answer applies: an itinerary-scoped object reference, with optional per-member Note relationships.
- **Removal is destructive today.**
  - `stopDelete`, `groupDelete`, `stopNoteDetach` and `itineraryDelete` hard-delete rows.
  - A deleted stop's provenance doesn't even record which itinerary it belonged to.
  - The existing `visibility='suspended'` is a *publicity* control (hidden from the public page), **not** removal, and must stay distinct.

  Removed needs a state on the constituent plus prior-placement columns, with provenance as the history.
- **Adoption (Keep) can't express co-ownership, and shouldn't.** The adoption views require `adoptions.user_id = record.user_id`, and `adoptionSubject` refuses anyone but the record's member. That's correct: Adoption means corpus membership of one's own record. Collaboration is a **separate membership concept**, and a co-owned plan joins each member's working set through membership, not through Adoption.
- **Share-for-use is low risk and highest value.**
  - `build_itinerary` and `recommendationKeep` already create a whole plan with identity reuse (`matchPlace`/`findExistingMark`) in one transaction.
  - Provenance already carries lineage (`source_kind`, `source_ref`).
  - Open signup, signup context and the activation model already exist.

  The one blocker in the acquisition path is that `oauthNext` only allows `/oauth/authorize?…` as a post-signup return target; it has to accept the share return path, with an allow-list.
- **Itinerary ids are sequential integers (`/t/123`).** A share link must be a separate unguessable token, never "the id of a private plan".

**Recommended sequence:**

1. Share / view / adopt, first-party only.
2. The Removed state.
3. The collaboration content model: membership, scoped references, privacy projection, governance.
4. Collaboration UX and MCP, after the review.

Increment 1 changes no MCP tool. Increment 2 needs one decision about how the frozen `delete_itinerary_entity` behaves (§7).

```
                 ┌──────────────── Mode A: "Let others use it" ────────────────┐
 source plan ──► share link (token) ──► view · copy text ──► "Make this mine" ──► recipient's own plan
 (Brian's)                                                    (fork + lineage)    (independent, Jane's)

                 ┌──────────────── Mode B: "Plan together" ───────────────────┐
 shared plan ◄── invitation (single-use) ◄── accept ── Jane becomes co-owner of THE SAME plan
   ├─ structure, days, stops, place/object references ......... shared artifact
   ├─ Brian's Marks / Notes linked to stops .................... Brian's corpus (private stays private)
   └─ Jane's Marks / Notes linked to stops ..................... Jane's corpus
```

---

## 2. Current itinerary ownership model

### What "owner" means today

| Record | Owner key | Mutation check | Visibility | Delete |
|---|---|---|---|---|
| Itinerary | `itineraries.user_id` (also the author; there's no other principal) | `itinOwned(user, uid)`: `it.user_id !== user.id` → "No such itinerary." (no existence leak) | `canView('itinerary')` → `canSee`: public, or owner, or admin private view. Unkept (recommended) plans are owner-only. | `itineraryDelete`: hard-deletes stops, groups and the itinerary. Provenance `deleted` names the kept Marks and Notes it referenced. Marks and Notes survive. |
| Day (group) | via its itinerary | `groupOwned` | via the itinerary | `groupDelete`: hard delete; its stops become unplaced, positions cleared |
| Stop | via its itinerary | `stopOwned` | `canSeeStop`: owner sees all; others see `visible` stops; a linked **private** Mark **fails closed** (the stop renders nothing) | `stopDelete`: hard delete, reindex, provenance `deleted` with empty `fields` (no itinerary reference) |
| Stop → Mark | `stops.mark_uid` → `marks.uid`, **must be the acting member's Mark** | `stopAdd`, `stopResolveToMark` | per Mark (`private`) | Mark deletion de-resolves stops (054 trigger) and keeps the label and the locality/country snapshot (058) |
| Stop → Note | `itinerary_stop_notes(stop_id, note_id, user_id)` | `stopNoteAttach`: the Note must be the member's own, and a kept plan takes only kept Notes | `stopNotesVisible` → `canView('object')` per Note | `stopNoteDetach`: hard delete |
| Travel Mark | `marks.user_id` | its own checks | `private` flag; Adoption decides corpus membership | its own |
| Note | `objects.user_id` | | `private`; Adoption | |
| Recommendation | `recommendations.user_id` (`recOwned`) | | owner only | |
| Collection | `collections.user_id`, `UNIQUE(user_id, name, kind)` | | | |
| Ensemble (precedent) | `ensembles.user_id`; components are propositions (`state`, `label`, non-FK `note_uid`) | | | |

**Identity through web and MCP:**

- On the web, `me` comes from the `sid` session cookie (HttpOnly, `SameSite=Lax`) and acts through `webActor(me)`.
- Over MCP, `user` comes from an OAuth or legacy connection and acts through `aiActor(user, conn)`: `actor_type='ai_on_behalf'`, `actor_user_id=user.id`, `agent` = the client's declared name, plus `connection_uid`.
- Both reach the same domain functions, so the chokepoints govern both surfaces.

**Multiple principals:** none. There is no membership, sharing, invitation or delegation table anywhere. `admin_private_view` is see-only and web-only (AV1–AV4).

### Single-owner assumptions (dependency map)

These are the places that would need to understand multi-owner itineraries. Line numbers are approximate, at `9c270dc`.

| Area | Where | Assumption |
|---|---|---|
| **Authorization chokepoints** | `itinOwned` (4864), `stopOwned` (4905), `groupOwned` (4912) | `it.user_id === user.id` |
| Stop links | `stopAdd`, `stopResolveToMark` | the Mark must be the actor's own (keep this for the per-member link; see §5) |
| Stop notes | `stopNoteAttach` | the Note must be the actor's own (keep) |
| Place creation | `stopAdd` `new_place` → `markCreate(user…)`, privacy inherited from the plan | creates the **actor's** Mark |
| Privacy propagation | `markPrivacyGuard`, `markPrivacyChanged`, `itineraryPublishConflicts` | one member's private Mark flips the plan private, or blocks publishing. In a shared plan this would be a **cross-member side effect**. |
| Visibility | `canSeeStop` (6930) owner branch | the owner sees **any** linked Mark through `MARK_SQL`, private ones included. Under naive membership this is a **privacy leak**. |
| Rendering | `itineraryBody` (`isOwner`, `ctl`, `myNotes`, `stopRecs`), `pages.itinerary` (`owner`, author byline, edit form, `ITIN_JS`), `itineraryProposals`, `itinerarySuggestions`, `itineraryNearbyMarks`, `itineraryColophonEntries`, `itineraryPreview` (author) | owner = `it.user_id` |
| Recommendation orbit | `itineraryProposals`, `proposalsColumn`, `recommendationKeep`, `recordRecommendations` (`origin_itinerary_uid` must be the member's) | one member's recommendation history |
| Lists and feeds | `pages.itineraries`, profile counts (4475), home feed itineraries, `planToday`, `memberActivity`, activation (`activationSubstrate`, `computeReceipt`), admin activation | `adopted_itineraries WHERE user_id=?` |
| MCP reads | `my_itineraries` (list: `adopted_itineraries WHERE user_id`; one: `itinOwned`), `audit_itinerary`, `list_stop_notes`, `audit_recommendation_expansion` | single owner |
| MCP writes | `create_itinerary`, `build_itinerary` (+ duplicate guard on `user_id` + title), `add_itinerary_stops`, `arrange_itinerary`, `update_itinerary(_stop/_temporal)`, `resolve_itinerary_stop`, `delete_itinerary_entity`, `set_stop_note`, `keep_recommendation`, `keep_record`, `clear_prospective_leftovers` | the chokepoints |
| Web routes | `/t`, `/t/:id`, `/t/:id/marks` (owner-only mark lookup), `/t/new`, `/t/:id` POST, publish/unpublish, delete, groups, stops, stop notes, suspend/restore/delete | `it.user_id !== me.id` or the chokepoints |
| Integrity | `unadoptedExplanation`, `independentRelationship` (`stop`, `stop_note`), no-orphan boot check, `clear_prospective_leftovers` | per-member corpus |

---

## 3. Share for viewing and independent adoption

### Why public isn't enough

`itineraries.private=0` makes a plan visible at `/t/<id>`, appear in feeds and count on the profile. That is **discoverability**. A share link is **access by possession**:

- the plan stays private, out of feeds and unlisted;
- anyone holding the link can view, copy and adopt.

The two must stay separate. A sequential id must never act as a secret.

### Proposed model: `itinerary_shares` (name not locked)

| Field | Meaning |
|---|---|
| `uid` | stable share identity, used in lineage and analytics |
| `itinerary_uid` | source plan, a non-FK text reference so lineage survives deletion (the ensemble `note_uid` precedent) |
| `created_by` | the member who made the link |
| `token_hash` | SHA-256 of a 32-byte random token. Only the hash is stored, as for `connections.token_hash`. |
| `allow_adopt` | 1 by default; the owner can turn off "Make this mine" while keeping view access |
| `show_author` | whether recipients see the sharer's name |
| `state` | `active`, `revoked`, or `source_gone` (set when the plan is deleted) |
| `created_at`, `revoked_at`, `revoked_by` | |
| `expires_at` | null by default (decision 10) |

- **Link:** `/s/<token>`. Possession is sufficient, and no account is needed to view or copy.
- **Revocation:** takes effect immediately. A revoked or unknown token gets the same "This link isn't active" page (no oracle).
- **Several links per plan** are allowed, so a member can revoke the one they sent to a group without killing the one sent to a friend.

### What the recipient sees: the share projection

A dedicated read-only rendering, not the owner's page. It shows:

- title, overview (`context`), dates;
- days, in order;
- **active, visible stops**;
- for each linked stop, its **place identity**: name, locality, country, address, map pin;
- destination objects as labels with a link, if part of the artifact (§6).

It never shows:

- the Marks' `why`, tags or images unless the Mark is public;
- check-ins, ownership, warrants, comments;
- the recommendation orbit;
- provenance beyond "shared by …" when `show_author` is on;
- Removed items;
- suspended stops.

**Private Marks in a privately shared plan.** Today a private Mark's stop fails closed for non-owners. For a link the owner explicitly made, recommend a **pre-share review** that mirrors `itineraryPublishConflicts`: "This plan names 3 places you keep privately. Their names and addresses will be visible to anyone with this link; your notes about them won't be." The owner can confirm or suspend those stops. No default silently discloses.

### Adoption ("Make this mine")

Recipient capabilities:

- **View**
- **Copy as text** (§21)
- **Make this mine**

Adoption is a **fork**: a new itinerary owned and authored by the recipient, and Kept by them (`recordAdoption`, `source_kind 'shared_itinerary'`, `source_ref` = share uid).

| Source constituent | Recipient gets |
|---|---|
| Title, overview, dates, days (labels, temporal, order) | Copied as the recipient's own text; their plan can diverge freely |
| Experiential, allocation and particular stops | Copied as stops (label, kind, temporal, day, position) |
| Linked stop (source member's Mark) | **Structure, not evidence.** The place identity is resolved against the **recipient's own** corpus with `matchPlace`/`findExistingMark`. An exact match reuses their Mark; otherwise, per the existing Mark boundary ("added to a kept plan is marked"), a new recipient Mark is created from **identity fields only**: name, locality, country, address, lat/lng, url, external id. **No** `why`, tags, image (unless public), check-ins, ownership, warrants or comments. Privacy follows the recipient's plan (private). Provenance: `source_kind 'shared_itinerary'`. *Alternative (decision 8a):* leave them as `particular` stops carrying the place reference, and let the recipient keep places one by one. That isn't possible until the place reference exists (Increment 3), because stops today only snapshot locality and country. |
| Unresolved / de-resolved stops | Copied as unresolved, with the label and snapshot kept |
| Destination objects (source member's Notes) | **Never copied as Notes.** v1: carried as itinerary-scoped object references (label, url, maker, public image only) once that layer exists. Until then, either text in the stop or not copied (decision 11). |
| Recommendation-only content and the For Another Time orbit | Not copied (decision 5) |
| Removed and suspended items | Not copied (decision 6) |
| Collections, comments, check-ins, ownership, warrants, reactions | Never |

- **Duplicate adoption:** adopting the same share twice offers "You already made this yours", with a link to it and an option to make another copy.
- **Propagation:** source changes **never** propagate. The fork has no live dependency on the source; the lineage is a reference.
- **Mechanics:** almost entirely existing code.
  - `build_itinerary`'s transactional builder: itinerary, days, stops, `resolveTravelMark` with exact reuse, and a refusal on probable-match ambiguity, adapted from "refuse" to "create distinct, record the candidate".
  - `recordAdoption` for the Keep.
  - Provenance `source_kind`/`source_ref` for lineage.
- **New:** the share table, the projection page, the token, the adopt transaction wrapper, and the return-target allow-list.

> Copy **structure** (the plan's shape and the identities of its places) and never another member's **evidence** (their reasons, visits, ownership, endorsements, reactions or recommendation history).

---

## 4. Collaboration and co-ownership

### Three separate concepts

| Concept | Meaning | Storage |
|---|---|---|
| **Authorship** | Who created the plan | `itineraries.user_id`, kept as is, plus the creation provenance. Never rewritten. |
| **Membership / ownership** | Who jointly owns and edits it now | new `itinerary_members` (name not locked): `itinerary_uid`, `user_id`, `state` (`active`, `left`, `removed`), `invited_by`, `joined_at`, `ended_at`, `ended_by` |
| **Governance** | Who may invite, remove, change sharing, delete globally | rules over membership (§10), not a role ladder |

**Why genuine co-ownership rather than owner + editor.** The doctrine says the invitee "joins the same itinerary" as co-author. An editor role would make the invitee a guest in someone else's plan:

- the plan would vanish from their lists if the "owner" left;
- the creator's departure would orphan everyone.

With co-ownership, every active member has full content rights: add, edit, arrange, remove, restore, attach their own Marks and Notes. The plan appears in each member's itinerary list as theirs. The only asymmetries are a few **destructive governance acts** (§10), and they follow from protecting the other owners, not from rank.

**Migration-friendly:** a plan with no membership rows behaves exactly as today. The creator is the implicit sole owner. Rows are created **lazily** the first time an invitation is accepted, when both the creator's row and the invitee's are written, so existing plans need no backfill (§19).

**Authorization evolves at the three chokepoints.**

- `itinOwned(user, uid)` becomes `itinMember(user, uid)`: true if `it.user_id === user.id` and no membership row ended for them, or they hold an active membership row.
- `stopOwned` and `groupOwned` delegate to it.
- Destructive governance calls a separate `itinGovern(user, uid, act)`.

---

## 5. Stop → place identity

**The problem.** Today a linked Stop *is* a pointer to one member's Mark, and the Mark's privacy, existence and identity drive what everyone sees: fail closed, de-resolve on deletion, plan made private when the Mark turns private. In a shared plan, Jane would either see Brian's private Mark (a leak) or nothing at all.

**Proposal: an itinerary-scoped place reference plus per-member links.**

```
itinerary (shared artifact)
 └─ stop (uid, label, kind, day, position, state)
     ├─ place reference (itinerary-scoped): name, locality, country, address, lat, lng, url,
     │    external_id / identity_basis (branch identity), resolution: unresolved | partial | resolved
     └─ member links (per member, optional): (stop, Brian) → Brian's Mark
                                              (stop, Jane)  → Jane's Mark
```

- **Storage.** Extend the existing stop snapshot (058 already keeps `place_locality` and `place_country`) into a full place reference on the stop. Use the same field names as the Recommendation proposition (`place_name`, `locality`, `country`, `address`, `lat`, `lng`, `url`) and the Mark identity fields (`external_id`, `identity_basis`, `location_source`), so `matchPlace` works on it unchanged.
- **Per-member links:** `itinerary_stop_marks(stop_id, user_id, mark_uid)`, unique per (stop, user).
- **Compatibility.** `stops.mark_uid` stays as is and keeps meaning "the creator-era link". For single-owner plans it's identical to the creator's member link, so every current reader and MCP result is unchanged. New code reads the member link for the viewer and the place reference for everyone.
- **Collaborative stops:**
  - When Jane adds a place, her Mark is created (or reused) **for her only**. The Mark boundary applies to the actor's act, and nobody else's corpus changes.
  - The place reference is filled from identity fields only.
  - Brian sees the place reference, plus his own Mark if he has one, plus a **Keep this place** action that resolves against **his** corpus (decision 8).
- **Privacy:** the place reference holds only identity data the member chose to put into a shared plan; personal fields stay on the Mark. Privacy propagation (`markPrivacyGuard`) must stop flipping a *shared* plan private because of one member's Mark. In a shared plan, a private Mark only governs that member's link.
- **Unresolved stops:** unchanged (label plus kind). Resolving fills the place reference and creates or links the **resolver's** Mark.
- **Deleted Mark:** removes only that member's link. The place reference remains, which generalizes 054's "de-resolve, keep the label" without losing the address.
- **Not a canonical place table.** The reference is scoped to the stop, so there's no global shared object. Each member's Mark remains their own record.

---

## 6. Stop → Note (destination objects)

Same shape. `itinerary_stop_notes` binds a stop to one member's Note, and the Note carries personal state (`why`, ownership, warrant, comments).

- **Itinerary-scoped object reference** on the stop (a small child table, `itinerary_stop_objects`, because a stop can hold several):
  - `label`, `maker`, `product`, `variant`, `url`;
  - `image_uid` only if that image is public;
  - `resolution`.

  These are the Recommendation proposition fields, and it's the Ensemble component pattern (`state`, `label`, non-FK link, `source_url`).
- **Per-member Note links:** the existing `itinerary_stop_notes` rows, now meaning "**this member's** Note about this object at this stop". They're visible to other members only if the Note is public (`stopNotesVisible` already filters per viewer).
- **Never exposed to collaborators:** private Notes, ownership, warrants, comments, and the attaching member's recommendation history.
- **Reuse:** `stopNoteAttach`/`Detach` keep their rules (own Note only; a kept plan takes only kept Notes). Only the reference layer is new.

---

## 7. Removed state

**Today:** stops, days and stop-note attachments are hard-deleted. A deleted stop's provenance row has no itinerary reference. `suspended` hides a stop from the public page only and stays in the owner's sequence. **No soft-delete or tombstone data exists, so nothing can be recovered retroactively.**

**Proposal: state on the constituent, history in provenance.** This is consistent with how `visibility` and `resolution` work today: mutable current state, append-only provenance.

| Constituent | New columns (names not locked) |
|---|---|
| Stop | `state` (`active`, `removed`), `removed_at`, `removed_by` (user id), `removed_from_group_id`, `removed_from_position` |
| Day (group) | `state`, `removed_at`, `removed_by`, `removed_from_position` |
| Stop object reference / stop note attachment | `state`, `removed_at`, `removed_by` |

- **Removing** sets `state='removed'` and records the prior placement. It sets `group_id` and `position` to NULL so the partial unique position indexes (`ux_itin_stop_pos_*`) and every "unplaced stop" query are unaffected, then reindexes the scope (the existing `reindexScope`).
  - Provenance action `removed` on the stop, with `source_ref` = itinerary uid. This fixes the missing association.
  - The actor is attributed as today, including `ai_on_behalf`, `agent` and `connection_uid`.
  - A reason is recorded only if one was given.
- **Restoring** reactivates **the same row and uid**.
  - If the prior day still exists and is active, it returns to that day at its prior position, or the end if that's taken.
  - Otherwise it returns **unplaced** and the UI says so. A removed day is never silently recreated.
  - Provenance action `restored`.
- **Removing a day** removes the day and the stops on it, as one act. The stops are marked removed with the day, by sharing the same act timestamp and a `fields: 'with_day'`. Restoring the day restores those stops; a stop removed individually earlier stays removed.
- **Removed is distinct from:**
  - suspended (publicity);
  - a recommendation's `dismissed` / `not_this_trip` / `not_for_me` (reactions to proposals, in another table);
  - deleting a personal Mark or Note (de-resolves the member link; the stop stays);
  - leaving a collaboration (membership);
  - deleting the plan (governance, §10).
- **Purge:** none in v1 beyond deleting the whole plan.
- **Reads:** add an `active_itinerary_stops` view (and the same for groups). Every reader in §2 that means "the plan" reads active rows. Integrity readers (`independentRelationship`, leftovers) keep counting removed stops as holding their Mark, so a removed stop's Mark isn't offered for cleanup while it's restorable.
- **Historical deletions** stay deletions. Removed starts with the first removal after the migration, and no history is fabricated.

**The frozen MCP tool.** `delete_itinerary_entity(kind: stop)` hard-deletes. Two honest options:

- **(a)** Keep it destructive until the review ends. AI deletions bypass Removed in the meantime, and web removals are recoverable.
- **(b)** Route it to removal now. The tool's observable result is unchanged (the stop disappears from `my_itineraries` and audits), but "delete" would quietly mean "remove".

Recommend **(a)** during review, then **(b)** with an updated description in the next submission (decision 12).

---

## 8. Provenance

| Need | Representable today? |
|---|---|
| Member actor | Yes: `actor_type='user'`, `actor_user_id` |
| AI acting for a specific member | Yes: `ai_on_behalf` + `actor_user_id` + `agent` + `connection_uid` |
| Mutation of a shared artifact | Yes: rows key on the stop or itinerary uid, not the owner. **Gap:** stop and day rows don't record the itinerary uid, so set `source_ref` from now on. |
| Removal / restoration | New actions `removed` and `restored` (the action vocabulary is open TEXT) |
| Share created / revoked | New entity type `itinerary_share` (`created`, `revoked`) |
| Invitation / acceptance / leave / removal | New entity type `itinerary_membership` (`invited`, `accepted`, `declined`, `left`, `removed`) |
| Fork lineage | `itinerary` `created` with `source_kind='shared_itinerary'` and `source_ref`=share uid |

**Gaps in rendering:**

- The colophon says "Planned with ChatGPT" for the whole plan. In a shared plan it should attribute per member: "Brian, with ChatGPT · Jane, with Claude".
- The Removed list shows "Removed by Jane", or "by Jane's ChatGPT" for an AI act.

**Never conflate.** A collaborator's act is evidence about **that collaborator's** intent only:

- Jane's added places never enter Brian's corpus, receipts or reuse figures.
- The activation model already keys on `actor_user_id`. It needs to become membership-aware for *where* (which plans count as Jane's) without crediting one member with another's acts.

---

## 9. Privacy

> Collaboration shares the itinerary artifact, not access to collaborators' personal corpora.

**Visible to all members:**

- title, overview, dates, days;
- active and removed stops;
- itinerary-scoped place and object references;
- the plan's own mutation history (who added, removed or restored what, and through which AI client);
- the membership list.

**Never automatically visible:**

- another member's private Marks or Notes, even when linked to a shared stop (the member link is visible only to its member, or to all if the Mark is public);
- their check-ins, ownership, warrants, comments;
- their recommendation history (the For Another Time orbit stays per member, §13);
- unrelated provenance.

**Current code that would leak under naive "member = owner":**

| Code | Leak or side effect |
|---|---|
| `canSeeStop` owner branch | returns any linked Mark through `MARK_SQL`, private included |
| `itineraryColophonEntries` (owner = creator) | lineage counts over all members' Marks |
| `itineraryProposals` / `proposalsColumn` / `stopRecs` | if keyed on the plan, another member's recommendations would show; they must key on the **viewer** |
| `markPrivacyGuard` / `markPrivacyChanged` / `itineraryPublishConflicts` | one member's private Mark changes the shared plan's publicity |
| `itineraryDelete` | would destroy other members' plan |
| MCP `my_itineraries` (one plan) | returns `mark_uid` per stop. In a shared plan it must return the **caller's** link, or null plus the place reference, not another member's uid. That's a result-shape change, so it's post-review. |
| Home feed, profile, `planToday` | read `adopted_itineraries WHERE user_id`; they need membership to include shared plans, and must not list them on the **creator's** public profile as solely theirs |

---

## 10. Governance

| Act | v1 recommendation | Alternatives |
|---|---|---|
| Edit content (add, remove, restore, arrange, rename, dates) | Any active member | |
| Invite others | Any active member (decision 2) | Creator only |
| Remove a collaborator | The creator, acting as steward (decision 2) | Any member; nobody (members only leave) |
| Create or revoke a "use" link | Any member creates; any member can revoke any link | Creator only |
| Make the plan public (feed/profile) | **Not available for shared plans in v1** (decision 3): profile attribution and feed ownership are ambiguous, and a link covers the need | Unanimous consent |
| Leave | Any member except the last, who deletes instead | |
| Delete globally | **Never unilateral while others are members.** "Delete" for a member of a shared plan **means leave**. The plan is destroyed only when the last member leaves or deletes, using today's `itineraryDelete` (decision 4). | Creator-only delete; any owner with a recovery window; archive/tombstone |

The asymmetry (the creator removes members) is the minimum needed to stop an unwanted invitee from being impossible to eject. It doesn't make the creator the content owner.

---

## 11. Invitation, join and leave lifecycle

**Separate from shares.** A view/adopt link is multi-use and anonymous-friendly. An invitation grants co-ownership, so it is:

- **single-use**;
- consumed on acceptance;
- optionally email-addressed;
- revocable.

Different cardinality and risk call for a separate table, `itinerary_invitations` (`uid`, `itinerary_uid`, `invited_by`, `token_hash`, `email` (optional), `state` (`pending`, `accepted`, `declined`, `revoked`, `expired`), `created_at`, `responded_at`, `responded_by`, `expires_at`). It lives on its own path, `/j/<token>`, so a "use" link can never be read as an invitation. The mode is stored server-side, not encoded in the URL.

| Situation | Behaviour |
|---|---|
| Create | Any member (decision 2); one link per invitee. There's no email sending (the app has no email infrastructure); the member shares the link. Default expiry 14 days. |
| Logged out | `/j/<token>` shows the plan's title, who invited them and what joining means → **Join** → sign in or sign up → back to the invitation → explicit **Accept** |
| Accept | Creates the membership (and, lazily, the creator's), marks the invitation `accepted` (single-use), records provenance, and lands on the plan with "You're planning this together." |
| Decline | `declined`; the inviter sees it |
| Already a member | "You're already planning this" → the plan; the invitation isn't consumed |
| Duplicate invitations | Allowed; accepting one leaves the others pending, and they can be revoked |
| Revoked or expired | The same inert page as an unknown token |
| Email-addressed | Accept only if the signed-in account's email matches. This prevents hijacking by forwarding. |

---

## 12. Adoption and fork lineage

- **Recorded in provenance:** the fork's `created` row carries `source_kind='shared_itinerary'` and `source_ref` = share uid. The share row holds the source plan's uid and `created_by`.
- **No foreign keys** from the fork to the source, so the fork survives revocation, the source going private, or the source being deleted. The share becomes `source_gone`.
- **The recipient sees** "Made yours from a plan shared by @brian on 6 Oct" if `show_author` was on; otherwise "from a shared plan" (decision 7).
- **The source member sees** only an aggregate count ("Made theirs by 3 people"), with no names by default; see §17.
- Lineage is **not public** and doesn't appear on profiles.

---

## 13. Recommendations and For Another Time

- The recommendation orbit (`origin_itinerary_uid`, `context_itinerary_uid`, `context_stop_uid`) is **one member's** proposal history, and it's private.
- **View-only share:** not shown.
- **Adoption:** not copied (decision 5). Those are the source member's prospects, not the plan. The recipient can ask their own AI for For Another Time ideas for their fork.
- **Collaboration:** each member keeps **their own** orbit around the shared plan.
  - The recommendation columns key on `user_id`, and the rendering must filter on the viewer.
  - Keeping a recommendation applies to **the keeper only**: their Mark or Note, then attached as their member link.
  - It changes the shared artifact only when the kept thing is explicitly added to the plan, which is an act on the plan with its own provenance.
- **A recommended (unkept) plan can't be shared.** Keep it first; this matches `assertEditable`.
- Recommendation provenance remains non-preference evidence throughout.

---

## 14. Signup and acquisition journey

```
/s/<token>  (no account) ──► view · copy text
      │
      └─ "Make this mine" ──► logged in? ── yes ──► POST /s/<token>/adopt ──► /t/<new id> + receipt
                                  │
                                  no
                                  ▼
            /join?next=/s/<token>  (or /login?next=…)   [dl_src cookie: ref=share:<share uid>]
                                  ▼
            account created (signup_source='shared_itinerary', signup_context.ref=<share uid>)
                                  ▼
            back to /s/<token>, "You're in. Make this yours" (one click, POST) ──► fork ──► receipt
```

**What already exists:**

- open signup (`/join`);
- the first-touch source cookie (`dl_src`, carrying `ref` and `landing`);
- `signup_context`;
- `signup_source`;
- the activation model;
- the receipt.

**Changes needed:**

- `oauthNext` (`/^\/oauth\/authorize\?…$/` only) becomes an **allow-list** of internal return targets: `/oauth/authorize?…`, `/s/<token>`, `/j/<token>`, with no host and no scheme. Anything else becomes `''`, which keeps open redirects impossible.
- The adoption write happens on an explicit POST after return, never on a GET redirect.
- Collaboration uses the same flow through `/j/<token>`.

**Provenance and analytics record:**

- `signup_source='shared_itinerary'` (or `'invitation'`);
- the share or invitation uid;
- the fork's lineage.

Never the source member as taste evidence. The source member is stored only as `created_by` on the share, for the owner's own count.

All of this is first-party web code, so none of it is blocked by the review.

---

## 15. Activation and semantic yield

- **First value** for an adopter is the fork itself: a kept plan with stops, at adoption time.
  - Add first-value type `adopted_shared_plan`, and segment it, so it doesn't flatter organic time to first value.
  - Add `shared_itinerary` and `invitation` as arrival routes, and `adopt_shared` as an initial intent.
- **Yield of an adoption:**
  - one kept plan;
  - Marks: reused (existing identity) vs new (Mark boundary), counted separately;
  - unresolved stops as unresolved;
  - no Notes (unless decision 11 adds object references);
  - no recommendations;
  - lineage.

  Example: a source with 1 plan, 8 places, 2 objects and 3 For Another Time plans gives the recipient 1 plan + 8 places (k reused, 8−k new) + 2 object labels (if decided) + 0 recommendations.
- **Receipt:** today it's AI-only by design. Add one first-party variant, triggered by the fork transaction only: "**This itinerary is now yours.**", with the counts above, plus "Change anything; the original stays as it was." For collaboration: "**You're planning this together.**"
- **Welcome:** a member arriving from a share skips the full Welcome. They've already had value, so they get the compact card ("Use what you've kept") with the fork's receipt.
- **Reuse:** places adopted in the fork are kept at fork time, so a later plan that uses them is genuine prior-evidence reuse. The fork's own stops are same-session and never count.
- **Events** (`product_events`, operational only; viewing is never taste evidence):
  - `share_created`
  - `share_viewed` (anonymous id or user, deduplicated)
  - `share_text_copied`
  - `share_adopt_selected`
  - `share_adopted`
  - `invite_created`
  - `invite_viewed`
  - `invite_accepted`
  - `invite_declined`
  - `collaboration_left`

  Derived from records instead: the first modification after forking, a later check-in from an adopted plan (the existing `planned_mark_checked_in_later`), and a second share by an acquired member.

---

## 16. Security and abuse

| Risk | Safeguard |
|---|---|
| Guessing links | 256-bit random tokens; only hashes stored; share and invitation pages never accept itinerary ids |
| Enumerating private plans | `/t/<id>` already 404s for non-viewers; `/s` and `/j` take only tokens; unknown, revoked and expired tokens give one identical response |
| Invitation hijacking | Single-use; optional email binding; revocable; expiring |
| Unauthorized mutation / escalation | All writes go through `itinMember`, governance through `itinGovern`; share tokens never grant writes; shared-plan reads use the projection and never the owner path |
| Leaking private corpus | Place and object references hold identity data only; member links are per viewer; the pre-share review lists private places |
| Spam invitations | Rate limit per member (as `signupAllowed` does per network); invitations exist only as links the member hands out |
| Open redirects through signup | `next` is an allow-list of internal paths (§14) |
| CSRF on collaboration actions | Already covered globally: every POST whose `Origin` names another host is refused (403) before routing, and the session cookie is `SameSite=Lax`. New POST routes (join, accept, adopt, remove, restore, leave) inherit this; keep them POST-only. |
| Indexing | `/s` and `/j` pages send `noindex`; social previews show the title only, never the sharer's avatar unless `show_author` is on |

---

## 17. Existing UI impact and social pull

**Surfaces that change eventually:**

- the itinerary page: Share, Members, the Removed section, per-member attribution in the colophon, "Keep this place" on shared stops;
- the itinerary list ("with Jane");
- the new `/s` and `/j` pages;
- join and login (return-to);
- the Recommended orbit (per viewer);
- the activity log;
- the Removed bucket;
- the governance controls: leave, remove member, revoke links.

**Tendencies to resist:**

- Public counts of who adopted.
- Follower-feed posts like "Brian shared a plan".
- Likes on shared plans.
- Leaderboards of most-adopted plans.

Keep the loop **useful artifact → share → recipient utility → adoption or collaboration**. A count visible only to the owner is the most v1 should show.

---

## 18. Future MCP impact (discovery only, nothing changes now)

| Capability | Classification |
|---|---|
| Create share | First-party only at first; later a net-new tool |
| Read share | First-party only (it's a recipient page) |
| Adopt itinerary | First-party only at first. Backend reuses `build_itinerary` mechanics; a later tool is net-new. |
| Invite collaborator | Net-new tool (later) |
| Accept collaboration | First-party only (it needs a person's explicit click) |
| List collaborators | Existing `my_itineraries` would need a result-shape change, so a tool change is required |
| Leave / remove collaborator | Net-new tool (later); first-party first |
| Remove constituent | **Existing `delete_itinerary_entity`.** The backend can route to removal, but the description should change (§7) |
| Restore constituent | Backend reusable; tool change required (net-new or an `update_itinerary_stop` option) |
| Read Removed | Tool change required (`my_itineraries` one-plan result) |
| Collaborative mutation authorization | **Existing tools can handle it** once the chokepoints become membership-aware. Behaviour widens for collaborators only. |
| Per-member Mark link in results | Tool change required: `my_itineraries` must not return another member's `mark_uid` |
| Audits | `audit_itinerary` excludes removed stops (backend change, same shape); removed integrity is reported separately; `audit_recommendation_expansion` is per member |

**AI scoping.** An AI acting for Brian reaches the shared plan through Brian's membership, sees the place and object references and Brian's own links, and never reaches Jane's corpus. Its writes carry `actor_user_id = Brian`.

---

## 19. Migration plan (all additive)

1. **Share and invitation tables:** new and empty. No backfill.
2. **Removed:** new nullable columns plus `state DEFAULT 'active'`, and `active_*` views. All existing rows are active, and historical deletions stay deletions.
3. **Membership:** a new table, **lazily populated** when the first invitation is accepted. With no rows, `itinMember` reduces to today's `it.user_id === user.id`, so every existing plan behaves exactly as before.
4. **Place references:** new stop columns, backfilled from the linked Mark's **identity fields** (the 058 pattern), refreshed by trigger on link. `stops.mark_uid` is unchanged.
5. **Member links:** a new table. Single-owner plans need no rows (the creator's link is `stops.mark_uid`), and rows are written only for collaborators.
6. **Lineage:** provenance only; nothing to migrate.

Routes, MCP results and privacy for single-owner plans are unchanged. Recommendation-only plans stay owner-only and unshareable. Adoption is untouched.

## 20. Performance

| Lookup | Index |
|---|---|
| Members by plan | `(itinerary_uid, state)` |
| Plans by member | `(user_id, state)` |
| Share and invitation by token | unique `token_hash` |
| Shares by plan | `(itinerary_uid, state)` |
| Removed stops by plan | the existing `idx_itin_stop_itin` plus a `state` filter, or a partial index `WHERE state='removed'` |
| Member links | `(stop_id, user_id)` unique |
| Lineage | `provenance(source_kind, source_ref)`, if adoption counts are shown |

Collaboration at this scale needs no event sourcing, CRDTs or realtime transport: SQLite's single writer plus the existing transactions and uid-addressed operations are enough.

**Conflicts (v1):**

- Operations name constituents by uid, so most commute.
- Last write wins for labels and dates, with full provenance.
- Acting on a removed constituent (reorder, edit) fails with "Jane removed this stop. Restore it first."
- A stale page offers a refresh notice when the plan changed since load (compare the newest provenance id).
- No optimistic version checks unless real conflicts appear.

---

## 21. Product decisions for Brian

The recommended option is listed first.

| # | Decision | Recommendation | Alternatives |
|---|---|---|---|
| 1 | Are all collaborators equal co-owners? | **Yes** for content. Governance asymmetry only where needed (2, 4). | An owner + editors role ladder |
| 2 | Who can invite and remove collaborators? | **Any member invites; the creator removes.** | Creator does both; anyone does both |
| 3 | Who can make a shared plan public? | **Nobody in v1.** Collaborative plans use links only. | Unanimous consent; creator only |
| 4 | Who can delete a shared plan globally? | **Nobody unilaterally.** Delete means leave, and the last member out deletes. | Creator only; any owner with a 30-day recovery window; archive |
| 5 | Does adoption copy For Another Time recommendations? | **No.** They're the sharer's prospects. | Copy as the recipient's own unkept recommendations |
| 6 | Are Removed items copied when forking? | **No.** A fork starts clean; Removed is the source plan's history. | Copy as Removed |
| 7 | Is source attribution shown after adoption? | **Yes, if the sharer left "show my name" on (default on);** "from a shared plan" otherwise | Never; always |
| 8 | Can collaborators keep shared stops as their own Marks? | **Yes, explicitly** ("Keep this place", resolved against their own corpus). Never automatic. | Automatic for all members (breaks the corpus boundary) |
| 8a | On adoption, do linked stops become the recipient's Marks? | **Yes, under the existing Mark boundary**, reusing exact matches, identity fields only | Leave as place references (possible only after Increment 3) |
| 9 | Can a collaborator take a fork when leaving? | **Yes, as an explicit "Make my own copy"** (the same fork operation with lineage), offered at leave time | No |
| 10 | Do anonymous share links expire by default? | **No.** Revocable at any time, with a list of active links. | 30-day default |
| 11 | Destination objects in shares and forks before the object-reference layer | **Show as labels in the share view; copy as stop text in the fork** until Increment 3 | Omit until Increment 3; copy as the recipient's unkept recommendations |
| 12 | `delete_itinerary_entity` (stop) during review | **Stay destructive until the review ends,** then route to Removed with an updated description | Route to Removed now (observable result unchanged) |
| 13 | Private Marks in a privately shared link | **Pre-share review:** show names and addresses only after the owner confirms; never notes | Fail closed (stop hidden), as for public plans |

---

## 22. Recommended phased implementation

| Increment | Scope | Surface | MCP |
|---|---|---|---|
| **1. Share / view / adopt** | share table and tokens; `/s` projection; pre-share review; copy as text; fork transaction (identity reuse, Mark boundary, lineage); signup return allow-list; `shared_itinerary` source; adoption receipt; events and dashboard segments; revoke and list links | web | none |
| **2. Removed** | state and prior-placement columns; `active_*` views and reader updates; Removed section; restore rules; `removed`/`restored` provenance with `source_ref`; audits exclude removed; day removal as a unit | web + backend | tool behaviour is decision 12; description update after the review |
| **3. Collaboration content model** | membership (lazy); `itinMember`/`itinGovern`; place and object references plus member links; privacy projection fixes (§9 table); per-viewer recommendation orbit; membership-aware lists, feeds and activation | backend + web | `my_itineraries` result shape (post-review) |
| **4. Collaboration UX and AI** | invitations (`/j`); members panel; leave, remove, fork-on-leave; per-member colophon; change notice; MCP tools for invite, leave, restore, read Removed, share; Skill updates for collaborative plans | web + MCP | yes, as a new submission |

Increment 2 can run alongside 1. It must land before 3, because co-owners removing each other's work destructively is unacceptable.

---

## 23. Fable UX constraints

- **The member chooses one of two modes, explicitly:**
  - **"Let others use it"**: others can see it, copy it and make their own.
  - **"Plan together"**: invite someone into this same plan.

  They are separate actions, with no switch that turns one into the other.
- **Adoption** means "**This is now yours.** Changes you make don't touch the original, and theirs don't touch yours." Say plainly what came across (the plan, its places) and what didn't (their notes, visits, opinions).
- **Collaboration** means "**You're planning this together.**" Every member can change everything in the plan. Show who did what.
- **Co-ownership boundary:** the plan is shared; each person's places, notes and visits are their own. A place in a shared plan offers "**Keep this place**"; it's never kept on anyone's behalf.
- **Personal corpus boundary:** never show another member's private notes, check-ins, ownership, endorsements or suggestions inside a shared plan.
- **Removed:** every plan has a **Removed** section, out of the active sequence. Each item shows who removed it (and through which AI), when, and where it was, with **Restore**. Restoring returns it to its day if that still exists, or as unplaced, saying so.
- **Provenance is visible:** attribution reads "Brian, with ChatGPT" or "Jane". "Added by ChatGPT" never implies endorsement.
- **Logged-out recipient:** a useful plan first; **Copy as text** and **Make this mine** without friction; signup comes only at "Make this mine", and they land back on the plan.
- **Signup continuity:** after signup they land on their adopted plan with the receipt, never on the generic Welcome.
- **Invitations:** show who invited them and to what; joining needs an explicit Accept; already-member, expired and revoked states are calm and inert.
- **Governance controls to expose:**
  - Leave (with "Make my own copy");
  - Remove member (creator);
  - active links with Revoke;
  - delete, which in a shared plan reads as "Leave"; the last member sees the real delete warning.
- **No social mechanics:** no public adoption counts, no likes, no feed posts about sharing.

---

## 24. File, schema and service map

| Concern | Where |
|---|---|
| Schema: itineraries, groups, stops | migration `041-itineraries` (~781); position unique indexes `ux_itin_group_pos`, `ux_itin_stop_pos_grouped`, `ux_itin_stop_pos_ungrouped` (~887) |
| Stop notes | `051-itinerary-stop-notes` (~1056); `stopNoteAttach`, `stopNoteDetach`, `stopNotesVisible` (~4875) |
| Adoption | `052-adoptions` (~1099): `active_adoptions`, `adopted_*` views; `isAdopted`, `recordAdoption`, `adoptionSubject`, `canView`, `assertEditable`, `assertKeptChild` (~2260–2390) |
| Recommendations | `053`, `055` (`origin_itinerary_uid`); `recommendationCreate`, `recommendationKeep` (~6433), `recommendationDismiss` |
| Deletion cascades | `049`, `054-deletion-deresolves` (~1345), `058-stop-place-snapshot` (~1478) |
| Ownership chokepoints | `itinOwned`, `stopOwned`, `groupOwned` (~4864–4918) |
| Itinerary operations | `itineraryCreate`, `itineraryEdit`, `itineraryPublish`, `itineraryUnpublish`, `itineraryDelete` (~4964–5050); `groupCreate`, `groupEdit`, `groupSetPosition`, `groupDelete` (~5055–5115); `stopAdd` … `stopDelete` (~6684–6895); `reindexScope`, `stopScope` |
| Privacy | `canSee` (1603), `canView`, `canSeeStop` (~6930), `markPrivacyGuard`, `markPrivacyChanged`, `itineraryPublishConflicts` |
| Plan building (fork template) | `build_itinerary` handler (~5420–5480, around `matchPlace`/`resolveTravelMark` ~5261–5320), `findExistingMark` (~6224) |
| Rendering | `itineraryBody` (~8024), `itineraryProposals` (~7897), `itineraryColophonEntries` (~8652), `itineraryPreview` (~8745), `pages.itinerary` (~9121), `pages.itineraries` |
| Routes | `/t` … `/t/:id/stops/:uid/(suspend\|restore\|delete)` (~13489–13660) |
| Provenance | `recordProvenance` (~1781), `webActor`, `aiActor`, `clientAgentFor` |
| Signup / acquisition | `/join` (~13351), `oauthNext` and `signupSourceFor` (~5530), `sourceCookieFor`, `signup_context`, `signupAllowed` |
| Activation | `ACTIVATION MODEL (v2.68)` block, `docs/product/activation-model.md` |
| MCP itinerary tools | `create_itinerary`, `build_itinerary`, `add_itinerary_stops`, `arrange_itinerary`, `update_itinerary`, `update_itinerary_stop`, `update_itinerary_temporal`, `resolve_itinerary_stop`, `delete_itinerary_entity`, `set_stop_note`, `list_stop_notes`, `my_itineraries`, `audit_itinerary`, `audit_recommendation_expansion`, `record_recommendations`, `keep_recommendation`, `keep_record`, `list_recommendations`, `clear_prospective_leftovers` |

---

| Capability | Existing substrate reusable? | Schema change? | First-party UI change? | Future MCP change? | Key semantic risk |
|---|---:|---:|---:|---:|---|
| View share | Partly (rendering, `canSeeStop` rules) | Yes (shares) | Yes (`/s`) | No | Treating a sequential id or "public" as a share; disclosing private Marks without review |
| Copy as text | Yes (`my_itineraries` text builder logic) | No | Yes | No | Including personal fields (why, check-ins) |
| Adopt / fork | Yes (`build_itinerary`, `matchPlace`, `recordAdoption`) | No (beyond shares) | Yes | Later, optional | Copying evidence instead of structure; duplicating Marks |
| Lineage | Yes (provenance `source_kind`/`source_ref`) | No | Small | No | A live dependency on the source; exposing adopters socially |
| Removed bucket | No (deletes are hard; `suspended` is publicity) | Yes (state + prior placement) | Yes | Yes (read Removed) | Conflating with suspended or reactions; missing a reader that should filter |
| Restore | No | Yes (same columns) | Yes | Yes | Manufacturing new stops; recreating deleted days |
| Collaboration | Chokepoints make it tractable | Yes (members, invitations) | Yes | Yes | An invitation reachable from a use link |
| Co-ownership | No (Adoption must stay separate) | Yes (members; authorship stays) | Yes | Yes | Overloading Adoption; unilateral global delete |
| Collaborator privacy | Partly (per-viewer filters exist for Notes) | Yes (place/object references, member links) | Yes | Yes (per-member results) | `canSeeStop` owner branch and privacy propagation leaking across members |
| Collaborative AI actions | Yes (`aiActor`, `actor_user_id`, `connection_uid`) | No (beyond the above) | Colophon | Yes | An AI reaching another member's corpus through the plan |
