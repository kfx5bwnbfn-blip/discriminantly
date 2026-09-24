# Lifecycle invariants (items 6–8): audit, fixes and decisions

For Brian, 23 September 2026, on the uncommitted v2.55 tree. **Nothing is committed or deployed. Scan Tools hasn't been run, and nothing has been submitted.**

Tests: `test/lifecycle.js` has **48** checks, plus **4** on the migration backfill; `test/itinerary.js` has static checks LC1–LC5. `test/adoption-e2e.sh` runs all of them.

## Classification summary

| # | Finding | Class | Status |
|---|---|---|---|
| 6a | `edit_note`, `edit_travel_mark` and `update_itinerary` (title, context, publish), and the web edit routes, could edit a recommended record that wasn't kept, or a Note staged for a pending composition. | Safe narrow fix | **Fixed.** No change to any schema or descriptor. |
| 6b | Composition tools still work on a *recommended plan*: stops, days, times, stop notes. The design builds a recommended plan with them. | **Decision** | Left open. Sealing them needs a material redesign (below). |
| 7a | `discard_ensemble` on a **kept** composition deleted adopted Notes it had introduced. This was documented behaviour, and it's an automatic child cascade. | Safe narrow fix before submission | **Fixed.** The `discard_ensemble` description changed, so the v2.55 snapshot was re-recorded. |
| 7b | `keep_ensemble` didn't adopt a linked Note of the member's that wasn't yet kept (for example a recommended one). | Safe narrow fix | **Fixed.** |
| 7c | A kept plan or composition accepted a child that wasn't kept: `add_itinerary_stops` or `resolve_itinerary_stop` with a recommended Mark, and `resolve_ensemble_component` or `add_ensemble_component` with a recommended Note. That's an implicit route into the corpus. | Safe narrow fix | **Fixed.** Each is refused with "keep it first", matching `set_stop_note`. |
| 7d | An explicit child-cleanup option when deleting a parent. | Post-submission lifecycle work | Not built. A child goes only by its own deletion (L6). |
| 7e | Deleting a never-kept recommended plan leaves the Marks created for it. Only a Recommendation whose target no longer exists explains them. | Post-submission lifecycle work | Reported. Tied to decision 8b. |
| 8 | Deleting a Mark left its Stops `linked` to nothing. Deleting a Note left its components `linked` to nothing: they weren't listed as unidentified, and resolving one again was recorded as a "correction". | Needs schema triggers (additive) | **Fixed by migration 054** (below). |
| 8+ | **Pre-existing privacy leak:** another member viewing a *public* composition saw a *private* Note's uid, in the component history and in the image lineage. | Safe narrow fix | **Fixed** (D11). |

No MCP input or output schema changed. The one descriptor change is `discard_ensemble` (7a).

## 6. Recommended → Adopted → Editable

**The guard:** `assertEditable`. A record whose only explanation is prospective can't be edited as the member's own:
- a Recommendation's target;
- a place or Note in a recommended plan;
- a Note made for a composition still pending review.

**Where it applies:** `edit_note`, `edit_travel_mark`, `itineraryEdit` and `itineraryPublish`. That covers MCP `update_itinerary` and the web routes `/o/:id/edit`, `/m/:id/edit` and `POST /t/:id`.

**The refusal** names the next step: `keep_recommendation` or `keep_ensemble`. It never adopts anything (E1–E6, E8).

**After Keep,** editing goes through the normal tool. Provenance reads: created (from a recommendation) → adoption (kept) → edited (E7).

**Consequence for decision A:** a staged Note can no longer be edited, so "an edit alone keeps a staged Note" can't come up. T9c now asserts the refusal.

**Needs your decision:**
1. **Composition of a recommended plan** (`add_itinerary_stops`, `arrange_itinerary`, `update_itinerary_temporal`, `update_itinerary_stop`, `resolve_itinerary_stop`, `set_stop_note`, `delete_itinerary_entity`) stays open. It's how the approved `record_recommendations` workflow builds a plan (design §4).
   - If a recommended plan should be sealed once presented, `record_recommendations` would have to carry its stops, days and times. **That's a material contract redesign;** I didn't make it.
   - Recommended: keep composition open, and treat it as building the proposition.
2. **Relationships on recommended records stay allowed:** Owned, Warrant and Check-in. They're relationships, not edits, as approved earlier, and none of them implies Keep. Your wording ("no ordinary individual member relationship … until adopted") could be read as forbidding them. Confirm they stay.
3. **Survivors:** a Note that survived a discarded composition because the member owns or warranted it isn't prospective, so it stays editable (E9).
   - **It has no Keep path in MCP:** `keep_recommendation` doesn't apply, and `note_object` doesn't match it.
   - Should there be a general Keep for such records? That's a new capability, so post-submission.

## 7. Parent/child adoption and deletion

Audited against the code paths, not only the cascades:

| Parent | Adopting the parent | Deleting the parent (before) | Now |
|---|---|---|---|
| Kept itinerary | `keep_recommendation`: the plan, its Stop Marks and its Stop Notes, in one transaction | Stops and days go; Marks and Notes untouched | Unchanged (L2f, L3b) |
| Kept ensemble, `delete_ensemble` or web Delete | Keep adopted only the Notes it made | Components and images go; Notes untouched | Keep also adopts linked Notes not yet kept (L7) |
| Kept ensemble, `discard_ensemble` | as above | **Deleted the adopted Notes it had introduced**, unless owned, warranted, filed, edited or used elsewhere | Composition only; every adopted Note stays (L2b) |
| Pending ensemble, discard or delete | — | Never-kept Notes made for it go, unless another explicit relationship explains them | Unchanged: prospective cleanup (L1) |
| Recommended plan, never kept, deleted | — | Stops go; Marks created for it remain, explained by a Recommendation whose target is gone | Unchanged; see 7e |

**Tests:**
- L1–L6 are your six cases.
- L5: Check-ins, Ownership and Warrants on children that a parent introduced survive the parent's deletion.
- L6: a child is removed only by its own delete, recorded as the member's act, with no cascade row.
- L8: a kept parent refuses un-kept children, and a recommended plan still takes recommended places.

**Adoption context:** a child adopted through a kept composition has provenance `ensemble_kept` with the Ensemble's uid. A child adopted through a kept recommended plan cites the Recommendation, whose target is the plan.

**Residual, post-submission:**
- `add_ensemble_component` on a kept composition, *without* a `note_uid`, can still match an un-kept Note by name or URL through duplicate detection. Explicit links are refused. The fix is to restrict that match to kept Notes when the parent is kept.
- A dismissed recommendation doesn't clean up its prospective target. Your rule permits cleanup ("may"), so this is optional.

## 8. Child deletion de-resolves the parent reference

**Migration 054 (`054-deletion-deresolves`): triggers plus a backfill; no new columns.**

**Deleting a Mark:** every Stop that pointed at it keeps its row:
- **Kept:** uid, plan, day, order, times, attached Notes.
- **Changed:** `mark_uid` becomes NULL, and `linked` becomes `particular`.

**Deleting a Note:** every component that pointed at it keeps its row:
- **Kept:** uid, composition, position, source, and the generated images' lineage.
- **Changed:** `note_uid` becomes NULL, and `linked` becomes `unresolved`.

**Every path is covered**, with no parent or element ever deleted: web, MCP, the admin, discard, and parents in several plans.

**Provenance:**
- Each element gains a `de_resolved` row: actor `system`, `cascade`, with the deleted record's uid. The record's own `deleted` row names who acted.
- Earlier history is untouched. A later resolution appends after it: created → de_resolved → resolved again (D9, D21).

**Never automatic:**
- A new record with the same name is never assumed to be the deleted one (D8, D20).
- Nothing is recreated or given a new uid.
- Nothing becomes a recommendation.

**Identity snapshot, only where it discloses nothing:**
- A Stop with no label of its own takes the Mark's name.
- A component with no label or picture of its own takes the Note's, only if that Note was public and kept.
- A Stop whose private Mark was failing closed on a public plan is suspended, not suddenly shown (D15, D22).

**Display:**
- The plan page still says "Once marked", from the Stop's own history.
- MCP shows an ordinary particular Stop, or an unidentified piece, listed by `list_unresolved_components`.

**Backfill:** references already left dangling are de-resolved at migration, with `source_kind: backfill`.
- The fixture had none; production's count is printed at first boot.
- Re-running the migration on planted dangling rows proves it (DB1–DB4).

**Order:** the Note trigger replaces 052's adoption-deletion trigger on Notes. It checks "was this Note kept and public" *before* the Adoption rows go, in a single trigger.

**Needs your decision:**
- **(8a) Snapshot of address and locality on a Stop.** Stops have no columns for these, so only the label is kept. Adding `place_locality`/`place_country` is an additive column change, and it's optional. I didn't add them.
- **(8b) Recommendation targets.** A Recommendation whose target Note or Mark is deleted stays `resolved`, pointing at nothing (`keep_recommendation` then says the record no longer exists).
  - Following your rule would clear the target. But the approved design says "resolution only rises" and "deleting the target leaves the reference as history".
  - Options:
    - leave it as is;
    - clear the target but keep `resolved` with its known attributes, so Keep can re-materialise it;
    - drop it to `partial`.
  - Recommended: the second.
- **(8c) Descriptions.** `delete_note` and `delete_travel_mark` don't say that Stops and pieces pointing at the record stay and become unidentified. One sentence each would let the assistant tell the member truthfully. It's a descriptor change, so I didn't make it without your approval.

## Effect on the v2.55 surface

- **Snapshot re-recorded** for the `discard_ensemble` description only. It was already in the approved list of changes against the historical submission.
- **Draft submission:** the `discard_ensemble` justifications were updated. Annotations are unchanged (still destructive and open-world).
- **Everything else holds:** 61 tools; annotations 16 read-only, 16 destructive, 38 open-world; OAuth and discovery unchanged; nothing removed.
