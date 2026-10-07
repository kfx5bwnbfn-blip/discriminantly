// P0 activation (v2.68): the activation model, the semantic-yield receipt, the
// state-aware Welcome, time to first value and prior-evidence reuse.
// Self-contained: starts its own server on a fresh database, drives it the way
// an AI client and a member do, and moves timestamps back to stand in for
// time passing between working sessions.
//
//   node test/activation.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 80), BASE = `http://localhost:${PORT}`;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'act-')), DB_PATH = path.join(DIR, 'db.sqlite');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + x : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH, SEED: '1', ADMIN_PASSWORD: 'prototype1', PUBLIC_ORIGIN: BASE, IMAGE_STORE: 'db' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
const up = async () => { for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('server did not start\n' + log); };

(async () => {
  await up();
  const db = new DatabaseSync(DB_PATH); db.exec('PRAGMA foreign_keys=ON'); db.exec('PRAGMA busy_timeout=5000');
  const one = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
  // ---- helpers ----------------------------------------------------------
  const member = (handle, { source = 'web', client = null, flag = '' } = {}) => {
    const id = run("INSERT INTO users(handle,name,email,pass,ui_skin,signup_source,research_flag) VALUES(?,?,?,'x','modern',?,?)", handle, handle, handle + '@t.test', source, flag).lastInsertRowid;
    const sid = crypto.randomBytes(12).toString('hex'); run('INSERT INTO sessions(token,user_id) VALUES(?,?)', sid, id);
    let tok = null;
    if (client) {
      tok = crypto.randomBytes(16).toString('hex');
      run("INSERT INTO connections(uid,user_id,auth_kind,token_hash,token_prefix,client_name,client_label) VALUES(?,?,'bearer',?,?,?,?)",
        crypto.randomUUID(), id, crypto.createHash('sha256').update(tok).digest('hex'), tok.slice(0, 6), client, client);
    }
    return { id, sid, tok, handle };
  };
  const rpc = async (T, name, args) => (await (await fetch(`${BASE}/mcp/${T}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
  const call = async (T, name, args) => { const r = await rpc(T, name, args); if (!r || r.isError) throw new Error(name + ': ' + (r ? r.content[0].text : 'no result')); return r.structuredContent; };
  const home = async (u, qs = '') => (await fetch(BASE + '/' + qs, { headers: u ? { cookie: 'sid=' + u.sid } : {} })).text();
  const get = async (u, p) => fetch(BASE + p, { headers: u ? { cookie: 'sid=' + u.sid } : {}, redirect: 'manual' });
  // Move everything a member did back in time, standing in for days passing.
  const shift = (u, by) => {
    for (const [t, w] of [['provenance', 'actor_user_id=?'], ['adoptions', 'user_id=?'], ['objects', 'user_id=?'], ['marks', 'user_id=?'], ['itineraries', 'user_id=?'],
      ['itinerary_stop_notes', 'user_id=?'], ['recommendations', 'user_id=?'], ['visits', 'user_id=?'], ['connections', 'user_id=?'], ['product_events', 'user_id=?'],
      ['ownership_assertions', 'user_id=?']]) run(`UPDATE ${t} SET created_at=datetime(created_at, ?) WHERE ${w}`, by, u.id);
    run('UPDATE itinerary_stops SET created_at=datetime(created_at, ?) WHERE itinerary_id IN (SELECT id FROM itineraries WHERE user_id=?)', by, u.id);
    run('UPDATE itinerary_groups SET created_at=datetime(created_at, ?) WHERE itinerary_id IN (SELECT id FROM itineraries WHERE user_id=?)', by, u.id);
    run('UPDATE users SET created_at=datetime(created_at, ?) WHERE id=?', by, u.id);
  };
  const admin = { id: 1, sid: crypto.randomBytes(12).toString('hex') }; run('INSERT INTO sessions(token,user_id) VALUES(?,?)', admin.sid, 1);
  const prof = async (u) => { const h = await (await get(admin, `/admin/members/${u.handle}`)).text(); return h.slice(h.indexOf('Activation</p>'), h.indexOf('Experience events') + 80); };
  const rx = (h) => { const i = h.indexOf('class="resurface receipt"'); return i < 0 ? '' : h.slice(i, h.indexOf('</aside>', i)); };
  const welcome = (h) => { const i = h.indexOf('class="card welcome-card'); return i < 0 ? '' : h.slice(i, h.indexOf('</article>', i)); };
  const reuseOf = (uid) => all("SELECT 1 FROM itinerary_stops WHERE mark_uid=?", uid).length;

  // ---- Welcome states, zero corpus -------------------------------------
  console.log('Welcome states');
  const fresh = member('fresh');
  let h = await home(fresh); let w = welcome(h);
  ok('W1 brand-new web member: the full Welcome, opening on Orientation', /welcome-card"/.test(h) && /id="wl-s1" class="wl-radio" checked/.test(w));
  ok('W2 full Welcome offers the app without an AI (note, place, plan)', /Or add one yourself/.test(w) && /href="\/new"/.test(w) && /href="\/marks\/new"/.test(w) && /href="\/t"/.test(w));
  ok('W3 no receipt for a member with no AI activity', !rx(h));
  const conn = member('conn', { source: 'chatgpt', client: 'ChatGPT' });
  w = welcome(await home(conn));
  ok('W4 ChatGPT-originating, connected, nothing kept: full card opens on Get started', /id="wl-s3" class="wl-radio" checked/.test(w) && /Start with something real\./.test(w));
  ok('W5 ...and is not told to install ChatGPT again', !/Install plugin/.test(w) && /Connected/.test(w));
  const cl = member('claudeu', { source: 'claude', client: 'Claude' });
  w = welcome(await home(cl));
  ok('W6 Claude-originating: Get started first (not ChatGPT setup), with Claude Desktop, Claude shown connected', /id="wl-s3" class="wl-radio" checked/.test(w) && /Open in Claude Desktop/.test(w) && /class="wl-ai is-on"[^>]*data-ai="claude"/.test(w) && !/class="wl-ai is-on"[^>]*data-ai="chatgpt"/.test(w));

  // ---- First value, receipt, AI attribution ----------------------------
  console.log('First value and the receipt');
  const m1 = member('markone', { source: 'chatgpt', client: 'ChatGPT' });
  const mk1 = await call(m1.tok, 'add_travel_mark', { place: 'Bar Uno', locality: 'Lisbon', country: 'Portugal' });
  h = await home(m1); let r = rx(h);
  ok('R1 an AI keeps a place: a receipt, attributed to ChatGPT, dated', /Added through ChatGPT/.test(r) && /1 place kept/.test(r) && /class="fact">(just now|\d+m ago)</.test(r), r.slice(0, 300));
  ok('R2 the receipt links the record and promises reuse', r.includes(`/m/${mk1.id}`) && /Next time you plan, your AI can start from what you’ve kept\./.test(r));
  ok('R3 the receipt is private to its member', /Only you see this\./.test(r) && !rx(await home(conn)).includes('Bar Uno') && !rx(await home(null)));
  w = welcome(h);
  ok('W7 first value: the full Welcome gives way to a compact card ("That’s kept.")', /welcome-compact/.test(w) && /That’s kept\./.test(w) && !/wl-tabs/.test(w));
  ok('R4 a refresh shows the same receipt', rx(await home(m1)) === r);
  const ev = all("SELECT meta FROM product_events WHERE user_id=? AND event='receipt_viewed'", m1.id);
  ok('R5 the receipt is recorded once (no event per render), with no content in it', ev.length === 1 && /^\{"session":"\d+"\}$/.test(ev[0].meta), JSON.stringify(ev));
  const n1 = member('noteone', { source: 'claude', client: 'Claude' });
  const img = (await call(n1.tok, 'upload_image', { image: PNG })).ref;
  await call(n1.tok, 'note_object', { headline: 'A good pen', image: img });
  r = rx(await home(n1));
  ok('R6 Claude-created records are attributed to Claude', /Added through Claude/.test(r) && /1 thing kept/.test(r));
  const web = member('webonly');
  const fd = new URLSearchParams({ name: 'Corner cafe', locality: 'Toronto', country: 'Canada' });
  await fetch(BASE + '/marks/new', { method: 'POST', headers: { cookie: 'sid=' + web.sid, 'content-type': 'application/x-www-form-urlencoded' }, body: fd, redirect: 'manual' });
  h = await home(web);
  ok('R7 direct-web records count as first value but make no AI receipt', !!one("SELECT 1 FROM adopted_marks WHERE user_id=?", web.id) && !rx(h) && /welcome-compact/.test(welcome(h)));

  // ---- A substantive plan, a tiny edit, the window ---------------------
  console.log('A plan, a tiny edit, and time passing');
  const pl = member('planner', { source: 'chatgpt', client: 'ChatGPT' });
  run("INSERT INTO product_events(user_id,event,surface,meta) VALUES(?,'starter_copied','welcome','{\"starter\":\"plan\"}')", pl.id);
  const loose = await call(pl.tok, 'add_travel_mark', { place: 'Loose place', locality: 'Lisbon', country: 'Portugal' });
  const it1 = await call(pl.tok, 'create_itinerary', { title: 'Lisbon — one day' });
  await call(pl.tok, 'add_itinerary_stops', { itinerary_uid: it1.uid, stops: [
    { label: 'Breakfast', new_place: { name: 'Pastelaria A', locality: 'Lisbon', country: 'Portugal' } },
    { label: 'Museum', new_place: { name: 'Museu B', locality: 'Lisbon', country: 'Portugal' } },
    { label: 'Dinner', new_place: { name: 'Tasca C', locality: 'Lisbon', country: 'Portugal' } },
    { label: 'some chilli crab' }] });
  r = rx(await home(pl));
  ok('Y1 a new plan with new places: plan title, 1 plan kept, 4 places kept (3 from the plan + 1 alone)', /Lisbon — one day/.test(r) && /1 plan kept/.test(r) && /4 places kept/.test(r), r.replace(/\s+/g, ' ').slice(0, 500));
  ok('Y2 no reused places claimed for a plan built from new places', !/already kept/.test(r));
  ok('Y3 the receipt opens the plan', /href="\/t\/\d+"[^>]*>View plan/.test(r));
  shift(pl, '-2 days');
  await call(pl.tok, 'edit_travel_mark', { id: loose.id, why: 'Typo fixed' });
  r = rx(await home(pl));
  ok('Y4 a tiny edit later does not make a new receipt; the plan’s receipt stays within 72 hours', /Lisbon — one day/.test(r) && !/updated/.test(r) && !/Just added/.test(r));
  shift(pl, '-2 days');
  h = await home(pl);
  ok('Y5 after 72 hours the receipt is gone, and the edit alone makes none', !rx(h));
  ok('W8 kept but not yet reused, later: compact "Use what you’ve kept."', /Use what you’ve kept\./.test(welcome(h)));

  // ---- Prior-evidence reuse ---------------------------------------------
  console.log('Prior-evidence reuse');
  const before = (await prof(pl));
  await call(pl.tok, 'search_catalogue', { query: 'Lisbon' });
  ok('P1 a search alone is not reuse', /Reuse events<\/span><span>0/.test(await prof(pl)), before);
  const planMark = one("SELECT uid FROM marks WHERE name='Museu B'").uid;
  const freshM = await call(pl.tok, 'add_travel_mark', { place: 'Brand new', locality: 'Porto', country: 'Portugal' });
  const it2 = await call(pl.tok, 'create_itinerary', { title: 'Porto weekend' });
  await call(pl.tok, 'add_itinerary_stops', { itinerary_uid: it2.uid, stops: [{ label: 'The loose one', mark_uid: loose.uid }, { label: 'Museum again', mark_uid: planMark }, { label: 'Same-session place', mark_uid: freshM.uid }] });
  await call(pl.tok, 'add_itinerary_stops', { itinerary_uid: it2.uid, stops: [{ label: 'The loose one, twice', mark_uid: loose.uid }] });
  h = await home(pl); r = rx(h);
  ok('Y6 a later plan using existing places: counted as reused, not new', /2 places you’d already kept, used in this plan/.test(r) && /1 place kept/.test(r), r.replace(/\s+/g, ' ').slice(0, 600));
  ok('W9 prior evidence reused: the introductory Welcome is gone', !welcome(h));
  ok('W10 ...and still available on request (?welcome=1)', /wl-tabs/.test(welcome(await home(pl, '?welcome=1'))));
  let p = await prof(pl);
  ok('P2 earlier place in a new plan: existing_mark_used_in_new_itinerary', /Prior evidence reused|Further reuse|Intention/.test(p) && /A place kept earlier became a stop in a plan|A place already in one plan/.test(p), p);
  const adminAll = await (await get(admin, '/admin/activation?cohort=all')).text();
  ok('P3 the basis table names both bases', /existing_mark_used_in_new_itinerary/.test(adminAll) && /existing_mark_reused_across_plans/.test(adminAll));
  const rowP = (b) => { const i = adminAll.indexOf(b); const t = adminAll.slice(i, adminAll.indexOf('</tr>', i)); return t.match(/<td>(\d+)<\/td><td>(\d+)<\/td>/); };
  ok('P4 a retry (the same place added twice to the plan) counts once', rowP('existing_mark_used_in_new_itinerary') && rowP('existing_mark_used_in_new_itinerary')[1] === '1', JSON.stringify(rowP('existing_mark_used_in_new_itinerary')));
  ok('P5 a place made and used in the same session is not reuse', /Reuse events<\/span><span>2</.test(p), p.slice(-200));
  // intention -> experience
  shift(pl, '-1 days');
  const today = new Date().toISOString().slice(0, 10);
  await call(pl.tok, 'log_visit', { id: one("SELECT id FROM marks WHERE name='Tasca C'").id, visited_on: today, body: 'went' });
  await call(pl.tok, 'log_visit', { id: loose.id, visited_on: '2020-01-01', body: 'long ago' });
  p = await prof(pl);
  ok('X1 a planned place later checked in: intention became experience', /Experience events<\/span><span>1</.test(p), p.slice(p.indexOf('Experience events'), p.indexOf('Experience events')+60));
  const adm2 = await (await get(admin, '/admin/activation?cohort=all')).text();
  ok('X2 ...as planned_mark_checked_in_later; a visit from before the place was kept is not experience', /planned_mark_checked_in_later/.test(adm2) && !/kept_mark_checked_in_later/.test(adm2));
  const mFresh2 = await call(pl.tok, 'add_travel_mark', { place: 'Visited at once', locality: 'Porto', country: 'Portugal' });
  await call(pl.tok, 'log_visit', { id: mFresh2.id, visited_on: today, body: 'now' });
  ok('X3 a place kept and checked in in the same session is not intention → experience', /Experience events<\/span><span>1</.test(await prof(pl)));

  // ---- Recommendations ----------------------------------------------------
  console.log('Recommendations');
  const rc = member('recs', { source: 'chatgpt', client: 'ChatGPT' });
  const recs = (await call(rc.tok, 'record_recommendations', { items: [
    { kind: 'place', label: 'Cervejaria Ramiro', workflow: 'cold_start', resolution: 'resolved', place_name: 'Cervejaria Ramiro', locality: 'Lisbon', country: 'Portugal' },
    { kind: 'object', label: 'a good tin of sardines', workflow: 'for_another_time' }] })).items;
  r = rx(await home(rc));
  ok('C1 recommendation-only items are suggestions, never "kept"', /1 suggestion, not yet kept/.test(r) && /1 idea for another time/.test(r) && !/kept<\/li>/.test(r.replace(/not yet kept/g, '')) && /Suggested by your AI — not yet kept\./.test(r), r.replace(/\s+/g, ' ').slice(0, 500));
  ok('C2 suggestions are not first value', !/First semantic value<\/span><span>[^—]/.test(await prof(rc)));
  shift(rc, '-2 days');
  await call(rc.tok, 'keep_recommendation', { recommendation_uid: recs[0].recommendation.uid });
  const later = (await call(rc.tok, 'record_recommendations', { items: [{ kind: 'place', label: 'Taberna D', workflow: 'cold_start', resolution: 'resolved', place_name: 'Taberna D', locality: 'Lisbon', country: 'Portugal' }] })).items;
  await call(rc.tok, 'keep_recommendation', { recommendation_uid: later[0].recommendation.uid });
  p = await prof(rc);
  ok('C3 an earlier suggestion kept later is reuse; one suggested and kept in the same session is not', /Reuse events<\/span><span>1</.test(p) && /A suggestion was kept in a later session/.test(p), p.slice(-400));
  r = rx(await home(rc));
  ok('C4 the receipt says which suggestions were kept', /suggestions? you kept/.test(r));

  const fat = member('anothertime', { source: 'chatgpt', client: 'ChatGPT' });
  await call(fat.tok, 'record_recommendations', { items: ['Kyoto in autumn', 'A week in Puglia', 'Hokkaido in winter'].map((label) => ({ kind: 'itinerary', label, workflow: 'for_another_time' })) });
  r = rx(await home(fat));
  ok('C5 exactly three For Another Time plans: "3 ideas for another time", nothing kept, no promise', /3 ideas for another time/.test(r) && !/suggestions?, not yet kept/.test(r) && !/Next time you plan/.test(r), r.replace(/\s+/g, ' ').slice(0, 400));
  const dob = member('destobj', { source: 'chatgpt', client: 'ChatGPT' });
  const dit = await call(dob.tok, 'create_itinerary', { title: 'Naples' });
  await call(dob.tok, 'add_itinerary_stops', { itinerary_uid: dit.uid, stops: [{ label: 'Tailor', new_place: { name: 'Sartoria F', locality: 'Napoli', country: 'Italy' } }] });
  await call(dob.tok, 'record_recommendations', { items: [{ kind: 'object', label: 'a Neapolitan tie', workflow: 'destination_objects', context_itinerary_uid: dit.uid }, { kind: 'object', label: 'a linen jacket', workflow: 'destination_objects', context_itinerary_uid: dit.uid }] });
  r = rx(await home(dob));
  ok('C6 destination objects: the plan kept, its things counted as suggestions', /1 plan kept/.test(r) && /1 place kept/.test(r) && /2 suggestions, not yet kept/.test(r), r.replace(/\s+/g, ' ').slice(0, 500));
  ok('C7 returned: the planner acted again 12 hours or more after first value', !/Returned and acted<\/span><span>\u2014/.test(await prof(pl)));

  // ---- Stop notes and ownership ------------------------------------------
  console.log('Things under stops, and ownership');
  const sn = member('stopnote', { source: 'chatgpt', client: 'ChatGPT' });
  const nimg = (await call(sn.tok, 'upload_image', { image: PNG })).ref;
  const note = await call(sn.tok, 'note_object', { headline: 'Linen shirt', image: nimg });
  shift(sn, '-2 days');
  const it3 = await call(sn.tok, 'create_itinerary', { title: 'Beach day' });
  await call(sn.tok, 'add_itinerary_stops', { itinerary_uid: it3.uid, stops: [{ label: 'Swim', new_place: { name: 'Praia E', locality: 'Cascais', country: 'Portugal' } }, { label: 'Lunch' }] });
  const stopUid = one('SELECT s.uid FROM itinerary_stops s JOIN itineraries i ON i.id=s.itinerary_id WHERE i.uid=? ORDER BY s.id LIMIT 1', it3.uid).uid;
  await call(sn.tok, 'set_stop_note', { stop_uid: stopUid, note_uid: note.uid, attached: true });
  r = rx(await home(sn));
  ok('S1 a note kept earlier placed under a stop: reused, not new', /1 thing you’d already kept, placed in this plan/.test(r) && !/thing kept/.test(r), r.replace(/\s+/g, ' ').slice(0, 500));
  ok('S2 ...existing_note_attached_to_new_plan', /A thing kept earlier was placed under a stop/.test(await (await get(admin, '/admin/activation?cohort=all')).text()));
  await call(sn.tok, 'record_note_ownership', { id: note.id });
  ok('S3 owned in the same session it was placed in a plan: not yet intention → experience', /Experience events<\/span><span>0</.test(await prof(sn)));
  shift(sn, '-1 days');
  run("DELETE FROM ownership_assertions WHERE user_id=?", sn.id);
  await call(sn.tok, 'record_note_ownership', { id: note.id });
  ok('S4 owned in a later session: planned_note_owned_later', /Experience events<\/span><span>1</.test(await prof(sn)));

  // ---- TTFV, cohorts, admin ------------------------------------------------
  console.log('Time to first value, cohorts and the admin view');
  const fa = member('assisted', { source: 'web', flag: 'founder_assisted' });
  const org = await (await get(admin, '/admin/activation')).text();
  ok('A1 /admin/activation shows the activation model, organic by default', /Activation model/.test(org) && /class="link caps on" href="\/admin\/activation\?cohort=organic"/.test(org));
    const model = (x) => x.slice(x.indexOf('id="model"'), x.indexOf('By arrival route'));
  ok('A2 founder-assisted and admin accounts are kept out of organic', !model(org).includes('@assisted<') && !/<td>internal<\/td>/.test(model(org)) && model(await (await get(admin, '/admin/activation?cohort=founder_assisted')).text()).includes('@assisted<'));
  ok('A3 small denominators show counts, not percentages', !/\d+ of [1-9] \(\d+%\)/.test(org));
  ok('A4 non-admins cannot see activation analysis', (await get(m1, '/admin/activation')).status === 403 && (await get(m1, '/admin/members/planner')).status === 403);
  const allp = await (await get(admin, '/admin/activation?cohort=all')).text();
  const ttRow = (label) => { const i = allp.indexOf(label); return allp.slice(i, allp.indexOf('</tr>', i)); };
  ok('T1 account → first value is measured for members who reached value', /<td>\d+<\/td>/.test(ttRow('Account → first value')) && !/<td>0<\/td>/.test(ttRow('Account → first value').slice(0, 80)));
  ok('T2 starter → first value appears where a starter came first', /<td>1<\/td>/.test(ttRow('Starter chosen → first value')), ttRow('Starter chosen'));
  ok('T3 connection → first value appears where a connection came first', /<td>[1-9]\d*<\/td>/.test(ttRow('AI connection → first value')));
  ok('T4 initial intent comes from the starter, never inferred', /<td>trip_planning<\/td>/.test(allp) && /@assisted<\/a><\/td><td>founder-assisted<\/td><td>web<\/td><td>none<\/td><td>—<\/td>/.test(allp));
  ok('T5 a member who never reaches value stays at their setup stage', /@conn<\/a><\/td><td>organic<\/td><td>chatgpt<\/td><td>chatgpt<\/td><td>—<\/td><td>AI connected<\/td>/.test(allp));
  ok('T6 the limitations are stated on the page', /What these measures do not prove/.test(allp) && /not the AI conversation/.test(allp));
  ok('T7 segments by arrival route, client and intent', /Arrived by<\/th>/.test(allp) && /First AI client<\/th>/.test(allp) && /Initial intent \(first starter\)<\/th>/.test(allp));

  // ---- Privacy and deletion -------------------------------------------------
  console.log('Privacy and deletion');
  const pubFeed = await home(null);
  ok('V1 the public feed shows no receipt and no AI attribution', !/class="resurface receipt"/.test(pubFeed) && !/Added through/.test(pubFeed));
  const metas = all("SELECT meta FROM product_events").map((x) => x.meta).join(' ');
  ok('V2 no tokens or record text in product events', !metas.includes(pl.tok) && !metas.includes(m1.tok) && !/Lisbon|Bar Uno|sardines/i.test(metas));
  run('DELETE FROM users WHERE id=?', m1.id);
  ok('V3 deleting an account deletes its product events', !one('SELECT 1 FROM product_events WHERE user_id=?', m1.id));

  console.log(`\n${pass} passed, ${fail} failed`);
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.error(log.slice(-2000)); srv.kill(); process.exit(1); });
