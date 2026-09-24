# Recommendations: decisions A–E and the endpoint split, the pre-deployment report

Written for v2.55.0, on top of `01f2b2c`. It applies Brian's decisions of 23 September 2026. **Nothing is committed or deployed.** §6 lists what needs his judgement first.

## 1. Decisions A–E

**A. Surviving a pending Ensemble: done, with three points to confirm (§6).**
- **The historical backfill is unchanged.** Pre-052 survivors are reconstructed as `ensemble_retained` Adoption, dated at the discard.
- **From now on, discarding or deleting a pending Ensemble adopts nothing.** The trigger that adopted survivors is gone (052 isn't shipped yet, so it was edited in place).
- **A never-kept Note from a pending composition survives only where an explicit relationship explains it,** and then stays outside the corpus and owner-only. Those relationships:
  - Owned (asserted or released, not a retracted mistake);
  - a Warrant;
  - another Ensemble;
  - an itinerary Stop;
  - a Recommendation;
  - a legacy collection.
- **The no-orphan invariant now accepts those explicit relationships** as explanations (`independentRelationship`), besides a pending Ensemble, a Recommendation and a recommended plan. None of them makes a record Kept (test K5c).
- **Tested:**
  - T9 and T9b: owned or warranted survivors are not Kept and are owner-only;
  - T10b: no orphans;
  - P14, S6, R11c: Owned, Warrant and Check-in never imply Keep.

**B. The admin's private view: kept as built.** It reaches private *corpus* content only. Records outside the corpus stay owner-only (tests B1–B4).

**C. A new place in a recommended plan: as designed, plus one addition.**
- It becomes a Mark the plan explains, not a Kept one.
- Keeping the plan keeps the plan, the Marks at its Stops and the Notes under them, in one transaction, with the same Stops. Unresolved Stops stay unresolved, and nothing creates a check-in, ownership, warrant or reservation (R11, R14–R14c, R8).
- **Added:** in a recommended plan, a new place the member already has a Mark for reuses that Mark instead of duplicating it (R11b). Kept plans keep their submitted behaviour.

**D. The comment gap: fixed.** Commenting on a note now needs the same access as seeing it (`canView`).
- **Tested (D1–D4, B3):**
  - an owner on their own private note;
  - a member who can see the note;
  - another member by id, on the web and through MCP;
  - a signed-out visitor;
  - a record outside the corpus;
  - the admin's view.
- **Also fixed:** the same gap on the web's comment route for travel marks. MCP already enforced visibility.

**E. Two endpoints: done, then superseded the same day.** The review was cancelled; `/mcp` now serves all 61 tools to every connection and `/mcp-dev` is removed. See `docs/mcp-v2.55-review-readiness.md`. As built at the time:
- **`/mcp`** (and `/mcp/<token>`) is the submitted surface for every connection, the founder's included: the 54 submitted tools and the submitted instructions.
- **`/mcp-dev`** (and `/mcp-dev/<token>`) is the developer surface: 61 tools and the RECOMMENDATIONS instructions paragraph.
- **Authorization:** `/mcp-dev` is open to the developer account (the admin) only. Any other account gets 403, and an unknown token gets 401.
- **No reviewer detection anywhere.** The per-member switch (`MCP_ADDITIVE_TOOLS`) is gone, and the domain isn't forked: both endpoints run the same `mcpCall`.
- **How to connect:** the founder's `/mcp-dev` connector URL is shown in Settings, in the Admin section.

**Additive tool names: one deviation.** The brief lists `recommend`, `recommended` and `stop_notes`. The tool audit (`docs/mcp-tool-audit.md`) renamed them `record_recommendations`, `list_recommendations` and `list_stop_notes`, for a concrete selection problem: "recommend" read as "fetch recommendations". I kept the renames. The other four names are unchanged.

**Reaction semantics.** `not_this_trip`, `not_for_me` and `dismissed` are now distinct assertions:
- each is stored as the reaction itself (the column is `reaction`, not `dismissed`);
- each is recorded as its own provenance action;
- each is exposed as its own status;
- `list_recommendations` filters by each one, or by `reacted` for any.

Nothing derives from them (R9b, R9c, and `derived_relations` stays empty). The tool name `dismiss_recommendation` stays, with a description that states the three meanings. The selection test separated them correctly (P23 and P24).

## 2. Migrations

- **052, backfill tally** on the fixture database built by the pre-052 code:

  `object:created_without_provenance 6, object:created 3, object:renote 1, object:ensemble_kept 2, object:pending_ensemble (not adopted) 1, object:ensemble_retained 1, mark:created 1, mark:itinerary 1, itinerary:created 1`

  **The production tally is not documented:** the server prints it at the first boot of this version.
- **053:** applies cleanly on the fixture and on a fresh install.
- **Orphan check:** zero on the fixture after every suite, and zero on a fresh install. The boot check printed no warning.
- **Ambiguous classifications**, resolved as follows:
  - Notes with no creation provenance (seed data and anything from before provenance existed) are adopted as `created_without_provenance`. Seed rows can't be told apart from other early rows.
  - A Note made on an Ensemble with no record of pending review is treated as made when saving was the commitment (`ensemble_saved`).
  - A Keep in the same second as a Note's creation counts as Keep time.

## 3. Submitted MCP (`/mcp`), as at decision E (superseded)

| Check | Result |
|---|---|
| Tool count | 54, for the founder's connection and for any other member's |
| Contract guard, live | Exactly the submitted snapshot for both: tools, schemas, descriptions and annotations; **instructions identical**; OAuth and discovery; result shapes |
| OAuth and discovery fingerprint (MF) | Unchanged |
| Instructions fingerprint | Identical to the submission (the guard compares exactly on `/mcp`) |
| Old-client regression | Adoption C1–C12 pass; `test/plugin-audit.js` 20/20 through OAuth |
| Adopted projection | The submitted reads exclude recommendation-only records (R4, C1–C11) |

## 4. Developer MCP (`/mcp-dev`), removed in v2.55

| Check | Result |
|---|---|
| Endpoint | `/mcp-dev` and `/mcp-dev/<token>`, routed before the fingerprinted `/mcp` routes, which are unchanged |
| Authorization | The admin account; any other account gets 403, an unknown token 401 (R0c) |
| Tools | 61: the submitted 54 unchanged, plus 7 additive |
| Additive tools | `record_recommendations`, `resolve_recommendation`, `list_recommendations`, `keep_recommendation`, `dismiss_recommendation`, `set_stop_note`, `list_stop_notes` |
| Pinned surface | `test/fixtures/developer-mcp-surface.json` (MC7 and the live guard with `SURFACE=developer`). The submitted baseline wasn't re-recorded. |
| Descriptor and annotation audit | `docs/mcp-tool-audit.md` and its addendum; selection re-run 24 of 24 |
| Dogfood loop | `test/recommendations.js` **43/43**: recommend → partial → resolved → list → keep → the same record in the corpus, recommendation as history; the recommended-plan loop; reactions; privacy; no orphans |

## 5. Application regressions

| Suite | Result |
|---|---|
| `node test/itinerary.js` (static) | 408/408 |
| Page parity: old code against new, 108 views | 0 differ |
| `test/adoption.js` (A, B, D included) | 71/71 |
| `test/recommendations.js` | 43/43 |
| `test/tool-audit.js` | 25/25 |
| `test/plugin-audit.js` | 20/20 |
| Fresh install (`SEED=1`) | 052 and 053 apply; 6 of 6 seed notes Kept; 0 orphans |

Everything except the plugin audit runs with `test/adoption-e2e.sh`.

## 6. Needs Brian's judgement before commit

1. **(Moot since item 6: a staged Note can no longer be edited at all.) An edit alone no longer keeps a staged Note (decision A, applied).** When a never-kept Note from a *pending* composition was only edited, discarding the composition now removes it, as it removes an untouched one. Before, editing kept it in the corpus. Editing a staged record is not a relationship, and keeping it Kept would be the edit ⇒ Kept inference A rules out; keeping it unkept would leave an orphan. The alternative is to treat "edited by the member" as an explaining relationship. (T9c)
2. **Deleting a pending Ensemble outright now removes its never-kept, unexplained Notes, as Discard does.** This covers `delete_ensemble` and Delete on the web. Otherwise they'd be orphans. `delete_ensemble`'s submitted description says *"Notes linked to it are NOT deleted — they are the member's own records."* These Notes weren't the member's records (not Kept), so the wording still holds in substance. But it's a behaviour change behind a submitted tool, though only for a pending composition whose pieces were identified and then deleted without keeping. (T10c)
3. **One Keep reason added for kept compositions.** Discarding a kept composition now also spares a Note that sits under an itinerary stop. That's protective only.
4. **Pre-existing bug, not fixed: Keep and Discard on the web don't work.** The ensemble page's Keep and Discard buttons call the MCP dispatcher with its arguments out of order (`mcpCall(me, 'keep_ensemble', …)` is missing the connection argument), so nothing happens and the page just redirects. Confirmed: posting Keep leaves the ensemble `pending_review`. It predates this work, but it matters now because Keep is the Adoption boundary. The fix is small, but it needs one decision: web Keep should be attributed to the member acting on the web, not to an AI connection, which means lifting the Keep and Discard logic out of the dispatcher into domain functions.
5. **(Moot: `/mcp-dev` removed.) No OAuth sign-in on `/mcp-dev`.** The endpoint accepts the personal connector URL, or a bearer token issued for `/mcp`. Offering OAuth discovery for `/mcp-dev` would touch the fingerprinted OAuth core, so it wasn't done. Is the connector URL enough for dogfood in Claude?
6. **Carried over from the tool audit (applied in v2.55):**
   - `keep_ensemble` and `create_pending_ensemble` should arguably be `openWorldHint:true`;
   - `arrange_itinerary` should arguably be `destructiveHint:true`;
   - `recent_notes` returns other members' provenance.

   All three were applied when the review was cancelled.
