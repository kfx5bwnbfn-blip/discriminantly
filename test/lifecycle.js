// Lifecycle invariants (v2.55, Brian's items 6-8):
//   E  Recommended -> Adopted -> Editable: prospective records are not edited
//      as the member's own; editing never implies keeping.
//   L  Parent/child: adopting a parent establishes the member's relationship
//      with its identified children; after that, removing the parent never
//      removes them (or their check-ins, ownership, warrants). Before
//      adoption, prospective children may go with a discarded parent.
//   D  Child deletion de-resolves surviving parent references: the SAME Stop
//      or component moves resolved -> unresolved, keeping its identity.
//
//   BASE=http://localhost:PORT DB_PATH=<db> node test/lifecycle.js
//   ... --backfill   after the e2e runner re-ran migration 054 on this DB:
//                    checks the dangling references this script planted
// Uses the fixture sidecar written by test/fixtures/build-adoption-fixture.js.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const orphans = require('./orphans');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('DB_PATH is required'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(DB_PATH + '.fixture.json', 'utf8'));
const db = new DatabaseSync(DB_PATH);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  (' + x + ')' : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const rpc = async (T, method, params) => (await (await fetch(BASE + '/mcp/' + T, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const call = async (T, name, args) => { const r = await rpc(T, 'tools/call', { name, arguments: args }); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const err = async (T, name, args) => { const r = await rpc(T, 'tools/call', { name, arguments: args }); return r.isError ? r.content[0].text : null; };
const page = async (sid, url) => { const r = await fetch(BASE + url, { headers: sid ? { cookie: 'sid=' + sid } : {}, redirect: 'manual' }); return { status: r.status, body: await r.text() }; };
const post = async (sid, url, form) => (await fetch(BASE + url, { method: 'POST', redirect: 'manual',
  headers: { cookie: 'sid=' + sid, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })).status;
const A = fx.tokA, B = fx.tokB;
const kept = (t, uid) => !!one(`SELECT 1 FROM ${{ object: 'adopted_objects', mark: 'adopted_marks', itinerary: 'adopted_itineraries' }[t]} WHERE uid=?`, uid);
const noteRow = (uid) => one('SELECT * FROM objects WHERE uid=?', uid);
const markRow = (uid) => one('SELECT * FROM marks WHERE uid=?', uid);
const idOf = (table, uid) => one(`SELECT id FROM ${table} WHERE uid=?`, uid).id;
const stopRow = (uid) => one('SELECT * FROM itinerary_stops WHERE uid=?', uid);
const compRow = (uid) => one('SELECT * FROM ensemble_components WHERE uid=?', uid);
const prov = (type, uid) => all('SELECT * FROM provenance WHERE entity_type=? AND entity_uid=? ORDER BY id', type, uid);
const STOP_KEEP = ['uid', 'itinerary_id', 'group_id', 'position', 'visibility', 't_year', 't_period', 't_month', 't_day', 't_weekday', 't_daypart', 't_clock', 'created_at'];
const COMP_KEEP = ['uid', 'ensemble_id', 'position', 'label', 'image_uid', 'source_url', 'created_at'];
const pick = (row, keys) => JSON.stringify(keys.map((k) => row[k]));
const SIDE = DB_PATH + '.lifecycle.json';

async function backfillCheck() {
  const planted = JSON.parse(fs.readFileSync(SIDE, 'utf8'));
  console.log('\nde-resolution backfill (migration 054 re-run on this database)');
  const s = stopRow(planted.stop), c = compRow(planted.component);
  ok('DB1 a Stop left linked to a deleted Mark before 054 is de-resolved in place: same uid, particular, no mark',
     s && s.mark_uid === null && s.resolution === 'particular' && s.label === 'Backfill stop');
  ok('DB2 a component left linked to a deleted Note before 054 is de-resolved in place: same uid, unresolved, no note',
     c && c.note_uid === null && c.state === 'unresolved' && c.label === 'Backfill piece');
  const ps = prov('itinerary_stop', planted.stop).pop(), pc = prov('ensemble_component', planted.component).pop();
  ok('DB3 each gets a de_resolved row marked as a backfill, naming the deleted record; earlier history untouched',
     ps.action === 'de_resolved' && ps.source_kind === 'backfill' && ps.source_ref === planted.goneMark && ps.actor_type === 'system'
     && pc.action === 'de_resolved' && pc.source_kind === 'backfill' && pc.source_ref === planted.goneNote
     && prov('itinerary_stop', planted.stop).length === planted.stopProv + 1 && prov('ensemble_component', planted.component).length === planted.compProv + 1);
  ok('DB4 nothing else dangles', !one('SELECT 1 FROM itinerary_stops s WHERE s.mark_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM marks m WHERE m.uid=s.mark_uid)')
     && !one('SELECT 1 FROM ensemble_components c WHERE c.note_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.uid=c.note_uid)'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

(async () => {
  if (process.argv.includes('--backfill')) return backfillCheck();
  const up = await call(A, 'upload_image', { image: PNG });
  const img = up.ref, imgUid = up.image_uid;
  const pendingEnsemble = async (title, components) =>
    call(A, 'create_pending_ensemble', { title, artifact_uid: imgUid, components });

  // =========================================================================
  // E. Recommended -> Adopted -> Editable
  // =========================================================================
  console.log('\nrecommended records are not edited before they are kept');
  const [rn] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'LC recommended grinder', resolution: 'resolved',
    maker: 'Comandante', product: 'C40', image_uid: imgUid, workflow: 'for_another_time' }] })).items;
  const recNote = rn.recommendation.target.uid;
  const [rm] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'LC recommended cafe', resolution: 'resolved',
    place_name: 'LC Cafe', locality: 'Oslo', country: 'Norway', workflow: 'for_another_time' }] })).items;
  const recMark = rm.recommendation.target.uid;
  const [ri] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'LC recommended weekend', workflow: 'cold_start' }] })).items;
  const recPlan = ri.recommendation.target.uid;
  const beforeNote = JSON.stringify(noteRow(recNote)), beforeMark = JSON.stringify(markRow(recMark));
  const eN = await err(A, 'edit_note', { id: idOf('objects', recNote), headline: 'Renamed' });
  const eM = await err(A, 'edit_travel_mark', { id: idOf('marks', recMark), why: 'Because' });
  ok('E1 edit_note refuses a recommended note, points to keep_recommendation, and changes nothing',
     /recommendation/.test(eN || '') && /keep_recommendation/.test(eN) && JSON.stringify(noteRow(recNote)) === beforeNote);
  ok('E2 edit_travel_mark refuses a recommended mark, and changes nothing', /keep_recommendation/.test(eM || '') && JSON.stringify(markRow(recMark)) === beforeMark);
  const eT = await err(A, 'update_itinerary', { itinerary_uid: recPlan, title: 'Mine now' });
  const eP = await err(A, 'update_itinerary', { itinerary_uid: recPlan, private: false });
  ok('E3 update_itinerary refuses to retitle or publish a recommended plan',
     /keep_recommendation/.test(eT || '') && /keep_recommendation/.test(eP || '') && one('SELECT title, private FROM itineraries WHERE uid=?', recPlan).title === 'LC recommended weekend'
     && one('SELECT private FROM itineraries WHERE uid=?', recPlan).private === 1);
  ok('E4 a refused edit keeps nothing: the records are still outside the corpus', !kept('object', recNote) && !kept('mark', recMark) && !kept('itinerary', recPlan));
  const composed = await call(A, 'add_itinerary_stops', { itinerary_uid: recPlan, stops: [{ label: 'LC recommended cafe', mark_uid: recMark }, { label: 'A long walk', kind: 'experiential' }] });
  ok('E5 composing a recommended plan (its stops) is how a recommendation is built, and stays open', composed.stops.length === 2 && !kept('itinerary', recPlan));
  const wN = await page(fx.sidA, `/o/${idOf('objects', recNote)}/edit`), wM = await page(fx.sidA, `/m/${idOf('marks', recMark)}/edit`);
  const wNp = await post(fx.sidA, `/o/${idOf('objects', recNote)}/edit`, { name: 'Web rename' });
  const wT = await post(fx.sidA, `/t/${idOf('itineraries', recPlan)}`, { title: 'Web rename' });
  ok('E6 the web edit routes refuse them too (note and mark forms 409, plan title 400), and change nothing',
     wN.status === 409 && wM.status === 409 && wNp === 409 && wT === 400 && JSON.stringify(noteRow(recNote)) === beforeNote
     && one('SELECT title FROM itineraries WHERE uid=?', recPlan).title === 'LC recommended weekend');
  await call(A, 'keep_recommendation', { recommendation_uid: rn.recommendation.uid });
  const edited = await call(A, 'edit_note', { id: idOf('objects', recNote), description: 'Kept, then described' });
  const pn = prov('object', recNote).map((r) => r.action);
  ok('E7 once kept it is edited through the normal tool; provenance runs created (recommendation) -> kept -> edited',
     edited.action === 'edited' && kept('object', recNote) && pn[0] === 'created' && prov('object', recNote)[0].source_kind === 'recommendation' && pn[pn.length - 1] === 'edited'
     && one("SELECT 1 FROM provenance WHERE entity_type='adoption' AND action='adopted' AND fields=?", 'object:' + recNote));
  // a note made for a composition still pending review
  const pe = await pendingEnsemble('LC pending room', [{ label: 'the chair', image_uid: imgUid }]);
  await call(A, 'resolve_ensemble_component', { component_uid: pe.components[0].component_uid, label: 'LC Pending chair', identity_basis: 'user_identity' });
  const pendNote = compRow(pe.components[0].component_uid).note_uid;
  const eE = await err(A, 'edit_note', { id: idOf('objects', pendNote), headline: 'x' });
  ok('E8 a note made for a pending composition is not edited either; the refusal points to keep_ensemble', /keep_ensemble/.test(eE || '') && !kept('object', pendNote));
  // no NEW owned-but-unadopted state can be made: ownership of a staged note is refused
  const own0 = one('SELECT COUNT(*) n FROM ownership_assertions').n;
  const eOwn = await err(A, 'record_note_ownership', { id: idOf('objects', pendNote) });
  const dP = await call(A, 'discard_ensemble', { id: pe.ensemble_id });
  ok('E9 ownership of a staged note is refused (keep_ensemble first), so discarding cannot leave a new owned-but-unkept note behind',
     /keep_ensemble/.test(eOwn || '') && one('SELECT COUNT(*) n FROM ownership_assertions').n === own0 && !noteRow(pendNote) && dP.notes_deleted.includes(pendNote));

  // =========================================================================
  // R. Durable personal evidence attaches only to adopted records
  // =========================================================================
  console.log('\ncheck-in, ownership, warrant and comment need a kept record');
  const [en] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'LC evidence kettle', resolution: 'resolved', image_uid: imgUid, workflow: 'cold_start' }] })).items;
  const [em] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'LC evidence bar', resolution: 'resolved', place_name: 'LC Evidence bar', locality: 'Oslo', country: 'Norway', workflow: 'cold_start' }] })).items;
  const kNote = en.recommendation.target.uid, kMark = em.recommendation.target.uid;
  const kNoteId = idOf('objects', kNote), kMarkId = idOf('marks', kMark);
  const ev = () => JSON.stringify({ v: one('SELECT COUNT(*) n FROM visits').n, o: one('SELECT COUNT(*) n FROM ownership_assertions').n,
    w: one('SELECT COUNT(*) n FROM warrants').n, c: one('SELECT COUNT(*) n FROM comments').n + one('SELECT COUNT(*) n FROM mark_comments').n,
    a: one('SELECT COUNT(*) n FROM adoptions').n, p: one('SELECT COUNT(*) n FROM provenance').n,
    note: noteRow(kNote), mark: markRow(kMark) });
  const ev0 = ev();
  const refusals = {
    'note edit': await err(A, 'edit_note', { id: kNoteId, description: 'x' }),
    'mark edit': await err(A, 'edit_travel_mark', { id: kMarkId, why: 'x' }),
    'note comment': await err(A, 'comment', { subject_type: 'note', id: kNoteId, body: 'Lovely' }),
    'mark comment': await err(A, 'comment', { subject_type: 'mark', id: kMarkId, body: 'Lovely' }),
    'mark check-in': await err(A, 'log_visit', { id: kMarkId, visited_on: '2025-06-01' }),
    'note warrant': await err(A, 'warrant', { subject_type: 'note', id: kNoteId }),
    'mark warrant': await err(A, 'warrant', { subject_type: 'mark', id: kMarkId }),
    'note ownership': await err(A, 'record_note_ownership', { id: kNoteId }),
  };
  for (const [what, e] of Object.entries(refusals))
    ok(`R1 recommended ${what} before Keep is refused, naming keep_recommendation`, /keep_recommendation/.test(e || ''), e);
  const web = {
    'note comment': await post(fx.sidA, `/o/${kNoteId}/comments`, { body: 'Lovely' }),
    'mark comment': await post(fx.sidA, `/m/${kMarkId}/comments`, { body: 'Lovely' }),
    'mark check-in': await post(fx.sidA, `/m/${kMarkId}/checkin`, { visited_on: '2025-06-01' }),
    'note ownership': await post(fx.sidA, `/o/${kNoteId}/owned`, { intent: 'own' }),
    'mark warrant': await post(fx.sidA, `/m/${kMarkId}/warrant`, {}),
  };
  ok('R2 the web routes refuse them too (comments, ownership and warrant 409; check-in 400)', web['note comment'] === 409 && web['mark comment'] === 409
     && web['mark check-in'] === 400 && web['note ownership'] === 409 && web['mark warrant'] === 409, JSON.stringify(web));
  ok('R3 every refused attempt, MCP and web, recorded no evidence, kept nothing, changed nothing, wrote no history', ev() === ev0);
  // "I went there last year" / "I own it": Keep, then the relationship -- no implicit Keep
  await call(A, 'keep_recommendation', { recommendation_uid: em.recommendation.uid });
  const v = await call(A, 'log_visit', { id: kMarkId, visited_on: '2025-06-01', body: 'Last summer' });
  await call(A, 'keep_recommendation', { recommendation_uid: en.recommendation.uid });
  await call(A, 'record_note_ownership', { id: kNoteId });
  await call(A, 'warrant', { subject_type: 'note', id: kNoteId, announce: false });
  await call(A, 'warrant', { subject_type: 'mark', id: kMarkId, announce: false });
  const cN = await call(A, 'comment', { subject_type: 'note', id: kNoteId, body: 'Pours well' });
  const cM = await call(A, 'comment', { subject_type: 'mark', id: kMarkId, body: 'Good bar' });
  ok('R4 once kept, check-in, ownership, warrants and comments all succeed', !!v && cN.action === 'created' && cM.action === 'created'
     && one("SELECT state FROM ownership_assertions WHERE note_uid=? ORDER BY id DESC LIMIT 1", kNote).state === 'owned'
     && one("SELECT COUNT(*) n FROM warrants WHERE subject_uid IN (?, ?) AND state='active'", kNote, kMark).n === 2);
  const tl = (type, uid, rel, relUid) => {
    const ad = one("SELECT p.id FROM provenance p JOIN adoptions a ON a.uid=p.entity_uid WHERE p.entity_type='adoption' AND a.subject_uid=?", uid).id;
    return ad < one(`SELECT MIN(id) m FROM provenance WHERE entity_type=? AND entity_uid IN (${relUid.map(() => '?').join(',')})`, rel, ...relUid).m;
  };
  ok('R5 history reads Keep (from the recommendation) and THEN the relationship, never the relationship as a Keep',
     tl('mark', kMark, 'visit', [v.uid]) && tl('object', kNote, 'ownership', all('SELECT uid FROM ownership_assertions WHERE note_uid=?', kNote).map((r) => r.uid))
     && one("SELECT p.source_kind FROM provenance p JOIN adoptions a ON a.uid=p.entity_uid WHERE p.entity_type='adoption' AND a.subject_uid=?", kNote).source_kind === 'recommendation');
  const [ew] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'LC walk-in place', resolution: 'resolved', place_name: 'LC Walk-in place', locality: 'Oslo', country: 'Norway', workflow: 'cold_start' }] })).items;
  const walk = await call(A, 'add_travel_mark', { place: 'LC Walk-in place', locality: 'Oslo', country: 'Norway', visited_on: '2025-05-01' });
  ok('R6 "I went to that place you recommended" through add_travel_mark: the recommended mark is kept, then the visit recorded, in that order',
     walk.action === 'kept' && walk.uid === ew.recommendation.target.uid && kept('mark', walk.uid)
     && one('SELECT COUNT(*) n FROM visits WHERE mark_id=?', walk.id).n === 1);

  // =========================================================================
  // L. Parent/child adoption and deletion
  // =========================================================================
  console.log('\nparent adoption and independent child lifecycle');
  // L1: discard a never-adopted parent with a never-adopted child
  const p1 = await pendingEnsemble('LC discard me', [{ label: 'a stool', image_uid: imgUid }]);
  await call(A, 'resolve_ensemble_component', { component_uid: p1.components[0].component_uid, label: 'LC Prospective stool', identity_basis: 'user_identity' });
  const stool = compRow(p1.components[0].component_uid).note_uid;
  const d1 = await call(A, 'discard_ensemble', { id: p1.ensemble_id });
  ok('L1 discarding a never-kept composition cleans up its never-kept, unexplained child', !noteRow(stool) && d1.notes_deleted.includes(stool));
  // L2: adopt parent + newly adopted child -> delete parent -> child survives
  const p2 = await pendingEnsemble('LC kept room', [{ label: 'LC Wegner Wishbone chair', image_uid: imgUid, identity_basis: 'maker_model' }]);
  const k2 = await call(A, 'keep_ensemble', { id: p2.ensemble_id });
  const wish = k2.notes_created[0];
  ok('L2a keeping the composition adopts the child it introduced', !!wish && kept('object', wish));
  const d2 = await call(A, 'discard_ensemble', { id: p2.ensemble_id });
  ok('L2b discarding a KEPT composition removes the composition only; the child it brought in survives, Kept',
     !one('SELECT 1 FROM ensembles WHERE uid=?', p2.ensemble_uid) && kept('object', wish) && d2.notes_deleted.length === 0
     && d2.notes_kept.some((k) => k.uid === wish));
  const p2b = await pendingEnsemble('LC kept room two', [{ label: 'LC Eames shell', image_uid: imgUid, identity_basis: 'maker_model' }]);
  const shell = (await call(A, 'keep_ensemble', { id: p2b.ensemble_id })).notes_created[0];
  const [rp] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'LC kept then deleted plan', workflow: 'destination_objects' }] })).items;
  const plan2 = rp.recommendation.target.uid;
  const ps2 = await call(A, 'add_itinerary_stops', { itinerary_uid: plan2, stops: [{ label: 'LC Plan place', new_place: { name: 'LC Plan place', locality: 'Bergen', country: 'Norway' } }] });
  const planMark = stopRow(ps2.stops[0].uid).mark_uid;
  ok('L2d before the plan is kept, its new place is prospective (not Kept)', !kept('mark', planMark));
  await call(A, 'keep_recommendation', { recommendation_uid: rp.recommendation.uid });
  ok('L2e keeping the recommended plan adopts the place with it', kept('itinerary', plan2) && kept('mark', planMark));
  // L5 material on the adopted children, before the parents go
  const planMarkId = idOf('marks', planMark);
  await call(A, 'log_visit', { id: planMarkId, visited_on: '2026-09-01', body: 'Went' });
  await call(A, 'warrant', { subject_type: 'mark', id: planMarkId });
  await call(A, 'record_note_ownership', { id: idOf('objects', shell) });
  await call(A, 'warrant', { subject_type: 'note', id: idOf('objects', shell) });
  await call(A, 'comment', { subject_type: 'note', id: idOf('objects', shell), body: 'Sits well' });
  await call(A, 'comment', { subject_type: 'mark', id: planMarkId, body: 'Worth it' });
  const rel = () => ({ v: one('SELECT COUNT(*) n FROM visits WHERE mark_id=?', planMarkId).n,
    w: one("SELECT COUNT(*) n FROM warrants WHERE subject_uid IN (?, ?)", planMark, shell).n,
    o: one('SELECT COUNT(*) n FROM ownership_assertions WHERE note_uid=?', shell).n,
    c: one('SELECT COUNT(*) n FROM comments WHERE object_id=?', idOf('objects', shell)).n + one('SELECT COUNT(*) n FROM mark_comments WHERE mark_id=?', planMarkId).n });
  const r0 = rel();
  await call(A, 'delete_ensemble', { id: p2b.ensemble_id });
  ok('L2c deleting a kept composition leaves the child it brought in', kept('object', shell));
  await call(A, 'delete_itinerary_entity', { kind: 'itinerary', uid: plan2 });
  ok('L2f deleting the kept plan leaves the place it introduced, Kept', !one('SELECT 1 FROM itineraries WHERE uid=?', plan2) && kept('mark', planMark));
  // L3: pre-existing child
  const pre = await call(A, 'note_object', { headline: 'LC Pre-existing lamp', image: img });
  const pmark = await call(A, 'add_travel_mark', { place: 'LC Pre-existing pier', locality: 'Oslo', country: 'Norway' });
  const p3 = await pendingEnsemble('LC room with a lamp', [{ label: 'lamp', note_uid: pre.uid, image_uid: imgUid }]);
  const k3 = await call(A, 'keep_ensemble', { id: p3.ensemble_id });
  const plan3 = await call(A, 'create_itinerary', { title: 'LC plan with a pier' });
  await call(A, 'add_itinerary_stops', { itinerary_uid: plan3.uid, stops: [{ label: 'Pier', mark_uid: pmark.uid }] });
  const adoptionsPre = one("SELECT COUNT(*) n FROM adoptions WHERE subject_uid IN (?, ?)", pre.uid, pmark.uid).n;
  ok('L3a a pre-existing child is reused, not duplicated, and its relationship is not re-recorded',
     k3.notes_reused.includes(pre.uid) && k3.notes_created.length === 0 && adoptionsPre === 2);
  await call(A, 'discard_ensemble', { id: p3.ensemble_id });
  await call(A, 'delete_itinerary_entity', { kind: 'itinerary', uid: plan3.uid });
  ok('L3b deleting either parent leaves the pre-existing child, Kept', kept('object', pre.uid) && kept('mark', pmark.uid));
  // L4: adopted through A, used by B, delete A
  const pa = await pendingEnsemble('LC parent A', [{ label: 'LC Shared vase', image_uid: imgUid, identity_basis: 'maker_model' }]);
  const vase = (await call(A, 'keep_ensemble', { id: pa.ensemble_id })).notes_created[0];
  const pb = await pendingEnsemble('LC parent B', [{ label: 'vase', note_uid: vase, image_uid: imgUid }]);
  await call(A, 'keep_ensemble', { id: pb.ensemble_id });
  await call(A, 'delete_ensemble', { id: pa.ensemble_id });
  const inB = compRow(pb.components[0].component_uid);
  ok('L4 a child adopted through parent A and used by parent B survives A’s deletion, still linked in B', kept('object', vase) && inB.note_uid === vase && inB.state === 'linked');
  ok('L5 parent deletion removed no check-in, ownership, warrant or comment of the children it introduced', JSON.stringify(rel()) === JSON.stringify(r0) && r0.v === 1 && r0.w === 2 && r0.o === 1 && r0.c === 2);
  // L6: removing a child is the member's own separate act
  await call(A, 'delete_note', { id: idOf('objects', shell) });
  const del = prov('object', shell).filter((r) => r.action === 'deleted');
  ok('L6 a child goes only by its own deletion, recorded as the member’s act (no cascade row)', del.length === 1 && del[0].actor_type === 'ai_on_behalf' && del[0].source_kind !== 'cascade');
  // L7: keeping a composition adopts a linked recommended note of theirs
  const [rv] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'LC recommended tray', resolution: 'resolved', image_uid: imgUid, workflow: 'cold_start' }] })).items;
  const tray = rv.recommendation.target.uid;
  const p7 = await pendingEnsemble('LC room with a tray', [{ label: 'tray', note_uid: tray, image_uid: imgUid }]);
  ok('L7a staging a composition with a recommended note keeps nothing', !kept('object', tray));
  const e7uid = p7.ensemble_uid;
  await call(A, 'keep_ensemble', { id: p7.ensemble_id });
  const ad7 = one("SELECT p.source_kind, p.source_ref FROM provenance p JOIN adoptions a ON a.uid=p.entity_uid WHERE p.entity_type='adoption' AND a.subject_uid=?", tray);
  ok('L7b keeping it adopts the recommended note, with the composition as the context', kept('object', tray) && ad7.source_kind === 'ensemble_kept' && ad7.source_ref === e7uid
     && !!one("SELECT 1 FROM recommendations WHERE target_uid=?", tray));
  // L8: a kept parent takes only kept children
  const [rm2] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'LC recommended gallery', resolution: 'resolved', place_name: 'LC Gallery', locality: 'Oslo', country: 'Norway', workflow: 'for_another_time' }] })).items;
  const [rn2] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'LC recommended bowl', resolution: 'resolved', image_uid: imgUid, workflow: 'for_another_time' }] })).items;
  const gal = rm2.recommendation.target.uid, bowl = rn2.recommendation.target.uid;
  const keptPlan = await call(A, 'create_itinerary', { title: 'LC kept plan' });
  const ks = await call(A, 'add_itinerary_stops', { itinerary_uid: keptPlan.uid, stops: [{ label: 'Somewhere', kind: 'particular' }] });
  const e8a = await err(A, 'add_itinerary_stops', { itinerary_uid: keptPlan.uid, stops: [{ label: 'Gallery', mark_uid: gal }] });
  const e8b = await err(A, 'resolve_itinerary_stop', { stop_uid: ks.stops[0].uid, mark_uid: gal });
  const k8 = await call(A, 'keep_ensemble', { id: (await pendingEnsemble('LC kept for L8', [{ label: 'something', image_uid: imgUid }])).ensemble_id });
  const e8c = await err(A, 'resolve_ensemble_component', { component_uid: k8.components[0].component_uid, note_uid: bowl });
  const e8d = await err(A, 'add_ensemble_component', { id: k8.ensemble_id, label: 'bowl', note_uid: bowl, image_uid: imgUid });
  ok('L8a a kept plan or composition refuses an un-kept (recommended) child, pointing to keep_recommendation',
     [e8a, e8b, e8c, e8d].every((e) => /keep_recommendation/.test(e || '')) && !kept('mark', gal) && !kept('object', bowl)
     && stopRow(ks.stops[0].uid).mark_uid === null);
  const e8e = await err(A, 'add_ensemble_component', { id: k8.ensemble_id, label: noteRow(bowl).name, image_uid: imgUid });
  ok('L8c ...including when the un-kept note is only matched by name (no note_uid): no alternate path around Keep',
     /keep_recommendation/.test(e8e || '') && !kept('object', bowl) && !one('SELECT 1 FROM ensemble_components WHERE note_uid=?', bowl));
  const rp8 = await call(A, 'add_itinerary_stops', { itinerary_uid: recPlan, stops: [{ label: 'Gallery', mark_uid: gal }] });
  ok('L8b a recommended plan still takes a recommended place (composition)', rp8.stops.length === 1 && !kept('mark', gal));

  // =========================================================================
  // P. Prospective composition is not adoption; parent Keep propagates
  // =========================================================================
  console.log('\nprospective composition does not adopt; keeping the parent does');
  const [px, py] = (await call(A, 'record_recommendations', { items: [
    { kind: 'object', label: 'LC prospective jug', resolution: 'resolved', image_uid: imgUid, workflow: 'cold_start' },
    { kind: 'object', label: 'LC prospective cup', resolution: 'resolved', image_uid: imgUid, workflow: 'cold_start' }] })).items;
  const jug = px.recommendation.target.uid, cup = py.recommendation.target.uid;
  const pp = await pendingEnsemble('LC prospective table', [{ label: 'jug', note_uid: jug, image_uid: imgUid }, { label: 'cup', note_uid: cup, image_uid: imgUid },
    { label: 'the cloth', image_uid: imgUid }]);
  await call(A, 'resolve_ensemble_component', { component_uid: pp.components[2].component_uid, label: 'LC Linen cloth', identity_basis: 'user_identity' });
  const cloth = compRow(pp.components[2].component_uid).note_uid;
  ok('P1 composing a pending Ensemble (recommended pieces, a piece identified) adopts neither the Ensemble nor any piece',
     !kept('object', jug) && !kept('object', cup) && !kept('object', cloth) && one('SELECT status FROM ensembles WHERE uid=?', pp.ensemble_uid).status === 'pending_review');
  await call(A, 'keep_recommendation', { recommendation_uid: px.recommendation.uid });
  ok('P2 explicitly keeping one recommended piece adopts that piece only', kept('object', jug) && !kept('object', cup) && !kept('object', cloth)
     && one('SELECT status FROM ensembles WHERE uid=?', pp.ensemble_uid).status === 'pending_review');
  const adoptBefore = one('SELECT COUNT(*) n FROM adoptions').n;
  const dpp = await call(A, 'discard_ensemble', { id: pp.ensemble_id });
  ok('P3 discarding the unkept Ensemble adopts nothing: the kept piece stays Kept, the other recommendation stays prospective, the staged piece is cleaned up',
     one('SELECT COUNT(*) n FROM adoptions').n === adoptBefore && kept('object', jug) && !!noteRow(cup) && !kept('object', cup)
     && !noteRow(cloth) && dpp.notes_deleted.includes(cloth) && !dpp.notes_deleted.includes(jug) && !dpp.notes_deleted.includes(cup));
  const [pq] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'LC prospective saucer', resolution: 'resolved', image_uid: imgUid, workflow: 'cold_start' }] })).items;
  const saucer = pq.recommendation.target.uid;
  const pk = await pendingEnsemble('LC kept table', [{ label: 'saucer', note_uid: saucer, image_uid: imgUid }, { label: 'jug', note_uid: jug, image_uid: imgUid },
    { label: 'LC Wedgwood teapot', image_uid: imgUid, identity_basis: 'maker_model' }]);
  const jugAdoptions = one('SELECT COUNT(*) n FROM adoptions WHERE subject_uid=?', jug).n;
  const kk = await call(A, 'keep_ensemble', { id: pk.ensemble_id });
  ok('P4 keeping the Ensemble adopts its recommended piece, reuses the kept one untouched, and adopts the piece it identified, with the Ensemble as context',
     kept('object', saucer) && kk.notes_reused.includes(jug) && one('SELECT COUNT(*) n FROM adoptions WHERE subject_uid=?', jug).n === jugAdoptions
     && kk.notes_created.length === 1 && kept('object', kk.notes_created[0])
     && one("SELECT p.source_ref FROM provenance p JOIN adoptions a ON a.uid=p.entity_uid WHERE p.entity_type='adoption' AND a.subject_uid=?", saucer).source_ref === pk.ensemble_uid);
  const [pr] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'LC composed trip', workflow: 'destination_objects' }] })).items;
  const cplan = pr.recommendation.target.uid;
  await call(A, 'arrange_itinerary', { itinerary_uid: cplan, create_day: { label: 'Day 1' } });
  const cday = one('SELECT g.uid FROM itinerary_groups g JOIN itineraries i ON i.id=g.itinerary_id WHERE i.uid=?', cplan).uid;
  const cs = await call(A, 'add_itinerary_stops', { itinerary_uid: cplan, stops: [
    { label: 'LC Composed place', new_place: { name: 'LC Composed place', locality: 'Bergen', country: 'Norway' }, group_uid: cday },
    { label: 'Cup there', kind: 'experiential', group_uid: cday }, { label: 'LC recommended cafe', mark_uid: recMark }] });
  await call(A, 'update_itinerary_temporal', { target: 'stop', uid: cs.stops[0].uid, daypart: 'morning' });
  await call(A, 'set_stop_note', { stop_uid: cs.stops[1].uid, note_uid: cup });
  await call(A, 'arrange_itinerary', { itinerary_uid: cplan, order_stops: [cs.stops[1].uid, cs.stops[0].uid] });
  await call(A, 'delete_itinerary_entity', { kind: 'stop', uid: cs.stops[2].uid });
  const cmark = stopRow(cs.stops[0].uid).mark_uid;
  ok('P5 a recommended plan is built before Keep (days, new places, times, stop notes, order, removal) and nothing in it is adopted',
     !kept('itinerary', cplan) && !kept('mark', cmark) && !kept('object', cup) && !kept('mark', recMark) && !stopRow(cs.stops[2].uid));
  await call(A, 'keep_recommendation', { recommendation_uid: pr.recommendation.uid });
  ok('P6 keeping the plan adopts the plan, its place and the note under its stop', kept('itinerary', cplan) && kept('mark', cmark) && kept('object', cup));

  // =========================================================================
  // T. A Recommendation survives the deletion of its target
  // =========================================================================
  console.log('\nrecommendation target deletion');
  const [tn] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'LC doomed teapot', resolution: 'resolved', maker: 'Hario',
    product: 'Doomed teapot', image_uid: imgUid, url: 'https://example.com/doomed-teapot', workflow: 'for_another_time' }] })).items;
  const [tm] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'LC doomed bakery', resolution: 'resolved',
    place_name: 'LC Doomed bakery', locality: 'Trondheim', country: 'Norway', workflow: 'for_another_time' }] })).items;
  const tNote = tn.recommendation.target.uid, tMark = tm.recommendation.target.uid;
  await call(A, 'delete_note', { id: idOf('objects', tNote) });
  await call(A, 'delete_travel_mark', { id: idOf('marks', tMark) });
  const rN = one('SELECT * FROM recommendations WHERE uid=?', tn.recommendation.uid), rM = one('SELECT * FROM recommendations WHERE uid=?', tm.recommendation.uid);
  ok('T1 deleting a recommended note or mark leaves its Recommendation, with the target reference cleared and resolution kept',
     rN && rM && rN.target_uid === null && rM.target_uid === null && rN.resolution === 'resolved' && rM.resolution === 'resolved'
     && rN.label === 'LC doomed teapot' && rM.label === 'LC doomed bakery');
  ok('T2 what it knew stays: maker, product, link and picture; place name, locality and country',
     rN.maker === 'Hario' && rN.product === 'Doomed teapot' && rN.url === 'https://example.com/doomed-teapot' && rN.image_uid === imgUid
     && rM.place_name === 'LC Doomed bakery' && rM.locality === 'Trondheim' && rM.country === 'Norway');
  const hN = prov('recommendation', tn.recommendation.uid);
  ok('T3 its history is intact and says what happened: created, then de_resolved naming the deleted note (system, cascade)',
     hN[0].action === 'created' && hN.at(-1).action === 'de_resolved' && hN.at(-1).source_ref === tNote && hN.at(-1).actor_type === 'system'
     && /^target:object/.test(hN.at(-1).fields));
  const lv = (await call(A, 'list_recommendations', { status: 'all' })).groups.flatMap((g) => g.items).find((x) => x.uid === tn.recommendation.uid);
  ok('T4 list_recommendations shows it with no target, still resolved, known details intact', lv && lv.target === null && lv.resolution === 'resolved' && lv.known.product === 'Doomed teapot');
  const same = await call(A, 'add_travel_mark', { place: 'LC Doomed bakery', locality: 'Trondheim', country: 'Norway' });
  ok('T5 a new mark with the same name is not bound to the Recommendation', one('SELECT target_uid FROM recommendations WHERE uid=?', tm.recommendation.uid).target_uid === null
     && same.action === 'created');
  await call(A, 'resolve_recommendation', { recommendation_uid: tm.recommendation.uid, target_uid: same.uid });
  ok('T6 explicit resolution binds it again, through the normal tool', one('SELECT target_uid FROM recommendations WHERE uid=?', tm.recommendation.uid).target_uid === same.uid);
  const kt = await call(A, 'keep_recommendation', { recommendation_uid: tn.recommendation.uid });
  const again = one('SELECT target_uid FROM recommendations WHERE uid=?', tn.recommendation.uid).target_uid;
  ok('T7 Keep after the target was deleted finds or makes the record from what it knew (a new note, not the deleted one), and keeps it',
     !!again && again !== tNote && kept('object', again) && noteRow(again).image === '/i/' + imgUid && noteRow(again).url === 'https://example.com/doomed-teapot'
     && prov('recommendation', tn.recommendation.uid).some((r) => r.action === 'enriched' && /origin:created_for_recommendation/.test(r.fields || '')));
  const [ti] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'LC doomed trip', workflow: 'destination_objects' }] })).items;
  const tplan = ti.recommendation.target.uid;
  const tps = await call(A, 'add_itinerary_stops', { itinerary_uid: tplan, stops: [{ label: 'LC Doomed pier', new_place: { name: 'LC Doomed pier', locality: 'Bergen', country: 'Norway' } }] });
  const tpm = stopRow(tps.stops[0].uid).mark_uid;
  await call(A, 'delete_itinerary_entity', { kind: 'itinerary', uid: tplan });
  const eKeep = await err(A, 'keep_recommendation', { recommendation_uid: ti.recommendation.uid });
  ok('T8 a never-kept recommended plan deleted: its Recommendation survives without a target, Keep refuses to remake an empty plan, and its prospective place is left, not kept',
     one('SELECT target_uid FROM recommendations WHERE uid=?', ti.recommendation.uid).target_uid === null && /deleted/.test(eKeep || '')
     && !!markRow(tpm) && !kept('mark', tpm));
  const bl = JSON.stringify(await call(B, 'list_recommendations', { status: 'all' }));
  ok('T9 none of it reaches another member', ![tn, tm, ti].some((x) => bl.includes(x.recommendation.uid)) && !bl.includes('LC doomed'));

  // =========================================================================
  // D. Child deletion de-resolves surviving parent references
  // =========================================================================
  console.log('\nchild deletion de-resolves the parent reference');
  const m1 = await call(A, 'add_travel_mark', { place: 'LC Place One', locality: 'Oslo', country: 'Norway' });
  const itA = await call(A, 'create_itinerary', { title: 'LC plan A' }), itB = await call(A, 'create_itinerary', { title: 'LC plan B' });
  const day = await call(A, 'arrange_itinerary', { itinerary_uid: itA.uid, create_day: { label: 'Day 1' } });
  const dayUid = one('SELECT g.uid FROM itinerary_groups g JOIN itineraries i ON i.id=g.itinerary_id WHERE i.uid=?', itA.uid).uid;
  const sA = (await call(A, 'add_itinerary_stops', { itinerary_uid: itA.uid, stops: [
    { label: '', mark_uid: m1.uid, group_uid: dayUid, daypart: 'evening' },
    { label: 'Dinner at One', mark_uid: m1.uid, group_uid: dayUid }] })).stops.map((x) => x.uid);
  const sB = (await call(A, 'add_itinerary_stops', { itinerary_uid: itB.uid, stops: [{ label: 'One again', mark_uid: m1.uid }] })).stops.map((x) => x.uid);
  const attachNote = await call(A, 'note_object', { headline: 'LC Stop note', image: img });
  await call(A, 'set_stop_note', { stop_uid: sA[1], note_uid: attachNote.uid });
  const stopsBefore = [...sA, ...sB].map((u) => stopRow(u));
  const provBefore = Object.fromEntries([...sA, ...sB].map((u) => [u, prov('itinerary_stop', u).length]));
  await call(A, 'delete_travel_mark', { id: m1.id });
  const stopsAfter = [...sA, ...sB].map((u) => stopRow(u));
  ok('D1 deleting a Mark used by stops in two plans deletes no stop and no plan', stopsAfter.every(Boolean)
     && !!one('SELECT 1 FROM itineraries WHERE uid=?', itA.uid) && !!one('SELECT 1 FROM itineraries WHERE uid=?', itB.uid) && kept('itinerary', itA.uid));
  ok('D2 every stop that pointed at it is independently de-resolved in place: same uid, day, order, times; particular; no mark reference',
     stopsAfter.every((s, i) => pick(s, STOP_KEEP) === pick(stopsBefore[i], STOP_KEEP) && s.mark_uid === null && s.resolution === 'particular'));
  ok('D3 a stop that showed the mark’s name keeps it as its own label; a stop with its own label keeps that',
     stopsAfter[0].label === 'LC Place One' && stopsAfter[1].label === 'Dinner at One' && stopsAfter[2].label === 'One again');
  const dr = [...sA, ...sB].map((u) => prov('itinerary_stop', u));
  ok('D4 each stop gains one de_resolved row (system, cascade, naming the deleted mark); its earlier history stays',
     dr.every((rows, i) => rows.length === provBefore[[...sA, ...sB][i]] + 1 && rows[0].action === 'created'
       && rows.at(-1).action === 'de_resolved' && rows.at(-1).actor_type === 'system' && rows.at(-1).source_kind === 'cascade' && rows.at(-1).source_ref === m1.uid)
     && prov('mark', m1.uid).at(-1).action === 'deleted' && prov('mark', m1.uid).at(-1).actor_type === 'ai_on_behalf');
  ok('D5 what belongs to the stop stays with it: the note attached to it', one('SELECT COUNT(*) n FROM itinerary_stop_notes WHERE stop_id=?', stopsAfter[1].id).n === 1);
  const viewA = await call(A, 'my_itineraries', { uid: itA.uid });
  const vStops = JSON.stringify(viewA);
  ok('D6 my_itineraries shows the same stop uids as particular places with no mark', sA.every((u) => vStops.includes(u)) && !vStops.includes(m1.uid)
     && /"kind":"particular"/.test(vStops));
  const pgA = await page(fx.sidA, '/t/' + idOf('itineraries', itA.uid));
  ok('D7 the plan page still says it was once marked', pgA.status === 200 && pgA.body.includes('Once marked') && pgA.body.includes('LC Place One'));
  // re-resolution
  const m1b = await call(A, 'add_travel_mark', { place: 'LC Place One', locality: 'Oslo', country: 'Norway' });
  ok('D8 a new mark with the same name is not assumed to be the deleted one', stopRow(sA[0]).mark_uid === null && stopRow(sA[0]).resolution === 'particular');
  await call(A, 'resolve_itinerary_stop', { stop_uid: sA[0], mark_uid: m1b.uid });
  const hist = prov('itinerary_stop', sA[0]).map((r) => r.action);
  ok('D9 re-resolving through the normal tool links the same stop again; history reads created -> de_resolved -> resolved again',
     stopRow(sA[0]).mark_uid === m1b.uid && stopRow(sA[0]).resolution === 'linked' && hist[0] === 'created' && hist.at(-2) === 'de_resolved' && hist.at(-1) === 'edited');
  // a plan that came from a recommendation
  const [rr] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'LC recommended trip', workflow: 'destination_objects' }] })).items;
  const rplan = rr.recommendation.target.uid;
  const rs = await call(A, 'add_itinerary_stops', { itinerary_uid: rplan, stops: [{ label: 'LC Rec place', new_place: { name: 'LC Rec place', locality: 'Bergen', country: 'Norway' } }] });
  await call(A, 'keep_recommendation', { recommendation_uid: rr.recommendation.uid });
  const rmark = stopRow(rs.stops[0].uid).mark_uid;
  await call(A, 'delete_travel_mark', { id: idOf('marks', rmark) });
  const rstop = stopRow(rs.stops[0].uid);
  ok('D10 in a plan kept from a recommendation, the stop is de-resolved; the plan stays Kept and the recommendation stays as history',
     rstop && rstop.mark_uid === null && rstop.resolution === 'particular' && kept('itinerary', rplan)
     && one('SELECT target_uid FROM recommendations WHERE uid=?', rr.recommendation.uid).target_uid === rplan);

  // ensembles: one note, two compositions, public and private notes
  const n2 = await call(A, 'note_object', { headline: 'LC Public chair', image: img, private: false });
  const n3 = await call(A, 'note_object', { headline: 'LC Secret lamp', image: img, private: true });
  const e1 = await pendingEnsemble('LC room one', [{ label: 'Chair', note_uid: n2.uid, image_uid: imgUid }, { label: 'Lamp', note_uid: n3.uid, image_uid: imgUid }]);
  await call(A, 'keep_ensemble', { id: e1.ensemble_id, private: false });
  const e2 = await pendingEnsemble('LC room two', [{ label: 'Chair again', note_uid: n2.uid, image_uid: imgUid }]);
  await call(A, 'keep_ensemble', { id: e2.ensemble_id });
  const [c1, c2] = e1.components.map((c) => c.component_uid), c3 = e2.components[0].component_uid;
  // legacy components that carried no representation of their own
  db.prepare("UPDATE ensemble_components SET label='', image_uid=NULL WHERE uid IN (?, ?)").run(c1, c2);
  const gB = await call(B, 'get_ensemble', { id: e1.ensemble_id });
  const lampB = gB.components.find((c) => c.component_uid === c2);
  ok('D11 another member never sees a private note’s uid in a public composition: not in the piece, its history or the lineage',
     lampB.note_uid === null && lampB.history.every((h) => h.note_uid === null)
     && gB.artifacts.every((a) => a.lineage.every((l) => l.component_uid !== c2 || l.note_uid_at_generation === null))
     && !JSON.stringify(gB).includes(n3.uid));
  const compsBefore = [c1, c2, c3].map(compRow);
  const lineageBefore = all('SELECT lineage FROM ensemble_artifacts WHERE ensemble_id IN (?, ?)', e1.ensemble_id, e2.ensemble_id).map((r) => r.lineage).join('|');
  await call(A, 'delete_note', { id: n2.id });
  ok('D12 web deletion is covered too', await post(fx.sidA, `/o/${n3.id}/delete`, {}) === 303 && !noteRow(n3.uid));
  const compsAfter = [c1, c2, c3].map(compRow);
  ok('D13 deleting a note used by two compositions deletes no component and no composition',
     compsAfter.every(Boolean) && !!one('SELECT 1 FROM ensembles WHERE id=?', e1.ensemble_id) && !!one('SELECT 1 FROM ensembles WHERE id=?', e2.ensemble_id));
  ok('D14 every component that pointed at a deleted note is de-resolved in place: same uid, position, source; unresolved; no note reference',
     compsAfter.every((c, i) => c.uid === compsBefore[i].uid && c.position === compsBefore[i].position && c.ensemble_id === compsBefore[i].ensemble_id
       && c.state === 'unresolved' && c.note_uid === null));
  ok('D15 a component with a label of its own keeps it; one that showed a PUBLIC kept note takes its name and picture; one that showed a PRIVATE note takes nothing',
     compsAfter[2].label === 'Chair again' && compsAfter[0].label === 'LC Public chair' && compsAfter[0].image_uid === imgUid
     && compsAfter[1].label === '' && compsAfter[1].image_uid === null);
  ok('D16 generated images keep their lineage exactly as recorded at generation', all('SELECT lineage FROM ensemble_artifacts WHERE ensemble_id IN (?, ?)', e1.ensemble_id, e2.ensemble_id).map((r) => r.lineage).join('|') === lineageBefore);
  const gA = await call(A, 'get_ensemble', { id: e1.ensemble_id });
  const h1 = gA.components.find((c) => c.component_uid === c1).history.map((h) => h.action);
  ok('D17 the component history reads created -> de_resolved, and the owner sees which note it was', h1[0] === 'created' && h1.at(-1) === 'de_resolved'
     && gA.components.find((c) => c.component_uid === c1).history.at(-1).note_uid === n2.uid && gA.components.find((c) => c.component_uid === c1).state === 'unresolved');
  const gB2 = await call(B, 'get_ensemble', { id: e1.ensemble_id });
  ok('D18 another member sees the pieces as unidentified, with no trace of the deleted notes', !JSON.stringify(gB2).includes(n2.uid) && !JSON.stringify(gB2).includes(n3.uid)
     && gB2.components.every((c) => c.state === 'unresolved'));
  const un = await call(A, 'list_unresolved_components', { id: e1.ensemble_id });
  ok('D19 they are listed among the unidentified pieces, ready to resolve again', [c1, c2].every((u) => un.items.some((i) => i.component_uid === u)));
  const n2b = await call(A, 'note_object', { headline: 'LC Public chair', image: img, allow_duplicate: true });
  ok('D20 a new note with the same name is not assumed to be the deleted one', compRow(c1).note_uid === null);
  const rr2 = await call(A, 'resolve_ensemble_component', { component_uid: c1, note_uid: n2b.uid });
  const h2 = prov('ensemble_component', c1).map((r) => r.action);
  ok('D21 re-resolving the same component is a fresh resolution after the de-resolution, not a silent correction',
     rr2.action === 'resolved' && compRow(c1).note_uid === n2b.uid && h2.at(-2) === 'de_resolved' && h2.at(-1) === 'resolved');
  // privacy: a stop failing closed on a public plan stays closed
  const pm = await call(A, 'add_travel_mark', { place: 'LC Hidden place', locality: 'Oslo', country: 'Norway' });
  const pubPlan = await call(A, 'create_itinerary', { title: 'LC public plan', private: false });
  const ps = await call(A, 'add_itinerary_stops', { itinerary_uid: pubPlan.uid, stops: [{ label: '', mark_uid: pm.uid }] });
  db.prepare('UPDATE marks SET private=1 WHERE uid=?').run(pm.uid);           // legacy state: a private mark on a public plan
  const pubId = idOf('itineraries', pubPlan.uid);
  const before = await page(fx.sidB, '/t/' + pubId);
  await post(fx.sidA, `/m/${pm.id}/delete`, {});
  const after = await page(fx.sidB, '/t/' + pubId);
  ok('D22 a stop whose private mark was failing closed on a public plan is suspended on deletion, not suddenly shown',
     before.status === 200 && !before.body.includes('LC Hidden place') && after.status === 200 && !after.body.includes('LC Hidden place')
     && stopRow(ps.stops[0].uid).visibility === 'suspended' && stopRow(ps.stops[0].uid).label === 'LC Hidden place');

  // no orphans after all of it
  const o = orphans(db);
  ok('I1 no orphans: every record outside the corpus is still explained', o.length === 0, o.join(', '));

  // plant dangling references as the code before 054 would have left them, for --backfill
  const gm = 'lc-gone-mark-' + Date.now(), gn = 'lc-gone-note-' + Date.now();
  const bs = (await call(A, 'add_itinerary_stops', { itinerary_uid: itA.uid, stops: [{ label: 'Backfill stop', kind: 'particular' }] })).stops[0].uid;
  db.prepare("UPDATE itinerary_stops SET mark_uid=?, resolution='linked' WHERE uid=?").run(gm, bs);
  const be = await pendingEnsemble('LC backfill room', [{ label: 'Backfill piece', image_uid: imgUid }]);
  const bc = be.components[0].component_uid;
  db.prepare("UPDATE ensemble_components SET note_uid=?, state='linked' WHERE uid=?").run(gn, bc);
  fs.writeFileSync(SIDE, JSON.stringify({ stop: bs, component: bc, goneMark: gm, goneNote: gn,
    stopProv: prov('itinerary_stop', bs).length, compProv: prov('ensemble_component', bc).length }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('lifecycle test error:', e.message); process.exit(2); });
