// A public plan discloses only what its page shows (v2.104.1): a private or
// suspended stop is absent from the body, the structured data, the share card
// count and the map, for another member and for a signed-out visitor.
// Usage: node test/plan-privacy.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'planpriv-')), DB = path.join(DIR, 'p.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const req = (p, { sid = '', form } = {}) => fetch(BASE + p, { method: form ? 'POST' : 'GET', redirect: 'manual', headers: { ...(sid ? { cookie: 'sid=' + sid } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const mk = (h) => { const id = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,'x','modern')").run(h, h, h + '@t.test').lastInsertRowid; const t = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, id); return { id, sid: t }; };
  const A = mk('owner'), B = mk('viewer');
  const mark = (name, lat, lng) => { const id = db.prepare("INSERT INTO marks(user_id,name,why,locality,country,address,lat,lng,private) VALUES(?,?,'why','Oslo','Norway','1 St',?,?,0)").run(A.id, name, lat, lng).lastInsertRowid; const uid = db.prepare('SELECT uid FROM marks WHERE id=?').get(id).uid; db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'mark',?,'adopted')").run(A.id, uid); return { id, uid }; };
  let r = await req('/t/new', { sid: A.sid, form: { title: 'Public trip', context: 'c' } }); const tid = +(r.headers.get('location') || '').replace('/t/', '');
  const open = mark('ZZOPEN Cafe', 59.91, 10.75), secret = mark('ZZSECRET Place', 59.93, 10.71), hid = mark('ZZHIDDEN Spot', 60.39, 5.32);
  for (const m of [open, secret, hid]) await req(`/t/${tid}/stops`, { sid: A.sid, form: { label: '', mark_uid: m.uid } });
  db.prepare('UPDATE itineraries SET private=0 WHERE id=?').run(tid);
  const page = async (sid) => (await req('/t/' + tid, { sid })).text();
  const ld = (h) => (h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || ['', ''])[1];
  let h = await page(B.sid);
  ok('setup: every stop public, the viewer sees all three, in the page and its structured data', ['ZZOPEN', 'ZZSECRET', 'ZZHIDDEN'].every((k) => h.includes(k) && ld(h).includes(k)));
  db.prepare('UPDATE marks SET private=1 WHERE id=?').run(secret.id);
  db.prepare("UPDATE itinerary_stops SET visibility='suspended' WHERE mark_uid=?").run(hid.uid);
  for (const [who, sid] of [['another member', B.sid], ['a signed-out visitor', '']]) {
    h = await page(sid);
    ok(`${who}: a private place is nowhere in the page source (body, structured data, map)`, !h.includes('ZZSECRET') && !h.includes('59.93'));
    ok(`${who}: a suspended stop is nowhere in the page source, its pin and coordinates included`, !h.includes('ZZHIDDEN') && !h.includes('60.39'));
    ok(`${who}: the public stop is still there, in the page and the structured data`, h.includes('ZZOPEN') && ld(h).includes('ZZOPEN') && /"numberOfItems":1\b/.test(ld(h)));
  }
  const card = await (await req(`/card/t/${tid}.png`)).status;
  ok('the share card still renders', card === 200);
  h = await page(A.sid);
  ok('the owner still sees all three', ['ZZOPEN', 'ZZSECRET', 'ZZHIDDEN'].every((k) => h.includes(k)));
  await req(`/m/${secret.id}/delete`, { sid: A.sid, form: {} });
  const st = db.prepare("SELECT visibility, label FROM itinerary_stops WHERE itinerary_id=? AND label='ZZSECRET Place'").get(tid);
  ok('deleting the private place suspends its stop, keeping the name for the owner', st && st.visibility === 'suspended');
  for (const [who, sid] of [['another member', B.sid], ['a signed-out visitor', '']]) ok(`after deletion, ${who} still sees nothing of it`, !(await page(sid)).includes('ZZSECRET'));
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
