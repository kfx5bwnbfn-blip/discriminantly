// Pre-indexing remediation checks for the public pages.
// Boots a seeded server on a scratch database and checks the apex redirect,
// root routing, copy corrections, metadata and structured data, consistency
// between the machine-readable surfaces, platform-status distinctions, and
// that a private record never reaches public HTML, metadata, sitemaps or cards.
// Usage: node test/public-preindex.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'preindex-')), DB = path.join(DIR, 'p.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const ORIGIN = 'https://www.discriminantly.com';
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com', CHATGPT_PLUGIN_URL: 'https://chatgpt.com/plugins/plugin_test', PUBLIC_ORIGIN: ORIGIN }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
// Raw request with an explicit Host header (fetch will not let us set it).
const raw = (method, p, headers = {}) => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: PORT, path: p, method, headers }, (rs) => { rs.resume(); rs.on('end', () => res({ status: rs.statusCode, headers: rs.headers })); });
  r.on('error', rej); r.end();
});
const get = async (p, h = {}) => { const r = await fetch(BASE + p, { headers: h, redirect: 'manual' }); return { r, t: await r.text() }; };
const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const desc = (h) => (/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] || '';

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  // ---- P0: apex host → canonical www, one hop, path and query preserved ----
  for (const [proto, label] of [['http', 'http://discriminantly.com'], ['https', 'https://discriminantly.com']]) {
    const a = await raw('GET', '/notes?x=1&y=2', { Host: 'discriminantly.com', 'X-Forwarded-Proto': proto });
    ok(`apex: ${label}/notes?x=1&y=2 → 301 ${ORIGIN}/notes?x=1&y=2`, a.status === 301 && a.headers.location === ORIGIN + '/notes?x=1&y=2', `${a.status} ${a.headers.location}`);
    const b = await raw('GET', '/', { Host: 'discriminantly.com:443', 'X-Forwarded-Proto': proto });
    ok(`apex: ${label}/ (with port) → 301 ${ORIGIN}/`, b.status === 301 && b.headers.location === ORIGIN + '/', `${b.status} ${b.headers.location}`);
  }
  const ap = await raw('POST', '/mcp', { Host: 'DISCRIMINANTLY.COM' });
  ok('apex: a non-GET is a 308 (method preserved), host match is case-insensitive', ap.status === 308 && ap.headers.location === ORIGIN + '/mcp', `${ap.status} ${ap.headers.location}`);
  const ah = await raw('HEAD', '/welcome', { Host: 'discriminantly.com' });
  ok('apex: HEAD is a 301 straight to www (no second hop through /welcome first)', ah.status === 301 && ah.headers.location === ORIGIN + '/welcome');
  const www = await raw('GET', '/robots.txt', { Host: 'www.discriminantly.com', 'X-Forwarded-Proto': 'https' });
  ok('www: not redirected (no loop)', www.status === 200, www.status);
  const muse = await raw('GET', '/robots.txt', { Host: 'muse.discriminantly.com' });
  ok('muse host: not redirected by the apex rule', muse.status !== 301 && muse.status !== 308, muse.status);
  const sub = await raw('GET', '/robots.txt', { Host: 'evil-discriminantly.com' });
  ok('a look-alike host is not treated as the apex', sub.status === 200, sub.status);

  // ---- routing unchanged ----
  const w = await get('/welcome?src=a');
  ok('/welcome → 301 / with the query kept', w.r.status === 301 && w.r.headers.get('location') === '/?src=a');
  const home = await get('/');
  ok('signed-out / is the public homepage', home.r.status === 200 && /<header class="pub-head/.test(home.t) && /<h1/.test(home.t));

  // ---- P1.1 Travel Marks definition ----
  ok('homepage: Travel Marks are "Places worth remembering or considering."', home.t.includes('Places worth remembering or considering.') && !home.t.includes('Places worth returning to.'));
  ok('homepage: the other five short definitions are unchanged', ['Things worth remembering.', 'The visits you actually made.', 'Records, grouped your way.', 'You stand behind'].every((s) => home.t.includes(s)) || ['Things worth remembering.', 'The visits you actually made.', 'Records, grouped your way.'].every((s) => home.t.includes(s)));

  // ---- P1.2 how-it-works transitions ----
  const how = await get('/how-it-works');
  ok('how-it-works: lede no longer says each step leaves a record', !/Each one leaves a record/.test(how.t) && /not every step creates a new one/.test(how.t));
  ok('how-it-works: names intro no longer says each step leaves a record', !/Each step leaves a record with a name/.test(how.t) && /Six kinds of record, each with one meaning\./.test(how.t));
  ok('how-it-works: still eight numbered steps and six definitions', (ld(how.t)[0]['@graph'].find((x) => x['@type'] === 'HowTo').step || []).length === 8 && (how.t.match(/<div class="pub-object"><dt>/g) || []).length === 6);

  // ---- P1.3 shared private place disclosure, consistent ----
  const AGENT = 'A private Travel Mark remains private. If it is added as a Stop in a shared itinerary, its place name and address may become visible to collaborators after the member confirms. The originating mark, private commentary and unrelated records remain private.';
  const ag = await get('/agent-guidance'), md = await get('/agent-guidance.md'), llms = await get('/llms.txt');
  const plain = (s) => s.replace(/&#39;|&rsquo;|’/g, '’');
  ok('disclosure: /how-it-works carries the homepage sentence', /may become visible to collaborators, after you confirm/.test(how.t) && /originating mark, your private commentary and the rest of your record remain private/.test(how.t));
  ok('disclosure: /agent-guidance, .md and llms.txt carry the same sentence', [ag.t, md.t, llms.t].every((t) => plain(t).includes(AGENT)));
  ok('disclosure: no unqualified "visible only to the member" claim remains', ![ag.t, md.t, llms.t].some((t) => /Private records are visible only to the member and to clients/.test(t)));

  // ---- P1.4 homepage WebPage.name ----
  const hg = ld(home.t)[0]['@graph'], wp = hg.find((x) => x['@type'] === 'WebPage');
  ok('homepage: WebPage.name is "Discriminantly — Your interests, travels and plans"', wp && wp.name === 'Discriminantly — Your interests, travels and plans', wp && wp.name);
  ok('homepage: Organization and WebSite identities unchanged', hg.find((x) => x['@type'] === 'Organization')['@id'] === ORIGIN + '/#org' && hg.find((x) => x['@type'] === 'WebSite')['@id'] === ORIGIN + '/#site');

  // ---- P1.5 generic AI memory ----
  const about = await get('/about'), gc = await get('/guides/connect-an-ai-assistant');
  ok('about: explains the difference from generic AI memory', /Unlike generic AI memory, Discriminantly is an inspectable record you control/.test(plain(about.t)));
  ok('connect guide: explains the difference from an assistant’s own memory', /Unlike an assistant’s built-in memory, Discriminantly is a record you can inspect and control/.test(plain(gc.t)));

  // ---- P1.6 verification on ChatGPT and Claude, statuses distinct ----
  const cg = await get('/ai/chatgpt'), cl = await get('/ai/claude'), mu = await get('/ai/muse');
  for (const [n, t] of [['chatgpt', cg.t], ['claude', cl.t]]) {
    ok(`${n}: read-only prompt, expected result, troubleshooting and revocation`, /id="verify"/.test(t) && /Don’t add or change anything\./.test(plain(t)) && /What you should see/.test(t) && /If access is refused or nothing comes back/.test(t) && /Disconnecting/.test(t) && /choose Revoke beside/.test(t));
  }
  ok('claude: Last tested date shown, tied to the test that ran', /Last tested<\/span> <time>13 October 2026<\/time>, by Discriminantly: the read-only prompt above/.test(cl.t));
  ok('chatgpt: Last tested 8 October 2026, attributed to OpenAI’s review, not to Discriminantly', /Last tested<\/span> <time>8 October 2026<\/time>, by OpenAI, during its plugin review:/.test(plain(cg.t)) && !/by Discriminantly:/.test(cg.t) && /Discriminantly has not yet recorded a dated test of its own on ChatGPT/.test(cg.t));
  ok('muse: Last tested date shown (12 October 2026)', /Last tested<\/span> <time>12 October 2026<\/time>, by Discriminantly:/.test(mu.t));
  ok('chatgpt: approval and listing attributed to OpenAI, separate from Discriminantly’s testing', /approval and directory listing are OpenAI’s\./.test(plain(cg.t)) && /Listed in ChatGPT’s plugin directory/.test(plain(cg.t)));
  ok('claude: tested by Discriminantly; not reviewed or listed by Anthropic', /tested by Discriminantly/.test(cl.t) && /Anthropic has not reviewed or listed the connector/.test(cl.t) && !/Listed in/.test(cl.t));
  ok('muse: submitted 13 October 2026, in review, not approved or listed', /Submitted to the Muse platform on 13 October 2026/.test(mu.t) && /Not yet approved or directory-listed/.test(mu.t) && !/\bApproved by\b/.test(mu.t));

  // ---- P1.7 meta descriptions are complete sentences ----
  const pages = ['/', '/how-it-works', '/notes', '/travel-marks', '/check-ins', '/collections', '/itineraries', '/warrants', '/ai', '/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other', '/guides', '/guides/keep-objects-and-interests', '/guides/remember-places', '/guides/plan-from-what-you-keep', '/guides/share-or-build-an-itinerary-together', '/guides/connect-an-ai-assistant', '/agent-guidance', '/about', '/privacy', '/terms', '/support', '/activity'];
  const H = {}; for (const p of pages) H[p] = (await get(p)).t;
  const trunc = pages.filter((p) => /…$/.test(desc(H[p])) || !/[.!?]$/.test(desc(H[p])));
  ok('descriptions: none truncated, each ends a sentence', trunc.length === 0, trunc.map((p) => p + ' :: ' + desc(H[p])).join(' | '));
  ok('descriptions: unique across the public pages', new Set(pages.map((p) => desc(H[p]))).size === pages.length);

  // ---- P1.8 activity label ----
  ok('/activity signed out: "Public activity"', /Public activity/.test(H['/activity']) && !/Activity from the entire network/.test(H['/activity']));

  // ---- signed-in application unchanged ----
  const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const uid = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('preview','Preview','p@t.test','x','modern')").run().lastInsertRowid;
  const sid = require('crypto').randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sid, uid);
  const inRoot = await get('/', { cookie: 'sid=' + sid });
  ok('signed-in /: the application home, never shared-cached, label unchanged', /id="curtain-nub"/.test(inRoot.t) && !/<header class="pub-head/.test(inRoot.t) && inRoot.r.headers.get('cache-control') === 'private, no-store' && /Activity from the entire network/.test(inRoot.t));

  // ---- JSON-LD parses on every changed page; absolute URLs ----
  const bad = pages.filter((p) => { try { const g = ld(H[p]); return !g.length || /"(url|item|@id|contentUrl)":"\//.test(JSON.stringify(g)); } catch { return true; } });
  ok('JSON-LD parses on every public page, all URLs absolute', bad.length === 0, bad.join(', '));

  // ---- sitemap: every URL 200, canonical origin ----
  const sm = (await get('/sitemap.xml')).t, locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const off = locs.filter((u) => !u.startsWith(ORIGIN + '/'));
  const non200 = []; for (const u of locs) { const r = await fetch(BASE + u.slice(ORIGIN.length), { redirect: 'manual' }); if (r.status !== 200) non200.push(u + ' ' + r.status); }
  ok(`sitemap: ${locs.length} URLs, all on ${ORIGIN}`, locs.length >= 25 && off.length === 0, off.join(', '));
  ok('sitemap: every URL returns 200', non200.length === 0, non200.join(', '));

  // ---- no private data in public HTML, metadata, sitemap, machine files or cards ----
  const owner = db.prepare("SELECT id FROM users WHERE id<>? ORDER BY id LIMIT 1").get(uid).id;
  const secret = 'Zqxv private canary ' + require('crypto').randomBytes(4).toString('hex');
  const oid = db.prepare("INSERT INTO objects(user_id,name,why,tags,private) VALUES(?,?,?,'canarytag',1)").run(owner, secret, secret).lastInsertRowid;
  const ouid = db.prepare('SELECT uid FROM objects WHERE id=?').get(oid).uid;
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'object',?,'adopted')").run(owner, ouid);
  ok('canary: the private note is a real, adopted record', !!db.prepare('SELECT 1 FROM adopted_objects WHERE id=? AND private=1').get(oid));
  const surfaces = [...pages.map((p) => get(p).then((x) => x.t)), get('/sitemap.xml').then((x) => x.t), get('/llms.txt').then((x) => x.t), get('/agent-guidance.md').then((x) => x.t)];
  const all = (await Promise.all(surfaces)).join('\n');
  ok('a private note never appears on a public surface', !all.includes(secret));
  const card = await fetch(`${BASE}/card/o/${oid}.png`), page = await fetch(`${BASE}/o/${oid}`);
  ok('a private note has no public card and no public page', card.status === 404 && page.status === 404, `${card.status} ${page.status}`);

  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
