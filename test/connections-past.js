// v2.87: Settings lists only working AI connections; past and inactive ones
// have their own page, where they can be revoked and removed.
//
// One member with five connections: active (used today), inactive (last used
// 120 days ago), revoked, an AI sign-in whose refresh token has expired, and
// an AI sign-in that is still live.
//
//   node test/connections-past.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 400) : '')); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'connpast-')), DB = path.join(work, 'd.db');
const port = 7600 + Math.floor(Math.random() * 300);
const env = { ...process.env, PORT: String(port), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test Publisher', SUPPORT_EMAIL: 'help@example.com' };
delete env.MUSE_ORIGIN;
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
const req = (p, { cookie, form } = {}) => new Promise((resolve, reject) => {
  const data = form ? new URLSearchParams(form).toString() : null;
  const headers = {}; if (cookie) headers.cookie = 'sid=' + cookie; if (data) headers['content-type'] = 'application/x-www-form-urlencoded';
  const r = http.request({ host: '127.0.0.1', port, method: data !== null ? 'POST' : 'GET', path: p, headers }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
  }); r.on('error', reject); if (data !== null) r.write(data); r.end();
});
const open = () => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout=5000'); return d; };
const one = (sql, ...a) => { const d = open(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const run = (sql, ...a) => { const d = open(); try { return d.prepare(sql).run(...a); } finally { d.close(); } };
const h = (t) => crypto.createHash('sha256').update(t).digest('hex');
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString();
const sql = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 19).replace('T', ' ');

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await req('/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const uid = run("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('connie','Connie','c@t.test','x','modern')").lastInsertRowid;
    const other = run("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('otto','Otto','o@t.test','x','modern')").lastInsertRowid;
    const sid = crypto.randomBytes(12).toString('hex'); run('INSERT INTO sessions(token,user_id) VALUES(?,?)', sid, uid);
    const osid = crypto.randomBytes(12).toString('hex'); run('INSERT INTO sessions(token,user_id) VALUES(?,?)', osid, other);
    const conn = (label, kind, extra = {}) => {
      const u = crypto.randomUUID();
      const id = run(`INSERT INTO connections(uid,user_id,auth_kind,token_hash,token_prefix,client_name,client_label,created_at,last_used_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        u, uid, kind, h(u), 'pre' + label.slice(0, 3), label, label, extra.created || sql(-200), extra.used || null, extra.revoked || null).lastInsertRowid;
      return { uid: u, id };
    };
    const fresh = conn('FreshBot', 'bearer', { used: sql(0) });
    const stale = conn('StaleBot', 'bearer', { used: sql(-120) });
    const gone = conn('GoneBot', 'bearer', { used: sql(-10), revoked: sql(-5) });
    const lapsed = conn('LapsedAI', 'oauth', { used: sql(-70) });
    const liveAi = conn('LiveAI', 'oauth', { used: sql(-2) });
    const tok = (c, exp) => run(`INSERT INTO oauth_tokens(token_hash,user_id,connection_id,kind,scope,resource,expires_at,family_id) VALUES(?,?,?,'refresh','discriminantly','x',?,?)`, h(crypto.randomUUID()), uid, c.id, exp, crypto.randomUUID());
    tok(lapsed, iso(-1)); tok(liveAi, iso(30));
    // Otto's revoked connection, to try removing from Connie's session
    const ottoUid = crypto.randomUUID();
    run(`INSERT INTO connections(uid,user_id,auth_kind,token_hash,token_prefix,client_label,revoked_at) VALUES(?,?,'bearer',?,'x','OttoBot',CURRENT_TIMESTAMP)`, ottoUid, other, h(ottoUid));

    const s = (await req('/settings', { cookie: sid })).body;
    const listArea = s.slice(s.indexOf('Connected AI'), s.indexOf('conn-new'));
    ok('CP1 Settings lists only working connections', /FreshBot/.test(listArea) && /LiveAI/.test(listArea) && !/StaleBot|GoneBot|LapsedAI/.test(listArea), listArea.replace(/\s+/g, ' ').slice(0, 400));
    ok('CP2 a glass button opens the past-connections page, with the count', /<a class="btn3d block conn-past-btn" href="\/settings\/connections">Past and inactive connections \(3\)<\/a>/.test(s));
    const pg = (await req('/settings/connections', { cookie: sid })).body;
    const sec = (title) => { const i = pg.indexOf(`<p class="sbox-title">${title}</p>`); return i < 0 ? '' : pg.slice(i, pg.indexOf('<div class="wcell wcell-wide">', i + 10)); };
    ok('CP3 the page groups them: not used lately, sign-in expired, revoked', /StaleBot/.test(sec('Not used lately')) && /LapsedAI/.test(sec('Sign-in expired')) && /GoneBot/.test(sec('Revoked'))
      && !/FreshBot|LiveAI/.test(pg), [sec('Not used lately').length, sec('Sign-in expired').length, sec('Revoked').length].join(','));
    ok('CP4 each row offers the right actions', /Revoke and remove/.test(sec('Not used lately')) && />Remove</.test(sec('Revoked')) && !/\/revoke"/.test(sec('Revoked')) && /Remove all revoked and expired \(2\)/.test(pg));
    ok('CP5 the page needs a signed-in member', (await req('/settings/connections')).status !== 200 || !/StaleBot/.test((await req('/settings/connections')).body));

    const rv = await req(`/settings/connections/${stale.uid}/revoke`, { cookie: sid, form: { back: '/settings/connections' } });
    ok('CP6 revoking from the page returns to it, acknowledged', rv.status === 303 && /^\/settings\/connections\?done=conn-revoked/.test(rv.headers.location) && !!one('SELECT revoked_at FROM connections WHERE uid=?', stale.uid).revoked_at);
    const rv2 = await req(`/settings/connections/${fresh.uid}/revoke`, { cookie: sid, form: {} });
    ok('CP7 revoking from Settings returns to Settings', /^\/settings\?done=conn-revoked#connector$/.test(rv2.headers.location), rv2.headers.location);
    const rm = await req(`/settings/connections/${liveAi.uid}/remove`, { cookie: sid, form: {} });
    const liveRow = one('SELECT * FROM connections WHERE uid=?', liveAi.uid);
    ok('CP8 removing a working connection revokes it first, then hides it', /done=conn-removed/.test(rm.headers.location) && !!liveRow.revoked_at && !!liveRow.removed_at);
    const bulk = await req('/settings/connections/remove-past', { cookie: sid, form: {} });
    ok('CP9 "Remove all revoked and expired" removes exactly those', /done=conns-removed/.test(bulk.headers.location)
      && ['GoneBot', 'LapsedAI', 'StaleBot', 'FreshBot'].every((l) => !!one('SELECT removed_at FROM connections WHERE client_label=?', l).removed_at), bulk.headers.location);
    ok('CP10 removed connections are kept (for attribution), and nothing is listed any more', one('SELECT COUNT(*) n FROM connections WHERE user_id=?', uid).n === 5
      && !/conn-past-btn/.test((await req('/settings', { cookie: sid })).body) && /All your connections are active|Nothing here/.test((await req('/settings/connections', { cookie: sid })).body));
    await req(`/settings/connections/${ottoUid}/remove`, { cookie: sid, form: {} });
    ok('CP11 one member cannot remove another’s connection', !one('SELECT removed_at FROM connections WHERE uid=?', ottoUid).removed_at);
    const priv = (await req('/privacy')).body;
    ok('CP12 the privacy policy describes removing past connections', /past and inactive connections have their own page/.test(priv));
  } catch (e) { console.error(e); fail++; } finally {
    proc.kill(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
