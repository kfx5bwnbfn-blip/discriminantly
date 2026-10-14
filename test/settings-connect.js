// Settings carries the Welcome card's "Connect your AI" guide (v2.98).
// Usage: node test/settings-connect.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'setconn-')), DB = path.join(DIR, 's.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off', CHATGPT_PLUGIN_URL: 'https://chatgpt.com/plugins/example' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = async (p, sid) => (await fetch(BASE + p, { headers: { cookie: 'sid=' + sid } })).text();
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const u = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES('member','Member','m@t.test','x','modern')").run().lastInsertRowid;
  const sid = crypto.randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sid, u);
  let h = await get('/settings', sid);
  const guide = h.includes('id="connect-guide"') ? h.slice(h.indexOf('id="connect-guide"'), h.indexOf('class="conn-list"')) : '';
  ok('settings: the guide sits in the Connect to your AI cell, above the connections', guide.length > 0 && /Connect to your AI/.test(guide));
  ok('settings: all four clients, each with its steps', ['chatgpt', 'claude', 'muse', 'other'].every((k) => new RegExp(`label class="wl-ai" for="wl-ai-${k}-settings" data-ai="${k}"`).test(guide) && new RegExp(`data-for="${k}"`).test(guide)));
  ok('settings: the steps are the current ones (plugin page, custom connector, Muse key, MCP address)', /Discriminantly plugin in ChatGPT/.test(guide) && /Add custom connector/.test(guide) && /Create a connection<\/b>\. Copy the <b>key<\/b>/.test(guide) && /www\.discriminantly\.com\/mcp|localhost:\d+\/mcp/.test(guide));
  ok('settings: the stale "Developer mode / No authentication" instructions are gone', !/Developer mode|No authentication/.test(h));
  ok('settings: the older single URL is tucked under a disclosure, after the named connections', /<details class="share-opt-x conn-legacy">/.test(h) && h.indexOf('conn-legacy') > h.indexOf('class="conn-list"'));
  // Connected state shows on the tile
  db.prepare("INSERT INTO connections(uid, user_id, auth_kind, token_hash, token_prefix, client_name, client_label, scope) VALUES('conn-1', ?, 'oauth', 'x', 'x', 'claude', 'Claude', 'full')").run(u);
  h = await get('/settings', sid);
  ok('settings: a live connection shows as Connected on its tile', /data-ai="claude">[\s\S]*?<span class="wl-ai-state is-on">Connected<\/span>/.test(h));
  // The Welcome card still renders the same guide
  const feed = await get('/?welcome=1', sid);
  ok('feed: the Welcome card still carries the same guide under its Connect step', /class="wl-panel wl-p2"/.test(feed) && /for="wl-ai-chatgpt-\d+"/.test(feed) && /Discriminantly plugin in ChatGPT/.test(feed));
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
