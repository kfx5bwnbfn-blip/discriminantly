// Phase 1 (v2.73): the Muse OAuth wrapper on the Muse origin. Off by default;
// with MUSE_WRAPPER=1: DCR, sign-in and consent on the Muse origin, PKCE code
// exchange to an ordinary revocable "Muse" connection, and /mcp forwarded to
// www's unchanged mcp(). MUSE_SEND_ISS=0 drops iss from the redirect.
//
//   node test/muse-wrapper.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 500) : '')); };
const WWW = 'www.discriminantly.com', MUSE = 'muse.test', ORIGIN = 'https://' + MUSE;
const CID = ORIGIN + '/.well-known/meta-muse-client.json';
const RURI = 'https://agent.meta.ai/api/hatch/oauth/callback';
const PW = 'prototype1';

function boot(extraEnv) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-wrap-'));
  const port = 5300 + Math.floor(Math.random() * 400);
  const env = { ...process.env, PORT: String(port), DB_PATH: path.join(work, 'd.db'), SEED: '1', ADMIN_PASSWORD: PW, PUBLIC_ORIGIN: 'https://' + WWW, MUSE_ORIGIN: ORIGIN, ...extraEnv };
  for (const k of ['MUSE_WRAPPER', 'MUSE_SEND_ISS', 'MUSE_ADVERTISE_CIMD', 'MUSE_REDIRECT_STATUS', 'MUSE_KEYS']) if (!(k in extraEnv)) delete env[k];
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { port, work, proc, log: '', db: path.join(work, 'd.db') };
  proc.stdout.on('data', (d) => { s.log += d; }); proc.stderr.on('data', (d) => { s.log += d; });
  return s;
}
const req = (s, { host = MUSE, method = 'GET', p, headers = {}, body = null }) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: s.port, method, path: p, headers: { Host: host, ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const up = async (s) => { for (let i = 0; i < 100; i++) { try { await req(s, { host: WWW, p: '/' }); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('server did not start\n' + s.log); };
const stop = (s) => new Promise((r) => { s.proc.on('exit', r); s.proc.kill(); });
const F = { 'content-type': 'application/x-www-form-urlencoded' }, J = { 'content-type': 'application/json' };
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => { const v = b64url(crypto.randomBytes(32)); return { v, c: b64url(crypto.createHash('sha256').update(v).digest()) }; };
const authQ = (o) => '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: CID, redirect_uri: RURI, scope: 'discriminantly.read discriminantly.write', state: 'st-' + crypto.randomBytes(6).toString('hex'), code_challenge_method: 'S256', ...o });
const email = (s) => { const d = new DatabaseSync(s.db); try { return d.prepare('SELECT email FROM users WHERE id=1').get().email; } finally { d.close(); } };

// Walk the consent page: GET authorize, POST the form; returns the redirect.
async function consent(s, q, form) {
  const g = await req(s, { p: q });
  const pid = (g.body.match(/name="pid" value="([0-9a-f]+)"/) || [])[1];
  const r = await req(s, { method: 'POST', p: '/oauth/authorize', headers: F, body: new URLSearchParams({ pid: pid || '', ...form }).toString() });
  return { g, r, loc: r.headers.location ? new URL(r.headers.location) : null };
}

(async () => {
  const all = [];
  try {
    // ---- off by default: Phase 0 capture is unchanged -------------------------------------
    const OFF = boot({}); all.push(OFF); await up(OFF);
    const offA = await req(OFF, { p: authQ({ code_challenge: 'x' }) });
    ok('W1 without MUSE_WRAPPER the Muse origin is still the inert test page', /test mode for Muse/.test(offA.body) && !/name="password"/.test(offA.body));
    const offT = await req(OFF, { method: 'POST', p: '/oauth/token', headers: F, body: 'grant_type=authorization_code&code=x' });
    ok('W2 and issues no tokens', offT.status === 400 && /no tokens are issued/.test(offT.body));
    await stop(OFF);

    // ---- on ---------------------------------------------------------------------------------
    const S = boot({ MUSE_WRAPPER: '1' }); all.push(S); await up(S);
    const em = email(S);

    const asm = JSON.parse((await req(S, { p: '/.well-known/oauth-authorization-server' })).body);
    ok('W3 metadata: issuer is the Muse origin, DCR and CIMD offered, iss advertised', asm.issuer === ORIGIN && asm.registration_endpoint === ORIGIN + '/oauth/register' && asm.client_id_metadata_document_supported === true && asm.authorization_response_iss_parameter_supported === true);

    const badReg = await req(S, { method: 'POST', p: '/oauth/register', headers: J, body: JSON.stringify({ client_name: 'X', redirect_uris: ['https://evil.example/cb'] }) });
    ok('W4 DCR refuses any redirect but Meta’s callback', badReg.status === 400);
    const reg = await req(S, { method: 'POST', p: '/oauth/register', headers: J, body: JSON.stringify({ client_name: 'Muse', redirect_uris: [RURI], token_endpoint_auth_method: 'none' }) });
    const dcrId = reg.status === 201 && JSON.parse(reg.body).client_id;
    ok('W5 DCR issues a muse-dcr client_id for Meta’s callback', /^muse-dcr-[0-9a-f]{16}$/.test(dcrId || ''), reg.body);

    const badR = await req(S, { p: authQ({ redirect_uri: 'https://evil.example/cb', code_challenge: 'x' }) });
    ok('W6 a foreign redirect_uri is shown an error page, never redirected to', badR.status === 400 && !badR.headers.location);
    const badC = await req(S, { p: authQ({ client_id: 'someone-else', code_challenge: 'x' }) });
    ok('W7 an unknown client_id is refused the same way', badC.status === 400 && !badC.headers.location);
    const noPkce = await req(S, { p: authQ({}) });
    ok('W8 no PKCE: error back to the client with state', noPkce.status === 303 && /error=invalid_request/.test(noPkce.headers.location) && /state=st-/.test(noPkce.headers.location));

    // wrong password: no code
    const k0 = pkce();
    const wrong = await consent(S, authQ({ code_challenge: k0.c }), { action: 'allow', email: em, password: 'nope' });
    ok('W9 the consent page asks for email and password on the Muse origin', /Connect Muse to Discriminantly/.test(wrong.g.body) && /name="password"/.test(wrong.g.body));
    ok('W10 a wrong password gives no code', wrong.r.status === 200 && /do not match/.test(wrong.r.body) && !wrong.loc);

    // deny
    const den = await consent(S, authQ({ code_challenge: k0.c }), { action: 'deny' });
    ok('W11 Cancel returns access_denied to Meta with state and iss', den.loc && den.loc.origin + den.loc.pathname === RURI && den.loc.searchParams.get('error') === 'access_denied' && /^st-/.test(den.loc.searchParams.get('state')) && den.loc.searchParams.get('iss') === ORIGIN);

    const order = wrong.g.body.indexOf('value="allow"') < wrong.g.body.indexOf('value="deny"');
    ok('W11b Allow is the form’s first button, so Enter or an autofill submit never cancels', order);
    // DCR client, full flow
    const k = pkce(), st = 'st-dcr-' + crypto.randomBytes(4).toString('hex');
    const go = await consent(S, authQ({ client_id: dcrId, code_challenge: k.c, state: st }), { action: 'allow', email: em, password: PW });
    const code = go.loc && go.loc.searchParams.get('code');
    ok('W12 Allow: 303 to Meta’s callback with code, the same state, and iss', go.r.status === 303 && go.loc.origin + go.loc.pathname === RURI && !!code && go.loc.searchParams.get('state') === st && go.loc.searchParams.get('iss') === ORIGIN, go.r.headers.location);

    const badV = await req(S, { method: 'POST', p: '/oauth/token', headers: F, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: 'wrong-' + k.v, client_id: dcrId, redirect_uri: RURI }).toString() });
    ok('W13 a wrong PKCE verifier is refused', badV.status === 400 && /PKCE/.test(badV.body));
    const reuse = await req(S, { method: 'POST', p: '/oauth/token', headers: F, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: k.v, client_id: dcrId }).toString() });
    ok('W14 a code is single-use: after a failed exchange it is gone', reuse.status === 400 && /Unknown or already used/.test(reuse.body));

    const k2 = pkce();
    const go2 = await consent(S, authQ({ client_id: dcrId, code_challenge: k2.c }), { action: 'allow', email: em, password: PW });
    const tokR = await req(S, { method: 'POST', p: '/oauth/token', headers: F, body: new URLSearchParams({ grant_type: 'authorization_code', code: go2.loc.searchParams.get('code'), code_verifier: k2.v, client_id: dcrId, redirect_uri: RURI }).toString() });
    const tj = tokR.status === 200 ? JSON.parse(tokR.body) : {};
    ok('W15 the exchange returns a Bearer access token', tokR.status === 200 && tj.token_type === 'Bearer' && !!tj.access_token, tokR.body);
    const d = new DatabaseSync(S.db);
    const conn = d.prepare("SELECT * FROM connections WHERE client_label='Muse' ORDER BY id DESC LIMIT 1").get();
    ok('W16 it is an ordinary Muse connection, stored only as a hash', !!conn && conn.revoked_at === null && !JSON.stringify(conn).includes(tj.access_token));
    d.close();

    // MCP through the wrapper equals MCP through the personal connector route
    const rpc = (m, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method: m, params: {} });
    const viaMuse = await req(S, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + tj.access_token }, body: rpc('tools/list') });
    const viaWww = await req(S, { host: WWW, method: 'POST', p: '/mcp/' + tj.access_token, headers: J, body: rpc('tools/list') });
    ok('W17 tools/list through the Muse origin is byte-identical to www’s /mcp/<connection>', viaMuse.status === 200 && viaMuse.body === viaWww.body && JSON.parse(viaMuse.body).result.tools.length > 50);
    const noTok = await req(S, { method: 'POST', p: '/mcp', headers: J, body: rpc('tools/list') });
    ok('W18 no bearer: 401 pointing at the Muse origin’s resource metadata', noTok.status === 401 && new RegExp(ORIGIN.replace(/\./g, '\\.') + '/\\.well-known/oauth-protected-resource').test(noTok.headers['www-authenticate']));
    const wwwOauth = await req(S, { host: WWW, method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + tj.access_token }, body: rpc('tools/list') });
    ok('W19 the Muse token is not a www OAuth token (www’s OAuth is untouched)', wwwOauth.status === 401);

    // revoke in Settings → the wrapper refuses it
    { const d2 = new DatabaseSync(S.db); d2.prepare("UPDATE connections SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").run(conn.id); d2.close(); }
    const afterRevoke = await req(S, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + tj.access_token }, body: rpc('tools/list') });
    ok('W20 revoking the connection shuts the wrapper out', afterRevoke.status === 401);

    // logs: stages present, secrets absent
    const secrets = [code, go2.loc.searchParams.get('code'), k.v, k2.v, k.c, tj.access_token, st, PW];
    ok('W21 the log records each stage', ['register_ok', 'authorize_shown', 'authorize_bad_password', 'authorize_denied', 'authorize_approved', 'token_error', 'token_issued', 'mcp_forwarded'].every((x) => S.log.includes(`"stage":"${x}"`)), S.log.slice(-1500));
    const scan = S.log.split('\n').filter((l) => !/^First run: admin /.test(l)).join('\n');   // the seed banner prints the test admin password at boot
    const leaked = secrets.map((x, i) => [i, x && scan.includes(x)]).filter(([, l]) => l).map(([i]) => i);
    ok('W22 and never a code, verifier, challenge, token, state or password', !leaked.length, 'leaked index ' + leaked + ' :: ' + S.log.split('\n').filter((l) => secrets.some((x) => l.includes(x))).slice(0, 3).join(' || '));
    await stop(S);

    // ---- iss off, CIMD not advertised -----------------------------------------------------
    const N = boot({ MUSE_WRAPPER: '1', MUSE_SEND_ISS: '0', MUSE_ADVERTISE_CIMD: '0' }); all.push(N); await up(N);
    const nm = JSON.parse((await req(N, { p: '/.well-known/oauth-authorization-server' })).body);
    ok('W23 MUSE_SEND_ISS=0 / MUSE_ADVERTISE_CIMD=0 are reflected in metadata', nm.authorization_response_iss_parameter_supported === false && nm.client_id_metadata_document_supported === false);
    const k3 = pkce();
    const go3 = await consent(N, authQ({ code_challenge: k3.c }), { action: 'allow', email: email(N), password: PW });
    ok('W24 with MUSE_SEND_ISS=0 the redirect carries code and state but no iss', go3.loc && !!go3.loc.searchParams.get('code') && !!go3.loc.searchParams.get('state') && !go3.loc.searchParams.has('iss'), go3.r.headers.location);
    const t3 = await req(N, { method: 'POST', p: '/oauth/token', headers: J, body: JSON.stringify({ grant_type: 'authorization_code', code: go3.loc.searchParams.get('code'), code_verifier: k3.v }) });
    ok('W25 a JSON token request without client_id also works (public client)', t3.status === 200 && !!JSON.parse(t3.body).access_token, t3.body);
    await stop(N);

    // ---- 302 back to Meta (v2.81) ----------------------------------------------------------
    const R = boot({ MUSE_WRAPPER: '1', MUSE_REDIRECT_STATUS: '302' }); all.push(R); await up(R);
    const k4 = pkce();
    const go4 = await consent(R, authQ({ code_challenge: k4.c }), { action: 'allow', email: email(R), password: PW });
    ok('W26 MUSE_REDIRECT_STATUS=302 sends Allow back as a 302, still with code, state and iss', go4.r.status === 302 && !!go4.loc.searchParams.get('code') && !!go4.loc.searchParams.get('state') && go4.loc.searchParams.get('iss') === ORIGIN, go4.r.status);
    ok('W27 and the log records which status was used', /"redirect_status":302/.test(R.log));
    await stop(R);

    // ---- key mode (v2.82): MUSE_KEYS=1, OAuth off ---------------------------------------
    const K = boot({ MUSE_KEYS: '1' }); all.push(K); await up(K);
    const kdb = new DatabaseSync(K.db);
    const kuser = kdb.prepare('SELECT id FROM users WHERE id=1').get().id;
    const key = crypto.randomBytes(24).toString('base64url');
    kdb.prepare("INSERT INTO connections(uid,user_id,token_hash,token_prefix,client_label) VALUES(?,?,?,?,'Muse')").run(crypto.randomUUID(), kuser, crypto.createHash('sha256').update(key).digest('hex'), key.slice(0, 6));
    kdb.close();
    const krpc = (id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
    const prmK = await req(K, { p: '/.well-known/oauth-protected-resource' }), asK = await req(K, { p: '/.well-known/oauth-authorization-server' });
    ok('K1 key mode advertises no OAuth: discovery documents are 404', prmK.status === 404 && asK.status === 404);
    const noKey = await req(K, { method: 'POST', p: '/mcp', headers: J, body: krpc() });
    ok('K2 no key: 401 asking for the key, with no OAuth resource metadata', noKey.status === 401 && /Bearer realm="discriminantly"/.test(noKey.headers['www-authenticate']) && !/resource_metadata/.test(noKey.headers['www-authenticate']) && /Settings/.test(noKey.body));
    const viaBearer = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + key }, body: krpc() });
    const viaWwwPath = await req(K, { host: WWW, method: 'POST', p: '/mcp/' + key, headers: J, body: krpc() });
    ok('K3 a Settings connection key as Bearer gets the same tools/list as www’s /mcp/<key>', viaBearer.status === 200 && viaBearer.body === viaWwwPath.body && JSON.parse(viaBearer.body).result.tools.length > 50);
    const viaHeader = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, 'x-api-key': key }, body: krpc() });
    ok('K4 and as X-API-Key', viaHeader.status === 200 && viaHeader.body === viaBearer.body);
    const bad = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer nope-not-a-key' }, body: krpc() });
    ok('K5 an unknown key is refused', bad.status === 401 && /not valid, or was revoked/.test(bad.body));
    { const d2 = new DatabaseSync(K.db); d2.prepare("UPDATE connections SET revoked_at=CURRENT_TIMESTAMP WHERE client_label='Muse'").run(); d2.close(); }
    const revoked = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + key }, body: krpc() });
    ok('K6 revoking the connection in Settings shuts the key out', revoked.status === 401);
    const authK = await req(K, { p: authQ({ code_challenge: 'x' }) });
    ok('K7 the OAuth pages stay inert in key mode (Phase 0 test page)', /test mode for Muse/.test(authK.body) && !/name="password"/.test(authK.body));
    ok('K8 the log records the mode and how the key came, never the key', /"stage":"key_forwarded","via":"bearer"/.test(K.log) && /"via":"x-api-key"/.test(K.log) && !K.log.includes(key));
    const wwwOauth2 = await req(K, { host: WWW, method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + key }, body: krpc() });
    ok('K9 www’s own /mcp is unchanged: a key is not an OAuth token there', wwwOauth2.status === 401);

    // ---- read-only keys (v2.83) -------------------------------------------------------------
    const rkey = crypto.randomBytes(24).toString('base64url');
    { const d3 = new DatabaseSync(K.db); d3.prepare("INSERT INTO connections(uid,user_id,token_hash,token_prefix,client_label,scope) VALUES(?,?,?,?,'Muse RO','read')").run(crypto.randomUUID(), kuser, crypto.createHash('sha256').update(rkey).digest('hex'), rkey.slice(0, 6)); d3.close(); }
    const call = (name, args, id = 7) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const roList = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + rkey }, body: krpc() });
    ok('K10 a read-only key lists tools on the Muse address', roList.status === 200 && JSON.parse(roList.body).result.tools.length > 50);
    const roRead = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + rkey }, body: call('my_travel_marks', { limit: 2 }) });
    ok('K11 and reads', roRead.status === 200 && !JSON.parse(roRead.body).result.isError, roRead.body.slice(0, 200));
    const before = (() => { const d4 = new DatabaseSync(K.db); try { return d4.prepare('SELECT COUNT(*) n FROM objects').get().n; } finally { d4.close(); } })();
    const roWrite = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + rkey }, body: call('note_object', { name: 'Muse read-only test', why: 'x' }) });
    const after = (() => { const d4 = new DatabaseSync(K.db); try { return d4.prepare('SELECT COUNT(*) n FROM objects').get().n; } finally { d4.close(); } })();
    const rw = JSON.parse(roWrite.body);
    ok('K12 a write on a read-only key is refused with a clear message, and nothing is written', rw.id === 7 && rw.result.isError === true && /read-only/.test(rw.result.content[0].text) && before === after, roWrite.body.slice(0, 300));
    const roWww = await req(K, { host: WWW, method: 'POST', p: '/mcp/' + rkey, headers: J, body: call('note_object', { name: 'via www', why: 'x' }) });
    ok('K13 a read-only key is not accepted on www’s /mcp/<key> at all', roWww.status === 401, roWww.status + ' ' + roWww.body.slice(0, 120));
    ok('K14 the refusal is logged by tool name, never the key', /"stage":"read_only_refused"[^\n]*"tools":\["note_object"\]/.test(K.log) && !K.log.includes(rkey));
    const fullWrite = await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + rkey.slice(0, 3) + 'x' }, body: call('note_object', { name: 'n', why: 'x' }) });
    ok('K15 an unknown key still gets the 401', fullWrite.status === 401);

    // ---- attribution (v2.84): calls without initialize are attributed to Muse ----------
    const fkey = crypto.randomBytes(24).toString('base64url');
    { const d5 = new DatabaseSync(K.db); d5.prepare("INSERT INTO connections(uid,user_id,token_hash,token_prefix,client_label) VALUES(?,?,?,?,'My Muse')").run(crypto.randomUUID(), kuser, crypto.createHash('sha256').update(fkey).digest('hex'), fkey.slice(0, 6)); d5.close(); }
    const made = JSON.parse((await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + fkey }, body: call('add_travel_mark', { place: 'Attribution Test Cafe', locality: 'Testville', country: 'Nowhere', private: true }) })).body);
    const pv = (() => { const d6 = new DatabaseSync(K.db); try { return d6.prepare("SELECT p.agent, p.actor_type, p.connection_uid, c.client_name, c.client_label FROM provenance p JOIN connections c ON c.uid=p.connection_uid WHERE p.entity_type='mark' AND p.action='created' ORDER BY p.id DESC LIMIT 1").get(); } finally { d6.close(); } })();
    ok('K16 a write through a key with no initialize is attributed to Muse, on that connection', made.result && !made.result.isError && pv && pv.agent === 'muse' && pv.actor_type === 'ai_on_behalf' && pv.client_name === 'Muse' && pv.client_label === 'My Muse', JSON.stringify(pv) + ' ' + JSON.stringify(made).slice(0, 300));
    const named = crypto.randomBytes(24).toString('base64url');
    { const d7 = new DatabaseSync(K.db); d7.prepare("INSERT INTO connections(uid,user_id,token_hash,token_prefix,client_label) VALUES(?,?,?,?,'Other')").run(crypto.randomUUID(), kuser, crypto.createHash('sha256').update(named).digest('hex'), named.slice(0, 6)); d7.close(); }
    await req(K, { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + named }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Muse Agent', version: '1' }, capabilities: {} } }) });
    const cn = (() => { const d8 = new DatabaseSync(K.db); try { return d8.prepare("SELECT client_name FROM connections WHERE token_prefix=?").get(named.slice(0, 6)).client_name; } finally { d8.close(); } })();
    ok('K17 a client that declares itself keeps its own name', cn === 'Muse Agent', cn);
    await stop(K);
  } catch (e) { console.error(e); fail++; } finally {
    for (const s of all) { try { s.proc.kill(); } catch {} }
    await new Promise((r) => setTimeout(r, 300));
    for (const s of all) fs.rmSync(s.work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
