// Adoption (Recommendations, Increment 1; migration 052), against a running
// server and its database. Source contracts live in test/itinerary.js (K*).
//
//   1. build a pre-052 fixture: see test/fixtures/build-adoption-fixture.js
//   2. boot THIS code on that database (052 runs and backfills)
//   3. BASE=http://localhost:PORT DB_PATH=<db> node test/adoption.js
//
// Parts: B = the backfill was truthful; P = the Adopted projection and its
// privacy; T = new records and the ensemble transitions; I = invariants that
// must hold on any database (no orphans, one live adoption per record).
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const orphans = require('./orphans');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('DB_PATH is required'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(DB_PATH + '.fixture.json', 'utf8'));
const db = new DatabaseSync(DB_PATH);
const one = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  (' + x + ')' : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const rpc = async (T, name, args) => (await (await fetch(BASE + '/mcp/' + T, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
const call = async (T, name, args) => { const r = await rpc(T, name, args); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const page = async (sid, url) => { const r = await fetch(BASE + url, { headers: sid ? { cookie: 'sid=' + sid } : {}, redirect: 'manual' }); return { status: r.status, body: await r.text() }; };
const post = async (sid, url, form = {}) => fetch(BASE + url, { method: 'POST', redirect: 'manual',
  headers: { cookie: 'sid=' + sid, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

const kept = (type, uid) => !!one('SELECT 1 FROM active_adoptions WHERE subject_type=? AND subject_uid=?', type, uid);
const basis = (type, uid) => {
  const r = one(`SELECT p.fields, p.source_kind, p.assertion, a.created_at FROM adoptions a JOIN provenance p ON p.entity_type='adoption' AND p.entity_uid=a.uid
    WHERE a.subject_type=? AND a.subject_uid=? AND a.state='adopted' ORDER BY a.id DESC LIMIT 1`, type, uid);
  return r || {};
};
const noteId = (uid) => (one('SELECT id FROM objects WHERE uid=?', uid) || {}).id;
const A = fx.tokA, B = fx.tokB;

(async () => {
  // ---- B: the backfill ------------------------------------------------------
  console.log('\nbackfill (migration 052)');
  ok('B1 applied once', one("SELECT COUNT(*) n FROM schema_migrations WHERE id='052-adoptions'").n === 1);
  ok('B2 seed data: Kept, and said to have no creation provenance',
     fx.seed.length === 6 && fx.seed.every((u) => kept('object', u) && basis('object', u).fields === 'object:created_without_provenance'));
  ok('B3 ordinary Notes are Kept from the day they were made',
     [fx.notePublic, fx.notePrivate, fx.bNote].every((u) => kept('object', u) && basis('object', u).fields === 'object:created'
       && basis('object', u).created_at === one('SELECT created_at FROM objects WHERE uid=?', u).created_at));
  ok('B4 a re-note is Kept (a deliberate member act)', kept('object', fx.renote) && basis('object', fx.renote).fields === 'object:renote');
  ok('B5 Marks, including one an itinerary created (the Mark boundary), are Kept',
     kept('mark', fx.mark) && kept('mark', fx.itineraryMark) && basis('mark', fx.itineraryMark).fields === 'mark:itinerary');
  ok('B6 itineraries are Kept', kept('itinerary', fx.itinerary));
  ok('B7 a Note an Ensemble made at Keep is Kept, dated at Keep',
     kept('object', fx.keptByKeep) && basis('object', fx.keptByKeep).fields === 'object:ensemble_kept');
  const keepAt = one(`SELECT p.created_at FROM provenance p JOIN ensemble_components c ON 1 JOIN ensembles e ON e.id=c.ensemble_id
    WHERE c.note_uid=? AND p.entity_type='ensemble' AND p.entity_uid=e.uid AND p.fields='status:saved'`, fx.resolvedThenKept);
  ok('B8 a Note resolved while pending and later kept is Kept from the moment of Keep, not its creation',
     kept('object', fx.resolvedThenKept) && basis('object', fx.resolvedThenKept).fields === 'object:ensemble_kept'
     && basis('object', fx.resolvedThenKept).created_at === keepAt.created_at);
  ok('B9 a Note made for an Ensemble still pending review is NOT Kept', !kept('object', fx.pendingNote));
  ok('B10 a Note that survived its pending Ensemble’s discard is Kept, citing the discard',
     kept('object', fx.retainedNote) && basis('object', fx.retainedNote).fields === 'object:ensemble_retained');
  ok('B11 every backfilled adoption has one provenance row: derived, system, by a schema migration',
     all(`SELECT a.uid, (SELECT COUNT(*) FROM provenance p WHERE p.entity_type='adoption' AND p.entity_uid=a.uid) n,
            (SELECT p.assertion||'/'||p.actor_type||'/'||p.source_kind FROM provenance p WHERE p.entity_type='adoption' AND p.entity_uid=a.uid) k
          FROM adoptions a`).every((r) => r.n === 1 && r.k === 'derived/system/schema_migration'));

  // ---- P: the projection and its privacy -----------------------------------
  console.log('\nthe Adopted projection');
  const pid = noteId(fx.pendingNote);
  const mine = (await call(A, 'my_notes', { limit: 50 })).items || [];
  ok('P1 MCP my_notes means "the member\u2019s Notes": the unkept one is not among them', !mine.some((n) => n.uid === fx.pendingNote) && mine.some((n) => n.uid === fx.notePublic));
  ok('P2 the web corpus does not list it', !(await page(fx.sidA, '/u/elicierto?tab=notes')).body.includes('Pending piece')
     && !(await page(fx.sidA, '/')).body.includes('Pending piece') && !(await page(fx.sidA, '/?q=piece')).body.includes('>Pending piece<'));
  ok('P3 its owner still reaches it by id', (await page(fx.sidA, '/o/' + pid)).status === 200);
  // now make it public: its own flag must not publish something outside the corpus
  await call(A, 'edit_note', { id: pid, private: false });
  ok('P4 made public, it is still nobody else’s to see: page', (await page(null, '/o/' + pid)).status === 404 && (await page(fx.sidB, '/o/' + pid)).status === 404);
  const oj = await (await fetch(BASE + '/objects.json')).json();
  ok('P5 made public, it is not in /objects.json', !oj.some((o) => o.id === pid) && oj.some((o) => o.id === noteId(fx.notePublic)));
  ok('P6 made public, not in anyone’s feed or search', !(await page(fx.sidB, '/')).body.includes('Pending piece')
     && !(await page(null, '/?q=piece')).body.includes('Pending piece'));
  const img = one('SELECT image FROM objects WHERE id=?', pid).image;
  ok('P7 made public, its image stays owner-only', (await fetch(BASE + img)).status !== 200 && (await fetch(BASE + img, { headers: { cookie: 'sid=' + fx.sidA } })).status === 200, img);
  ok('P8 it cannot be re-noted (web)', (await post(fx.sidB, `/o/${pid}/note`)).status === 404);
  const rn = await rpc(B, 're_note', { id: pid });
  ok('P9 it cannot be re-noted (MCP, through the shared domain)', rn.isError === true, JSON.stringify(rn).slice(0, 120));
  ok('P10 nobody else can comment on it', (await post(fx.sidB, `/o/${pid}/comments`, { body: 'hi' })).status === 404);
  ok('P11 it cannot be filed in a collection (the shared domain)', (await rpc(A, 'edit_note', { id: pid, collections: ['Shelf'] })).isError === true
     && !one('SELECT 1 FROM note_collections WHERE note_id=?', pid));
  let trig = false; try { db.prepare("INSERT INTO collections(user_id,name,kind) VALUES(1,'Trigger check','note')").run();
    db.prepare("INSERT INTO note_collections(note_id,collection_id) VALUES(?,(SELECT id FROM collections WHERE name='Trigger check'))").run(pid); } catch (e) { trig = /kept note/.test(e.message); }
  ok('P12 ...nor by any other write path (trigger)', trig);
  const itin = one('SELECT id FROM itineraries WHERE uid=?', fx.itinerary);
  const stop = one('SELECT uid FROM itinerary_stops WHERE itinerary_id=? ORDER BY id LIMIT 1', itin.id);
  const att = await post(fx.sidA, `/t/${itin.id}/stops/${stop.uid}/notes`, { note_uid: fx.pendingNote });
  ok('P13 it cannot be attached to a Stop in an adopted plan', att.status === 400 && !one('SELECT 1 FROM itinerary_stop_notes WHERE note_id=?', pid));
  const att2 = await post(fx.sidA, `/t/${itin.id}/stops/${stop.uid}/notes`, { note_uid: fx.notePublic });
  ok('P13b a Kept Note still can', att2.status === 303 && !!one('SELECT 1 FROM itinerary_stop_notes WHERE note_id=?', noteId(fx.notePublic)));
  // independence: owning or warranting it does not Keep it
  await call(A, 'record_note_ownership', { id: pid });
  await call(A, 'warrant', { subject_type: 'note', id: pid });
  ok('P14 owning and warranting it records those, and does not Keep it (no inference)', !kept('object', fx.pendingNote)
     && !!one('SELECT 1 FROM ownership_assertions WHERE note_uid=?', fx.pendingNote) && !!one("SELECT 1 FROM warrants WHERE subject_uid=? AND state='active'", fx.pendingNote));
  // the projection honours withdrawal
  const w = fx.notePrivate;
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(1,'object',?,'withdrawn')").run(w);
  ok('P15 the projection follows the latest row: withdrawn leaves it', !one('SELECT 1 FROM adopted_objects WHERE uid=?', w));
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(1,'object',?,'adopted')").run(w);
  ok('P15b ...and adopted again brings it back, with the history kept', !!one('SELECT 1 FROM adopted_objects WHERE uid=?', w)
     && one("SELECT COUNT(*) n FROM adoptions WHERE subject_uid=?", w).n === 3);
  const bu = one("SELECT id FROM users WHERE handle='bea'").id;
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'object',?,'adopted')").run(bu, fx.pendingNote);
  ok('P16 another member’s adoption row can never put your record in your corpus', !one('SELECT 1 FROM adopted_objects WHERE uid=?', fx.pendingNote));
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(?,'object',?,'withdrawn')").run(bu, fx.notePublic);
  ok('P16b ...nor withdraw yours from it', !!one('SELECT 1 FROM adopted_objects WHERE uid=?', fx.notePublic));
  db.prepare("DELETE FROM adoptions WHERE user_id=? AND subject_uid IN (?,?)").run(bu, fx.pendingNote, fx.notePublic);   // test scaffolding only

  // ---- C: submitted MCP tools, behind unchanged contracts --------------------
  console.log('\nsubmitted MCP tools (compatibility)');
  const srch = (await call(A, 'search_catalogue', { query: 'piece', limit: 50 })).items;
  ok('C1 search_catalogue does not return the unkept Note', !srch.some((x) => x.uid === fx.pendingNote) && srch.some((x) => x.uid === fx.keptByKeep));
  const stats = await call(A, 'catalogue_stats', {});
  ok('C2 catalogue_stats counts the corpus', stats.notes === one('SELECT COUNT(*) n FROM adopted_objects WHERE user_id=1').n
     && stats.notes === one('SELECT COUNT(*) n FROM objects WHERE user_id=1').n - 1);
  const rec = (await call(B, 'recent_notes', { limit: 50 })).items;
  ok('C3 recent_notes (public) does not carry the unkept Note even though it was made public', !rec.some((x) => x.uid === fx.pendingNote) && rec.some((x) => x.uid === fx.notePublic));
  const rc = await rpc(B, 'read_comments', { subject_type: 'note', id: pid });
  ok('C4 read_comments on it refuses another member, like the page', rc.isError === true);
  const dupe = await call(A, 'note_object', { headline: 'Pending piece', image: (await call(A, 'upload_image', { image: PNG })).ref });
  ok('C5 note_object never calls the unkept Note "already noted": it makes a Kept Note, as its contract says', dupe.action === 'created' && kept('object', dupe.uid));
  const dupe2 = await rpc(A, 'note_object', { headline: 'Fixture public note', image: (await call(A, 'upload_image', { image: PNG })).ref });
  ok('C5b ...while a Kept near-duplicate is still refused exactly as before', dupe2.structuredContent && dupe2.structuredContent.action === 'unchanged');
  await call(A, 'delete_note', { id: dupe.id });
  const reuse = await call(A, 'create_pending_ensemble', { title: 'Reuse check', artifact_uid: (await call(A, 'upload_image', { image: PNG })).image_uid,
    components: [{ label: 'Pending piece', identity_basis: 'user_identity', image_uid: (await call(A, 'upload_image', { image: PNG })).image_uid }] }).catch((e) => ({ error: e.message }));
  ok('C6 identity reuse still finds an existing member record that is not Kept, without Keeping it',
     reuse.components && reuse.components[0].note_uid === fx.pendingNote && !kept('object', fx.pendingNote), JSON.stringify(reuse).slice(0, 160));
  if (reuse.ensemble_id) await call(A, 'discard_ensemble', { id: reuse.ensemble_id });
  // Marks and itineraries: none can be unkept yet (Increment 2 adds that), so
  // take one out of the corpus as scaffolding and put it back afterwards.
  const mkId = one('SELECT id FROM marks WHERE uid=?', fx.mark).id;
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(1,'mark',?,'withdrawn')").run(fx.mark);
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(1,'itinerary',?,'withdrawn')").run(fx.itinerary);
  const myMarks = (await call(A, 'my_travel_marks', { limit: 50 })).items, myIt = (await call(A, 'my_itineraries', {}));
  const st2 = await call(A, 'catalogue_stats', {});
  ok('C7 my_travel_marks excludes a Mark outside the corpus', !myMarks.some((x) => x.uid === fx.mark) && myMarks.some((x) => x.uid === fx.itineraryMark));
  ok('C8 my_itineraries excludes an itinerary outside the corpus', !JSON.stringify(myIt).includes(fx.itinerary));
  ok('C9 catalogue_stats and search exclude it too', st2.marks === stats.marks - 1
     && !(await call(A, 'search_catalogue', { query: 'Fixture place', kind: 'mark' })).items.some((x) => x.uid === fx.mark));
  ok('C10 a single-record tool still reaches its owner\u2019s record', !(await rpc(A, 'list_checkins', { mark_id: mkId })).isError);
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(1,'mark',?,'adopted')").run(fx.mark);
  db.prepare("INSERT INTO adoptions(user_id,subject_type,subject_uid,state) VALUES(1,'itinerary',?,'adopted')").run(fx.itinerary);
  ok('C11 put back, both return', (await call(A, 'my_travel_marks', { limit: 50 })).items.some((x) => x.uid === fx.mark)
     && JSON.stringify(await call(A, 'my_itineraries', {})).includes(fx.itinerary));
  const itNew = await call(A, 'create_itinerary', { title: 'Compat plan' });
  ok('C12 create_itinerary still makes a Kept itinerary', kept('itinerary', itNew.uid));

  // ---- T: new records and transitions --------------------------------------
  console.log('\nnew records');
  const n1 = await call(A, 'note_object', { headline: 'Adoption test note', image: (await call(A, 'upload_image', { image: PNG })).ref, collections: ['Adoption shelf'] });
  const p1 = one(`SELECT p.actor_type, p.source_kind FROM adoptions a JOIN provenance p ON p.entity_type='adoption' AND p.entity_uid=a.uid WHERE a.subject_uid=?`, n1.uid);
  ok('T1 a new Note is Kept as it is made, attributed to the AI acting for the member', kept('object', n1.uid) && p1.actor_type === 'ai_on_behalf' && p1.source_kind === 'created');
  ok('T1b ...and can be filed in a collection in the same act', !!one('SELECT 1 FROM note_collections WHERE note_id=?', n1.id));
  const m1 = await call(A, 'add_travel_mark', { place: 'Adoption test place', locality: 'L', country: 'C' });
  ok('T2 a new Mark is Kept', kept('mark', m1.uid));
  const it1 = await call(A, 'create_itinerary', { title: 'Adoption test plan' });
  await call(A, 'add_itinerary_stops', { itinerary_uid: it1.uid, stops: [{ label: 'x', new_place: { name: 'Adoption plan place', locality: 'L', country: 'C' } }] });
  ok('T3 a new itinerary, and a place added to it, are Kept', kept('itinerary', it1.uid) && kept('mark', one("SELECT uid FROM marks WHERE name='Adoption plan place'").uid));
  const r1 = await call(B, 're_note', { id: n1.id });
  ok('T4 a re-note is Kept', kept('object', r1.uid));
  console.log('\nensemble transitions');
  const comp = async (label) => ({ label, identity_basis: 'unidentified', image_uid: (await call(A, 'upload_image', { image: PNG })).image_uid });
  const e = await call(A, 'create_pending_ensemble', { title: 'T ensemble', artifact_uid: (await call(A, 'upload_image', { image: PNG })).image_uid,
    components: [await comp('T one'), { label: 'T two', identity_basis: 'user_identity', image_uid: (await call(A, 'upload_image', { image: PNG })).image_uid }] });
  await call(A, 'resolve_ensemble_component', { component_uid: e.components[0].component_uid, label: 'T one' });
  const t1 = one('SELECT note_uid FROM ensemble_components WHERE uid=?', e.components[0].component_uid).note_uid;
  ok('T5 resolving a piece while pending makes a Note that is not Kept', !!t1 && !kept('object', t1));
  const k = await call(A, 'keep_ensemble', { id: e.ensemble_id });
  const kp = one(`SELECT p.assertion, p.actor_type, p.source_kind, p.source_ref FROM adoptions a JOIN provenance p ON p.entity_type='adoption' AND p.entity_uid=a.uid WHERE a.subject_uid=?`, t1);
  ok('T6 Keep adopts it, derived from the Keep and citing the Ensemble', kept('object', t1) && kp.assertion === 'derived' && kp.source_kind === 'ensemble_kept' && kp.source_ref === e.ensemble_uid);
  ok('T7 Keep adopts the Note it materialises too', k.notes_created.length === 1 && kept('object', k.notes_created[0]));
  ok('T8 the frozen keep result is unchanged in shape', Array.isArray(k.notes_reused) && k.status === 'saved');
  // Decision A: from now on nothing that makes a staged Note survive makes it Kept.
  const e2 = await call(A, 'create_pending_ensemble', { title: 'T discard', artifact_uid: (await call(A, 'upload_image', { image: PNG })).image_uid,
    components: [await comp('D owned'), await comp('D warranted'), await comp('D edited'), await comp('D drop')] });
  for (const c of e2.components) await call(A, 'resolve_ensemble_component', { component_uid: c.component_uid, label: c.label });
  const [dOwn, dWar, dEd, dd] = e2.components.map((c) => one('SELECT note_uid FROM ensemble_components WHERE uid=?', c.component_uid).note_uid);
  await call(A, 'record_note_ownership', { id: noteId(dOwn) });
  await call(A, 'warrant', { subject_type: 'note', id: noteId(dWar), announce: false });
  await call(A, 'edit_note', { id: noteId(dEd), description: 'mine now' });
  const d = await call(A, 'discard_ensemble', { id: e2.ensemble_id });
  ok('T9 discarding: a Note the member recorded owning survives, NOT Kept (no Owned => Kept), owner-only',
     d.notes_kept.some((x) => x.uid === dOwn) && !!noteId(dOwn) && !kept('object', dOwn)
     && (await page(fx.sidA, '/o/' + noteId(dOwn))).status === 200 && (await page(fx.sidB, '/o/' + noteId(dOwn))).status === 404);
  ok('T9b ...likewise a warranted one (no Warrant => Kept)', d.notes_kept.some((x) => x.uid === dWar) && !kept('object', dWar));
  ok('T9c ...an edit alone is not a relationship: the edited, never-kept Note goes with the composition', !noteId(dEd) && d.notes_deleted.includes(dEd));
  ok('T10 ...the untouched one is removed, and no adoption row was ever made', !noteId(dd) && !one('SELECT 1 FROM adoptions WHERE subject_uid IN (?,?,?,?)', dOwn, dWar, dEd, dd));
  ok('T10b no orphan: each survivor is explained by the relationship the member actually recorded', orphans(db).length === 0, orphans(db).join(', '));
  const e3 = await call(A, 'create_pending_ensemble', { title: 'T delete', artifact_uid: (await call(A, 'upload_image', { image: PNG })).image_uid,
    components: [await comp('X plain')] });
  await call(A, 'resolve_ensemble_component', { component_uid: e3.components[0].component_uid, label: 'X plain' });
  const xp = one('SELECT note_uid FROM ensemble_components WHERE uid=?', e3.components[0].component_uid).note_uid;
  await call(A, 'delete_ensemble', { id: e3.ensemble_id });
  ok('T10c deleting a pending ensemble outright removes its never-kept, unexplained Notes as discard does (none left orphaned)', !noteId(xp) && orphans(db).length === 0);
  const auid = one("SELECT uid FROM adoptions WHERE subject_uid=?", n1.uid).uid;
  await call(A, 'delete_note', { id: n1.id });
  ok('T11 deleting a Note removes its adoption rows and records that it did',
     !one('SELECT 1 FROM adoptions WHERE subject_uid=?', n1.uid)
     && !!one("SELECT 1 FROM provenance WHERE entity_type='adoption' AND entity_uid=? AND action='deleted' AND source_kind='cascade' AND source_ref=?", auid, n1.uid));

  // ---- I: invariants --------------------------------------------------------
  // ---- D: commenting needs the same access as seeing -----------------------
  console.log('\ncomment authorisation (decision D)');
  const cnt = (id) => one('SELECT COUNT(*) n FROM comments WHERE object_id=?', id).n;
  const privId = noteId(fx.notePrivate), pubId = noteId(fx.notePublic);
  let c0 = cnt(privId);
  const own = await post(fx.sidA, `/o/${privId}/comments`, { body: 'owner remark' });
  ok('D1 the owner can comment on their own private note', own.status === 303 && cnt(privId) === c0 + 1);
  c0 = cnt(privId);
  const other = await post(fx.sidB, `/o/${privId}/comments`, { body: 'sneaky' });
  const anon = await fetch(BASE + `/o/${privId}/comments`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'body=anon' });
  const viaMcp = await rpc(B, 'comment', { subject_type: 'note', id: privId, body: 'sneaky' });
  ok('D2 another member cannot comment on it by id, on the web or through MCP; nor can a signed-out visitor',
     other.status === 404 && !/\/o\//.test(anon.headers.get('location') || '') && viaMcp.isError === true && cnt(privId) === c0, `${other.status} ${anon.status}`);
  const pubC = cnt(pubId);
  ok('D3 a member who can see a note can still comment on it', (await post(fx.sidB, `/o/${pubId}/comments`, { body: 'nice' })).status === 303 && cnt(pubId) === pubC + 1);
  ok('D4 a note outside its member\u2019s corpus: its owner may comment, nobody else', (await post(fx.sidA, `/o/${pid}/comments`, { body: 'mine' })).status === 303
     && (await post(fx.sidB, `/o/${pid}/comments`, { body: 'x' })).status === 404);
  // ---- B: the admin's private view reaches private CORPUS content only -----------
  console.log('\nadmin private view (decision B)');
  const bPriv = await call(B, 'note_object', { headline: 'Bea private kept', image: (await call(B, 'upload_image', { image: PNG })).ref, private: true });
  const be = await call(B, 'create_pending_ensemble', { title: 'Bea staged', artifact_uid: (await call(B, 'upload_image', { image: PNG })).image_uid,
    components: [{ label: 'Bea staged piece', identity_basis: 'unidentified', image_uid: (await call(B, 'upload_image', { image: PNG })).image_uid }] });
  await call(B, 'resolve_ensemble_component', { component_uid: be.components[0].component_uid, label: 'Bea staged piece' });
  const bStaged = noteId(one('SELECT note_uid FROM ensemble_components WHERE uid=?', be.components[0].component_uid).note_uid);
  db.prepare('UPDATE users SET admin_private_view=1 WHERE id=1').run();
  ok('B1 with the admin view on, the admin sees a member\u2019s private kept note (unchanged behaviour)', (await page(fx.sidA, '/o/' + bPriv.id)).status === 200);
  ok('B2 ...but not a member\u2019s record outside their corpus', (await page(fx.sidA, '/o/' + bStaged)).status === 404);
  const bc = cnt(bPriv.id);
  ok('B3 ...and may comment only where the admin view lets them see', (await post(fx.sidA, `/o/${bPriv.id}/comments`, { body: 'admin' })).status === 303
     && cnt(bPriv.id) === bc + 1 && (await post(fx.sidA, `/o/${bStaged}/comments`, { body: 'admin' })).status === 404);
  db.prepare('UPDATE users SET admin_private_view=0 WHERE id=1').run();
  ok('B4 with the admin view off, neither is visible to the admin', (await page(fx.sidA, '/o/' + bPriv.id)).status === 404 && (await page(fx.sidA, '/o/' + bStaged)).status === 404);

  console.log('\ninvariants');
  const orph = orphans(db);
  ok('I1 no orphans: every Note, Mark or Itinerary outside the corpus has a relationship explaining it', orph.length === 0, orph.join(', '));
  ok('I1b ...and the one such Note here is explained by its pending Ensemble', !kept('object', fx.pendingNote)
     && one("SELECT status FROM ensembles WHERE uid=?", fx.pendingEnsemble).status === 'pending_review');
  ok('I2 no adoption row points at a record that no longer exists', all(`SELECT a.subject_type t, a.subject_uid u FROM adoptions a`).every((r) =>
    !!one(`SELECT 1 FROM ${{ object: 'objects', mark: 'marks', itinerary: 'itineraries' }[r.t]} WHERE uid=?`, r.u)));
  ok('I3 every adoption row has its own provenance', one(`SELECT COUNT(*) n FROM adoptions a WHERE NOT EXISTS
    (SELECT 1 FROM provenance p WHERE p.entity_type='adoption' AND p.entity_uid=a.uid)`).n === 6   // scaffolding rows only (P15, C7-C11)
  );
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
