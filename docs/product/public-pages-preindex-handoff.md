# Discriminantly public pages — pre-indexing remediation handoff

**Not deployed, merged or pushed.** One local commit, `256a894`, on the branch `public-pages-preindex`, on top of production v2.90.2 (`099c53d` in the production checkout). Railway was only read (domain list and status), never changed.

## 1. Outcome

- **Apex domain (Priority 0):** diagnosed, and **not a search-submission blocker**.
  - Every canonical link, the sitemap and robots.txt name `https://www.discriminantly.com`, so Google and Bing index the www host whatever the bare domain does.
  - The bare domain's error costs only direct visits, and any backlinks written without "www".
  - The fix is a GoDaddy domain-forwarding rule, Brian's action, about two minutes (§2).
  - The branch also carries a dormant application-level redirect, used only if the apex is ever pointed at Railway.
- **Priority 1:** all eight items done.
  - **ChatGPT:** the "Last tested" date is 8 October 2026, attributed to OpenAI's review, not to Discriminantly (§8).
  - **Claude:** 13 October 2026, Discriminantly's own read-only test.
  - **Muse:** 12 October 2026.
- **Priority 2 (dynamic sitemap):** not implemented. A scoped design and its required tests are in §9. The visibility model can support it, but two questions are Brian's to decide first.

## 2. Apex domain: diagnosis and resolution

**What the audit saw:** `http://discriminantly.com/` upgrades to `https://discriminantly.com/` and returns 502; `https://discriminantly.com/` returns 502; both `www` URLs work.

**Diagnosis:**

- **Railway:** the production `discriminantly` service has three domains:
  - `discriminantly-production.up.railway.app`;
  - `muse.discriminantly.com`;
  - `www.discriminantly.com`, verified, with a valid certificate and its CNAME propagated.
- **There is no `discriminantly.com`.** Bare-domain requests never reach the application, so no code change can redirect them.
- **Railway accepts custom domains only through a CNAME-style record.** DNS is at GoDaddy (formerly Media Temple), which does not allow one on a bare domain. That is why the site has always run on www.
- **Unread:** this sandbox's network proxy blocks the bare host and public DNS resolvers, so the apex's current record was not read.

**Impact on search:** none on submission or indexing.

- Every canonical link, the sitemap and robots.txt name `https://www.discriminantly.com`, and www serves every page.
- The cost of the bare-domain error is smaller:
  - visitors who type `discriminantly.com` get an error page;
  - any external link written that way passes nothing until the domain redirects.
- This is a beta follow-up, not a blocker.

**Recommended fix (Brian, at GoDaddy, about two minutes):**

1. GoDaddy → **My Products** → `discriminantly.com` → **DNS** → **Forwarding** → **Add forwarding** for the domain.
2. Set:
   - **Forward to:** `https://www.discriminantly.com`
   - **Type:** Permanent (301)
   - **Settings:** forward only (not masking)
3. Save, and leave the `www` and `muse` records exactly as they are.
4. After it takes effect (minutes, sometimes up to an hour), open each of these in a browser. All three should land on `https://www.discriminantly.com`:
   - `http://discriminantly.com/`
   - `https://discriminantly.com/`
   - `https://discriminantly.com/notes`

**Two known limits:**

- GoDaddy's forwarding may not carry the path through. If `discriminantly.com/notes` lands on the homepage rather than `/notes`, that is acceptable for a bare-domain fallback.
- GoDaddy now issues certificates for forwarded domains, but whether it covers `https://discriminantly.com` has not been verified from here. If the `https://` test shows a security warning, use the fallback.

**Fallback, if GoDaddy's forwarding cannot serve `https://`:**

1. Move DNS hosting (not the registration) to Cloudflare's free plan.
2. Re-create the `www` and `muse` records there exactly as they are now.
3. Then either:
   - add a Cloudflare redirect rule from the bare domain to `https://www.discriminantly.com` that keeps the path and query; or
   - attach `discriminantly.com` to the Railway service (port 8080) with a flattened CNAME, letting the dormant code redirect below handle it.

**Application-level redirect (commit `256a894`, dormant):**

- Requests whose `Host` is exactly `discriminantly.com` (any case, any port) get one hop to `https://www.discriminantly.com` + the same path and query:
  - **301** for GET and HEAD;
  - **308** otherwise, so methods are preserved.
- It is inert for `www`, `muse`, the Railway service domain and look-alike hosts, and derived from `PUBLIC_ORIGIN`.
- It does nothing unless bare-domain traffic is ever routed to Railway (the Cloudflare fallback). It is harmless to deploy, and needs no change if the GoDaddy route is used.

## 3. Changed files and routes

| File | Change |
|---|---|
| `server.js` | `APEX_HOST` and the apex redirect at the top of `handle()`; signed-out activity heading. No other hunks. |
| `public-content.js` | `together.disclosureAgent`, `together.memory`; a `desc` on the five record pages and five guides; verification fields on ChatGPT, Claude and Muse; the connect-guide memory section; one caption correction. |
| `public-pages.js` | Homepage Travel Marks line; homepage `WebPage.name`; how-it-works lede, names intro and shared-plan control line; agent-guidance privacy paragraph (page and `.md`); llms.txt disclosure line; /about memory paragraph; the platform verification section; descriptions from `desc`. |
| `public/style.shared.css` | `.pub-ctrl-wide` (full-width list item) and `.pub-tested` (last-tested line). Two rules, using existing tokens; no design-system change. |
| `test/public-preindex.js` | New: 41 checks. |

**Routes with changed output:**

- `/`, `/how-it-works`, `/about`
- `/notes`, `/check-ins`, `/collections`, `/itineraries`, `/warrants`, `/travel-marks` (the caption only)
- `/ai/chatgpt`, `/ai/claude`, `/ai/muse`
- the five guides
- `/agent-guidance`, `/agent-guidance.md`, `/llms.txt`
- `/activity`, signed out only

**Behaviour:** apex-host requests only, which do not currently reach the application. No route was added or removed.

## 4. Copy changes, before → after

| Where | Before | After |
|---|---|---|
| Homepage, What you keep, Travel Marks | Places worth returning to. | Places worth remembering or considering. |
| /how-it-works lede | Eight steps, from noticing something to returning from a trip. Each one leaves a record you can see, adjust and use. | Eight steps, from noticing something to returning from a trip. They show how your records are created, organized, used and checked; not every step creates a new one. |
| /how-it-works, The names | Each step leaves a record with a name. | Six kinds of record, each with one meaning. |
| /how-it-works, Evidence and control (new list item) | — | **Shared plans**: If a private travel mark is added as a stop, the place details in the shared plan (its name and address) may become visible to collaborators, after you confirm. The originating mark, your private commentary and the rest of your record remain private. *(the homepage sentence, verbatim)* |
| /agent-guidance and `.md`, Privacy, visibility and revocation | …Private records are visible only to the member and to clients the member has connected. A shared itinerary shows its places to participants, never the rest of a member's record. Revoking… | …A private record is visible to the member and to clients the member has connected, with one disclosed exception: A private Travel Mark remains private. If it is added as a Stop in a shared itinerary, its place name and address may become visible to collaborators after the member confirms. The originating mark, private commentary and unrelated records remain private. Revoking… |
| /llms.txt, Evidence and control (new bullet) | — | A private Travel Mark remains private. If it is added as a Stop in a shared itinerary, its place name and address may become visible to collaborators after the member confirms. The originating mark, private commentary and unrelated records remain private. |
| /about, Why it exists (new paragraph) | — | Unlike generic AI memory, Discriminantly is an inspectable record you control, in its own application. It is independent of any one AI client, uses named record types with visible provenance, and lets you connect or revoke each assistant separately. |
| /guides/connect-an-ai-assistant (new section) | — | **How this differs from an assistant's own memory.** Unlike an assistant's built-in memory, Discriminantly is a record you can inspect and control, in its own application. It does not belong to any one assistant: it uses named kinds of record with visible provenance, and you connect or revoke each assistant separately. |
| /activity, signed out | Activity from the entire network | Public activity |
| /travel-marks, form caption (from v2.90.1) | …the reason it is worth returning to is the member's own… | …the reason for keeping it is the member's own… |

**/ai/chatgpt, new under Verify it:**

- **Prompt:** "@Discriminantly List my saved Travel Marks. Don't add or change anything."
- **What you should see:** ChatGPT uses Discriminantly and lists the travel marks you have kept, private ones included, because the connection is yours. Nothing in your account changes. ChatGPT may ask you to confirm before it uses the plugin.
- **If access is refused or nothing comes back:**
  - Reconnect and sign in again; the connection may have been revoked in Settings.
  - Start the request with @Discriminantly.
  - Check that you signed in with the right account; a new account has no records.
  - Otherwise, contact Support.
- **Disconnecting:** Revoke beside ChatGPT in Settings › Connect to your AI. Access ends immediately and nothing is deleted. Removing the plugin in ChatGPT does not by itself revoke Discriminantly's side.
- **Status note:** The plugin's approval and directory listing are OpenAI's. Discriminantly has not yet recorded a dated test of its own on ChatGPT.
- **Last tested 8 October 2026, by OpenAI, during its plugin review:** its review account connected through the plugin, read its records and updated them, turning a kept place into a stop in a plan and recording a visit.

**/ai/claude, new under Verify it:**

- The same structure, adapted to Claude:
  - Turn the connector on in the chat (+ › Connectors).
  - Reconnect from Claude's connector settings.
  - Revoke beside Claude.
- **Last tested 13 October 2026, by Discriminantly:** the read-only prompt above, run through a Claude custom connector, returned the member's travel marks and changed nothing.
- **Status note:** This is Discriminantly's own testing. Anthropic has not reviewed or listed the connector.

**/ai/muse:**

- Its verify text is unchanged.
- Added: **Last tested 12 October 2026, by Discriminantly:** connection, reading and writing through a key were verified live.
- Added the status note: Discriminantly's own testing; submitted 13 October 2026; in review; not yet approved or directory-listed.

## 5. Metadata and structured data

- **Homepage `WebPage.name`:** "Welcome" → "Discriminantly — Your interests, travels and plans".
  - This is a general fix in the page template: `name` now uses the page's full title where one is set.
  - The homepage is the only page with a full title, so no other page's `name` changed.
  - Organization `#org` and WebSite `#site` are unchanged.
- **Meta descriptions:** authored, complete sentences of 138–157 characters. Each is also the description used by OG, Twitter and the guide `Article`:

| Page | New description |
|---|---|
| /notes | A note keeps an object, maker or idea worth remembering, with your reason. It does not mean you own, like or recommend it; those are separate records. |
| /check-ins | A check-in records that you actually visited a place, on a date or for a stay. It belongs to a travel mark and is added only when you say you went. |
| /collections | A collection groups notes or travel marks under a name you choose, such as a city, a theme or a trip. It organizes records and implies nothing else. |
| /itineraries | An itinerary arranges places and ideas into days and stops. It is a plan, private until shared, and never a record that the trip happened. |
| /warrants | A warrant is a deliberate endorsement of a note or travel mark. It is never inferred from praise, ownership or visits, and you can withdraw it. |
| /guides/keep-objects-and-interests | Keep things as notes and places as travel marks, each with your reason, and group them into collections. Owning and endorsing are separate records. |
| /guides/remember-places | Save a place as a travel mark, worth remembering or considering, with its address looked up. Going is a separate check-in, so saving never claims a visit. |
| /guides/plan-from-what-you-keep | Start an itinerary from the travel marks you keep, add places you are considering, and arrange them into days. A plan is kept, never a record of going. |
| /guides/share-or-build-an-itinerary-together | Share a view-only link that others can copy, or invite people to build the same plan with you. They see the plan's places, not the rest of your record. |
| /guides/connect-an-ai-assistant | Connect ChatGPT, Claude or Muse to your Discriminantly record, see what a connected assistant can access, how its changes are recorded, and how to revoke it. |

**Unchanged:** canonicals, robots, Open Graph images, cards, the sitemap (still 25 URLs) and every other JSON-LD node.

## 6. Tests and route checks

| Check | Result |
|---|---|
| `test/public-preindex.js` (new) | **41 passed, 0 failed** |
| — apex (application redirect, dormant in production): http and https × `/notes?x=1&y=2` and `/` (with port) | all 301 to the same path and query on `https://www.discriminantly.com` |
| — apex: POST `/mcp` (uppercase host) | 308, method preserved; HEAD 301 in one hop |
| — www, muse, look-alike host | not redirected; no loop |
| — `/welcome` | 301 to `/`, query kept |
| — signed-out `/` | public homepage |
| — signed-in `/` | application home; `private, no-store`; its heading unchanged |
| — sitemap | 25 URLs, all on the canonical origin, all 200 |
| — JSON-LD | parses on all 25 public pages; every URL absolute |
| — homepage `WebPage.name` | not "Welcome" |
| — agent guidance (page and `.md`) and llms.txt | carry the identical disclosure; no unqualified "visible only" claim |
| — ChatGPT, Claude and Muse status claims | distinct and as specified |
| — descriptions | none truncated; all unique |
| — private-record canary | a real, adopted private note: absent from all 25 pages, the sitemap, llms.txt and agent-guidance.md; its card and its page 404 |
| Public-page validator (pass-2 suite) | **251 passed, 0 failed** |
| MCP freeze guard | identical |
| MCP contract: founder, other member, historical | match v2.61; nothing removed; OAuth, discovery and shared result shapes unchanged |
| itinerary, activation, collaboration, account-delete, connections-past | 488, 56, 113, 22, 12: all pass |
| adoption, recommendations, tool-audit, increment4, place-identity, skills-import | 73, 43, 29, 41, 45, 28: all pass |
| lifecycle | 76 passed, 1 failed, **identically on production code** (pre-existing fixture-order sensitivity; not caused by this branch) |
| Page parity against production v2.90.2, 108 views | **106 identical**. The 2 differences are the anonymous homepage (`/` and `/?feed=all`), from the intended Travel Marks line and `WebPage.name`. Every profile, note, mark, owner view and the signed-in home is byte-identical. |

## 7. Muse reviewer corpus: untouched

This branch makes no change to the reviewer account, its key, its records, their visibility, metadata, provenance or cards, and adds no username-specific logic.

The staged diff was searched for `musereview`, `Muse test`, `api_token`, `token_hash`, migrations, `CREATE`/`ALTER TABLE`, `function mcp`, `/oauth` and the tool definitions. **No matches.**

No production data was written. The only production interaction was one read-only `my_travel_marks` call through Brian's own Claude connector, for the Claude test date.

## 8. Platform claims and their evidence

- **ChatGPT "Last tested": 8 October 2026, by OpenAI during its plugin review.**
  - **Source:** the activation panel for OpenAI's review account (cohort: test), from a screenshot Brian supplied. It shows:
    - AI connected: 21 September 2026, 10:40 PM EDT;
    - returned and acted: 8 October 2026, 9:28 PM EDT;
    - intention became experience (a visit recorded): 9:29 PM;
    - first reuse (a kept place became a stop in a plan): 9:30 PM.
  - OpenAI approved the plugin the next day (9 October 2026).
  - **Labelled as OpenAI's test on the page, not Discriminantly's.** The page also says Discriminantly has not yet recorded a dated test of its own on ChatGPT.
  - **Optional:** if Brian runs the page's read-only prompt in ChatGPT himself, change the date, set `lastTestedBy` to Discriminantly, and drop that sentence. All three are fields on the ChatGPT entry in `public-content.js`.
- **ChatGPT "Listed in ChatGPT's plugin directory":** kept as is. The brief asks to verify it against the current ChatGPT surface; that needs a signed-in ChatGPT session I don't have. Brian, please confirm when you run the test above.
- **Claude 13 October 2026:** a real test. This session is a Claude client connected through a claude.ai custom connector; the read-only call returned travel marks and changed nothing.
- **The earlier v2.51 Claude validation:** the record does not date it. The git history from before the workspace reset is gone, so it is not cited as a date.
- **Muse 12 October 2026:** from the project record (live connection, read and write through a key).

## 9. Priority 2: privacy-safe dynamic sitemap (recommended design; not implemented)

**Why not now:** both reasons are product decisions, not technical gaps.

1. **Consent scope.** "Public" currently means visible to other members and anyone with the link. The privacy policy does not say that public records are submitted to search engines. Listing members' profiles and records in a sitemap invites indexing beyond what members agreed to. Brian should decide whether public means indexable (and say so in the policy) or add a per-member opt-in.
2. **The frozen reviewer corpus.** A dynamic sitemap would list the musereview profile and its synthetic records, actively submitting them to Google and Bing during Meta's review. Excluding them would need the username-specific logic this brief forbids. Waiting until after approval avoids the dilemma.

**Design, once decided:**

- **Shape:** a sitemap index at `/sitemap.xml` pointing to the existing static sitemap (renamed `/sitemap-pages.xml`), plus `/sitemap-records.xml`, generated per request with a short public cache (`max-age=3600`, with `Vary: Cookie` not needed because it is never personalised).
- **Inclusion:** reuse the existing signed-out visibility checks rather than writing new SQL predicates:
  - profiles with at least one public adopted record;
  - adopted notes and marks with `private=0`, each passed through `canView(type, row, null)`;
  - collections through the same check as `/u/<handle>?c=`;
  - itineraries only where `canView('itinerary', it, null)` is true.
- **Always excluded:**
  - `/s/…` share links and `/j/…` invitations;
  - anything requiring a session;
  - ensembles that are private or pending.
- **`lastmod`:** taken from the record's own updated timestamp. No counts, totals or other members' data in the file.
- **Removal is automatic:** the file is computed per request, so a record that becomes private or is deleted drops out on the next fetch (after at most the cache age).
- **Tests required before shipping:**
  1. A private note, mark and itinerary, and a share-link-only itinerary, are absent.
  2. Flipping a public record to private removes it within the cache window.
  3. Deleting a record, and deleting an account, removes all their URLs.
  4. Every listed URL returns 200 signed out, with a canonical equal to the listed URL.
  5. The file contains no handle without a public record, and no counts.
  6. A sitemap fetched with a session cookie is byte-identical to one fetched without.
  7. Every record URL in the file returns the same `noindex` state as the page it points to: none listed carry `noindex`.

## 10. Remaining items

**Search-submission blockers:** none. Submission can proceed with the www sitemap once this branch is deployed.

**Beta follow-ups:**

- The bare-domain forward at GoDaddy (§2): a two-minute owner action; the Cloudflare fallback only if the `https://` test fails.

- A directory-listing check for ChatGPT (§8); optionally, Discriminantly's own read-only ChatGPT test.
- The operator's name on the policy pages, from `PUBLISHER_NAME` (flagged since v2.89.2).
- The hero and activity captures show the founder's own records.
- AI-hub phone screenshots with the old handle.
- `/about` still says "the places you mean to return to". This is authored copy, kept per the brief; reword it if the visit implication matters there too.
- `/how/*.jpg` desktop screenshots to WebP.
- The lifecycle fixture-order failure (pre-existing).

**Later opportunities:**

- The dynamic record sitemap (§9), after the consent decision and Meta's approval.
- An edge cache in front of Railway.
- The AEO baseline run in `indexing-prep.md`, after submission.

## 11. Commit

- **Branch:** `public-pages-preindex`.
- **Commit:** `256a894` (this handoff is committed on top of it).
- Not pushed, merged or deployed.
