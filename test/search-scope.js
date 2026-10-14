// Search scope tab (v2.94): "My content" vs "Entire network" above results.
// Usage: node test/search-scope.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'searchscope-')), DB = path.join(DIR, 's.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const get = async (p, sid) => (await fetch(BASE + p, { headers: sid ? { cookie: 'sid=' + sid } : {} })).text();
const groupCount = (h, key) => { const m = new RegExp(`<section class="search-group" data-group="${key}">[\\s\\S]*?<h4 class="itin-day"><b>[^<]*</b><span>(\\d+)</span>`).exec(h); return m ? +m[1] : 0; };

(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const mk = (h) => db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,'x','modern')").run(h, h, h + '@t.test').lastInsertRowid;
  const A = mk('scopea'), Bm = mk('scopeb');
  const sid = (uid) => { const t = require('crypto').randomBytes(12).toString('hex'); db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, uid); return t; };
  const sA = sid(A);
  const note = (uid, name, priv) => { const id = db.prepare("INSERT INTO objects(user_id,name,why,tags,private) VALUES(?,?,?,'zq',?)").run(uid, name, 'zqterm here', priv).lastInsertRowid; const u = db.prepare('SELECT uid FROM objects WHERE id=?').get(id).uid; db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'object',?,'adopted')").run(uid, u); };
  const mark = (uid, name, priv) => { const id = db.prepare("INSERT INTO marks(user_id,name,why,tags,locality,country,private) VALUES(?,?,?,'zq','L','C',?)").run(uid, name, 'zqterm here', priv).lastInsertRowid; const u = db.prepare('SELECT uid FROM marks WHERE id=?').get(id).uid; db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'mark',?,'adopted')").run(uid, u); };
  note(A, 'A public zq note', 0); note(A, 'A private zq note', 1); mark(A, 'A zq place', 0);
  note(Bm, 'B public zq note', 0); note(Bm, 'B private zq note', 1); mark(Bm, 'B zq place', 0);
  db.prepare("UPDATE users SET bio='zqterm in bio' WHERE id=?").run(Bm);

  // Signed in, default scope: Mine
  let h = await get('/?q=zq', sA);
  ok('tab: shown signed in, Mine selected by default, links keep the query', /<nav class="seg search-scope" role="tablist"/.test(h) && /class="seg-btn on" role="tab" aria-selected="true" href="\?q=zq">Mine<\/a>/.test(h) && /class="seg-btn " role="tab" aria-selected="false" href="\?q=zq&amp;scope=others">Everyone else<\/a>/.test(h));
  ok('mine: only the member\u2019s records, private included; no People group', groupCount(h, 'notes') === 2 && groupCount(h, 'marks') === 1 && /A private zq note/.test(h) && !/B public zq note/.test(h) && !/data-group="people"/.test(h));
  ok('tab: uses the post form\u2019s token classes (.seg / .seg-btn)', /class="seg search-scope"/.test(h) && (h.match(/class="seg-btn/g) || []).length >= 2);

  // Everyone else
  h = await get('/?q=zq&scope=others', sA);
  ok('others: Everyone else selected; only other members\u2019 public records, plus People', /aria-selected="true" href="\?q=zq&amp;scope=others">Everyone else/.test(h) && groupCount(h, 'notes') === 1 && groupCount(h, 'marks') === 1 && groupCount(h, 'people') === 1 && /B public zq note/.test(h) && !/B private zq note/.test(h));
  ok('others: none of the member\u2019s own records appear', !/A public zq note|A private zq note|A zq place/.test(h));
  ok('mine: nothing of another member\u2019s leaks', !/scopeb/.test((await get('/?q=zq', sA)).replace(/<nav class="seg search-scope"[\s\S]*?<\/nav>/, '')));
  ok('empty states name the scope', /Nothing of yours matches\./.test(await get('/?q=nothingmatchesthis', sA)) && /Nothing from everyone else matches\./.test(await get('/?q=nothingmatchesthis&scope=others', sA)));

  // Paging stays within a scope; switching scope drops the paging
  h = await get('/?q=zq&scope=others&g_notes=30', sA);
  ok('switching scope drops per-group paging; the other tab keeps the query only', /href="\?q=zq">Mine/.test(h) && /href="\?q=zq&amp;scope=others">Everyone else/.test(h));
  ok('tag and feed parameters are carried across the tab', /href="\?q=zq&amp;t=zq&amp;scope=others">Everyone else/.test(await get('/?q=zq&t=zq', sA)));

  // Signed out: no tab, scope ignored
  h = await get('/activity?q=zq');
  ok('signed out: no tab; the public search is unchanged', !/search-scope/.test(h) && groupCount(h, 'notes') === 2 && !/private zq note/.test(h));
  h = await get('/activity?q=zq&scope=others');
  ok('signed out: scope=others is ignored, never a 500', !/search-scope/.test(h) && groupCount(h, 'notes') === 2);

  // The plain feed is untouched
  h = await get('/', sA);
  ok('no search: no tab on the feed', !/search-scope/.test(h));

  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
