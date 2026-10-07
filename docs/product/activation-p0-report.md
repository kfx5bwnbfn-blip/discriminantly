# P0 activation and onboarding intelligence (v2.68.0): implementation report

A first-party web and admin increment, built and tested locally. **It is not deployed. Nothing was rescanned and the plugin submission is untouched.** The definitions are in [`activation-model.md`](activation-model.md).

## Baseline

| | |
|---|---|
| Branch | `master` |
| Starting HEAD | `545bdb8` (v2.67.1), clean working tree |
| Resulting HEAD | v2.68.0: `71b6f0b` (the implementation), then the docs and cache commit on top of it |
| App version | v2.67.1 → v2.68.0. Versions live in commit messages; there is no version constant in code. |
| Guards before editing | Static suite 475/475; MCP freeze (OAuth core, MCP routes, discovery, `plugin/`) passing |

Five Skill hashes, before and after (SHA-256 of `SKILL.md`):

| Skill | Hash |
|---|---|
| `discriminantly-trip-planning` | `2d0da7b269d37c8097214c5225eb02a6646e709de5a9eb4fd308e0717e44511f` |
| `discriminantly-destination-objects` | `3ec304eab82ef60569c5d96167f72fb7d670797f9ddf45d38d1758664ce1564e` |
| `discriminantly-for-another-time` | `d965e75e2eb00c4ea2c7439aa8ded5565a8a6b8e4622fc3bad6038287a8da054` |
| `discriminantly-note-enhancement` | `1bf1d1738107c213c60fa6891a18fc458e8e6d17475bd22ef0aa78f5dba3c316` |
| `discriminantly-travel-mark-enhancement` | `2a24acdc8062f47f2d4788a501f2843d2f46b22b6bf0d77798148c31cb3a19e5` |

The whole `skills/` tree hashes to `320f36e2f36bcb0daa20e88ec6681d66ded64fa4cddd042643e821cec2b38a46` before and after.

**Files changed:**

- `server.js`
- `public/style.shared.css`
- `test/activation.js` (new)
- `test/itinerary.js`
- `test/oauth-signup.js` (header comment only)
- `docs/product/activation-model.md` (new)
- this report

No file under `plugin/` or `skills/` changed, and neither did any MCP tool, schema, description, annotation, server instruction, the OAuth core, the MCP routes or discovery.

## Implementation

### 1. Activation-state model

Stages 0–7 are derived on read from canonical tables (§Stages in the model doc). There are **no new tables, columns, migrations or indexes**. A "working session" groups the member's own acts with a 30-minute gap. It is documented as an analysis boundary, not the AI conversation.

### 2. First semantic value

The first kept Note or Mark, or the first kept plan once it has a stop. Suggestions, empty plans, starter copies, page views and connections never count.

### 3. Substantive first value

Either:

- a kept plan with at least two stops, one of them a linked Mark; or
- three or more Notes or Marks kept in one stretch of work.

### 4. Semantic-yield receipt

At the top of All, the member's latest **AI-mediated** working session that produced something durable gets a receipt for 72 hours or until a newer one appears. It is a vector of truthful counts with:

- links to the plan or records;
- AI attribution taken from provenance;
- the compounding promise.

Tiny edits never create one. It is never shown to anyone else and never on the public feed.

### 5. AI → app continuity

Delivered by the same receipt (one surface, not three). It carries the attribution ("Added through ChatGPT / Claude / your AI", plus "and directly in Discriminantly" for mixed sessions), and it covers:

- reused places and things;
- suggestions kept;
- check-ins;
- updates the AI made to existing records.

### 6. State-aware Welcome

| State | Card |
|---|---|
| Nothing kept | The full card, as before, plus "Or add one yourself" |
| Kept but not reused | A compact card ("That's kept." while a receipt is live, otherwise "Use what you've kept.") with three second-act starters |
| Reused | No card |

`/?welcome=1` shows the full card on demand. Connected AIs are never told to install again (unchanged behaviour, now tested).

### 7. Initial intent

Derived from the first starter event that already exists (`starter_selected`, `starter_copied`, `starter_launched`) or a Welcome direct-app link (`empty_state_action`). It maps onto a bounded taxonomy:

- `trip_planning`
- `keep_place`
- `keep_thing`
- `retrieve_existing`
- `plan_from_kept`
- `direct_app`

No new intent event and no survey.

### 8. Event and analytics schema

The existing `product_events` table is reused. There is one new event type, `receipt_viewed`. It is server-side only, keyed by the receipt's session start, deduplicated for 72 hours, and holds no content. New starter keys (`again`, `recall`, `build`) and direct actions (`direct_note`, `direct_mark`, `direct_plan`) ride on the existing starter and action events.

### 9. Time to first value

The admin page reports these TTFV measures:

- account → value;
- connection → value, where the connection came first (OAuth completion → value for plugin arrivals);
- starter → value, where the starter came first;
- account → substantive;
- value → first reuse.

They are segmented by arrival route, first AI client and intent, by cohort, and by first-value type. Percentages appear only when ten or more members are counted.

### 10. Prior-evidence reuse

Four bases:

- `existing_mark_used_in_new_itinerary`
- `existing_mark_reused_across_plans`
- `existing_note_attached_to_new_plan`
- `recommendation_adopted_later`

The earlier record must have been kept **before the later act's working session began**. Each pair counts once. Searches, reads and same-session use never count.

### 11. Intention → experience

Three bases:

- `planned_mark_checked_in_later`
- `kept_mark_checked_in_later` (only for a visit on or after the keep date)
- `planned_note_owned_later`

These are explicit acts only.

### 12. `/admin/activation`

New sections above the existing ones, organic by default, with cohort links (organic / founder-assisted / test / internal / everyone):

- the stage funnel with median times;
- TTFV;
- first-value types;
- first-substantive-session yield (medians and totals);
- reuse bases;
- experience bases;
- segments;
- a member table;
- the limitations.

The member page (`/admin/members/<handle>`) gains an Activation block. All of it is admin-only (403 otherwise).

### 13. Privacy and deletion

- Receipts are computed for the signed-in member from their own acts only.
- The admin pages need the admin account.
- No tokens, prompts or record text are stored in events.
- Events cascade-delete with the account. There's no account-deletion feature yet; deleting a `users` row removes its events, and the derived figures disappear with the records.

### 14. Performance

- **Home page:** two per-render derivations, cached per member against the newest of that member's provenance rows. With 300 places, 30 plans of 10 stops and 4,600 provenance rows, the warm home page median is 69 ms (v2.67.1: 76 ms). The first render after a new act costs about 60 ms more.
- **Admin:** profiles are computed on request; the cost is linear in members.
- **Schema:** no migration, no index.

### 15. Copy

Every new or changed user-facing string:

**Receipt**

- Aside label: "What your AI just added"
- Eyebrow: "Added through ChatGPT" / "Added through Claude" / "Added through your AI", with " and directly in Discriminantly" for mixed sessions, followed by the time ("just now", "5m ago", "3h ago")
- Title: the plan's title, or "Untitled plan", or "Just added"
- Count lines:
  - "N plan(s) kept"
  - "N place(s) kept"
  - "N place(s) you'd already kept, used in this plan" (or "…, used again")
  - "N thing(s) kept"
  - "N thing(s) you'd already kept, placed in this plan" (or "…, placed in a plan")
  - "N suggestion(s) you kept"
  - "N check-in(s)"
  - "N suggestion(s), not yet kept"
  - "N idea(s) for another time"
  - "N of your records updated"
- Note: "Suggested by your AI — not yet kept."
- Promise: "Next time you plan, your AI can start from what you've kept."
- Buttons: "View plan", "View your places", "View your notes"
- Footer: "Only you see this."

**Welcome (full card, Get started)**

- "Or add one yourself: a note · a place · a plan"

**Welcome (compact card)**

- Label "Use what you've kept"
- Eyebrow "Just kept" / "Welcome back"
- Title "That's kept." / "Use what you've kept."
- Subtitle "Next time you plan, your AI can start from what you've kept." / "Your AI can build on the places and things you've already kept."
- Starters:
  - "Plan a trip to [destination], starting from the places I've already kept in Discriminantly." — "A new plan that begins with what you've kept."
  - "What have I kept in Discriminantly for [city]?" — "Find what you kept before you need it."
  - "Build a day around the places I've kept in [city]." — "A day planned from your own places."
- When not connected: "Connect your AI and it can start from what you've kept."
- The direct-app line, as on the full card

**Admin (internal)**

- Section titles:
  - "Activation model"
  - "Time to first value"
  - "What first value was"
  - "Semantic yield of the first substantive session"
  - "Compounding: prior evidence reused"
  - "Intention → experience"
  - "By segment"
  - "Members"
  - "What these measures do not prove"
- Stage names and basis descriptions as in the model doc
- Member activity log entry: "Saw what their AI had just added"

## Tests

**Added: `test/activation.js`, 56 checks, self-contained (it starts its own server).**

- **Welcome states (W1–W10):**
  - direct, ChatGPT and Claude signup;
  - no connection and connected;
  - zero corpus, first value, kept but not reused, reused;
  - on-demand full card;
  - no install prompt for connected members.
- **Receipt (R1–R7, Y1–Y6, C1, C4–C6, S1):**
  - correct counts;
  - new plan with new places;
  - plan with existing places;
  - destination objects;
  - recommendation-only items;
  - exactly three For Another Time plans;
  - tiny edit after creation;
  - 72-hour window;
  - refresh stability;
  - one event per receipt;
  - ChatGPT and Claude attribution;
  - direct-web records (no AI receipt);
  - links;
  - privacy.
- **Reuse (P1–P5, C3, S2):**
  - earlier Mark in a later plan (both bases);
  - earlier Note under a stop;
  - earlier suggestion kept later.
  - Negatives: a search, same-session create-and-use, a duplicate retry, a suggestion kept in the same session.
- **Experience (X1–X3, S3–S4):**
  - a planned place checked in later;
  - a historical visit doesn't count;
  - same-session check-in doesn't count;
  - ownership in the same session doesn't count, and in a later session does.
- **TTFV, cohorts and admin (T1–T7, A1–A4, C2, C7):**
  - account, connection and starter timings;
  - a member who never reaches value;
  - intent never inferred;
  - founder-assisted and admin kept out of organic;
  - small denominators;
  - returned;
  - admin-only access.
- **Privacy (V1–V3):**
  - the public feed shows no receipt;
  - no tokens or record text in events;
  - account deletion removes events.

**Modified: `test/itinerary.js`.**

- WL1 is pinned to the new Welcome placement code.
- The AV1 allow-list gains the cohort classification lines (analysis only).
- New checks:
  - WL5: Welcome mode is derived, not stored;
  - AM1: the model writes nothing;
  - AM2: the reuse time rule;
  - AM3: receipts are AI-mediated and meaningful only;
  - AM4: the receipt is for the signed-in member only.

**Results (all local, 6 Oct 2026):**

| Suite | Result |
|---|---|
| Static `test/itinerary.js` (MF, MC, SK, SW, AV, WL, AM…) | **480/480** |
| MCP freeze guard (`test/mcp-freeze.js`) | **pass** |
| `test/activation.js` | **56/56** |
| `test/oauth-signup.js` | **40/40** |
| Plugin privacy audit `test/plugin-audit.js` (through OAuth) | **20/20** |
| `test/adoption.js` | **73/73** |
| `test/recommendations.js` | **43/43** |
| `test/tool-audit.js` | **29/29** |
| `test/lifecycle.js` | **77/77** |
| `test/increment4.js` | **41/41** |
| `test/place-identity.js` | **45/45** |
| `test/skills-import.js` (Skills over MCP, hashes) | **28/28** |
| Live MCP contract guard, founder connection | **matches the v2.61 snapshot** |
| Live MCP contract guard, another member | **matches the v2.61 snapshot** |
| Historical contract guard | **nothing removed; OAuth, discovery and result shapes unchanged** |
| Page parity, v2.67.1 vs v2.68 on the same upgraded database, 108 views × 3 viewers | **104 identical; 4 differ, all intended** (see below) |

The four page-parity differences are the signed-in owner's and other member's All feeds. Each gains the receipt (the fixture was just written by an AI), and one member's full Welcome becomes the compact card (they have kept something and not reused it). Nothing else differs.

**How the e2e suites were run.** The workspace reset removed the pre-052 commit that `test/adoption-e2e.sh` checks out. The fixture was therefore built with the **v2.52.7** release (also pre-052) and upgraded by current code. Every live suite in that script then ran against the new code, with page parity measured against the v2.67.1 baseline rather than pre-052.

### Contract verification

| Check | Result |
|---|---|
| Tool count | Unchanged (live guard matches the snapshot) |
| Tool contracts (names, schemas, descriptions, annotations, result shapes) | Unchanged (MC static and live) |
| Server instructions | Unchanged (live guard) |
| OAuth protocol fingerprints, MCP routes, discovery, `plugin/` | Unchanged (MF) |
| Skill hashes | Unchanged (identical SHA-256; SK and SI checks pass) |

## Limitations

**What can't currently be observed:**

- AI connection failures or a cancelled OAuth. Instrumenting them would mean changing the frozen OAuth code.
- What an AI searched, read or considered.
- The AI conversation itself (no conversation id).
- Page views.

**What remains inferred rather than proven:**

- The working-session boundary (a 30-minute gap).
- Whether reuse actually improved anything.
- "Returned" as a meaningful return. It requires a semantic act 12 hours or more after first value, which is stricter than a page view but still doesn't prove intent.

**What would need future MCP or Skill changes:**

- A workflow or conversation id on writes, for exact grouping.
- Retrieval-influence signals.
- Skills emitting which kept records they drew on.

**Deferred to P1:**

- Contextual semantic labels on record pages ("Added by ChatGPT for you", "Keeping a place doesn't mean you've visited it").
- A history of past receipts.
- Instrumenting connection failures once the review ends.
- Revisiting the 30-minute gap and the 12-hour return thresholds once there is real data.

**Thresholds that are product decisions, chosen conservatively:**

- 30-minute session gap;
- 12-hour return;
- 72-hour receipt window;
- substantive = 2 stops including a real place, or 3 records in one session;
- compact Welcome never deeper than the fifth own record.

| P0 capability | Implemented | Automated tests | Host test needed? | Deployed | MCP changed | Skills changed |
|---|--:|--:|--:|--:|--:|--:|
| Semantic-yield receipt | Yes | Yes (R, Y, C, S) | Yes: a real ChatGPT/Claude session, then open All | No | No | No |
| State-aware Welcome | Yes | Yes (W1–W10, WL1, WL5) | Light: glance on phone and desktop | No | No | No |
| AI → app continuity | Yes (via the receipt) | Yes | Yes: with the receipt | No | No | No |
| TTFV | Yes | Yes (T1–T5) | No | No | No | No |
| Prior-evidence reuse | Yes | Yes (P, C3, S2, X, S3–S4) | Optional: a second plan from kept places | No | No | No |
