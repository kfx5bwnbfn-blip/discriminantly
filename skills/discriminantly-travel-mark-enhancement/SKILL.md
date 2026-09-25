---
name: discriminantly-travel-mark-enhancement
description: Create or enrich a Discriminantly travel mark (a place worth remembering) with the correct identity, official link, address, location, a researched description and a picture. Use when the member asks to add or improve a place, and for every place a Discriminantly trip plan adds.
---

# Travel mark enhancement (Discriminantly)

Reconciled release 2.61.0. Used on its own, or by discriminantly-trip-planning for every place it creates or keeps.

## What to establish

- The exact venue and branch. A chain's other branches, or a namesake in another city, are different places.
- The official page of the venue or operator.
- A supported street address, locality and country.
- Coordinates only from mapping data (`verify_place`) or the member. Never estimate them.
- A useful, factual description in a sentence or two: what it is and why it is worth the visit, with specifics that help (dishes, drinks, departments, collections, experiences).
- A picture of this place, the right branch, where one can be confidently verified.

For bookable experiences, find the actual operator and offering page, not just a category ("manta night snorkel" becomes the operator and its offering). An operator's office is not the departure point unless a source says so.

## How to write it

- New place or one to resolve: `resolve_travel_mark` with `identity_basis` (how you established it: `authoritative_source`, `mapping_provider`, `member_identity`, `stable_external_id`), `target_state` (`canonical` for a place the member keeps or a plan they asked for; `recommendation` for an optional idea), and what you found: `address`, `lat`/`lng` (mapping data only), `link`, `why`, `tags`, `image` or `image_uid`.
- It reuses an existing mark only on an exact identity and fills only empty fields; it never overwrites. On a probable match it returns a candidate and writes nothing: check it and decide.
- If you looked for something and established it does not exist (a street with no website, a branch with no reliable photo), pass it in `unavailable` so it is not treated as undone work. Never list a field you did not look for.
- To correct a wrong or stale value on an existing mark, use `edit_travel_mark`. Correcting identity is different from adding detail: do not use resolution to change which place a mark is.

## What to preserve

- The member's own commentary. Personal words ("my holy grail") are theirs, not a public description of the venue; keep them as they wrote them and write the factual description separately.
- Privacy as it is.
- Existing check-ins, ownership, warrants and good details.
- Enhancement never records a visit or an endorsement.

## Finish

Read the mark back (the `resolve_travel_mark` result, or `my_travel_marks` with a query): check `place_identity`, `location` and `fields`. An unavailable image or map pin after a genuine attempt is acceptable; an empty description when one was researchable is not. Report material limits in a line.
