# Discriminantly v1 — Ontology audit and semantic map

Audited against v2.53.0 (`0437445`). Read-only: no code or data changed, and the MCP freeze is untouched. Every statement here was read from the code. Where something could not be verified, it says **not verified**.

This is a map of *meaning*, not of tables. Physical names are given once, so the map can be checked against the code, and are otherwise ignored.

| Concept | Physical table |
|---|---|
| Note | `objects` (plus a legacy shadow, `notes`; see debt D5) |
| Owned | `ownership_assertions` |
| Warrant | `warrants` |
| Collection | `collections`, with memberships in `note_collections` and `mark_collections` (`object_collections` is legacy) |
| Note relation | `note_relations` |
| Comment | `comments` (on notes), `mark_comments` (on marks) |
| Travel Mark | `marks` |
| Check-in | `visits`, with per-day commentary in `visit_days` |
| Itinerary, Day, Stop | `itineraries`, `itinerary_groups`, `itinerary_stops` |
| Ensemble, Component, Artifact | `ensembles`, `ensemble_components`, `ensemble_artifacts` |
| Provenance | `provenance` |
| Derived relation | `derived_relations` |
| AI connection | `connections` (plus the legacy connector token on `users`) |

---

## 1. Foundations that apply to everything

**Identity.** Every durable record has a UUID `uid`. It's filled in by a database trigger, so no write path can forget it, and it's unique. Integer ids are internal join keys only. The single exception is `resurfaced`, which is operational bookkeeping keyed by integer id (see D10). Records belong to exactly one member (`user_id`), and nothing is jointly owned.

**What "canonical" means here.** The code already uses the word precisely: *canonical* means evidence that something really happened or that the member asserted it. *Derived* means computed, and carries a confidence score and method. The code enforces the boundary in both directions. Derived relations are never consulted when deciding whether a record already exists or two things are the same, so an inference can't silently become a canonical link. This is the strongest property of the model.

**Evidence types** (the `assertion` field on provenance). The vocabulary is `explicit | observed | derived | inferred | unknown`, used as follows:
- **explicit:** the default. Every user action, and every AI action on the member's behalf.
- **derived:** only system enrichment, for example Photon filling in a mark's coordinates.
- **unknown:** only legacy rows whose evidence can't be established, for example old "verified" marks.
- **observed and inferred:** never written today.

**Actors.** Every provenance row records who acted:
- **`actor_type`:** one of `user` (the web app), `ai_on_behalf` (an AI through MCP) or `system` (enrichment and migrations).
- **The actor's details:** the `agent` (for example the client name), the `auth_method`, and the `connection_uid` for OAuth connections.

AI actions are therefore canonical evidence that something happened, but always attributed so they can't be mistaken for the member acting directly.

**Privacy.** A single rule, `canSee`, decides visibility for first-class records: a record is visible if it's public, if you own it, or if you're the admin *with the admin view switched on in the web app* (v2.53). AI connections never carry the admin view. Dependent records such as check-ins, comments and stops have no privacy of their own and inherit it from their parent.

**Deletion.** Deletion is a hard delete of the row. The record's history survives: a `deleted` provenance row is written for it, and provenance is never deleted. References held by uid (a stop's mark, a component's note, re-note and re-mark lineage) are deliberately *not* foreign keys, so they survive as history when the target goes. Photos are never deleted (known, and disclosed in the Privacy page).

**Transitions.** The model's core discipline is that new evidence creates new records rather than mutating old ones:
- A visit is a new check-in, not a change to the mark.
- A change of mind about ownership or a warrant appends a new state, and never rewrites the old one.
- A correction supersedes the mistaken record rather than deleting it.

---

## 2. Things

### Note
| Question | Answer |
|---|---|
| Existence asserts | The member deliberately kept a thing worth remembering, with their reason (`why`). |
| Does not assert | That they own it (that's Owned), that they vouch for it (Warrant), or that it's the same thing as another note. |
| Created by | The user (web) or AI on their behalf (`note_object`). A system path also creates notes: identifying an ensemble component can create one, but only on qualifying evidence (see Component). |
| User intent | Explicit. The AI instructions state that discussing or recommending something isn't saving it. |
| Stable identity | `uid`, owned by one member. Re-noting creates a new, independent note (see below). |
| Can be unresolved | No. A note always has a name and an image. |
| Evidence type | Explicit. |
| Provenance | `created`, `edited`, `deleted`, `renoted`. The actor and connection are recorded on every row. |
| Privacy | Public by default. The member can make it private. |
| Deletion | Removes the note, its comments, Owned history, collection memberships and warrants. A `deleted` provenance row is written for the note only (see D4). Re-note copies keep their lineage pointer. |
| Canonical references | Re-note lineage (`renoted_from_uid`), and `same_thing_as` relations (unused, D6). |
| Legal transitions | Edit text, tags, image or privacy, which overwrites without keeping a previous version. Delete. Re-noting by another member creates a new record. |
| AI may infer | Nothing canonical. It records what the member says. A detected likely duplicate returns "unchanged" rather than creating one. |
| Known debt | D5 (legacy shadow table). |

### Re-note (lineage between Notes)
| Question | Answer |
|---|---|
| Asserts | "This member found that note useful enough to adopt." It's an adoption of judgement, with no shared ownership. |
| Does not assert | Similar taste, or that the two notes remain the same. Each copy may diverge. |
| Created by | A member, or their AI, from a note they can see. Since v2.53 the admin view never applies through AI, so a private note can't be copied that way. |
| Identity | A pointer on the new note (`renoted_from_uid`) plus a provenance row. It's deliberately not unique: re-noting twice is valid. |
| Privacy | The copy is created **public**. The source must have been visible to the member. |
| Deletion | If the source is deleted, the pointer remains as history. |
| AI may infer | Any "similar taste" conclusion belongs in derived relations, citing this as evidence. The code comments say so, but nothing does it yet (D7). |

### Owned
| Question | Answer |
|---|---|
| Asserts | "I own the thing in this note", made at a point in time. |
| Does not assert | Endorsement (Warrant), or anything about the note's content. |
| Created by | The user or AI on their behalf, and only when the member says so. |
| Intent | Explicit. |
| Identity | Each assertion is its own row with a `uid`, scoped to one member and one note. |
| Evidence | Explicit. |
| Provenance | Double-recorded: the append-only assertion rows themselves (`owned`, `released`, corrections that supersede an earlier row) and provenance rows (`asserted`, `released`, `corrected`). |
| Privacy | Always private to the member and their connected AI. Never shown to anyone else. |
| Deletion | Cascades with the note, with no provenance row of its own (D4). |
| Legal transitions | owned → released → owned again (each an appended row). A mistaken "owned" is corrected by a superseding row, and the original is kept. Nothing is ever edited or deleted. |
| AI may infer | Nothing. Ownership is only ever the member's statement. |

### Warrant
| Question | Answer |
|---|---|
| Asserts | "I stand behind this note or mark", the member's seal of approval. |
| Does not assert | Ownership, a visit, or quality in general. |
| Created by | The user or AI on their behalf. |
| Identity | An append-only row with a `uid`, scoped to member, subject type and subject uid. |
| Evidence | Explicit. |
| Provenance | States `active` and `revoked`, as rows, plus provenance rows. |
| Privacy | Published (shown to others) only on a public record. On a private record it's never published. |
| Deletion | Revoking appends a row. When the note or mark itself is deleted, all its warrant rows are removed (the one warrant deletion in the code); provenance rows remain. |
| Legal transitions | active → revoked → active again. |
| AI may infer | Nothing. It's the member's statement only. |

### Collection
| Question | Answer |
|---|---|
| Asserts | "I group these things (or places) under this name." |
| Does not assert | Anything about the items themselves. Membership is the member's organisation, not a property of the record. |
| Created by | The user, or AI on their behalf (collections named when saving a note or mark). |
| Identity | `uid`. Names are unique per member. Memberships are pairs (collection, item), with no uid of their own. |
| Privacy | A collection has **no privacy of its own**. Its items keep theirs. Since v2.53.2, someone other than the owner sees a collection's name only if they can see at least one item in it. |
| Deletion | Deleting a collection removes the memberships, not the items. It writes `deleted` provenance for the collection. |
| Known debt | Legacy `object_collections` is read only by migrations; harmless (D5). |

### Note relation (`same_thing_as`)
| Question | Answer |
|---|---|
| Asserts | "These two notes are the same thing", based on the member's own statement or an outside identifier. It's canonical, never a guess. |
| State | **Read but never written.** The table exists and is consulted by `equivalentNotes()`, but nothing in the product can create one (D6). |

### Comment
| Question | Answer |
|---|---|
| Asserts | This member said this, on that note or mark. |
| Identity | `uid`. There are two physical tables (notes and marks), but the meaning is the same, and that asymmetry is harmless. |
| Privacy | Inherits from the subject: visible to whoever can see the note or mark. |
| Deletion | Removed by its author or the subject's owner. The admin can remove any comment only with the admin view on. Comments cascade with the subject, with no provenance of their own (D4). |

---

## 3. Places

### Travel Mark
| Question | Answer |
|---|---|
| Asserts | The member deliberately retained a place as worth remembering. |
| Does not assert | That they visited it (that's a Check-in), that they endorse it (Warrant), or that it's in a plan (Stop). The AI instructions state this explicitly. |
| Created by | The user, or AI on their behalf (`add_travel_mark`), after an optional place lookup (`verify_place`, Photon). |
| Intent | Explicit. Mentioning a place isn't marking it. |
| Identity | `uid`, per member. **There is no canonical identity for the real-world place itself** (D1). |
| Can be unresolved | No. A mark always names a place. Coordinates are optional. |
| Evidence | Explicit, from the member. Coordinates filled in by Photon are `derived` (system `enriched`). The "verified" flag only counts as verification when a provenance row says what was checked (migration 014); legacy rows say `unknown`. |
| Provenance | `created`, `edited`, `enriched`, `deleted`. |
| Privacy | **Public by default.** Its check-ins, comments and warrants follow it. |
| Deletion | Removes the mark, its check-ins, per-day notes, comments, collection memberships and warrants. `deleted` provenance is written for the mark only (D4). Stops that pointed at it keep their label, as designed. |
| Legal transitions | Edit (overwrites) and delete. A visit is **new evidence** (a Check-in), never a change to the mark. A detected likely duplicate returns "unchanged" (D2). |
| AI may infer | Nothing canonical about visits, taste or equivalence between places. |
| Known debt | D1, D2, D3. |

### Re-mark (lineage between Marks)
Same meaning as re-note: *"this member's judgement was useful enough to that member that they adopted the mark"* — the wording of the code's own comment. It's recorded twice on purpose: the pointer answers "where from", the provenance row answers "when and how". It isn't a claim of similar taste, which would belong in derived relations.

### Check-in
| Question | Answer |
|---|---|
| Asserts | The member says they were at this marked place, on this date or date range, and optionally what they did. |
| Does not assert | That the mark was a recommendation, or anything beyond what the member said. `date_known = 0` explicitly records "the date is unknown" rather than inventing one. |
| Created by | The user, or AI on their behalf (`log_visit`), only when the member says they went. |
| Intent | Explicit. The AI instructions say mentioning somewhere isn't checking in. |
| Identity | `uid`. It's always attached to exactly one mark. Per-day commentary rows (`visit_days`) have their own `uid`. |
| Can be unresolved | No. It must belong to a mark. There's no check-in for an unmarked place. |
| Evidence | Explicit. |
| Provenance | `created`, `edited`, `deleted`. Per-day notes: `edited`, `deleted`. |
| Privacy | **No privacy of its own. It inherits the mark's**, and marks are public by default (D3). |
| Deletion | Deleting it writes provenance, and its day notes go with it. Deleting the *mark* removes its check-ins with no provenance of their own (D4). |
| Legal transitions | Edit date, range or notes (overwrites). A second visit is a second check-in. |

---

## 4. Plans

### Itinerary
| Question | Answer |
|---|---|
| Asserts | An intention: the member plans this trip. |
| Does not assert | That anything happened. The AI instructions say itineraries are plans, not records of going. |
| Created by | The user, or AI on their behalf. Through AI a title is required (since v2.52.6); whether the web form enforces the same: **not verified**. |
| Identity | `uid`, per member. |
| Time | Rich, partial time: year, season, early/mid/late, month, day, weekday, part of day, clock time. `NULL` means "not asserted"; nothing is ever a placeholder. A modifier and what it scopes must be set together, which the database enforces. |
| Evidence | Explicit. A refinement ("the 21st") and a correction ("actually the 22nd") are recorded differently in provenance (`enriched` vs `corrected`). |
| Provenance | `created`, `edited`, `deleted`. The itinerary page's history is built entirely from these rows. |
| Privacy | **Private at creation** (the column default is public, but creation sets private). Linking a private mark as a stop makes a public itinerary private, rather than exposing the mark. |
| Deletion | Deletes its days and stops, with provenance. **Marks and check-ins are never touched**: they're canonical records that outlive any plan that referred to them. |

### Day
| Question | Answer |
|---|---|
| Asserts | A grouping of stops within the plan, optionally with its own time. |
| Identity | `uid`. A day can only hold stops from its own itinerary, which the database enforces. |
| Deletion | Its stops aren't deleted; they become unplaced. The database requires this order. |

### Stop
| Question | Answer |
|---|---|
| Asserts | A parcel of intended time. |
| Does not assert | A visit. If the member says they've been, that's a check-in instead. |
| Kinds | **linked:** points at one of the member's marks. **particular:** a specific place they can't yet name ("that tapas place Flora recommended"). **experiential:** the words are the whole intention ("some chilli crab"). **allocation:** deliberately open time ("leave the afternoon free"). The last three are complete as they stand; none is a defective mark. `linked` if and only if a mark is referenced, which the database enforces. |
| Can be unresolved | **Yes, by design.** And a linked stop whose mark was later deleted is shown as history, not treated as an error. |
| Identity | `uid`. The mark reference is a uid, deliberately not a foreign key. |
| Privacy | Shown or hidden per stop on a published plan (`visible` / `suspended`). Otherwise inherits the itinerary. |
| Legal transitions | Unresolved → linked (resolve to a mark) → unlinked back to one of the three kinds. Resolving never creates a mark silently; adding a new place may create one, and it inherits the itinerary's privacy. |
| Known debt | None found. Duplicate stops are allowed, deliberately (the same place can appear twice in a plan). |

---

## 5. Ensembles

### Ensemble
| Question | Answer |
|---|---|
| Asserts | A durable, member-owned arrangement of things, usually composed with AI. |
| Created by | AI on the member's behalf. It's staged as **pending review** and becomes saved only when the member keeps it. A web path for creating ensembles: **not verified**. |
| Intent | Explicit consent is required to keep it. Declining discards it. |
| Identity | `uid`, per member. |
| Privacy | Staged private, and keeping it keeps it private. Publishing is a separate, explicit edit. |
| Deletion | Removes its components and images. Discarding also removes notes it created that nothing else uses. |

### Component
| Question | Answer |
|---|---|
| Asserts | "This piece is part of the arrangement." |
| Identity | `uid` for life. Resolving it changes *what is known* about the piece, never *which* piece it was. |
| Can be unresolved | **Yes, by design** (state `unresolved`), until identified. |
| Evidence for resolution | Only qualifying canonical evidence can link it to a note: the member's own identification, maker and model, a product page, an external identifier, or an existing note. **A visual guess never qualifies.** This is the model's main defence against evidence laundering. |
| Privacy | Its label and image belong to the ensemble, so a public ensemble can describe a piece whose note is private without revealing the note. |
| Deletion | The note reference is a uid and survives the note's deletion as history. |

### Artifact (generated image)
Asserts: "this image was generated for the ensemble". Its `lineage` records what it was derived from. The member chooses which one represents the ensemble, and switching between images is reversible.

---

## 6. Infrastructure concepts

### Provenance
An append-only ledger of what happened to each durable record: the action, the evidence type, the actor, the agent, the authentication, the connection, the source and which fields changed. It's never deleted, and it's the source for itinerary history and for proving marks were verified. Gaps: D4 (cascade deletions) and D8 (ownership and warrants are double-recorded — acceptable).

### Derived relation
The designated home for anything computed or inferred ("similar taste", "probably the same place"). It carries a confidence score, a method, its evidence and a timestamp. The rule that it's never consulted for identity or reuse is enforced. **It's currently empty: nothing writes to it** (D7).

### AI connection and authorship
Each OAuth connection is one revocable client with its own `uid`. Revoking keeps the row (`revoked_at`), so history still names it. Writes made through AI are `ai_on_behalf`, naming the agent and connection. The legacy connector URL authenticates as the member, with `auth_method` recorded. **The admin view never applies to AI connections.**

### Image
Asserts nothing on its own. It's public only if a public record uses it, and never deleted (disclosed).

### Follow
A public social connection between members. It has a `uid`. Unfollowing writes provenance; whether following does was **not verified**.

---

## 7. Semantic debt, triaged

The rule applied: a change is justified only if the inconsistency causes semantic ambiguity, evidence laundering, identity instability, provenance loss, privacy problems, unreliable relationships, or an inability to extend the model coherently. Everything else is documented and left alone.

### Worth acting on

**D1. No canonical identity for real places.** *(Deprioritised; see 7a.)* *(Identity instability; inability to extend.)* A mark stores a name, address and coordinates, but not the identifier of the real place it resolved to (for example the Photon/OpenStreetMap ID). So Discriminantly can't know that two members' marks, or one member's two marks, are the same place except by comparing names. For a "taste database", place-level identity is arguably the moat: "who else kept this", "places like this" and dedup all depend on it.

*Smallest fix:* when a mark is created from a place lookup, record the place source and its identifier as new, additive fields. Don't backfill by guessing; existing marks stay "unknown" until re-verified. **This touches `add_travel_mark`, so it waits for the MCP freeze to lift.**

**D2. Duplicate detection matches names by substring.** *(To be improved after the freeze; see 7a.)* *(Unreliable relationships; ambiguity.)* Saving "Hatchards St Pancras" is treated as a likely duplicate of "Hatchards", and since v2.52.7 returns "unchanged". A genuinely new place is silently not saved unless the AI retries with `allow_duplicate`. It's also the only thing standing in for place identity (D1).

*Fix together with D1:* match on the place identifier when there is one, and fall back to names only when there isn't. **Also MCP, so after the freeze.**

**D3. Check-ins are public by default, through their mark.** *(Closed as intended; see 7a.)* *(Privacy.)* A check-in is dated location history: where the member was, and when. It inherits the mark's privacy, and marks are public by default. So "I went to Time Out Market yesterday" is publicly visible on the mark's page by default.

This isn't a bug; it follows the model consistently. But it's the most privacy-sensitive evidence in the system, and it's a product decision whether it should default to private (on its own, or with the mark). **Decision needed from you; no migration is implied.**

**D4. Records removed along with their parent get no provenance of their own.** *(Resolved in v2.53.1; see 7a.)* *(Provenance loss, minor.)* Deleting a mark removes its check-ins, and deleting a note removes its comments and Owned history, but only the parent gets a `deleted` row. Anyone reading a check-in's history finds no end to it.

*Smallest fix:* write a `deleted` row for each dependent record, noting it was removed with its parent, before the deletion. It's additive and needs no migration. The note and mark deletions run through both web routes and MCP tools; **the MCP half waits for the freeze.**

### Documented, left alone

**D5. Legacy duplicate tables.** *(Not harmful now.)*
- **`notes`:** a shadow of note creation, written on create and never updated. Only a migration reads it, so it can drift.
- **`object_collections`:** superseded by `note_collections` and read only by migrations.

Neither is read at runtime, so neither causes ambiguity. Recommendation: stop writing `notes` the next time note creation is touched, and never read either in new code.

**D6. `same_thing_as` has a reader and no writer.** Nothing can create one. When a "these are the same thing" feature arrives, build its writer; until then, this is dormant, not wrong.

**D7. Derived relations are reserved and empty.** The rule "inference lives here, never in canonical records" is enforced but not yet exercised, because no inference feature exists. It must be the first place any inference feature writes.

**D8. Ownership and warrants are recorded twice**, as their own append-only rows and as provenance. That's redundant, but the two agree and each serves a purpose (current state versus the ledger). Leave it.

**D9. Physical names differ from concepts:** `objects` is Notes, `visits` is Check-ins, `itinerary_groups` is Days. The code, tools and UI use the concept names consistently, so there's no semantic ambiguity. A rename would be churn with no user benefit.

**D10. `resurfaced` uses integer ids.** It's operational ("already shown today"), not evidence, so identity stability doesn't matter. Leave it.

**D11. Notes and marks have somewhat different shapes** (two comment tables, a different set of fields). They're asymmetric but unambiguous. Leave them.

**D12. Collections have no privacy of their own.** *(Leak found and fixed in v2.53.2; see 7a.)*

**D13. Photos outlive deleted records.** This is already disclosed in the Privacy page and already reported as a retention task. It isn't an ontology issue.

### Resolved during this cycle (for the record)
- **Admin visibility:** the admin exception is now one rule, off by default, and never applies to AI (v2.53.0).
- **Profile feed:** the All feed is consistent with the tabs (v2.52.8).
- **Duplicate results:** they're structured and pointed at the existing record (v2.52.7).

---

## 7a. Decisions (Brian, after the audit)

**D1. Canonical place identity: deprioritised.** Discriminantly's emphasis is the member's direct relationship to places, things, plans and their combinations, not their relationship to other members who keep the same items. Cross-member place identity is therefore not strategically material. This matches the governing principle "the relationship is the record". No change.

**D2. Duplicate detection: to be improved, for the member's own catalogue.** The goal is common-sense de-duplication for the convenience and hygiene of each member's own catalogue. It isn't about reconciling records of real-world places. Direction:
- match within the member's own marks only, as now;
- stop treating one name *containing* another as a duplicate on its own;
- use locality, and coordinates when both are known, so branches of the same name in different places stay distinct;
- keep "unchanged" plus `allow_duplicate` as the escape.

Today only the AI path checks for duplicates; the web app doesn't, and should share the same rule. **The AI half touches `add_travel_mark`'s behaviour, so it waits for the MCP freeze to lift.**

**D3. Check-in privacy: closed as intended.** Check-ins inherit their parent mark's privacy. If the mark is public, its check-ins are public. That's current behaviour, so no change.

**D4. Check-ins and comments keep a record of their end: done in v2.53.1.** Deleting a mark now records each of its check-ins and mark comments as deleted, and deleting a note records each of its comments. Each entry is marked as a consequence of the parent's deletion (`system`, source `cascade`, pointing at the parent), and the parent's own entry names who acted. It's implemented as database triggers on the parent, so it covers every path (web, AI, and anything later) without touching the frozen MCP code. A direct deletion of a single check-in or comment is still recorded once, by the app, with the real actor. **Extended in v2.53.2 to per-day check-in notes.** Their authorship was already recorded (`created`, `edited`, with the actor), but nothing tied them to their check-in or recorded that they went with it. A trigger on check-ins now records each day note as `deleted`, pointing at the check-in. SQLite fires it inside the cascade too, so the chain survives whether the check-in is deleted directly or with its mark: day note → check-in → mark → the actor who deleted the mark. Removing a single day note is still recorded once, by the app. Owned records aren't included.

**D12. Collection names: leak fixed in v2.53.2.** Verified across the public read paths. The names of collections holding only private items appeared to signed-out visitors, other members and the admin (view off) on a member's **Notes** and **Marks** tabs, including the filtered collection view. The items themselves stayed hidden. Search, the home feed and itinerary pages didn't show them. The fix was narrow: those tabs already counted only the items the viewer can see, and now show another person only the collections with at least one such item. Owners, and collections with any visible items, are unchanged. No architectural change; collections still have no privacy of their own.

**Legacy items (D5, D6, D8–D11): accepted as they are.** They're the result of an evolving schema, and so far only the founder has used the product, so no other members are affected.

## 7b. Final disposition — existing-ontology hygiene audit, closed

**Closed**
- **D3:** check-ins inherit their mark's privacy. Confirmed as intended, no change.
- **D4:** check-ins, mark comments, note comments and per-day check-in notes keep a record of their end when their parent is deleted (v2.53.1, v2.53.2).
- **D12:** collection names no longer leak through private-only collections (v2.53.2).
- Also resolved during this cycle:
  - admin visibility, now a setting and web only (v2.53.0);
  - the profile feed, now consistent with its tabs (v2.52.8);
  - structured duplicate results (v2.52.7).

**Deliberately accepted and documented**
- **D1:** no canonical identity for real places. Not strategically material: the product is about the member's own relationships.
- **D5:** the legacy `notes` shadow table and `object_collections`.
- **D6:** `same_thing_as` relations can be read but not yet created.
- **D7:** derived relations reserved and empty until an inference feature exists.
- **D8:** Owned and warrants recorded both as their own rows and as provenance.
- **D9:** physical table names that differ from the concepts.
- **D10:** `resurfaced` keyed by integer ids.
- **D11:** notes and marks have different shapes.
- **D13:** photos outlive deleted records (disclosed; a separate retention task).
- Owned records removed with their note get no deletion entry of their own (not in D4's scope).

**Deferred until the MCP freeze lifts**
- **D2:** common-sense duplicate detection within a member's own catalogue. Matching uses the place's locality, and its coordinates when both have them, and a name merely containing another no longer counts. The web app gets the same rule. It touches `add_travel_mark`'s behaviour.

## 8. Summary

The ontology is in good health. The load-bearing distinctions are sound, and most are enforced by the database or the code rather than by convention:
- **Distinct meanings:** a mark isn't a visit, a stop isn't a visit, ownership isn't endorsement.
- **Canonical vs derived:** kept firmly apart.
- **New evidence, not mutation:** appended rather than rewritten.
- **Attribution:** AI writes are always attributed.
- **No laundering:** a visual guess can't become identity.

The one structural gap that matters for the moat is **D1, canonical place identity**, and its companion D2. D3 is a product decision about privacy, and D4 is a small, additive provenance fix. Nothing here justifies a broad refactor.
