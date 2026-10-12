// v2.86: a member deletes their own account; the admin sets a member's photo.
//
// Two members, A (deleted) and B (stays), with everything that links them:
// A's notes, marks, visits, collection, warrant, ownership, image, AI
// connection and a recommendation; comments both ways; a plan A owns that B
// is in; a plan B owns that A is in and added a stop to. Then A deletes
// their account from Settings, after two refused attempts.
//
//   node test/account-delete.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 400) : '')); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acctdel-')), DB = path.join(work, 'd.db');
const port = 7300 + Math.floor(Math.random() * 300);
const env = { ...process.env, PORT: String(port), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test Publisher', SUPPORT_EMAIL: 'help@example.com' };
delete env.MUSE_ORIGIN;
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; proc.stdout.on('data', (c) => { logs += c; }); proc.stderr.on('data', (c) => { logs += c; });
const req = (p, { body, cookie, form } = {}) => new Promise((resolve, reject) => {
  const data = form ? new URLSearchParams(form).toString() : body;
  const headers = {}; if (cookie) headers.cookie = 'sid=' + cookie;
  if (data) headers['content-type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
  const r = http.request({ host: '127.0.0.1', port, method: data ? 'POST' : 'GET', path: p, headers }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
  }); r.on('error', reject); if (data) r.write(data); r.end();
});
const open = () => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout=5000'); return d; };
const one = (sql, ...a) => { const d = open(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = open(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const run = (sql, ...a) => { const d = open(); try { return d.prepare(sql).run(...a); } finally { d.close(); } };
const hash = (p) => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(p, s, 32).toString('hex'); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await req('/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const mk = (handle) => {
      const id = run("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,?,'modern')", handle, handle, handle + '@t.test', hash('pw-' + handle + '-secret')).lastInsertRowid;
      const sid = crypto.randomBytes(12).toString('hex'); run('INSERT INTO sessions(token,user_id) VALUES(?,?)', sid, id);
      const tok = crypto.randomBytes(16).toString('hex'); run('UPDATE users SET api_token=? WHERE id=?', tok, id);
      return { id, sid, tok, handle };
    };
    const A = mk('annadel'), B = mk('bertstay');
    const adminSid = crypto.randomBytes(12).toString('hex'); run('INSERT INTO sessions(token,user_id) VALUES(?,1)', adminSid);
    let rid = 0;
    const call = async (U, name, args) => {
      const r = JSON.parse((await req('/mcp/' + U.tok, { body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }) })).body).result;
      if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent || {};
    };

    // A's own catalogue
    const img = await call(A, 'upload_image', { image: PNG });
    const imgUidA = img.image_uid || img.uid;
    const aNote = await call(A, 'note_object', { headline: 'Zq Annadel kettle', description: 'A good kettle.', tags: 'kitchen', image: imgUidA });
    const aMark = await call(A, 'add_travel_mark', { place: 'Zq Annadel Cafe', locality: 'Testville', country: 'Nowhere', allow_duplicate: true });
    await call(A, 'log_visit', { id: aMark.id, visited_on: '2025-05-05' });
    await call(A, 'warrant', { subject_type: 'note', id: aNote.id });
    await call(A, 'record_note_ownership', { id: aNote.id });
    await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'Zq somewhere later', workflow: 'for_another_time' }] }).catch(() => {});
    run("INSERT INTO connections(uid,user_id,auth_kind,token_hash,token_prefix,client_label) VALUES(?,?,'bearer',?,?,?)", crypto.randomUUID(), A.id, crypto.createHash('sha256').update('k-' + A.id).digest('hex'), 'k', 'Muse');
    // B's own note, and comments both ways
    const bImg = await call(B, 'upload_image', { image: PNG });
    const bNote = await call(B, 'note_object', { headline: 'Zq Bertstay pen', description: 'A good pen.', tags: 'study', image: bImg.image_uid || bImg.uid });
    await call(A, 'comment', { subject_type: 'note', id: bNote.id, body: 'Zq A on B' });
    await call(B, 'comment', { subject_type: 'note', id: aNote.id, body: 'Zq B on A' });
    // A owns a plan B is in; B owns a plan A is in and A adds a stop to it
    const aPlan = await call(A, 'create_itinerary', { title: 'Zq A plan' });
    await call(A, 'add_itinerary_stops', { itinerary_uid: aPlan.uid, stops: [{ label: 'Coffee', mark_uid: aMark.uid }] });
    const bPlan = await call(B, 'create_itinerary', { title: 'Zq B plan' });
    const aPlanId = one('SELECT id FROM itineraries WHERE uid=?', aPlan.uid).id, bPlanId = one('SELECT id FROM itineraries WHERE uid=?', bPlan.uid).id;
    run("INSERT INTO itinerary_members(itinerary_id,user_id,role,state,invited_by) VALUES(?,?,'editor','active',?)", aPlanId, B.id, A.id);
    run("INSERT INTO itinerary_members(itinerary_id,user_id,role,state,invited_by) VALUES(?,?,'editor','active',?)", bPlanId, A.id, B.id);
    await call(A, 'add_itinerary_stops', { itinerary_uid: bPlan.uid, stops: [{ label: 'Zq stop A added', new_place: { name: 'Zq Shared Bakery', locality: 'Testville', country: 'Nowhere' } }] });
    const aUid = one('SELECT uid FROM users WHERE id=?', A.id).uid;
    const ownedUids = [aNote.uid, aMark.uid, aPlan.uid, aUid];
    const provBefore = one(`SELECT COUNT(*) n FROM provenance WHERE actor_user_id=? OR entity_uid IN (${ownedUids.map(() => '?').join(',')})`, A.id, ...ownedUids).n;
    ok('AD0 setup: A has notes, marks, visits, a plan, a membership, a connection and history', one('SELECT COUNT(*) n FROM objects WHERE user_id=?', A.id).n >= 1 && one('SELECT COUNT(*) n FROM visits WHERE user_id=?', A.id).n === 1
      && one('SELECT COUNT(*) n FROM itinerary_members WHERE user_id=?', A.id).n === 1 && one('SELECT COUNT(*) n FROM connections WHERE user_id=?', A.id).n === 1 && provBefore > 0, `prov ${provBefore}`);
    const imgUid = imgUidA; const imgFile = imgUid ? path.join(work, 'images', imgUid.slice(0, 2), imgUid) : null;
    if (imgUid) ok('AD0b setup: A’s image is stored as a file', fs.existsSync(imgFile), imgFile);

    // Settings shows the section; the admin's Settings does not offer deletion
    const sA = await req('/settings', { cookie: A.sid });
    ok('AD1 Settings offers "Delete my account" with handle and password confirmation', /Delete my account/.test(sA.body) && /name="confirm"/.test(sA.body) && /name="password"/.test(sA.body) && /help@example\.com/.test(sA.body));
    const sAdm = await req('/settings', { cookie: adminSid });
    ok('AD2 the admin is told their account can’t be deleted here, and is refused if they try', /admin account can’t be deleted/.test(sAdm.body) && !/Delete my account permanently/.test(sAdm.body)
      && /admin account can’t be deleted/.test((await req('/settings/delete-account', { cookie: adminSid, form: { confirm: 'elicierto', password: 'prototype1' } })).body) && !!one('SELECT 1 FROM users WHERE id=1'));

    // Refusals change nothing
    const wrongHandle = await req('/settings/delete-account', { cookie: A.sid, form: { confirm: 'someoneelse', password: 'pw-annadel-secret' } });
    const wrongPass = await req('/settings/delete-account', { cookie: A.sid, form: { confirm: 'annadel', password: 'nope' } });
    ok('AD3 a wrong handle or password is refused and nothing is deleted', /type your handle exactly/.test(wrongHandle.body) && /password isn’t right/.test(wrongPass.body)
      && !!one('SELECT 1 FROM users WHERE id=?', A.id) && one('SELECT COUNT(*) n FROM objects WHERE user_id=?', A.id).n >= 1);
    await req('/settings/delete-account', { form: { confirm: 'annadel', password: 'pw-annadel-secret' } });
    ok('AD4 deletion needs a signed-in member', !!one('SELECT 1 FROM users WHERE id=?', A.id));

    // The real thing
    const done = await req('/settings/delete-account', { cookie: A.sid, form: { confirm: '@AnnaDel ', password: 'pw-annadel-secret' } });
    ok('AD5 deletion signs out and returns home with an acknowledgement', done.status === 303 && /done=account-deleted/.test(done.headers.location || '') && /sid=;/.test(String(done.headers['set-cookie'] || '')), JSON.stringify(done.headers));
    ok('AD6 the account is gone, and its session no longer works', !one('SELECT 1 FROM users WHERE id=?', A.id) && !one('SELECT 1 FROM sessions WHERE token=?', A.sid)
      && !/annadel/i.test((await req('/settings', { cookie: A.sid })).body.slice(0, 4000).replace(/name="[^"]*"/g, '')));
    const leftovers = [];
    for (const t of all("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)) {
      const cols = all(`PRAGMA table_info(${t})`).map((c) => c.name);
      for (const c of ['user_id', 'actor_user_id', 'from_user', 'used_by', 'invited_by', 'created_by', 'responded_by', 'revoked_by', 'ended_by', 'removed_by', 'restored_by', 'follower_id', 'followee_id'])
        if (cols.includes(c) && one(`SELECT COUNT(*) n FROM ${t} WHERE ${c}=?`, A.id).n) leftovers.push(`${t}.${c}`);
    }
    ok('AD7 no row anywhere still points at the deleted account', leftovers.length === 0, leftovers.join(', '));
    ok('AD8 the history of what they owned and did is gone', one(`SELECT COUNT(*) n FROM provenance WHERE entity_uid IN (${ownedUids.map(() => '?').join(',')})`, ...ownedUids).n === 0);
    ok('AD9 their connection and its tokens are gone', one('SELECT COUNT(*) n FROM connections WHERE user_id=?', A.id).n === 0 && one('SELECT COUNT(*) n FROM oauth_tokens WHERE user_id=?', A.id).n === 0);
    ok('AD10 the plan they owned is gone, with its days, stops and B’s membership', !one('SELECT 1 FROM itineraries WHERE id=?', aPlanId) && one('SELECT COUNT(*) n FROM itinerary_stops WHERE itinerary_id=?', aPlanId).n === 0
      && one('SELECT COUNT(*) n FROM itinerary_members WHERE itinerary_id=?', aPlanId).n === 0);
    ok('AD11 B’s plan stays, with the stop A added (it belongs to the plan); A is no longer in it', !!one('SELECT 1 FROM itineraries WHERE id=?', bPlanId)
      && !!one("SELECT 1 FROM itinerary_stops WHERE itinerary_id=? AND label='Zq stop A added'", bPlanId) && one('SELECT COUNT(*) n FROM itinerary_members WHERE itinerary_id=?', bPlanId).n === 0);
    ok('AD12 B’s own note stays; comments by and on A are gone', !!one('SELECT 1 FROM objects WHERE uid=?', bNote.uid) && one("SELECT COUNT(*) n FROM comments WHERE body LIKE 'Zq % on %'").n === 0);
    if (imgUid) ok('AD13 A’s image file is removed from storage', !fs.existsSync(imgFile));
    ok('AD14 the database is consistent afterwards', all('PRAGMA foreign_key_check').length === 0 && one('PRAGMA integrity_check').integrity_check === 'ok');
    ok('AD15 B still works normally', (await call(B, 'my_itineraries', {})) && (await req('/', { cookie: B.sid })).status === 200);

    // Admin: a member's profile photo
    const page = await req('/admin/members/bertstay', { cookie: adminSid });
    ok('AP1 the admin member page has a photo control', /id="member-photo"/.test(page.body) && /action="\/admin\/members\/bertstay\/avatar"/.test(page.body));
    ok('AP2 a member cannot set someone’s photo', (await req('/admin/members/bertstay/avatar', { cookie: B.sid, form: { avatar: PNG } })).status === 403 && !one('SELECT avatar FROM users WHERE id=?', B.id).avatar);
    ok('AP3 anything but an image data URL is refused', (await req('/admin/members/bertstay/avatar', { cookie: adminSid, form: { avatar: 'javascript:alert(1)' } })).status === 400);
    const set = await req('/admin/members/bertstay/avatar', { cookie: adminSid, form: { avatar: PNG } });
    ok('AP4 the admin sets it, and is told so', set.status === 303 && /done=avatar-set/.test(set.headers.location) && one('SELECT avatar FROM users WHERE id=?', B.id).avatar === PNG);
    const rm = await req('/admin/members/bertstay/avatar', { cookie: adminSid, form: { remove: '1' } });
    ok('AP5 and can remove it', rm.status === 303 && /done=avatar-removed/.test(rm.headers.location) && one('SELECT avatar FROM users WHERE id=?', B.id).avatar === '');
  } catch (e) { console.error(e); fail++; } finally {
    proc.kill(); await new Promise((r) => setTimeout(r, 300));
    if (fail) console.log(logs.split('\n').filter((l) => /error|fail|account/i.test(l)).slice(-15).join('\n'));
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
