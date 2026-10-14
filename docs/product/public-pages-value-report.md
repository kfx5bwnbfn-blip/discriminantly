# Customer value woven into the public-page story — review report

**Not deployed, merged, pushed or published.** Local commit `a410db3` on branch `public-pages-coldstart`, on top of the approved cold-start commits (`9089e1c`, `996dc14`).

## 1. What changed

Eleven sentences, all replacements or extensions of existing copy. No section, grid, heading, screenshot, illustration or CSS pattern was added. The homepage still has its seven sections (a test counts them). One new line of CSS styles the capture sentence as a quiet italic under the record-type intro, matching the existing framing lines.

The progression the brief asks for now runs through the page in order: the hero (notice, tell your AI, kept here), What you keep (no filing routine), Kept over time (scattered → brought together → a plan), Use it with AI (the AI you choose, revocable), and the closing line (control).

## 2. Every changed sentence

### Homepage

| Section | Before | After |
|---|---|---|
| Hero, supporting sentence (`site.plain`) | Keep objects and interests, remember places, and build trips with others—in the application or through the AI you already use. | Keep the places, objects and interests that catch your attention by talking naturally to your AI. They remain in Discriminantly as a record you control—ready to recall, explore and turn into plans. |
| What you keep, new line under the intro (`site.capture`) | — | No separate filing routine: tell your AI what is worth keeping, in your own words, while it is already part of the conversation. The record holds what you asked to keep, as you put it. |
| Kept over time, framing line | One workflow, not a required order. You can also begin with a direct request and nothing kept. | Things noticed at different moments no longer stay scattered across chats, notes and bookmarks. A connected AI can bring the relevant ones together when it is time to recommend, organize or plan. One workflow, not a required order: you can also begin with a direct request and nothing kept. |
| What becomes possible, first line | **Find what you kept** by place, kind or your own words. | **Keep it in conversation**, then find it again by place, kind or your own words. |
| Use it with AI, intro | Ask it for recommendations or a plan from the first request; what you keep gives later ones more direction. Connect it; revoke it any time. What it adds appears here, recorded as that assistant acting for you. | Your record lives in Discriminantly, not inside one AI. Connect the compatible assistant you choose to the same record, and revoke its access when you choose. Ask it for recommendations or a plan from the first request; what you keep gives later ones more direction. What it adds appears here, recorded as that assistant acting for you. |
| Closing control statement (`site.trust`) | Private or public by record. AI access is yours to grant and revoke. Every change retains its provenance. | Private or public, record by record. Choose which AI assistants may access your account, revoke them at any time, and see what each one changed. |

Unchanged on the homepage: the brand line, the first proposition sentence, the six record definitions and their non-implications, the Kyoto example and its summary ("An assistant can start from your request alone…"), the other five capability lines, the four platform rows and their facts, the Plan together section.

### /about

| Section | Before | After |
|---|---|---|
| What it is (`site.stance`, also used on /ai) | Discriminantly is a complete application. The application is the durable home of your record. Authorized AI clients are additional ways to work with that record; they do not own its meaning. | Discriminantly is a complete application, and the durable home of your record. ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning. |
| Why it exists, first paragraph | …Discriminantly gives those things one durable home, with the meaning of each kept straight: a note is a thing worth remembering, a mark is a place, a check-in is a visit, a warrant is an endorsement. Nothing is assumed from anything else. | …Discriminantly gives those things one durable home without another filing system to maintain: tell the AI you already use what is worth keeping, in your own words, and it is kept here, with the meaning of each kept straight. A note is a thing worth remembering, a mark is a place, a check-in is a visit, a warrant is an endorsement. Nothing is assumed from anything else. |
| Why it exists, third paragraph | Because the record is durable and exact, an AI you authorize can draw on it. Recommendations shaped by what you have actually kept and experienced are different from recommendations shaped by a guess about you. | Because the record is durable and exact, an AI you authorize can draw on it. Things kept at different times become useful later, when an assistant recommends, organizes or plans; recommendations shaped by what you have actually kept and experienced are different from recommendations shaped by a guess about you. The record does not belong to any one assistant: connect the compatible one you choose, revoke it when you choose, and see what each one changed. What is private or public is yours to set, record by record. |

The approved phrase "an AI you authorize can draw on it" is kept verbatim. The "generic AI memory" paragraph between them is unchanged.

### /ai

| Section | Before | After |
|---|---|---|
| No record needed to begin, second paragraph | Recommendations and conversational planning happen in the assistant you connect. Discriminantly holds the durable record: what you keep, what you plan, and where each came from. | Recommendations and conversational planning happen in the assistant you connect. Discriminantly holds the durable record: what you keep, what you plan, and where each came from. ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning. |

The cold-start paragraph above it, the FAQ, the platform chips and every status are unchanged.

## 3. How each benefit is now conveyed

**1. App fatigue → conversational capture.** The hero's first verb is "talking naturally to your AI". What you keep follows with "No separate filing routine: tell your AI what is worth keeping, in your own words, while it is already part of the conversation", and the first capability is "Keep it in conversation". /about says the record comes "without another filing system to maintain". The record "holds what you asked to keep, as you put it": no claim that the AI categorizes or infers.

**2. Cross-model autonomy.** Use it with AI opens with "Your record lives in Discriminantly, not inside one AI. Connect the compatible assistant you choose to the same record", above the four platform rows and their unchanged facts. /about and /ai say compatible assistants are "authorized ways of working with it—not owners of the record or its meaning", and /about adds "The record does not belong to any one assistant". The wording is "compatible", never universal, and nothing says data moves between models: one record, several authorized clients. Perplexity is not mentioned anywhere (a test checks).

**3. Remember naturally, plan later.** The hero ends "ready to recall, explore and turn into plans". Kept over time now opens with "Things noticed at different moments no longer stay scattered across chats, notes and bookmarks. A connected AI can bring the relevant ones together when it is time to recommend, organize or plan", with the Kyoto example beneath it and the cold-start summary preserved. /about: "Things kept at different times become useful later, when an assistant recommends, organizes or plans".

**4. Privacy and individual control.** The hero calls it "a record you control". The closing line is "Private or public, record by record. Choose which AI assistants may access your account, revoke them at any time, and see what each one changed." /about ends its rationale with revocation, visible changes and "What is private or public is yours to set, record by record." The shared-plan disclosure stays on /how-it-works, /travel-marks, the agent surfaces and the policy pages, where it was.

None of the four appears as a label, heading or card. The words "second brain" do not appear.

## 4. Metadata

No metadata changed. The page titles, descriptions, Open Graph and Twitter fields, and JSON-LD on `/`, `/about` and `/ai` are as they were after the cold-start commits. The homepage description still summarises the page accurately ("A durable personal record of your interests, travels and plans. Keep objects, places, visits and itineraries in one place, and connect it to the AI you already use."), so it was left alone rather than loaded with the four benefits.

## 5. Screenshots

`shots/`: desktop (1440 px) and mobile (390 px) captures of each affected section: homepage hero, What you keep, Kept over time, What becomes possible, Use it with AI, the closing statement; /about Why it exists; /ai No record needed to begin. Local build; the sandbox blocks the type CDNs, so the serif is the browser fallback.

## 6. Validation and regression

| Check | Result |
|---|---|
| `test/public-coldstart.js` | **40 passed, 0 failed.** Ten new assertions: hero sentence; capture line present with no inference wording; scattered → together with cold start preserved; conversational capture in the capability list, still six lines; cross-model line with no universal-compatibility or data-movement wording and four platform rows; closing control statement with none of the forbidden privacy claims; /about weaves all four and keeps "draw on it"; /ai clients-not-owners with the cold-start sentence; no "Why" section, benefit grid or added homepage section (seven sections); no Perplexity. One existing assertion updated for the extended framing line. |
| Public-page validator (route rendering, internal links, anchors, structured data, menu, header) | 252 passed, 0 failed |
| `test/public-preindex.js` | 41 passed, 0 failed |
| MCP freeze guard | identical |
| MCP contract: founder, other member, historical | match v2.61; nothing removed; OAuth, discovery and shared result shapes unchanged |
| itinerary, activation, collaboration, account-delete, connections-past | 488, 56, 113, 22, 12: all pass |
| adoption, recommendations, tool-audit, increment4, place-identity, skills-import | 73, 43, 29, 41, 45, 28: all pass |
| lifecycle | 76 passed, 1 failed: the known pre-existing failure, identical on production code |
| Page parity against production v2.91.3, 108 views | 106 identical; only the anonymous homepage differs |

## 7. Confirmations

- No new section, heading, card grid, illustration, screenshot or design pattern. The homepage has the same seven sections; one italic framing line was added under the record-type intro, in the style of the framing lines already on the page.
- The accuracy guardrails hold: the six record definitions and their non-implications are unchanged; "An assistant can start from your request alone" is intact; recommendations remain recommendations until kept; the platform facts, statuses and verification lines are untouched; the Muse reviewer corpus is untouched; no MCP, connector, authentication or application code changed (`server.js` is not in the diff).
- Nothing was deployed, merged, pushed or published.
