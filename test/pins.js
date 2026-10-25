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
  ok('v2.119.1: no pin control on the whole notes page, no rules', !/class="card-pin"/.test(h) && rules(h).length === 0);
  ok('pinning needs a signed-in member', (await post(`/o/${mine[0]}/pin`, { c: 0, on: 1 })).status === 401);
  ok('v2.119.1: a pin outside a collection (c=0) is refused', (await post(`/o/${mine[0]}/pin`, { c: 0, on: 1 }, sid)).status === 400 && !db.prepare('SELECT pinned_at FROM objects WHERE id=?').get(mine[0]).pinned_at);
  // a collection with at least three notes, made for the test
  const cid = db.prepare("INSERT INTO collections(user_id, kind, name) VALUES(?, 'note', 'Pin test')").run(u.id).lastInsertRowid;
  const inC = mine.slice(0, Math.min(mine.length, 7));
  for (const id of inC) db.prepare('INSERT INTO note_collections(note_id, collection_id) VALUES(?, ?)').run(id, cid);
  const cpage = (extra = '', s2 = sid) => get(`/u/${u.handle}?tab=notes&c=${cid}${extra}`, s2).then((r) => r.text());
  h = await cpage();
  ok('inside a collection the owner sees a pin control on every card, none pressed, no rules', (h.match(/class="card-pin"/g) || []).length === titles(h).length && pressed(h) === 0 && rules(h).length === 0, [(h.match(/class="card-pin"/g) || []).length, titles(h).length]);
  ok('a visitor sees no pin control', !/class="card-pin"/.test(await cpage('', '')));
  let r = await post(`/o/${inC[0]}/pin`, { c: cid, on: 1 }, sid);
  ok('POST /o/:id/pin pins within the collection', r.status === 200 && (await r.json()).on === true && db.prepare('SELECT pinned_at FROM note_collections WHERE note_id=? AND collection_id=?').get(inC[0], cid).pinned_at);
  await new Promise((x) => setTimeout(x, 5));
  await post(`/o/${inC[1]}/pin`, { c: cid, on: 1 }, sid);
  h = await cpage();
  let t = titles(h);
  ok('the collection leads with the pinned notes, latest pin first, then the rest', t[0] === inC[1] && t[1] === inC[0], t.slice(0, 3));
  ok('the pinned group is framed: a head rule, then a tail rule before the rest', JSON.stringify(rules(h)) === '["head","tail"]', rules(h));
  ok('pinned cards carry is-pinned and a pressed control', (h.match(/class="note[^"]* is-pinned"/g) || []).length === 2 && pressed(h) === 2);
  const v2 = await cpage('', '');
  ok('visitor: same order, the rules, no control', titles(v2)[0] === inC[1] && rules(v2)[0] === 'head' && !/class="card-pin"/.test(v2));
  const hs = await cpage('&q=' + encodeURIComponent('e'));
  ok('a search sets pins aside: no rules, no pressed control', rules(hs).length === 0 && pressed(hs) === 0);
  ok('the whole notes page is unchanged by collection pins', rules(await page()).length === 0);
  const other = db.prepare('SELECT id FROM objects WHERE user_id=? AND id NOT IN (SELECT note_id FROM note_collections WHERE collection_id=?) LIMIT 1').get(u.id, cid);
  if (other) ok('a note not in the collection cannot be pinned to it', (await post(`/o/${other.id}/pin`, { c: cid, on: 1 }, sid)).status === 400);
  r = await post(`/o/${inC[0]}/pin`, { c: cid, on: 0 }, sid);
  ok('unpin', r.status === 200 && !db.prepare('SELECT pinned_at FROM note_collections WHERE note_id=? AND collection_id=?').get(inC[0], cid).pinned_at);
  for (const id of inC.slice(0, 6)) { await post(`/o/${id}/pin`, { c: cid, on: 1 }, sid); await new Promise((x) => setTimeout(x, 3)); }
  const pinned = db.prepare('SELECT COUNT(*) c FROM note_collections WHERE collection_id=? AND pinned_at IS NOT NULL').get(cid).c;
  ok('at most five pins: the sixth retires the oldest', pinned === Math.min(inC.length, 5), pinned);
  const theirs = db.prepare('SELECT id FROM objects WHERE user_id<>? LIMIT 1').get(u.id);
  if (theirs) ok('someone else’s note cannot be pinned', (await post(`/o/${theirs.id}/pin`, { c: cid, on: 1 }, sid)).status === 400);
  // marks: the same, inside a mark collection
  const mk = db.prepare('SELECT id FROM marks WHERE user_id=? ORDER BY id').all(u.id).map((x) => x.id);
  if (mk.length) {
    const mc = db.prepare("INSERT INTO collections(user_id, kind, name) VALUES(?, 'mark', 'Pin test')").run(u.id).lastInsertRowid;
    db.prepare('INSERT INTO mark_collections(mark_id, collection_id) VALUES(?, ?)').run(mk[0], mc);
    ok('marks: no control on the whole marks page', !/class="card-pin"/.test(await (await get('/u/' + u.handle + '?tab=marks', sid)).text()));
    r = await post(`/m/${mk[0]}/pin`, { c: mc, on: 1 }, sid);
    const hm = await (await get(`/u/${u.handle}?tab=marks&c=${mc}`, sid)).text();
    ok('marks: pin within a collection; the card leads and is pressed', r.status === 200 && rules(hm)[0] === 'head' && new RegExp(`is-pinned[\\s\\S]*?data-pin="/m/${mk[0]}/pin"[^>]*aria-pressed="true"`).test(hm));
  }
  // MCP untouched
  const ins = (await (await fetch(BASE + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).text());
  ok('nothing about pins on MCP', !/pin/i.test(ins) || !/pinned/i.test(ins));
  console.log(`\n${pass} passed, ${fail} failed`); srv.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
