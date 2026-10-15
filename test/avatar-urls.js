// Uploaded profile photos are linked, not embedded (v2.104.2): a feed of 25
// cards carried the photo 25+ times as text (7 MB) and iOS killed the page.
// Usage: node test/avatar-urls.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-')), DB = path.join(DIR, 'a.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = (p, sid = '') => fetch(BASE + p, { redirect: 'manual', headers: sid ? { cookie: 'sid=' + sid } : {} });
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const sharp = require('sharp');
  const photo = async (seed) => 'data:image/jpeg;base64,' + (await sharp({ create: { width: 640, height: 640, channels: 3, noise: { type: 'gaussian', mean: 120 + seed, sigma: 60 } } }).jpeg({ quality: 92 }).toBuffer()).toString('base64');
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const a1 = await photo(0);
  const uid = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin,avatar) VALUES('pic','Pic','pic@t.test','x','modern',?)").run(a1).lastInsertRowid;
  const sid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sid, uid);
  for (let i = 0; i < 30; i++) { const id = db.prepare("INSERT INTO objects(user_id,name,why,private) VALUES(?,?,'why',0)").run(uid, 'Thing ' + i).lastInsertRowid; const u = db.prepare('SELECT uid FROM objects WHERE id=?').get(id).uid; db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'object',?,'adopted')").run(uid, u); }
  ok('setup: the stored photo is a data: URL over 100 KB', a1.length > 100000, a1.length);
  for (const [name, p] of [['profile', '/u/pic'], ['home feed', '/'], ['activity', '/activity']]) {
    const h = await (await get(p, sid)).text();
    ok(`${name}: no photo embedded as text; bylines link /avatar/pic?v=…; the page stays small`, !/data:image/.test(h) && /src="\/avatar\/pic\?v=[0-9a-f]{10}"/.test(h) && h.length < 400000, `${h.length} bytes, data: ${(h.match(/data:image/g) || []).length}`);
  }
  const src = ((await (await get('/u/pic', sid)).text()).match(/src="(\/avatar\/pic\?v=[0-9a-f]{10})"/) || [])[1];
  const r = await get(src); const buf = Buffer.from(await r.arrayBuffer()); const meta = await sharp(buf).metadata();
  ok('the photo address serves a small WebP, at most 320 px, cached for a year', r.status === 200 && r.headers.get('content-type') === 'image/webp' && meta.width <= 320 && buf.length < 60000 && /immutable/.test(r.headers.get('cache-control')), `${r.status} ${r.headers.get('content-type')} ${meta.width} ${buf.length}`);
  const pub = await (await get('/about', sid)).text();
  ok('public pages, signed in: the menu’s avatar links the same address', pub.includes(`src="${src}"`) && !/data:image\/jpeg/.test(pub));
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(await photo(40), uid);
  const src2 = ((await (await get('/u/pic', sid)).text()).match(/src="(\/avatar\/pic\?v=[0-9a-f]{10})"/) || [])[1];
  ok('a new photo gets a new address (no stale cache)', src2 && src2 !== src);
  ok('the new address serves the new photo', (await get(src2)).status === 200);
  db.prepare("UPDATE users SET avatar='https://example.com/me.jpg' WHERE id=?").run(uid);
  ok('a photo given as a web address is linked as before', (await (await get('/u/pic', sid)).text()).includes('src="https://example.com/me.jpg"'));
  db.prepare("UPDATE users SET avatar='' WHERE id=?").run(uid);
  const h0 = await (await get('/u/pic', sid)).text();
  ok('no photo: the initial, and the address 404s', /avatar-initial/.test(h0) && (await get('/avatar/pic')).status === 404);
  ok('an unknown member 404s', (await get('/avatar/nobody-here')).status === 404);
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
