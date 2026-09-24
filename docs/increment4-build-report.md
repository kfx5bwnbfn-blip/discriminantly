# Increment 4: Recommended, build report

Built on branch `increment-4`, on top of `release/v2.55` (commit `8f699ea`, the v2.55 release candidate). **Increment 4 is uncommitted and not deployed.** The design direction is `docs/increment4-recommended-design.md`.

## Decisions applied (24 September 2026)

1. **For-another-time kinds: small schema addition.** Migration 055 adds two nullable columns to `recommendations`:
   - `origin_itinerary_uid`: the plan it grew from;
   - `relation`: `same_city`, `similar` or `different`.

   `record_recommendations` accepts both as optional fields, and each recommendation reports `origin`.
2. **Keep one place of a proposed plan: web only.**
   - `POST /m/:id/keep` keeps that one place, citing the plan's recommendation, and the plan stays proposed.
   - No MCP change; general Keep stays deferred.
3. **Attach on Keep: yes.**
   - A note recommended for a stop joins that stop when kept, on the web and through `keep_recommendation`.
   - It's recorded in the recommendation's `kept` provenance row.
4. **Baseline.** v2.55 was committed first on `release/v2.55`. Increment 4 sits on `increment-4` above it, so the two stay separable.

## What was built

**Placement** (one markup, three arrangements):
- **Proposals present:** the itinerary page becomes a grid of plan, map + nearby, and proposals.
  - **Wide screens:** three columns. When the page holds at least 88rem, the map column narrows and the plan never does.
  - **Two columns:** proposals go under the map.
  - **One column:** plan → map → *Nearby, from your catalogue* → *For another time*.
- **No proposals:** the page is byte-identical to before.

**The proposals column.**
- **Order:** same city, similar, different.
- **Each card shows:**
  - the kind in words: *Next time in **London***, *Like London, in **Stockholm***, *Another direction · **Berlin***;
  - the title and the rationale;
  - shape and date.
- **Explore opens compact stop tiles** on the proposal's own spine:
  - hollow dot = proposed, filled with *In your marks* = already theirs;
  - things proposed at each stop hang inside its tile, marked *Proposed* with Keep, or *Still to identify*.
- **Actions:** *Keep this plan*, *Not this trip*, *Not for me*.
- **After Keep:** the card solidifies in place, with the member's byline, *Open the itinerary*, and *No visits, ownership or warrants were recorded*.

**Map preview.** Exploring a proposal shows its places on the plan's map as hollow rings, in its own numbering, with a caption legend. Places are shown only where they fall on that map, so another city previews nothing.

**Nested under stops in the active plan.** Under each stop, three kinds of row:
- the member's notes (*Worth noticing here*);
- proposed things (*Proposed · worth seeking here*, Keep, Not for me);
- things still to identify (outline, hatched thumbnail, no action).

None of these rows gets a dot, number or time.

**A proposed plan's own page.**
- The head shows why it exists, with Keep this plan and the reactions.
- There's no Edit, no editing forms and no owner script.
- Proposed places are mark cards in the proposed state: *Proposed for*, the title set straight rather than on the arc, Directions and Keep, no Check in.
- Places already theirs keep the ordinary arced card.

**Proposed note or mark pages.**
- *Proposed for*, the reason, Keep and Not for me, and one line: *Keep it to edit, own, comment on or warrant it*.
- No Edit, no Owned switch, no comment form, no check-in prompt.
- A note staged in a pending composition says *Kept with its composition* and offers no Keep of its own.

**Compositions.**
- Web Keep and Discard work again (the old `mcpCall` argument bug) and are recorded as the member's own act.
- The pending composition's page groups pieces truthfully: *From your notes* (kept only), *Proposed*, *Identified for this composition, kept with it*.

**Delete and review.**
- Deleting a kept plan or composition deletes it only. The confirmation says what stays, and the result page offers *Places and things kept with this itinerary / composition*.
- **Each row shows** how the record came:
  - kept with this plan, or yours since a date;
  - and its other relationships: check-ins, ownership, warrants, comments, other plans, compositions, stops, collections, edits.
- **Nothing is preselected.** Each chosen deletion is its own act, recorded with `source_kind: review_cleanup`.

**Material.** Proposed material tokens (`--m-prop`, `--m-prop-line`) in light and dark; classic uses a dashed edge.

## Contract impact

**The MCP surface moves from v2.55 to v2.56, additively.** Test MC9 holds this: same 61 tools, same names, same annotations, same server instructions.
- `record_recommendations` gains two optional inputs.
- Recommendation results gain an optional `origin` object. This touches the output schema of the five recommendation tools.
- `keep_recommendation` gains one sentence (it attaches to the stop it was proposed for).

**Snapshots.**
- `test/fixtures/mcp-contract-v2.55.json` is untouched: it's the release baseline.
- `test/fixtures/mcp-contract-v2.56.json` is new, and the live guard now compares against it.
- The historical v2.52.7 snapshot is untouched.

**Sequencing consequence:** if v2.55 is scanned and submitted first, deploying Increment 4 afterwards changes what the reviewer scanned (additive only). Deploy Increment 4 after the v2.55 review, or rescan with it.

## Tests (this build)

| Suite | Result |
|---|---|
| Static `test/itinerary.js` (MC1–MC9, K, RC, LC, SW, MF) | **415/415** |
| Page parity, old code against new | **108 views, 0 differ**. The two intended global changes (delete-confirm copy, `data-copy`) and the staged note's pages are folded in explicitly. |
| `test/adoption.js` | 73/73 |
| `test/recommendations.js` | 43/43 |
| `test/tool-audit.js` | 29/29 |
| `test/lifecycle.js` + 054 backfill | 77/77 + 4/4 |
| `test/increment4.js` (new) | **41/41** |
| Contract guard, founder and another member | matches v2.56 |
| Historical guard | nothing removed; OAuth and discovery unchanged |
| OAuth privacy audit | 20/20 |
| Fresh install | 055 migrations apply; 0 orphans |

**What `test/increment4.js` covers:**
- placement and DOM order;
- kind wording and order, rationale;
- tiles, and nesting inside tiles;
- the map preview limited to places on this map;
- another member sees nothing;
- a plan with no proposals is unchanged;
- nested rows under stops;
- web Keep, attributed to the member, from the recommendation, joining its stop;
- reactions;
- the proposed plan page;
- keeping one place, then the whole plan (no visit, ownership or warrant recorded);
- proposed and staged note pages;
- delete and review, including another member being refused;
- web composition Keep, and composition delete and review;
- the MCP origin fields, their validation, and attach on Keep;
- no orphans.

**Visual pass (second round).** Rendered at 2400, 1700, 1300 and 390px, dark and light, on every new surface: the plan with proposals (collapsed, explored, kept), the proposed plan's own page, a proposed note's page, a proposed place's page, the pending composition page and the review page. Fixed as a result:
- two columns now hold from 66rem of page width (the map column shrinks, the plan keeps its width), where before a 1700px screen fell to one column with a full-width map;
- a proposed record's page carries no comments section at all (before, it offered a sign-in link);
- the reactions and quiet Keep buttons have their own class, so they no longer inherit the note card's "Link:" styling;
- the review page's actions sit on one line at their own width;
- a place already the member's, inside a proposal, reads as solid glass in light mode.

**Visual check.** Rendered with Playwright on seeded data at 2400px (dark and light) and 390px (light). Checked: three columns, the order on a phone, compact tiles, nested rows, the proposed plan page, and the light-mode contrast between kept and proposed tiles.

## Not built, deliberately

- A general MCP Keep.
- Automatic cleanup of never-kept proposals.
- *Reconsider* on a declined proposal (there's no server operation). Declined proposals stay visible, set back, labelled with the reaction.
- Locality snapshots on unresolved stops.
- Map previews for proposals in another city (by design: they aren't on this map).

## Files

- `server.js`:
  - migration 055; `recOrigin`; origin in the view and schemas;
  - attach on Keep; `prospectiveOf`, `keepProspective`, `keepFromRecommendedPlan`;
  - the web actor for `mcpCall`; proposed mark and note cards; nested stop rows;
  - the proposals column and cards; map rings; the proposed plan page;
  - web routes `/r/:uid/keep`, `/r/:uid/react`, `/o|m/:id/keep`, `/review/...`; `memberDeleteRecord`;
  - children recorded on deletion; composition grouping.
- `public/style.shared.css`, `public/style.modern.css`: the layout grid, the component styles, and the proposed material.
- Tests:
  - `test/increment4.js` (new);
  - `test/fixtures/mcp-contract-v2.56.json` (new);
  - `test/itinerary.js`: RC7, K4d, MC1, MC2, MC9;
  - `test/mcp-contract.js`: v2.56, and a unique recent_notes probe;
  - `test/adoption-pages.js`: explicit Increment 4 folds;
  - `test/adoption-e2e.sh`.
- Docs: this report and `docs/increment4-recommended-design.md`.
