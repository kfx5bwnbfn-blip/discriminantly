# Discriminantly public pages: review build, first tranche

**Nothing was deployed, merged, pushed or published.** The work is a local commit (`83514f0`) on a branch named `public-pages-review` in the development tree. The production checkout and Railway are untouched; the production site is still v2.87.

## 1. Approach

**Visual.** The welcome page keeps its composition: the mark and wordmark, the uppercase brand line, the framed desktop screenshot of the application, the dark glass, the Chaparral typography, and the same backdrop. The brand line now carries its periods ("Your interests. Your travels. Wherever you go.") instead of decorative bullets, so the bullet appears only in the wordmark. Below the hero, the two phone pairs are replaced by the narrative the brief asks for, built from the application's own materials: the `itin-shell` glass panels, the welcome card's numbered steps, the `.lbl` small caps, and the glass buttons. No new gradients, illustrations or card grids were introduced; "What you keep" is a definition list, "How it works" is a numbered progression, platforms are status rows.

**Content.** Every fact the pages state about the product or an AI client lives in one file, `public-content.js`, and the pages render from it. Each platform carries four separate facts (availability, connection method, authentication, directory status) plus a `verified` note saying how the status was established. Illustrative material is invented (a Hagi teabowl, "Kissa Hoshikawa") and labelled "Illustrative example · Invented records, shown to explain the product. Not a real member."

**Navigation.** A restrained public header: mark (wordmark on inner pages; mark only on Home, where the splash carries the wordmark), the primary action (Get started / Open Discriminantly), and a Menu. The menu is a native `<details>` element, so it is crawlable, works without JavaScript and announces its state; a 12-line script adds `aria-expanded`, Escape-to-close with focus restored, and click-outside-to-close. Account, privacy and terms links sit in a separated utility row.

## 2. Changed and added files

| File | Change |
|---|---|
| `public-content.js` | **New.** Site copy, menu, the six record types, platform capability model, the eight steps, boundaries, the illustrative sequence, plan-together behaviour. |
| `public-pages.js` | **New.** Header, page template, and the six page renderers. |
| `server.js` | +26 lines: `layout()` gains an optional `pub` argument (meta description, canonical, Open Graph, header). Routes for the new pages. `/welcome` now renders the new Home; the previous `pages.welcome` renderer is left in place, unused, for comparison. No other application code changed. |
| `public/style.shared.css` | +152 lines, one delimited block: structure for the header, templates and sections, responsive rules, reduced-motion rule. |
| `public/style.modern.css` | +38 lines, one delimited block: the glass materials for the same, using the existing tokens. |

## 3. Routes

| Route | Status | Page |
|---|---|---|
| `/welcome` | existing, rebuilt | Home |
| `/how-it-works` | new | How Discriminantly works |
| `/travel-marks` | new | Travel Marks (the object-page template) |
| `/ai` | new | Use with AI hub |
| `/ai/muse` | new | Use Discriminantly with Muse |
| `/guides` | new | Guides index (lists the four pages above; nothing thin) |

Menu entries for ChatGPT, Claude and Other AI assistants point at the hub's status rows (`/ai#chatgpt` etc.) until their own guides exist. About and Support link to the existing `/about` and `/support`.

## 4. Screenshots

`desktop/` (1440 px) and `mobile/` (390 px), named per the brief; `INDEX.md` maps each file to the brief's list; `contact-sheet-desktop.png` and `contact-sheet-mobile.png` for quick comparison. All are the local implementation, captured with Playwright against a seeded demo database.

**One caveat:** the sandbox blocks Adobe Fonts and Google Fonts, so every screenshot shows the browser's fallback serif, not Chaparral Pro. The local preview on your own machine will show the real type.

## 5. Local preview

From the repository root, on the `public-pages-review` branch:

```
PORT=3000 DB_PATH=/tmp/review.db SEED=1 ADMIN_PASSWORD=prototype1 GEOCODE=off \
PUBLISHER_NAME="Review build" SUPPORT_EMAIL=support@example.com node server.js
```

Then open http://localhost:3000/welcome, /how-it-works, /travel-marks, /ai, /ai/muse, /guides. Add `?welcome=1`-style parameters are not needed; sign in as the seeded admin to see the signed-in header ("Open Discriminantly"). `SEED=1` gives the seeded demo records only; no production data is involved.

## 6. Checks run

| Check | Result |
|---|---|
| Build (`node --check` on all changed files) | pass |
| Route rendering (6 pages, signed out and signed in) | all 200 |
| Public-page validation (`validate.js`, 51 checks): one H1 per page; description, canonical and Open Graph present; header/nav/main landmarks; policy links once; no credentials, keys or tokens in markup; no hard-coded tool count; 20 internal link targets resolve; every in-page anchor exists; nine Home sections present without JS; approved copy verbatim; illustrative material labelled; Muse facts present, no trailing slash; signed-in vs signed-out primary action; menu keyboard behaviour (Enter opens, aria-expanded, Tab into links, Escape closes and restores focus); reduced motion; secondary-text ink tokens | 51 passed |
| Console errors | 0 beyond the blocked font CDNs |
| Application regression: `test/itinerary.js` 488, `activation` 56, `collaboration` 113, `account-delete` 22, `connections-past` 12, `muse-capture` 50 (www byte-identical); page parity against production, 108/108 identical | all pass |
| MCP freeze guard and contract snapshot | identical / matches |
| Lint | the repository has no lint or formatter configured; none run |

Contrast is token-based: body and secondary text use `--m-ink` (.96) and `--m-ink-2` (.82) white on the dark backdrop, and the light-mode equivalents; glass panels use the existing `--m-glass` materials. A numeric contrast audit of every text/background pair was not run.

## 7. Conflicts between the brief and the product

1. **Source documents not found.** Neither `Discriminantly_Public_and_AI_Friendly_Pages_Brief.md` nor the Brand & Identity Book is in the repository, the project, or the uploaded files. This build follows the brief as given to me, which carries the canonical copy and the Muse facts. If those documents say something different, that wins.
2. **Hero screenshots show the founder's records.** The two framed desktop images (`welcome-shot-modern-*.jpg`, `welcome-shot-itin-*.jpg`) are the existing marketing assets and show your own public notes, marks and plans. The brief asks for deterministic illustrative data; the new sequence uses invented records, but these two frames do not. Replacing them means generating new application screenshots from a demo account. Your call.
3. **`/about` is stale.** It still says "membership is by invitation" and describes the 2016 product. The menu links to it. It is outside this tranche; it needs rewriting before anything goes live.
4. **Shared-plan disclosure.** The product shows invited participants the name and address of every place in a plan, including private marks, after a confirmation. The Plan Together section says so. If the intended behaviour is different, the product needs changing, not the copy.
5. **No wordmark asset.** The wordmark is set as live text in Chaparral, as on the current site. No separate file exists.

## 8. Claims that still need verification

- **Claude status.** Stated as "Live, as a custom connector" with sign-in, based on your own daily use and the v2.51 validation. Nothing about a Claude directory listing is claimed.
- **Muse.** Stated as a custom connector with an API key, verified live 12 October; directory listing "not established". Keep it that way until Meta approves.
- **Export.** The pages say nothing about export. The privacy policy says a copy is available on request by email; that is the only true statement today.
- **Warrants.** Described as live, which they are (tool and web UI).

## 9. Not done, by design

Remaining object pages (Notes, Check-ins, Collections, Itineraries, Warrants), the ChatGPT and Claude guides, trust pages, `llms.txt`, agent guidance and structured metadata. The content model and the Travel Marks template are shaped so each of these is a data entry plus a short page, with no redesign.

**Nothing was deployed, merged or published.**

## Content revision, 13 October (evening): changed copy fields

Content only. No style, structure or application change. Local commit `2471430` on `public-pages-review`; nothing deployed, merged or pushed.

| # | Where | Field | Now reads |
|---|---|---|---|
| 1 | `platforms.muse` | `availability` | Available as a custom connector |
| 1 | | `directory` | Not yet approved or directory-listed |
| 1 | | `review` (new; shown as its own badge and fact) | Submitted · In review |
| 1 | | `reviewDetail` (new) | Submitted to the Muse platform on 13 October 2026. Business verification, the data-processing questionnaire and the integration credentials are all in review. The pipeline is In review → Testing → Approved. |
| 1 | Muse page | badges | "Custom connector · API key" and "Submitted · In review", side by side; "Status on the Muse platform" row added to the facts |
| 1 | AI hub, Home rows | | "Review" fact row; Home status reads "Available as a custom connector · Submitted · In review" |
| 2 | Home, Evidence and control | first definition | **Your record.** What you have kept, each kind with its own meaning. A note says a thing was worth remembering. A travel mark says a place was worth remembering or considering. A check-in says you were there. An ownership record says you own it. A warrant says you stand behind it. None of these implies another: nothing saved is thereby liked, owned, visited or endorsed. |
| 3 | `together.disclosure`; Travel Marks, Private or public | | If a private travel mark is added as a stop, the place details in the shared plan (its name and address) may become visible to collaborators, after you confirm. The originating mark, your private commentary and the rest of your record remain private. |
| 4 | `objects[*].what` | | Notes remember objects and interests · Travel Marks remember or consider places · Check-ins record actual visits · Collections organize records · Itineraries preserve plans · Warrants are explicit endorsements (each followed by its existing explanation) |
| 4 | `objects.mark.not` | | A mark does not mean you have been, or that you recommend it. Going is a check-in; recommending is a warrant. |
| 5 | `guides` (new), Guides page | | Five workflows: Keep a place · Keep an object · Plan with what you have kept · Find and refine what you have kept · Build and share an itinerary. Each links to the page that currently covers the work; individual guide pages remain out of scope. |
| 6 | `platforms.claude` | `availability` | Verified custom connector |
| 6 | | `basis` (new; shown as a "Verification" fact) | Verified by Discriminantly: the connection and sign-in were validated with MCP Inspector and Claude, and are in daily use. Not reviewed or listed by Anthropic. |
| 7 | `/about` | untouched | **Pre-publication content blocker:** still describes invitation-only access and the 2016 product. The menu links to it. |
| 8 | all pages | | No export or portability claim. The only statement is the privacy policy's: a copy of your data on request by email. |

**Validation:** `validate.js` now 59 checks, all passing, including: badge and review status shown separately with the pipeline; no reviewer-account or questionnaire detail on any page; Claude verification basis present with no directory claim; "Your record" with the five meanings; the six definitions; the sharing disclosure on Home and Travel Marks; five workflow guides with no reference page presented as a guide; no export claim. MCP freeze identical; `test/itinerary.js` 488 passed. Three re-captured views are in `v2/`.
