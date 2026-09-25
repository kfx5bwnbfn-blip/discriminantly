---
name: discriminantly-for-another-time
description: After a Discriminantly trip plan is complete, propose exactly three researched future itineraries (same destination another way, another destination with a similar feel, and a considered new direction) saved as recommendations. Use only after the primary plan is finished and verified, unless the member asked for this trip only.
---

# For another time (Discriminantly)

Reconciled release 2.61.0. Used by discriminantly-trip-planning, once, after the primary plan.

## When

- Only after the primary plan is complete and verified.
- Not if the member said this trip only, no more ideas, or ideas are unwanted.
- Once per plan. Check first with `audit_recommendation_expansion` (`origin_itinerary_uid`); if the three already exist, do not write more. Routine edits to the plan never trigger a new set.

## The three

1. The same destination, another dimension (`relation: same_city`).
2. Another destination with analogous enrichment (`relation: similar`).
3. A considered direction grounded in the member's interests (`relation: different`).

Each has specific, researched stops and useful grouping: never an empty seed or a promise to research later. Count only what you present; candidates you researched and rejected are not recommendations.

## Write

1. `record_recommendations` with `kind: itinerary`, `workflow: for_another_time`, `origin_itinerary_uid`, the `relation`, and a short rationale.
2. Add its stops to each recommended plan's target uid with `add_itinerary_stops`; ground specific places with `resolve_travel_mark` (`target_state: recommendation`). A place they already keep is reused, and stays kept.
3. Nothing is visited, owned, booked or endorsed; these stay recommendations until the member keeps one (`keep_recommendation`).
4. Verify with `audit_recommendation_expansion`: all three present, none malformed.

## Present

Only after persistence and verification succeed, add a short continuation headed **For another time** (in the app it appears under Recommended). Do not ask the member to decide anything: the original task is complete.
