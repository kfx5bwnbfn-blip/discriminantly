// Admin deletes a member's account from the member page, behind a dialog (v2.97).
// Usage: node test/admin-delete.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'admindel-')), DB = path.join(DIR, 'a.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const req = (p, { sid = '', form = null } = {}) => fetch(BASE + p, { method: form ? 'POST' : 'GET', redirect: 'manual', headers: { ...(sid ? { cookie: 'sid=' + sid } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const admin = db.prepare('SELECT * FROM users WHERE is_admin=1').get();
  const sid = (uid) => { const t = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, uid); return t; };
  const asid = sid(admin.id);
  const mk = (h) => db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,'x','modern')").run(h, h, h + '@t.test').lastInsertRowid;
  const v = mk('victim'), other = mk('bystander');
  const note = (uid, name) => { const id = db.prepare("INSERT INTO objects(user_id,name,why,private) VALUES(?,?,'why',0)").run(uid, name).lastInsertRowid; const u = db.prepare('SELECT uid FROM objects WHERE id=?').get(id).uid; db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'object',?,'adopted')").run(uid, u); };
  note(v, 'Victim note one'); note(v, 'Victim note two'); note(other, 'Bystander note');
  const vsid = sid(v);

  let h = await (await req('/admin/members/victim', { sid: asid })).text();
  ok('member page: a Delete cell with the counts, a dialog, and a typed-handle confirm', /id="member-delete"/.test(h) && /2 notes/.test(h) && /<dialog class="admin-dialog" id="delete-dialog">/.test(h) && /action="\/admin\/members\/victim\/delete"/.test(h) && /name="confirm"/.test(h));
  ok('member page: the admin account has no Delete cell', !/id="member-delete"/.test(await (await req('/admin/members/' + admin.handle, { sid: asid })).text()));

  let r = await req('/admin/members/victim/delete', { form: { confirm: 'victim' } });
  ok('signed out: refused', r.status === 403 && !!db.prepare("SELECT 1 FROM users WHERE handle='victim'").get());
  r = await req('/admin/members/victim/delete', { sid: vsid, form: { confirm: 'victim' } });
  ok('a non-admin: refused', r.status === 403 && !!db.prepare("SELECT 1 FROM users WHERE handle='victim'").get());
  r = await req('/admin/members/victim/delete', { sid: asid, form: { confirm: 'wrong' } });
  ok('wrong handle typed: nothing deleted, told so', r.status === 303 && /done=member-confirm/.test(r.headers.get('location')) && !!db.prepare("SELECT 1 FROM users WHERE handle='victim'").get());
  r = await req('/admin/members/' + admin.handle + '/delete', { sid: asid, form: { confirm: admin.handle } });
  ok('the admin account: refused', r.status === 303 && /done=member-not-deleted/.test(r.headers.get('location')) && !!db.prepare('SELECT 1 FROM users WHERE id=?').get(admin.id));

  r = await req('/admin/members/victim/delete', { sid: asid, form: { confirm: '@Victim' } });
  ok('typed handle (any case, with or without @): the account and its records are gone; back to Admin with the notice', r.status === 303 && r.headers.get('location') === '/admin?done=member-deleted'
    && !db.prepare("SELECT 1 FROM users WHERE handle='victim'").get() && db.prepare("SELECT COUNT(*) n FROM objects WHERE user_id=?").get(v).n === 0 && !db.prepare('SELECT 1 FROM sessions WHERE token=?').get(vsid));
  ok('a backup was taken first, and the log says so', /\[admin\] deleting @victim; backed up to .*pre-delete-victim-/.test(log) && fs.readdirSync(path.join(DIR, 'backups')).some((f) => f.startsWith('pre-delete-victim-')));
  ok('nobody else is touched', !!db.prepare("SELECT 1 FROM users WHERE handle='bystander'").get() && db.prepare('SELECT COUNT(*) n FROM objects WHERE user_id=?').get(other).n === 1);
  ok('the notice renders on Admin', /A backup was taken first/.test(await (await req('/admin?done=member-deleted', { sid: asid })).text()));
  ok('a deleted handle 404s', (await req('/admin/members/victim/delete', { sid: asid, form: { confirm: 'victim' } })).status === 404);

  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
