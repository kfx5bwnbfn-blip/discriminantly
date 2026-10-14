# Cold-start recommendation and planning story — review report

**Not deployed, merged, pushed or published.** Local commit `9089e1c` on branch `public-pages-coldstart`, on top of production v2.91.3.

## 1. What caused the misunderstanding

Three sources taught "a corpus first, then plans", and none of them said otherwise:

1. **The homepage told one story, in order.** The proposition ended on "receive recommendations shaped by what you have kept and experienced". The illustrative example ran keep → mark → visit → ask, and its summary said "The assistant starts from what was kept and recorded". The capabilities list said "Recommendations from evidence, not a guess about you" and "Plans from places you already keep". Every planning sentence on the page had a saved record as its subject.
2. **How it works read as a pipeline.**
   - The lede said "Eight steps, from noticing something to returning from a trip".
   - Step 5 was "Use saved and newly considered places in an Itinerary".
   - Step 7 said an assistant can "find what you have kept … and plan from it".
3. **The ChatGPT directory listing**, which a crawler weighs heavily, is corpus-first in its own words:
   - Long description: "plan a trip with an itinerary built from the places you already know".
   - Third suggested prompt: "Plan a weekend from the places I have saved in Lisbon."

   Gemini's sentence ("Once you have a curated list of saved items…") is close to a paraphrase of these.

The site never said a record was optional, so a model summarising it had nothing to correct the inference with.

## 2. Files and content entries changed

| File | Entries |
|---|---|
| `public-content.js` | `site.proposition[1]`; `objectPages.itinerary.what` and `.ai`; `steps[4]` (step 5) title and body; `steps[6]` (step 7) title and body; the `plan-from-what-you-keep` guide's `answer` and a new first section; the `connect-an-ai-assistant` guide's `answer`; new `faq` (two entries); a new first entry in `questions`; `asks` on all four platforms; `asksNote` on Other. |
| `public-pages.js` | Homepage: example framing line, example summary, two capability lines, AI-section paragraph. How it works: lede, HowTo description, card line. /ai: new "No record needed to begin" section, FAQ section, FAQPage JSON-LD, lede, closing caption, meta description. Platform pages: new "What you can ask" section. Agent guidance: new "Starting with an empty record" entry. llms.txt: cold-start sentence and a "Frequently asked" section. |
| `public/style.shared.css` | Styles for the FAQ list, the example-request list and the framing line, using existing tokens. No layout or design-system change. |
| `test/public-coldstart.js` | New, 30 checks. |
| `test/public-preindex.js` | One assertion updated to the new how-it-works lede. |

**Routes with changed output:**

- `/`, `/how-it-works`, `/ai`
- `/ai/chatgpt`, `/ai/claude`, `/ai/muse`, `/ai/other`
- `/itineraries`
- `/guides/plan-from-what-you-keep`, `/guides/connect-an-ai-assistant`
- `/about` (the shared proposition)
- `/agent-guidance`, `/agent-guidance.md`, `/llms.txt`

## 3. Before and after

### Homepage

| Where | Before | After |
|---|---|---|
| Proposition (also on /about and in llms.txt) | …Recall, organize and refine your taste corpus in Discriminantly—or connect it to AI to add to it conversationally and receive recommendations shaped by what you have kept and experienced. | …Recall, organize and refine your taste corpus in Discriminantly—or connect it to AI to add to it conversationally, ask for recommendations and make plans from a direct request. What you have kept and experienced gives them sharper direction over time. |
| Example section, under "Kept over time. Then used." (new line) | — | One workflow, not a required order. You can also begin with a direct request and nothing kept. |
| Example summary | The assistant starts from what was kept and recorded. The plan is saved in Discriminantly, shared or built with others, and the next trip starts from more. | An assistant can start from your request alone. When you have relevant records, it can use that evidence to make the plan more personal. The plan is saved in Discriminantly, shared or built with others, and the next trip has more to draw on. |
| Capabilities | **Recommendations from evidence**, not a guess about you. | **Recommendations from what you ask for**, sharpened by the evidence you have accumulated. |
| Capabilities | **Plans from places you already keep**, with new ones added. | **Plans can start fresh**, use places you already keep, or combine both. |
| "Use it with AI" | Connect it; revoke it any time. What it adds appears here, recorded as that assistant acting for you. | Ask it for recommendations or a plan from the first request; what you keep gives later ones more direction. Connect it; revoke it any time. What it adds appears here, recorded as that assistant acting for you. |

The proposition was marked "approved, verbatim" in the content file. It is changed here because this brief names it as a corpus-first line. The illustrative example itself (Hagi teabowl → Kissa Hoshikawa → Kyoto plan) is unchanged, as the brief allows; the framing line above it and the summary below it carry the correction.

### How it works

| Where | Before | After |
|---|---|---|
| Lede | Eight steps, from noticing something to returning from a trip. They show how your records are created, organized, used and checked; not every step creates a new one. | Eight ways Discriminantly helps you keep, organize, discover and plan. You can begin with something worth remembering or start with a destination and a direct request—an existing record is not required. |
| Step 5 title | Use saved and newly considered places in an Itinerary. | Build an Itinerary from a direct request, places you already keep, or both. |
| Step 5 body | Arrange places into days and stops. A plan can start from places you already keep, and bring in new ones you are considering. Adding a place to a plan keeps it as a mark; it does not make it a visit. | Start with a destination, interests and constraints, even if your record is empty. A connected AI can recommend places and arrange them into days and stops. When relevant records already exist, they help shape the plan's direction. Adding a place to a plan keeps it as a mark; it does not make it a visit or an endorsement. |
| Step 7 title | Let an authorized assistant retrieve relevant evidence and act for you. | Let an authorized assistant recommend, plan and act for you. |
| Step 7 body | Connect the AI you already use. It can find what you have kept, add to it when you ask, and plan from it. Every change it makes is recorded as that assistant acting for you. | Connect the AI you already use. It can recommend new places and build plans from what you ask. When you have relevant records, it can retrieve them, with your authorization, to sharpen the recommendations and connect new possibilities to what already matters to you. Every change it makes is recorded as that assistant acting for you. |
| HowTo description (JSON-LD) | Eight steps, from noticing something to returning from a trip. | Eight ways Discriminantly helps you keep, organize, discover and plan. They are not a required order; an existing record is not required to plan. |
| Social card line | Eight steps, from noticing something to returning from a trip. | Eight ways to keep, organize, discover and plan. Start anywhere. |

### /ai

| Where | Before | After |
|---|---|---|
| Lede | Your record stays here. The assistant you already use can retrieve from it and add to it, once you authorize it. | Your record stays here. Once you authorize it, the assistant you already use can recommend and plan from what you ask, draw on your record to sharpen the result, and keep what you choose. |
| New section, first on the page | — | **No record needed to begin.** You do not need an existing Discriminantly record to begin. Ask your assistant for recommendations or a plan from a destination, interests and constraints. As you keep places, objects and experiences, that record gives later recommendations more personal direction. / Recommendations and conversational planning happen in the assistant you connect. Discriminantly holds the durable record: what you keep, what you plan, and where each came from. |
| New FAQ, before the platform chips | — | The two questions and answers from the brief, verbatim. |
| Closing caption | …An assistant you have authorized can retrieve from it and add to it… | …An assistant you have authorized can recommend and plan from what you ask, retrieve from your record and add to it… |
| Meta description | Connect Discriminantly to ChatGPT, Claude, Muse or another AI assistant. Availability, connection method, authentication and directory status for each, with a guide per platform. | Connect ChatGPT, Claude, Muse or another AI to Discriminantly. No saved record is needed: ask for recommendations or a plan, and what you keep sharpens later ones. |

The second paragraph of the new section keeps the boundary the brief asks for: recommendations come from the connected assistant, not from a hidden engine in the app.

### Platform pages (new "What you can ask" section, above "Verify it")

- **Intro (all four):** "An empty account can begin with recommendations and planning; it simply has no records of yours to contribute yet. As you keep things, requests can draw on them."
- **ChatGPT examples:**
  - *Start from a request:* "@Discriminantly Plan two days in Naples around classic cafés, pizza and tailoring."
  - *Use what you have kept:* "@Discriminantly Plan a weekend in London using places I've kept, and recommend a few complementary additions."
  - *Keep something:* "@Discriminantly Keep Hatchards in London for me."
- **Claude, Muse and Other:** the same three requests, phrased without the ChatGPT `@` mention and naming Discriminantly in the sentence.
- **Footnote (all four):** "Suggested places stay recommendations until you keep them. A plan is not a record of going."
- **Other only:** "Whether a given client uses Discriminantly for a request, and how, varies by client and model. Test with your own."
- **Unchanged on ChatGPT:** the read-only verification request.
- **Unchanged on every platform page:** statuses, testing dates, connector facts and setup steps.

### Itineraries, guides, agent surfaces

| Where | Before | After |
|---|---|---|
| /itineraries, what it is | …A plan can start from places you have already kept, and it can be shared or built with others. | …A plan can start from a direct request, from places you have already kept, or both, and it can be shared or built with others. |
| /itineraries, with an AI | A connected assistant can start a plan, build one from what you have kept, add and arrange stops… | A connected assistant can build a plan from a destination and what you ask for, even with an empty record, or draw on places you have kept, or combine both; it can add and arrange stops… |
| Plan guide, answer | …then bring in new places you are considering. A connected AI can build the first draft from your record:… | …then bring in new places you are considering. You do not need any saved places to begin: a connected AI can plan from a destination and what you ask for alone. When you do have a record, it can build the first draft from it:… |
| Plan guide, new first section | — | **No saved places yet.** An empty record is not a barrier. Ask a connected assistant for a plan from a destination, your interests and any constraints; it recommends places and arranges them into days. Those places stay recommendations until you keep them. As your record grows, later plans have more of your own evidence to draw on. |
| Connect guide, answer | …Once connected, the assistant can read your record, including private items, and act on it when you ask. | …Once connected, the assistant can recommend and plan from what you ask, even before you have kept anything; read your record, including private items, to sharpen the result; and keep what you choose. |
| Agent guidance (page and .md), new entry | — | **Starting with an empty record.** A member does not need any saved records to receive recommendations or a plan. An authorized client can recommend places and build an itinerary from a destination, interests and constraints. Where relevant records exist, retrieve them to sharpen the result; do not claim the member has kept, visited or endorsed anything they have not recorded. |
| llms.txt, "Using it with an AI client" | Your record stays in Discriminantly… | No existing record is required: through a connected AI client a member can ask for recommendations or a plan from a destination, interests and constraints, and existing records sharpen the result over time. Recommendations remain recommendations until the member keeps them. Your record stays in Discriminantly… |
| llms.txt | — | A new "Frequently asked" section with the two FAQ entries, and the first question added to "Questions these pages answer", linked to `/ai#faq`. |

## 4. Metadata and structured data

- **The authoritative first-party statement is /ai.** In crawlable text, its meta description and Open Graph description, and its FAQPage, it says plainly that:
  - no existing record is required;
  - recommendations and plans come through a connected AI;
  - what the member keeps sharpens later results.
- **`FAQPage` on /ai only.** It is built from the same `faq` strings as the visible list, so the two cannot drift. A test asserts an exact match; no other page carries FAQ markup.
- **`HowTo` description on /how-it-works** now says the steps are not a required order.
- **Wording varies by page:** the canonical sentence appears in substance on each page in different words, not repeated verbatim.

**Unchanged:**

- titles, canonicals, robots;
- Organization and WebSite identities;
- every other page's description.

## 5. Screenshots

`shots/` holds desktop (1440 px) and mobile (390 px) captures of every changed section:

- homepage example, capabilities and AI section;
- how-it-works intro, step 5 and step 7;
- /ai opening section and FAQ;
- ChatGPT and Claude "What you can ask";
- /itineraries "What it is".

They show the local build with the browser's fallback serif, because the sandbox blocks Adobe and Google Fonts.

## 6. Validation and regression

| Check | Result |
|---|---|
| `test/public-coldstart.js` (new) | **30 passed, 0 failed.** Covers brief items 1–9 and 12: homepage cold start; how-it-works non-linear, still eight steps; /ai no-record statement placed before the screenshots, and in metadata; ChatGPT's three modes plus the kept verification request; recommendations distinct from kept records; no "learns" or "infers" language; statuses unchanged; one H1, canonical, description and OG on every changed page; FAQPage exactly matches the visible FAQ; 29 internal links and anchors resolve; no credentials or reviewer material. |
| Public-page validator | **252 passed, 0 failed.** Two assertions updated: the proposition's new wording, and the reviewer-material check (see below). One added: Naples may appear only inside the "What you can ask" examples. |
| `test/public-preindex.js` | 41 passed, 0 failed |
| MCP freeze guard | identical |
| MCP contract: founder, other member, historical | match v2.61; nothing removed; OAuth, discovery and shared result shapes unchanged |
| itinerary, activation, collaboration, account-delete, connections-past | 488, 56, 113, 22, 12: all pass |
| adoption, recommendations, tool-audit, increment4, place-identity, skills-import | 73, 43, 29, 41, 45, 28: all pass |
| lifecycle | 76 passed, 1 failed: the same pre-existing failure as on production code |
| Page parity against production v2.91.3, 108 views | 106 identical; the 2 differences are the anonymous homepage, from the proposition |

**The reviewer-material check.** The validator used to reject the word "Naples" on any public page, as a guard against the Muse reviewer corpus (which includes a Naples itinerary) leaking into public copy. The brief's own cold-start example is a Naples plan. The guard now allows Naples only inside the authored example requests and still rejects it anywhere else; the account-name and key checks are unchanged.

**Brief items 10 and 11** (regression suites green; no MCP, application or connector behaviour changes) are confirmed by the freeze guard, the contract snapshots, the parity run and the diff. The only server-side code touched is in the two public-page modules; `server.js` is unchanged.

## 7. Wording that could still imply corpus dependency

| Where | Text | Recommendation |
|---|---|---|
| Plan guide title and slug | "Plan a trip from places and interests already kept" (`/guides/plan-from-what-you-keep`) | Kept. This guide is the record-enhanced workflow, and it now opens with "No saved places yet". The slug is linked from llms.txt and the sitemap, so it should not change. If you want the title to say both, "Plan a trip, from scratch or from what you keep" would work without changing the slug. |
| /guides meta description | "…plan a trip from what you have kept…" | A fine description of that guide; optionally add "or from scratch". |
| `questions` list (llms.txt) | "How can I plan trips from places I have already saved?" | A real question people ask; it is now preceded by the cold-start question. |
| Homepage example chat | "Plan two slow days in Kyoto in November, starting from what I've kept." | Intentional: the example demonstrates accumulated value, as the brief allows. |
| /about | "Because the record is durable and exact, an AI you authorize can start from it." | "Can", not "must", but it leans corpus-first. Optional: "…can draw on it". |
| /ai phone capture alt text | "Asking an AI to plan a trip from what is kept in Discriminantly" | Accurate to that screenshot, which is a record-enhanced request; left as is. |
| **ChatGPT directory listing** (outside the site) | Long description "…plan a trip with an itinerary built from the places you already know"; suggested prompt "Plan a weekend from the places I have saved in Lisbon." | **The most influential remaining source.** See §8. |

## 8. Recommended directory copy (ChatGPT)

**Where the current copy lives:** `plugin/plugin.json` → `extensions.com.openai.interface`:

- `shortDescription`: "Keep things, places and plans" (29 characters);
- `longDescription`;
- `capabilities`;
- three `defaultPrompt` entries.

The live listing is whatever was approved on 9 October 2026. Changing it means editing these fields and resubmitting to OpenAI, so I left the files untouched. The repository does not document OpenAI's field limits for these fields.

**One constraint from the approved submission:** its negative test cases include "Recommend a good restaurant in Toronto." as a request ChatGPT should *not* send to the plugin. Directory copy should therefore present cold start as something the member asks Discriminantly for. It should not suggest the plugin answers general recommendation questions on its own. The wording below keeps that line.

**Tagline** (44 characters; use it if the field allows):

> Discover places, keep interests & plan trips

Fallback at 29 characters, matching the current length:

> Discover, keep and plan trips

**Description:**

> Discover places and build trips from a direct request, then keep what matters. Your personal record sharpens future recommendations and plans.

**Examples (the `defaultPrompt` slots):**

1. "Plan two days in Naples around classic cafés, pizza and tailoring."
2. "Keep Hatchards in London for me."
3. "Plan a weekend in London using places I've already kept, and add some new recommendations."

**Long description**, if you resubmit: replace "and plan a trip with an itinerary built from the places you already know" with:

> and plan a trip from a direct request, from the places you already know, or both

**Before resubmitting:** add a positive test case for a cold-start plan, for example "Using Discriminantly, plan two days in Naples around classic cafés, pizza and tailoring." The reviewers then see it exercised.

## 9. Confirmation

Nothing was deployed, merged, pushed or published. The production checkout, Railway and the ChatGPT listing are untouched. Neither the Muse reviewer content and status nor any authentication, connector or MCP fact was changed.
