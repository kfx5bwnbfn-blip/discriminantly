// Join-form guard and the 13 Oct bot-account cleanup (v2.93).
// Usage: node test/join-guard.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'joinguard-')), DB = path.join(DIR, 'j.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const ENV = { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com' };
let pass = 0, fail = 0, srv = null, log = '';
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = async () => { log = ''; srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; }); for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); return; } catch { await sleep(100); } } };
const stop = async () => { srv.kill(); await new Promise((r) => srv.on('exit', r)); };
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o), redirect: 'manual' });
const token = async () => ((await (await fetch(BASE + '/join')).text()).match(/data-ft="([^"]+)"/) || [])[1];
const users = (db, email) => db.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get(email).n;

(async () => {
  // 1. Fresh database; plant the bot accounts as they were left on 13 Oct.
  await start(); await stop();
  let db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  db.exec("DELETE FROM schema_migrations WHERE id='066-remove-bot-signups-2026-10-13'");
  const adminCount = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const add = (h, at, src = 'web', admin = 0) => db.prepare("INSERT INTO users(handle,name,email,pass,signup_source,is_admin,created_at) VALUES(?,?,?,?,?,?,?)").run(h, h, h + '@bot.test', 'x', src, admin, at).lastInsertRowid;
  const a = add('vgvjkuoqlo', '2026-10-13 14:28:31');
  const b = add('erzyjeifnu', '2026-10-13 14:29:06');
  db.prepare("INSERT INTO sessions(token,user_id) VALUES('bot-session',?)").run(a);
  // b now holds a record, so the cleanup must keep it (the guard against removing a real member)
  db.prepare("INSERT INTO objects(user_id,name,why,private) VALUES(?,'A real note','kept',1)").run(b);
  db.close();

  // 2. Start: the one-off cleanup runs.
  await start(); db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  ok('cleanup: the empty bot account is removed, with its session', !db.prepare("SELECT 1 FROM users WHERE handle='vgvjkuoqlo'").get() && !db.prepare("SELECT 1 FROM sessions WHERE token='bot-session'").get());
  ok('cleanup: an account that holds a record is kept', !!db.prepare("SELECT 1 FROM users WHERE handle='erzyjeifnu'").get() && /kept @erzyjeifnu: it holds records/.test(log));
  ok('cleanup: recorded once, with a backup taken first', !!db.prepare("SELECT 1 FROM schema_migrations WHERE id='066-remove-bot-signups-2026-10-13'").get() && /Backed up to .*pre-066-remove-bot-signups/.test(log) && /1 account\(s\) removed/.test(log));
  ok('cleanup: the admin account is untouched', db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin=1').get().n === 1 && db.prepare("SELECT COUNT(*) n FROM users WHERE email NOT LIKE '%@bot.test'").get().n === adminCount);
  await stop();
  db.close(); db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  // A second start does nothing, even if a matching account reappears.
  add('vgvjkuoqlo', '2026-10-13 14:28:31'); db.close();
  await start(); db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  ok('cleanup: runs only once', !!db.prepare("SELECT 1 FROM users WHERE handle='vgvjkuoqlo'").get() && !/\[cleanup\]/.test(log));

  // 3. The guard.
  const page = await (await fetch(BASE + '/join')).text();
  ok('form: carries a token and a decoy field out of the tab order', /id="join-form" data-ft="\d{13}\.[A-Za-z0-9_-]{32}"/.test(page) && /<input name="website" tabindex="-1" autocomplete="off">/.test(page) && /<input type="hidden" name="ft" value="">/.test(page) && /<noscript>/.test(page));
  const base = (e) => ({ name: 'Real Person', email: e, password: 'correcthorse', terms: '1' });
  let r = await fetch(BASE + '/join', form(base('nojs@example.com')));
  ok('guard: a post without the token (a script that never ran the page) is refused', r.status === 200 && /We couldn’t confirm that form/.test(await r.text()) && users(db, 'nojs@example.com') === 0);
  let t = await token(); r = await fetch(BASE + '/join', form({ ...base('fast@example.com'), ft: t }));
  ok('guard: a token used within two seconds is refused', r.status === 200 && users(db, 'fast@example.com') === 0);
  t = await token(); await sleep(2100); r = await fetch(BASE + '/join', form({ ...base('decoy@example.com'), ft: t, website: 'http://spam.example' }));
  ok('guard: a filled decoy field is refused', r.status === 200 && users(db, 'decoy@example.com') === 0);
  const forged = String(Date.now() - 5000) + '.' + 'A'.repeat(32);
  r = await fetch(BASE + '/join', form({ ...base('forged@example.com'), ft: forged }));
  ok('guard: a forged token is refused', r.status === 200 && users(db, 'forged@example.com') === 0);
  const stale = String(Date.now() - 7 * 3600e3) + '.x'; r = await fetch(BASE + '/join', form({ ...base('stale@example.com'), ft: stale }));
  ok('guard: a malformed or stale token is refused', r.status === 200 && users(db, 'stale@example.com') === 0);
  t = await token(); await sleep(2100); r = await fetch(BASE + '/join', form({ ...base('person@example.com'), ft: t }));
  ok('guard: a valid token after two seconds creates the account', r.status === 303 && users(db, 'person@example.com') === 1);
  ok('guard: refusals keep what was typed and offer a fresh token', /value="Real Person"/.test(await (await fetch(BASE + '/join', form(base('again@example.com')))).text()));

  // 4. A real browser: the person sees nothing different.
  const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  const br = await chromium.launch(); const pg = await (await br.newContext()).newPage();
  await pg.route(/typekit|googleapis|gstatic/, (x) => x.abort());
  await pg.goto(BASE + '/join');
  const decoy = await pg.$eval('.hp-field', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, w: r.width }; });
  ok('browser: the decoy field is off-screen', decoy.left < -5000 && decoy.w <= 1);
  await pg.fill('#join-form input[name="name"]', 'Browser Person'); await pg.fill('#join-form input[name="email"]', 'browser@example.com'); await pg.fill('#join-form input[name="password"]', 'correcthorse');
  await pg.check('#join-form input[name="terms"]');
  const order = []; await pg.focus('#join-form input[name="name"]'); for (let i = 0; i < 4; i++) { await pg.keyboard.press('Tab'); order.push(await pg.evaluate(() => document.activeElement.name || document.activeElement.tagName)); }
  ok('browser: tabbing never lands on the decoy field', !order.includes('website'), order.join(','));
  await sleep(2100);
  await Promise.all([pg.waitForURL((u) => !/\/join/.test(u.pathname), { waitUntil: 'commit' }), pg.click('form#join-form button')]);
  ok('browser: a person filling the form normally gets an account', users(db, 'browser@example.com') === 1 && !/\/join/.test(new URL(pg.url()).pathname));
  await br.close();

  await stop(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); try { srv.kill(); } catch {} process.exit(1); });
