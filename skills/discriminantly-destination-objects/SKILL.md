---
name: discriminantly-destination-objects
description: Suggest one to three specific objects worth seeking on a trip (a local coffee, a maker's knife, a tailor's tie), resolved as far as evidence allows and tied to the right stop. Use within a Discriminantly trip plan when objects belong to the destination and the member's interests; not a generic shopping guide.
---

# Destination objects (Discriminantly)

Reconciled release 2.61.0. Used by discriminantly-trip-planning.

## Choose

Normally one to three objects, genuinely tied to the destination, the member's interests and the stops in the plan. Relevance to a place is not proof it is in stock there: never promise availability.

## Resolve as far as evidence allows

category → maker or producer → product → variant or SKU where meaningful → canonical product page → the purveyor or stop.

A named product with its page can be enough; do not invent a SKU that does not exist. When resolution stops early, keep what you know rather than discarding it or fabricating the rest.

## Write

- Objects the member asked to include in a plan they asked you to build: create or reuse the note (apply discriminantly-note-enhancement), then attach it to its stop with `set_stop_note`. A kept plan takes only a kept note.
- Optional objects you suggest alongside: record them as recommendations with `record_recommendations` (`workflow: destination_objects`, `context_itinerary_uid`, `context_stop_uid`, the resolution you actually reached, a short rationale). They stay recommendations until the member keeps them (`keep_recommendation`).
- Never keep a recommendation just to satisfy an attachment, and never infer ownership from keeping.

## Verify

Read back with `list_stop_notes` for the plan and check each note and its stop.
