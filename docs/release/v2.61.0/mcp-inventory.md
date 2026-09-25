# MCP inventory — v2.61.0

67 tools; 5 skills over the Skills extension. Generated from the live server by scripts/release-readout.js; the complete schemas are in mcp-manifest.json.

| Tool | Title | read-only | destructive | open-world | Required inputs | Domain functions |
|---|---|---|---|---|---|---|
| `note_object` | Add a note | false | false | true | headline, image | findSimilarNote, keepRecommendedRecord, noteCreate, recommendedRecordFor, resolveAssetRef |
| `my_collections` | List my collections | true | false | false | — | provenanceOf |
| `recent_notes` | Recent notes across Discriminantly | true | false | false | — | alreadyRenoted, provenanceOf |
| `my_notes` | List my notes | true | false | false | — | equivalentNotes, ownedState, provenanceOf, warrantState |
| `edit_note` | Edit a note | false | true | true | id | discardStoredImage, ingestImage, recordProvenance, resolveAssetRef, setCollections, verifyStoredImage |
| `create_pending_ensemble` | Stage an ensemble | false | false | true | title, components | — |
| `keep_ensemble` | Keep a staged ensemble | false | false | true | id | componentIdentityBasis, ensComponents, ensembleKeepAdoptsLinked, findExistingNote, noteCreate, recordProvenance, verifyEnsembleAssets |
| `get_ensemble` | Open an ensemble | true | false | false | id | ensembleView, imageBlock |
| `list_ensembles` | List my ensembles | true | false | false | — | ensComponents |
| `add_ensemble_artifact` | Add an image to an ensemble | false | false | true | id | recordProvenance, resolveAssetRef |
| `set_primary_artifact` | Choose an ensemble’s main image | false | false | true | id, artifact_uid | recordProvenance |
| `remove_ensemble_artifact` | Remove an ensemble image | false | true | true | id, artifact_uid | recordProvenance |
| `add_ensemble_component` | Add a piece to an ensemble | false | false | true | id, label | assertKeptChild, findExistingNote, resolveAssetRef, saveEnsembleComponents |
| `remove_ensemble_component` | Remove an ensemble piece | false | true | true | component_uid | recordProvenance |
| `resolve_ensemble_component` | Identify an ensemble piece | false | false | true | component_uid | assertKeptChild, noteCreate, recordProvenance |
| `list_unresolved_components` | List unidentified ensemble pieces | true | false | false | — | — |
| `edit_ensemble` | Edit an ensemble | false | true | true | id | dropPendingEnsembleNotes, recordProvenance |
| `discard_ensemble` | Discard a staged ensemble | false | true | true | id | notesSafeToDiscard, recordProvenance |
| `delete_ensemble` | Delete an ensemble | false | true | true | id | — |
| `re_note` | Re-note another member’s note | false | false | true | id | alreadyRenoted, renoteFrom |
| `delete_note` | Delete a note | false | true | true | id | recordProvenance, temporalFormat |
| `record_note_ownership` | Record that I own this | false | false | false | id | assertOwned |
| `release_note_ownership` | Record that I no longer own this | false | false | false | id | correctOwned, ownedState, releaseOwned |
| `correct_note_ownership_mistake` | Withdraw a mistaken ownership record | false | false | false | id | — |
| `warrant` | Warrant (stand behind) something | false | false | true | subject_type, id | assertWarrant, revokeWarrant, warrantState |
| `revoke_warrant` | Withdraw a warrant | false | false | true | subject_type, id | — |
| `edit_travel_mark` | Edit a travel mark | false | true | true | id | markPrivacyChanged, recordProvenance, setMarkCollections |
| `delete_travel_mark` | Delete a travel mark | false | true | true | id | recordProvenance |
| `begin_image_upload` | Start sending an image | false | false | false | mime, total_bytes, data | ingestDirective |
| `upload_image_chunk` | Send part of an image | false | false | false | upload_id, index, data | — |
| `start_image_upload` | Start sending an image (compatibility) | false | false | false | mime, total_bytes | — |
| `finish_image_upload` | Finish sending an image (compatibility) | false | false | false | upload_id | — |
| `view_images` | View images from my catalogue | true | false | false | image_uids | imageBlock |
| `read_comments` | Read comments | true | false | false | id | — |
| `comment` | Comment on a note or mark | false | false | true | id, body | assertAdoptedFor, recordProvenance |
| `upload_image` | Save an image | false | false | true | image | discardStoredImage, ingestDirective, ingestImage, provenanceOf, storeImage, verifyStoredImage |
| `verify_place` | Look up a place in map data | true | false | true | query | json |
| `add_travel_mark` | Add a travel mark | false | false | true | place | keepRecommendedRecord, markCreate, matchPlace, recommendedRecordFor, recordProvenance, visitRecord |
| `log_visit` | Check in at a travel mark | false | false | true | id | prettyRange, visitRecord |
| `list_checkins` | List check-ins on a travel mark | true | false | false | mark_id | provenanceOf |
| `edit_checkin` | Edit a check-in | false | true | true | id | applyVisitDays, daysExcludedBy, normaliseVisitRange, prettyRange, recordProvenance |
| `delete_checkin` | Delete a check-in | false | true | true | id | recordProvenance |
| `my_travel_marks` | List my travel marks | true | false | false | — | locationOf, placeIdentityOf, provenanceOf, warrantState |
| `search_catalogue` | Search my catalogue | true | false | false | query | ownedState, provenanceOf, warrantState |
| `catalogue_stats` | Count what is in my catalogue | true | false | false | — | — |
| `create_itinerary` | Start an itinerary | false | false | true | title | itineraryCreate, temporalFormat |
| `add_itinerary_stops` | Add stops to an itinerary | false | false | true | itinerary_uid, stops | itinOwned, stopAdd |
| `update_itinerary` | Edit or publish an itinerary | false | true | true | itinerary_uid | itinOwned, itineraryEdit, itineraryPublish, itineraryUnpublish |
| `update_itinerary_temporal` | Change itinerary dates or times | false | true | true | target, uid | temporalConflicts, temporalFormat |
| `arrange_itinerary` | Arrange an itinerary’s days | false | true | true | itinerary_uid | groupConflicts, groupCreate, groupOrder, groupSetPosition, itinOwned, stopSetGroup, stopSetPosition, temporalFormat |
| `resolve_itinerary_stop` | Link a stop to a travel mark | false | false | true | stop_uid | stopResolveToMark, stopUnresolve |
| `update_itinerary_stop` | Edit an itinerary stop | false | true | true | stop_uid | stopEdit, stopOwned, stopRestore, stopSetResolution, stopSuspend |
| `delete_itinerary_entity` | Delete an itinerary, day or stop | false | true | true | kind, uid | groupDelete, itineraryDelete, stopDelete |
| `my_itineraries` | List or open my itineraries | true | false | false | — | groupConflicts, groupOrder, itinOwned, temporalFormat |
| `record_recommendations` | Record recommendations | false | false | true | items | — |
| `resolve_recommendation` | Resolve a recommendation | false | false | true | recommendation_uid | recommendationCreate, recommendationResolve, recommendationView, resolveAssetRef |
| `list_recommendations` | List recommendations | true | false | false | — | recommendationsList |
| `keep_recommendation` | Keep a recommendation | false | false | true | recommendation_uid | recommendationKeep, recommendationView |
| `dismiss_recommendation` | Dismiss a recommendation | false | false | false | recommendation_uid | recommendationDismiss, recommendationView |
| `set_stop_note` | Attach or detach a stop note | false | false | true | stop_uid, note_uid | itinOwned, stopNoteAttach, stopNoteDetach, stopNotesVisible |
| `list_stop_notes` | List a plan’s stop notes | true | false | false | itinerary_uid | — |
| `resolve_travel_mark` | Resolve a place into a travel mark | false | false | true | place, identity_basis, target_state | resolveAssetRef, resolveTravelMark |
| `audit_itinerary` | Check an itinerary is complete | true | false | false | itinerary_uid | auditItinerary |
| `audit_recommendation_expansion` | Check For another time proposals | true | false | false | origin_itinerary_uid | auditRecommendationExpansion |
| `build_itinerary` | Build an itinerary in one step | false | false | true | title | buildItinerary |
| `keep_record` | Keep a note or travel mark | false | false | true | type, uid | keepRecord |
| `clear_prospective_leftovers` | Clear unused suggestions | false | true | false | — | memberDeleteRecord, prospectiveLeftovers |

## Descriptions

### `note_object`

Post a new note to discriminant.ly as the connected member. Use when the user wants to note, log, bookmark or post a fine object. If that thing was already recommended to them, its existing record is kept instead of a duplicate being made.

Inputs: `headline` (required), `description`, `tags`, `link`, `image` (required), `collections`, `private`, `allow_duplicate`. Output schema: declared.

### `my_collections`

List the member's collections with a count of what is in each. Collections are how the member groups their own notes and travel marks — names they chose, not categories the system assigns. Read this BEFORE filing anything, so you reuse the exact existing name instead of creating a near-duplicate, and whenever the member asks what they have grouped. Note collections and mark collections are separate; `kind` says which.

Inputs: none. Output schema: declared.

### `recent_notes`

List the most recent public notes on discriminant.ly (all members). Each entry carries `already_renoted`: the notes this member has ALREADY made from that one with re_note. It is informational only — never a reason to refuse, to ask for confirmation, or to treat the action as blocked. If the member wants another, re-note again; repeated re-notes are valid and each becomes its own note. Optional search query.

Inputs: `query`, `limit`. Output schema: declared.

### `my_notes`

List the connected member's own notes. `equivalent_notes` lists Notes this member has explicitly said are the same thing, each with its `basis`: 'user' means they said so themselves, 'external' means an outside identifier supports it. Both are canonical; neither is a guess. Inferred similarity is never included here. Each note carries the member's private `owned` state and their `warrant` state. state:null on either means they have never said anything either way — that is NOT a negative judgement and must not be read as one. 'released' means they owned it before; 'revoked' means they warranted it before and withdrew.

Inputs: `limit`. Output schema: declared.

### `edit_note`

Edit one of the connected member's own notes. Only pass the fields being changed — anything omitted is left as is.

Inputs: `id` (required), `headline`, `description`, `tags`, `link`, `image`, `collections`, `private`. Output schema: declared.

### `create_pending_ensemble`

Stage a visual composition of several things as an Ensemble. When the member says something like "ensemble these", do the WHOLE sequence without asking them for technical steps — they should never have to mention uploading, encoding or ids. (1) Look at each constituent. IF A CONSTITUENT IS ALREADY ONE OF THEIR NOTES OR MARKS, its picture is already here: read its image_uid from my_notes / my_travel_marks / search_catalogue and call view_images to see it. Do NOT ask the member to attach a picture of something they have already noted, and do NOT upload it again — that uid is ready to use as-is. (2) Generate the composited image yourself with your own image generation; discriminant.ly does not generate it. Show it to them. (3) Only images that are NOT yet in discriminant.ly — a fresh attachment, or the composition you just generated — need ingesting, one at a time, keeping each returned image_uid: for a local or generated file call begin_image_upload with the first slice of its bytes and keep calling upload_image_chunk until the reply comes back with status "stored"; for an image already at a public https:// URL, upload_image with that URL is enough. Never pause for the member between slices. (4) Call THIS tool with those uids in `image_uid` / `artifact_uid`: no picture data belongs in this call. (5) Only once this call has returned pending_review, tell the member it is staged and ask whether to keep or discard it — then call keep_ensemble or discard_ensemble with the id returned here. Do not stop after generating the composition, and do not ask keep/discard before this call has actually succeeded: until it does, nothing exists on discriminant.ly and saying otherwise would be untrue. If an upload fails, fix or report THAT step — never proceed to this tool with a missing image. What this creates is PENDING REVIEW: durable and private to the member, not yet in their catalogue, and nothing reaches their notes until they choose keep. IMAGES: prefer `artifact_uid` and `image_uid` — those bytes are already stored, so nothing is fetched, re-encoded or copied again. `artifact` / `image` still accept an https:// URL (or a small data: URL) if you genuinely have not uploaded separately. Every image must resolve; the call fails rather than saving a composition with a missing piece.

Inputs: `title` (required), `description`, `artifact_uid`, `artifact`, `components` (required). Output schema: declared.

### `keep_ensemble`

Call this when the member says yes to a staged composition — "keep it", "save it", "yes". Use the ensemble id from the create_pending_ensemble result you already have; do not ask them for it. This moves the Ensemble from pending_review to saved, and it is the moment their catalogue changes: clearly identified pieces become notes (PRIVATE by default), pieces already in their notes are reused rather than duplicated, and anything uncertain stays unidentified. Returns a structured result naming exactly which notes were created and which were reused, so you can tell them truthfully what happened. Safe to call twice — an Ensemble already kept is left alone.

Inputs: `id` (required), `private`. Output schema: declared.

### `get_ensemble`

Retrieve one Ensemble in full — its title and description, every generated image with a record of what went into it, and the current state of each constituent. The actual pictures come back with the result: the current composition first, then any alternate versions, then images of individual pieces — show them to the member rather than describing them or linking to them. Enough to understand and continue a composition with no memory of the conversation that made it.

Inputs: `id` (required). Output schema: declared.

### `list_ensembles`

List the member's saved compositions, newest first.

Inputs: `limit`. Output schema: declared.

### `add_ensemble_artifact`

Add another generated image to an existing Ensemble — a further version of the same composition. Becomes the primary image unless told otherwise; earlier versions are kept. Upload the new composition with upload_image first and pass the uid it returns as `image_uid` — that is the preferred path and re-sends nothing.

Inputs: `id` (required), `image_uid`, `image`, `make_primary`. Output schema: declared.

### `set_primary_artifact`

Choose which generated image represents the Ensemble — "keep the second one" / "go back to the first".

Inputs: `id` (required), `artifact_uid` (required). Output schema: declared.

### `remove_ensemble_artifact`

Remove a generated image from an Ensemble. If it was the primary, the newest remaining image takes over. The stored image itself is not destroyed.

Inputs: `id` (required), `artifact_uid` (required). Output schema: declared.

### `add_ensemble_component`

Add a constituent to an Ensemble that already exists. Upload the piece's image with upload_image first and pass the uid as `image_uid`. Same identity rules as create_pending_ensemble: a clearly identified piece can become a note when the member keeps the Ensemble, while an uncertain one stays unidentified.

Inputs: `id` (required), `label` (required), `note_uid`, `source_url`, `image_uid`, `image`, `identity_basis`. Output schema: declared.

### `remove_ensemble_component`

Take a constituent out of an Ensemble. This does not delete any note it was linked to.

Inputs: `component_uid` (required). Output schema: declared.

### `resolve_ensemble_component`

Say what an unidentified constituent actually is — "that chair is a Finn Juhl Chieftain". Links it to an existing note or creates one (a note created for a composition still pending review joins their notes only if they keep the composition), keeping the SAME component: the piece did not change, only what is known about it. Use again to correct a wrong identification; the earlier one stays in the record rather than being erased. Only call this when the member has told you the identity or confirmed yours — your own guess is not enough.

Inputs: `component_uid` (required), `note_uid`, `label`, `source_url`, `identity_basis`. Output schema: declared.

### `list_unresolved_components`

List constituents across the member's Ensembles that are still unidentified — answers "which pieces haven't been identified yet?". Canonical state only; no guesses.

Inputs: `id`. Output schema: declared.

### `edit_ensemble`

Change an Ensemble's title, description or privacy.

Inputs: `id` (required), `title`, `description`, `private`. Output schema: declared.

### `discard_ensemble`

Call this when the member says no to a composition — 'discard', 'bin it', 'no thanks', 'start over'. Use the ensemble id from the create_pending_ensemble result you already have; do not ask them for it, and do not ask for extra confirmation of something they have just declined. Usually this is a still-pending composition, in which case nothing had reached their notes yet: the Ensemble, its images and any notes made for its pieces go, except a note the member has since recorded something about (owned, warranted, placed on a stop or in another Ensemble), which stays but is not added to their notes. If they discard one they had already kept, only the composition goes: every note it brought into their catalogue is now theirs and stays, as with delete_ensemble; the result names what was kept back and why. To remove such notes too, delete each one they name (delete_note), as a separate act.

Inputs: `id` (required). Output schema: declared.

### `delete_ensemble`

Permanently delete an Ensemble, its components and its generated images. Notes in the member’s catalogue that it linked to are NOT deleted. If the Ensemble was still pending review, notes made only for its pieces (never kept, and with nothing else recorded about them) go with it, as on discard.

Inputs: `id` (required). Output schema: declared.

### `re_note`

Re-note another member’s public note: the member saw it and wants that thing in their own notes. This creates a NEW, independent note in this member’s catalogue, copying the current description and image, with lineage back to the source; the source member can never afterwards change or remove it. It records nothing about possessing the thing (that is record_note_ownership). Re-noting the same note more than once is allowed and makes another independent note each time — if the member asks to do it again, just do it.

Inputs: `id` (required). Output schema: declared.

### `delete_note`

Permanently delete one of the connected member's own notes. Cannot be undone. Ensembles that included it are not deleted: each piece that was this note stays, as an unidentified piece, and a recommendation of it stays as history.

Inputs: `id` (required). Output schema: declared.

### `record_note_ownership`

Record that the member owns the thing recorded in one of their NOTES — "I own this". Ownership applies to notes only; a travel mark is a place and cannot be owned. Owned is private: it is never shown to anyone else, never appears in public results, and never posts to the feed. Only call this when the member has actually said they own it. Never infer ownership from a note existing, from enthusiasm, from a purchase link, or from anything else.

Inputs: `id` (required). Output schema: declared.

### `release_note_ownership`

Record that the member USED TO own the thing in one of their NOTES and no longer does — sold, given away, lost, replaced. Notes only; a travel mark is a place and cannot be owned. This preserves the fact that they owned it for a period. If instead the ownership record was simply an error and they never owned it, use correct_note_ownership_mistake — do not use this tool, because it would leave a false record of them having owned it for a while.

Inputs: `id` (required). Output schema: declared.

### `correct_note_ownership_mistake`

Withdraw an ownership record on one of the member's NOTES that should never have been made — they did not own the thing and the earlier entry was an error. This removes the false ownership period from their record while keeping an honest trace that a correction happened. This is NOT for things sold, given away, or no longer owned: for those use release_note_ownership. If it is unclear which the member means, ask before calling either.

Inputs: `id` (required). Output schema: declared.

### `warrant`

Record that the member stands behind something — their personal seal of approval on a note or a travel mark. Only call this when the member has explicitly said they want to warrant, endorse or stand behind it. Never infer a warrant from praise, from ownership, from repeat visits, from a positive description, or from sentiment of any kind. On a public note or mark this is announced to the feed by default; pass announce:false to warrant quietly. Private notes and marks are never announced.

Inputs: `subject_type` (required), `id` (required), `announce`. Output schema: declared.

### `revoke_warrant`

Withdraw the member's warrant from a note or travel mark — they no longer stand behind it. The public endorsement and any feed appearance disappear; no "revoked" announcement is made. Their private history still records that they warranted it and later withdrew.

Inputs: `subject_type` (required), `id` (required). Output schema: declared.

### `edit_travel_mark`

Edit one of the connected member's own travel marks. Only pass the fields being changed — anything omitted is left as is. To log a new visit instead of changing the mark itself, use log_visit.

Inputs: `id` (required), `place`, `locality`, `country`, `address`, `lat`, `lng`, `why`, `tags`, `link`, `image`, `collections`, `private`. Output schema: declared.

### `delete_travel_mark`

Permanently delete one of the connected member's own travel marks, including its visit history. Cannot be undone. Itineraries that included it are not changed otherwise: each stop that was this place stays, with its day, time and notes, as a place still to identify, and a recommendation of it stays as history.

Inputs: `id` (required). Output schema: declared.

### `begin_image_upload`

Send an image you hold as a local file — an attachment the user gave you, a file under /mnt/data or /workspace, or a picture you generated — into Discriminantly, and get back a stable image_uid. THIS IS THE FIRST AND OFTEN THE ONLY CALL: it carries the first slice of bytes with it, so no call is wasted on setup. Read the file's bytes in your code environment, note its exact byte count, split the bytes into slices of at most 32768 bytes, and send slice 0 here as base64. WHAT COMES BACK TELLS YOU WHAT TO DO NEXT, and there are only two answers. status "stored" means the image is saved and image_uid is ready — you are done with this image, call nothing else for it. status "receiving" means keep going: call upload_image_chunk with the index given in next_index, and keep going without pausing or asking the user anything until you get "stored". An image of 32 KB or less finishes in this single call. Never send a file id or a path — those name something inside YOUR sandbox that this server cannot open. For an image already at a public https:// URL, skip all of this and use upload_image.

Inputs: `mime` (required), `total_bytes` (required), `data` (required), `sha256`, `source`. Output schema: declared.

### `upload_image_chunk`

Send the next slice of an image begun with begin_image_upload. Use the index the previous response gave you in next_index, and base64 only THAT slice's raw bytes — never the whole file, never a "data:" prefix. Keep calling this, without pausing or asking the user anything, until a response comes back with status "stored": that response carries the image_uid and means the image is saved. A response with status "receiving" always names the next index to send. If you are unsure whether a slice arrived, sending it again with identical bytes is harmless.

Inputs: `upload_id` (required), `index` (required), `data` (required). Output schema: declared.

### `start_image_upload`

Compatibility only — prefer begin_image_upload, which does this AND carries the first slice, so an ordinary image takes one call instead of three. This opens an upload session without moving any bytes. Even here there is no separate finish step: whichever slice completes the image returns the image_uid by itself.

Inputs: `mime` (required), `total_bytes` (required), `sha256`, `source`. Output schema: declared.

### `finish_image_upload`

Compatibility only — you should not normally need this. The slice that completes an image finalises it automatically and returns the image_uid. Call this only if you opened a session with start_image_upload and want to force assembly. Safe after the image is already stored: it returns the same image_uid rather than storing a second copy.

Inputs: `upload_id` (required), `sha256`. Output schema: declared.

### `view_images`

Look at pictures the member already has in Discriminantly. Notes, travel marks and ensembles carry an image_uid; pass those uids here and the actual images come back so you can SEE them. Use this before composing an Ensemble from things the member has already noted — you need to look at a jacket before you can arrange it with a chair — and any time the member refers to how something of theirs looks. An image the member already has NEVER needs to be uploaded again and must never be asked for again: read its image_uid and view it. Up to 8 at a time. Only images the member can see are returned; very large ones are named but not inlined.

Inputs: `image_uids` (required). Output schema: declared.

### `read_comments`

Read the comments on a note or a travel mark — the conversation around it, written by the member or by others who can see it. A comment is a REMARK, not a record of taste: it says what someone said about the thing, never that the member owns it, endorses it, or has been there. Use this when the member asks what people said about something, or before replying so you are not repeating what is already there. Only notes and marks the member can actually see can be read; a private record belonging to someone else is reported as not found.

Inputs: `id` (required), `subject_type`. Output schema: declared.

### `comment`

Post a comment on a note or travel mark as the connected member — a remark in the conversation around it. Say something only when the member has actually told you what to say, or clearly asked you to respond on their behalf; never invent an opinion for them, and never use a comment to record that they own, endorse or visited something. Those are different acts with their own tools: record_note_ownership, warrant, and log_visit. Commenting on someone else's note is fine where the member can see it; a private record belonging to another member cannot be commented on.

Inputs: `id` (required), `subject_type`, `body` (required). Output schema: declared.

### `upload_image`

Store an image that is ALREADY REACHABLE and get back a stable image_uid: pass an https:// URL and Discriminantly fetches it server-to-server. That is what this tool is best at, and no chunking is needed for it. A small inline data: URL also works. FOR A LOCAL FILE — an attachment the user sent, a file under /mnt/data or /workspace, or a picture you generated — prefer begin_image_upload, then upload_image_chunk, instead: sending a whole image as one tool argument has proved unreliable, with runtimes silently truncating arguments at sizes as small as 135 KB, whereas chunking always works. Never pass a file id or a filesystem path to any of these tools; those name something in YOUR sandbox that this server cannot open. Upload one image at a time, keep each returned image_uid, and pass those uids onward (create_pending_ensemble, note_object, add_travel_mark) rather than sending a picture twice. A successful result is itself proof the image is stored; images are private, so do not fetch the returned /i/<uid> path to check.

Inputs: `image` (required). Output schema: declared.

### `verify_place`

Look up a place in mapping data (OpenStreetMap, the same lookup as this app's own place search) to establish its identity before writing it anywhere. Read-only: it never creates or changes a travel mark; pass what it finds to resolve_travel_mark (or add_travel_mark for a simple "mark this place"). When the member names a place themselves, show the match before writing. When the member asked you to plan or build an itinerary and exactly one result clearly matches the place you researched (same name, locality and country), you may use it without asking again. If several plausible results come back, surface the choice instead of picking one. If nothing comes back but an official or authoritative source establishes the place and its address, you may still resolve it (identity_basis authoritative_source) with no coordinates. Never invent coordinates or an address.

Inputs: `query` (required), `limit`. Output schema: declared.

### `add_travel_mark`

Add a travel mark: a place the member wants to remember — a restaurant, hotel, shop, view — whether or not they have been. A mark is not a visit: record a visit only when they say they went, with visited_on here or log_visit later. If the place was already recommended to them, its existing record is kept instead of a duplicate being made. Use this rather than note_object when the subject is a place, not a thing. Call verify_place first unless the member has given a precise address or you already know the place well; pass its coordinates through as lat/lng so the mark is grounded rather than guessed.

Inputs: `place` (required), `locality`, `country`, `address`, `lat`, `lng`, `why`, `tags`, `link`, `image`, `collections`, `visited_on`, `private`, `allow_duplicate`. Output schema: declared.

### `log_visit`

Add a check-in to an existing travel mark — one visit. A single day is the common case: a date and, if the member said something, a line about it. If they remember being there but not when, set date_unknown and skip the date entirely — that still counts as having visited. A CONTINUOUS multi-day visit (a hotel stay, a few days somewhere) is still ONE check-in: give ended_on as well, and optionally attach a note to individual days inside the range with `days`. Two separate trips are two separate check-ins, however close together. Never split one stay into several check-ins.

Inputs: `id` (required), `date_unknown`, `visited_on`, `ended_on`, `body`, `days`. Output schema: declared.

### `list_checkins`

List the check-ins on one of the member's own travel marks — the times they actually went. Most recent first, with undated ones last since they have no place in time. Use this to find a check-in's id before editing or deleting it; no other tool exposes individual check-in ids. Each carries: `range`, the dates as a person would say them ("Feb 28, 2025", "Feb 24 – 29, 2024", or "Date unknown"); `visited_on` and `ended_on`, the machine dates, where ended_on is the LAST day of a continuous multi-day visit and is null for a single day; `date_known`, false when the member recorded the visit without knowing when it was, in which case both dates are null; `body`, their line about the visit as a whole; and `days`, notes tied to particular dates inside it. A multi-day visit is ONE check-in with day notes inside it — never read its days as separate visits, and never count them as extra visits.

Inputs: `mark_id` (required). Output schema: declared.

### `edit_checkin`

Edit one of the member's own check-ins, identified by its own id (from list_checkins). Only pass what changes — dates, the overall line, and/or notes on particular days; everything omitted is left as is, and the check-in keeps its identity. To add or change a day's note, pass it in `days`; to remove one, pass that date with an empty body. Shortening the dates so that an existing day note would fall outside the visit is refused unless you also list that date in `remove_days` — the member must be asked before a note is discarded.

Inputs: `id` (required), `date_unknown`, `visited_on`, `ended_on`, `body`, `days`, `remove_days`. Output schema: declared.

### `delete_checkin`

Permanently delete one of the member's own check-ins — the record that they went at all. Any notes on individual days inside it go with it, since those describe that visit. The travel mark itself and its other check-ins are untouched. To shorten a visit rather than erase it, or to drop a single day's note, use edit_checkin instead. Cannot be undone.

Inputs: `id` (required). Output schema: declared.

### `my_travel_marks`

List the connected member's travel marks with visit counts — a count of CHECK-INS, where one continuous multi-day stay counts once, not once per day, and a visit whose date the member cannot recall still counts. Optional search across place, city, country and tags. Each mark carries the member's `warrant` state. There is no ownership on a travel mark — owning applies to things in notes, not to places, so no `owned` field is returned here and none should be inferred. warrant state:null means they have never said either way — that is NOT a negative judgement. 'revoked' means they warranted it before and withdrew.

Inputs: `query`, `limit`. Output schema: declared.

### `search_catalogue`

Search the connected member's own notes and travel marks — the actual catalogue, not just recent entries. Searches title, description, tags, and (for marks) city and country. Use this whenever the member asks what they have noted or marked about something, before adding something new to check whether it already exists, or to find an item to edit when only given a rough description. Results mix the two kinds. Note entries carry the member's private `owned` state and their `warrant` state; mark entries carry only `warrant`, because ownership applies to things and not to places. On either, state:null means they have never said anything either way — that is NOT a negative judgement and must not be read as one. 'released' means they owned it before; 'revoked' means they warranted it before and withdrew.

Inputs: `query` (required), `kind`, `limit`. Output schema: declared.

### `catalogue_stats`

Counts and breakdowns of the connected member's catalogue: totals, notes by collection, marks by country, and how many entries have no image. Use this for "how many" or "what is my" questions rather than counting a list yourself.

Inputs: none. Output schema: declared.

### `create_itinerary`

Start an itinerary: somewhere the member means to go. Title is the destination as they say it ("Singapore", "Next time I'm in London"). Context is their own prose about the trip. Time is optional at every level and nothing should be invented: give only the components they actually said.

Inputs: `title` (required), `context`, `private`, `year`, `month`, `day`, `period`, `modifier`, `modifier_scope`. Output schema: declared.

### `add_itinerary_stops`

Add one or more stops to an itinerary in a single call — pass every stop the member just listed, not one call each. A stop is a parcel of intended time: it does NOT need to be a known travel mark. Use kind "particular" when they mean a specific place you cannot yet name ("that tapas place Flora recommended"), "experiential" when the words are the whole intention ("some chilli crab"), and "allocation" for deliberately open time ("leave the afternoon free"); all three are complete as they stand and none is a defective mark. A stop records what the member INTENDS, never what happened: if they are telling you they have already been somewhere, that is log_visit against the travel mark, not a stop. Attach a specific place (mark_uid, or new_place) when the member identified it, or when you selected and grounded it while building a plan the member asked you to build: resolve_travel_mark returns the mark_uid to pass. Do not add unrelated suggestions to an existing plan outside that request.

Inputs: `itinerary_uid` (required), `stops` (required). Output schema: declared.

### `update_itinerary`

Change an itinerary's title, context, or whether it is private. Publishing fails, with the reason, while a visible stop points at a private travel mark — that is deliberate: the member resolves it by publishing the mark or suspending the stop.

Inputs: `itinerary_uid` (required), `title`, `context`, `private`. Output schema: declared.

### `update_itinerary_temporal`

Set or change time on an itinerary, a day, or a stop. Give only the components the member asserted; omitted components stay as they were, and nothing is invented. intent matters for the record: "refine" when the plan simply got more precise (fall 2028 -> October 2028), "correct" when the earlier assertion was wrong ("no, October, not fall"). OMIT intent when you do not actually know which — an honest plain edit is recorded instead of a guess.

Inputs: `target` (required), `uid` (required), `intent`, `year`, `month`, `day`, `period`, `modifier`, `modifier_scope`, `weekday`, `daypart`, `clock`, `clear`. Output schema: declared.

### `arrange_itinerary`

Create days, put stops on them, and set order, in one call. Set an order when the member gave one, or when the member asked you to plan or arrange the itinerary and the order is part of the plan you are building. Do not reorder a plan the member arranged themselves unless they ask you to optimise or replan it. An itinerary with no asserted sequence is perfectly normal. Arranging records intention only: no visits, bookings or check-ins.

Inputs: `itinerary_uid` (required), `create_day`, `assign`, `order_stops`, `order_days`. Output schema: declared.

### `resolve_itinerary_stop`

Point a stop at a travel mark once its identity is established, or unlink it again. Established means the member confirmed which place it is, or you grounded it (with resolve_travel_mark, verify_place or an authoritative source) while building a plan the member asked you to build; never a materially ambiguous guess. The stop keeps its identity and its original words: resolving answers the intention, it does not replace it. Use intent "refine" for a first resolution, "correct" when fixing a wrong one. Linking records no visit.

Inputs: `stop_uid` (required), `mark_uid`, `unlink`, `kind`, `intent`. Output schema: declared.

### `update_itinerary_stop`

Change a stop's wording or kind, or withhold it from public view. Suspending is context-local: it hides the stop from this itinerary's public page and changes nothing about the travel mark anywhere else.

Inputs: `stop_uid` (required), `label`, `kind`, `visibility`. Output schema: declared.

### `delete_itinerary_entity`

Delete an itinerary, a day, or a stop. Deleting a day does not delete its stops — they return to the itinerary unplaced, and any order they had within that day is dropped, because it was an order within that day. Nothing here touches travel marks or check-ins: those are the member’s canonical records and outlive any itinerary that referred to them.

Inputs: `kind` (required), `uid` (required). Output schema: declared.

### `my_itineraries`

The member's itineraries — places they mean to go. With a uid, returns that one in full: its days, its stops, what each stop is, and how time was expressed at every level. Read it as intention only: a stop with a past date does not mean they went, an unsequenced stop is not an unfinished one, and a day with no date is not missing information. Check whether they actually went by looking at the travel mark's check-ins.

Inputs: `uid`, `limit`. Output schema: declared.

### `record_recommendations`

Record what a Discriminantly recommendation workflow has deliberately selected and presented to the member as a recommendation: things, places or whole itineraries, for cold_start (starting their catalogue), destination_objects (for one of their trips or plans) or for_another_time (worth keeping in mind with no particular trip, including something you set aside for later while doing either of the others). Record only what you actually present, never the candidates you researched or considered and dropped. Not for general recommendation questions that do not involve their Discriminantly catalogue or plans, and not when the member asks to keep, note or mark something themselves: that is note_object, add_travel_mark, create_itinerary or keep_recommendation. A recommendation is your proposal: it does not mean they saw, liked, kept, own, visited or endorse it, it is never evidence of their taste, and it is not added to their notes, marks or itineraries (my_notes, my_travel_marks, search_catalogue and my_itineraries do not show it) unless they later say to keep it (keep_recommendation) or it points at a record that is already theirs. Record the resolution you actually reached: a category ("medium-roast Kaʻu coffee") is unresolved, a producer without the exact product is partial, and neither needs inventing detail. If it is something they already have, pass target_uid and that record gains the recommendation. A resolved thing or place that they do not have is given a private record that is not kept. For a whole plan, use kind "itinerary" (a new private plan, not kept), then add_itinerary_stops with its target uid. Recording the same proposition in the same context again returns the existing one. Inside a plan the member asked you to build, the places you choose are the plan itself: make them canonical travel marks (resolve_travel_mark, target_state canonical) and add them as stops; you may still record that you proposed them, with target_uid pointing at that mark (or pass recommendation_context to resolve_travel_mark), and no keep_recommendation is needed. keep_recommendation is for optional ideas the member has not taken up, such as For another time.

Inputs: `items` (required). Output schema: declared.

### `resolve_recommendation`

Add what you have since established about a recommendation: the producer, the exact product, the place, its picture. Resolution only ever gains precision, and the original words are kept. Pass only what you actually know; leaving it partial is correct when the exact item cannot be established. Reaching "resolved" links it to the member’s existing record, or makes a private record for it that is NOT kept.

Inputs: `recommendation_uid` (required), `resolution`, `maker`, `product`, `variant`, `url`, `image_uid`, `image`, `place_name`, `locality`, `country`, `address`, `lat`, `lng`, `target_uid`, `target_type`, `origin_itinerary_uid`, `relation`. Output schema: declared.

### `list_recommendations`

List what has been recommended to the member through record_recommendations, grouped by trip or "for another time", newest first; by default only open ones (neither kept nor dismissed). Use when the member asks what was suggested before. These are proposals, not their records: for their own notes, marks and plans use my_notes, my_travel_marks and my_itineraries. A recommended itinerary’s full plan opens with my_itineraries and its target uid.

Inputs: `context_itinerary_uid`, `workflow`, `status`, `limit`. Output schema: declared.

### `keep_recommendation`

Call when the member says to keep a recommendation ("keep it", "add that to my notes", "yes, that plan"), and also when they state a personal relationship with a recommended note or travel mark ("I went there last year", "I bought that coffee", "I own that one", "I stand behind it"): a check-in, ownership, warrant, comment or edit attaches only to a kept record, so their words already say to keep it. Keep it first, then record exactly what they said (log_visit, record_note_ownership, warrant, comment), without asking again. Praise alone is not such a statement, and wanting it under a stop in one of their kept plans needs their say-so first. Keeping brings the recommended note, travel mark or itinerary into their own catalogue; the recommendation stays as history. Keeping a recommended itinerary keeps the plan with the places and notes in its stops, as they are; unresolved stops stay unresolved. An unresolved or partial recommendation must be resolved to a specific thing first. If the record it pointed at was deleted since, keeping it finds or makes the record again from what the recommendation knows. A note recommended for a stop of one of their plans is attached to that stop as it is kept.

Inputs: `recommendation_uid` (required). Output schema: declared.

### `dismiss_recommendation`

Record the member’s answer when they turn a recommendation down, only when they say so; silence is no answer. Use the reason they actually gave: "not_this_trip" (wrong for this trip or plan, which says nothing about whether they like it), "not_for_me" (they say it does not suit them), or "dismissed" (no reason given). Each is recorded exactly as said and is never treated as evidence of their taste. It leaves the open list; nothing is deleted. Recording the same reason again changes nothing.

Inputs: `recommendation_uid` (required), `reason`. Output schema: declared.

### `set_stop_note`

Attach one of the member’s notes to a stop in one of their plans, or detach it (attached: false). It means only "this is worth noticing, seeking or trying at this stop": not a purchase, ownership, reservation, check-in or warrant. In a plan they have kept, only a kept note can be attached: if the note is only recommended, ask whether they want to keep it rather than keeping it for them. In a recommended plan, a recommended note can be attached. Never make a note from a vague category: record it as a recommendation instead (record_recommendations). Attaching a note that is already there changes nothing. Returns the plan’s notes by stop.

Inputs: `stop_uid` (required), `note_uid` (required), `attached`. Output schema: declared.

### `list_stop_notes`

List the notes attached to each stop of one of the member’s plans, which my_itineraries does not include. Read-only.

Inputs: `itinerary_uid` (required). Output schema: declared.

### `resolve_travel_mark`

Resolve one specific real-world place into the member's travel marks, and return its mark uid. Call it when you have established a place's identity (from the member, verify_place, an official source or a stable id) and need a travel mark for a plan, a recommendation or a standalone place. Reuses an existing mark only on an exact identity match (same stable id, same address, near-identical coordinates, or same name and city); another country is never the same place by name. On a probable match (it may be the same place) it creates nothing and returns the candidate (action "candidate"): check it, then call again with allow_distinct_from_candidate if it is a different place, or use the candidate's uid if it is the same. On a possible match (another city, a similar name) it creates the mark and names the candidate in match. Otherwise it creates the mark. On reuse it only fills fields that are empty, never overwriting. target_state "canonical" is an ordinary kept mark: use it for a plan the member asked you to build, or when they ask to mark a place. "recommendation" makes a private, unkept mark for an optional idea (for example For another time), which the member may keep later with keep_recommendation. Pass recommendation_context to record that you proposed it; for a canonical mark that needs no keep step. A travel mark is a place to remember: this never records a visit, check-in, booking, ownership or warrant. Not for simple direct marking (add_travel_mark), surgical edits (edit_travel_mark), lookup alone (verify_place) or searching what they have (search_catalogue). Next: add_itinerary_stops or resolve_itinerary_stop with the returned mark uid, then audit_itinerary.

Inputs: `place` (required), `locality`, `country`, `address`, `lat`, `lng`, `external_id`, `link`, `why`, `tags`, `private`, `identity_basis` (required), `target_state` (required), `recommendation_context`, `allow_distinct_from_candidate`, `image`, `image_uid`, `unavailable`. Output schema: declared.

### `audit_itinerary`

Check one of the member's itineraries for structural completeness and travel mark linkage, and return the exact stop and mark uids that need attention. Use it after building or repairing a plan in several steps, or after keeping a recommended plan, before telling the member it is done. Read-only: it never creates, resolves, enriches, reorders or deletes anything; fix what it reports with resolve_travel_mark, resolve_itinerary_stop, arrange_itinerary or edit_travel_mark. satisfied reflects only the expectations you pass (no_conflicts by default); a missing website or note never fails a plan, and experiential or open-time stops are complete as they are. Complements my_itineraries, which shows the plan itself.

Inputs: `itinerary_uid` (required), `expect`. Output schema: declared.

### `audit_recommendation_expansion`

Check the For another time proposals made after one of the member's plans: whether each of the three (same city, similar, different) is present, and anything malformed (no relation, a proposed plan that is missing or empty, or more than one of a kind). Use it after recording For another time itineraries with record_recommendations, before telling the member they are there. Read-only: it never creates, fixes or removes a proposal; record a missing one with record_recommendations and add its stops with add_itinerary_stops. Returns the recommendation uids for each relation. Complements list_recommendations, which lists them for the member.

Inputs: `origin_itinerary_uid` (required). Output schema: declared.

### `build_itinerary`

Write a whole itinerary the member asked you to build, in one step: the plan, its days, a canonical travel mark for each place you chose, the stops, and their order; then it audits the result. Use it when the member asked you to plan or build a trip ("help me plan a day in Taipei") and you have chosen the stops. Not for changing a plan they already have (add_itinerary_stops, arrange_itinerary), not for optional ideas (record_recommendations, For another time), and not for recommending. Places are resolved exactly as resolve_travel_mark does, target_state canonical: an exact existing mark is reused, never duplicated. Ambiguity is checked before anything is written: if any place may be one they already have (a probable match), nothing is written and the candidates come back; resolve them and call again (with allow_distinct_from_candidate on that place if it is different). Otherwise everything is written in one transaction, or nothing: a failure leaves no partial plan. The plan is private unless private is false. It records intention only: never a visit, check-in, booking, ownership or warrant. Returns the itinerary, day and stop uids, the marks it used or created, and the audit; follow with record_recommendations for For another time.

Inputs: `title` (required), `context`, `private`, `days`, `stops`. Output schema: declared.

### `keep_record`

Keep one of the member's own notes or travel marks that is not yet in their catalogue, when they say to keep it: a piece identified for a composition still pending review, something that survived a discarded composition, or a recommended thing or place (for which keep_recommendation works equally). Keeping adds it to their notes or marks (my_notes, my_travel_marks); it means they chose it, not that they own it, visited it or stand behind it, and it records none of those. Only on the member's word, never inferred from praise or a purchase. Already kept: changes nothing. Not for their own new things (note_object, add_travel_mark) or whole plans (keep_recommendation with the plan).

Inputs: `type` (required), `uid` (required). Output schema: declared.

### `clear_prospective_leftovers`

Find, and when the member confirms delete, records that were never kept and that nothing uses any more: places or things left from a recommended plan that was deleted, or from recommendations they turned down. A record is a leftover only if it is not kept, no plan, stop, stop note or composition holds it, it has no check-in, ownership, warrant or comment, and no open recommendation points at it. Without confirm it only lists them; with confirm: true it deletes exactly those, recording each deletion. Never touches anything the member kept. Use when the member asks to tidy up old suggestions, not on your own initiative.

Inputs: `confirm`. Output schema: declared.

## Server instructions

```
You are connected to discriminant.ly as {MEMBER_NAME} (@{MEMBER_HANDLE}) [ensemble_contract: chunked-upload-v4-autofinal; catalogue-images-v5].

HOW TO WORK HERE. Never say something was saved before the tool call that saves it has returned successfully. If a call fails you will get a reference code — tell the member it failed, quote the reason and the code, and never quietly carry on as if it worked. Do not retry an identical failing call more than once. When a tool result tells you what to do next, do it without pausing to ask the member: internal plumbing is not their decision. Confirm before deleting anything.

WHAT LIVES HERE. Notes are things the member recorded. Travel marks are places worth remembering — a mark alone does not mean they went; a check-in (log_visit) is the record that they did, and only when they say so. Itineraries are plans: an intention, not a record of going. Collections group notes or marks. A note or mark means they thought it worth recording — never that they own or endorse it; ownership is record_note_ownership and endorsement is warrant, each its own deliberate act. Comments are remarks in conversation, not records of taste. Notes and marks are visible to other members unless marked private; itineraries start private. Honour whatever the member says about privacy.

BEFORE ANSWERING ABOUT THEIR CATALOGUE. For anything like "have I noted…", "what's in my…", "how many…", call search_catalogue or catalogue_stats. Do not answer from memory of this conversation, and do not settle for recent_notes.

WRITING. Write to their notes, marks, check-ins or plans only when the member asks you to keep, note, mark, check in or plan something. Recommending or discussing a place is not saving it, and mentioning somewhere is not checking in (recording a recommendation a Discriminantly workflow presents is its own act; see RECOMMENDATIONS). When what they want is clear, just do it; ask only when it is genuinely ambiguous. For a note, write a crisp headline and a short description in the member's voice, propose tags, then note_object. For a place use add_travel_mark, and call verify_place first unless you already have a precise address — show the member the match, or the fact that nothing matched, and never invent coordinates. Both tools refuse near-duplicates: if that happens, say what already exists and ask before retrying with allow_duplicate. Use edit_note / edit_travel_mark to change things, passing only the fields that change.

IMAGES THE MEMBER ALREADY HAS. Every note and mark reports has_image and image_uid. If a thing is already in their catalogue, its picture is already here: look at it with view_images, and pass its image_uid straight on. Never ask the member to attach a picture of something they have already noted, and never upload it again.

INGESTION MODE: auto. Send local images with begin_image_upload; an image that fits one slice takes a single call. Use upload_image for images already at a public https:// URL.

IMAGES FROM YOUR OWN SANDBOX. An attachment or a picture you generated is a local file — that file is the SOURCE of the bytes, not the argument. A file id or a path means nothing to this server and is never a reason to stop. Read the bytes in your code environment, keep good visual quality, then call begin_image_upload with the first slice. Every reply says what to do next and there are only two answers: 'receiving' means call upload_image_chunk with the index in next_index; 'stored' means the image is saved and image_uid is ready. Keep going until 'stored' without pausing. Never put a whole image in one tool argument: runtimes truncate long arguments unpredictably, which is exactly why the bytes go in slices. An image already at a public https:// URL needs none of this — upload_image with the URL is enough.

ENSEMBLES. When the member asks to combine or compose things visually: look at each constituent (view_images for anything already in their catalogue), generate the composition yourself — discriminant.ly does not generate it — ingest only what is genuinely new, then call create_pending_ensemble with the uids. Only after it succeeds, ask whether to keep or discard, and call keep_ensemble or discard_ensemble with the id you already have.

RECOMMENDATIONS. When a Discriminantly recommendation workflow (starting their catalogue, things for one of their trips, or something to keep in mind for another time) presents a thing, place or itinerary to the member as a recommendation, record what you actually present, and only that, with record_recommendations, at the resolution you truly reached: unresolved and partial are honest answers. Candidates you only researched are not recommendations, and an ordinary recommendation question outside their catalogue and plans records nothing. A recommendation is not the member's note, mark or plan and never evidence of their taste; it becomes theirs only when they say to keep it (keep_recommendation). A check-in, ownership, warrant, comment or edit attaches only to a kept record: when the member says they went, own it or stand behind it, that already says to keep it, so keep it first and then record it, without asking again. Earlier ones: list_recommendations.
```
