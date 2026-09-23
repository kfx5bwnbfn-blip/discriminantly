# Discriminantly — ChatGPT Plugin Submission Package

Prepared from the repository at v2.52 and OpenAI's plugin documentation as of September 2026. Nothing here has been submitted.

## A. Verdict: READY AFTER MANUAL ACTIONS

The code is ready for submission. Four things were blocking and are now fixed in code: **no tool carried the required annotations**, there were **no privacy, terms or support pages**, there was **no way to serve the domain-verification token**, and the **documented way to attach an uploaded photo to a note was broken**. OAuth, the `/mcp` transport, tokens and provenance are untouched.

What remains is outside the repository: verifying the publisher identity on the OpenAI Platform, setting three server variables (support email, publisher name and, once the portal issues it, the verification token), creating and seeding the reviewer account, and completing the portal form.

Sources: [Submit plugins](https://developers.openai.com/plugins/deploy/submission) · [Plugin guidelines](https://developers.openai.com/plugins/app-guidelines) · [Remote MCP review requirements](https://developers.openai.com/plugins/deploy/app-review) · [Submission errors](https://developers.openai.com/plugins/deploy/submission-errors)

Requirements derived from them:
- Every tool must carry explicit `readOnlyHint`, `openWorldHint` and `destructiveHint`, with a justification for each value. OpenAI says incorrect or missing labels are a common cause of rejection.
- Exactly **5 positive and 3 negative** test cases, plus release notes.
- Reviewer credentials must work without MFA, SMS, email confirmation or a private network.
- Domain verification: serve the portal's exact token, and nothing else, at `/.well-known/openai-apps-challenge`.
- Public website, support, privacy and terms URLs that match the publisher identity and the actual data handling.
- A verified individual or business identity, and the **Apps Management: Write** permission for whoever submits.
- Tool responses must not include unnecessary personal data, secrets, debug payloads or internal identifiers.
- Custom UI and skills are optional. An MCP-only plugin is a supported submission type.

## B. Submission-gap matrix (after hardening)

| Requirement | Before | Evidence | Severity | Now |
|---|---|---|---|---|
| Tool annotations on every tool | None of 54 | `tools/list` had no `annotations` | BLOCKER | **Fixed** — all 54, with a startup check |
| Tool titles | None | no `title` field | HARDEN | **Fixed** |
| Domain-verification route | Missing | no `/.well-known/openai-apps-challenge` | BLOCKER | **Fixed** — serves `OPENAI_APPS_CHALLENGE` raw, 404 until set |
| Privacy, terms, support URLs | Missing | no routes | BLOCKER | **Fixed** — pages written to match actual data handling |
| Publisher name and support contact | Not established in the repo | — | BLOCKER (manual) | Read from `PUBLISHER_NAME` / `SUPPORT_EMAIL`; nothing invented |
| Attaching an uploaded photo to a note | **Broken** | `note_object` documents `/i/<id>` but rejected it | HARDEN | **Fixed**, with ownership still enforced |
| Database errors in tool responses | Shown verbatim | constraint errors classed as deliberate | HARDEN | **Fixed** — masked as faults, logged in full |
| Fault message | Claimed "Nothing was saved" | not guaranteed after partial writes | HARDEN | **Fixed** |
| Instructions: Mark ≠ visit | Blurred | "Travel marks are places they went" | HARDEN | **Fixed** |
| Instructions: discussion ≠ save | Absent | — | HARDEN | **Fixed** |
| Cross-user isolation | Untested for submission | — | — | **Verified**, 20/20 |
| Secrets or debug data in responses | Untested | — | — | **Verified clean**, 39 responses |
| Provenance for plugin writes | — | — | — | **Verified correct** |
| OAuth, revocation, reauthorization | Live-validated earlier | — | — | Unchanged; revocation re-verified |
| Test cases 5 + 3, release notes | — | — | BLOCKER | **Prepared** (§H, §I) |
| Reviewer account | Doesn't exist | invite-only product | BLOCKER (manual) | Procedure in §J |
| Canonical domain | Brief says `discriminantly.com`; OAuth issuer is `www.` | `PUBLIC_ORIGIN` default | HARDEN (manual check) | Keep `www`; see §K step 2 |
| Output schemas | 45 of 54 | — | POST | Optional per docs |
| Custom UI / skills | None | — | Not required | Kept out |

## C. Code changes

`server.js`
- `TOOL_ANNOTATIONS`: a title and three hints for every tool, applied to the tool definitions. The server refuses to start if any tool lacks an entry, or if an entry names a tool that doesn't exist.
- Tool-call error handler: database errors are treated as faults (reference code plus a plain message; the full error still goes to the log). The fault message no longer promises that nothing was saved.
- `resolveAssetRef`: a stored-image reference (`/i/<id>`, bare id, or this site's own `/i/` URL) goes through `resolveOwnedImageUid`, so a member can attach only their own images. The error for an unrecognised image names the accepted forms.
- Server instructions: three corrections (Mark ≠ visit; itineraries are plans; discussion and recommendation are not saving). Privacy defaults stated.
- `/privacy`, `/terms`, `/support`: public pages. Publisher and contact come from `PUBLISHER_NAME` and `SUPPORT_EMAIL`. Until those are set, the pages say plainly that no support address is published.
- `/.well-known/openai-apps-challenge`: returns `OPENAI_APPS_CHALLENGE` as bare text, and 404 when it's unset.

`public/style.shared.css`: layout for the policy pages.

`test/itinerary.js`: 18 new tests (`PS1`–`PS18`), 289 total, all passing. `test/plugin-audit.js`: the adversarial suite (§E), which can be rerun.

**Unchanged:** OAuth, tokens, CIMD, discovery, `/mcp` transport, connections, provenance, the legacy connector, and domain semantics. A diff check found 0 changed lines in any of them.

## D. Final MCP submission surface

**How the annotations were assigned.** *readOnly* means the tool cannot change anything. *destructive* means it can delete, or overwrite what the member wrote with no copy kept. Provenance records that an edit happened but not the previous text, so edits count as irreversible here. *openWorld* means the tool reaches the public internet, or makes something newly visible to other people.

Every tool requires OAuth with the single `discriminantly` scope, or the member's legacy connector token.

| Tool | Title | readOnly | destructive | openWorld | Justification |
|---|---|---|---|---|---|
| `catalogue_stats` | Count what is in my catalogue | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `get_ensemble` | Open an ensemble | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `list_checkins` | List check-ins on a travel mark | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `list_ensembles` | List my ensembles | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `list_unresolved_components` | List unidentified ensemble pieces | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `my_collections` | List my collections | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `my_itineraries` | List or open my itineraries | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `my_notes` | List my notes | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `my_travel_marks` | List my travel marks | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `read_comments` | Read comments | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `recent_notes` | Recent notes across Discriminantly | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `search_catalogue` | Search my catalogue | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `verify_place` | Look up a place in map data | true | false | true | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: Yes — looks the place up in Photon, an external public map service. |
| `view_images` | View images from my catalogue | true | false | false | Only reads the member’s own catalogue (or other members’ public records); changes nothing. Read-only. Open world: No — stays within the member’s own Discriminantly account. |
| `add_ensemble_artifact` | Add an image to an ensemble | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `add_ensemble_component` | Add a piece to an ensemble | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `add_itinerary_stops` | Add stops to an itinerary | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `add_travel_mark` | Add a travel mark | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — looks the place up in Photon, an external public map service. |
| `arrange_itinerary` | Arrange an itinerary’s days | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `begin_image_upload` | Start sending an image | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `comment` | Comment on a note or mark | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — posts a remark other people can read. |
| `create_itinerary` | Start an itinerary | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — starts private, but can be published on request. |
| `create_pending_ensemble` | Stage an ensemble | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `finish_image_upload` | Finish sending an image (compatibility) | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `keep_ensemble` | Keep a staged ensemble | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — saves the composition to the member’s catalogue, visible to others unless private. |
| `log_visit` | Check in at a travel mark | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `note_object` | Add a note | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — notes are visible to other members and by link unless marked private. |
| `re_note` | Re-note another member’s note | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — adds the note to the member’s catalogue, visible to others. |
| `record_note_ownership` | Record that I own this | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `release_note_ownership` | Record that I no longer own this | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `resolve_ensemble_component` | Identify an ensemble piece | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `resolve_itinerary_stop` | Link a stop to a travel mark | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `revoke_warrant` | Withdraw a warrant | false | false | false | Changes stored data. Withdraws a stand, with the history kept; re-warranting restores it. Open world: No — stays within the member’s own Discriminantly account. |
| `set_primary_artifact` | Choose an ensemble’s main image | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `start_image_upload` | Start sending an image (compatibility) | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `upload_image` | Save an image | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — fetches the image from the public URL given. |
| `upload_image_chunk` | Send part of an image | false | false | false | Changes stored data. Adds or links; removes and overwrites nothing. Open world: No — stays within the member’s own Discriminantly account. |
| `warrant` | Warrant (stand behind) something | false | false | true | Changes stored data. Adds or links; removes and overwrites nothing. Open world: Yes — publishes the member’s endorsement on a public record. |
| `correct_note_ownership_mistake` | Withdraw a mistaken ownership record | false | true | false | Changes stored data. Withdraws the ownership record outright. Open world: No — stays within the member’s own Discriminantly account. |
| `delete_checkin` | Delete a check-in | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `delete_ensemble` | Delete an ensemble | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `delete_itinerary_entity` | Delete an itinerary, day or stop | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `delete_note` | Delete a note | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `delete_travel_mark` | Delete a travel mark | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `discard_ensemble` | Discard a staged ensemble | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `edit_checkin` | Edit a check-in | false | true | false | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: No — stays within the member’s own Discriminantly account. |
| `edit_ensemble` | Edit an ensemble | false | true | true | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: Yes — can change the ensemble’s privacy. |
| `edit_note` | Edit a note | false | true | true | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: Yes — can fetch a replacement image from a public URL, and can change the note’s privacy. |
| `edit_travel_mark` | Edit a travel mark | false | true | true | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: Yes — can change the mark’s privacy. |
| `remove_ensemble_artifact` | Remove an ensemble image | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `remove_ensemble_component` | Remove an ensemble piece | false | true | false | Changes stored data. Deletes, and deletion is not reversible. Open world: No — stays within the member’s own Discriminantly account. |
| `update_itinerary` | Edit or publish an itinerary | false | true | true | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: Yes — can publish or unpublish the itinerary. |
| `update_itinerary_stop` | Edit an itinerary stop | false | true | true | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: Yes — can show or withhold a stop from public view. |
| `update_itinerary_temporal` | Change itinerary dates or times | false | true | false | Changes stored data. Overwrites what the member wrote; no copy of the previous version is kept. Open world: No — stays within the member’s own Discriminantly account. |
Totals: **14 read-only · 40 write · 15 destructive · 32 open-world**. No tool is both read-only and destructive.

> **Scan remediation (v2.52.5–v2.52.6):** annotations were re-verified against the code and OpenAI's rule, and 21 values changed. Final totals are **14 read-only · 15 destructive · 32 open-world**, with open-world now also covering tools that change or remove content on a record that is or can be public. The table above predates these corrections. The authoritative per-tool values and justifications are in `plugin/chatgpt-app-submission.json` and `annotation-justifications.md`.

**One conflict with the brief.** The brief treats updates as non-destructive. OpenAI's definition explicitly includes *overwrite*, and edits here keep no previous version, so the seven edit tools are marked destructive. I followed OpenAI. The practical effect is that ChatGPT may ask before editing. If self-serve edit history is added later, those can be re-marked non-destructive. See §M.

**Exposure.** No development or admin tools are exposed; none exist in the MCP surface. `start_image_upload` and `finish_image_upload` are compatibility aliases kept for existing clients. They're harmless, annotated, and described as "compatibility only".

The exact metadata the scanner will read (tool names, titles, descriptions, schemas, annotations, security schemes, server instructions) is in `mcp-scanner-snapshot.json`, captured from `initialize` and `tools/list`. The instructions greet the connected member by name, so a scan shows the reviewer account's name.

## E. Security and privacy findings

Run through the real OAuth path, as ChatGPT uses it, with a second member as the target (`test/plugin-audit.js`), **20/20**:
- A cannot read B's private notes, marks or itineraries, whether through listing, search or recent notes.
- Knowing B's record IDs doesn't let A edit or delete them, and every attempt is reported as a failure, not a success.
- A cannot check in at B's private mark.
- Adding B's private mark to A's itinerary is refused, and B's mark isn't revealed.
- **A cannot attach B's stored image to his own note.** This was a new risk created by the image fix, and it's closed.
- Legacy tokens stay bound to their own member.
- Signed out: a public note shows (200); private notes and marks don't (404).
- A revoked connection gets 401 immediately and cannot refresh; other members are unaffected.
- Across 39 responses: no access, refresh or legacy token, and no session ID. No password, hash or token fields. No stack traces, file paths or SQL. No member email addresses.

**Stable IDs are kept deliberately.** Note, mark, itinerary and image IDs are durable product identity; the model needs them to act on the right record in the next call. What's excluded is implementation leakage: tokens, hashes, table names, errors and paths.

**Remaining, not blocking:** refusals say "does not belong to this member" rather than "not found", which confirms an ID exists without revealing anything about it.

## F. Provenance

Every plugin write type records `actor_type=ai_on_behalf`, the member, the client (`agent`), `auth_method=oauth`, the connection, and `assertion=explicit`. That covers notes, travel marks, check-ins, itineraries, itinerary stops, edits and images. Deletions record `action=deleted`.

Through ChatGPT the agent reads `chatgpt`. The local run shows `mcp-inspector`, the test client. A legacy connector write still records `agent=legacy`, `auth_method=mcp_token_legacy`, with no connection, exactly as before.

## G. Invocation evaluation set

**Direct** (should call tools)
- "Add Hatchards on Piccadilly to Discriminantly." → `verify_place`, then `add_travel_mark`
- "Show me my Lisbon travel marks." → `search_catalogue`
- "What's in my London weekend plan?" → `my_itineraries`
- "Check me in at Time Out Market." → `search_catalogue`, then `log_visit`

**Indirect** (should call tools without being named)
- "I bought this watch today — keep it." → `note_object`, **not** `record_note_ownership`, unless they say it's theirs to record as owned
- "What were the places I liked in Lisbon?" → `search_catalogue` (read-only)
- "I'm going back to Lisbon — what have I already saved there?" → `search_catalogue`
- "Add that to the London plan." (after naming a place) → `my_itineraries`, then `add_itinerary_stops`
- "I went there yesterday and had the bifana." → `log_visit` on the existing mark, not a new mark

**Negative** (should not write, or should not call at all)
- "What is the capital of Sweden?" → no tool
- "Recommend a restaurant in Toronto." → answer normally; no `add_travel_mark` (a suggestion isn't a Mark)
- "We talked about Noma earlier, it sounds great." → no write (discussion isn't saving)
- "I might go to the Louvre next week." → no `log_visit` (a mention isn't a check-in); at most an offer to plan
- "This watch is gorgeous." → no `record_note_ownership` (owning it is not implied) and no `warrant` (praise isn't a warrant)

**Metadata changed because of this set:** the server instructions now say plainly that recommending or discussing isn't saving, that a mention isn't a check-in, and that a mark alone isn't a visit. Tool descriptions were scanned rather than rewritten. Only 7 of 54 use technical terms, and only `uid` and `base64`, which the model genuinely needs. Rewriting 54 working descriptions on the critical path would risk regressions without evidence of misfires.

## H. Required test cases (reviewer account, §J)

**Positive**
1. **Retrieval.** *"What have I saved from Lisbon?"*
   - Tools: `search_catalogue`.
   - Result: the seeded Lisbon marks and notes. No writes.
   - Why: recalling what you've kept is the core use.
2. **Creation.** *"Keep this: Hatchards on Piccadilly in London — the oldest bookshop in the city."*
   - Tools: `verify_place`, then `add_travel_mark`.
   - Result: a new travel mark, confirmed by name.
   - Persistent effect: the mark exists, with provenance `ai_on_behalf`, `chatgpt`, `oauth`. No check-in is created.
3. **Check-in.** *"I went to Time Out Market yesterday and had the bifana."*
   - Preconditions: the seeded Time Out Market mark.
   - Tools: `search_catalogue`, then `log_visit` with yesterday's date and the note.
   - Result: a check-in recorded. The mark itself is unchanged and no duplicate is created.
4. **Itinerary.** *"Add Daunt Books to my London weekend plan."*
   - Preconditions: the seeded "London weekend" itinerary; the seeded Daunt Books Marylebone travel mark, which is not in that itinerary. Independent of every other test.
   - Tools: `my_itineraries`, then `add_itinerary_stops` linking the mark.
   - Result: the stop is added, and the itinerary stays private.
5. **Planning from the corpus.** *"I'm going back to Lisbon next month — make a plan from the places I've saved there."*
   - Tools: `search_catalogue`, `create_itinerary`, `add_itinerary_stops`.
   - Result: a new private itinerary whose stops are existing marks. No new marks and no check-ins are created.

**Negative**
1. **A recommendation isn't a save.** *"Recommend a good restaurant in Toronto."*
   - Expected: ChatGPT answers normally and calls no Discriminantly write tool.
   - Why: a suggestion isn't something the member chose to keep.
2. **Out of scope.** *"What's the capital of Sweden?"*
   - Expected: no Discriminantly tool is called.
   - Why: nothing here concerns the member's catalogue.
3. **Destructive safety.** *"Delete everything in my catalogue."*
   - Expected: ChatGPT asks for confirmation and deletes nothing until the member confirms. The instructions say to confirm before deleting, and the delete tools are marked destructive.
   - Why: irreversible bulk deletion needs explicit confirmation.

## I. Listing package

- **Name:** Discriminantly
- **Short description** (third-party guides report a 30-character limit; check in the portal): *Keep what you notice, anywhere* (30). Alternative: *Your interests and travels* (26).
- **Long description:**
  > Discriminantly is an app and plugin that connects to your AI, giving you a place to keep the things you notice, the places you go, and the experiences worth remembering.
  >
  > Add to it naturally through conversation. Tell ChatGPT about a bookshop you loved, a watch you bought, or a restaurant you went to last night, and it's kept in your Discriminantly catalogue. Ask what you've saved from a city, and plan a trip from the places you already know.
  >
  > You stay in control. Notes and places can be private or shared with other members. Everything ChatGPT adds or changes is recorded as ChatGPT acting for you. You can see and edit everything in the Discriminantly app, and disconnect ChatGPT at any time. Discriminantly is currently invitation-only.
- **Category:** the closest is likely *Lifestyle*, or *Productivity* if that isn't offered. I couldn't confirm the current category list; choose from the portal's dropdown.
- **Starter prompts:**
  - "What have I saved from Lisbon?"
  - "Keep this place: Hatchards on Piccadilly, London."
  - "I went to Time Out Market yesterday — check me in."
  - "Plan a weekend from the places I've saved in London."
- **URLs** (production origin, matching the OAuth issuer):
  - Website: https://www.discriminantly.com
  - Support: https://www.discriminantly.com/support
  - Privacy: https://www.discriminantly.com/privacy
  - Terms: https://www.discriminantly.com/terms
  - MCP server (Universal): https://www.discriminantly.com/mcp
- **Logo:** use the existing mark; `public/icon-512.png` (512×512) is the likely source. The portal states the required format when you upload it.
- **Screenshots:** not applicable; they apply only to plugins with custom UI.
- **Availability:** your choice in the portal. Pick only countries where you're ready to support users and where the terms apply.
- **Release notes:**
  > Initial submission. Discriminantly lets members keep notes, places, check-ins and travel plans through conversation, backed by a remote MCP server with OAuth sign-in. There's no custom UI. Reviewers should sign in with the provided Discriminantly account; it's pre-loaded with a small demonstration catalogue, and none of the test cases need MFA or email confirmation.

## J. Reviewer account

**Requirements.** An email-and-password login with no MFA, SMS, email confirmation or private network. **Discriminantly already meets these:** joining needs only an invite code, with no confirmation email; sign-in is email and password; the ChatGPT consent screen uses that same login.

**Setup (you, in production):**
1. Signed in as yourself, open **Invites** and create an invite.
2. In a private browser window, join with that code:
   - Name: **Discriminantly Plugin Review**
   - Handle: **plugin-review**
   - An email address you control, which is never verified
   - A strong password
3. Still signed in as the reviewer, add this small corpus in the app:
   - **Travel marks:** Time Out Market (Lisbon, Portugal); Livraria Bertrand (Lisbon); Pastéis de Belém (Lisbon); Borough Market (London, UK); Daunt Books Marylebone (London, UK). Leave Hatchards unseeded, for test 2.
   - **One check-in:** at Pastéis de Belém, on any past date.
   - **Notes, each with any photo of your own:** a notebook; a pair of boots; a coffee grinder. Mark one of them private.
   - **One collection:** "Lisbon", containing the Lisbon marks.
   - **One itinerary:** "London weekend", private, with Borough Market as a stop.
4. Sign out. Test the credentials once from a phone on mobile data, outside your home network.

## K. Manual actions (in order)

1. **OpenAI Platform:** make sure you have **Apps Management: Write** (automatic if you're the organization owner). Then complete **individual** verification to publish under your own name, or **business** verification to publish under a company name. The repository doesn't establish a legal publisher, so this is your decision.
2. **Domain check:** confirm https://www.discriminantly.com is where OAuth and `/mcp` live today (it is, per the earlier live validation). Also decide whether bare `https://discriminantly.com` should redirect to it. **Keep `www` as the MCP and OAuth origin.** Moving the issuer would invalidate the working ChatGPT connection.
3. **Railway variables** (service → Variables), then let it redeploy:
   - `SUPPORT_EMAIL`: an address you'll actually read
   - `PUBLISHER_NAME`: the exact name of your verified identity from step 1
4. **Deploy this version** (upload the zip to GitHub as usual).
5. **Check in ChatGPT** (changed behaviour only; no OAuth rebuild):
   - Refresh the plugin's metadata in ChatGPT's plugin settings.
   - *"What have I saved from Stockholm?"* → a read-only answer.
   - *"Keep this photo as a note"* with a photo attached → it saves (this was broken before).
   - *"Recommend a restaurant in Toronto"* → nothing is saved.
   - *"Add a stop to one of my itineraries"* → works.
   - In the app, confirm the new note says ChatGPT added it for you.
6. **Create and seed the reviewer account** (§J).
7. **Open the portal:** https://platform.openai.com/plugins → **Create plugin** → **With MCP** → **Universal** → `https://www.discriminantly.com/mcp`.
8. **Domain verification:** copy the portal's token into Railway as `OPENAI_APPS_CHALLENGE`, wait for the redeploy, then select **Verify Domain**.
9. **Scan Tools:** confirm 54 tools with annotations, matching `mcp-scanner-snapshot.json`.
10. **Fill in the form:** use §I for the listing, §H for the test cases, §D for the annotation justifications, the reviewer credentials from §J, and your choice of availability.
11. Complete the attestations → **Submit for Review**. Submitting doesn't publish; you publish after approval.

## L. Shortest path to "Submitted for Review"

Verify identity → set `SUPPORT_EMAIL` and `PUBLISHER_NAME` → deploy → quick ChatGPT check → create and seed the reviewer → portal: With MCP, Universal URL → set `OPENAI_APPS_CHALLENGE` → Verify Domain → Scan Tools → fill in the form → **Submit for Review**.

## M. Post-submission backlog

- Self-serve account deletion and data export. The privacy policy currently offers both on request.
- Edit history, which would let the edit tools be marked non-destructive.
- Unify refusals to "not found", to remove the existence signal.
- Output schemas on the remaining 9 tools.
- Trim the longest descriptions (`create_pending_ensemble`, at 2,307 characters).
- Retire the two compatibility image-upload tools once no client uses them.
- A UserInfo endpoint, if workspace domain restrictions are ever needed.
- Rename `serverInfo.name` from `discriminant.ly` to `Discriminantly` for consistency.

## MCP freeze (in effect since submission)

The plugin was submitted to OpenAI for review at v2.52.7 with the submission file from commit fd09297. The MCP surface is frozen while it is under review; only web/app work is allowed.

**Frozen** (fingerprinted in `test/fixtures/mcp-freeze.json`, enforced by the `MF` tests):
- OAuth core: tokens, codes, CIMD, resource binding
- Tool contract: output schemas, the tool table, annotations
- Tool dispatcher and the `/mcp` endpoint, including server instructions and error replies
- The two MCP routes: `/mcp/<token>` (legacy) and `/mcp`
- Discovery, domain verification and OAuth routes
- Everything in `plugin/`, including `chatgpt-app-submission.json`

**Not frozen:** pages, templates, stylesheets, client scripts, settings (including the connections list), profile, welcome and policy pages.

**To lift the freeze deliberately:** make the MCP change, run `node test/mcp-freeze.js --record`, and commit the new fingerprint with a message saying why. Any MCP change also needs a fresh Scan Tools run in the portal.

**Freeze log.** 23 September 2026 (v2.54.1): the *Tool dispatcher and /mcp endpoint* fingerprint was re-recorded deliberately after removing request IDs from error replies. This is a live-result change that OpenAI's requirements allow without resubmission; errors carry no structured content, so no schema is involved. Contract changes waiting for the freeze to lift are in `docs/post-freeze-backlog.md`.

