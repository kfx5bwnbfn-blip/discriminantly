# MCP vNext — status after the freeze lifted

The freeze ended when the OpenAI review was cancelled (24 September 2026). This file queued what the freeze held back; nearly all of it has now shipped. What remains is the items parked on purpose.

Last updated: v2.60.2.

## Shipped

| Item | Version | What it is |
|---|---|---|
| Stop → Note through AI | v2.55 | `set_stop_note`, `list_stop_notes` |
| Recommendations orbit and Adoption | v2.55 | `record_recommendations`, `resolve_recommendation`, `list_recommendations`, `keep_recommendation`, `dismiss_recommendation`; submitted reads use the Adopted projection |
| Place identity (P0) and duplicate detection (D2) | v2.58, v2.60 | One place matcher reusing only exact identities, for `add_travel_mark`, recommendation reuse and recommended plans (v2.58) and the web's new-mark form (v2.60) |
| Delegated itinerary authoring | v2.58 | Descriptions for `verify_place`, `add_itinerary_stops`, `resolve_itinerary_stop`, `arrange_itinerary`, `record_recommendations` |
| `resolve_travel_mark`, `audit_itinerary` | v2.58 | Grounded place → mark; read-only plan integrity |
| `build_itinerary`, `audit_recommendation_expansion` | v2.59 | Whole plan in one transaction; For another time check |
| Images and per-field status | v2.59 | present / unavailable / not_attempted |
| Notes duplicate check | v2.60 | The containment bug fixed for things: exact on the same link or title; probable on strong word overlap |
| Result minimisation | v2.60 | Tool results carry dates, not timestamps. Other members' handles stay: attribution is the point of those results. |
| General Keep | v2.60 | `keep_record`: pending-composition pieces, survivors, recommended records |
| Leftover clean-up | v2.60 | `clear_prospective_leftovers`: explicit, lists by default, deletes only with confirm |
| Stop place snapshot | v2.60 | Stops keep their place's city and country after the mark is deleted |
| Retry safety | v2.60 | `create_itinerary` and `add_itinerary_stops` return what was just made on a retry within 120 s |
| `upload_image` wording | v2.60 | Points at `begin_image_upload` |

## Decided: `openWorldHint` scope (closed 25 September 2026)

**Kept: the v2.52.6 reading.** A tool is open-world when it reaches the public internet or can change what the public sees, including editing or deleting content on a record that is or can be public. OpenAI's wording lists examples ("includes… publish content"); editing or removing a public note changes a public platform's published state, so it stays open-world. Over-declaring caution is the safer error: reviewers reject annotations that under-state behaviour. Closed-world stays exactly the reads plus writes confined to data that is never public (the SW1 test pins the list). Narrowing would have flipped about 18 tools and every justification with no product gain.

## Parked, not queued

- **Integer ids alongside uids** in results: functional inputs today; change only in a major version.
- **Unresolved destination objects:** largely covered by recommendations' unresolved and partial states; revisit only if dogfooding shows a gap.
- **Codex test runs** (operational): if a submission includes Codex, run the test prompts there.
