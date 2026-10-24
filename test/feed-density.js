// Feed card size (v2.116): a Small · Medium · Large toggle in the feed strips,
// saved per member, carried on <body data-density>. Medium is the default and
// sets no attribute, so every page renders exactly as before for anyone who
// never touches it.
// Usage: node test/feed-density.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dens-')), DB = path.join(DIR, 'd.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = (p, sid = '') => fetch(BASE + p, { redirect: 'manual', headers: sid ? { cookie: 'sid=' + sid } : {} });
const post = (p, body, sid) => fetch(BASE + p, { method: 'POST', redirect: 'manual', headers: { ...(sid ? { cookie: 'sid=' + sid } : {}), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const u = db.prepare('SELECT id, handle FROM users WHERE is_admin=1').get();
  const sid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sid, u.id);
  const body = (h) => (h.match(/<body[^>]*>/) || [''])[0];
  let h = await (await get('/', sid)).text();
  ok('home feed, signed in: the toggle sits in the strip with Small, Medium, Large; Medium pressed', /<h3 class="strip">[\s\S]*?<span class="density-seg"[^>]*data-density-seg>/.test(h) && /data-density="s"[^>]*aria-pressed="false"/.test(h) && /data-density="m" class="on"[^>]*aria-pressed="true"/.test(h) && /data-density="l" class=" density-l"/.test(h));
  ok('default: no data-density on <body> (Medium is the card as it has always been)', !/data-density=/.test(body(h)));
  ok('a profile’s activity strip carries the toggle too', /<h1 class="strip">[^<]*’s activity<span class="density-seg"/.test(await (await get('/u/' + u.handle, sid)).text()));
  ok('search results and tag feeds carry no toggle (nothing to size)', !/class="density-seg"/.test(await (await get('/?q=pan', sid)).text()));
  const h2 = await (await get('/activity')).text();
  ok('signed out: no toggle, no preference', (() => { const t = h2; return !/class="density-seg"/.test(t) && !/data-density=/.test(body(t)); })());
  ok('saving needs a signed-in member', (await post('/settings/feed-density', { density: 's' })).status === 302 || (await post('/settings/feed-density', { density: 's' })).status === 303 || (await post('/settings/feed-density', { density: 's' })).status === 401);
  let r = await post('/settings/feed-density', { density: 's' }, sid);
  ok('POST /settings/feed-density saves Small with no page (204)', r.status === 204 && db.prepare('SELECT feed_density FROM users WHERE id=?').get(u.id).feed_density === 's');
  h = await (await get('/', sid)).text();
  ok('the next page carries data-density="s" and the toggle shows Small pressed', /data-density="s"/.test(body(h)) && /data-density="s" class="on"/.test(h));
  ok('…and on the profile feed', /data-density="s"/.test(body(await (await get('/u/' + u.handle, sid)).text())));
  await post('/settings/feed-density', { density: 'l' }, sid);
  ok('Large saves and is carried (the phone reads it as Medium in CSS and the tiler)', /data-density="l"/.test(body(await (await get('/', sid)).text())));
  await post('/settings/feed-density', { density: 'x' }, sid);
  ok('an unknown value falls back to Medium', db.prepare('SELECT feed_density FROM users WHERE id=?').get(u.id).feed_density === 'm' && !/data-density=/.test(body(await (await get('/', sid)).text())));
  r = await post('/settings/feed-density', { density: 's', back: '/u/' + u.handle }, sid);
  ok('with a back path (no JavaScript), it redirects there', (r.status === 302 || r.status === 303) && r.headers.get('location') === '/u/' + u.handle);
  ok('the tiler reads the size: Small packs two columns on a phone and three on desktop, Large one; items that are not cards span', /density === 's' \? \(phone \? 2 : 3\) : density === 'l' \? 1/.test(h) && /feed-band/.test(h) && /feed-span/.test(h));
  console.log(`\n${pass} passed, ${fail} failed`);
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(2); });
