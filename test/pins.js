// Pins (v2.119): a note or mark can lead one of its owner's collections, or
// the owner's whole notes / marks page. Web app only — nothing on MCP.
// Usage: node test/pins.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-')), DB = path.join(DIR, 'd.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = (p, sid = '') => fetch(BASE + p, { redirect: 'manual', headers: sid ? { cookie: 'sid=' + sid } : {} });
const post = (p, body, sid) => fetch(BASE + p, { method: 'POST', redirect: 'manual', headers: { ...(sid ? { cookie: 'sid=' + sid } : {}), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
const titles = (h) => [...h.matchAll(/<article class="note[^"]*"[\s\S]*?<h2><a href="\/o\/(\d+)">/g)].map((m) => +m[1]);
const pressed = (h) => (h.match(/class="card-pin"[^>]*aria-pressed="true"/g) || []).length;
const rules = (h) => [...h.matchAll(/data-pin-rule="(head|tail)"/g)].map((m) => m[1]);
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const u = db.prepare('SELECT id, handle FROM users WHERE is_admin=1').get();
  const sid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sid, u.id);
  ok('migration: pinned_at on objects, marks, note_collections, mark_collections', ['objects', 'marks', 'note_collections', 'mark_collections'].every((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'pinned_at')));
  // the admin's notes, oldest two
  const mine = db.prepare('SELECT id FROM objects WHERE user_id=? ORDER BY id').all(u.id).map((r) => r.id);
  ok('fixture: the member has at least four notes', mine.length >= 4, mine.length);
  const page = () => get('/u/' + u.handle + '?tab=notes', sid).then((r) => r.text());
  let h = await page();
  ok('owner sees a pin control on every card, none pressed, no rules', (h.match(/class="card-pin"/g) || []).length === titles(h).length && pressed(h) === 0 && rules(h).length === 0, [(h.match(/class="card-pin"/g) || []).length, titles(h).length, pressed(h)]);
  const vis = await (await get('/u/' + u.handle + '?tab=notes')).text();
  ok('a visitor sees no pin control', !/class="card-pin"/.test(vis));
  ok('pinning needs a signed-in member', (await post(`/o/${mine[0]}/pin`, { c: 0, on: 1 })).status === 401);
  let r = await post(`/o/${mine[0]}/pin`, { c: 0, on: 1 }, sid);
  ok('POST /o/:id/pin c=0 pins to the whole notes page', r.status === 200 && (await r.json()).on === true && db.prepare('SELECT pinned_at FROM objects WHERE id=?').get(mine[0]).pinned_at);
  await new Promise((x) => setTimeout(x, 5));
  await post(`/o/${mine[1]}/pin`, { c: 0, on: 1 }, sid);
  h = await page();
  let t = titles(h);
  ok('the page leads with the pinned notes, latest pin first, then the rest', t[0] === mine[1] && t[1] === mine[0], t.slice(0, 3));
  ok('the pinned group is framed: a head rule, then a tail rule before the rest', JSON.stringify(rules(h)) === '["head","tail"]', rules(h));
  ok('pinned cards carry is-pinned and a pressed control', (h.match(/class="note[^"]* is-pinned"/g) || []).length === 2 && pressed(h) === 2);
  const v2 = await (await get('/u/' + u.handle + '?tab=notes')).text();
  ok('visitor: same order, the rules, no control', titles(v2)[0] === mine[1] && rules(v2)[0] === 'head' && !/class="card-pin"/.test(v2));
  const hs = await (await get('/u/' + u.handle + '?tab=notes&q=' + encodeURIComponent('e'), sid)).text();
  ok('a search sets pins aside: no rules, no pressed control', rules(hs).length === 0 && pressed(hs) === 0);
  // a collection: its own pin set
  const c = db.prepare("SELECT id FROM collections WHERE user_id=? AND kind='note' LIMIT 1").get(u.id);
  if (c) {
    const inC = db.prepare('SELECT note_id FROM note_collections WHERE collection_id=?').all(c.id).map((x) => x.note_id);
    const hc0 = await (await get(`/u/${u.handle}?tab=notes&c=${c.id}`, sid)).text();
    ok('inside a collection, page pins do not apply (its own set, empty)', rules(hc0).length === 0 && pressed(hc0) === 0);
    r = await post(`/o/${inC[inC.length - 1]}/pin`, { c: c.id, on: 1 }, sid);
    ok('pin within the collection', r.status === 200 && db.prepare('SELECT pinned_at FROM note_collections WHERE note_id=? AND collection_id=?').get(inC[inC.length - 1], c.id).pinned_at);
    const hc = await (await get(`/u/${u.handle}?tab=notes&c=${c.id}`, sid)).text();
    ok('…and it leads the collection', titles(hc)[0] === inC[inC.length - 1] && rules(hc)[0] === 'head');
    const other = mine.find((id) => !inC.includes(id));
    if (other) ok('a note not in the collection cannot be pinned to it', (await post(`/o/${other}/pin`, { c: c.id, on: 1 }, sid)).status === 400);
    ok('the whole-page view is unchanged by a collection pin', titles(await page())[0] === mine[1]);
  }
  r = await post(`/o/${mine[0]}/pin`, { c: 0, on: 0 }, sid);
  ok('unpin', r.status === 200 && !db.prepare('SELECT pinned_at FROM objects WHERE id=?').get(mine[0]).pinned_at);
  // the cap
  for (const id of mine.slice(0, 6)) { await post(`/o/${id}/pin`, { c: 0, on: 1 }, sid); await new Promise((x) => setTimeout(x, 3)); }
  const pinned = db.prepare('SELECT COUNT(*) c FROM objects WHERE user_id=? AND pinned_at IS NOT NULL').get(u.id).c;
  ok('at most five pins: the sixth retires the oldest', mine.length >= 6 ? pinned === 5 : pinned === Math.min(mine.length, 5), pinned);
  const other = db.prepare('SELECT id FROM objects WHERE user_id<>? LIMIT 1').get(u.id);
  if (other) ok('someone else’s note cannot be pinned', (await post(`/o/${other.id}/pin`, { c: 0, on: 1 }, sid)).status === 400);
  // marks
  const mk = db.prepare('SELECT id FROM marks WHERE user_id=? ORDER BY id').all(u.id).map((x) => x.id);
  if (mk.length) {
    r = await post(`/m/${mk[0]}/pin`, { c: 0, on: 1 }, sid);
    const hm = await (await get('/u/' + u.handle + '?tab=marks', sid)).text();
    ok('marks: pin to the whole marks page; the card leads and is pressed', r.status === 200 && rules(hm)[0] === 'head' && new RegExp(`is-pinned[\\s\\S]*?data-pin="/m/${mk[0]}/pin"[^>]*aria-pressed="true"`).test(hm));
  }
  // MCP untouched
  const ins = (await (await fetch(BASE + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).text());
  ok('nothing about pins on MCP', !/pin/i.test(ins) || !/pinned/i.test(ins));
  console.log(`\n${pass} passed, ${fail} failed`); srv.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
