// The menu in the signed-in search bar (v2.106): mark, field, menu; contents by state.
// Usage: node test/app-menu.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'appmenu-')), DB = path.join(DIR, 'a.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', PUBLISHER_NAME: 'Test operator', SUPPORT_EMAIL: 'support@example.com' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = (p, sid = '') => fetch(BASE + p, { redirect: 'manual', headers: sid ? { cookie: 'sid=' + sid } : {} }).then((r) => r.text());
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const mk = (h) => { const id = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,'x','modern')").run(h, h, h + '@t.test').lastInsertRowid; const t = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, id); return { id, sid: t }; };
  const fresh = mk('fresh'), conn = mk('conn');
  db.prepare("INSERT INTO connections(uid,user_id,token_hash,client_name,client_label) VALUES('c1',?,'h','Claude','Claude')").run(conn.id);
  const bar = (h) => (h.match(/<div class="searchbar" id="searchbar">[\s\S]*?<\/details>/) || [''])[0];
  let h = await get('/', fresh.sid); let b = bar(h);
  ok('signed in: the search bar is mark, field, menu', /class="sb-mark" href="\/"/.test(b) && b.indexOf('sb-mark') < b.indexOf('searchinput') && b.indexOf('searchinput') < b.indexOf('<details class="pub-menu app-menu"'));
  ok('one menu script, the public one, runs the panel', (h.match(/getElementById\('pub-menu'\)/g) || []).length === 1);
  ok('the avatar row goes to the profile', /class="pub-menu-me" href="\/u\/fresh"/.test(b) && /Your profile/.test(b));
  ok('You is the profile rail\u2019s own chips with counts: All activity and Warrants, then Places (Marks, Itineraries), Things (Notes, Ensembles), People (Followers, Following)', /<div class="pgrp-nav app-pgrp">/.test(b) && ['/u/fresh', '/u/fresh?tab=warrants', '/u/fresh?tab=marks', '/t', '/u/fresh?tab=notes', '/u/fresh?tab=ensembles', '/u/fresh?tab=followers', '/u/fresh?tab=following'].every((x) => b.includes(`href="${x}"`)) && ['Places', 'Things', 'People'].every((g) => b.includes(`<p class="pgrp-label">${g}</p>`)) && /<a class="wcell" href="\/u\/fresh\?tab=notes"><b>0<\/b><span>Notes<\/span>/.test(b) && !/tab=collections|tab=checkins|>Plans</.test(b));
  ok('nothing connected: Your AI leads, above Learn, with Connect your AI and every assistant pointing at the connect guide', b.indexOf('Your AI') < b.indexOf('Learn') && /pub-menu-lead" href="\/settings#connect-guide">Connect your AI/.test(b) && (b.match(/href="\/settings#connect-guide"><span class="wl-ai-logo/g) || []).length === 4);
  ok('Learn and Help carry the public pages; Settings and Sign out close it', ['/how-it-works', '/ai', '/guides', '/support', '/privacy', '/terms', '/settings'].every((x) => b.includes(`href="${x}"`)) && /action="\/logout"/.test(b));
  ok('no sign-in form, no Get started, no Public activity', !/pub-menu-signin/.test(b) && !/Get started/.test(b) && !/Public activity/.test(b));
  h = await get('/t', conn.sid); b = bar(h);
  ok('Claude connected: no lead row; Your AI after Learn; Claude marked connected and pointing at Connections; others at the guide', !/Connect your AI/.test(b) && b.indexOf('Learn') < b.indexOf('Your AI') && /is-connected" href="\/settings\/connections"><span class="wl-ai-logo"[^]*?Claude/.test(b) && /pub-menu-ok/.test(b) && (b.match(/href="\/settings#connect-guide"/g) || []).length === 3);
  ok('the current page is marked (a chip: .on; a row: aria-current)', /class="wcell on" href="\/t"/.test(b) && /href="\/support"/.test(b) && /aria-current="page"/.test(bar(await get('/support', conn.sid))));
  h = await get('/about', conn.sid);
  ok('public pages, signed in: one menu, in the search bar; the public header keeps the brand and Open Discriminantly', !/<details class="pub-menu" id="pub-menu">/.test(h) && /pub-menu app-menu/.test(h) && (h.match(/id="pub-menu"/g) || []).length === 1 && /Open Discriminantly/.test(h));
  ok('signed out: no search bar, the public menu only', !/sb-mark/.test(await get('/about')) && !/app-menu/.test(await get('/')));
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
