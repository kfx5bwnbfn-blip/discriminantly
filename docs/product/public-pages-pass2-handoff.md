# Discriminantly public pages — pass 2 handoff

**Nothing was deployed, published, merged or pushed.** The work is one local commit, `4008ecd`, on the branch `public-pages-pass2` in the development tree, on top of v2.89.6. The production checkout and Railway are untouched; the live site is still v2.89.6. The MCP implementation, OAuth flows, API-key generation, scopes, provenance model, database schema and authenticated application behaviour were not changed (one deliberate exception is listed under *Authenticated-side differences*).

## 1. Outcome

| Area | Result |
|---|---|
| Canonical homepage | `/` is the public homepage for signed-out visitors; signed-in members get the application home at `/` exactly as before. |
| `/welcome` | 301 to `/`, query string preserved (`/welcome?src=x` → `/?src=x`), `Cache-Control: public, max-age=86400`. |
| Public feed route | **`/activity`** (chosen over `/explore`: it describes what the page is, a record of activity, and matches the existing "Activity" heading and card). Signed out: the feed with masthead, one H1, CollectionPage metadata, canonical `/activity`. Signed in: the same feed as the application home, `private, no-store`. A signed-out `/?q=` or `/?t=` search is sent to `/activity` with the query (302, no-store), so old search links keep working. |
| Trust line | Evidence and control is on `/how-it-works` only. The homepage closes with: *Private or public by record. AI access is yours to grant and revoke. Every change retains its provenance.* |
| New pages | `/notes`, `/check-ins`, `/collections`, `/itineraries`, `/warrants` (the record pages; Travel Marks keeps its own), five guides under `/guides/…`, `/agent-guidance` and `/agent-guidance.md`. |
| Metadata | Title, description, canonical, Open Graph and Twitter card on every public page and on public notes, travel marks, profiles, collections, itineraries and ensembles. JSON-LD graphs with absolute URLs. One H1 per page, including the policy pages. `noindex` on login, join, searches, tag views and private views. |
| Preview cards | Generated 1200×630 PNG at `/card/site.png`, `/card/page/<key>.png`, `/card/[omteu]/<id>.png`, from public fields only; a private record is a 404. Bundled Rokkitt (OFL) so the card renders the same on Railway as locally. |
| Delivery | Brotli, then gzip, for public pages, policy pages, static text assets (CSS, JS, manifest) and the machine files; identity when not accepted. Hero and itinerary frames as WebP with JPEG fallback (1000 px and full width via `srcset`; 2000 px hero 172 KB → 91 KB / 31 KB at 1000 px). Images stream exactly as before. |

### Root-routing decision and why it is safe

The decision is made once, at the top of the `/` handler, on the same `me` the rest of the router already uses: a session cookie that resolves to a member gets `pages.home` (untouched); anything else gets the public homepage. There is no user-agent branching anywhere (a validator check fetches `/` as Googlebot and as a browser and compares bytes). Caches cannot cross the two: every signed-out public response carries `Vary: Cookie, Accept-Encoding`, and every signed-in response on these routes carries `Cache-Control: private, no-store`, so a shared cache (Railway's edge or any CDN added later) can never serve a member's page to a visitor or the reverse. The signed-out homepage is cacheable for five minutes with one-minute stale-while-revalidate; the signed-out feed for one minute. The source-attribution cookie (`?src=`) is still set on the signed-out `/`, as it was on `/welcome`.

### Cache safeguards, in one place

| Response | Cache-Control | Vary |
|---|---|---|
| Signed-out public page (`/`, `/how-it-works`, record pages, guides, `/ai/*`, `/about`, `/agent-guidance`, policy pages) | `public, max-age=300, stale-while-revalidate=600` | `Cookie, Accept-Encoding` |
| Signed-in view of any of the above | `private, no-store` | `Cookie, Accept-Encoding` |
| Signed-out `/activity` | `public, max-age=60, stale-while-revalidate=300` | `Cookie, Accept-Encoding` |
| Signed-in `/` and `/activity` | `private, no-store` | — |
| `/welcome` redirect | `public, max-age=86400` | — |
| `/?q=` redirect (signed out) | `no-store` | — |
| `/llms.txt`, `/sitemap.xml`, `/robots.txt`, `/agent-guidance.md` | `public, max-age=3600` | `Accept-Encoding` |
| WebP variants, `/how/*.jpg` | `public, max-age=86400` | — |
| Other static | unchanged (`max-age=300`; `immutable` when versioned) | `Accept-Encoding` on text assets |

## 2. Changed files

| File | Change |
|---|---|
| `server.js` | `layout()`'s `pub` argument extended (description, canonical, robots, OG image dimensions, Twitter card, JSON-LD, title override; zoomable viewport only on the public template). New helpers `absUrl`, `metaText`, `artifactPub`, `personLd`, `cardPath`, `publicImageFile`, `cardSpec`, `sendZ` (opt-in compression). Card route. Metadata and H1 on note, mark, profile, collection, itinerary, ensemble pages. Root/`/activity`/`/welcome` routing; routes for the record pages, guides, agent guidance; policy pages get H1, breadcrumb, ContactPage, card, cache headers. WebP serving; compressed static text. |
| `public-pages.js` | Root path, cache headers, trust line, responsive WebP frames, record-page and guide renderers, agent guidance, policy card specs, `PUBLIC_PATHS` for sitemap and llms.txt, crumbs exported. |
| `public-content.js` | `objectPages` (per-record asserts / does not assert / relates / appears / AI / privacy / example / does-not-prove), five guides with Q&A, `updated` dates, Claude and Other wording. |
| `cards.js`, `assets/fonts/*` | New: SVG → PNG card renderer and the OFL Rokkitt files it uses. |
| `public/welcome-shot-*.webp` | New: generated from the existing JPEGs with sharp (quality 82). |
| `public/style.css`, `public/style.modern.css` | H1 variants on note, mark and card headings so the promoted headings render as the H3s did. |
| `docs/distribution/muse-*.md` | The Muse verification and 67-tool inventory, carried into the repository. |

Templates changed: homepage (trust line, frames), how-it-works (Evidence and control; already in v2.89.6), record page (new), guide page (new), agent guidance (new), policy page (H1, crumbs), feed signed out (H1, metadata), note / mark / profile / collection / itinerary / ensemble (H1, metadata only).

## 3. Routes, verified locally

Status codes from the seeded local build (`validate.js`, 249 checks, 0 failures):

| Route | Signed out | Signed in |
|---|---|---|
| `/` | 200 public homepage, `pub-head`, `public, max-age=300`, Vary Cookie | 200 application home (curtain, feed grid), `private, no-store` |
| `/?q=tea` | 302 → `/activity?q=tea` | 200 application home with search |
| `/welcome`, `/welcome?src=x` | 301 → `/`, `/?src=x` | same |
| `/activity` | 200 feed, masthead, H1, CollectionPage, `max-age=60` | 200, `private, no-store` |
| `/activity?q=…` | 200, noindex | 200 |
| `/notes` `/check-ins` `/collections` `/itineraries` `/warrants` `/travel-marks` | 200 | 200 (Open Discriminantly) |
| `/collections/new` (POST) and `/collections/:id/rename|delete` | unchanged (303 to sign-in) | unchanged |
| `/guides`, `/guides/<five slugs>` | 200; unknown slug 404 | 200 |
| `/agent-guidance`, `/agent-guidance.md` | 200 html / 200 text/markdown | 200 |
| `/privacy` `/terms` `/support` | 200, H1, breadcrumb, ContactPage on support | 200 |
| `/login` `/join` | 200, noindex, no public header | — |
| `/card/site.png`, `/card/page/notes.png`, `/card/page/guide-remember-places.png`, `/card/page/privacy.png`, `/card/u/<handle>.png` | 200 image/png | same |
| `/card/page/nope.png`, `/card/o/<private id>.png` | 404 | 404 |
| `/llms.txt` `/sitemap.xml` `/robots.txt` | 200; sitemap lists `/`, record pages, guides, `/agent-guidance`, `/activity`, policies; no `/welcome` | — |
| `/welcome-shot-modern-dark-1000.webp` etc. | 200 image/webp | — |
| Compression | `br` on `/`, CSS, llms.txt; `gzip` fallback; identity when not accepted; **none** on `/login` or any application page | — |

## 4. Metadata coverage by page type

| Page type | Title / description / canonical | OG + Twitter | JSON-LD | Robots |
|---|---|---|---|---|
| Homepage | ✓ | card `/card/site.png` 1200×630 | Organization, WebSite, WebPage | index |
| How it works | ✓ | page card | + HowTo (8 steps) + BreadcrumbList | index |
| Record pages (6) | ✓ | page card | + DefinedTerm in a DefinedTermSet + BreadcrumbList | index |
| Guides index / guide | ✓ | page card | ItemList / Article + Question/Answer + BreadcrumbList | index |
| AI hub / platform pages | ✓ | page card | ItemList (platforms) / WebPage + BreadcrumbList | index |
| About | ✓ | page card | AboutPage | index |
| Agent guidance | ✓ | page card | WebPage + BreadcrumbList; markdown twin | index |
| Privacy, Terms, Support | ✓ | page card | WebPage / ContactPage + BreadcrumbList | index |
| Activity (signed out) | ✓ | page card | CollectionPage + BreadcrumbList | index; search/tag noindex |
| Public note | ✓ (headline; "Noted by @handle: why") | record image if public, else `/card/o/<id>.png` | Thing + Person + BreadcrumbList | index; private view noindex |
| Public travel mark | ✓ | image or `/card/m/<id>.png` | Place (address, geo) + Person | index |
| Profile | ✓ (`@handle — Discriminantly`) | `/card/u/<handle>.png` | ProfilePage + Person | index |
| Collection | ✓ | `/card/u/<handle>.png` | CollectionPage + ItemList | index |
| Public itinerary | ✓ ("A plan, not a record of having gone.") | `/card/t/<id>.png` | ItemList of stop names | index |
| Ensemble | ✓ | image or `/card/e/<id>.png` | CreativeWork | index |
| Login, join, shared-plan and invitation shells | title only | — | — | noindex |

## 5. Tests and checks

| Check | Result |
|---|---|
| `node --check` on all changed files | pass |
| `validate.js` (public pages; rewritten for pass 2) | 249 passed, 0 failed: one H1 per page; metadata, canonical, OG with dimensions; landmarks; link integrity (every internal href resolves) and every in-page anchor exists; approved copy verbatim; illustrative material labelled; Muse and Claude facts as agreed; no personal name, credential, tool count or export claim; JSON-LD parses on every page with absolute URLs; root routing signed in/out, `/welcome` 301, `/activity` headers, noindex on login/join/search; collections GET/POST split; cards 200/404; compression and WebP; no user-agent cloaking; menu keyboard behaviour; reduced motion; ink tokens |
| MCP freeze guard (`test/mcp-freeze.js`) | identical |
| MCP contract snapshot (founder, other member, historical) | matches v2.61; nothing removed |
| `test/itinerary.js` 488 · activation 56 · collaboration 113 · account-delete 22 · connections-past 12 · adoption 73 · recommendations 43 · tool-audit 29 · increment4 41 · place-identity 45 · skills-import 28 | all pass |
| `test/lifecycle.js` | 76 passed, 1 failed on the first run — a pre-existing fixture-order sensitivity (the same test fails on a re-run against an already-mutated fixture); not touched by this work. Flagged, not fixed. |
| Page parity against production (v2.89.6) on the adoption fixture, 108 pages | 26 identical, 82 differ. Every difference is one of: the signed-out `/` is now the homepage; the masthead mark links to `/` instead of `/welcome`; `<title>`, description, canonical, OG and JSON-LD added to public note, mark and profile pages; H1 in place of H3 on those pages; `noindex` on a private note viewed by its owner. No difference in status codes, visibility or body content. |
| Performance baseline (local, Playwright, fonts blocked) | see §6 |

### Authenticated-side differences, stated plainly

The brief says not to change authenticated behaviour to satisfy public copy. Two things touch pages a member sees, and both are metadata, not behaviour: (1) public note, mark, profile, collection, itinerary and ensemble pages carry the new `<head>` metadata and an H1 whether or not the viewer is signed in (the same page is served to both; this is what makes shared links unfurl); (2) a private note viewed by its owner carries `noindex`. The signed-in `/` and `/activity` now send `private, no-store`, which is the safeguard the amendment asks for. The zoomable viewport is limited to the public template; application pages keep `user-scalable=no`.

## 6. Performance baseline (local, before fonts)

Measured with Playwright against the local build with Adobe Fonts, Google Fonts and tiles blocked, cold cache, so these are transfer weights and layout numbers, not field data.

| Page | Requests | Transfer | HTML (br) | Images | LCP | CLS |
|---|---|---|---|---|---|---|
| `/` desktop 1440 | 11 | 231 KB | 17 KB | 125 KB | ~1.2 s | 0 |
| `/` mobile 390 | 10 | 249 KB | 17 KB | 143 KB | ~0.6 s | 0 |
| `/how-it-works` | 13 | 696 KB | 16 KB | 591 KB (8 lazy JPEGs, all loaded at idle) | — | 0 |
| `/notes` | 5 | 105 KB | 15 KB | 1 KB | ~1.0 s | 0 |
| `/guides/remember-places` | 5 | 105 KB | 15 KB | 1 KB | ~1.0 s | 0 |
| `/activity` | 12 | 366 KB | 14 KB | 262 KB | ~1.1 s | 0 |
| `/privacy` | 5 | 107 KB | 17 KB | 1 KB | ~0.9 s | 0 |

The three stylesheets are ~89 KB compressed together on every page; they are the application's, shared with the signed-in product, and were left alone. **Font caveat:** in production, Chaparral from Adobe Fonts and Rokkitt from Google Fonts load render-blocking from third parties; that is the largest remaining LCP factor and is outside this pass. The `/how/*.jpg` screenshots on how-it-works are the heaviest page; converting them to WebP the same way as the hero would roughly halve that page.

## 7. Claims deliberately not implemented

- No export or portability claim anywhere; the privacy policy's "copy on request by email" remains the only statement.
- Claude is "available as a custom connector, tested by Discriminantly", with the basis stated and "not an Anthropic review"; no directory claim.
- Muse stays "Submitted · In review", no approval or listing claim.
- No tool count on any page.
- No claim of a Claude or Muse directory listing, no "verified" badge wording.
- The `resource_documentation` URL in the OAuth metadata still says `/welcome` — it is inside the frozen surface and resolves through the 301, so it was left exactly as is.

## 8. Gaps

**Blockers before publishing**
- The policy pages still name the operator by name (from `PUBLISHER_NAME`), as flagged in v2.89.2; a non-personal operator line needs a decision.
- The hero and activity screenshots are the existing marketing captures and show the founder's own records; the activity capture also shows Muse reviewer demo notes.

**Beta follow-ups**
- Phone screenshots on the AI hub still show the old handle (awaiting Muse's captures).
- `/how/*.jpg` → WebP, and `fetchpriority` on the first how-it-works frame.
- `test/lifecycle.js` fixture-order sensitivity (pre-existing).

**Later**
- A CDN or edge cache in front of Railway: the headers are ready for one (`Vary: Cookie`, `private, no-store` on members' pages).
- Search Console / Bing submission and the AEO baseline — see `INDEXING-PREP.md`.

## 9. Local preview

On the `public-pages-pass2` branch, from the repository root:

```
PORT=3000 DB_PATH=/tmp/pass2.db SEED=1 ADMIN_PASSWORD=prototype1 GEOCODE=off \
PUBLISHER_NAME="Review build" SUPPORT_EMAIL=support@example.com \
CHATGPT_PLUGIN_URL=https://chatgpt.com/plugins/plugin_asdk_app_6ab1c764dbb88191a6d2e15c9296323f node server.js
```

Then open http://localhost:3000/ (signed out), /notes, /guides, /guides/remember-places, /agent-guidance, /activity, /privacy, and /card/site.png. Sign in as the seeded admin to see the application home at `/`. Screenshots of the local build (fallback serif, not Chaparral) are in `shots/`.

**Nothing was deployed, published, merged or pushed.**
