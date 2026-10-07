// Phase 1a: the Muse client metadata document on the Muse origin, and the
// unchanged www OAuth flow accepting it end to end.
//
// The server cannot fetch https://muse.test, so www's CIMD fetch is stubbed
// with a literal document; the test first proves the Muse origin serves
// exactly that literal, so the stub stands in for the real fetch.
//
//   node test/muse-client.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 400) : '')); };
const WWW = 'www.discriminantly.com', MUSE = 'muse.test';
const CID = 'https://muse.test/.well-known/meta-muse-client.json';
const RURI = 'https://agent.meta.ai/api/hatch/oauth/callback';
const EXPECTED = { client_id: CID, client_name: 'Muse', redirect_uris: [RURI], grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'discriminantly' };

function boot(extraEnv) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-client-'));
  const port = 4900 + Math.floor(Math.random() * 500);
  const env = { ...process.env, PORT: String(port), DB_PATH: path.join(work, 'd.db'), SEED: '1', ADMIN_PASSWORD: 'prototype1', PUBLIC_ORIGIN: 'https://' + WWW, ...extraEnv };
  for (const k of Object.keys(extraEnv)) if (extraEnv[k] === undefined) delete env[k];
  const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { port, work, proc, log: '' };
  proc.stdout.on('data', (d) => { s.log += d; }); proc.stderr.on('data', (d) => { s.log += d; });
  return s;
}
const req = (s, { host, method = 'GET', p, headers = {}, body = null }) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: s.port, method, path: p, headers: { Host: host, ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const up = async (s) => { for (let i = 0; i < 100; i++) { try { await req(s, { host: WWW, p: '/' }); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('server did not start\n' + s.log); };
const F = { 'content-type': 'application/x-www-form-urlencoded' };

(async () => {
  const ON = boot({ MUSE_ORIGIN: 'https://' + MUSE, CIMD_STUB: JSON.stringify({ [CID]: EXPECTED }) });
  const OFF = boot({ MUSE_ORIGIN: undefined, CIMD_STUB: undefined });
  try {
    await Promise.all([up(ON), up(OFF)]);

    console.log('the document');
    const d = await req(ON, { host: MUSE, p: '/.well-known/meta-muse-client.json' });
    ok('MC1 served on the Muse origin as JSON', d.status === 200 && /application\/json/.test(d.headers['content-type']), d.status);
    ok('MC2 exactly the expected document (so the stubbed fetch is faithful)', JSON.stringify(JSON.parse(d.body)) === JSON.stringify(EXPECTED), d.body);
    ok('MC3 client_id equals its own URL', JSON.parse(d.body).client_id === 'https://' + MUSE + '/.well-known/meta-muse-client.json');
    ok('MC4 cacheable for five minutes', d.headers['cache-control'] === 'public, max-age=300', d.headers['cache-control']);
    ok('MC5 not served on www (frozen www unchanged)', (await req(ON, { host: WWW, p: '/.well-known/meta-muse-client.json' })).status === 404);
    ok('MC6 not served anywhere when MUSE_ORIGIN is unset (rollback)', (await req(OFF, { host: MUSE, p: '/.well-known/meta-muse-client.json' })).status === 404
      && (await req(OFF, { host: WWW, p: '/.well-known/meta-muse-client.json' })).status === 404);
    ok('MC7 the document fetch is logged as a capture line', /muse-capture .*meta-muse-client\.json/.test(ON.log));

    console.log('www OAuth accepts it, unchanged');
    const ver = crypto.randomBytes(32).toString('base64url'), ch = crypto.createHash('sha256').update(ver).digest('base64url');
    const base = { client_id: CID, redirect_uri: RURI, code_challenge: ch, code_challenge_method: 'S256', state: 'st-1', resource: 'https://' + WWW + '/mcp', scope: 'discriminantly' };
    const login = await req(ON, { host: WWW, method: 'POST', p: '/login', headers: F, body: new URLSearchParams({ email: 'admin@discriminant.ly', password: 'prototype1' }).toString() });
    const sid = ((login.headers['set-cookie'] || []).join(';').match(/sid=([^;]+)/) || [])[1];
    ok('MC8 member signs in on www', !!sid, login.status);
    const consent = await req(ON, { host: WWW, p: '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', ...base }), headers: { cookie: 'sid=' + sid } });
    ok('MC9 consent page names Muse', consent.status === 200 && /Muse wants to connect/.test(consent.body), consent.status + ' ' + consent.body.slice(0, 300));
    const appr = await req(ON, { host: WWW, method: 'POST', p: '/oauth/authorize', headers: { ...F, cookie: 'sid=' + sid }, body: new URLSearchParams({ ...base, approve: '1' }).toString() });
    const loc = new URL(appr.headers.location || 'https://x/');
    ok('MC10 approval redirects to Meta\'s callback with a code and the state', loc.origin + loc.pathname === RURI && !!loc.searchParams.get('code') && loc.searchParams.get('state') === 'st-1', appr.status + ' ' + appr.headers.location);
    const t = await req(ON, { host: WWW, method: 'POST', p: '/oauth/token', headers: F, body: new URLSearchParams({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), redirect_uri: RURI, client_id: CID, code_verifier: ver, resource: base.resource }).toString() });
    const tj = JSON.parse(t.body);
    ok('MC11 code exchanges for access and refresh tokens', t.status === 200 && !!tj.access_token && !!tj.refresh_token, t.body);
    const tl = await req(ON, { host: WWW, method: 'POST', p: '/mcp', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tj.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    ok('MC12 the token reaches the www tools', tl.status === 200 && JSON.parse(tl.body).result.tools.length === 67, tl.status);

    console.log('what www still refuses');
    const bad = async (o) => (await req(ON, { host: WWW, p: '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', ...base, ...o }), headers: { cookie: 'sid=' + sid } }));
    ok('MC13 any other redirect URI is refused', (await bad({ redirect_uri: 'https://evil.example/cb' })).status === 400);
    ok('MC14 a trailing-slash resource is refused (www unchanged; Muse must send /mcp)', (await bad({ resource: 'https://' + WWW + '/mcp/' })).status === 400);
    ok('MC15 read/write scopes are refused (www offers only "discriminantly")', (await bad({ scope: 'discriminantly.read' })).status === 400);
    ok('MC16 the capture never logs state, PKCE or tokens', !ON.log.includes(ver) && !ON.log.includes(tj.access_token) && !ON.log.includes(tj.refresh_token));
  } finally {
    for (const s of [ON, OFF]) s.proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    for (const s of [ON, OFF]) fs.rmSync(s.work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
