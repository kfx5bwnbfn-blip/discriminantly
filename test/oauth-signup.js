// Sign-in return and sign-up from an AI's authorization (v2.62), and the
// activation report. Needs a server started with a stubbed client document:
//   CID=https://chatgpt.test/oauth/client.json RURI=http://127.0.0.1:6274/oauth/callback
//   CIMD_STUB='{"<CID>":{"client_id":"<CID>","client_name":"ChatGPT (test)","redirect_uris":["<RURI>"],"token_endpoint_auth_method":"none"}}'
//   PUBLIC_ORIGIN=http://localhost:3000 SEED=1 ADMIN_PASSWORD=prototype1 node server.js
// then: CID=... RURI=... DB_PATH=data/discriminantly.db node test/oauth-signup.js
const crypto = require('crypto'); const { DatabaseSync } = require('node:sqlite');
const B = 'http://localhost:3000', CID = process.env.CID, RURI = process.env.RURI;
const db = new DatabaseSync(process.env.DB_PATH || 'data/discriminantly.db');
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const form = (o, cookie) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(o), redirect: 'manual' });
(async () => {
  const ver = crypto.randomBytes(32).toString('base64url'), ch = crypto.createHash('sha256').update(ver).digest('base64url');
  const auth = '/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: CID, redirect_uri: RURI, code_challenge: ch, code_challenge_method: 'S256', state: 'st', resource: B + '/mcp' });
  let r = await fetch(B + auth, { redirect: 'manual' }); const loginAt = r.headers.get('location') || '';
  ok('OS1 not signed in, the authorization sends to sign-in with a return address', r.status === 303 && loginAt.startsWith('/login?next=%2Foauth%2Fauthorize'));
  r = await fetch(B + loginAt); let h = await r.text();
  ok('OS2 sign-in carries the return address and offers an account', /name="next" value="\/oauth\/authorize\?/.test(h) && /Create an account/.test(h) && !/Have an invite code/.test(h));
  const joinAt = (h.match(/href="(\/join\?next=[^"]+)"/) || [])[1].replace(/&amp;/g, '&');
  r = await fetch(B + joinAt); h = await r.text();
  ok('OS3 the account form asks for name, email and password; no invite', /Create your account/.test(h) && !/name="code"/.test(h) && !/name="handle"/.test(h));
  const next = (h.match(/name="next" value="([^"]+)"/) || [])[1].replace(/&amp;/g, '&');
  r = await fetch(B + '/join', form({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correcthorse', next }));
  const sid = ((r.headers.get('set-cookie') || '').match(/sid=([^;]+)/) || [])[1];
  ok('OS4 creating the account signs in and returns to the authorization', r.status === 303 && (r.headers.get('location') || '').startsWith('/oauth/authorize?') && !!sid);
  r = await fetch(B + r.headers.get('location'), { headers: { cookie: 'sid=' + sid }, redirect: 'manual' }); h = await r.text();
  ok('OS5 back on the authorization, signed in: the approve step shows', r.status === 200 && /ChatGPT \(test\)/.test(h));
  r = await fetch(B + '/oauth/authorize', form({ client_id: CID, redirect_uri: RURI, code_challenge: ch, code_challenge_method: 'S256', state: 'st', resource: B + '/mcp', approve: '1' }, 'sid=' + sid));
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  const t = await (await fetch(B + '/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: RURI, client_id: CID, code_verifier: ver, resource: B + '/mcp' }))).json();
  const call = async (method, params) => (await (await fetch(B + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + t.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
  ok('OS6 approve, code, token: the new member reaches the tools', (await call('tools/list', {})).tools.length > 60);
  const u = db.prepare("SELECT id, handle, signup_source FROM users WHERE email='ada@example.com'").get();
  ok('OS7 recorded as arriving from ChatGPT, with a generated handle', u.signup_source === 'chatgpt' && u.handle === 'adalovelace', JSON.stringify(u));
  r = await fetch(B + '/login', form({ email: 'ada@example.com', password: 'correcthorse', next }));
  ok('OS8 an existing member signing in returns to the authorization (reviewers sign in this way)', (r.headers.get('location') || '').startsWith('/oauth/authorize?'));
  r = await fetch(B + '/login', form({ email: 'ada@example.com', password: 'correcthorse' }));
  ok('OS9 an ordinary sign-in still goes home', r.headers.get('location') === '/');
  r = await fetch(B + '/login?next=' + encodeURIComponent('https://evil.example/')); h = await r.text();
  ok('OS10 a foreign return address is ignored', !/evil\.example/.test(h));
  r = await fetch(B + '/join', form({ name: 'x', email: 'x@example.com', password: 'correcthorse', next: 'https://evil.example/' }));
  ok('OS11 joining is open, and a foreign return address still cannot redirect: the new member goes home', r.status === 303 && r.headers.get('location') === '/');
  r = await fetch(B + '/join', form({ name: 'Ada Two', email: 'ada@example.com', password: 'correcthorse', next })); h = await r.text();
  ok('OS12 a taken email offers sign-in instead', /already exists/.test(h) && /Sign in instead/.test(h));
  // activation: keeping an itinerary counts; the report shows it by source
  await call('tools/call', { name: 'create_itinerary', arguments: { title: 'A day in Lisbon' } });
  const admin = await fetch(B + '/login', form({ email: 'admin@discriminant.ly', password: 'prototype1' }));
  const asid = (admin.headers.get('set-cookie').match(/sid=([^;]+)/) || [])[1];
  h = await (await fetch(B + '/admin/activation', { headers: { cookie: 'sid=' + asid } })).text();
  const row = (h.match(/<tr><td>chatgpt<\/td><td>(\d+)<\/td><td>(\d+)<\/td><td>([^<]+)<\/td>/) || []);
  ok('OS13 the activation report counts a first kept itinerary, by arrival', row[1] === '1' && row[2] === '1' && row[3] === '100%', row.slice(1).join(' | '));
  ok('OS14 the report is admin only', (await fetch(B + '/admin/activation', { headers: { cookie: 'sid=' + sid } })).status === 403);
  // open joining on the web (v2.63)
  h = await (await fetch(B + '/join')).text();
  ok('OS16 the web join form: name, email, password; no invite code', /Create your account/.test(h) && /name="email"/.test(h) && !/name="code"/.test(h) && !/by invitation/i.test(h));
  h = await (await fetch(B + '/login')).text();
  ok('OS17 sign-in always offers an account', /New to discriminant\.ly\? <a href="\/join">Create an account<\/a>/.test(h) && !/invite code/i.test(h));
  const link = 'OLDLINK1'; db.prepare('INSERT INTO invites(code, from_user) VALUES(?, 1)').run(link);
  h = await (await fetch(B + '/join?code=' + link)).text();
  r = await fetch(B + '/join', form({ name: 'Linked Friend', email: 'friend@example.com', password: 'correcthorse', code: link }));
  const fr = db.prepare("SELECT id, signup_source FROM users WHERE email='friend@example.com'").get();
  ok('OS18 an old invite link still works and is credited', /name="code" value="OLDLINK1"/.test(h) && r.headers.get('location') === '/' && fr.signup_source === 'invite' && db.prepare('SELECT used_by FROM invites WHERE code=?').get(link).used_by === fr.id);
  h = await (await fetch(B + '/settings', { headers: { cookie: 'sid=' + asid } })).text();
  ok('OS19 Settings no longer offers invites; /invites goes to Settings', !/Bring someone in|Create an invite/.test(h) && (await fetch(B + '/invites', { headers: { cookie: 'sid=' + asid }, redirect: 'manual' })).headers.get('location') === '/settings');
  let blocked = false; for (let i = 0; i < 6; i++) { r = await fetch(B + '/join', form({ name: 'Spam ' + i, email: `spam${i}@example.com`, password: 'correcthorse', next })); if (r.status !== 303) { blocked = /Too many new accounts/.test(await r.text()); break; } }
  ok('OS15 more than five new accounts in an hour from one network are refused', blocked);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('error:', e.message); process.exit(2); });
