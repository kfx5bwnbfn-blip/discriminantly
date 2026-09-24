# MCP tool description and review-readiness audit

Written 23 September 2026 for v2.55.0. It checks all 61 tools against OpenAI's current plugin guidance ([Plugin guidelines](https://developers.openai.com/plugins/app-guidelines), [Remote MCP review requirements](https://developers.openai.com/plugins/deploy/app-review)), against what each tool actually does, and against the Recommendation and Adoption ontology.

**The rule applied.**
- **Submitted tools:** the snapshot OpenAI scanned is not changed by editing the live server. Nothing in a submitted definition was changed. Findings are ranked by severity, and anything Material is set out for Brian's decision.
- **New tools:** corrected freely.
- **Behaviour behind a submitted contract:** fixed only where it was a plain bug, and the contract (names, schemas, descriptions and annotations) stays the same.

**The guidance that matters here.**
- **Annotations must match behaviour.** Misaligned ones are the most common rejection.
- **`openWorldHint` is `true` when a tool "accesses the public internet or open-ended external entities".** That includes write tools that "publish content", even in only some modes for the destructive hint.
- **Inputs are minimal:** no conversation history.
- **Outputs are minimal:** no internal identifiers, telemetry or unneeded timestamps.
- **Names and descriptions are plain and accurate:** nothing promotional, and no triggering broader than the user's explicit intent.

## 1. Findings

### Submitted tools (54 audited)

| Tool | Finding | Severity | Review risk | Semantic risk | Action |
|---|---|---|---|---|---|
| `keep_ensemble` | `openWorldHint:false`, but `private:false` publishes the ensemble (publishing content is open-world). The submitted justification ("staged private, and keeping does not change that") holds only by default. | **Material** | Moderate: the kind of mismatch reviewers flag | Low: private is the default, and the parameter says to publish only when asked | **Brian's decision.** Keep the submission in review. If OpenAI flags it, the fix is `openWorldHint:true`, one annotation. |
| `create_pending_ensemble` | `openWorldHint:false`, but `artifact` and component `image` accept an https URL that the server fetches from the public internet. `note_object`, `upload_image`, `add_ensemble_artifact` and `add_ensemble_component`, which do the same, are all `true`. | **Material** | Moderate: inconsistent with its siblings | None | **Brian's decision**, as above. The fix is `openWorldHint:true`. |
| `arrange_itinerary` | `destructiveHint:false`, but assigning days and ordering overwrites the previous arrangement, and the old order isn't kept. | Material (low) | Low: the plan survives and can be rearranged | Low | Brian's decision. Suggest `destructiveHint:true` when the review ends. |
| `add_travel_mark` | The description says "somewhere the member went" and "Add or create", which blurs a Mark with a visit. The `visited_on` parameter and the server instructions state the boundary correctly, and the selection tests (§3) chose correctly every time. | Material (low) | Low | Low | Leave during review. Clean up afterwards. |
| `recent_notes` | Returns each other member's note with its `provenance`, including `agent` (which AI client they used) and a timestamp. That isn't needed to read someone's public note. | Material (low, privacy) | Low to moderate: data minimisation | None | **Brian's decision.** It can be fixed without changing the contract (the schema allows `provenance: null`, so return null for other members' notes). Not applied, because it changes what reviewers may have seen in outputs. |
| `record_note_ownership` | **Bug, fixed.** Retrying (or saying "I own this" again) appended a second `owned` row. That restarted the ownership period and its patina, and `correct_note_ownership_mistake` then retracted only the newer row, **leaving ownership live after a correction.** | Material (data correctness) | None: contract unchanged | **High before the fix** | **Fixed** (`assertOwned` is idempotent). A repeat returns `action: "unchanged"`, which the submitted schema already allows. Test S7–S8. |
| `log_visit` / `edit_checkin` / `add_travel_mark` (`visited_on`) | **Bug, fixed.** Impossible dates such as 2026-02-30 were accepted, because `Date.parse` rolls them over. The descriptions promise YYYY-MM-DD dates. | Material | None: contract unchanged | Medium: a check-in on a day that doesn't exist | **Fixed** (`isYMD` validates the calendar date). Test S16. |
| `log_visit` | **Retry bug, fixed.** An identical check-in resent after a timeout recorded a second visit. | Material | None | Medium: inflated visit counts | **Fixed.** The same mark, dates and words from the same member within 120 seconds return the existing check-in as `unchanged`. A different day or different words is a new visit. Test S4. |
| `comment` | **Retry bug, fixed.** A resent comment posted twice. | Minor | None | Low | **Fixed** with the same 120-second rule. Test S18. |
| `re_note` | "Adopt another member's note… a NEW independent note owned by this member": "adopt" and "owned" now collide with Adoption (Keep) and Ownership. In the reviewer view (no recommendation tools), one weak model chose `re_note` to "keep a recommendation". | Minor | Low | Low: a reviewer or member has no recommendations | Leave during review. Reword after it. |
| `discard_ensemble` | Says a pending composition has "NO notes to remove". Notes made by identifying a piece while pending are removed and reported. Under Adoption those were never in the catalogue, so its core claim ("nothing had reached their catalogue") is now true. | Minor | None | Low | Leave. |
| `upload_image` | Points local files to the compatibility trio (`start_…` and `finish_…`), not `begin_image_upload`. | Minor | None | None | Leave during review. |
| `note_object` | "Post… a fine object": slightly editorial wording. | Minor | Low | None | Leave during review. |
| Several | Integer `id`s in inputs and outputs, alongside uids. The submitted inputs require them, so they're necessary rather than internal. | Minor | Low | None | Leave. uid-first inputs are for vNext. |
| create_itinerary, add_itinerary_stops | A retry creates a second plan or duplicate stops. Neither description claims idempotency. | Minor | None | Low | Not changed: a stop's identity is its words, and deduplicating a batch safely needs a design decision. Listed for vNext. |

**Checked and found correct:**
- **All 16 read-only tools write nothing.** Test RO1 exercised 15 of them. `verify_place` only queries the external map service; its code was read instead.
- **No output carries a token, session, trace, request or connection id, auth method or email** (tests M1 and plugin-audit).
- **Descriptions are fine:** none is promotional, favours Discriminantly over other tools, or asks to be called beyond the member's intent.
- **Inputs are minimal:** none asks for conversation history.
- **Ownership, warrants and check-ins stay separate:** `record_note_ownership`, `warrant` and `log_visit` each describe only their own act and forbid inference.

### New tools (7 audited)

| Tool | Finding | Severity | Action (applied) |
|---|---|---|---|
| `recommend` → **`record_recommendations`** | 1. The name read as "produce recommendations", inviting a model to call it to *get* suggestions. 2. It was triggered for any recommendation, which is broader than the member's intent and clashed with the submitted WRITING rule ("recommending… is not saving"). 3. It didn't mark the boundary with `note_object` and `add_travel_mark`. 4. `workflow` was free text. | Material | Renamed. Scoped to "when the member asked you for recommendations in Discriminantly", excluding suggestions made in passing. States that a thing the member asks to note or mark themselves goes to `note_object` or `add_travel_mark`. `workflow` is an enum of the three Skills and is refused otherwise (nothing written). The appended server-instructions paragraph was aligned the same way. |
| `recommended` → **`list_recommendations`** | A noun name; the boundary with `my_notes` and the other lists was implicit. | Material | Renamed; says when to use it and where their own records are. |
| `stop_notes` → **`list_stop_notes`** | A noun name. | Minor | Renamed. |
| `keep_recommendation` | In the selection test, a model kept a recommendation because the member said "I bought that coffee": Keep was inferred from Owned. | **Material (ontology)** | States that buying, owning, visiting or praising is not a request to keep, and that `record_note_ownership`, `log_visit` and `warrant` work on a recommended record without keeping it. Re-tested: correct. |
| `set_stop_note` | A model kept a recommended note by itself in order to attach it to a stop in a kept plan: Keep inferred from an attachment. | **Material (ontology)** | States that when the note is only recommended, it should ask the member whether to keep it. Re-tested: asks. Also states that attaching again changes nothing. |
| `dismiss_recommendation` | "keeps it open for another time in spirit" wasn't true: both reasons remove it from the open list. | Material (truthfulness) | Reworded to say exactly what happens. |
| All recommendation results | Returned `created_at`, a timestamp nothing needs. | Minor (minimisation) | Removed from the output schema and the results (test M2). |

**Annotations, justified.** No correction was needed in this pass; `set_stop_note` was already corrected to open-world in v2.55.0.

| Tool | readOnly | destructive | openWorld | Justification |
|---|---|---|---|---|
| `record_recommendations` | false | false | **true** | Writes private rows. Can fetch a picture from an https URL on the public internet. Nothing is overwritten or deleted. A retry returns the existing row. |
| `resolve_recommendation` | false | false | **true** | Adds attributes and raises the resolution level; it never lowers them or removes history. Can fetch a picture by URL. |
| `list_recommendations` | true | false | false | Reads the member's own private rows. |
| `keep_recommendation` | false | false | ~~false~~ **true (v2.55)** | Adds Adoption. Changes no privacy flag, but a pre-existing record the member never marked private becomes visible once kept (see the v2.55 addendum). Idempotent. |
| `dismiss_recommendation` | false | false | false | Records a reaction on a private row. Idempotent, and deletes nothing. |
| `set_stop_note` | false | false | **true** | A note under a stop of a **public** plan becomes visible to others. Detaching removes only the attachment, which can be made again. |
| `list_stop_notes` | true | false | false | Reads the member's own plan. |

## 2. Recommendation ontology in the tool definitions

| Assertion | Where the definitions keep it distinct |
|---|---|
| Recommendation | `record_recommendations`: "your proposal… does not mean they saw, liked, kept, own, visited or endorse it". Scoped to deliberately presented suggestions only. |
| Adoption / Keep | `keep_recommendation` is the only additive write that adopts, and it says buying, owning, visiting or praising isn't a request to keep. `note_object`, `add_travel_mark`, `create_itinerary` and `re_note` still Keep what they create (tests S1, S11, C12). |
| Ownership | `record_note_ownership` is unchanged. On a recommended note it records ownership without keeping it (test S6). |
| Check-in | `log_visit` records one check-in only; the mark and Keep are unchanged (S3). `add_travel_mark` with `visited_on` is the explicit compound (S5). |
| Warrant | `warrant` only; a retry records nothing more (S10). |
| Progressive resolution | `record_recommendations` and `resolve_recommendation`: unresolved and partial are "honest answers" and "neither needs inventing detail". Resolution only rises (R2–R3, R9). |
| Taste evidence | Recommendations and records that exist only because of one are refused as evidence (R6). |

## 3. Selection evaluation

The catalogues were exported from a running server exactly as clients see them: server instructions, then every tool's name, title, annotations, description and inputs. Two views:
- the founder's (61 tools);
- any other member's, which is the reviewer's view (54 tools).

Independent models chose tools for 22 prompts using only the catalogue. The prompts are in `test/fixtures/selection-prompts.md`.

| Run | Result |
|---|---|
| Founder view, Sonnet, **before** the fixes | 20 of 22 as expected. P4 "I bought that Kaʻu coffee" → keep + own (Keep inferred from Owned). P13 "put the coffee under the stop" → keep + attach (Keep inferred from an attachment). |
| Founder view, Haiku, before | No ontology violations. More conservative: P2, P4 and P12 made no calls. |
| Founder view, Sonnet, **after** | **22 of 22.** P4 → `record_note_ownership` only. P13 → asks before keeping. |
| Reviewer view, Haiku | No writes that misstate meaning. Recommending is conversation only, and "Add Hatchards" verifies then marks. One Minor: `re_note` chosen to "keep a recommendation" that the view can't see (see the `re_note` row). |

**The key boundaries, all correct after the fixes:**
- "Add Hatchards to my marks" → `verify_place`, then `add_travel_mark`.
- "Recommend some bookshops" → `record_recommendations`, or conversation only. **Never** a mark or a Keep.
- "I went to Hatchards yesterday" → `log_visit`.
- "I sold the Rimowa" → `release_note_ownership`.
- "That chair is a Finn Juhl" → `resolve_ensemble_component`, not `resolve_recommendation`.
- "Suggest a Kyoto itinerary" → a recommended itinerary.
- "I'm going to Kyoto, start a plan" → `create_itinerary`.

## 4. Behavioural tests

`test/tool-audit.js` (25 checks, run by `test/adoption-e2e.sh`) covers:
- **reads:** read-only tools change nothing;
- **distinctions:** Mark, Check-in and Keep; Keep, Own and Warrant; `note_object` and `record_recommendations`;
- **retries:** marks, notes, check-ins, ownership, warrants, comments, recommendations and stop notes;
- **identity:** ambiguous entities (the same name in another city is not merged);
- **refusals:** 10 kinds of invalid input write nothing; 10 cross-member attempts are refused without confirming a private record exists;
- **outputs:** minimisation.

## Addendum: decisions A–E (same day)

- **Surfaces (superseded, see the v2.55 addendum below).** The seven additive tools now exist only on `/mcp-dev`, the developer surface. `/mcp` serves exactly the submitted 54 tools and instructions to every connection. The earlier per-member switch is gone (decision E).
- **`dismiss_recommendation`.** The three reactions are distinct assertions, each recorded exactly as given and each its own provenance action:
  - `not_this_trip`: wrong for this plan, and says nothing about taste;
  - `not_for_me`;
  - `dismissed`: no reason given.

  A recommendation's `status` is now the reaction itself, and `list_recommendations` filters by each reaction, or by `reacted` for any. The description was reworded to match. The tool name stays.
- **Selection re-run** on the `/mcp-dev` catalogue (Sonnet, prompts P1–P24 in `test/fixtures/selection-prompts.md`): **24 of 24.** New:
  - P23, "I just don't like being in the water at night" → `not_for_me`.
  - P24, "not this time, we're travelling with the kids" → `not_this_trip`.
- **Additive descriptors are now pinned** in `test/fixtures/developer-mcp-surface.json` (MC7 and the `/mcp-dev` guard), so any change to them is deliberate.

## Addendum: the v2.55 surface (review cancelled, same day)

The OpenAI review was cancelled, so the Material findings held back for it were applied. One surface, `/mcp`, now serves all 61 tools; `/mcp-dev` is gone.

**Applied to submitted tools:**
- `keep_ensemble` and `create_pending_ensemble`: `openWorldHint: true` (keeping publishes the composition; a staged composition's images can be fetched from public URLs).
- `arrange_itinerary`: `destructiveHint: true` (it rewrites the order and placement of every stop, with no previous version kept).
- `recent_notes`: another member's note no longer carries its provenance (agent, timestamps). The field `already_adopted` is now `already_renoted`; "adopt" was the wrong word under Adoption.
- `add_travel_mark`: says plainly that a mark is not a visit, and a check-in is `log_visit` only when the member says they went.
- `re_note`: "adopt"/"owned" wording replaced with Re-note; it respects `canView`.
- `note_object` and `add_travel_mark`: when the member asks to note or mark a thing that is already a recommended record of theirs, the existing record is Kept (result action `kept`) rather than duplicated.
- `discard_ensemble`, `delete_ensemble`, `resolve_ensemble_component`: wording aligned with Adoption (what survives, and why). No stylistic rewrites elsewhere.
- `keep_recommendation`: `openWorldHint: true` (found while checking the draft justifications). A resolved recommendation can point at a record the member already had, found by name or URL. If that record was never kept (for example a note that survived a pending composition because they own it) and never marked private, keeping it makes it visible to other members, which is publishing. Records created for a recommendation are private, so this is the edge, not the rule; the flag follows the edge, as `keep_ensemble` does.
- Preserved: the ownership, check-in, comment, date-validation and retry fixes.

**`record_recommendations` boundary.** Use only when a Discriminantly workflow (`cold_start`, `destination_objects`, `for_another_time`) deliberately selects and presents something to the member; never for candidates merely researched; never when the member is themselves asking to Keep, Note or Mark. `keep_recommendation` says that buying, owning, visiting or praising a recommended thing is not a request to keep it.

**Selection re-run on the full 61-tool catalogue** (`test/fixtures/selection-catalogue-v2.55.md`, prompts P1–P24 and workflow prompts W1–W10):
- Sonnet: **34 of 34.** W1 Cold Start recorded 5 items; W2 Destination Objects recorded 4 of 12 researched candidates; W3 For Another Time recorded the one set-aside item; W4, W9, W10 (general questions, member's own saves) recorded nothing; W6 → `keep_recommendation`.
- Haiku: residual noise, all safe: a conservative "none" on P2 and P12; once, keep plus own on P4; P13 went straight to `set_stop_note`, which the server refuses for an unkept note on a kept plan.

**Pinned:** `test/fixtures/mcp-contract-v2.55.json` (MC1–MC8 and the live guard).
