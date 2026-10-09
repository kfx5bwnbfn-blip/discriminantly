// Shared itinerary collaboration (v2.70). Self-contained: starts its own server
// on a fresh database and drives it as four people -- Brian (owner), Jane
// (editor), Kim (viewer) and Eve (no access) -- through MCP (personal
// connector, so actor_type ai_on_behalf) and the web (session, actor_type user).
//
//   node test/collaboration.js
const { spawn, execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 600) : '')); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'));
const DB = path.join(work, 'd.db');
const port = 5800 + Math.floor(Math.random() * 400);
const env = { ...process.env, PORT: String(port), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', PUBLIC_ORIGIN: 'http://localhost:' + port };
delete env.MUSE_ORIGIN;
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });

const reqRaw = (method, p, { body = null, headers = {} } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const db = () => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout=5000'); return d; };
const one = (sql, ...a) => { const d = db(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const all = (sql, ...a) => { const d = db(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const run = (sql, ...a) => { const d = db(); try { return d.prepare(sql).run(...a); } finally { d.close(); } };

const people = {};
let rid = 0;
const seen = {};                  // every MCP result each person received, for the leak scan
async function call(who, name, args) {
  const r = await reqRaw('POST', '/mcp/' + people[who].tok, { headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }) });
  const j = JSON.parse(r.body).result;
  (seen[who] ||= []).push(JSON.stringify(j));
  return { text: j.content[0].text, s: j.structuredContent, err: !!j.isError, meta: j._meta || {} };
}
const web = (who, method, p, form) => reqRaw(method, p, { headers: { cookie: 'sid=' + people[who].sid, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
  body: form ? new URLSearchParams(form).toString() : null });
const anon = (p) => reqRaw('GET', p);

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await anon('/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    // ---- people -------------------------------------------------------------
    const admin = one('SELECT * FROM users WHERE id=1');
    for (const [k, handle] of [['brian', null], ['jane', 'jane'], ['kim', 'kim'], ['eve', 'eve']]) {
      let id = 1;
      if (handle) id = run("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,?,'modern')", handle, handle, `${handle}@example.com`, admin.pass).lastInsertRowid;
      const tok = crypto.randomBytes(16).toString('hex'), sid = crypto.randomBytes(16).toString('hex');
      run('UPDATE users SET api_token=? WHERE id=?', tok, id);
      run('INSERT INTO sessions(token,user_id) VALUES(?,?)', sid, id);
      people[k] = { id: Number(id), tok, sid, handle: handle || admin.handle };
    }
    const marksOf = (who) => all('SELECT uid FROM marks WHERE user_id=?', people[who].id).map((r) => r.uid);
    const adoptionsOf = (who) => one('SELECT COUNT(*) n FROM adoptions WHERE user_id=?', people[who].id).n;

    // ---- single-owner baseline ------------------------------------------------
    console.log('single-owner plans are unchanged');
    const solo = await call('brian', 'create_itinerary', { title: 'Solo plan' });
    const soloAdd = await call('brian', 'add_itinerary_stops', { itinerary_uid: solo.s.uid, stops: [{ label: 'Lunch', new_place: { name: 'Solo Bistro', locality: 'Picton', country: 'Canada', address: '1 Main St' } }] });
    const soloStop = soloAdd.s.stops[0];
    ok('SO1 a new place on a single-owner plan is still marked for its owner (the Mark boundary)', !!soloStop.mark_uid && marksOf('brian').includes(soloStop.mark_uid) && soloStop.kind === 'linked', JSON.stringify(soloStop));
    ok('SO2 ...and its place identity is filled from that Mark (identity fields only)',
      !!one("SELECT 1 FROM itinerary_stops WHERE uid=? AND place_name='Solo Bistro' AND place_address='1 Main St' AND place_locality='Picton'", soloStop.uid));
    const soloDel = await call('brian', 'delete_itinerary_entity', { kind: 'stop', uid: soloStop.uid });
    ok('SO3 deleting a stop on a single-owner plan deletes it as before (no Removed store)', soloDel.text === 'Stop deleted.' && !one('SELECT 1 FROM itinerary_stops WHERE uid=?', soloStop.uid) && !one('SELECT 1 FROM itinerary_removed WHERE subject_uid=?', soloStop.uid), soloDel.text);
    ok('SO4 ...with its plan named in the deletion history', one("SELECT source_ref r FROM provenance WHERE entity_uid=? AND action='deleted'", soloStop.uid).r === solo.s.uid);
    const soloList = await call('brian', 'my_itineraries', {});
    ok('SO5 a single-owner plan lists with no sharing note', /Solo plan/.test(soloList.text) && !/shared/.test(soloList.text));

    // ---- the plan to share ------------------------------------------------------
    console.log('sharing a plan');
    const plan = await call('brian', 'create_itinerary', { title: 'Picton weekend' });
    const P = plan.s.uid, pid = one('SELECT id FROM itineraries WHERE uid=?', P).id;
    const priv = await call('brian', 'add_travel_mark', { place: 'Secret Cellar', locality: 'Picton', country: 'Canada', address: '9 Hidden Lane', lat: 44.0, lng: -77.14, why: 'BRIAN-PRIVATE-WHY', private: true });
    const b1 = await call('brian', 'add_itinerary_stops', { itinerary_uid: P, stops: [
      { label: 'Dinner', new_place: { name: 'Theia', locality: 'Picton', country: 'Canada', address: '15 Ross St', lat: 44.007, lng: -77.141, why: 'BRIAN-THEIA-WHY' } },
      { label: 'Wine', mark_uid: priv.s.uid }, { label: 'Walk by the water', kind: 'experiential' }] });
    const [stTheia, stCellar, stWalk] = b1.s.stops;
    const brianMarks = () => marksOf('brian');
    ok('SH1 the owner’s stops link the owner’s Marks before sharing', stTheia.mark_uid && stCellar.mark_uid === priv.s.uid);

    const mem0 = await web('brian', 'GET', `/t/${pid}/members`);
    ok('SH2 the owner sees "Plan together" and the private-place disclosure before inviting',
      mem0.status === 200 && /Plan together/.test(mem0.body) && /from your private travel marks/.test(mem0.body) && /Secret Cellar/.test(mem0.body) && !/BRIAN-PRIVATE-WHY/.test(mem0.body));
    const noConfirm = await web('brian', 'POST', `/t/${pid}/invite`, { role: 'editor' });
    ok('SH3 inviting without confirming the disclosure makes no invitation', /is-asked/.test(noConfirm.body) && one('SELECT COUNT(*) n FROM itinerary_invitations').n === 0);
    const inv1 = await web('brian', 'POST', `/t/${pid}/invite`, { role: 'editor', confirm_private: '1' });
    const tokJ = (inv1.body.match(/\/j\/([A-Za-z0-9_-]{20,100})/) || [])[1];
    ok('SH4 confirmed: a link is shown once, and only its hash is stored', !!tokJ && !one('SELECT 1 FROM itinerary_invitations WHERE token_hash=?', tokJ)
      && !!one('SELECT 1 FROM itinerary_invitations WHERE token_hash=?', crypto.createHash('sha256').update(tokJ).digest('hex')));
    const inv2 = await web('brian', 'POST', `/t/${pid}/invite`, { role: 'viewer', email: 'kim@example.com', confirm_private: '1' });
    const tokK = (inv2.body.match(/\/j\/([A-Za-z0-9_-]{20,100})/) || [])[1];
    const eveTry = await web('eve', 'POST', `/j/${tokK}/accept`, {});
    ok('SH5 an email-bound invitation can’t be accepted by another account', /different email address/.test(eveTry.body) && !one('SELECT 1 FROM itinerary_members WHERE user_id=?', people.eve.id));
    const pub = await call('brian', 'update_itinerary', { itinerary_uid: P, private: false });
    ok('SH6 a plan with an open invitation can’t be made public', pub.err && /shared with other people/.test(pub.text), pub.text);

    const land = await anon(`/j/${tokJ}`);
    ok('SH7 signed out, the invitation says who and what, and asks to sign in (noindex)', land.status === 200 && /invited you/.test(land.body) && /Picton weekend/.test(land.body) && /\/login\?next=%2Fj%2F/.test(land.body) && land.headers['x-robots-tag'] === 'noindex');
    const login = await reqRaw('POST', '/login', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'jane@example.com', password: 'prototype1', next: `/j/${tokJ}` }).toString() });
    ok('SH8 signing in returns to the invitation (and nowhere else)', login.status === 303 && login.headers.location === `/j/${tokJ}`, login.headers.location);
    const evil = await reqRaw('POST', '/login', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'jane@example.com', password: 'prototype1', next: 'https://evil.example/j/aaaaaaaaaaaaaaaaaaaaaaaa' }).toString() });
    ok('SH9 an outside return address is ignored', evil.headers.location === '/', evil.headers.location);
    ok('SH10 seeing the invitation grants nothing', !one('SELECT 1 FROM itinerary_members WHERE user_id=?', people.jane.id));
    const acc = await web('jane', 'POST', `/j/${tokJ}/accept`, {});
    ok('SH11 accepting is an explicit act; Jane is an active editor', acc.status === 303 && one('SELECT role, state FROM itinerary_members WHERE user_id=?', people.jane.id).role === 'editor');
    ok('SH12 the invitation is single-use', /isn’t active/.test((await web('eve', 'GET', `/j/${tokJ}`)).body) && one("SELECT state FROM itinerary_invitations WHERE token_hash=?", crypto.createHash('sha256').update(tokJ).digest('hex')).state === 'accepted');
    await web('kim', 'POST', `/j/${tokK}/accept`, {});
    ok('SH13 Kim (email-bound) accepts as a viewer', one('SELECT role FROM itinerary_members WHERE user_id=?', people.kim.id).role === 'viewer');
    ok('SH14 joining is recorded (membership and invitation)', !!one("SELECT 1 FROM provenance WHERE entity_type='itinerary_membership' AND entity_uid=? AND action='joined'", P)
      && !!one("SELECT 1 FROM provenance WHERE entity_type='itinerary_invitation' AND action='accepted'"));

    // ---- access ----------------------------------------------------------------
    console.log('access: owner, editor, viewer, nobody');
    const evePlan = await call('eve', 'my_itineraries', { uid: P });
    ok('AC1 no access is indistinguishable from no such plan', evePlan.err && /^No such itinerary\./.test(evePlan.text));
    const eveStop = await call('eve', 'update_itinerary_stop', { stop_uid: stTheia.uid, label: 'x' });
    ok('AC2 ...and from no such stop', eveStop.err && /^No such stop\./.test(eveStop.text));
    ok('AC3 ...and the web page 404s for Eve', (await web('eve', 'GET', `/t/${pid}`)).status === 404 && (await web('eve', 'GET', `/t/${pid}/members`)).status === 404);
    const kimAdd = await call('kim', 'add_itinerary_stops', { itinerary_uid: P, stops: [{ label: 'Kim was here' }] });
    ok('AC4 a viewer reads but can’t write', kimAdd.err && /can view this plan but not change it/.test(kimAdd.text) && !(await call('kim', 'my_itineraries', { uid: P })).err);
    const janeList = await call('jane', 'my_itineraries', {});
    ok('AC5 the editor’s list includes the shared plan, saying so in text only', /Picton weekend/.test(janeList.text) && /shared with you by @/.test(janeList.text)
      && janeList.s.items.every((x) => JSON.stringify(Object.keys(x)) === JSON.stringify(['uid', 'title', 'when', 'private', 'stops'])));
    const janeRename = await call('jane', 'update_itinerary', { itinerary_uid: P, title: 'Picton weekend!' });
    ok('AC6 an editor edits the plan’s content', !janeRename.err && one('SELECT title FROM itineraries WHERE uid=?', P).title === 'Picton weekend!');
    const janePub = await call('jane', 'update_itinerary', { itinerary_uid: P, private: false });
    ok('AC7 an editor has no governance (publicity)', janePub.err && /Only the person who created this plan/.test(janePub.text));
    const ownerPub = await call('brian', 'update_itinerary', { itinerary_uid: P, private: false });
    ok('AC8 a shared plan can’t be made public, even by its owner', ownerPub.err && /shared with other people/.test(ownerPub.text) && one('SELECT private FROM itineraries WHERE uid=?', P).private === 1);

    // ---- privacy: caller-relative mark_uid ----------------------------------------
    console.log('privacy: mark_uid is always the caller’s own');
    const janeView = await call('jane', 'my_itineraries', { uid: P });
    const jStops = [...janeView.s.days.flatMap((d) => d.stops), ...janeView.s.unplaced];
    ok('PR1 Jane sees every stop, none carrying Brian’s Mark', jStops.length === 3 && jStops.every((s0) => s0.mark_uid === null));
    ok('PR2 Brian’s linked stops read as particular places for Jane', jStops.find((s0) => s0.uid === stTheia.uid).kind === 'particular' && jStops.find((s0) => s0.uid === stCellar.uid).kind === 'particular');
    const brianView = await call('brian', 'my_itineraries', { uid: P });
    const bStops = [...brianView.s.days.flatMap((d) => d.stops), ...brianView.s.unplaced];
    ok('PR3 Brian still sees his own Marks on his stops', bStops.find((s0) => s0.uid === stTheia.uid).mark_uid === stTheia.mark_uid);
    ok('PR4 the structured result keeps its exact shape for every caller', JSON.stringify(Object.keys(janeView.s)) === JSON.stringify(Object.keys(brianView.s))
      && JSON.stringify(Object.keys(jStops[0]).sort()) === JSON.stringify(Object.keys(bStops.find((x) => x.uid === jStops[0].uid)).sort()));
    const janePage = await web('jane', 'GET', `/t/${pid}`);
    const privMarkId = one('SELECT id FROM marks WHERE uid=?', priv.s.uid).id;
    ok('PR5 the web page shows Jane the shared places but none of Brian’s Marks', janePage.status === 200 && /Theia/.test(janePage.body) && /Wine/.test(janePage.body)
      && !janePage.body.includes(`/m/${privMarkId}`) && !janePage.body.includes(`/m/${one('SELECT id FROM marks WHERE uid=?', stTheia.mark_uid).id}"`)
      && !/BRIAN-PRIVATE-WHY|BRIAN-THEIA-WHY/.test(janePage.body), janePage.status);
    ok('PR6 the shared place identity is visible to participants (name, address)', /15 Ross St/.test(janePage.body) && /9 Hidden Lane/.test(janePage.body));

    // ---- adding: no Mark for anyone (C1) -------------------------------------------
    console.log('adding to a shared plan keeps the place for nobody');
    const before = { b: brianMarks().length, j: marksOf('jane').length, k: marksOf('kim').length, ab: adoptionsOf('brian'), aj: adoptionsOf('jane') };
    const jAdd = await call('jane', 'add_itinerary_stops', { itinerary_uid: P, stops: [{ label: 'Korean dinner', new_place: { name: 'Sujeo', locality: 'Picton', country: 'Canada', address: '211 Main St', lat: 44.006, lng: -77.139, why: 'JANE-WHY' } }] });
    const stSujeo = jAdd.s.stops[0];
    ok('AD1 a new place on a shared plan creates no Mark, for the adder or anyone', !jAdd.err && brianMarks().length === before.b && marksOf('jane').length === before.j && marksOf('kim').length === before.k);
    ok('AD2 ...and no adoption (not taste evidence, the adder’s included)', adoptionsOf('brian') === before.ab && adoptionsOf('jane') === before.aj);
    ok('AD3 the stop owns the place: a particular stop with its identity, mark_uid null', stSujeo.kind === 'particular' && stSujeo.mark_uid === null
      && !!one("SELECT 1 FROM itinerary_stops WHERE uid=? AND place_name='Sujeo' AND place_address='211 Main St' AND place_lat IS NOT NULL", stSujeo.uid));
    ok('AD4 the personal note (why) went nowhere, and the reply says so', !one("SELECT 1 FROM itinerary_stops WHERE uid=? AND (label LIKE '%JANE-WHY%')", stSujeo.uid) && /kept for nobody/.test(jAdd.text) && /note about why was not saved/.test(jAdd.text), jAdd.text);
    const jPv = one("SELECT * FROM provenance WHERE entity_type='itinerary_stop' AND entity_uid=? AND action='created'", stSujeo.uid);
    ok('AD5 attributed to Jane’s AI acting for Jane (derived from her connection, never from arguments), with the plan as reference',
      jPv.actor_type === 'ai_on_behalf' && jPv.actor_user_id === people.jane.id && jPv.source_ref === P && !!jPv.auth_method, JSON.stringify(jPv));
    const audit = await call('jane', 'audit_itinerary', { itinerary_uid: P, expect: { all_specific_stops_linked: true } });
    ok('AU1 fully identified shared stops pass the audit without any Mark', !audit.err && audit.s.satisfied === true && audit.s.checks.unresolved_particular_stops.length === 0, JSON.stringify(audit.s && audit.s.checks));
    const brAudit = await call('brian', 'audit_itinerary', { itinerary_uid: P, expect: { all_specific_stops_linked: true } });
    ok('AU2 ...for the owner too, and the audit itself creates nothing', brAudit.s.satisfied === true && brianMarks().length === before.b && marksOf('jane').length === before.j);
    const vague = await call('jane', 'add_itinerary_stops', { itinerary_uid: P, stops: [{ label: 'Somewhere for coffee', kind: 'particular' }] });
    const auditV = await call('jane', 'audit_itinerary', { itinerary_uid: P, expect: { all_specific_stops_linked: true } });
    ok('AU3 a particular stop with no identity still shows as unresolved (only identified places pass)', auditV.s.checks.unresolved_particular_stops.some((x) => x.stop_uid === vague.s.stops[0].uid));

    // ---- personal adoption -----------------------------------------------------------
    console.log('personal adoption is independent');
    const jMark = await call('jane', 'resolve_travel_mark', { place: 'Sujeo', locality: 'Picton', country: 'Canada', address: '211 Main St', identity_basis: ['member_identity'], target_state: 'canonical' });
    const jLink = await call('jane', 'resolve_itinerary_stop', { stop_uid: stSujeo.uid, mark_uid: jMark.s.mark.uid });
    ok('PA1 Jane keeps the place for herself: her own link, her own Mark', !jLink.err && jLink.s.stop.mark_uid === jMark.s.mark.uid && jLink.s.stop.kind === 'linked', jLink.text);
    const bAfter = [...(await call('brian', 'my_itineraries', { uid: P })).s.days.flatMap((d) => d.stops), ...(await call('brian', 'my_itineraries', { uid: P })).s.unplaced];
    const kAfter = (await call('kim', 'my_itineraries', { uid: P })).s.unplaced;
    ok('PA2 Brian and Kim are unaffected (null, never Jane’s Mark)', bAfter.find((x) => x.uid === stSujeo.uid).mark_uid === null && kAfter.find((x) => x.uid === stSujeo.uid).mark_uid === null);
    ok('PA3 the link lives in Jane’s row only; the stop keeps its kind and place', !!one('SELECT 1 FROM itinerary_stop_marks l JOIN itinerary_stops s ON s.id=l.stop_id WHERE s.uid=? AND l.user_id=?', stSujeo.uid, people.jane.id)
      && one('SELECT resolution, mark_uid FROM itinerary_stops WHERE uid=?', stSujeo.uid).mark_uid === null);
    const kimMark = await call('kim', 'resolve_travel_mark', { place: 'Theia', locality: 'Picton', country: 'Canada', address: '15 Ross St', identity_basis: ['member_identity'], target_state: 'canonical' });
    const kimLink = await call('kim', 'resolve_itinerary_stop', { stop_uid: stTheia.uid, mark_uid: kimMark.s.mark.uid });
    ok('PA4 a viewer may keep a place for herself (a personal act, not an edit)', !kimLink.err && kimLink.s.stop.mark_uid === kimMark.s.mark.uid);
    const notMine = await call('jane', 'resolve_itinerary_stop', { stop_uid: stTheia.uid, mark_uid: stTheia.mark_uid });
    ok('PA5 nobody can link someone else’s Mark', notMine.err && /No such travel mark/.test(notMine.text));
    const kimKeepWeb = await web('jane', 'POST', `/t/${pid}/stops/${stTheia.uid}/keep`, {});
    const janeTheia = one('SELECT l.mark_uid FROM itinerary_stop_marks l JOIN itinerary_stops s ON s.id=l.stop_id WHERE s.uid=? AND l.user_id=?', stTheia.uid, people.jane.id);
    ok('PA6 "Keep this place" on the web makes and links Jane’s own kept Mark from identity fields only', kimKeepWeb.status === 303 && !!janeTheia
      && !!one("SELECT 1 FROM marks m JOIN adopted_marks a ON a.uid=m.uid WHERE m.uid=? AND m.user_id=? AND m.address='15 Ross St' AND m.why=''", janeTheia.mark_uid, people.jane.id));

    console.log('deleting a personal Mark ends only that person’s link');
    const jMarkId = one('SELECT id FROM marks WHERE uid=?', jMark.s.mark.uid).id;
    await call('jane', 'delete_travel_mark', { id: jMarkId });
    const sAfter = one('SELECT * FROM itinerary_stops WHERE uid=?', stSujeo.uid);
    ok('MD1 Jane’s link is gone; the stop and its full place identity stay', !one('SELECT 1 FROM itinerary_stop_marks l JOIN itinerary_stops s ON s.id=l.stop_id WHERE s.uid=? AND l.user_id=?', stSujeo.uid, people.jane.id)
      && sAfter && sAfter.place_name === 'Sujeo' && sAfter.place_address === '211 Main St' && sAfter.place_lat !== null);
    ok('MD2 recorded as that link ending, by cascade', !!one("SELECT 1 FROM provenance WHERE entity_uid=? AND action='unlinked' AND fields='member_link'", stSujeo.uid));
    const brTheiaMark = stTheia.mark_uid, brTheiaId = one('SELECT id FROM marks WHERE uid=?', brTheiaMark).id;
    await call('brian', 'delete_travel_mark', { id: brTheiaId });
    const tAfter = one('SELECT * FROM itinerary_stops WHERE uid=?', stTheia.uid);
    ok('MD3 the owner deleting his Mark leaves the stop with its full identity', tAfter.mark_uid === null && tAfter.resolution === 'particular' && tAfter.place_name === 'Theia' && tAfter.place_address === '15 Ross St' && tAfter.place_lat !== null);
    ok('MD4 ...and other participants’ links to that place are untouched', !!one('SELECT 1 FROM itinerary_stop_marks l WHERE l.mark_uid=? AND l.user_id=?', kimMark.s.mark.uid, people.kim.id)
      && !!one('SELECT 1 FROM itinerary_stop_marks l WHERE l.mark_uid=? AND l.user_id=?', janeTheia.mark_uid, people.jane.id));

    // ---- Removed -----------------------------------------------------------------------
    console.log('Removed: recoverable, attributed, never touches Marks');
    const kimMarksBefore = marksOf('kim').length;
    const rem = await call('jane', 'delete_itinerary_entity', { kind: 'stop', uid: stTheia.uid });
    ok('RM1 an editor’s removal is recoverable (and the reply says so)', !rem.err && /removed from the shared plan/.test(rem.text) && !one('SELECT 1 FROM itinerary_stops WHERE uid=?', stTheia.uid)
      && !!one("SELECT 1 FROM itinerary_removed WHERE subject_uid=? AND state='removed'", stTheia.uid), rem.text);
    ok('RM2 nobody’s Marks were touched', marksOf('kim').length === kimMarksBefore && !!one('SELECT 1 FROM marks WHERE uid=?', kimMark.s.mark.uid) && !!one('SELECT 1 FROM marks WHERE uid=?', janeTheia.mark_uid));
    const rPv = one("SELECT * FROM provenance WHERE entity_uid=? AND action='removed'", stTheia.uid);
    ok('RM3 removal is attributed to Jane’s AI, with the plan as reference', rPv.actor_type === 'ai_on_behalf' && rPv.actor_user_id === people.jane.id && rPv.source_ref === P);
    ok('RM4 a removed stop is gone from every read', !(await call('brian', 'my_itineraries', { uid: P })).text.includes(stTheia.uid));
    const remPage = await web('brian', 'GET', `/t/${pid}/removed`);
    const remUid = one("SELECT uid FROM itinerary_removed WHERE subject_uid=?", stTheia.uid).uid;
    ok('RM5 the Removed page names it and who removed it', /Dinner/.test(remPage.body) && /removed by @jane/.test(remPage.body));
    const kimRestore = await web('kim', 'POST', `/t/${pid}/removed/${remUid}/restore`, {});
    ok('RM6 a viewer can’t restore', /can view this plan but not change it/.test(kimRestore.body) && !one('SELECT 1 FROM itinerary_stops WHERE uid=?', stTheia.uid));
    await web('brian', 'POST', `/t/${pid}/removed/${remUid}/restore`, {});
    const back = one('SELECT * FROM itinerary_stops WHERE uid=?', stTheia.uid);
    ok('RM7 restore brings back the same uid with its place, and the links of people still there', !!back && back.place_name === 'Theia'
      && !!one('SELECT 1 FROM itinerary_stop_marks WHERE stop_id=? AND user_id=?', back.id, people.kim.id) && !!one('SELECT 1 FROM itinerary_stop_marks WHERE stop_id=? AND user_id=?', back.id, people.jane.id));
    const resPv = one("SELECT * FROM provenance WHERE entity_uid=? AND action='restored'", stTheia.uid);
    ok('RM8 restoring is attributed to Brian on the web', resPv.actor_type === 'user' && resPv.actor_user_id === people.brian.id && resPv.source_ref === P);
    // days
    const day = await call('jane', 'arrange_itinerary', { itinerary_uid: P, create_day: { label: 'Saturday' }, assign: [{ stop_uid: stSujeo.uid }, { stop_uid: stWalk.uid }], order_stops: [stSujeo.uid, stWalk.uid] });
    const dayUid = day.s.days[0].uid;
    const dRem = await call('jane', 'delete_itinerary_entity', { kind: 'day', uid: dayUid });
    ok('RM9 removing a day keeps its stops (unplaced) and is recoverable', /Day removed/.test(dRem.text) && !one('SELECT 1 FROM itinerary_groups WHERE uid=?', dayUid)
      && one('SELECT group_id FROM itinerary_stops WHERE uid=?', stSujeo.uid).group_id === null);
    await web('jane', 'POST', `/t/${pid}/removed/${one('SELECT uid FROM itinerary_removed WHERE subject_uid=?', dayUid).uid}/restore`, {});
    const g = one('SELECT * FROM itinerary_groups WHERE uid=?', dayUid);
    ok('RM10 restoring the day brings it back with its stops in their order', !!g && one('SELECT group_id, position FROM itinerary_stops WHERE uid=?', stSujeo.uid).group_id === g.id
      && one('SELECT position FROM itinerary_stops WHERE uid=?', stSujeo.uid).position === 1 && one('SELECT position FROM itinerary_stops WHERE uid=?', stWalk.uid).position === 2);

    // ---- web editing by an editor -----------------------------------------------------
    console.log('the web, as an editor');
    const ePage = await web('jane', 'GET', `/t/${pid}`);
    const editForm = (ePage.body.match(/<form method="post" action="\/t\/\d+" class="nf nf-compact itin-new itin-edit-form">[\s\S]*?<\/form>/) || [''])[0];
    ok('WE1 the editor gets content controls; the plan\u2019s edit form has no publicity switch and no delete', /Add stop or day/.test(ePage.body) && !!editForm
      && !/name="private"/.test(editForm) && !/data-del=/.test(editForm), editForm.slice(0, 300));
    const kPage = await web('kim', 'GET', `/t/${pid}`);
    ok('WE2 the viewer gets no controls', kPage.status === 200 && !/Add stop or day/.test(kPage.body) && /you can view/.test(kPage.body));
    const wAdd = await web('jane', 'POST', `/t/${pid}/stops`, { label: 'Ice cream', resolution: 'experiential' });
    const wSt = one("SELECT uid FROM itinerary_stops WHERE label='Ice cream'");
    const wPv = one("SELECT * FROM provenance WHERE entity_uid=? AND action='created'", wSt.uid);
    ok('WE3 a web edit by Jane is attributed to Jane as a person, with the plan as reference', wAdd.status === 303 && wPv.actor_type === 'user' && wPv.actor_user_id === people.jane.id && wPv.source_ref === P);
    const kimWeb = await web('kim', 'POST', `/t/${pid}/stops`, { label: 'nope', resolution: 'experiential' });
    ok('WE4 a viewer’s web write is refused', kimWeb.status === 400 && !one("SELECT 1 FROM itinerary_stops WHERE label='nope'"));

    // ---- the whole conversation never leaked another participant's Mark -----------------
    const brianAll = new Set(all('SELECT uid FROM marks WHERE user_id=?', people.brian.id).map((r) => r.uid).concat([priv.s.uid, brTheiaMark]));
    const leak = (who) => (seen[who] || []).some((r) => [...brianAll].some((u) => r.includes(u)));
    ok('PR7 across every MCP result Jane and Kim received, not one of Brian’s Mark uids', !leak('jane') && !leak('kim'));
    const kimAll = new Set(marksOf('kim')), janeAll = new Set(marksOf('jane'));
    ok('PR8 ...nor Kim’s in Jane’s, nor Jane’s in Kim’s', !(seen.jane || []).some((r) => [...kimAll].some((u) => r.includes(u))) && !(seen.kim || []).some((r) => [...janeAll].some((u) => r.includes(u))));

    // ---- privacy propagation ------------------------------------------------------------
    const pvBefore = one("SELECT COUNT(*) n FROM provenance WHERE entity_uid=? AND source_kind='mark_privacy'", P).n;
    await web('jane', 'POST', `/m/${one('SELECT id FROM marks WHERE uid=?', janeTheia.mark_uid).id}/edit`, { name: 'Theia', locality: 'Picton', country: 'Canada', private: '1' });
    ok('PV1 a participant changing her own Mark’s privacy never touches the shared plan', one("SELECT COUNT(*) n FROM provenance WHERE entity_uid=? AND source_kind='mark_privacy'", P).n === pvBefore && one('SELECT private FROM itineraries WHERE uid=?', P).private === 1);

    // ---- recommendations stay per person -------------------------------------------------
    await call('jane', 'record_recommendations', { items: [{ kind: 'place', label: 'Jane idea', workflow: 'for_another_time', context_itinerary_uid: P }] });
    const bRecs = await call('brian', 'list_recommendations', { status: 'all' });
    ok('RC1 Jane’s recommendations about the shared plan are hers alone', !/Jane idea/.test(bRecs.text) && /Jane idea/.test((await call('jane', 'list_recommendations', {})).text));

    // ---- deletion and leaving ----------------------------------------------------------
    console.log('governance: delete and leave');
    const mcpDel = await call('brian', 'delete_itinerary_entity', { kind: 'itinerary', uid: P });
    ok('GV1 a shared plan can’t be deleted through MCP, even by its owner', mcpDel.err && /can’t be deleted from here/.test(mcpDel.text) && !!one('SELECT 1 FROM itineraries WHERE uid=?', P));
    const janeDel = await call('jane', 'delete_itinerary_entity', { kind: 'itinerary', uid: P });
    ok('GV2 ...nor by an editor', janeDel.err && !!one('SELECT 1 FROM itineraries WHERE uid=?', P));
    const ownerPage = await web('brian', 'GET', `/t/${pid}`);
    ok('GV3 the owner’s web delete warns who else would lose it', /will lose it too/.test(ownerPage.body) && /@jane/.test(ownerPage.body));
    await web('kim', 'POST', `/t/${pid}/leave`, {});
    ok('GV4 leaving ends only Kim’s membership and her own links', one('SELECT state FROM itinerary_members WHERE user_id=?', people.kim.id).state === 'left'
      && !one('SELECT 1 FROM itinerary_stop_marks WHERE user_id=?', people.kim.id) && !!one('SELECT 1 FROM marks WHERE uid=?', kimMark.s.mark.uid)
      && (await call('kim', 'my_itineraries', { uid: P })).err);
    await web('brian', 'POST', `/t/${pid}/members/${people.jane.id}/role`, { role: 'viewer' });
    ok('GV5 the owner changes a role', one('SELECT role FROM itinerary_members WHERE user_id=?', people.jane.id).role === 'viewer'
      && (await call('jane', 'add_itinerary_stops', { itinerary_uid: P, stops: [{ label: 'x' }] })).err);
    const janeGov = await web('jane', 'POST', `/t/${pid}/members/${people.kim.id}/remove`, {});
    ok('GV6 a non-owner has no governance', janeGov.status === 400);
    const wDel = await web('brian', 'POST', `/t/${pid}/delete`, {});
    ok('GV7 the owner deletes the shared plan on the web; memberships go, everyone’s Marks stay', wDel.status === 303 && !one('SELECT 1 FROM itineraries WHERE uid=?', P)
      && !one('SELECT 1 FROM itinerary_members WHERE itinerary_id=?', pid) && !!one('SELECT 1 FROM marks WHERE uid=?', janeTheia.mark_uid) && !!one('SELECT 1 FROM marks WHERE uid=?', priv.s.uid));

    // ---- share links: "let others use it" (v2.71) --------------------------------------------
    console.log('share links');
    const give = await call('brian', 'create_itinerary', { title: 'A day in Wellington', context: 'Wine and the lake.' });
    const gpid = one('SELECT id FROM itineraries WHERE uid=?', give.s.uid).id;
    const gm = await call('brian', 'add_travel_mark', { place: 'Drake Devonshire', locality: 'Wellington', country: 'Canada', address: '24 Wharf St', lat: 43.95, lng: -77.35, why: 'BRIAN-DRAKE-WHY' });
    await call('brian', 'add_itinerary_stops', { itinerary_uid: give.s.uid, stops: [
      { label: 'Lunch by the water', mark_uid: gm.s.uid, clock: '12:30' },
      { label: 'Tasting', new_place: { name: 'Closson Chase', locality: 'Hillier', country: 'Canada', address: '629 Closson Rd', lat: 43.99, lng: -77.4 } },
      { label: 'A swim if it is warm', kind: 'experiential' }] });
    const noLink = await web('brian', 'POST', `/t/${gpid}/share`, {});
    ok('SL1 a plan with a private place asks for the disclosure first, and makes no link', noLink.status === 200 && /is-asked/.test(noLink.body) && /Closson Chase/.test(noLink.body) && one('SELECT COUNT(*) n FROM itinerary_shares').n === 0);
    const linked = await web('brian', 'POST', `/t/${gpid}/share`, { confirm_private: '1' });
    ok('SL1b confirmed: the link is shown once', linked.status === 200 && /\/s\/[A-Za-z0-9_-]{20,}/.test(linked.body));
    const noLinkBody = linked.body;
    const tokS = (noLinkBody.match(/\/s\/([A-Za-z0-9_-]{20,100})/) || [])[1];
    ok('SL2 only the hash is stored; the plan stays private and unlisted', !one('SELECT 1 FROM itinerary_shares WHERE token_hash=?', tokS) && !!one('SELECT 1 FROM itinerary_shares WHERE token_hash=?', crypto.createHash('sha256').update(tokS).digest('hex'))
      && one('SELECT private FROM itineraries WHERE uid=?', give.s.uid).private === 1 && (await anon(`/t/${gpid}`)).status === 404);
    const sv = await anon(`/s/${tokS}`);
    ok('SL3 anyone with the link sees the plan: title, stops, places by name and city; never Brian\u2019s notes, addresses or mark pages',
      sv.status === 200 && /A day in Wellington/.test(sv.body) && /Drake Devonshire/.test(sv.body) && /Closson Chase/.test(sv.body) && /Wellington, Canada/.test(sv.body)
      && !/BRIAN-DRAKE-WHY|24 Wharf St|629 Closson Rd/.test(sv.body) && !sv.body.includes(`/m/${one('SELECT id FROM marks WHERE uid=?', gm.s.uid).id}`) && /shared this plan with you/.test(sv.body) && sv.headers['x-robots-tag'] === 'noindex');
    ok('SL4 signed out, the action is to create an account (sign in second), returning here', /join\?next=%2Fs%2F/.test(sv.body) && sv.body.indexOf('join?next') < sv.body.indexOf('login?next'));
    ok('SL5 a wrong token is inert', (await anon('/s/' + 'x'.repeat(40))).status === 404);
    // Jane already keeps Closson Chase; Drake she does not have
    const jc = await call('jane', 'add_travel_mark', { place: 'Closson Chase', locality: 'Hillier', country: 'Canada', address: '629 Closson Rd', why: 'JANE-WHY' });
    const jMarks0 = marksOf('jane').length, bMarks0 = marksOf('brian').length;
    const mineR = await web('jane', 'POST', `/s/${tokS}/mine`, {});
    const copy = one("SELECT * FROM itineraries WHERE user_id=? AND title='A day in Wellington'", people.jane.id);
    ok('SL6 "Make this mine" gives Jane her own kept copy and opens it', mineR.status === 303 && !!copy && mineR.headers.location === `/t/${copy.id}?mine=1` && !!one('SELECT 1 FROM adopted_itineraries WHERE uid=?', copy.uid));
    const cstops = all('SELECT * FROM itinerary_stops WHERE itinerary_id=? ORDER BY id', copy.id);
    ok('SL7 the copy has the structure: 3 stops, labels, times, kinds', cstops.length === 3 && cstops[0].label === 'Lunch by the water' && cstops[0].t_clock === '12:30' && cstops[2].resolution === 'experiential');
    ok('SL8 places resolved against Jane\u2019s catalogue: Closson reused, Drake made new (identity only), one new Mark in all',
      cstops[1].mark_uid === jc.s.uid && marksOf('jane').length === jMarks0 + 1 && !!one("SELECT 1 FROM marks WHERE uid=? AND user_id=? AND name='Drake Devonshire' AND address='24 Wharf St' AND why=''", cstops[0].mark_uid, people.jane.id));
    ok('SL9 nothing of Brian\u2019s is touched or referenced; the copy has no tie to the source', marksOf('brian').length === bMarks0 && cstops.every((x) => !x.mark_uid || one('SELECT user_id FROM marks WHERE uid=?', x.mark_uid).user_id === people.jane.id)
      && one("SELECT source_kind, source_ref FROM provenance WHERE entity_type='itinerary' AND entity_uid=? AND action='created'", copy.uid).source_kind === 'shared_itinerary');
    const cpage = await web('jane', 'GET', `/t/${copy.id}?mine=1`);
    ok('SL10 the copy says it is hers, and credits Brian only in the provenance', /This itinerary is now yours/.test(cpage.body) && new RegExp('From a plan shared by</span><span class="colo-v">@' + people.brian.handle).test(cpage.body) && !new RegExp('shared by @' + people.brian.handle).test(cpage.body.slice(0, cpage.body.indexOf('class="colophon'))),
      JSON.stringify({ mine: /This itinerary is now yours/.test(cpage.body), colo: (cpage.body.match(/<aside class="colophon[\s\S]{0,900}/) || ['no colophon'])[0].replace(/\s+/g, ' ').slice(0, 500) }));
    ok('SL11 Brian sees a count only, on his members page', /made theirs by 1/.test((await web('brian', 'GET', `/t/${gpid}/members`)).body));
    await web('brian', 'POST', `/t/${gpid}/shares/${one('SELECT uid FROM itinerary_shares WHERE token_hash=?', crypto.createHash('sha256').update(tokS).digest('hex')).uid}/revoke`, {});
    ok('SL12 revoking makes the link inert; Jane\u2019s copy is untouched', (await anon(`/s/${tokS}`)).status === 404 && !!one('SELECT 1 FROM itineraries WHERE id=?', copy.id));
    // an anonymous link
    const anonL = await web('brian', 'POST', `/t/${gpid}/share`, { show_author: '0', confirm_private: '1' });
    const tokA = (anonL.body.match(/\/s\/([A-Za-z0-9_-]{20,100})/) || [])[1];
    const av = await anon(`/s/${tokA}`);
    ok('SL13 an anonymous link never names the sharer', /A plan shared with you/.test(av.body) && !new RegExp(people.brian.handle).test(av.body.slice(av.body.indexOf('invite-card'))), JSON.stringify({ st: av.status, hit: (av.body.match(/.{40}(@brian|brian shared).{40}/) || [])[0], who: (av.body.match(/<p class="who">[^<]*/) || [])[0] }));
    const jm = await call('jane', 'my_itineraries', {});
    ok('SL14 the copy is an ordinary single-owner plan in MCP (no sharing note)', /A day in Wellington/.test(jm.text) && !/A day in Wellington[^\n]*shared/.test(jm.text));

    // ---- Welcome for arrivals through a shared plan; the Muse tile (v2.72) -------------------
    console.log('welcome');
    const newcomer = (handle) => { const id = run("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,?,'modern')", handle, handle, `${handle}@example.com`, admin.pass).lastInsertRowid;
      const sid = crypto.randomBytes(16).toString('hex'); run('INSERT INTO sessions(token,user_id) VALUES(?,?)', sid, id); people[handle] = { id: Number(id), tok: '', sid, handle }; return handle; };
    const lee = newcomer('lee');
    const invL = await web('brian', 'POST', `/t/${gpid}/invite`, { role: 'editor', confirm_private: '1' });
    await web(lee, 'POST', `/j/${(invL.body.match(/\/j\/([A-Za-z0-9_-]{20,100})/) || [])[1]}/accept`, {});
    const wl = (await web(lee, 'GET', '/?welcome=1')).body;
    ok('WA1 an invited newcomer’s Welcome says they arrived through a shared plan, opens on Connect, and leads with the plan they joined',
      /You arrived through a shared plan/.test(wl) && /id="wl-s2" class="wl-radio" checked/.test(wl) && /data-starter="joined"/.test(wl) && /Start with the plan you came for/.test(wl) && wl.includes(`/t/${one('SELECT uid FROM itineraries WHERE id=?', gpid).uid}`));
    const mo = newcomer('mo');
    await web(mo, 'POST', `/s/${tokA}/mine`, {});
    const wm = (await web(mo, 'GET', '/?welcome=1')).body;
    ok('WA2 a newcomer who copied a shared plan leads with that plan', /You arrived through a shared plan/.test(wm) && /data-starter="copied"/.test(wm));
    const wj = (await web('brian', 'GET', '/?welcome=1')).body;
    ok('WA3 an established member’s Welcome is unchanged', !/arrived through a shared plan/.test(wj));
    ok('WA4 Muse is offered beside ChatGPT, Claude and Other, with its steps', /data-ai="muse"/.test(wl) && /Secure credentials store/.test(wl) && /\/settings#connector/.test(wl) && (wl.match(/class="wl-ai[ "]/g) || []).length === 4);
    await web(mo, 'POST', '/settings/connections', { label: 'Muse' });
    const wm2 = (await web(mo, 'GET', '/?welcome=1')).body;
    ok('WA5 a connection named Muse lights the Muse tile and names Muse in the paste hint', /data-ai="muse"[^>]*>(?:(?!<\/label>).)*Connected/.test(wm2.replace(/\n/g, ' ')) && /Paste it into Muse and send/.test(wm2) && /Copy one into Muse/.test(wm2));

    // ---- links survive capitalisation (v2.74) ----------------------------------------------
    console.log('links');
    const capInv = await web('brian', 'POST', `/t/${gpid}/invite`, { role: 'viewer', confirm_private: '1' });
    const capTok = (capInv.body.match(/\/j\/([A-Za-z0-9_-]{20,100})/) || [])[1];
    ok('CL1 new link tokens are lowercase letters and digits only', /^[a-z0-9]{28}$/.test(capTok || ''), capTok);
    ok('CL2 the invitation link comes with Copy and Send buttons', /class="btn3d collab-copy" data-copy="[^"]*\/j\//.test(capInv.body) && /class="btn3d collab-send"/.test(capInv.body));
    const upper = await anon(`/J/${capTok.toUpperCase()}`);
    ok('CL3 a link capitalised in transit (/J/TOKEN) still opens the invitation', upper.status === 200 && /invite-card/.test(upper.body) && !/does not exist/.test(upper.body), upper.status + ' ' + upper.body.slice(0, 200));
    const capAcc = await web('eve', 'POST', `/J/${capTok.toUpperCase()}/accept`, {});
    ok('CL4 and can be accepted from that capitalised address', capAcc.status === 303 && !!one("SELECT 1 FROM itinerary_members WHERE itinerary_id=? AND user_id=? AND state='active'", gpid, people.eve.id));
    await web('brian', 'POST', `/t/${gpid}/members/${people.eve.id}/remove`, {}).catch(() => {});
    // a link issued before v2.74 (mixed case) still works as given, and its lowercased form does not
    const oldTok = 'AbC' + crypto.randomBytes(12).toString('hex') + 'XyZ';
    run("INSERT INTO itinerary_shares(uid,itinerary_id,created_by,token_hash,show_author) VALUES(?,?,?,?,1)", crypto.randomUUID(), gpid, people.brian.id, crypto.createHash('sha256').update(oldTok).digest('hex'));
    const oldOk = await anon(`/s/${oldTok}`), oldLower = await anon(`/s/${oldTok.toLowerCase()}`);
    ok('CL5 a pre-v2.74 mixed-case link still works exactly as issued', oldOk.status === 200 && oldLower.status === 404, `${oldOk.status}/${oldLower.status}`);

    // ---- recommended plans can't be shared (C5) -------------------------------------------
    const rec = await call('brian', 'record_recommendations', { items: [{ kind: 'itinerary', label: 'Unkept idea', workflow: 'for_another_time' }] });
    const recTarget = JSON.stringify(rec.s).match(/"target":\{"type":"itinerary","uid":"([0-9a-f-]{36})"/);
    const recPlan = one('SELECT id FROM itineraries WHERE uid=?', recTarget ? recTarget[1] : '') || { id: 0 };
    if (!recTarget) console.log('     record_recommendations structured:', JSON.stringify(rec.s).slice(0, 400));
    const recInv = await web('brian', 'POST', `/t/${recPlan.id}/invite`, { role: 'editor', confirm_private: '1' });
    ok('C5 a recommended (unkept) plan can’t be shared', /isn’t yours yet/.test(recInv.body) && !one('SELECT 1 FROM itinerary_invitations WHERE itinerary_id=?', recPlan.id));

    // ---- migration ----------------------------------------------------------------------------
    console.log('migration');
    ok('MG1 the place-identity backfill has nothing left to do (idempotent)', (() => {
      proc.kill('SIGSTOP');
      try { return JSON.parse(execFileSync(process.execPath, ['server.js', '--place-backfill-report'], { cwd: ROOT, env: { ...env, PORT: '0' } }).toString().trim().split('\n').pop()).stops === 0; }
      finally { proc.kill('SIGCONT'); }
    })());
  } catch (e) { console.error(e); fail++; } finally {
    proc.kill(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
