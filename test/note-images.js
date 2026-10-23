// A note may carry several pictures (v2.113): objects.image stays the cover,
// object_images holds the rest in order. Covers the form (store one at a time,
// post refs), the note page gallery, the feed marker, privacy of a private
// note's extras, re-noting, editing (reorder, new cover) and deletion.
// Usage: node test/note-images.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nimg-')), DB = path.join(DIR, 'n.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const hdr = (sid) => sid ? { cookie: 'sid=' + sid } : {};
const get = (p, sid = '') => fetch(BASE + p, { redirect: 'manual', headers: hdr(sid) });
const post = (p, body, sid) => fetch(BASE + p, { method: 'POST', redirect: 'manual', headers: { ...hdr(sid), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const sharp = require('sharp');
  const photo = async (seed) => 'data:image/jpeg;base64,' + (await sharp({ create: { width: 320, height: 240, channels: 3, noise: { type: 'gaussian', mean: 80 + seed * 20, sigma: 40 } } }).jpeg({ quality: 80 }).toBuffer()).toString('base64');
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const mk = (h) => { const id = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,'x','modern')").run(h, h, h + '@t.test').lastInsertRowid; const sid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sid, id); return { id, sid }; };
  const A = mk('alba'), B = mk('bram');

  // 1. the upload endpoint
  const up = async (seed, sid) => (await (await fetch(BASE + '/api/image', { method: 'POST', headers: { ...hdr(sid), 'Content-Type': 'application/json' }, body: JSON.stringify({ image: await photo(seed) }) })).json());
  ok('POST /api/image needs a signed-in member', (await fetch(BASE + '/api/image', { method: 'POST', body: '{}' })).status === 401);
  const e1 = await up(1, A.sid), e2 = await up(2, A.sid), e3 = await up(3, A.sid);
  ok('POST /api/image stores a picture and returns its /i/ ref', /^\/i\/[0-9a-f-]{36}$/.test(e1.image || '') && e2.image && e3.image, JSON.stringify(e1));
  ok('a junk upload is refused', (await fetch(BASE + '/api/image', { method: 'POST', headers: { ...hdr(A.sid), 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'data:image/png;base64,AAAA' }) })).status === 400);

  // 2. create a note with a cover and three extras (one duplicated; the cover repeated)
  const cover = await photo(0);
  let r = await post('/new', { name: 'Hagi teabowl', why: 'Soft glaze', tags: 'kitchen', image: cover, images: [e1.image, e2.image, e2.image, e3.image].join('\n') }, A.sid);
  const oid = +((r.headers.get('location') || '').match(/\/o\/(\d+)/) || [])[1];
  ok('a note is created with a cover and extras', (r.status === 302 || r.status === 303) && oid > 0, r.status + ' ' + r.headers.get('location'));
  const rows = () => db.prepare('SELECT image, pos FROM object_images WHERE object_id=? ORDER BY pos').all(oid);
  ok('three extras stored in order, the duplicate dropped', rows().length === 3 && rows().map((x) => x.image).join() === [e1.image, e2.image, e3.image].join(), JSON.stringify(rows()));
  const o = db.prepare('SELECT * FROM objects WHERE id=?').get(oid);
  ok('the cover is objects.image, stored as /i/', /^\/i\//.test(o.image) && !rows().some((x) => x.image === o.image));

  // 3. the note page: gallery; the feed: marker only
  let h = await (await get('/o/' + oid, A.sid)).text();
  ok('note page: a gallery with the cover first, four tabs, and a 1 / 4 count', /class="gal" data-gal/.test(h) && ((h.match(/<div class="gal-strip"[\s\S]*?<\/div>/) || [''])[0].match(/role="tab"/g) || []).length === 4 && /data-gal-count>1 \/ 4</.test(h) && h.indexOf(o.image) < h.indexOf(e1.image), [/class="gal" data-gal/.test(h), ((h.match(/<div class="gal-strip"[\s\S]*?<\/div>/) || [''])[0].match(/role="tab"/g) || []).length, /data-gal-count>1 \/ 4</.test(h), h.indexOf(o.image), h.indexOf(e1.image)].join());
  ok('note page: every extra is a tab with its own srcset for the large view', [e1, e2, e3].every((e) => new RegExp(`data-src="${e.image}" data-srcset="${e.image}\\?w=400`).test(h)));
  const feed = await (await get('/u/alba?tab=notes', A.sid)).text();
  ok('feed card: the cover with a +3 marker, no gallery, no extras', /gal-more[^>]*>[\s\S]{0,400}\+3</.test(feed) && !/class="gal" data-gal/.test(feed) && !feed.includes(e1.image), [/gal-more[^>]*>[\s\S]{0,400}\+3</.test(feed), /data-gal/.test(feed), feed.includes(e1.image)].join());
  const home = await (await get('/', A.sid)).text();
  ok('home feed: the same marker (count comes with the feed query)', /\+3</.test(home) && !home.includes(e1.image));

  // 4. privacy: extras of a public note are public; of a private note, owner-only
  ok('public note: an extra picture is served to a stranger, cached as public', (await get(e2.image)).status === 200 && /public/.test((await get(e2.image)).headers.get('cache-control')));
  db.prepare('UPDATE objects SET private=1 WHERE id=?').run(oid);
  ok('private note: the same extra is not served to a stranger', (await get(e2.image)).status === 404);
  ok('private note: nor to another member', (await get(e2.image, B.sid)).status === 404);
  ok('private note: its owner still sees it', (await get(e2.image, A.sid)).status === 200);
  ok('private note: the page shows the gallery to its owner only', /class="gal" data-gal/.test(await (await get('/o/' + oid, A.sid)).text()) && !/class="gal" data-gal/.test(await (await get('/o/' + oid, B.sid)).text()));
  db.prepare('UPDATE objects SET private=0 WHERE id=?').run(oid);

  // 5. re-noting copies the extras
  r = await post(`/o/${oid}/note`, {}, B.sid);
  const copy = db.prepare("SELECT * FROM objects WHERE user_id=? AND renoted_from_uid=?").get(B.id, o.uid);
  ok('re-noting another member’s note copies its extras, in order', copy && db.prepare('SELECT image FROM object_images WHERE object_id=? ORDER BY pos').all(copy.id).map((x) => x.image).join() === [e1.image, e2.image, e3.image].join(), r.status);

  // 6. editing: reorder, promote an extra to cover, drop one
  r = await post(`/o/${oid}/edit`, { name: 'Hagi teabowl', why: 'Soft glaze', tags: 'kitchen', image: e2.image, images: [e3.image, o.image].join('\n') }, A.sid);
  const o2 = db.prepare('SELECT * FROM objects WHERE id=?').get(oid);
  ok('edit: a former extra becomes the cover; the old cover joins the extras; one is dropped; order kept', (r.status === 302 || r.status === 303) && o2.image === e2.image && rows().map((x) => x.image).join() === [e3.image, o.image].join(), JSON.stringify(rows()));
  h = await (await get('/o/' + oid, A.sid)).text();
  ok('edit form shows the extras as tiles, in order, with the hidden list to post back', (() => { const f = h; return true; })() && (await (await get(`/o/${oid}/edit`, A.sid)).text()).match(new RegExp(`class="pic-tile" data-src="${e3.image}"[\\s\\S]*class="pic-tile" data-src="${o.image}"[\\s\\S]*name="images"[^>]*value="${e3.image}&#10;${o.image}|name="images"[^>]*value="${e3.image}\\n${o.image}`)) != null);
  ok('a note is capped at 8 pictures', (await (async () => { const many = []; for (let i = 10; i < 20; i++) many.push((await up(i, A.sid)).image); await post(`/o/${oid}/edit`, { name: 'Hagi teabowl', image: e2.image, images: many.join('\n') }, A.sid); return rows().length; })()) === 7);
  ok('removing the extras leaves the cover alone', [302, 303].includes((await post(`/o/${oid}/edit`, { name: 'Hagi teabowl', image: e2.image, images: '' }, A.sid)).status) && rows().length === 0 && !/class="gal" data-gal|class="gal-more"/.test(await (await get('/o/' + oid, A.sid)).text()));

  // 7. deleting the note removes its extras
  await post(`/o/${oid}/edit`, { name: 'Hagi teabowl', image: e2.image, images: e1.image }, A.sid);
  await post(`/o/${oid}/delete`, {}, A.sid);
  ok('deleting the note deletes its extra rows', db.prepare('SELECT COUNT(*) c FROM object_images WHERE object_id=?').get(oid).c === 0 && !db.prepare('SELECT 1 FROM objects WHERE id=?').get(oid));

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(2); });
