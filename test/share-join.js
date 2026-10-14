// Share link -> new account -> the plan is theirs, with a welcome (v2.96).
// Usage: node test/share-join.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sharejoin-')), DB = path.join(DIR, 's.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = (p, { sid = '', form = null, redirect = 'manual' } = {}) => fetch(BASE + p, { method: form ? 'POST' : 'GET', redirect, headers: { ...(sid ? { cookie: 'sid=' + sid } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
const sidOf = (r) => ((r.headers.get('set-cookie') || '').match(/sid=([^;]+)/) || [])[1];
const token = async () => ((await (await req('/join')).text()).match(/data-ft="([^"]+)"/) || [])[1];

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await sleep(100); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  // The sharer: an account with a plan, two stops, and a share link.
  const owner = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('sharer','Sharer','sharer@t.test','x','modern')").run().lastInsertRowid;
  const osid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(osid, owner);
  let r = await req('/t/new', { sid: osid, form: { title: 'Lisbon, three days', context: 'Tiles and seafood' } });
  const itId = +(r.headers.get('location') || '').replace('/t/', '');
  ok('setup: the sharer has a plan', r.status === 303 && itId > 0, r.status + ' ' + r.headers.get('location'));
  for (const [label, name, lat, lng] of [['Breakfast', 'Café A Brasileira', 38.7107, -9.1402], ['Dinner', 'Cervejaria Ramiro', 38.7206, -9.1355]]) {
    const mid = db.prepare("INSERT INTO marks(user_id,name,why,locality,country,address,lat,lng,private) VALUES(?,?,?,'Lisbon','Portugal',?,?,?,0)").run(owner, name, 'worth it', name + ' St 1', lat, lng).lastInsertRowid;
    const mu = db.prepare('SELECT uid FROM marks WHERE id=?').get(mid).uid;
    db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'mark',?,'adopted')").run(owner, mu);
    await req(`/t/${itId}/stops`, { sid: osid, form: { label, mark_uid: mu } });
  }
  r = await req(`/t/${itId}/share`, { sid: osid, form: { show_author: '1' } });
  const page = await r.text();
  const tok = (page.match(/\/s\/([A-Za-z0-9_-]{20,100})/) || [])[1];
  ok('setup: a share link exists', !!tok, page.slice(0, 200));

  // Signed out, the share page points at join with the link as next.
  const sp = await (await req('/s/' + tok)).text();
  ok('share page: signed out, the first action is to create an account, returning to the link', new RegExp(`/join\\?next=%2Fs%2F${tok}`).test(sp));

  // A new account from that link: no Adopt click; straight to the plan, with the welcome.
  const ft = await token(); await sleep(2100);
  r = await req('/join', { form: { name: 'New Person', email: 'newperson@example.com', password: 'correcthorse', terms: '1', ft, next: '/s/' + tok } });
  const sid = sidOf(r), loc = r.headers.get('location') || '';
  ok('join: lands on the member’s own copy', r.status === 303 && /^\/t\/\d+\?mine=1$/.test(loc) && !!sid, r.status + ' ' + loc);
  const me = db.prepare("SELECT * FROM users WHERE email='newperson@example.com'").get();
  const copy = db.prepare('SELECT * FROM itineraries WHERE user_id=? ORDER BY id DESC LIMIT 1').get(me.id);
  ok('join: the copy is theirs, kept, with both stops and two new marks of their own', !!copy && copy.title === 'Lisbon, three days' && loc.startsWith('/t/' + copy.id)
    && !!db.prepare("SELECT 1 FROM adoptions WHERE user_id=? AND subject_type='itinerary' AND subject_uid=? AND state='adopted'").get(me.id, copy.uid)
    && db.prepare('SELECT COUNT(*) n FROM itinerary_stops WHERE itinerary_id=?').get(copy.id).n === 2
    && db.prepare('SELECT COUNT(*) n FROM marks WHERE user_id=?').get(me.id).n === 2);
  ok('join: signup source records the share; the share counts one adoption', me.signup_source === 'itinerary_share' && db.prepare('SELECT adopted_count FROM itinerary_shares WHERE itinerary_id=?').get(itId).adopted_count === 1);
  ok('join: the original is untouched', db.prepare('SELECT COUNT(*) n FROM itinerary_stops WHERE itinerary_id=?').get(itId).n === 2 && db.prepare('SELECT user_id FROM itineraries WHERE id=?').get(itId).user_id === owner);

  const plan = await (await req(loc, { sid })).text();
  ok('plan: the onboarding card itself sits above the plan, opened on Connect your AI, saying the plan is now theirs', /<article class="card welcome-card wl-on-plan" id="welcome"/.test(plan) && /This itinerary is now yours/.test(plan)
    && /id="wl-s2" class="wl-radio" checked/.test(plan) && /Start with the plan you came for\./.test(plan) && /the plan below/.test(plan) && plan.indexOf('welcome-card') < plan.indexOf('class="strip"'));
  ok('plan: the card carries a Dismiss, and the plain "now yours" line is not doubled', new RegExp(`action="/t/${copy.id}/welcome/dismiss"`).test(plan) && !/itin-mine/.test(plan));
  ok('plan: the card is still there on a later plain visit (not tied to the arrival URL)', /wl-on-plan/.test(await (await req('/t/' + copy.id, { sid })).text()));
  ok('plan: the card is not on the member\u2019s other pages', !/wl-on-plan/.test(await (await req('/t', { sid })).text()));
  r = await req(`/t/${copy.id}/welcome/dismiss`, { sid, form: {} });
  const after = await (await req('/t/' + copy.id, { sid })).text();
  ok('dismiss: one click; the plan page reads as normal afterwards; the feed keeps its own copy', r.status === 303 && !/welcome-card/.test(after) && /welcome-card/.test(await (await req('/', { sid })).text()));
  ok('dismiss: a plain ?mine=1 visit after dismissal shows the short "now yours" line', /itin-mine/.test(await (await req(`/t/${copy.id}?mine=1`, { sid })).text()));
  ok('dismiss: only the owner can dismiss', (await req(`/t/${copy.id}/welcome/dismiss`, { sid: osid, form: {} })).status === 404);

  // The feed: the full Welcome card, opened on connecting, naming the plan they came for.
  const feed = await (await req('/', { sid })).text();
  ok('feed: the full Welcome card (not the compact one) although records now exist, saying they arrived through a shared plan', /welcome-card/.test(feed) && !/welcome-compact/.test(feed) && /You arrived through a shared plan/.test(feed) && /Start with the plan you came for\./.test(feed) && new RegExp(`href="/t/${copy.uid}"`).test(feed));
  ok('feed: the Welcome card is the first entry, above the plan and places that came with the account', feed.indexOf('welcome-card') < feed.indexOf('Lisbon, three days') && feed.indexOf('welcome-card') < feed.indexOf('Caf\u00e9 A Brasileira'));

  // An existing member keeps the explicit choice.
  const other = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('member','Member','member@t.test','x','modern')").run().lastInsertRowid;
  const msid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(msid, other);
  const sp2 = await (await req('/s/' + tok, { sid: msid })).text();
  ok('share page: a signed-in member still sees Make this mine (no automatic copy)', new RegExp(`action="/s/${tok}/mine"`).test(sp2) && db.prepare('SELECT COUNT(*) n FROM itineraries WHERE user_id=?').get(other).n === 0);

  // A revoked link at join time: the account is still made; they land on the link's page, which says so.
  db.prepare("UPDATE itinerary_shares SET state='revoked' WHERE itinerary_id=?").run(itId);
  const ft2 = await token(); await sleep(2100);
  r = await req('/join', { form: { name: 'Late Person', email: 'late@example.com', password: 'correcthorse', terms: '1', ft: ft2, next: '/s/' + tok } });
  ok('join: a revoked link still creates the account and returns them to the link page', r.status === 303 && r.headers.get('location') === '/s/' + tok && !!db.prepare("SELECT 1 FROM users WHERE email='late@example.com'").get());

  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
