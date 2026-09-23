# Recommendations: Increments 1 (revised), 2 and 3, with the compatibility report

Written for v2.55.0, on top of `01f2b2c`. It follows the revised MCP guardrails of 23 September 2026: **freeze compatibility, not capability development.**

**Status: built and tested, not deployed.**
- Increment 4 (the web Recommended surface) isn't built.
- Nothing is committed yet.
- The four decisions in `docs/recommendations-increment1-report.md` §6 are still open, and one new decision is in §6 below.

## 1. What was built

**Increment 1, revised.** The submitted MCP corpus reads now read the Adopted projection, behind their unchanged contracts:
- `my_notes`, `my_travel_marks`, `my_itineraries` (the list; opening one by uid is a single-record read) and `my_collections` counts;
- `search_catalogue`, `catalogue_stats` and `recent_notes`;
- duplicate detection in `note_object` and `add_travel_mark`.

`read_comments` and `comment` use `canView`. Test K1 now covers the whole file: `OBJ_SQL` and `MARK_SQL` (every row) are used only for single-record lookups, on the web and behind MCP.

**Increment 2: Recommendation (migration 053).** The `recommendations` table is as designed in §3 of the design doc: proposition, resolution with the known attributes only, target, context, workflow, rationale, evidence, and reaction. The domain operations are all in one block of `server.js`: `recommendationCreate`, `recommendationResolve`, `recommendationKeep`, `recommendationDismiss`, `recommendationsList` and `recommendationView`.
- **Progressive resolution.** A proposition goes unresolved → partial → resolved, never backwards. The label is never changed, and each step is an `enriched` provenance row naming its fields.
- **Reuse before creation.** An existing record, Kept or not, gains the Recommendation and is never duplicated. That's `findExistingNote` for things and `findExistingMark` for places (name plus locality).
- **Resolved with nothing to reuse.** A private record is made that is **not Kept**:
  - a Note needs its image;
  - a place gets a Mark;
  - a recommended itinerary is an ordinary private itinerary without Adoption.
- **Recommended itineraries.**
  - Stops are added with the submitted `add_itinerary_stops`.
  - A new place added to a recommended plan is a Mark the plan explains, not Kept: the refined Mark boundary.
  - Keeping the plan keeps it, the places at its stops and the Notes under them, in one transaction, with the same Stops. Unresolved Stops stay unresolved.
- **Evidence** is only the member's own canonical records: Kept notes, marks and itineraries, check-ins, kept ensembles, warrants and ownership. It can never be a recommendation, or a record that exists only because of one.
- **Independence.** Only Keep records Adoption, citing the recommendation. Nothing writes Owned, Warrant, Check-in or derived relations.
- **No orphans.** A record outside the corpus is explained by a pending Ensemble, a Recommendation, or a recommended plan it sits in. The server checks this at boot.

**Increment 3: additive MCP tools.** The smallest coherent surface over those operations, plus the Stop → Note capability that was waiting on MCP:

| Tool | Domain operation | Why it's needed | Used by |
|---|---|---|---|
| `record_recommendations` (a batch of up to 10) | `recommendationCreate` | Persist only what a Skill deliberately selected and presented, at the resolution actually reached | Cold Start, Destination Objects, For Another Time |
| `resolve_recommendation` | `recommendationResolve` | Progressive resolution without false precision | all three |
| `list_recommendations` | `recommendationsList` | Retrieve earlier recommendations, bounded and grouped by trip or *For another time* | all three; any later session |
| `keep_recommendation` | `recommendationKeep` | The member's Keep: Adoption of a note, mark or whole plan | all three |
| `dismiss_recommendation` | `recommendationDismiss` | Record a reaction (`not_this_trip` or `not_for_me`) only when the member gives one | all three |
| `set_stop_note` | `stopNoteAttach` / `stopNoteDetach` | Destination Objects puts a specific thing under a stop | Destination Objects |
| `list_stop_notes` | `stopNotesVisible` | Read a plan's notes back, since `my_itineraries` can't carry them without changing its submitted shape | Destination Objects |

I didn't add a tool per domain function: attaching and detaching share one tool, and the itinerary's stops reuse the submitted tools.

**Server instructions** gain one appended paragraph, RECOMMENDATIONS. The submitted text is kept verbatim.

**Exposure (superseded by decision E, `docs/recommendations-decisions-report.md`).** The two surfaces are now two endpoints:
- `/mcp` is the submitted surface for every connection.
- `/mcp-dev` is the developer surface, open to the developer account only.

The earlier per-member switch, `MCP_ADDITIVE_TOOLS`, is gone.

## 2. Submitted contract compatibility

| Question | Answer |
|---|---|
| Existing submitted tools changed? | **No** definitions changed: 54 of 54 are byte-identical (MC2, MC3, and the live guard). |
| Existing schemas changed? | **No** |
| Existing descriptors changed? | **No.** The server instructions have one paragraph appended, only for connections the additive tools reach; the submitted text is verbatim. |
| Existing annotations changed? | **No** (SW1, SW3) |
| Existing response contracts changed? | **No.** Result shapes match the snapshot (live guard). |
| OAuth or discovery changed? | **No** (MF fingerprints unchanged; live guard) |
| Observable existing semantics changed? | **Only for records outside the corpus, and only toward the submitted meaning.** Today the only such records in production are Notes made for an Ensemble still pending review. Those no longer appear in `my_notes`, `search_catalogue`, `catalogue_stats`, `recent_notes` or `my_collections` counts, and `note_object` no longer calls one "already noted". This matches `create_pending_ensemble`'s submitted description: *"nothing reaches their notes until they choose keep"*. The old behaviour contradicted it for pieces identified while pending. |

## 3. Compatibility tests

| Check | Result |
|---|---|
| Submitted-contract guard, static (`test/itinerary.js`: MC2–MC5, SW1–SW4, MF) | pass: 405 of 405 in the suite |
| Submitted-contract guard, live, founder connection | *Submitted MCP contract preserved; 7 additive tools*, instructions extended (allowed) |
| Submitted-contract guard, live, any other member (the reviewer's view) | *preserved*, **no** additive tools, instructions **identical** to the submission |
| Old-client regression (`test/plugin-audit.js`, through OAuth) | 20/20 |
| Old-client regression (`test/adoption.js`, C1–C12): the submitted tools against records outside the corpus; `note_object`, `add_travel_mark` and `create_itinerary` still Keep; single-record tools still reach the owner's record; identity reuse still finds unkept records without Keeping them | pass |
| Recommendation isolation (`test/recommendations.js`, R4 and R10–R11): recommendation-only notes, marks and plans are absent from `my_notes`, search, stats, `recent_notes`, `my_travel_marks`, the `my_itineraries` list, feeds and pages; owner-only by id | pass |
| Adopted-projection regression (page parity): 108 views, old code against new, on a database built by the pre-052 code | 0 differ |
| The dogfood loop (`test/recommendations.js`, 39 checks): recommend → partial → resolved → Recommended → keep → the same record in the corpus, recommendation as history, no Owned, Warrant or Check-in; a whole recommended plan with a new place and a stop note, kept in one act; cross-member refusals; no orphans | pass |
| Fresh install (`SEED=1`) | 052 and 053 apply; seed notes Kept; no orphan warning |

**Run it all:** `test/adoption-e2e.sh`, which builds the fixture with the pre-052 code, upgrades it and runs everything above except the plugin audit. The audit needs its own setup (`docs/plugin-submission.md`).

## 4. Where row existence could still be read as Adoption

- **`findExistingNote`**, on purpose: identity reuse across all the member's records.
- **`alreadyAdopted`** and *you've re-noted this*: the member's own re-notes, always Kept.
- **The retired `notes` table**, written by `noteCreate` as before (debt D5).

No corpus read remains on every row. K1 enforces this for anything built from `OBJ_SQL` or `MARK_SQL`, and the named surfaces have their own tests (K1d–K1f, K2).

## 5. Deployment notes

- **Two migrations run at boot: 052 and 053.** 052 prints its backfill tally, and the boot log should show no *record(s) outside the corpus* warning.
- **Two endpoints (decision E):** `/mcp` lists the submitted 54 tools for everyone; `/mcp-dev` lists 61 tools for the developer account.
- **No Scan Tools run.**

## 6. Decisions for Brian

- **A–E:** decided on 23 September 2026. See `docs/recommendations-decisions-report.md`.
