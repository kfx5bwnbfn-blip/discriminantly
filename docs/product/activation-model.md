# Activation model (v2.68)

How Discriminantly measures whether a member got value, came back, and whether what they kept earlier took part in something later. This is internal product analysis, not something members see as an achievement.

The loop being measured: **capture → application → experience → reuse**.

## Ground rules

- Everything is **derived on read from the canonical tables**: `adoptions`, `provenance`, `itinerary_stops`, `itinerary_stop_notes`, `recommendations`, `visits`, `ownership_assertions`, `connections`, `users`, plus the existing `product_events` for declared intent.
- Nothing is stored for analysis. There is no first-value timestamp column, no reuse table and no "onboarding complete" flag. Retries, refreshes and deletions can't leave stale or duplicated figures, because every figure is recomputed from the records.
- The activation code writes nothing. It makes no `INSERT`, `UPDATE` or `DELETE`, and never calls provenance or adoption writers; static test AM1 enforces this. The one write on this path is the bounded `receipt_viewed` product event, recorded once per receipt.
- Analytics never become semantic evidence:
  - A starter is not a preference.
  - A recommendation is not Kept.
  - Keep is not Owned.
  - A plan stop is not a visit.
  - A check-in is not an endorsement.
  - Repeated use is not a Warrant.

## Working session

A **working session** is the member's own acts, separated by pauses of more than **30 minutes**. An act is a provenance row whose actor is the member, whether directly on the web or through an AI acting on their behalf.

- It's a product-analysis boundary only.
- It is **not** the AI conversation. No client sends a conversation identifier, so none is claimed.
- One conversation could span two sessions after a long pause, and two conversations close together could fall into one session.

## Stages

| # | Stage | Exact rule |
|---|---|---|
| 0 | Account created | A `users` row exists. Not activation. |
| 1 | AI connected | At least one `connections` row. This is setup, not value; a web-only member can skip it. |
| 2 | First semantic value | The earliest of: the first kept Note or Mark (from the Adoption time), or the first kept plan once it has at least one stop (the later of the keep time and the first stop's time). An empty plan, a suggestion, a starter copy, a page view or a connection never counts. |
| 2b | First substantive artifact | The earliest of: **(a)** a kept plan with at least two stops, at least one of them a linked Mark (a real place), timed when both conditions first held; or **(b)** one stretch of work, with gaps of 30 minutes or less, that kept three or more Notes or Marks, timed at the third. |
| 3 | Accumulating | Kept records from at least two separate stretches of work. Reported with the number of evidence types: notes, marks, plans, check-ins, ownership, warrants, recommendations. Not a success threshold. |
| 4 | Returned | A semantic act in a working session that starts **12 hours or more after first value**. Signing in again in that window is shown separately, as a weaker signal. A page view or refresh is never a return. |
| 5 | Prior evidence reused | The first reuse event (see below). |
| 6 | Intention became experience | The first experience event (see below). Explicit acts only. |
| 7 | Further reuse | A reuse event in a later working session than the first reuse. |

The furthest stage reached is shown per member. The stages aren't strictly sequential: for example, an experience can occur without reuse.

## Prior-evidence reuse

The central compounding signal. **Only durable relationships count.** For every basis, the earlier record must have been **kept before the working session of the later act began**, so a record made and used in the same session is never reuse. Each (basis, later record, earlier record) pair counts once, so retries and duplicate stops don't inflate it.

| Basis | Relationship |
|---|---|
| `existing_mark_used_in_new_itinerary` | A Mark kept earlier is linked to a stop in a kept plan. The link time is the stop's creation, or a later resolution that set its Mark. |
| `existing_mark_reused_across_plans` | As above, when the Mark was already on a stop in a different kept plan before that session. |
| `existing_note_attached_to_new_plan` | A Note kept earlier is placed under a stop of a kept plan. |
| `recommendation_adopted_later` | A recommendation made in an earlier session is kept, recorded by the adoption provenance that cites it. One event per recommendation, even when keeping a plan keeps several records. |

**Not reuse:**

- A search, a read or a retrieval.
- A record that merely exists.
- Something the AI mentioned without a durable relationship.
- A suggestion shown and ignored.
- Anything created and used in the same session.
- A page view.

## Intention → experience

| Basis | Relationship |
|---|---|
| `planned_mark_checked_in_later` | A check-in recorded in a later session than the stop linking that place in a kept plan, for a visit on or after the day it was planned. |
| `kept_mark_checked_in_later` | A check-in recorded in a later session than the place was kept, for a visit on or after the day it was kept. A visit logged from before the place was kept is history, not experience. |
| `planned_note_owned_later` | Ownership marked in a later session than the Note was placed in a plan. |

Keeping a Note and marking it owned later isn't counted. Ownership is often recorded when a member is simply tidying up, and whether the Note expressed an intention isn't recorded anywhere.

## Time to first value

All durations are measured only for members who reached first value.

- **Account → value:** first value minus `users.created_at`.
- **Connection → value:** first value minus the first connection, only where the connection came first. For ChatGPT-originated accounts this is OAuth completion → value.
- **Starter → value:** first value minus the first starter event, only where the starter came first.
- **Account → substantive** and **first value → first reuse** are also reported.

They can be segmented by:

- arrival route (`signup_source`);
- first AI client;
- initial intent;
- cohort.

Percentages appear only when ten or more members are counted; below that, counts are shown as "k of n".

## Initial intent

The first starter the member chose is their declared intent: one they copied, opened in Claude Desktop, or picked before connecting. A direct "add one yourself" link on the Welcome card also counts.

| Starter or action | Intent |
|---|---|
| `plan` | `trip_planning` |
| `place` | `keep_place` |
| `thing` | `keep_thing` |
| `show`, `resume`, `recall` | `retrieve_existing` |
| `again`, `build` | `plan_from_kept` |
| `direct_note`, `direct_mark`, `direct_plan`, `add_place`, `start_plan` | `direct_app` |

There is no survey. When no starter was chosen there is no intent, and none is inferred. Intent is product evidence only: never a preference, taste evidence, a recommendation or a permanent category.

## Cohorts

| Cohort | Who |
|---|---|
| `organic` | Everyone not in another cohort. The admin page shows this by default. |
| `founder_assisted` | `users.research_flag`, set on `/admin/activation`. |
| `test` | `users.research_flag`. Use this for the OpenAI reviewer account. |
| `internal` | `users.is_admin`. Classification only: it grants nothing and changes nothing a member sees. |

## The semantic-yield receipt

What one AI-mediated working session produced, as a vector of truthful counts:

- plans kept;
- places kept (new);
- places already kept, reused in a plan;
- things kept (new);
- things already kept, placed in a plan;
- suggestions kept;
- check-ins;
- suggestions not yet kept, with ideas for another time counted separately;
- existing records the AI updated.

**What counts:**

- Records the session created count as new only if they were kept within that session.
- Recommendation-only records are suggestions, never "kept".
- Pre-existing records are counted as reused, never as new.

**Rules:**

- **Appears** when the latest AI-mediated session, within 72 hours, produced something durable: anything kept, any reuse, a thing placed under a stop, two or more suggestions, a suggestion kept, or a check-in. Edits, typo fixes, image changes and re-timings alone never create one. A tiny edit after a meaningful session leaves the earlier receipt in place.
- **Where:** the top of All, in the single editorial slot. Today's plan takes precedence, then the receipt, then resurfacing.
- **For how long:** 72 hours after the session's last act, or until a newer meaningful session replaces it.
- **On refresh:** the same receipt, since it is derived.
- **Later:** the receipt itself isn't stored or listed anywhere. The records it pointed to stay where they always are.
- **With Welcome:** it can appear alongside the compact Welcome card ("That's kept.").
- **Privacy:** computed only for the signed-in member, from their own acts; never on profiles, the public feed or anyone else's page.
- **Attribution:** comes from provenance `agent` (ChatGPT, Claude; "your AI" for clients that declared no name or used the legacy token), never from text. "Added through ChatGPT" doesn't imply endorsement.
- **Event:** `receipt_viewed` is recorded once per receipt (keyed by its session's start, deduplicated for 72 hours) with no content.

## Welcome lifecycle

Chosen from durable state on every render:

| State | Card |
|---|---|
| Nothing kept (A: not connected; B: connected) | The full three-step card. It opens on Orientation when nothing is connected, and on Get started when an AI is connected or the account came through ChatGPT. Connected AIs are shown as connected, never with install steps. |
| Something kept, nothing reused (C: an AI receipt is active; D: otherwise) | A compact card with three second-act starters and the direct-app links, placed under the member's own records but never deeper than their fifth. |
| Prior evidence reused (E) | No Welcome card. The member has been through the loop. |

`/?welcome=1` shows the full card at the top on demand; the compact card's "Connect your AI" link uses it.

## Cost

- **The member's home page** does two derivations per render:
  - "has this member reused" (it decides the Welcome card);
  - the receipt (provenance since about 78 hours ago, through the `actor_user_id` index).
- **Caching:** both are cached in memory per member against the newest of that member's provenance rows, with a 60-second limit for the receipt and 6 hours for reuse. The cache is rebuilt on any new act, and on restart.
- **Measured** on a member with 300 places, 30 plans of 10 stops and 4,600 provenance rows: home page median 69 ms against 76 ms for v2.67.1 when warm. The first render after a new act costs about 60 ms more.
- **The admin page** computes every member's profile on request; that's fine at beta scale, and the cost grows linearly with members.
- **Schema:** no migration and no new index.

## What these measures do not prove

- Reuse proves an earlier record became part of a later one. It doesn't prove the AI chose it because of the member's taste, or that it made the plan better.
- A search or retrieval never counts; there is no durable trace of what an AI read or considered.
- A first plan proves something was kept, not that the member was satisfied.
- A check-in proves a visit was recorded, not that the place was liked. Keeping a suggestion doesn't mean it was experienced.
- None of these measures is personalization success, taste accuracy or recommendation quality.

## Event semantics

| Kind | Examples |
|---|---|
| Direct observation (canonical) | Adoption, provenance, stops, stop notes, check-ins, ownership, connections, accounts |
| Derived state (this model) | Working sessions, first value, substantive artifact, accumulating, returned, reuse, experience, TTFV, receipt |
| Analytics instrumentation (`product_events`) | Starters (`starter_selected`, `starter_copied`, `starter_launched`), `empty_state_action`, `welcome_viewed`, `welcome_tab_viewed`, `signed_in`, `signup_*`, `receipt_viewed` |

Product events are private operational data:

- They hold bounded, sanitised keys only: no prompts, record text, tokens or connector URLs.
- They are deleted with the account (FK cascade).
- There is no account-deletion feature yet. Removing a `users` row removes its events, and the derived figures disappear with the records.

## Signal inventory

| Signal | Canonical state | Derivable | Requires event | Missing |
|---|:-:|:-:|:-:|:-:|
| Signup, source | `users` | | | |
| Campaign / referrer, AI client host | `signup_context` | | | |
| Founder / test marker | `users.research_flag` | | | |
| AI connection | `connections` | | | |
| Connection failure / OAuth cancelled | | | | ✓ (OAuth code frozen) |
| First Note / Mark / plan | `adoptions` | ✓ | | |
| Substantive artifact | stops + `adoptions` | ✓ | | |
| AI client per act | `provenance.agent` | | | |
| Working session | | ✓ (provenance times) | | conversation id |
| Recommendations, kept later | `recommendations`, adoption provenance | ✓ | | |
| Stop → Mark / Note links | stops, stop notes, provenance | ✓ | | |
| Check-in / Ownership | `visits`, `ownership_assertions` | ✓ | | |
| Return (acted) | provenance | ✓ | | |
| Return (signed in) | `sessions` | ✓ | | page views (not tracked) |
| Starter intent | | | `product_events` | |
| Receipt seen | | | `receipt_viewed` | |
| What an AI searched / read | | | | ✓ (would need MCP change) |
