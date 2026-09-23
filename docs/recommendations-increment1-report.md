# Recommendations — Increment 1 report (Adoption)

Written against the commit that adds migration 052, on top of `01f2b2c`. It's the report asked for in `docs/recommendations-design.md` §6 before any Recommendation work starts.

**Status: built and tested. Increment 2 (Recommendation) hasn't started.** Four points need Brian's decision; they're in §6.

## 1. The migration (052-adoptions)

**Schema.** Everything is additive; nothing is dropped or rewritten.
- **`adoptions`:** append-only (`uid`, `user_id`, `subject_type` of `object`, `mark` or `itinerary`, `subject_uid`, `state` of `adopted` or `withdrawn`, `created_at`). It's modelled on Warrant, with a provenance row for every row.
- **The Adopted projection:**
  - `active_adoptions` holds each member's latest row per subject, when that row says `adopted`.
  - `adopted_objects`, `adopted_marks` and `adopted_itineraries` require the adopting member to be the record's own member, so nobody else's row can add your record to your corpus or take it out.
- **Deletion:** triggers on `objects`, `marks` and `itineraries`. They remove the record's adoption rows and write a `deleted` / `cascade` provenance row for each, as migration 049 does.
- **Collections:** triggers refuse any insert into `note_collections` or `mark_collections` for a record that isn't Kept. `setCollections` and `setMarkCollections` refuse first, with a readable message.
- **Ensemble transitions.** Both live in the frozen MCP dispatcher, so they're observed by trigger instead of edited:
  - **Keep** (`pending_review` → `saved`): adopts every Note that Ensemble made.
  - **Discard or delete while pending:** adopts the Notes that survive it (the ones `notesSafeToDiscard` keeps).

  Each adoption carries a `derived` provenance row citing the Ensemble. The act itself keeps its own actor.

**Backfill, and how it was checked for truthfulness.** Each record is classified by what it meant under the semantics in force when it was made. On the fixture (see §3), it logs:

```
adoption backfill: object:created_without_provenance 6, object:created 3, object:renote 1,
  object:ensemble_kept 2, object:pending_ensemble (not adopted) 1, object:ensemble_retained 1,
  mark:created 1, mark:itinerary 1, itinerary:created 1
```

| Case | What it meant then | Adoption |
|---|---|---|
| Ordinary Note, Mark or Itinerary | corpus membership at creation | adopted, dated at creation |
| **Seed data** (seed.js writes no provenance), and anything from before provenance existed | the admin's own Notes on the site | adopted; basis `created_without_provenance` |
| **Migration-025 rows** (materialised re-notes) and later re-notes | a deliberate member act | adopted; basis `renote` |
| **Itinerary-created Marks** | corpus membership under the Mark boundary | adopted; basis `itinerary` |
| Note made by an Ensemble at Keep, or resolved while pending and later kept | corpus from the moment of Keep | adopted, **dated at Keep**, not at creation; basis `ensemble_kept` |
| Note made on an Ensemble already saved, or before review existed (031), when saving was the commitment | corpus at creation | adopted; basis `ensemble_saved` |
| **Note made for an Ensemble still `pending_review`** | *not* corpus: made at staging, removed on discard | **not adopted.** The pending Ensemble explains it |
| Note from a pending Ensemble that was discarded or deleted, which survived because the member had made it their own | stayed in the member's notes | adopted, dated at the discard; basis `ensemble_retained` (see §6, decision A) |

Every backfilled row is dated at the moment the corpus gained the record. Its provenance row is dated now: `derived`, `system`, `schema_migration`, with the basis in `fields`.

**Found while checking.** The known case is broader than *created at staging*:
- Staging itself makes no Notes.
- **Resolving a component while its Ensemble is pending** does make one (`resolve_ensemble_component` calls `noteCreate`).
- **Discard keeps such a Note** once the member has edited it, owned it, warranted it, filed it or reused it.

Both paths are covered above, and going forward by `noteCreate`'s one exception and the two triggers.

## 2. Changed read semantics

- **Web corpus reads now go through the Adopted projection.** That's 45 read sites:
  - the home feed, search, the profile and its tabs, and the profile rail and home counts;
  - the followers and following chips, the activity feed and the Warrants tab;
  - itinerary lists, suggestions and the mark lookup, and the Stop note picker;
  - related notes, *who else noted this* and re-markers;
  - resurfacing, `/objects.json`, tag counts, the welcome picks, and `imageIsPublic`.
- **Single records reached by id or uid** still read the row. They're shown through `canView`, which is `canSee` plus one rule: **a record outside its member's corpus is private to that member, whatever its own flag**, and the admin's private view doesn't reach it either. This covers:
  - the Note, Mark and Itinerary pages;
  - Ensemble components and colophons, and the Notes under a Stop;
  - the Warrants tab, re-noting, re-marking and comments.
- **`OBJ_SQL` and `MARK_SQL` still mean every row.** The frozen MCP dispatcher refers to those names, so they can't change meaning without changing MCP behaviour. The projection lives in `ADOPTED_OBJ_SQL` and `ADOPTED_MARK_SQL`. The design said the two constants themselves would read the view; this is the same design, arranged around the freeze. Test K1 enforces that outside the frozen regions, every-row reads are single-record lookups only.
- **New rules:**
  - Only a Kept record joins a Collection.
  - A Stop in an adopted plan takes only a Kept Note.
  - A record outside the corpus can't be re-noted.
- **New records.** `noteCreate`, `markCreate`, `itineraryCreate` and `renoteFrom` record Adoption as they create. The one exception is a Note made for a pending Ensemble. Nothing else records Adoption, and nothing infers it from Owned, Check-in or Warrant (tests K4d, K5 and P14).
- **Boot check.** The server warns at boot if any record is outside the corpus with nothing explaining it (the no-orphan invariant).

**What members see.** For every viewer, every page is identical to the previous code (once relative times such as *5m ago* are normalised), except the owner's views of a pending Ensemble's Note. That Note leaves their notes list, feed, search and counts, and stays reachable from its own page and from the Ensemble.

## 3. Regressions tested

| Suite | Result |
|---|---|
| `node test/itinerary.js`: 365 existing checks, plus 26 new source contracts (K1–K7) | **391 passed** |
| `test/adoption-e2e.sh`: builds a fixture with the pre-052 code (seed, notes, re-note, marks, a check-in, an itinerary with a new place, four Ensembles: kept, pending, resolved-then-kept, discarded-with-survivor), then upgrades it | all passed |
| … page parity: 108 views (anonymous, owner, other member) × old code vs new code | **0 differ**: non-owners identical, owner identical to the old code minus the pending Note |
| … `test/adoption.js`: backfill (B1–B11), projection and privacy (P1–P16b), new records and Ensemble transitions (T1–T11), invariants including **no orphans** (I1–I3) | **46 passed** |
| … `test/mcp-contract.js`, live | **matches the submitted snapshot** |
| `test/plugin-audit.js`: the adversarial MCP privacy suite, through OAuth | **20/20** |
| Fresh install with `SEED=1` | the six demo Notes are Kept (provenance `seed`) and filed in their collections |

Three existing source-audit tests (M5, E1, PF1) named `canSee` or `MARK_SQL` literally. They now name `canView` or `ADOPTED_MARK_SQL`, which is the stricter rule. SN6's pattern was matching too far down the file, which would have hidden a regression, so it's now anchored to its function. `test/stop-notes.js` is an upgrade script for v2.54 and wasn't rerun; its source contracts (SN1–SN7) are in the main suite.

## 4. Where row existence still means Adoption

All of these are frozen, or deliberately left alone, and all are harmless today: the only records outside the corpus are pending-Ensemble Notes, which are private by default. **They must move before Increment 2 can create any recommendation-only record.** They're queued in `docs/mcp-vnext.md`.

- **Frozen MCP corpus reads:**
  - `my_notes`, `my_travel_marks` and `my_itineraries`;
  - `search_catalogue` and `catalogue_stats`;
  - `recent_notes`, which lists public rows, so a pending Note made public would appear there;
  - single-record lookups by id in `list_checkins`, `comment`, `warrant` and similar.
- **Duplicate detection:** `findSimilarNote` and `findSimilarMark`, used only by frozen `note_object` and `add_travel_mark`.
- **Identity reuse:** `findExistingNote` (Ensemble component matching), left on every row on purpose. Reusing any of the member's own records avoids making duplicates, and the design (Q18) wants existing matches found first.
- **Informational lineage:** `alreadyAdopted`, the member's own re-notes (always Kept), and the note page's *you've re-noted this*.
- **The retired `notes` table**, still written by `noteCreate` as before (debt D5).

## 5. MCP freeze status

**Unchanged.**
- All five fingerprinted regions and `plugin/` match (the MF tests).
- All 54 tool definitions match the submitted snapshot (the MC tests).
- The live contract guard passes.
- No fingerprint was re-recorded.

A few frozen tools reach shared domain helpers that now enforce the new rules. They behave differently only for a record outside the corpus, which can't be anyone's but the caller's own pending Note:
- `re_note` refuses such a source;
- `edit_note` refuses filing one in a collection;
- `get_ensemble` withholds such a Note from anyone but its owner.

These are privacy rules the design requires everywhere. No schema, result shape or description changed.

## 6. Decisions for Brian

**A. Surviving a pending Ensemble's discard counts as Kept.** It's recorded as `ensemble_retained`, citing the discard.
- **Why:** under the rules in force, such a Note stayed in the member's notes. Leaving it out of the corpus would make it an orphan with nothing explaining it, and deleting it would change behaviour.
- **The catch:** one reason `notesSafeToDiscard` keeps a Note is *marked owned*. This isn't the domain inferring `Owned ⇒ Kept`; it's the existing retention rule, recorded honestly. Still, you may prefer the discard flow (Increment 3) to *ask* instead.

**B. The admin's *Show members' private content* doesn't reach records outside the corpus.** The design says those are owner-only "always", so that's what's built. Say if the admin should see them.

**C. A place added to a *recommended* itinerary.** It's recommendation-only under the refined Mark boundary, and belongs in Increment 2. Today every itinerary is adopted, so `markCreate` always Keeps.

**D. Existing gap, not fixed here.** Commenting on another member's **private** (Kept) Note by posting to its id is accepted. The page is hidden, but the write goes through. Increment 1 closed this for records outside the corpus only, to keep behaviour unchanged. It's a one-line fix if you want it.

## Files

- `server.js`: migration 052; the Adoption helpers (`isAdopted`, `recordAdoption`, `withdrawAdoption`, `unadoptedExplanation`, `canView`); the creation paths; the collection and Stop rules; the read conversions; the boot check.
- `seed.js`: demo Notes record their adoptions.
- `test/itinerary.js`: K1–K7, and the updates to M5, E1, PF1 and SN6.
- `test/adoption.js`, `test/adoption-pages.js`, `test/adoption-e2e.sh` and `test/fixtures/build-adoption-fixture.js`: new.
- `docs/ontology-v1.md` (Adoption), `docs/mcp-vnext.md` (the Adopted projection prerequisite) and `docs/recommendations-design.md` (status).
