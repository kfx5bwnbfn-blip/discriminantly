// Sign in from the public menu (v2.103): the form, its return path, and failures.
// Usage: node test/menu-signin.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'menusignin-')), DB = path.join(DIR, 'm.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const req = (p, { sid = '', form = null } = {}) => fetch(BASE + p, { method: form ? 'POST' : 'GET', redirect: 'manual', headers: { ...(sid ? { cookie: 'sid=' + sid } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form) : undefined });
const sidOf = (r) => ((r.headers.get('set-cookie') || '').match(/sid=([^;]+)/) || [])[1];
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const admin = db.prepare('SELECT * FROM users WHERE is_admin=1').get();
  const h = await (await req('/how-it-works')).text();
  const form = (h.match(/<form class="pub-menu-signin"[\s\S]*?<\/form>/) || [''])[0];
  ok('signed out: the menu carries a sign-in form posting to /login', /method="post" action="\/login"/.test(form) && /name="email" type="email" autocomplete="email"/.test(form) && /name="password" type="password" autocomplete="current-password"/.test(form));
  ok('the form remembers the page, has no autofocus; Get started sits beside it in the account group', /name="next" value="\/how-it-works"/.test(form) && !/autofocus/.test(form) && /pub-menu-account[\s\S]*href="\/join"[\s\S]*pub-menu-signin/.test(h));
  ok('the form sits inside the menu panel, in the account group above the navigation, and the old Sign in link is gone', h.indexOf('pub-menu-signin') < h.indexOf('pub-menu-label">Learn') && h.indexOf('pub-menu-signin') < h.indexOf('</nav>') && !/pub-menu-util"><a href="\/login"/.test(h));
  ok('the home page form carries no next (sign-in lands on the feed anyway)', !/pub-menu-signin[\s\S]*?name="next"[\s\S]*?<\/form>/.test(await (await req('/')).text()));
  const sid0 = (() => { const t = require('crypto').randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, admin.id); return t; })();
  ok('signed in: no form; the avatar row and Settings instead', !/pub-menu-signin/.test(await (await req('/how-it-works', { sid: sid0 })).text()));

  let r = await req('/login', { form: { email: admin.email, password: 'prototype1', next: '/how-it-works' } });
  ok('sign in from the menu: back to the page they were reading, signed in', r.status === 303 && r.headers.get('location') === '/how-it-works' && !!sidOf(r), r.status + ' ' + r.headers.get('location'));
  for (const bad of ['https://evil.example/x', '//evil.example', '/login', '/oauth/authorize', '/s/abc', '/how-it-works?x=1', '/']) {
    r = await req('/login', { form: { email: admin.email, password: 'prototype1', next: bad } });
    ok(`next=${bad}: ignored, lands on the feed`, r.status === 303 && r.headers.get('location') === '/', r.headers.get('location'));
  }
  r = await req('/login', { form: { email: admin.email, password: 'wrong', next: '/how-it-works' } });
  const page = await r.text();
  ok('a wrong password: the full sign-in page with the error, still remembering the page', r.status === 200 && /do not match/.test(page) && /name="next" value="\/how-it-works"/.test(page));
  r = await req('/login?next=%2Fhow-it-works', { sid: sid0 });
  ok('already signed in, /login?next=<page> goes straight to the page', r.status === 303 && r.headers.get('location') === '/how-it-works');
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
