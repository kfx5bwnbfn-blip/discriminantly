// Cold-start recommendation and planning story on the public pages.
// Checks that no page presents an existing record as a prerequisite for
// recommendations or plans, that the record is described as sharpening the
// result, and that recommendations stay distinct from kept records.
// Wording follows the 14 Oct 2026 copy reframe (notice / save / plan).
// Usage: node test/public-coldstart.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'coldstart-')), DB = path.join(DIR, 'c.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const ORIGIN = 'https://www.discriminantly.com';
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com', CHATGPT_PLUGIN_URL: 'https://chatgpt.com/plugins/plugin_test', PUBLIC_ORIGIN: ORIGIN }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = async (p) => (await fetch(BASE + p)).text();
const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const graph = (h) => ld(h).flatMap((g) => g['@graph'] || [g]);
const txt = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;|&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const unesc = (s) => s.replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const P = ['/', '/how-it-works', '/ai', '/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other', '/itineraries', '/guides/plan-from-what-you-keep', '/guides/connect-an-ai-assistant', '/about', '/agent-guidance', '/guides', '/notes', '/travel-marks', '/guides/remember-places'];
  const H = {}; for (const p of P) H[p] = await get(p);
  const T = Object.fromEntries(P.map((p) => [p, txt(H[p])]));
  const llms = await get('/llms.txt'), agentMd = await get('/agent-guidance.md');

  // 1. Homepage supports cold start
  ok('1 home: recommendations and plans from a direct request', /ask for recommendations and make plans from a direct request\. What you have saved and experienced gives those recommendations sharper, more personal direction over time\./.test(T['/']));
  ok('1 home: capabilities say recommendations come from the request, sharpened by evidence', /Recommendations from what you ask for , sharpened by what you have saved and experienced\./.test(T['/']) && /Bring saved and newly discovered places into one plan : start fresh, start from your record, or combine both\./.test(T['/']));
  ok('1 home: the example is framed as one workflow, and its summary says a request alone is enough', /One workflow, not a required order: you can also begin with a direct request and nothing saved\./.test(T['/']) && /An assistant can start from your request alone\. When you have relevant records, it can use that evidence to make the plan more personal\./.test(T['/']));
  ok('1 home: the old corpus-first lines are gone', !/Recommendations from evidence , not a guess about you|Plans from places you already keep , with new ones added|The assistant starts from what was kept and recorded|receive recommendations shaped by what you have kept/.test(T['/']));

  // 2. How it works is not a mandatory sequence
  ok('2 how-it-works: "Eight ways…", an existing record is not required', /Eight ways Discriminantly helps you save, organize, discover and plan\. You can begin with something worth remembering or start with a destination and a direct request—an existing record is not required\./.test(T['/how-it-works']));
  ok('2 how-it-works: step 5 is request, saved places, or both', /Build an Itinerary from a direct request, places you have already saved, or both\./.test(T['/how-it-works']) && /even if your record is empty/.test(T['/how-it-works']));
  ok('2 how-it-works: step 7 covers cold start and record-enhanced', /It can recommend new places and build plans from what you ask\. When you have relevant records, it can retrieve them, with your authorization, to sharpen the recommendations/.test(T['/how-it-works']));
  ok('2 how-it-works: still eight steps, plan still not a visit or endorsement', (graph(H['/how-it-works']).find((x) => x['@type'] === 'HowTo').step || []).length === 8 && /it does not make it a visit or an endorsement/.test(T['/how-it-works']));
  ok('2 how-it-works: the HowTo description no longer implies a required order', /not a required order/.test(graph(H['/how-it-works']).find((x) => x['@type'] === 'HowTo').description));

  // 3. AI hub says no record is required
  ok('3 /ai: "You do not need an existing Discriminantly record to begin."', /You do not need an existing Discriminantly record to begin\. Ask your assistant for recommendations or a plan from a destination, interests and constraints\./.test(T['/ai']));
  ok('3 /ai: recommendations happen in the connected assistant; Discriminantly holds the record', /Recommendations and conversational planning happen in the assistant you connect\. Discriminantly holds the durable record/.test(T['/ai']));
  ok('3 /ai: the cold-start statement comes before the screenshots', H['/ai'].indexOf('id="no-record-needed"') > 0 && H['/ai'].indexOf('id="no-record-needed"') < H['/ai'].indexOf('id="useful"'));
  ok('3 /ai: meta description states it plainly', /No saved record is needed/.test((/<meta name="description" content="([^"]*)"/.exec(H['/ai']) || [])[1] || ''));

  // 4. ChatGPT guide: three modes, verification kept
  ok('4 chatgpt: cold-start, record-enhanced and capture examples', ['@Discriminantly Plan two days in Naples around classic cafés, pizza and tailoring.', '@Discriminantly Turn my saved London places into a weekend plan and recommend a few additions.', '@Discriminantly Keep Hatchards in London for me.'].every((s) => T['/ai/chatgpt'].includes(s)));
  ok('4 chatgpt: says an empty account can begin', /An empty account can begin with recommendations and planning; it simply has no records of yours to contribute yet\./.test(T['/ai/chatgpt']));
  ok('4 chatgpt: the read-only verification request is kept', T['/ai/chatgpt'].includes('@Discriminantly List my saved Travel Marks. Don’t add or change anything.'));
  ok('4 other clients: the same three capabilities; the generic page says behaviour varies', ['/ai/claude', '/ai/muse', '/ai/other'].every((p) => /What you can ask/.test(T[p]) && /plan two days in Naples/i.test(T[p]) && /Keep Hatchards in London/.test(T[p])) && /varies by client and model/.test(T['/ai/other']));

  // 5. Recommendations remain distinct from kept records
  ok('5 recommendations stay recommendations until kept (platform pages, FAQ, guide, llms)', ['/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other'].every((p) => /Suggested places stay recommendations until you keep them\./.test(T[p])) && /A recommendation remains distinct from something you have deliberately kept\./.test(T['/ai']) && /Those places stay recommendations until you keep them\./.test(T['/guides/plan-from-what-you-keep']) && /Recommendations remain recommendations until the member keeps them\./.test(llms));
  ok('5 no page says the product learns or infers automatically', !P.some((p) => /\b(learns|learning) (about )?(you|your)|automatically (learn|infer|save)/i.test(T[p])));

  // 6. No status or capability broadened
  ok('6 status lines unchanged: ChatGPT live/listed, Claude tested not listed, Muse in review', /Listed in ChatGPT’s plugin directory/.test(T['/ai/chatgpt']) && /Not reviewed or listed by Anthropic/.test(T['/ai/claude']) && /Submitted · In review/.test(T['/ai/muse']) && /Not yet approved or directory-listed/.test(T['/ai/muse']));
  ok('6 no "only ChatGPT" framing; four platforms still listed on /ai', (H['/ai'].match(/class="pub-ai-chip"/g) || []).length === 4);

  // 7. One H1, canonical, description and OG on every changed page
  const bad7 = P.filter((p) => (H[p].match(/<h1[\s>]/g) || []).length !== 1 || !H[p].includes(`<link rel="canonical" href="${ORIGIN}${p === '/' ? '/' : p}">`) || !/<meta name="description" content="[^"]{60,}[.!?]"/.test(H[p]) || !/property="og:title"/.test(H[p]) || !/property="og:description"/.test(H[p]));
  ok('7 one H1, canonical, complete description and OG on every changed page', bad7.length === 0, bad7.join(', '));

  // 8. FAQ structured data matches the visible FAQ exactly
  const faq = graph(H['/ai']).find((x) => x['@type'] === 'FAQPage');
  const vis = [...H['/ai'].matchAll(/<dl class="pub-faq">([\s\S]*?)<\/dl>/g)].flatMap((m) => [...m[1].matchAll(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((x) => [unesc(x[1]), unesc(x[2])]));
  ok('8 FAQPage has two questions, each exactly matching the visible question and answer', !!faq && faq.mainEntity.length === 2 && vis.length === 2 && faq.mainEntity.every((q, i) => q.name === vis[i][0] && q.acceptedAnswer.text === vis[i][1]), JSON.stringify(vis));
  ok('8 the FAQ is not marked up on any other page', P.filter((p) => p !== '/ai').every((p) => !graph(H[p]).some((x) => x['@type'] === 'FAQPage')));

  // 9. Links and anchors resolve
  const links = new Set(); for (const p of P) for (const m of H[p].matchAll(/href="(\/[^"#?]*)(#[a-z0-9-]+)?"/g)) links.add(m[1] + (m[2] || ''));
  const broken = []; for (const l of links) { const [u, a] = l.split('#'); const r = await fetch(BASE + u, { redirect: 'manual' }); if (![200, 301, 302, 303].includes(r.status)) broken.push(l + ' ' + r.status); else if (a && r.status === 200 && !new RegExp(`id="${a}"`).test(await r.text())) broken.push(l + ' (no anchor)'); }
  ok(`9 ${links.size} internal links and anchors resolve`, broken.length === 0, broken.join(', '));
  ok('9 llms.txt points at the FAQ anchor, which exists', /Do I need saved places before Discriminantly can recommend or plan\? .*\/ai#faq/.test(llms) && /id="faq"/.test(H['/ai']));

  // machine-readable surfaces agree
  ok('llms.txt: no record required, sharpens over time, FAQ included', /No existing record is required/.test(llms) && /existing records sharpen the result over time/.test(llms) && /## Frequently asked/.test(llms));
  ok('agent guidance (page and .md): starting with an empty record', /Starting with an empty record/.test(T['/agent-guidance']) && /Starting with an empty record/.test(agentMd) && /do not claim the member has kept, visited or endorsed anything they have not recorded/.test(agentMd));
  ok('itineraries page and connect guide no longer make saved records sound mandatory', /A plan can start from a direct request, from places you have already saved, or both/.test(T['/itineraries']) && /even with an empty record/.test(T['/itineraries']) && /recommend and plan from what you ask, even before you have saved anything/.test(T['/guides/connect-an-ai-assistant']));

  // Customer value, woven into existing sections (no dedicated "Why" section)
  ok('value: hero leads with the outcome, then conversational capture and the plan', /Discriminantly turns the places and things you notice—and the new possibilities your AI discovers—into plans you can share, copy and build together\./.test(T['/']) && /Save what catches your eye just by telling the AI assistant you already use\. Start with a blank slate or draw on what you’ve saved, add recommendations, and shape it all into a day-by-day itinerary\./.test(T['/']) && !/<p class="splash-sub[^>]*>Discriminantly is a durable personal record/.test(H['/']));
  ok('value: "What you save" answers app fatigue without claiming inference', /No separate filing routine: tell your AI what is worth saving, in your own words, while it is already part of the conversation\. The record holds what you asked to save, as you put it\./.test(T['/']) && !/silently|automatically (categoriz|understand|infer)/i.test(T['/']));
  ok('value: the example section carries scattered → brought together, cold start preserved', /Noticed over time\. Useful when you need it\./.test(T['/']) && /no longer stay scattered across chats, screenshots, tabs and bookmarks\. When you need them, a connected AI can bring the relevant ones back, combine them with new recommendations and shape them into a plan\./.test(T['/']) && /An assistant can start from your request alone\./.test(T['/']));
  ok('value: capabilities include conversational capture; six lines, none added', /Save it in conversation , while you are already talking to your AI\./.test(T['/']) && /Find it again by place, kind or your own words, without remembering where it was filed\./.test(T['/']) && /Share, copy or build it together/.test(T['/']) && (H['/'].match(/<ul class="pub-cols2">[\s\S]*?<\/ul>/)[0].match(/<li>/g) || []).length === 6);
  ok('value: "Use it with AI" states cross-model autonomy without universal compatibility or data movement', /Use the AI assistant you already prefer to save what catches your attention, find it again, discover what fits and build a plan\. The record stays in Discriminantly, so compatible assistants can work with the same material when you authorize them\./.test(T['/']) && !/any AI|every AI|all AI assistants|moves? (your )?(data|record) between/i.test(T['/']) && (H['/'].match(/class="pub-plat-row"/g) || []).length === 4);
  ok('value: closing outcome line and control statement', /Save what you notice by saying so\. Plan from scratch or from what you’ve saved\. Share a plan, copy one, or build it with friends\./.test(T['/']) && /Private or public, record by record\. Choose which AI assistants may access your account, revoke them at any time, and see what each one changed\./.test(T['/']) && !/every record is private|cannot (use|train)|only when (explicitly )?mentioned/i.test(T['/']));
  ok('value: /about weaves capture, independence, later use and control; "draw on it" kept', /without another filing system to maintain/.test(T['/about']) && /The record does not belong to any one assistant/.test(T['/about']) && /scattered across chats, screenshots, browser tabs, notes and map pins/.test(T['/about']) && /Later, those things turn into recommendations and plans\./.test(T['/about']) && /yours to set, record by record/.test(T['/about']) && /an AI you authorize can draw on it\./.test(T['/about']));
  ok('value: /ai states clients are not owners of the record or its meaning', /ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning\./.test(T['/ai']) && /You do not need an existing Discriminantly record to begin\./.test(T['/ai']) && /save a restaurant, shop, object, link or experience when you ask; find what you have saved; recommend new possibilities; build a plan from scratch, from saved material or both; and save the resulting itinerary in Discriminantly\./.test(T['/ai']));
  ok('value: no new "Why" section, benefit grid or extra homepage section', !/Why Discriminantly/i.test(H['/']) && !/pub-benefit|pub-why/.test(H['/']) && ['promise', 'keep', 'useful', 'possible', 'together', 'ai', 'start'].every((id) => new RegExp(`id="${id}"`).test(H['/'])) && (H['/'].match(/<section /g) || []).length === 7);
  ok('value: no Perplexity claim', !P.some((p) => /Perplexity/.test(T[p])));

  // 14 Oct 2026 reframe: customer-facing "keep" gone from the headings, eyebrows and ledes; precise uses stay
  const heads = (h) => (h.match(/<(h1|h2|h3|p class="lbl pub-eyebrow|p class="splash-sub|p class="splash-pair-lead)[^>]*>[\s\S]*?<\/(h1|h2|h3|p)>/g) || []).map((x) => x.replace(/<[^>]+>/g, ' ')).join(' ');
  ok('reframe: no "keep/kept" in any heading, eyebrow or lede of /, /how-it-works, /ai, /guides, /about, except the semantic "What keeping one asserts"', ['/', '/how-it-works', '/ai', '/guides', '/about'].every((p) => !/\b(keep|kept|keeping)\b/i.test(heads(H[p]))) && /What keeping one asserts/.test(T['/notes']));
  ok('reframe: guide titles use save / what you’ve saved; slugs unchanged', /Save and organize objects and interests/.test(T['/guides']) && /Plan a trip from what you’ve saved/.test(T['/guides']) && /href="\/guides\/keep-objects-and-interests"/.test(H['/guides']) && /href="\/guides\/plan-from-what-you-keep"/.test(H['/guides']));
  ok('reframe: semantic uses retained (adoption, state transition, interface terminology, conversational example)', /Adding a place to a plan keeps it as a travel mark/.test(T['/itineraries']) && /Keeping turns it into a mark in your record/.test(T['/guides/remember-places']) && /Kept 4 March/.test(T['/']) && /Keep Hatchards in London/.test(T['/ai/chatgpt']) && /Kept, visited, owned, endorsed: each its own act/.test(T['/how-it-works']));
  ok('reframe: no automatic capture or inference claimed; not a travel planner only', !P.some((p) => /automatic(ally)? (captur|tag|infer)/i.test(T[p])) && /objects and interests/.test(T['/']) && /may never become part of a trip|Not yet a visit|never a record of going/.test(T['/itineraries'] + T['/travel-marks']));

  // Independent identity: visible once on /about, formal in machine-readable summaries, not everywhere
  const ID = 'Discriminantly is an independent AI startup building a personal record controlled by the person—not the model they happen to use.';
  const FORMAL = 'Discriminantly is an independent AI startup and an AI-connected personal record for interests, places, travels and plans. The record is held by Discriminantly. AI platforms are authorized clients of it rather than owners of its semantics.';
  ok('identity: /about states it once, in "Who makes it"', T['/about'].split(ID).length === 2 && /<section class="pub-sec " id="who"[\s\S]*?independent AI startup[\s\S]*?<\/section>/.test(H['/about']));
  ok('identity: /about description and Organization description', /<meta name="description" content="Discriminantly is an independent AI startup that turns the places and things you notice into plans: a personal record you control, used through the compatible AI assistants you choose\.">/.test(H['/about']) && graph(H['/about']).some((x) => x['@id'] === ORIGIN + '/#org' && x.description === FORMAL));
  ok('identity: llms.txt and agent guidance (page and .md) carry the formal statement', llms.includes(FORMAL) && agentMd.includes(FORMAL) && T['/agent-guidance'].includes(FORMAL));
  ok('identity: /ai uses "independent" once, as architecture', /Because the record is independent of any one AI assistant, you can authorize compatible clients to work with the same Discriminantly account\./.test(T['/ai']) && (T['/ai'].match(/independent/gi) || []).length === 1);
  const allDesc = await Promise.all(['/', '/how-it-works', '/notes', '/travel-marks', '/check-ins', '/collections', '/itineraries', '/warrants', '/ai', '/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other', '/guides', '/agent-guidance', '/privacy', '/terms', '/support', '/activity'].map(async (p) => [p, (/<meta name="description" content="([^"]*)"/.exec(await get(p)) || [])[1] || '']));
  ok('identity: not in any other page description, the homepage title, or the homepage body', allDesc.every(([, d]) => !/startup|indie/i.test(d)) && !/startup|indie/i.test(T['/']) && !/startup/i.test((/<title>([^<]*)<\/title>/.exec(H['/']) || [])[1]));
  ok('identity: no "indie", "company", size or open-framework language on the public pages', !P.some((p) => /\bindie\b|\bAI company\b|\bsmall team\b|\btiny\b|hobby|scrappy|underdog|bootstrapped|open[- ]source|open framework|model[- ]agnostic|AI wrapper/i.test(T[p])));
  ok('identity: no homepage badge or extra section', (H['/'].match(/<section /g) || []).length === 7 && !/class="[^"]*badge[^"]*"[^>]*>\s*(Indie|Independent|Founder)/i.test(H['/']));

  // 12. No credentials or reviewer material in markup
  ok('12 no credentials, keys or reviewer-account material in markup', !P.some((p) => /api_token|token_hash|sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{16,}|\/mcp\/[0-9a-f]{20,}|musereview|Muse test/.test(H[p])));

  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
