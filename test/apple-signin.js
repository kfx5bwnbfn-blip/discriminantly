// Sign in with Apple (v2.101), end to end against a stand-in for appleid.apple.com.
// Usage: node test/apple-signin.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-')), DB = path.join(DIR, 'a.db');
const PORT = 3000 + Math.floor(Math.random() * 800) + 50, BASE = `http://localhost:${PORT}`;
const APORT = PORT + 1000, AORIGIN = `http://localhost:${APORT}`;
let pass = 0, fail = 0, srv = null, log = '';
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keys: ours (the .p8, EC P-256) and the stand-in Apple's (RSA, published as JWKS).
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const CLIENT = 'com.discriminantly.web';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const signRS = (claims, key = rsa.privateKey) => { const h = b64u({ alg: 'RS256', kid: 'test-kid' }), b = b64u(claims); return `${h}.${b}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${b}`), key).toString('base64url')}`; };

// The stand-in: /auth/keys and /auth/token. A code maps to who signed in.
const codes = new Map(); let lastSecretOk = false, forgeNext = false;
const apple = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    if (req.url === '/auth/keys') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ keys: [jwk] })); }
    if (req.url === '/auth/token' && req.method === 'POST') {
      const f = Object.fromEntries(new URLSearchParams(body));
      const [h, b, sig] = String(f.client_secret).split('.');
      const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
      lastSecretOk = crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))
        && claims.iss === 'TEAM123456' && claims.sub === CLIENT && claims.aud === 'https://appleid.apple.com' && JSON.parse(Buffer.from(h, 'base64url').toString()).kid === 'KEY1234567';
      const who = codes.get(f.code);
      if (!lastSecretOk || !who || f.redirect_uri !== BASE + '/auth/apple/callback') { res.writeHead(400); return res.end('{"error":"invalid_grant"}'); }
      const now = Math.floor(Date.now() / 1000);
      const idt = signRS({ iss: 'https://appleid.apple.com', aud: CLIENT, sub: who.sub, email: who.email, email_verified: 'true', nonce: who.nonce, iat: now, exp: now + 600 }, forgeNext ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : rsa.privateKey);
      forgeNext = false;
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'x', id_token: idt, token_type: 'Bearer' }));
    }
    res.writeHead(404); res.end();
  });
});

const APPLE_ENV = { APPLE_CLIENT_ID: CLIENT, APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'), APPLE_AUTH_ORIGIN: AORIGIN };
const start = async (extra) => { log = ''; srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', JOIN_SECRET: 'test-secret', PUBLIC_ORIGIN: BASE, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] }); srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; }); for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); return; } catch { await sleep(100); } } };
const stop = async () => { srv.kill(); await new Promise((r) => srv.on('exit', r)); };
const jar = (r, j = {}) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '') delete j[k]; else j[k] = v; } return j; };
const ck = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
const go = (p, j = {}, { form = null, origin = null } = {}) => fetch(BASE + p, { method: form ? 'POST' : 'GET', redirect: 'manual', headers: { cookie: ck(j), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(origin ? { origin } : {}) }, body: form ? new URLSearchParams(form) : undefined });
const hopTo = async (r) => { const h = await r.text(); return (h.match(/location\.replace\("([^"]*)"\)/) || [])[1]; };

// One Apple round trip: start, (Apple), callback. Returns the hop target and the jar.
async function appleRound({ next = '', link = false, sub, email, user = null, j = {}, tamper = false }) {
  let r = await go(`/auth/apple${link ? '?link=1' : next ? `?next=${encodeURIComponent(next)}` : ''}`, j);
  jar(r, j); const loc = new URL(r.headers.get('location'));
  const state = loc.searchParams.get('state'), nonce = loc.searchParams.get('nonce');
  const code = 'c_' + crypto.randomBytes(8).toString('hex'); codes.set(code, { sub, email, nonce });
  r = await go('/auth/apple/callback', j, { form: { code, state: tamper ? 'wrong' : state, ...(user ? { user: JSON.stringify(user) } : {}) }, origin: AORIGIN });
  jar(r, j); return { to: await hopTo(r), j, loc, code, status: r.status };
}

(async () => {
  await new Promise((r) => apple.listen(APORT, r));
  // 0. Not configured: inert.
  await start({});
  ok('off: /auth/apple is 404 and no Apple button on sign-in or join', (await go('/auth/apple')).status === 404 && !/apple-btn/.test(await (await go('/login')).text()) && !/apple-btn/.test(await (await go('/join')).text()));
  await stop();

  await start(APPLE_ENV);
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  ok('migration: user_identities and users.password_set exist', !!db.prepare("SELECT 1 FROM schema_migrations WHERE id='067-user-identities'").get() && db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'password_set'));

  // 1. Buttons, carrying next.
  const lp = await (await go('/login?next=' + encodeURIComponent('/oauth/authorize?client_id=x&state=y'))).text();
  ok('buttons: Sign in with Apple on /login (carrying the AI authorization), Continue with Apple on /join', /class="btn3d block apple-btn" href="\/auth\/apple\?next=%2Foauth%2Fauthorize%3Fclient_id%3Dx%26state%3Dy">Sign in with Apple/.test(lp) && /apple-btn[^>]*>Continue with Apple/.test(await (await go('/join')).text()));

  // 1b. Masthead and rail; back to the page signed in from.
  const notePage = await (await go('/o/1')).text();
  ok('masthead: Sign in with Apple beside Sign in, both returning to this page', /<form class="signin"[^>]*>[\s\S]*?<input type="hidden" name="next" value="\/o\/1">[\s\S]*?<a class="link caps signin-apple" href="\/auth\/apple\?next=%2Fo%2F1">Sign in with Apple<\/a><\/form>/.test(notePage));
  ok('rail: Continue with Apple under Create an account, then Sign in', /Create an account<\/a><\/p>\s*<p class="auth-or[^"]*"><span>or<\/span><\/p><p class="signup signup-apple"><a class="btn3d block apple-btn" href="\/auth\/apple">Continue with Apple<\/a><\/p><p class="fine center rail-signin">/.test(await (await go('/activity')).text()));
  ok('page next: only same-site paths, never sign-in pages or other hosts', !/name="next" value="\/\/evil/.test(await (await go('/login?next=//evil.example/x')).text()) && !/name="next" value="\/join"/.test(await (await go('/login?next=/join')).text()) && /name="next" value="\/o\/1"/.test(await (await go('/login?next=/o/1')).text()));

  // 2. Start: Apple's authorize URL, with a state, a nonce and a flow cookie.
  let r = await go('/auth/apple'); const loc = new URL(r.headers.get('location'));
  ok('start: redirects to Apple with form_post, name+email scope, our callback, state and nonce; sets the flow cookie', loc.origin === AORIGIN && loc.pathname === '/auth/authorize' && loc.searchParams.get('response_mode') === 'form_post' && loc.searchParams.get('scope') === 'name email' && loc.searchParams.get('client_id') === CLIENT && loc.searchParams.get('redirect_uri') === BASE + '/auth/apple/callback' && loc.searchParams.get('state').length > 10 && loc.searchParams.get('nonce').length > 10 && /apl=/.test(r.headers.getSetCookie().join()));

  // 3. A new person.
  let a = await appleRound({ sub: 'apple.sub.1', email: 'abc123@privaterelay.appleid.com', user: { name: { firstName: 'Ada', lastName: 'Lovelace' } } });
  ok('callback: Apple’s cross-site POST is accepted on this route only; the client secret was a valid ES256 JWT; on to finish', a.status === 200 && a.to === '/auth/apple/finish' && lastSecretOk && !!a.j.apn);
  ok('callback: other POSTs from another origin are still refused', (await go('/login', {}, { form: { email: 'x', password: 'y' }, origin: AORIGIN })).status === 403);
  let h = await (await go('/auth/apple/finish', a.j)).text();
  ok('finish: name from Apple prefilled, the Hide My Email address explained, Terms required', /name="name" value="Ada Lovelace"/.test(h) && /abc123@privaterelay\.appleid\.com/.test(h) && /Hide My Email/.test(h) && /name="terms"/.test(h) && !/name="password"/.test((h.match(/<form[^>]*id="apple-finish"[\s\S]*?<\/form>/) || [''])[0]));
  r = await go('/auth/apple/finish', a.j, { form: { name: 'Ada Lovelace' } });
  ok('finish: refused without the Terms; nothing created', r.status === 200 && /agree to the Terms/.test(await r.text()) && !db.prepare("SELECT 1 FROM users WHERE email='abc123@privaterelay.appleid.com'").get());
  r = await go('/auth/apple/finish', a.j, { form: { name: 'Ada Lovelace', terms: '1' } }); jar(r, a.j);
  const ada = db.prepare("SELECT * FROM users WHERE email='abc123@privaterelay.appleid.com'").get();
  ok('finish: account made (source apple, no password of its own, Terms recorded), identity stored, signed in, to All', r.status === 303 && r.headers.get('location') === '/' && !!a.j.sid && !!ada && ada.signup_source === 'apple' && ada.password_set === 0 && !!ada.terms_accepted_at
    && !!db.prepare("SELECT 1 FROM user_identities WHERE provider='apple' AND subject='apple.sub.1' AND user_id=?").get(ada.id) && !a.j.apn);
  ok('finish: the new member sees the full Welcome card', /welcome-card/.test(await (await go('/', a.j)).text()));

  // 4. Returning.
  const n0 = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  a = await appleRound({ sub: 'apple.sub.1', email: 'abc123@privaterelay.appleid.com' });
  ok('returning: signed straight in to the same account; no new account', a.to === '/' && !!a.j.sid && db.prepare('SELECT user_id FROM sessions WHERE token=?').get(a.j.sid).user_id === ada.id && db.prepare('SELECT COUNT(*) n FROM users').get().n === n0);

  // 5. Settings for an Apple-made account.
  h = await (await go('/settings', a.j)).text();
  ok('settings: Sign in with Apple shows Connected; no Disconnect (no password); delete asks for the handle only', /id="apple"/.test(h) && /Connected as abc123@privaterelay\.appleid\.com/.test(h) && !/action="\/auth\/apple\/unlink"/.test(h) && /action="\/settings\/delete-account"/.test(h) && !/name="password" autocomplete="current-password"/.test(h));
  ok('unlink: refused for an account with no password', /done=apple-needed/.test((await go('/auth/apple/unlink', a.j, { form: {} })).headers.get('location')) && !!db.prepare("SELECT 1 FROM user_identities WHERE user_id=?").get(ada.id));

  // 6. An email that already has an account: linked only after its password.
  db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('existing','Existing','existing@example.com',?,'modern')").run(require('crypto').randomBytes(1) && (() => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync('correcthorse', s, 32).toString('hex'); })());
  a = await appleRound({ sub: 'apple.sub.2', email: 'existing@example.com' });
  ok('existing email: not linked on Apple’s word; sent to sign in with a note', /^\/login\?apple=link/.test(a.to) && !db.prepare("SELECT 1 FROM user_identities WHERE subject='apple.sub.2'").get() && /Sign in with your password once, and Apple will be connected/.test(await (await go(a.to, a.j)).text()));
  r = await go('/login', a.j, { form: { email: 'existing@example.com', password: 'correcthorse' } }); jar(r, a.j);
  const ex = db.prepare("SELECT id FROM users WHERE email='existing@example.com'").get();
  ok('existing email: the password sign-in links Apple, and says so', /done=apple-linked/.test(r.headers.get('location')) && !!db.prepare("SELECT 1 FROM user_identities WHERE subject='apple.sub.2' AND user_id=?").get(ex.id) && !a.j.apn);
  const b2 = await appleRound({ sub: 'apple.sub.2', email: 'existing@example.com' });
  ok('existing email: from then on Apple signs straight in to it', b2.to === '/' && db.prepare('SELECT user_id FROM sessions WHERE token=?').get(b2.j.sid).user_id === ex.id);
  h = await (await go('/settings', b2.j)).text();
  ok('settings: a linked account with a password can disconnect Apple', /action="\/auth\/apple\/unlink"/.test(h));
  r = await go('/auth/apple/unlink', b2.j, { form: {} });
  ok('unlink: works for an account with a password', /done=apple-unlinked/.test(r.headers.get('location')) && !db.prepare("SELECT 1 FROM user_identities WHERE subject='apple.sub.2'").get());

  // 7. Linking from Settings, and an Apple ID already used elsewhere.
  const lk = await appleRound({ link: true, sub: 'apple.sub.3', email: 'whatever@privaterelay.appleid.com', j: { sid: b2.j.sid } });
  ok('link from Settings: connects to the signed-in account', /done=apple-linked/.test(lk.to) && !!db.prepare("SELECT 1 FROM user_identities WHERE subject='apple.sub.3' AND user_id=?").get(ex.id));
  const tk = await appleRound({ link: true, sub: 'apple.sub.1', email: 'abc123@privaterelay.appleid.com', j: { sid: b2.j.sid } });
  ok('link from Settings: an Apple ID already on another account is refused', /done=apple-taken/.test(tk.to) && db.prepare("SELECT user_id FROM user_identities WHERE subject='apple.sub.1'").get().user_id === ada.id);

  // 8. A share link: the plan comes with the new account, as with the form.
  const owner = db.prepare("SELECT id FROM users WHERE handle='existing'").get().id;
  const osid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(osid, owner);
  r = await go('/t/new', { sid: osid }, { form: { title: 'Apple trip' } }); const itId = +r.headers.get('location').replace('/t/', '');
  const tok = ((await (await go(`/t/${itId}/share`, { sid: osid }, { form: { show_author: '1' } })).text()).match(/\/s\/([A-Za-z0-9_-]{20,100})/) || [])[1];
  a = await appleRound({ next: '/s/' + tok, sub: 'apple.sub.4', email: 'sharer.friend@privaterelay.appleid.com', user: { name: { firstName: 'Friend' } } });
  r = await go('/auth/apple/finish', a.j, { form: { name: 'Friend', terms: '1' } });
  const fr = db.prepare("SELECT id FROM users WHERE email='sharer.friend@privaterelay.appleid.com'").get();
  ok('share link: Sign in with Apple lands on the new member’s own copy of the plan', /^\/t\/\d+\?mine=1$/.test(r.headers.get('location')) && !!fr && db.prepare('SELECT user_id FROM itineraries WHERE id=?').get(+r.headers.get('location').match(/\/t\/(\d+)/)[1]).user_id === fr.id);

  // 9. An AI authorization in progress comes back to it.
  const nx = '/oauth/authorize?client_id=abc&redirect_uri=x&state=s';
  a = await appleRound({ next: nx, sub: 'apple.sub.5', email: 'ai.person@privaterelay.appleid.com' });
  r = await go('/auth/apple/finish', a.j, { form: { name: 'AI Person', terms: '1' } });
  ok('AI authorization: after the account is made, back to the authorization it came from', r.headers.get('location') === nx);
  const back = await appleRound({ next: nx, sub: 'apple.sub.5', email: 'ai.person@privaterelay.appleid.com' });
  ok('AI authorization: a returning Apple sign-in also goes back to it', back.to === nx);

  // 9b. From the masthead, a returning Apple sign-in comes back to the page.
  const pg = await appleRound({ next: '/o/1', sub: 'apple.sub.5', email: 'ai.person@privaterelay.appleid.com' });
  ok('masthead: a returning Apple sign-in comes back to the page it started on', pg.to === '/o/1');
  db.prepare("UPDATE users SET pass=? WHERE email='existing@example.com'").run((() => { const s2 = crypto.randomBytes(16).toString('hex'); return s2 + ':' + crypto.scryptSync('correcthorse', s2, 32).toString('hex'); })());
  r = await go('/login', {}, { form: { email: 'existing@example.com', password: 'correcthorse', next: '/o/1' } });
  ok('masthead: the email sign-in also comes back to the page (not the feed)', r.status === 303 && r.headers.get('location') === '/o/1');

  // 10. Refusals.
  const n1 = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  a = await appleRound({ sub: 'apple.sub.6', email: 'x6@privaterelay.appleid.com', tamper: true });
  ok('refused: a state that doesn’t match the flow cookie', /done=apple-failed/.test(a.to) && !a.j.apn);
  r = await go('/auth/apple/callback', {}, { form: { code: 'nope', state: 'nope' }, origin: AORIGIN });
  ok('refused: no flow cookie at all', /done=apple-failed/.test(await hopTo(r)));
  forgeNext = true; a = await appleRound({ sub: 'apple.sub.7', email: 'x7@privaterelay.appleid.com' });
  ok('refused: an id_token not signed by Apple’s key', /done=apple-failed/.test(a.to) && !a.j.apn && db.prepare('SELECT COUNT(*) n FROM users').get().n === n1);
  r = await go('/auth/apple/finish', {}, { form: { name: 'X', terms: '1' } });
  ok('refused: finish without a pending Apple sign-in', r.status === 303 && r.headers.get('location') === '/join');
  const c1 = await (async () => { let x = await go('/auth/apple'); const j = jar(x); const st = new URL(x.headers.get('location')).searchParams.get('state'); x = await go('/auth/apple/callback', j, { form: { error: 'user_cancelled_authorize', state: st }, origin: AORIGIN }); return hopTo(x); })();
  ok('cancelled at Apple: back to sign in, quietly', c1 === '/login');

  // 11. Nothing secret in the log.
  ok('log: no codes, tokens, client secrets, states or nonces', ![...codes.keys()].some((c) => log.includes(c)) && !/eyJ/.test(log) && !/client_secret/.test(log));

  // 12. Deleting an Apple-made account removes its identity.
  const asid = (() => { const t = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, ada.id); return t; })();
  r = await go('/settings/delete-account', { sid: asid }, { form: { confirm: ada.handle } });
  ok('delete: an Apple-made account deletes with its handle alone, identity and all', !db.prepare('SELECT 1 FROM users WHERE id=?').get(ada.id) && !db.prepare("SELECT 1 FROM user_identities WHERE subject='apple.sub.1'").get());

  await stop(); apple.close(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { srv.kill(); } catch {} apple.close(); process.exit(1); });
