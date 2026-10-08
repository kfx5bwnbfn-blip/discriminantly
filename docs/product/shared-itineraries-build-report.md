# Shared itineraries (v2.70) and share links (v2.71): build report

Implements `itinerary-collaboration-addendum.md` with its six approved decisions (C1–C6) and the stop/Mark separation invariant.

**Status:** built and tested, not deployed.
- **Baseline:** production v2.69.1 (GitHub `268498d`).
- **MCP contract:** unchanged. `tools/list`, server instructions and `resources/list` are byte-identical to production.
- **Not changed:** Skills, the plugin package, and every tool name, input schema and output schema.

## 1. Summary

1. **Membership.**
   - The creator stays the owner (`itineraries.user_id`, with no membership row).
   - Invited people are `editor` or `viewer` in `itinerary_members`.
   - A plan with no active member behaves exactly as before.
2. **One access rule.** `itinAccess(user, itinerary, need)` with `need` = `read` / `write` / `govern` replaces the three ownership checks.
   - The existing helpers (`itinOwned`, `stopOwned`, `groupOwned`) now delegate to it.
   - No access returns the same "No such itinerary / stop / day" as a uid that doesn't exist.
3. **The stop owns its place.** Each stop now carries a full place identity: name, locality, country, address, lat/lng, url, external id and identity basis.
   - It is filled from the linked Mark (identity fields only, empty fields only) and backfilled for existing stops.
   - It survives any participant's Mark lifecycle.
4. **Per-person links.**
   - The owner's link stays `itinerary_stops.mark_uid`.
   - Anyone else's link to their own Mark lives in `itinerary_stop_marks`.
   - Deleting a Mark ends only that person's link.
5. **Caller-relative `mark_uid` (durable).**
   - Every stop handed to anyone goes through `stopFor(stop, itinerary, viewer)`: the MCP stop view, the web page and the audit.
   - `mark_uid` is therefore always the viewer's own Mark, or null. A stop with no link of the viewer's reads as `particular`.
6. **C1: adding to a shared plan keeps the place for nobody.**
   - `new_place` writes the stop's place identity and creates no Mark or Adoption for anyone, the adder included.
   - A `mark_uid` must be the caller's own kept Mark, and becomes only the caller's link.
7. **Personal keep.**
   - MCP: `resolve_travel_mark` then `resolve_itinerary_stop`, which links the caller's own Mark as their relationship only.
   - Web: **Keep this place** reuses an exact match from the keeper's catalogue, or makes a new kept Mark from identity fields.
   - Viewers may do this too: it is personal, not an edit of the plan.
8. **C3: Removed.**
   - On a shared plan, removing a stop or day moves it whole into `itinerary_removed`, with a snapshot of its notes, participants' links, and a day's stops and their order. No reader can see it there.
   - Restore brings back the same uid, in place where possible.
   - Restore is web-only. MCP removal replies say a removed item can be restored.
9. **C4, governance and publicity.**
   - Only the owner deletes, and only on the web, with a warning naming who else would lose the plan.
   - MCP refuses to delete a shared plan.
   - A shared plan, or one with an open invitation, can't be published.
   - Privacy propagation skips shared plans.
10. **C5 and C6, invitations (web only).**
    - Owner-only and single-use. The token is stored as a SHA-256 hash only.
    - Each invitation has a role, an optional email binding, 14-day expiry and response metadata.
    - Accepting needs a signed-in person's explicit click.
    - Before the first invitation, a disclosure lists places that come from the owner's private Marks (identity visible; notes never).
    - Sign-in and sign-up can return to `/j/<token>`, internal paths only.
11. **Provenance.**
    - The actor comes only from the session or connection: `actor_type`, `actor_user_id`, `agent`, `auth_method`, `connection_uid`.
    - Every stop and day event now records its itinerary as `source_ref`.
    - New events: `removed`, `restored`, `unlinked` (cascade), membership `joined` / `left` / `removed` / `role_changed`, invitation `created` / `accepted` / `declined` / `revoked`.
12. **Not taste evidence.**
    - Shared-plan activity creates no Mark or Adoption.
    - Activation counts only a member's own acts on their own plans.
    - Recommendations stay per person, and the For Another Time panel is per viewer.
    - On a shared plan the colophon credits each person (and the AI acting for them) and omits catalogue-lineage counts.
    - The map uses the plan's place identities, never anyone's Marks.

## 2. Files and migration

| File | Change |
|---|---|
| `server.js` | migration `062-shared-itineraries`; access, projection, Removed, membership/invitation domain; MCP behaviour behind unchanged contracts; web pages and routes (`/t/:id/members`, `/t/:id/removed`, `/t/:id/invite`, `/t/:id/leave`, `/t/:id/members/:id/(role\|remove)`, `/t/:id/invitations/:uid/revoke`, `/t/:id/removed/:uid/restore`, `/t/:id/stops/:uid/keep`, `/j/:token`, `/j/:token/(accept\|decline)`); `--place-backfill-report` dry run |
| `public/style.shared.css` | a few rules for the new pages |
| `test/collaboration.js` | new, 78 checks |
| `test/collab-migration.js` | new, 8 checks: upgrade from the previous release's database |
| `test/itinerary.js` | four source-pattern pins updated to the intended new behaviour (AV5, K3, LC5, L1); each still asserts its invariant |
| `Documents/*` | Constitution and MCP Policy 0.3-shared-itineraries; JSON/YAML semantic policy (kept identical to each other); manifest |

**Migration 062:**
- **Additive changes:**
  - seven `place_*` columns on `itinerary_stops`;
  - tables `itinerary_members`, `itinerary_invitations`, `itinerary_stop_marks` and `itinerary_removed`.
- **Triggers:**
  - a Mark delete ends member links;
  - linking fills empty place-identity fields.
- **Changed trigger:** 058's city/country snapshot triggers are recreated to apply to single-owner plans only. They still overwrite on link there, exactly as before.
- **Backfill:** identity fields only, empty fields only, idempotent. A report line is logged, and `node server.js --place-backfill-report` prints a dry run.
- **External ids:** stored as a single `provider:id` string, as on Marks, so provider and id always travel together. No extra field was needed.

## 3. Deviations from the discovery, and why

1. **Removed is a snapshot store, not `state` columns on stops and days.**
   - Dozens of queries read plan stops. A state column would have needed every one of them to filter; a separate store means none can show a removed row by mistake.
   - Restore still returns the same uid.
2. **Removed applies to shared plans only.** Single-owner plans keep their hard delete, as the brief requires ("single-owner deletion behavior remains compatible").
3. **Removing a day keeps its stops (unplaced).** This is today's day-deletion behaviour. Restoring the day takes back those of its stops that are still unplaced, in their old order.
4. **Viewers may keep places for themselves.** Linking one's own Mark is a personal act, not a content edit. Viewers still can't add, edit, arrange or remove anything.
5. **Leaving or removal ends the person's own links and note attachments on that plan.** Their Marks and Notes are untouched. This keeps their overlay from lingering in a plan they can no longer open.
6. **Single-owner re-link refreshes the new place fields.** Re-linking a single-owner stop to a different Mark clears and refills the new place-identity fields, so a stop never mixes two places' identities. On shared plans, filling is empty-fields-only.
7. **Stop-note detach is limited to one's own attachments.** For single-owner plans these are always the owner's, so nothing changes there.
8. **A `why` sent with `new_place` on a shared plan is not stored**, because no Mark is made. The reply says so.

## 4. MCP compatibility

- **Tool definitions:** `tools/list`, `initialize` (server instructions) and `resources/list` are byte-identical to production.
- **Contract test:** passes against the v2.61 snapshot for two members, plus the historical comparison.
- **Unchanged:** the freeze fingerprints; no tool name, input schema or output schema.
- **No new tool and no new caller-supplied parameter.** There is no actor, participant or collaboration flag anywhere.
- **Behaviour changes (all class B), on shared plans only:**
  - access checks;
  - caller-relative `mark_uid`;
  - `new_place` keeps the place for nobody;
  - removal is recoverable;
  - MCP delete and publish refusals;
  - the audit counts a full place identity as resolved;
  - a sharing note in `my_itineraries` text.

  Single-owner results are unchanged. The structured shapes are asserted equal across callers (PR4).

## 5. Tests

| Suite | Result |
|---|---|
| collaboration (new) | 78 / 78 |
| collab-migration (new, against production v2.69.1) | 8 / 8 |
| itinerary | 485 / 485 |
| activation | 56 / 56 |
| write-safety | 21 / 21 |
| oauth-signup | 40 / 40 |
| muse-client / muse-capture | 16 / 16, 50 / 50 |
| adoption · recommendations · tool-audit · lifecycle · increment4 · place-identity · skills-import | 73 · 43 · 29 · 77 · 41 · 45 · 28, all passing |
| mcp-contract (2 members + historical) | matches |
| page snapshots, production vs this code | 107 / 108 identical; the 1 difference is the intended "Plan together" link on the owner's own plan page |

## 6. Remaining risks and decisions

- **No email sending.** The owner copies the invitation link; it is shown once.
- **Concurrent edits are last-write-wins**, with full attribution. There is no stale-page notice yet.
- **Owner deletion of a shared plan is final for everyone.** The web warns, and nothing can be recovered.
- **Removed snapshots are kept until the plan is deleted.** There is no purge.
- **Invitation limits:** at most 20 open per plan, and no per-day rate limit.
- **Admin view:** the admin private view of a shared plan shows the owner's links, as admin view always has.
- **Agents can't restore Removed items.** Restore is web-only by design (C6 spirit), and the reply text says so.

## 7. Frozen-surface wording held for the post-approval release

None of these change behaviour; the server already behaves this way on shared plans.

1. **`add_itinerary_stops`:**
   - `new_place`: "in a plan shared with others, the place goes on the plan for everyone and is kept for nobody";
   - `mark_uid`: "your own travel mark; on a shared plan it becomes your link only".
2. **`resolve_itinerary_stop`:** "Point a stop at a travel mark" → "Link the stop to your own travel mark; on a shared plan this is your own relationship to its place only".
3. **`my_itineraries`:** "The member's itineraries" → "…including plans shared with them".
4. **`delete_itinerary_entity`:** "a shared plan can only be deleted by its owner on the website; removing a stop or day from a shared plan is recoverable".
5. **`update_itinerary`:** publishing: "a shared plan stays private".
6. **`audit_itinerary`:** `all_specific_stops_linked`: "on a shared plan, a stop with a full place identity counts as resolved".
7. **`arrange_itinerary`:** "Do not reorder a plan the member arranged themselves" → add "or that others are planning, unless asked".
8. **Server instructions:** one line: "A plan can be shared: its stops are nobody's taste; keep a place only when the member asks (resolve_travel_mark, then resolve_itinerary_stop); mark_uid is always the member's own."
9. **Skills:**
   - trip-planning §3 ("places you choose are kept marks") and §5A ("every stop linked to the right mark"): scope both to plans that are not shared;
   - destination-objects ("a kept plan takes only a kept note"): say whose note.
10. **Plugin submission file, line 37** ("Any travel mark it creates takes the itinerary's privacy"): add that a shared plan creates no Marks.

## v2.71 addendum: "Let others use it"

Built after v2.70, web only, with no MCP change (tool definitions still byte-identical to production).

- **What it is.** On a plan's Members page, the owner can make a link (`/s/<token>`) that anyone can open, signed in or not, to see the plan's days, stops and places (names and cities; addresses and anything personal never show). **Make this mine** gives them their own kept copy. Nobody joins the owner's plan through it.
- **The copy.** A new plan of the recipient's: title, overview, dates, days, stops, times and order. Each identified place is resolved against the *recipient's* catalogue: an exact match reuses their Mark; otherwise a new kept Mark is made from identity fields only. Nothing of the sharer's (reasons, visits, notes, suggestions) comes across, and the copy has no live tie to the source.
- **Credit.** The copy's colophon reads "From a plan shared by @handle" when the owner left "Show my name" on (the default); otherwise "a member". It appears nowhere else. The owner sees only a count of copies, on their own Members page.
- **Mechanics.** Migration `063-itinerary-shares` (token hash only, `show_author`, `adopted_count`, revocable, at most 10 active per plan). The same private-place disclosure as invitations. Sign-in and sign-up return to `/s/<token>`. Events `share_viewed` and `share_adopted` (operational only). Recommended (unkept) plans can't be shared.
- **Tests.** `test/collaboration.js` grew to 93 checks (SL1–SL14 cover the link, the view, the copy, reuse of existing places, revocation, and the anonymous variant).
