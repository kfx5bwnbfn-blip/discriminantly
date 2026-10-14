# Indexing preparation — to run after pass 2 is deployed

Nothing here has been done. It is the checklist for the day the pass-2 build goes live on www.discriminantly.com.

## 1. Before submitting anything

1. Confirm the live site answers as the local build does: `curl -sI https://www.discriminantly.com/welcome` → 301 to `/`; `curl -s https://www.discriminantly.com/sitemap.xml` lists `/` and no `/welcome`; `curl -sI -H 'Accept-Encoding: br' https://www.discriminantly.com/` shows `content-encoding: br`, `vary: Cookie, Accept-Encoding`, `cache-control: public, max-age=300…`.
2. Confirm a signed-in page is never cacheable: with your own session cookie, `/` must return `cache-control: private, no-store`.
3. Paste `https://www.discriminantly.com/` into the Facebook Sharing Debugger, the Twitter/X Card Validator and LinkedIn's Post Inspector and check the card renders from `/card/site.png`. Do the same with one public note, one travel mark and your profile.
4. Run `https://validator.schema.org/` on `/`, `/how-it-works`, `/notes`, `/guides/remember-places`, one note, one mark, one profile. Expect no errors; warnings about optional Organization fields (sameAs, contactPoint) are fine.
5. Settle the two content blockers first: the operator's name on the policy pages, and the hero/activity screenshots that show the founder's records.

## 2. Google Search Console

1. Add the property as a **Domain** property (`discriminantly.com`), verified by the DNS TXT record Google gives you (the domain is at your registrar; add the record there). A domain property covers www, the apex and the Muse subdomain.
2. Submit the sitemap: `https://www.discriminantly.com/sitemap.xml`.
3. Use **URL Inspection → Request indexing** on the priority URLs below, in this order, one at a time (there is a daily quota of about ten).
4. In **Settings → Crawl stats**, after a week, check that `/settings`, `/admin`, `/oauth/`, `/mcp` are not being crawled (robots.txt disallows them).
5. Leave **Removals** alone: `/welcome` redirects, it does not need removing.

## 3. Bing Webmaster Tools

1. Add the site; choose **Import from Google Search Console** once GSC is verified, which carries the verification and sitemap over.
2. Submit the same sitemap. Bing's URL Submission API is optional; the sitemap is enough at this size.
3. Bing Webmaster Tools also feeds Copilot and DuckDuckGo; nothing separate to do for those.

## 4. Priority URLs (request indexing in this order)

1. `https://www.discriminantly.com/`
2. `https://www.discriminantly.com/how-it-works`
3. `https://www.discriminantly.com/ai`
4. `https://www.discriminantly.com/ai/chatgpt`
5. `https://www.discriminantly.com/ai/claude`
6. `https://www.discriminantly.com/travel-marks`
7. `https://www.discriminantly.com/notes`
8. `https://www.discriminantly.com/guides`
9. `https://www.discriminantly.com/guides/connect-an-ai-assistant`
10. `https://www.discriminantly.com/about`

Second week: the remaining record pages, the other guides, `/ai/muse` (once its status is Approved; until then its review wording is correct but will date), `/agent-guidance`, `/privacy`, `/terms`, `/support`, `/activity`.

## 5. AEO (answer-engine) baseline

Record the date of deployment as the baseline date. On that day and again at 2, 6 and 12 weeks, ask each of ChatGPT (with browsing), Claude (with web search), Perplexity, Google AI Overviews and Bing Copilot the five guide questions verbatim, and note whether Discriminantly is cited and which page:

- How can I keep a personal record of objects and places?
- How can I save places I want to visit without pretending I have been?
- How can I plan trips from places I have already saved?
- How can friends build an itinerary together without sharing all their private data?
- How can I connect a personal taste or travel corpus to ChatGPT, Claude or Muse?

Also ask "What is Discriminantly?" and "Is Discriminantly available in ChatGPT?" and record the answer's accuracy against `/llms.txt` and `/agent-guidance`.

Keep the results in a dated table in the project; the first row is the baseline, and the comparison is against it, not against a target.

## 6. After the first crawl

- In GSC **Pages**, check nothing under `/o/`, `/m/`, `/u/` is reported as "Duplicate without user-selected canonical" (every one has a canonical; if it appears, the cause is `?c=` or `?tab=` variants, which are canonicalised to the bare path).
- Check **Enhancements** for Breadcrumbs, HowTo and Q&A; HowTo and FAQ rich results are now restricted by Google and may show as "not eligible", which is expected.
- If `/activity` is indexed with many `?q=`/`?t=` variants, those carry `noindex` and will drop out; nothing to do.
