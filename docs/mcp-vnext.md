# MCP vNext — capabilities waiting on the MCP surface

A queue of product capabilities that **exist, or are approved, beneath the frozen MCP boundary** but that AI clients can't use yet. It isn't a roadmap: an item goes in only when implemented or approved work actually produces it.

When the freeze lifts:
1. review this list and the domain as actually built;
2. drop anything speculative;
3. merge overlapping operations;
4. design the smallest coherent tool surface;
5. audit semantics and authorisation;
6. implement it, test it in ChatGPT and Claude, and update the Skills.

**The review was cancelled (23 September 2026).** The surface is no longer frozen; v2.55 is prepared as the next submission (`docs/mcp-v2.55-review-readiness.md`). Items below are candidates for after that submission, not blocked by review.

Last updated: 23 September 2026 (v2.55.0: single 61-tool surface).

---

## Stop → Note

**Capability.** A member can attach their own existing Note to an itinerary Stop, detach it, and see attached Notes under their Stop. The relationship means only: *this Note is intentionally associated with this Stop in this plan.*

**Why AI clients need it.** In the itinerary and destination-object Skills, an AI identifies a specific object worth seeking at a stop, such as a particular coffee under a coffee producer. When the member adopts the plan, the AI needs to:
- reuse or create the Note;
- attach it to the Stop;
- read the plan back with its Notes in place.

**Domain operation.**
- `stopNoteAttach(user, stopUid, noteUid, ctx, { origin: 'existing' | 'created' })`
- `stopNoteDetach(user, stopUid, noteUid, ctx)`
- `stopNotesVisible(stopId, me)`
- To create or reuse a Note, compose the existing operations: `findExistingNote()`, then `noteCreate()`, which requires qualifying evidence.

**Likely MCP implication (preliminary).**
- A way to attach an existing or resolved Note, with create-or-reuse, and a way to detach one.
- `my_itineraries` would need child Notes on its stops. That changes the stop result shape, which is frozen and allows no extra fields, and the same shape appears in three other itinerary tools.

**Semantic constraints.**
- Attaching asserts no ownership, purchase, Warrant, Check-in, reservation, availability or experience.
- Only the member's own Notes, on the member's own Stops. A refusal must reveal nothing.
- The canonical Note is reused, never duplicated.
- Attached Notes are visible only to people who can see them.
- AI attachments are recorded as `ai_on_behalf`, with `existing_note` or `new_note`.
- A vague category ("Kona coffee") never becomes a Note.

**Status.** Domain done · web app done (v2.54.0) · **MCP done as additive tools (v2.55.0):** `set_stop_note` attaches or detaches a note, and `list_stop_notes` reads a plan's notes by stop. `my_itineraries` stays unchanged, as submitted.

## Recommendations orbit and Adoption — shipped as additive tools (v2.55.0)

**Done.**
- **Prerequisite:** every submitted corpus read now reads the Adopted projection behind its unchanged contract:
  - `my_notes`, `my_travel_marks`, `my_itineraries` (the list), `search_catalogue`, `catalogue_stats`, `recent_notes` and `my_collections` counts;
  - duplicate detection in `note_object` and `add_travel_mark`.
- **Additive tools:** `record_recommendations`, `resolve_recommendation`, `list_recommendations`, `keep_recommendation` and `dismiss_recommendation`.

**Open follow-ups.**
- **`note_object` on something already recommended.** It makes a separate Kept note, as its contract says. Skills should call `keep_recommendation` instead. Consider whether a future `note_object` should offer to keep the recommended record.
- **The Recommended web surface** (Increment 4).
- **Presentation events** ("presented"): the schema doesn't preclude them.

---

## Common-sense duplicate detection (ontology D2)

**Capability.** Recognise a likely duplicate place within the member's own catalogue, for the catalogue's hygiene. It isn't about reconciling real-world places.

**Why AI clients need it.** Today "Hatchards St Pancras" is refused as a duplicate of "Hatchards", and the AI must retry with `allow_duplicate`. The rule should instead distinguish branches by locality and coordinates.

**Domain operation.** `findSimilarMark()`. Today only `add_travel_mark` uses it; the web app should use the same rule.

**Likely MCP implication.** No new tool. `add_travel_mark` would accept a genuinely different place it currently refuses. That changes behaviour, so it waits.

**Semantic constraints.**
- Within one member's own marks only.
- A name merely containing another isn't enough on its own.
- `allow_duplicate` stays as the escape.
- The "unchanged" result stays as it is.

**Status.** Approved (ontology D2) · **not built**. The web half could ship during the freeze; the AI half waits.

## Tool-result minimisation (from OpenAI's review guidance)

**Capability.** Return only what each request needs.

**Why.** OpenAI's review requirements list timestamps and personal identifiers as data to return only when necessary.
- **Timestamps:** `created_at`, `updated_at` and `since` are returned by up to 10 tools.
- **Other members' handles:** returned by `recent_notes` and `read_comments`.

**Domain operation.** None; this lives in the MCP result formatting only.

**Likely MCP implication.** Make those fields optional in the output schemas and stop returning them where the request doesn't concern time or authorship. They're **required** today, so this is a contract change.

**Semantic constraints.**
- Keep attribution where it's the point, such as who wrote a public comment.
- Keep dates where the member asks about time.

**Status.** Partly done in v2.55: `recent_notes` no longer returns other members' provenance (agent, timestamps). Handles on `recent_notes`/`read_comments` and timestamps elsewhere remain; they are required output fields, so trimming them is a separate contract change. The Privacy page already discloses what assistants receive (v2.54.1).

## `openWorldHint` scope — decision needed

**Capability.** Annotations that match OpenAI's wording exactly.

**Why.** Today, edits and deletions on records that are, or can be, public are marked open-world, such as `delete_checkin` and `update_itinerary_temporal`. OpenAI's wording ties open-world to reaching the internet, or publishing, posting or sending, and sets a bounded private account to false.

**Likely MCP implication.** Keep open-world only for tools that reach the internet or publish, and update the justifications. It reverses v2.52.6.

**Status.** **Brian's decision**, raised again in `docs/mcp-v2.55-review-readiness.md` before resubmission. v2.55 keeps the v2.52.6 reading.

---

## Parked, not queued
These are noted so they aren't lost; they aren't designed and shouldn't be built from here.
- **Unresolved destination objects:** things identified too loosely to become a Note. The likely pattern mirrors unresolved ensemble components. This depends on the recommendation substrate.
- **Integer ids alongside uids** in results. They're functional inputs today, so change them only in a major version.
