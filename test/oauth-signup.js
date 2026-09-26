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
  let r = await fetch(B + auth, { redirect: 'manual' }); let r2; const loginAt = r.headers.get('location') || '';
  ok('OS1 not signed in, the authorization sends to sign-in with a return address', r.status === 303 && loginAt.startsWith('/login?next=%2Foauth%2Fauthorize'));
  r = await fetch(B + loginAt); let h = await r.text();
  ok('OS2 sign-in carries the return address and offers an account', /name="next" value="\/oauth\/authorize\?/.test(h) && /Create an account/.test(h) && !/Have an invite code/.test(h));
  const joinAt = (h.match(/href="(\/join\?next=[^"]+)"/) || [])[1].replace(/&amp;/g, '&');
  r = await fetch(B + joinAt); h = await r.text();
  ok('OS3 the account form asks for name, email and password; no invite', /Create your account/.test(h) && !/name="code"/.test(h) && !/name="handle"/.test(h));
  const next = (h.match(/name="next" value="([^"]+)"/) || [])[1].replace(/&amp;/g, '&');
  r = await fetch(B + '/join', form({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correcthorse', terms: '1', next }));
  const sid = ((r.headers.get('set-cookie') || '').match(/sid=([^;]+)/) || [])[1];
  ok('OS4 creating the account signs in and returns to the authorization', r.status === 303 && (r.headers.get('location') || '').startsWith('/oauth/authorize?') && !!sid);
  r = await fetch(B + r.headers.get('location'), { headers: { cookie: 'sid=' + sid }, redirect: 'manual' }); h = await r.text();
  ok('OS5 back on the authorization, signed in: the approve step shows', r.status === 200 && /ChatGPT/.test(h) && /Authori[sz]e/.test(h));
  r = await fetch(B + '/oauth/authorize', form({ client_id: CID, redirect_uri: RURI, code_challenge: ch, code_challenge_method: 'S256', state: 'st', resource: B + '/mcp', approve: '1' }, 'sid=' + sid));
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  const t = await (await fetch(B + '/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: RURI, client_id: CID, code_verifier: ver, resource: B + '/mcp' }))).json();
  const call = async (method, params) => (await (await fetch(B + '/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + t.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
  ok('OS6 approve, code, token: the new member reaches the tools', (await call('tools/list', {})).tools.length > 60);
  const u = db.prepare("SELECT id, handle, signup_source FROM users WHERE email='ada@example.com'").get();
  ok('OS7 recorded as arriving from ChatGPT, with a generated handle', u.signup_source === 'chatgpt' && u.handle === 'adalovelace', JSON.stringify(u));
  r = await fetch(B + '/login', form({ email: 'ada@example.com', password: 'correcthorse', terms: '1', next }));
  ok('OS8 an existing member signing in returns to the authorization (reviewers sign in this way)', (r.headers.get('location') || '').startsWith('/oauth/authorize?'));
  r = await fetch(B + '/login', form({ email: 'ada@example.com', password: 'correcthorse' }));
  ok('OS9 an ordinary sign-in still goes home', r.headers.get('location') === '/');
  r = await fetch(B + '/login?next=' + encodeURIComponent('https://evil.example/')); h = await r.text();
  ok('OS10 a foreign return address is ignored', !/evil\.example/.test(h));
  r = await fetch(B + '/join', form({ name: 'x', email: 'x@example.com', password: 'correcthorse', terms: '1', next: 'https://evil.example/' }));
  ok('OS11 joining is open, and a foreign return address still cannot redirect: the new member goes home', r.status === 303 && r.headers.get('location') === '/');
  r = await fetch(B + '/join', form({ name: 'Ada Two', email: 'ada@example.com', password: 'correcthorse', terms: '1', next })); h = await r.text();
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
  r = await fetch(B + '/join', form({ name: 'Linked Friend', email: 'friend@example.com', password: 'correcthorse', terms: '1', code: link }));
  const fr = db.prepare("SELECT id, signup_source FROM users WHERE email='friend@example.com'").get();
  ok('OS18 an old invite link still works and is credited', /name="code" value="OLDLINK1"/.test(h) && r.headers.get('location') === '/' && fr.signup_source === 'invite' && db.prepare('SELECT used_by FROM invites WHERE code=?').get(link).used_by === fr.id);
  h = await (await fetch(B + '/settings', { headers: { cookie: 'sid=' + asid } })).text();
  ok('OS19 Settings no longer offers invites; /invites goes to Settings', !/Bring someone in|Create an invite/.test(h) && (await fetch(B + '/invites', { headers: { cookie: 'sid=' + asid }, redirect: 'manual' })).headers.get('location') === '/settings');
  // ---- v2.65 activation ----------------------------------------------------
  const jar = {}; const cookieOf = (r) => { for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const [kv] = c.split(';'); const [k, v] = kv.split('='); jar[k] = v; } return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); };
  // terms
  r = await fetch(B + '/join', form({ name: 'No Terms', email: 'noterms@example.com', password: 'correcthorse' }));
  h = await r.text();
  ok('AT1 an account needs the Terms and Privacy agreement', /Please agree to the Terms and Privacy policy/.test(h) && !db.prepare("SELECT 1 FROM users WHERE email='noterms@example.com'").get());
  const ada = db.prepare("SELECT terms_accepted_at, terms_version FROM users WHERE email='ada@example.com'").get();
  ok('AT2 acceptance is recorded with a timestamp and the policy versions', !!ada.terms_accepted_at && /^terms:.+\|privacy:.+$/.test(ada.terms_version), JSON.stringify(ada));
  h = await (await fetch(B + joinAt)).text();
  ok('AT3 the OAuth sign-up form carries the terms box and the return address together', /name="terms"/.test(h) && /name="next" value="\/oauth\/authorize\?/.test(h));
  // attribution: hostile source values are sanitised and bounded; the AI client host is recorded
  r = await fetch(B + '/join?utm_source=News%20Letter!&utm_campaign=%3Cscript%3Ealert(1)%3C%2Fscript%3E' + 'x'.repeat(300) + '&ref=friend_42', { redirect: 'manual' });
  const ck = cookieOf(r);
  r = await fetch(B + '/join', { ...form({ name: 'From Campaign', email: 'campaign@example.com', password: 'correcthorse', terms: '1' }), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ck } });
  const cu = db.prepare("SELECT u.signup_source, c.* FROM users u JOIN signup_context c ON c.user_id=u.id WHERE u.email='campaign@example.com'").get();
  ok('AA1 campaign context is kept, sanitised and bounded', cu && cu.signup_source === 'web' && cu.utm_source === 'newsletter' && /^scriptalert1script/.test(cu.utm_campaign) && cu.utm_campaign.length <= 48 && cu.ref === 'friend_42', JSON.stringify(cu));
  const oc = db.prepare("SELECT client_host FROM signup_context c JOIN users u ON u.id=c.user_id WHERE u.email='ada@example.com'").get();
  ok('AA2 the AI client is recorded by the host of its metadata document', oc && oc.client_host === 'chatgpt.com', JSON.stringify(oc));
  // events: recorded, sanitised, deduplicated; no prompt text
  const evs = (e) => db.prepare('SELECT * FROM product_events WHERE event=?').all(e);
  ok('AE1 signup_started and signup_completed are recorded', evs('signup_started').length >= 1 && evs('signup_completed').length >= 3);
  const campaign = db.prepare("SELECT id FROM users WHERE email='campaign@example.com'").get().id;
  const csid = (((r.headers.getSetCookie ? r.headers.getSetCookie() : []).find((c) => c.startsWith('sid=')) || '').split(';')[0]);
  await fetch(B + '/', { headers: { cookie: csid } }); await fetch(B + '/', { headers: { cookie: csid } });
  ok('AE2 welcome_viewed once per half hour, not on every refresh', db.prepare("SELECT COUNT(*) n FROM product_events WHERE event='welcome_viewed' AND user_id=?").get(campaign).n === 1);
  const beacon = (body) => fetch(B + '/e', { method: 'POST', headers: { 'content-type': 'application/json', cookie: csid }, body: JSON.stringify(body) });
  await beacon({ event: 'starter_copied', surface: 'welcome', meta: { starter: 'plan', text: 'I am planning a trip to Kyoto with my wife on 12 May' } });
  await beacon({ event: 'signup_completed', surface: 'x', meta: {} });
  await beacon({ event: 'drop_table', meta: {} });
  const sc2 = db.prepare("SELECT * FROM product_events WHERE event='starter_copied' AND user_id=?").get(campaign);
  ok('AE3 a client event is kept, with values sanitised (no spaces, bounded)', sc2 && JSON.parse(sc2.meta).starter === 'plan' && JSON.parse(sc2.meta).text.length <= 64 && !/ /.test(sc2.meta), sc2 && sc2.meta);
  ok('AE4 clients cannot record server events or unknown types', db.prepare("SELECT COUNT(*) n FROM product_events WHERE user_id=? AND event IN ('signup_completed') AND surface='x'").get(campaign).n === 0 && !db.prepare("SELECT 1 FROM product_events WHERE event='drop_table'").get());
  // starters and empty states, by connection state
  h = await (await fetch(B + '/', { headers: { cookie: csid } })).text();
  ok('AS1 unconnected: four starters, each with Copy and Connect first; no launch link', (h.match(/class="wl-prompt wl-starter[^"]*" data-starter="/g) || []).length === 4 && /data-wl-pick="plan"/.test(h) && !/claude:\/\/claude\.ai\/new/.test(h));
  db.prepare("INSERT INTO connections(uid,user_id,token_hash,client_name,client_label) VALUES('c1',?,'h1','Claude','Claude')").run(campaign);
  h = await (await fetch(B + '/', { headers: { cookie: csid } })).text();
  ok('AS2 Claude connected: Copy plus Open in Claude Desktop (the documented claude:// link), no Connect first', /href="claude:\/\/claude\.ai\/new\?q=I%E2%80%99m%20planning/.test(h) && !/data-wl-pick=/.test(h));
  db.prepare("UPDATE connections SET client_name='ChatGPT', client_label='ChatGPT' WHERE uid='c1'").run();
  h = await (await fetch(B + '/', { headers: { cookie: csid } })).text();
  ok('AS3 ChatGPT connected: Copy only (no documented launch link)', /data-wl-copy="/.test(h) && !/claude:\/\//.test(h) && !/data-wl-pick=/.test(h));
  h = await (await fetch(B + '/t', { headers: { cookie: csid } })).text();
  ok('AE5 empty Itineraries: plan with your AI, or start a plan here', /Plan a trip, a day, or an afternoon\./.test(h) && /href="\/t\?new=1#itin-create"/.test(h) && /data-wl-copy="I\u2019m planning/.test(h));
  h = await (await fetch(B + '/u/fromcampaign?tab=marks', { headers: { cookie: csid } })).text();
  ok('AE6 empty Marks: add a place, or ask your AI', /Keep a place worth returning to\./.test(h) && /href="\/marks\/new"/.test(h) && /There\u2019s a place I want to remember/.test(h));
  h = await (await fetch(B + '/t?new=1', { headers: { cookie: csid } })).text();
  ok('AE7 Start a plan here opens the create form', /<details class="itin-create" id="itin-create" open>/.test(h));
  // login throttle
  for (let i = 0; i < 8; i++) await fetch(B + '/login', form({ email: 'ada@example.com', password: 'wrong' + i }));
  h = await (await fetch(B + '/login', form({ email: 'ada@example.com', password: 'correcthorse' }))).text();
  ok('AL1 eight failures in 15 minutes pause sign-in for that email, even with the right password', /Too many sign-in attempts/.test(h));
  for (let i = 0; i < 8; i++) await fetch(B + '/login', form({ email: 'nobody@example.com', password: 'x' }));
  h = await (await fetch(B + '/login', form({ email: 'nobody@example.com', password: 'x' }))).text();
  ok('AL2 the same message for an address with no account (no enumeration)', /Too many sign-in attempts/.test(h));
  for (let i = 0; i < 3; i++) await fetch(B + '/login', form({ email: 'friend@example.com', password: 'wrong' }));
  r = await fetch(B + '/login', form({ email: 'friend@example.com', password: 'correcthorse' }));
  ok('AL3 a few mistakes then the right password still signs in', r.headers.get('location') === '/');
  // research flag and invites
  r = await fetch(B + '/admin/activation/flag', form({ user_id: String(campaign), flag: 'founder_assisted' }, 'sid=' + asid));
  r2 = await fetch(B + '/admin/activation/flag', form({ user_id: String(campaign), flag: 'test' }, csid));
  ok('AF1 only the admin can set the research flag; it is validated', db.prepare('SELECT research_flag f FROM users WHERE id=?').get(campaign).f === 'founder_assisted' && r2.status === 403);
  h = await (await fetch(B + '/admin/activation', { headers: { cookie: 'sid=' + asid } })).text();
  ok('AF2 the report separates founder-assisted accounts and shows the AI client and events', /web \u00b7 founder-assisted/.test(h) && /chatgpt\.com/.test(h) && /starter_copied/.test(h));
  ok('AI1 members can no longer create invite codes', (await fetch(B + '/invites', form({}, csid))).status === 403);
  let blocked = false; for (let i = 0; i < 6; i++) { r = await fetch(B + '/join', form({ name: 'Spam ' + i, email: `spam${i}@example.com`, password: 'correcthorse', terms: '1', next })); if (r.status !== 303) { blocked = /Too many new accounts/.test(await r.text()); break; } }
  ok('OS15 more than five new accounts in an hour from one network are refused', blocked);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('error:', e.message); process.exit(2); });
