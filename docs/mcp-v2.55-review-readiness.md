# MCP v2.55: review-readiness report

For Brian's approval before rescanning and resubmitting. Written 23 September 2026, on top of `01f2b2c`.

**Nothing is committed or deployed. OpenAI Scan Tools hasn't been run, and nothing has been submitted.**

## 1. The surface

The OpenAI review of v2.52.7 was cancelled. The temporary exposure strategy is retired: the frozen `/mcp`, the admin-only `/mcp-dev`, and the `MCP_ADDITIVE_TOOLS` switch before it.

- **`/mcp`** (and the legacy `/mcp/<token>`) serves every connection the same **61 tools** and the same server instructions.
- **`/mcp-dev` is gone** and now returns 404 (R0c).
- **No exposure logic remains:** no per-member, per-account or reviewer-specific exposure anywhere (MC5).

| | v2.52.7 (historical) | v2.55 |
|---|---|---|
| Tools | 54 | **61** (54 kept, 7 added, none removed or renamed) |
| Read-only | 14 | **16** |
| Destructive | 15 | **16** |
| Open-world | 32 | **38** |
| Server instructions | 4,110 chars | 4,996 chars (WRITING adjusted; RECOMMENDATIONS paragraph added) |
| OAuth, discovery, the MCP routes, `plugin/` | — | **Unchanged**: the `MF` fingerprints and the live guard both check them |

**The seven added tools:**
- `record_recommendations`, `resolve_recommendation`, `list_recommendations`, `keep_recommendation`, `dismiss_recommendation` (Recommendation);
- `set_stop_note`, `list_stop_notes` (Stop → Note).

**Against the historical submission:**
- **10 tools changed in meaning or wording**, listed in §2.
- **19 more differ only because the shared write result gained one enum value, `kept`.** That value is returned when `note_object` or `add_travel_mark` keeps a record the member already had as a recommendation. For every other call the result is unchanged.

## 2. Audit findings applied

**Annotations (submitted tools):**

| Tool | Was | Now | Why |
|---|---|---|---|
| `create_pending_ensemble` | open-world false | **true** | It can fetch constituent images from public URLs. |
| `keep_ensemble` | open-world false | **true** | Keeping puts the composition in the catalogue, visible to others unless private. |
| `arrange_itinerary` | destructive false | **true** | It rewrites the placement and order of every stop, and keeps no previous version. |

**Annotation corrected on an added tool (found in this pass):** `keep_recommendation` is now **open-world true**.
- **The case:** a resolved recommendation can point at a record the member already had, matched by name or URL. That record may never have been kept, such as a note that survived a pending composition because they own it, and never marked private.
- **What happens:** keeping it makes it visible to other members, and that is publishing.
- **Why it's an edge:** records created *for* a recommendation are always private.
- **The flag follows the edge case,** as `keep_ensemble`'s does. The justification says exactly this.

**Descriptors and behaviour (submitted tools):**
- **`recent_notes`:**
  - Another member's note no longer carries its provenance (agent and timestamps); the member's own notes keep theirs (M3).
  - `already_adopted` is renamed `already_renoted`. Under Adoption, "adopt" meant the wrong thing.
- **`add_travel_mark`:**
  - States plainly that a mark is not a visit: a check-in is `log_visit`, and only when the member says they went.
  - Its submission justification wrongly claimed a Photon lookup; that's corrected in the draft.
- **`re_note`:** "adopt"/"owned" wording is replaced with Re-note, and it now honours `canView`.
- **`note_object` and `add_travel_mark`:**
  - When the member asks to note or mark something that is already a recommended record of theirs, the existing record is Kept (result action `kept`), with no duplicate (S20, S21).
  - `add_travel_mark` also records a visit if `visited_on` is given.
- **`discard_ensemble`, `delete_ensemble`, `resolve_ensemble_component`:** wording aligned with Adoption: what survives, and why.
- **Checked and left as written:** the remaining submitted descriptors. None used terminology that misleads under Adoption, and no stylistic rewrites were made.

**Preserved from the earlier audit** (still tested):
- Retrying an ownership write doesn't reset the period, and a correction withdraws ownership.
- `log_visit` refuses impossible dates such as 2026-02-30.
- Retries of `log_visit` and `comment` within 120 s don't duplicate.
- Commenting requires the same access as seeing (D1–D4).
- Check-in stays independent of Mark and Keep.

**The `record_recommendations` boundary, as approved:**
- **Use it** only when a Discriminantly workflow deliberately selects and presents something to the member:
  - `cold_start`: starting their catalogue;
  - `destination_objects`: for one of their trips or plans;
  - `for_another_time`: including something set aside while doing either of the others.
- **Don't use it for:**
  - candidates that were only researched or considered;
  - general recommendation questions outside their catalogue and plans;
  - the member asking to Keep, Note or Mark something themselves. Those go to `note_object`, `add_travel_mark`, `create_itinerary` or `keep_recommendation`.
- **Also stated:** `keep_recommendation` says that buying, owning, visiting, praising, or wanting it under a stop is not a request to keep it.
- **Invariant:** research candidate ≠ Recommendation ≠ Adoption. The server holds this regardless of the model: recommended records are outside the corpus and owner-only until kept (R4, C1–C11).

## 3. Audits

| Audit | Result |
|---|---|
| **Semantics** (Mark ≠ Check-in ≠ Keep; Keep ≠ Own ≠ Warrant; Recommendation ≠ taste evidence; no draft state) | `test/tool-audit.js` 28/28, `test/recommendations.js` 43/43, `test/adoption.js` 71/71. No inference between relationships (P14, S6, R11c). Reactions are distinct and derive nothing (R9b, R9c). |
| **No-orphan invariant** | 0 on the fixture after every suite; 0 on a fresh install (SEED: 6 of 6 notes Kept; 052 and 053 apply). |
| **Privacy** (through the real OAuth path, second member as target) | `test/plugin-audit.js` **20/20**. No cross-member read, write, check-in, image reuse or mark disclosure. Revocation is immediate, and no tokens, hashes, stack traces, SQL or emails appear in 39 responses. Cross-member refusals through the new tools: S17/S17b. |
| **OAuth and discovery** | Byte-identical to the historical submission: `MF` fingerprints, plus the live guard's authorization-server, protected-resource and unauthenticated-challenge checks. |
| **Idempotency** | Retries of marks, notes, check-ins, ownership, warrants, comments, recommendations and stop notes don't duplicate. `keep_recommendation` twice changes nothing; the same reaction twice changes nothing. |
| **Output minimisation** | Other members' provenance is removed from `recent_notes`. Recommendations are owner-only. Details on what remains are in §5. |
| **Annotations** | Every tool has all three hints and all three justifications. The draft submission file equals the generated annotations (MC6–MC7). The SW tests pin the counts and each open-world rationale. |
| **Page parity** (old code against new, 108 views) | 0 differ |

## 4. Model-selection evaluation (full 61-tool catalogue)

Catalogue: `test/fixtures/selection-catalogue-v2.55.md`, generated from the server (instructions, and all 61 descriptions and schemas). Prompts: `test/fixtures/selection-prompts.md`, P1–P24 plus the workflow prompts W1–W10. The `keep_recommendation` annotation change touches no description, so selection is unaffected.

**Sonnet: 34 of 34.**
- W1 Cold Start recorded the 5 items presented.
- W2 Destination Objects recorded the 4 presented, out of 12 researched.
- W3 For Another Time recorded the one item set aside.
- W4, W9 and W10 recorded nothing: a general question and the member's own saves.
- W6 → `keep_recommendation`.
- P4 ("I bought that coffee") → ownership, not Keep.
- P13 (a note under a stop) → asks first.
- P23 and P24 → `not_for_me` and `not_this_trip`.

**Haiku: residual noise, all failing safe.**
- A conservative "none" on P2 and P12.
- In one run of P4, keep plus own.
- P13 went straight to `set_stop_note`; the server refuses an unkept note on a kept plan.

## 5. Needs Brian's decision before rescanning

1. **Approve this surface:** the 61 tools and the v2.55 snapshot.
   - The snapshot is `test/fixtures/mcp-contract-v2.55.json`.
   - The draft submission is `docs/submission/chatgpt-app-submission-v2.55.draft.json`.
   - The draft has 61 tools with justifications, 5 positive test cases (#4 is now a recommendation case) and the 3 original negatives.
2. **`keep_recommendation` open-world true** (§2). The alternative is to make Keep refuse, or force private, on a pre-existing record that was never kept, and keep the flag false. I'd keep the flag true: Keep shouldn't silently change privacy.
3. **The open-world reading.** v2.55 keeps the v2.52.6 reading: changing or removing content on a record that is or can be public counts as open-world. OpenAI's wording is narrower (reaching the internet, or publishing). The narrower reading would flip about 18 tools. Decide before the rescan, not after.
4. **Minimisation that remains:**
   - Other members' handles on `recent_notes` and `read_comments`, where attribution is arguably the point.
   - Timestamps on about 10 tools.
   - These are *required* output fields, so trimming them is a contract change. I left them.
5. **Carried over from decision A (applied, tested, confirm the behaviour):**
   - **Editing alone no longer keeps a staged Note.** Discarding a pending composition removes an edited-but-never-kept Note (T9c).
   - **`delete_ensemble` on a pending composition** removes its never-kept, unexplained Notes, as discard does (T10c). Its description now says so.
6. **Pre-existing web bug, outside MCP:** Keep and Discard on the ensemble page don't work (`mcpCall` is missing its connection argument). The fix needs the actor-attribution decision (web Keep attributed to the member, not an AI connection). I propose fixing it in Increment 4, which builds the web Keep surface anyway.
7. **Known and not blocking:** cross-member refusals say "does not belong to this member", not "not found". That confirms an id exists without revealing anything about it (S17b checks that no content leaks).
8. **Not changed:** `create_pending_ensemble`'s description is still long (2,307 characters). Shortening it is stylistic.

## 6. Test results (this build)

| Suite | Result |
|---|---|
| `node test/itinerary.js` (static, including MC1–MC8, SW, MF, LC) | **414/414** |
| `test/adoption-e2e.sh` | parity **0 of 108** differ; adoption **72/72**; recommendations **43/43**; tool-audit **28/28**; lifecycle **48/48** and the 054 backfill **4/4**; guard for member A and member B: **matches the v2.55 snapshot**; historical: **nothing removed; OAuth, discovery and shared result shapes unchanged** |
| `test/plugin-audit.js` (OAuth, two members) | **20/20** |
| Fresh install (`SEED=1`) | 052, 053 and 054 apply; 0 orphans |

**Guard change in this pass:** the live `recent_notes` result shape now comes from a public note of the caller's own, queried by its headline, so it doesn't depend on what other members noted last. The snapshot was re-recorded deliberately, twice, with each difference reviewed: the `keep_recommendation` hint, then the deterministic `recent_notes` shape. The historical snapshot is untouched.

## 7. Rescan and resubmission, once approved

1. Commit, then deploy. Production prints the 052 backfill tally at first boot; record it.
2. Run OpenAI Scan Tools against production, and compare what it reads with the v2.55 snapshot.
3. Enter the draft submission in the form. If it's copied into `plugin/`, re-record the `MF` fingerprint deliberately.
4. Run the positive and negative test cases in ChatGPT (and in Codex, if included).

## 8. Increment 4

Not started. It's separate from this submission: the web Recommended surface with Keep, "Not now" and "Not for me", and accepting an itinerary as one transaction. Nothing in Increments 1–3 has shown a semantic problem that would block the submission. The ensemble Keep/Discard fix (§5.6) is proposed to land with it.

## 9. Addendum: lifecycle invariants (items 6–8)

See `docs/lifecycle-invariants-report.md`. These change the surface for approval as follows:
- **`discard_ensemble`:** discarding a *kept* composition no longer deletes the adopted Notes it introduced. The description was changed and the snapshot re-recorded (it's the only descriptor change).
- **Behaviour, no schema change:**
  - Recommended records, and Notes staged for a pending composition, can't be edited before Keep.
  - Kept plans and compositions refuse un-kept children.
  - `keep_ensemble` adopts linked Notes that weren't yet kept.
- **Migration 054:** deleting a Mark or Note de-resolves the Stops and components that referenced it, in place.
- **Privacy:** a private Note's uid no longer reaches other members through a public composition's history or lineage.
- **Decisions carried to Brian:** 6b, 6.2, 6.3, 7d, 7e, 8a, 8b, 8c.

## 10. Addendum: final semantic invariant pass

See `docs/v2.55-final-semantic-pass-report.md`. Its result is **READY WITH NOTED NON-BLOCKERS**.

- **Adoption boundary:** check-in, ownership, warrant, comment and edits now need a kept record, on MCP and on the web.
- **Deleted recommendation targets:** a Recommendation whose target is deleted keeps its details, and its reference is cleared.
- **Contract text:** three descriptions and one instructions sentence changed (`keep_recommendation`, `delete_note`, `delete_travel_mark`). The snapshot was re-recorded.
- **Tests:** static 414; adoption 73; recommendations 43; tool-audit 29; lifecycle 77 plus 4; privacy 20/20; Sonnet selection 39/39.

