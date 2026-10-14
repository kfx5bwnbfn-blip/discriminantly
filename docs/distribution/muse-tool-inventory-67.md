# Appendix: complete Muse tool inventory (67 tools)

`https://muse.discriminantly.com/mcp` serves all 67 tools to every full-access key. A read-only key can call only the 18 Read tools; every other call is refused before it runs. The 26 tools in the main packet are the **review-priority subset**, not a filtered surface.

Generated from the production source (commit 476cb90, `TOOL_ANNOTATIONS` in server.js), the same annotations served in `tools/list` and reviewed by OpenAI.

**Rule:**
- **Sensitive write:** annotated `destructiveHint: true` (deletes, or overwrites with no copy kept), or by default communicates or publishes to other people in the member’s name.
- **Write (publishes by default):** creates or changes records that are public unless the member says private; reversible.
- **Write:** changes only the member’s own records, with no external effect.

| Class | Count |
|---|---|
| Read | 18 |
| Write | 25 |
| Write (publishes by default) | 5 |
| Sensitive write | 19 |
| **Total** | **67** |

| Tool | Title | Class | readOnlyHint | destructiveHint | Basis |
|---|---|---|---|---|---|
| `my_notes` | List my notes | Read | true | false | Reads only; changes nothing. |
| `my_travel_marks` | List my travel marks | Read | true | false | Reads only; changes nothing. |
| `my_collections` | List my collections | Read | true | false | Reads only; changes nothing. |
| `my_itineraries` | List or open my itineraries | Read | true | false | Reads only; changes nothing. |
| `search_catalogue` | Search my catalogue | Read | true | false | Reads only; changes nothing. |
| `catalogue_stats` | Count what is in my catalogue | Read | true | false | Reads only; changes nothing. |
| `recent_notes` | Recent notes across Discriminantly | Read | true | false | Reads only; changes nothing. |
| `list_ensembles` | List my ensembles | Read | true | false | Reads only; changes nothing. |
| `get_ensemble` | Open an ensemble | Read | true | false | Reads only; changes nothing. |
| `list_unresolved_components` | List unidentified ensemble pieces | Read | true | false | Reads only; changes nothing. |
| `list_checkins` | List check-ins on a travel mark | Read | true | false | Reads only; changes nothing. |
| `read_comments` | Read comments | Read | true | false | Reads only; changes nothing. |
| `view_images` | View images from my catalogue | Read | true | false | Reads only; changes nothing. |
| `verify_place` | Look up a place in map data | Read | true | false | Read. Sends the place query to the map search service (open world). |
| `list_recommendations` | List recommendations | Read | true | false | Reads only; changes nothing. |
| `list_stop_notes` | List a plan’s stop notes | Read | true | false | Reads only; changes nothing. |
| `audit_itinerary` | Check an itinerary is complete | Read | true | false | Reads only; changes nothing. |
| `audit_recommendation_expansion` | Check For another time proposals | Read | true | false | Reads only; changes nothing. |
| `record_note_ownership` | Record that I own this | Write | false | false | Private; never shown to others or posted. Append-only, reversible. |
| `release_note_ownership` | Record that I no longer own this | Write | false | false | Private; append-only, reversible. |
| `create_itinerary` | Start an itinerary | Write | false | false | Private by default. |
| `add_itinerary_stops` | Add stops to an itinerary | Write | false | false | Visible to others only on a shared or published plan. |
| `resolve_itinerary_stop` | Link a stop to a travel mark | Write | false | false | Changes the member’s own records; no external effect. |
| `set_primary_artifact` | Choose an ensemble’s main image | Write | false | false | Changes the member’s own records; no external effect. |
| `revoke_warrant` | Withdraw a warrant | Write | false | false | Withdraws a public endorsement; private history kept. |
| `correct_note_ownership_mistake` | Withdraw a mistaken ownership record | Write | false | false | Private; appends a superseding record, nothing deleted. |
| `create_pending_ensemble` | Stage an ensemble | Write | false | false | Private staging until kept. |
| `add_ensemble_artifact` | Add an image to an ensemble | Write | false | false | Changes the member’s own records; no external effect. |
| `add_ensemble_component` | Add a piece to an ensemble | Write | false | false | Changes the member’s own records; no external effect. |
| `resolve_ensemble_component` | Identify an ensemble piece | Write | false | false | Changes the member’s own records; no external effect. |
| `upload_image` | Save an image | Write | false | false | Private until used. |
| `begin_image_upload` | Start sending an image | Write | false | false | Changes the member’s own records; no external effect. |
| `upload_image_chunk` | Send part of an image | Write | false | false | Changes the member’s own records; no external effect. |
| `start_image_upload` | Start sending an image (compatibility) | Write | false | false | Changes the member’s own records; no external effect. |
| `finish_image_upload` | Finish sending an image (compatibility) | Write | false | false | Changes the member’s own records; no external effect. |
| `record_recommendations` | Record recommendations | Write | false | false | Changes the member’s own records; no external effect. |
| `resolve_recommendation` | Resolve a recommendation | Write | false | false | Changes the member’s own records; no external effect. |
| `keep_recommendation` | Keep a recommendation | Write | false | false | The record stays private; adds it to the member’s kept corpus. |
| `dismiss_recommendation` | Dismiss a recommendation | Write | false | false | Hides a suggestion; no external effect. |
| `set_stop_note` | Attach or detach a stop note | Write | false | false | Visible to others only on a public plan. |
| `resolve_travel_mark` | Resolve a place into a travel mark | Write | false | false | Changes the member’s own records; no external effect. |
| `build_itinerary` | Build an itinerary in one step | Write | false | false | Private by default. |
| `keep_record` | Keep a note or travel mark | Write | false | false | Changes the member’s own records; no external effect. |
| `note_object` | Add a note | Write (publishes by default) | false | false | Public unless private:true. Reversible (make private, or delete). |
| `add_travel_mark` | Add a travel mark | Write (publishes by default) | false | false | Public unless private:true. Reversible (make private, or delete). |
| `re_note` | Re-note another member’s note | Write (publishes by default) | false | false | Public unless private:true. Reversible. |
| `log_visit` | Check in at a travel mark | Write (publishes by default) | false | false | A check-in on a public mark is public, so it discloses a dated visit. Reversible with delete_checkin. |
| `keep_ensemble` | Keep a staged ensemble | Write (publishes by default) | false | false | Publishes the composition only with private:false; pieces kept as notes are private. |
| `comment` | Comment on a note or mark | Sensitive write | false | false | Posts under the member’s name on another member’s note or mark, visible to others; no delete through MCP. |
| `warrant` | Warrant (stand behind) something | Sensitive write | false | false | Public endorsement, announced to the feed by default on public records (announce:false is quiet). Reversible with revoke_warrant. |
| `arrange_itinerary` | Arrange an itinerary’s days | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `edit_note` | Edit a note | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `edit_travel_mark` | Edit a travel mark | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `edit_checkin` | Edit a check-in | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `update_itinerary` | Edit or publish an itinerary | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. Can also publish a plan (private:false). |
| `update_itinerary_temporal` | Change itinerary dates or times | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `update_itinerary_stop` | Edit an itinerary stop | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `edit_ensemble` | Edit an ensemble | Sensitive write | false | true | Annotated destructive: overwrites what was there, with no copy kept. |
| `delete_note` | Delete a note | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `delete_travel_mark` | Delete a travel mark | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `delete_checkin` | Delete a check-in | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `delete_itinerary_entity` | Delete an itinerary, day or stop | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `delete_ensemble` | Delete an ensemble | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `discard_ensemble` | Discard a staged ensemble | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `remove_ensemble_artifact` | Remove an ensemble image | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `remove_ensemble_component` | Remove an ensemble piece | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
| `clear_prospective_leftovers` | Clear unused suggestions | Sensitive write | false | true | Annotated destructive: deletes or removes records; irreversible. |
