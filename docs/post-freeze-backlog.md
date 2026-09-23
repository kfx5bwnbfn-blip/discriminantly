# Post-freeze backlog — banked MCP changes

Changes that alter the submitted MCP contract (tool definitions, input or output schemas, annotations, or new tools). They're held until the MCP freeze lifts. Everything here was decided or designed during the review period, with nothing built into the frozen surface.

Last updated: 23 September 2026, at v2.54.1.

## How to ship them

The route depends on where the plugin is, according to OpenAI's review requirements:
- **Still in review:** any contract change means **Cancel Review** in the portal, then deploy, **Scan Tools**, update and re-drag `plugin/chatgpt-app-submission.json`, and resubmit.
- **After publication:** deploy. Continuous review re-checks changed tools, and each change goes live once it passes automated checks. Until then, the old definition stays live, so the server must keep accepting the old inputs.
- **Either way:**
  - **The freeze fingerprint:** re-record it deliberately with `node test/mcp-freeze.js --record`, committed with a message saying why.
  - **The submission file:** keep `plugin/chatgpt-app-submission.json` in step with the server.
  - **The origin:** never change `https://www.discriminantly.com`; a new origin means a new plugin.

Changes to *live results only*, such as reply text or result `_meta`, don't need any of this, as long as the contract is preserved. v2.54.1 was one of those.

---

## B1. Timestamps and other members' handles in tool results
**Why:** OpenAI's review guidance lists timestamps and personal identifiers as data to return only when strictly necessary.
- **What we return today:**
  - **Timestamps:** `created_at` from 10 tools, `updated_at` from `get_ensemble`, and `since` from `my_notes`, `my_travel_marks` and `search_catalogue`.
  - **Other members' handles:** from `recent_notes` and `read_comments`.
- **Why it waits:** every one of these fields is **required** by the published output schemas, so removing any of them is a contract change.
- **Proposal:**
  - **Timestamps:** make them optional, and keep one only where the member's request is about time ("what did I save last week"), for example as a date rather than a full timestamp.
  - **Handles:** keep them where attribution is the point (who wrote a public note or comment), and document that on the Privacy page (done in v2.54.1).
- **Disclosure:** the Privacy page already describes what assistants receive, so this is data minimisation, not a disclosure gap.

## B2. `openWorldHint` scope — decision needed
**Why:** OpenAI's wording sets open-world as reaching the public internet or open-ended external entities, *including* write tools that post to public platforms or publish content. It's false for "a bounded private account or workspace, even when that service is externally hosted".
- **Today (v2.52.6):** 32 open-world tools. That includes edits and deletions on records that are or can be public, such as `delete_checkin`, `update_itinerary_temporal` and `remove_ensemble_component`.
- **Option:** narrow it to OpenAI's wording.
  - **Keep open-world:** tools that reach the internet (Photon, fetching images) and tools that publish or post (create public content, publish, comment, warrant).
  - **Make closed-world:** tools that only modify or remove existing content.
- **Only if:** review flags a mismatch, or at the next version. It reverses the v2.52.6 decision, so it needs Brian's call. The annotation justifications would change with it.

## B3. Common-sense duplicate detection (ontology D2)
**Goal:** convenience and hygiene of each member's *own* catalogue. It isn't about reconciling real-world places.
- **Today:** `findSimilarMark` treats one name containing another as a duplicate ("Hatchards St Pancras" vs "Hatchards"), and only the AI path checks at all.
- **Rule:**
  - match within the member's own marks only;
  - equal normalised names are candidates;
  - a name merely *containing* another is not enough on its own;
  - different localities keep two marks distinct, as do coordinates far apart when both have them;
  - keep "unchanged" plus `allow_duplicate` as the escape.
- **Web:** use the same rule for mark creation there. That half can ship at any time.
- **Why it waits:** it changes what `add_travel_mark` does, so it waits with the other MCP work.

## B4. Stop → Note through AI (v2.54.0 built the domain and web)
The domain functions already exist: `stopNoteAttach(user, stopUid, noteUid, ctx, { origin })`, `stopNoteDetach`, `stopNotesVisible`.
- **`my_itineraries`:** add `notes: [{ uid, name, url, image_uid, private }]` to each stop, visible notes only. This changes the stop object in the output schema (currently no extra fields are allowed), and the same stop shape appears in `add_itinerary_stops`, `arrange_itinerary` and `resolve_itinerary_stop`.
- **New `attach_stop_note`:** takes `{ stop_uid, note_uid }`, or `{ stop_uid, headline, link, image, identity_basis, ... }` to create or reuse. The create-or-reuse path:
  1. `findExistingNote()` looks in the member's own notes (by uid, then link, then exact name);
  2. otherwise `noteCreate()`, **only** if `identity_basis` is in `QUALIFYING_BASIS`;
  3. then `stopNoteAttach(..., { origin: 'created' | 'existing' })`, acting as the AI on the member's behalf.

  A vague category ("Kona coffee") never creates a note. **Annotations:** write; open-world (it can add visible content to a published itinerary); not destructive.
- **New `detach_stop_note`:** takes `{ stop_uid, note_uid }`. **Annotations:** write, open-world, destructive (it removes the relationship).
- **Tests:** attaching through AI is recorded as `ai_on_behalf` (not exercisable until this tool exists), and create vs reuse is recorded correctly.
- **Submission file:** add the tools, their justifications, and a positive test case.

## B5. Unresolved destination objects (proposal, not designed in detail)
- **Scope:** things identified only loosely ("Kona coffee") that shouldn't become notes.
- **Proposal:** mirror ensemble components. An unresolved child of a stop keeps its own label and source link, with state `unresolved`. It becomes a note, and a stop-note attachment, only when qualifying evidence arrives.
- **Today:** a stop's own wording, or its "particular" kind, already holds such an intention. Decide before B4 whether this is needed.

## B6. Integer ids alongside uids (consideration)
- **Today:** results return both an integer `id` and a `uid`, and many tools take the integer `id` as input.
- **Why it matters:** our ontology treats integer ids as internal join keys, and OpenAI's guidance discourages internal identifiers.
- **Why it's lower priority:** they're functional inputs, so they're justifiable. Moving to uid-only would be a large contract change; consider it only alongside a major version.

## B7. Codex test runs (not code)
OpenAI requires test cases to pass on the ChatGPT **and Codex** surfaces where the plugin is available. If the submission includes Codex, run the five positive and three negative prompts there as the reviewer.

---

## Shipped during the freeze, for reference
These are web, database or live-result changes that left the contract unchanged:
- **v2.52.8:** the profile feed's visibility now matches its tabs.
- **v2.53.0:** the admin view became a setting, web only.
- **v2.53.1–v2.53.2:** the history now records check-ins, comments and day notes removed along with their parent, and collection names no longer leak.
- **v2.53.3:** admins can change their username, and the Admin section moved under Install.
- **v2.54.0:** notes as children of stops, in the web app and domain.
- **v2.54.1:** request IDs removed from error replies (live results; the freeze fingerprint was re-recorded deliberately). The Privacy page now discloses location, server logs and what assistants receive.
