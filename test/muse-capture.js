// Phase 0: the Muse capture origin, and proof that www is untouched.
//
// Starts three servers on fresh, identically seeded databases:
//   OLD  the reviewed production code (BASELINE_DIR, e.g. a checkout of GitHub main)
//   OFF  this code with MUSE_ORIGIN unset
//   ON   this code with MUSE_ORIGIN=http://muse.test
// then checks: www answers byte-for-byte the same on all three; the Muse host
// is inert when unset; when set it captures only non-secret request shape,
// issues nothing, reads no session, and writes nothing to the database.
//
//   BASELINE_DIR=/path/to/production/checkout node test/muse-capture.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const BASE_DIR = process.env.BASELINE_DIR;
if (!BASE_DIR) { console.error('BASELINE_DIR is required'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 400) : '')); };
const WWW = 'www.discriminantly.com', MUSE = 'muse.test';
const SECRET = { state: 'STATE-SECRET-91f2', challenge: 'CHALLENGE-SECRET-77ab', cookie: 'COOKIE-SECRET-3c1d', bearer: 'BEARER-SECRET-5e0f', clientSecret: 'CLIENT-SECRET-aa10', email: 'secret.person@example.com', verifier: 'VERIFIER-SECRET-0b9c', code: 'CODE-SECRET-1d2e' };

function boot(name, dir, extraEnv) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-' + name + '-'));
  const port = 4100 + Math.floor(Math.random() * 800);
  const env = { ...process.env, PORT: String(port), DB_PATH: path.join(work, 'd.db'), SEED: '1', ADMIN_PASSWORD: 'prototype1', PUBLIC_ORIGIN: 'https://' + WWW, ...extraEnv };
  if (!extraEnv.MUSE_ORIGIN) delete env.MUSE_ORIGIN;
  const proc = spawn(process.execPath, ['server.js'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { name, port, work, proc, log: '' };
  proc.stdout.on('data', (d) => { s.log += d; }); proc.stderr.on('data', (d) => { s.log += d; });
  return s;
}
const req = (s, { host, method = 'GET', p, headers = {}, body = null }) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: s.port, method, path: p, headers: { Host: host, ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const up = async (s) => { for (let i = 0; i < 100; i++) { try { await req(s, { host: WWW, p: '/' }); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error(s.name + ' did not start\n' + s.log); };
const stable = (r) => ({ status: r.status, ct: r.headers['content-type'] || null, wwwa: r.headers['www-authenticate'] || null, loc: r.headers.location || null, cache: r.headers['cache-control'] || null,
  body: r.body.replace(/\?v=[0-9a-f]{10}/g, '?v=X') });

(async () => {
  const OLD = boot('old', BASE_DIR, {}), OFF = boot('off', ROOT, {}), ON = boot('on', ROOT, { MUSE_ORIGIN: 'http://' + MUSE });
  try {
    await Promise.all([up(OLD), up(OFF), up(ON)]);
    // the same personal connector token in all three (seeded admin = user 1)
    const TOK = crypto.randomBytes(16).toString('hex');
    for (const s of [OLD, OFF, ON]) { const d = new DatabaseSync(path.join(s.work, 'd.db')); d.exec('PRAGMA busy_timeout=5000'); d.prepare('UPDATE users SET api_token=? WHERE id=1').run(TOK); d.close(); }
    const rpc = (method, params = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const J = { 'content-type': 'application/json' }, F = { 'content-type': 'application/x-www-form-urlencoded' };

    // ---- 1. www is byte-identical across OLD, OFF and ON ----------------------
    console.log('www unchanged (production code vs this code, Muse off and on)');
    const probes = [
      ['PRM', { p: '/.well-known/oauth-protected-resource' }],
      ['AS metadata', { p: '/.well-known/oauth-authorization-server' }],
      ['Inspector client document', { p: '/.well-known/mcp-inspector-client.json' }],
      ['openid-configuration (absent)', { p: '/.well-known/openid-configuration' }],
      ['/oauth/register (absent)', { method: 'POST', p: '/oauth/register', headers: J, body: '{"redirect_uris":["https://agent.meta.ai/api/hatch/oauth/callback"]}' }],
      ['/mcp unauthenticated POST', { method: 'POST', p: '/mcp', headers: J, body: rpc('tools/list') }],
      ['/mcp/ unauthenticated POST', { method: 'POST', p: '/mcp/', headers: J, body: rpc('tools/list') }],
      ['/mcp unauthenticated GET', { p: '/mcp' }],
      ['/mcp bad bearer', { method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer nope' }, body: rpc('tools/list') }],
      ['authorize: missing details', { p: '/oauth/authorize' }],
      ['authorize: plain PKCE', { p: '/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fa.b%2Fc&code_challenge_method=plain&code_challenge=z' }],
      ['authorize: wrong resource', { p: '/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fa.b%2Fc&code_challenge_method=S256&code_challenge=z&resource=https%3A%2F%2Fwww.discriminantly.com%2Fmcp%2F' }],
      ['authorize: wrong scope', { p: '/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fa.b%2Fc&code_challenge_method=S256&code_challenge=z&scope=read' }],
      ['authorize: opaque client_id', { p: '/oauth/authorize?client_id=opaque123&redirect_uri=https%3A%2F%2Fagent.meta.ai%2Fapi%2Fhatch%2Foauth%2Fcallback&code_challenge_method=S256&code_challenge=z' }],
      ['token: bad grant', { method: 'POST', p: '/oauth/token', headers: F, body: 'grant_type=password' }],
      ['token: unknown code', { method: 'POST', p: '/oauth/token', headers: F, body: 'grant_type=authorization_code&code=nope' }],
      ['token: unknown refresh', { method: 'POST', p: '/oauth/token', headers: F, body: 'grant_type=refresh_token&refresh_token=nope' }],
      ['personal address: initialize', { method: 'POST', p: '/mcp/' + TOK, headers: J, body: rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } }) }],
      ['personal address: tools/list', { method: 'POST', p: '/mcp/' + TOK, headers: J, body: rpc('tools/list') }],
      ['personal address with slash: tools/list', { method: 'POST', p: '/mcp/' + TOK + '/', headers: J, body: rpc('tools/list') }],
      ['personal address: resources/list', { method: 'POST', p: '/mcp/' + TOK, headers: J, body: rpc('resources/list') }],
    ];
    for (const [label, pr] of probes) {
      const [a, b, c] = await Promise.all([OLD, OFF, ON].map((s) => req(s, { host: WWW, ...pr })));
      const sa = JSON.stringify(stable(a)), sb = JSON.stringify(stable(b)), sc = JSON.stringify(stable(c));
      ok(`W ${label}: identical (${a.status})`, sa === sb && sb === sc, sa === sb ? 'ON differs: ' + sc.slice(0, 300) : 'OFF differs: ' + sb.slice(0, 300));
    }
    const tl = JSON.parse((await req(ON, { host: WWW, method: 'POST', p: '/mcp/' + TOK, headers: J, body: rpc('tools/list') })).body);
    ok('W the www tool list is the full submitted surface (67 tools)', tl.result && tl.result.tools.length === 67, tl.result && tl.result.tools.length);

    // ---- 2. Unset means inert ---------------------------------------------------
    console.log('MUSE_ORIGIN unset: the Muse host is just www');
    for (const s of [OLD, OFF]) {
      const r = await req(s, { host: MUSE, p: '/.well-known/oauth-authorization-server' });
      ok(`U ${s.name}: no registration endpoint, www issuer`, r.status === 200 && !/registration_endpoint/.test(r.body) && JSON.parse(r.body).issuer === 'https://' + WWW, r.body);
      const g = await req(s, { host: MUSE, method: 'POST', p: '/oauth/register', headers: J, body: '{}' });
      ok(`U ${s.name}: /oauth/register is not served`, g.status === 404, g.status);
    }
    ok('U OFF prints no capture lines', !/muse-capture/.test(OFF.log));

    // ---- 3. The capture origin --------------------------------------------------
    console.log('MUSE_ORIGIN set: the capture origin');
    const dbOn = new DatabaseSync(path.join(ON.work, 'd.db'), { readOnly: true });
    const TABLES = ['users', 'sessions', 'connections', 'oauth_codes', 'oauth_tokens', 'provenance', 'product_events', 'objects', 'marks', 'adoptions', 'signup_context'];
    const counts = () => Object.fromEntries(TABLES.map((t) => [t, dbOn.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));
    const before = counts();
    const adminSid = 'x'; // a real admin session cookie, to prove the Muse host never reads it
    const sid = crypto.randomBytes(12).toString('hex');
    { const d = new DatabaseSync(path.join(ON.work, 'd.db')); d.prepare('INSERT INTO sessions(token,user_id) VALUES(?,1)').run(sid); d.close(); }
    const before2 = counts();

    const prm = await req(ON, { host: MUSE, p: '/.well-known/oauth-protected-resource' });
    const prmJ = JSON.parse(prm.body);
    ok('M protected-resource metadata names the Muse resource and issuer only', prm.status === 200 && prmJ.resource === 'http://muse.test/mcp' && prmJ.authorization_servers[0] === 'http://muse.test' && !prm.body.includes(WWW + '/mcp'), prm.body);
    ok('M path-suffixed protected-resource metadata is served too', (await req(ON, { host: MUSE, p: '/.well-known/oauth-protected-resource/mcp' })).status === 200);
    const as = JSON.parse((await req(ON, { host: MUSE, p: '/.well-known/oauth-authorization-server' })).body);
    ok('M AS metadata advertises a capture registration_endpoint, S256, public clients, read/write scopes, and CIMD',
      as.issuer === 'http://muse.test' && as.registration_endpoint === 'http://muse.test/oauth/register' && as.code_challenge_methods_supported.join() === 'S256'
      && as.token_endpoint_auth_methods_supported.join() === 'none' && as.scopes_supported.join() === 'discriminantly.read,discriminantly.write' && as.client_id_metadata_document_supported === true, JSON.stringify(as));
    ok('M openid-configuration answers with the same metadata', JSON.parse((await req(ON, { host: MUSE, p: '/.well-known/openid-configuration' })).body).registration_endpoint === as.registration_endpoint);

    const mcp = await req(ON, { host: MUSE, method: 'POST', p: '/mcp', headers: { ...J, authorization: 'Bearer ' + SECRET.bearer, cookie: 'sid=' + sid }, body: rpc('tools/list') });
    ok('M /mcp always answers 401 with the Muse resource_metadata (even with a session cookie and a bearer)', mcp.status === 401 && /resource_metadata="http:\/\/muse\.test\/\.well-known\/oauth-protected-resource"/.test(mcp.headers['www-authenticate']), mcp.status + ' ' + mcp.headers['www-authenticate']);
    const pers = await req(ON, { host: MUSE, method: 'POST', p: '/mcp/' + TOK, headers: J, body: rpc('tools/list') });
    ok('M the personal connector address does not exist on the Muse host (no member data)', pers.status === 404 && !/tools/.test(pers.body), pers.status);
    ok('M the www OAuth and login pages are not served on the Muse host', (await req(ON, { host: MUSE, p: '/login' })).status === 404 && (await req(ON, { host: MUSE, p: '/u/elicierto' })).status === 404);

    const dcrBody = JSON.stringify({ client_name: 'Meta Muse', redirect_uris: ['https://agent.meta.ai/api/hatch/oauth/callback'], application_type: 'web', token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'discriminantly.read', client_secret: SECRET.clientSecret, contacts: [SECRET.email], software_statement: 'eyJ.' + SECRET.code });
    const reg = await req(ON, { host: MUSE, method: 'POST', p: '/oauth/register', headers: { ...J, 'user-agent': 'MuseConnector/1.0' }, body: dcrBody });
    const regJ = JSON.parse(reg.body);
    ok('M /oauth/register answers with the fixed placeholder only: no secret, nothing stored', reg.status === 201 && regJ.client_id === 'muse-capture-test-only' && !('client_secret' in regJ) && !reg.body.includes(SECRET.clientSecret), reg.body);

    const q = new URLSearchParams({ response_type: 'code', client_id: 'muse-capture-test-only', redirect_uri: 'https://agent.meta.ai/api/hatch/oauth/callback', scope: 'discriminantly.read', resource: 'http://muse.test/mcp',
      code_challenge: SECRET.challenge, code_challenge_method: 'S256', state: SECRET.state, extra_param: 'v' });
    const auth = await req(ON, { host: MUSE, p: '/oauth/authorize?' + q, headers: { cookie: 'sid=' + sid, 'user-agent': 'Mozilla/5.0 test-browser' } });
    ok('M /oauth/authorize ends at the test-mode page: 200, no redirect, no code', auth.status === 200 && !auth.headers.location && /test mode for Muse/.test(auth.body) && !/code=/.test(auth.body), auth.status);
    ok('M ...and reads no session (the page is identical without the cookie)', auth.body === (await req(ON, { host: MUSE, p: '/oauth/authorize?' + q, headers: { 'user-agent': 'Mozilla/5.0 test-browser' } })).body);
    const authPost = await req(ON, { host: MUSE, method: 'POST', p: '/oauth/authorize', headers: F, body: q.toString() });
    ok('M POST /oauth/authorize is captured the same way', authPost.status === 200 && !authPost.headers.location);

    const tok = await req(ON, { host: MUSE, method: 'POST', p: '/oauth/token', headers: F, body: `grant_type=authorization_code&code=${SECRET.code}&code_verifier=${SECRET.verifier}&client_id=x` });
    ok('M /oauth/token issues nothing', tok.status === 400 && JSON.parse(tok.body).error === 'invalid_grant' && !/access_token|refresh_token/.test(tok.body), tok.body);
    const tok2 = await req(ON, { host: MUSE, method: 'POST', p: '/oauth/token', headers: F, body: 'grant_type=refresh_token&refresh_token=' + SECRET.bearer });
    ok('M /oauth/token refresh issues nothing', tok2.status === 400);

    await new Promise((r) => setTimeout(r, 200));
    const after = counts();
    ok('M no database writes from any Muse request (users, sessions, connections, codes, tokens, provenance, events, records)', JSON.stringify(after) === JSON.stringify(before2), JSON.stringify({ before: before2, after }));
    ok('M (the only change in the run was the test inserting its own session)', after.sessions === before.sessions + 1);

    // ---- 4. What was captured -------------------------------------------------
    console.log('capture lines');
    const lines = ON.log.split('\n').filter((l) => l.startsWith('muse-capture ')).map((l) => JSON.parse(l.slice(13)));
    const regLine = lines.find((l) => l.path === '/oauth/register');
    ok('C registration captured: client_name, redirect_uris, application_type, token_endpoint_auth_method, grant_types, response_types, scope, field names',
      regLine && regLine.registration.client_name === 'Meta Muse' && regLine.registration.redirect_uris[0] === 'https://agent.meta.ai/api/hatch/oauth/callback'
      && regLine.registration.application_type === 'web' && regLine.registration.token_endpoint_auth_method === 'none' && regLine.registration.grant_types.join() === 'authorization_code,refresh_token'
      && regLine.registration.response_types.join() === 'code' && regLine.registration.scope === 'discriminantly.read' && regLine.registration.keys.includes('client_secret') && regLine.ua === 'MuseConnector/1.0', JSON.stringify(regLine));
    ok('C secret-bearing registration fields are recorded as present only', regLine && regLine.registration.client_secret_present && regLine.registration.contacts_present && regLine.registration.software_statement_present);
    const authLine = lines.find((l) => l.path === '/oauth/authorize' && l.method === 'GET');
    ok('C authorize captured: client_id, redirect_uri, scope, resource, code_challenge_method, response_type, parameter names',
      authLine && authLine.authorize.client_id === 'muse-capture-test-only' && authLine.authorize.redirect_uri === 'https://agent.meta.ai/api/hatch/oauth/callback' && authLine.authorize.scope === 'discriminantly.read'
      && authLine.authorize.resource === 'http://muse.test/mcp' && authLine.authorize.code_challenge_method === 'S256' && authLine.authorize.response_type === 'code'
      && authLine.authorize.param_names.includes('extra_param') && authLine.authorize.state_present === true && authLine.authorize.code_challenge_present === true, JSON.stringify(authLine));
    ok('C the /mcp probe records only the JSON-RPC method and that an Authorization header was present', lines.some((l) => l.path === '/mcp' && l.rpc_method === 'tools/list' && l.authorization_present === true));
    ok('C token requests record the grant type only', lines.some((l) => l.path === '/oauth/token' && l.grant_type === 'authorization_code'));
    const all = lines.map((l) => JSON.stringify(l)).join('\n');
    const leaked = Object.entries(SECRET).filter(([, v]) => all.includes(v)).map(([k]) => k).concat(all.includes(sid) ? ['session cookie'] : []).concat(all.includes(TOK) ? ['personal token'] : []);
    ok('C nothing secret in the capture: no state, PKCE challenge or verifier, code, token, cookie, client secret, e-mail, personal token', leaked.length === 0, leaked.join(', '));
    ok('C a token-like path segment is recorded by length only', lines.some((l) => l.path === '/mcp/<redacted:32>'), JSON.stringify(lines.filter((l) => l.path.startsWith('/mcp/'))));
  ok('C client addresses are truncated to a prefix', lines.every((l) => !l.ip || /x\.x$|…$/.test(l.ip)));
    dbOn.close();
  } finally {
    for (const s of [OLD, OFF, ON]) { s.proc.kill(); }
    await new Promise((r) => setTimeout(r, 300));
    for (const s of [OLD, OFF, ON]) fs.rmSync(s.work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
