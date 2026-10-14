// Cold-start recommendation and planning story on the public pages.
// Checks that no page presents an existing record as a prerequisite for
// recommendations or plans, that the record is described as sharpening the
// result, and that recommendations stay distinct from kept records.
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
  const P = ['/', '/how-it-works', '/ai', '/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other', '/itineraries', '/guides/plan-from-what-you-keep', '/guides/connect-an-ai-assistant', '/about', '/agent-guidance'];
  const H = {}; for (const p of P) H[p] = await get(p);
  const T = Object.fromEntries(P.map((p) => [p, txt(H[p])]));
  const llms = await get('/llms.txt'), agentMd = await get('/agent-guidance.md');

  // 1. Homepage supports cold start
  ok('1 home: recommendations and plans from a direct request', /ask for recommendations and make plans from a direct request\. What you have kept and experienced gives them sharper direction over time\./.test(T['/']));
  ok('1 home: capabilities say recommendations come from the request, sharpened by evidence', /Recommendations from what you ask for , sharpened by the evidence you have accumulated\./.test(T['/']) && /Plans can start fresh , use places you already keep, or combine both\./.test(T['/']));
  ok('1 home: the example is framed as one workflow, and its summary says a request alone is enough', /One workflow, not a required order: you can also begin with a direct request and nothing kept\./.test(T['/']) && /An assistant can start from your request alone\. When you have relevant records, it can use that evidence to make the plan more personal\./.test(T['/']));
  ok('1 home: the old corpus-first lines are gone', !/Recommendations from evidence , not a guess about you|Plans from places you already keep , with new ones added|The assistant starts from what was kept and recorded|receive recommendations shaped by what you have kept/.test(T['/']));

  // 2. How it works is not a mandatory sequence
  ok('2 how-it-works: "Eight ways…", an existing record is not required', /Eight ways Discriminantly helps you keep, organize, discover and plan\. You can begin with something worth remembering or start with a destination and a direct request—an existing record is not required\./.test(T['/how-it-works']));
  ok('2 how-it-works: step 5 is request, kept places, or both', /Build an Itinerary from a direct request, places you already keep, or both\./.test(T['/how-it-works']) && /even if your record is empty/.test(T['/how-it-works']));
  ok('2 how-it-works: step 7 covers cold start and record-enhanced', /It can recommend new places and build plans from what you ask\. When you have relevant records, it can retrieve them, with your authorization, to sharpen the recommendations/.test(T['/how-it-works']));
  ok('2 how-it-works: still eight steps, plan still not a visit or endorsement', (graph(H['/how-it-works']).find((x) => x['@type'] === 'HowTo').step || []).length === 8 && /it does not make it a visit or an endorsement/.test(T['/how-it-works']));
  ok('2 how-it-works: the HowTo description no longer implies a required order', /not a required order/.test(graph(H['/how-it-works']).find((x) => x['@type'] === 'HowTo').description));

  // 3. AI hub says no record is required
  ok('3 /ai: "You do not need an existing Discriminantly record to begin."', /You do not need an existing Discriminantly record to begin\. Ask your assistant for recommendations or a plan from a destination, interests and constraints\./.test(T['/ai']));
  ok('3 /ai: recommendations happen in the connected assistant; Discriminantly holds the record', /Recommendations and conversational planning happen in the assistant you connect\. Discriminantly holds the durable record/.test(T['/ai']));
  ok('3 /ai: the cold-start statement comes before the screenshots', H['/ai'].indexOf('id="no-record-needed"') > 0 && H['/ai'].indexOf('id="no-record-needed"') < H['/ai'].indexOf('id="useful"'));
  ok('3 /ai: meta description states it plainly', /No saved record is needed/.test((/<meta name="description" content="([^"]*)"/.exec(H['/ai']) || [])[1] || ''));

  // 4. ChatGPT guide: three modes, verification kept
  ok('4 chatgpt: cold-start, record-enhanced and capture examples', ['@Discriminantly Plan two days in Naples around classic cafés, pizza and tailoring.', '@Discriminantly Plan a weekend in London using places I’ve kept, and recommend a few complementary additions.', '@Discriminantly Keep Hatchards in London for me.'].every((s) => T['/ai/chatgpt'].includes(s)));
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
  ok('itineraries page and connect guide no longer make saved records sound mandatory', /A plan can start from a direct request, from places you have already kept, or both/.test(T['/itineraries']) && /even with an empty record/.test(T['/itineraries']) && /recommend and plan from what you ask, even before you have kept anything/.test(T['/guides/connect-an-ai-assistant']));

  // Customer value, woven into existing sections (no dedicated "Why" section)
  ok('value: hero conveys conversational capture, the record staying in Discriminantly, and later use', /Keep the places, objects and interests that catch your attention by talking naturally to your AI\. They remain in Discriminantly as a record you control—ready to recall, explore and turn into plans\./.test(T['/']));
  ok('value: "What you keep" answers app fatigue without claiming inference', /No separate filing routine: tell your AI what is worth keeping, in your own words, while it is already part of the conversation\. The record holds what you asked to keep, as you put it\./.test(T['/']) && !/silently|automatically (categoriz|understand|infer)/i.test(T['/']));
  ok('value: the example section carries scattered → brought together, cold start preserved', /no longer stay scattered across chats, notes and bookmarks\. A connected AI can bring the relevant ones together when it is time to recommend, organize or plan\./.test(T['/']) && /An assistant can start from your request alone\./.test(T['/']));
  ok('value: capabilities include conversational capture; six lines, none added', /Keep it in conversation , then find it again by place, kind or your own words\./.test(T['/']) && (H['/'].match(/<ul class="pub-cols2">[\s\S]*?<\/ul>/)[0].match(/<li>/g) || []).length === 6);
  ok('value: "Use it with AI" states cross-model autonomy without universal compatibility or data movement', /Your record lives in Discriminantly, not inside one AI\. Connect the compatible assistant you choose to the same record, and revoke its access when you choose\./.test(T['/']) && !/any AI|every AI|all AI assistants|moves? (your )?(data|record) between/i.test(T['/']) && (H['/'].match(/class="pub-plat-row"/g) || []).length === 4);
  ok('value: closing control statement', /Private or public, record by record\. Choose which AI assistants may access your account, revoke them at any time, and see what each one changed\./.test(T['/']) && !/every record is private|cannot (use|train)|only when (explicitly )?mentioned/i.test(T['/']));
  ok('value: /about weaves capture, independence, later use and control; "draw on it" kept', /without another filing system to maintain/.test(T['/about']) && /The record does not belong to any one assistant/.test(T['/about']) && /Things kept at different times become useful later/.test(T['/about']) && /yours to set, record by record/.test(T['/about']) && /an AI you authorize can draw on it\./.test(T['/about']));
  ok('value: /ai states clients are not owners of the record or its meaning', /ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning\./.test(T['/ai']) && /You do not need an existing Discriminantly record to begin\./.test(T['/ai']));
  ok('value: no new "Why" section, benefit grid or extra homepage section', !/Why Discriminantly/i.test(H['/']) && !/pub-benefit|pub-why/.test(H['/']) && ['promise', 'keep', 'useful', 'possible', 'together', 'ai', 'start'].every((id) => new RegExp(`id="${id}"`).test(H['/'])) && (H['/'].match(/<section /g) || []).length === 7);
  ok('value: no Perplexity claim', !P.some((p) => /Perplexity/.test(T[p])));

  // 12. No credentials or reviewer material in markup
  ok('12 no credentials, keys or reviewer-account material in markup', !P.some((p) => /api_token|token_hash|sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9]{16,}|\/mcp\/[0-9a-f]{20,}|musereview|Muse test/.test(H[p])));

  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
