# Independent AI startup identity — review report

**Not deployed, merged, pushed or published.** Local commit `a7a4514` on branch `public-pages-identity`, branched from production v2.92 (`031733e`, which includes the approved cold-start and value work).

## 1. Changed files and content entries

| File | Change |
|---|---|
| `public-content.js` | Three new `site` entries: `identity` (visible statement), `identityFormal` (machine-readable statement), `architecture` (the clarification that follows it). |
| `public-pages.js` | /about "Who makes it" paragraph; /about meta description; an Organization `description` added on /about only; one sentence on /ai; a new first entry in agent guidance (page and `.md`); a line near the top of llms.txt. |
| `test/public-coldstart.js` | Seven identity checks. |

`server.js`, the CSS, `plugin/plugin.json`, the legal pages and the homepage are not in the diff.

## 2. Before and after

### /about — "Who makes it" (heading "Made independently." unchanged)

**Before:**

> Discriminantly is designed, built and operated independently, by one person, as a personal project that others are welcome to use. It carries no advertising and sells no data. Questions, requests and problems go to the address on the Support page.

**After:**

> Discriminantly is an independent AI startup building a personal record controlled by the person—not the model they happen to use. It is deliberately built and operated, and is not owned by or tied to any one AI platform. That is what lets the record live in Discriminantly while ChatGPT, Claude, Muse and other compatible assistants work with it as authorized clients, each connected and revoked by the member. It carries no advertising and sells no data. Questions, requests and problems go to the address on the Support page.

"A personal project that others are welcome to use" is removed: it contradicted the startup identity and read as the "hobby project" framing the brief rules out. "By one person" is removed for the same reason (size language). Nothing about the founder is added.

### /ai — "No record needed to begin", second paragraph

**Before:**

> …Discriminantly holds the durable record: what you keep, what you plan, and where each came from. ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning.

**After:**

> …Discriminantly holds the durable record: what you keep, what you plan, and where each came from. **Because the record is independent of any one AI assistant, you can authorize compatible clients to work with the same Discriminantly account.** ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning.

### Agent guidance (/agent-guidance and /agent-guidance.md) — new first entry

> **About Discriminantly.** Discriminantly is an independent AI startup and an AI-connected personal record for interests, places, travels and plans. The record is held by Discriminantly. AI platforms are authorized clients of it rather than owners of its semantics.

### llms.txt — new line after the summary

> Discriminantly is an independent AI startup and an AI-connected personal record for interests, places, travels and plans. The record is held by Discriminantly. AI platforms are authorized clients of it rather than owners of its semantics.

## 3. Where "independent AI startup" appears

- **Visible, once:** /about, the first sentence of the "Who makes it" section ("Made independently."), below "Where it came from" and above "What it is not".
- **Machine-readable:** the /about meta, Open Graph and Twitter descriptions; the Organization `description` in /about's JSON-LD; llms.txt; agent guidance (page and `.md`). The page version of agent guidance shows it as visible text too, which is the point of that page.
- **Not anywhere else:** a test checks the homepage body and title, and the descriptions of the other 19 public pages, for "startup" or "indie".

## 4. The formal machine-readable formulation

> Discriminantly is an independent AI startup and an AI-connected personal record for interests, places, travels and plans. The record is held by Discriminantly. AI platforms are authorized clients of it rather than owners of its semantics.

It is used verbatim in llms.txt, agent guidance (page and `.md`), and the Organization `description` on /about.

## 5. "Indie" versus "independent"

"Indie" is not used anywhere. The brief allows it conversationally, but every placement here is either a formal statement or machine-readable, where "independent" is the stated preference. The site has no conversational, founder-voice surface where "indie" would sit naturally. A test checks that it does not appear.

"**Controlled by** the person" was chosen over "belongs to the person". The terms say members "keep whatever rights you have in what you add", and grant Discriminantly a licence to store and process it. "Belongs to" would read as a stronger ownership claim than that. "Startup" was kept rather than "company": the legal operator in the privacy policy and terms is an individual, and "startup" does not imply incorporation.

## 6. Metadata and structured data

| Where | Before | After |
|---|---|---|
| /about meta, Open Graph and Twitter description | What Discriminantly is, why it exists, where it came from and who makes it. | Discriminantly is an independent AI startup building a user-controlled personal record across compatible AI assistants. |
| /about JSON-LD | Organization node with name, url and logo | The same node, plus a `description` (the formal statement), added on /about only. The Organization node on other pages is unchanged. |

**Unchanged:**

- every other title and description, including the homepage's;
- object pages, AI-client pages and legal pages;
- the FAQ and its FAQPage data on /ai;
- `plugin/plugin.json`.

There was no existing press boilerplate or company summary in the repository to revise, and none was created.

## 7. Screenshots

`shots/`: /about "Who makes it" and /ai "No record needed to begin", at 1440 px and 390 px. Local build; the sandbox blocks the type CDNs, so the serif is the browser fallback.

## 8. Validation and regression

| Check | Result |
|---|---|
| `test/public-coldstart.js` | **47 passed, 0 failed**, including seven new identity checks. |
| Public-page validator (routes, internal links, anchors, metadata, JSON-LD, menu, header) | 252 passed, 0 failed |
| `test/public-preindex.js` | 41 passed, 0 failed |
| MCP freeze guard | identical |
| MCP contract: founder, other member, historical | match v2.61; nothing removed |
| itinerary, activation, collaboration, account-delete, connections-past | 488, 56, 113, 22, 12: all pass |
| adoption, recommendations, tool-audit, increment4, place-identity, skills-import | 73, 43, 29, 41, 45, 28: all pass |
| lifecycle | 76 passed, 1 failed: the known pre-existing failure |
| Page parity against production v2.92, 108 views | **108 identical**. The homepage and all application pages are byte-for-byte unchanged. |

**The seven identity checks:**

1. /about states the identity exactly once, inside "Who makes it".
2. /about's meta description and Organization description.
3. The formal statement in llms.txt and in agent guidance (page and `.md`).
4. /ai uses "independent" once, as the architectural sentence.
5. "Startup" and "indie" are absent from every other page description, the homepage body and the homepage title.
6. None of these appear on any public page: "indie", "AI company", size language (small team, tiny, hobby, scrappy, underdog, bootstrapped), open-source or open-framework, "model-agnostic", "AI wrapper".
7. The homepage still has seven sections and no badge.

## 9. Confirmations

- No new homepage section and no badge. The homepage is unchanged (parity 108/108).
- Preserved: the cold-start explanation, the capture, cross-AI, accumulated-value and control story, the Kyoto illustration, the FAQ and its structured-data parity, the record semantics, every AI-client fact and status, the Muse reviewer corpus, authentication, MCP and application behaviour.
- No claim of universal compatibility, open source, incorporation, independence guaranteeing privacy, or provider training practices. Perplexity is not named.
- Nothing was deployed, merged, pushed or published.
