// MCP tool review-readiness: behaviour behind the descriptors, per tool.
// For each write: valid use, retry, invalid input, another member, and the
// side effects it may and may not have. For reads: that they change nothing
// and return nothing an AI does not need. Complements the selection
// evaluation in docs/mcp-tool-audit.md.
//
//   BASE=http://localhost:PORT DB_PATH=<db> node test/tool-audit.js
// Uses the fixture sidecar written by test/fixtures/build-adoption-fixture.js
// (A is the admin/founder, B any other member, e.g. the reviewer account).
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('DB_PATH is required'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(DB_PATH + '.fixture.json', 'utf8'));
const db = new DatabaseSync(DB_PATH);
const one = (sql, ...a) => db.prepare(sql).get(...a);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  (' + x + ')' : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const outputs = [];
const rpc = async (T, method, params) => (await (await fetch(BASE + '/mcp/' + T, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const raw = async (T, name, args) => { const r = await rpc(T, 'tools/call', { name, arguments: args }); outputs.push([name, r]); return r; };
const call = async (T, name, args) => { const r = await raw(T, name, args); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const err = async (T, name, args) => { const r = await raw(T, name, args); return r.isError ? r.content[0].text : null; };
const n = (sql, ...a) => one(sql, ...a).n;
const A = fx.tokA, B = fx.tokB;
const noteId = (uid) => one('SELECT id FROM objects WHERE uid=?', uid).id;
const markId = (uid) => one('SELECT id FROM marks WHERE uid=?', uid).id;
const kept = (t, uid) => !!one(`SELECT 1 FROM ${{ object: 'adopted_objects', mark: 'adopted_marks', itinerary: 'adopted_itineraries' }[t]} WHERE uid=?`, uid);
const tally = () => ({ notes: n('SELECT COUNT(*) n FROM objects'), marks: n('SELECT COUNT(*) n FROM marks'), visits: n('SELECT COUNT(*) n FROM visits'),
  own: n('SELECT COUNT(*) n FROM ownership_assertions'), war: n('SELECT COUNT(*) n FROM warrants'), adopt: n('SELECT COUNT(*) n FROM adoptions'),
  recs: n('SELECT COUNT(*) n FROM recommendations'), comments: n('SELECT COUNT(*) n FROM comments'), itins: n('SELECT COUNT(*) n FROM itineraries'),
  stopnotes: n('SELECT COUNT(*) n FROM itinerary_stop_notes'), colls: n('SELECT COUNT(*) n FROM note_collections') });
const diff = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => [k, b[k] - a[k]]));
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const only = (d, want) => JSON.stringify(sortKeys(d)) === JSON.stringify(sortKeys(want));

(async () => {
  // ---- reads change nothing ------------------------------------------------
  console.log('\nread-only tools change nothing');
  const t0 = tally();
  for (const [name, args] of [['my_notes', {}], ['my_travel_marks', {}], ['my_collections', {}], ['my_itineraries', {}], ['search_catalogue', { query: 'fixture' }],
    ['catalogue_stats', {}], ['recent_notes', {}], ['list_ensembles', {}], ['list_unresolved_components', {}], ['list_checkins', { mark_id: markId(fx.mark) }],
    ['read_comments', { subject_type: 'note', id: noteId(fx.notePublic) }], ['list_recommendations', { status: 'all' }], ['list_stop_notes', { itinerary_uid: fx.itinerary }],
    ['get_ensemble', { id: one('SELECT id FROM ensembles WHERE user_id=1 ORDER BY id LIMIT 1').id }],
    ['view_images', { image_uids: [one("SELECT substr(image,4) i FROM objects WHERE uid=?", fx.notePublic).i] }]]) await call(A, name, args);
  ok('RO1 every readOnlyHint tool wrote nothing', only(diff(t0, tally()), {}), JSON.stringify(diff(t0, tally())));

  // ---- Mark vs Check-in vs Keep ("Add Hatchards" / "I went there yesterday") --
  console.log('\nmark, check-in and keep stay distinct');
  let t = tally();
  const hm = await call(A, 'add_travel_mark', { place: 'Hatchards', locality: 'London', country: 'UK' });
  ok('S1 "Add Hatchards to my marks": one mark, Kept; no check-in, ownership or warrant', only(diff(t, tally()), { marks: 1, adopt: 1 }) && kept('mark', hm.uid), JSON.stringify(diff(t, tally())));
  t = tally();
  const again = await call(A, 'add_travel_mark', { place: 'Hatchards', locality: 'London', country: 'UK' });
  ok('S2 retrying it changes nothing and says so', again.action === 'unchanged' && only(diff(t, tally()), {}));
  t = tally();
  const v1 = await call(A, 'log_visit', { id: hm.id, visited_on: '2026-09-22', body: 'Bought nothing' });
  ok('S3 "I went to Hatchards yesterday": one check-in only; marking and keeping unchanged', v1.action === 'created' && only(diff(t, tally()), { visits: 1 }));
  t = tally();
  const v2 = await call(A, 'log_visit', { id: hm.id, visited_on: '2026-09-22', body: 'Bought nothing' });
  ok('S4 retrying the same check-in does not record a second visit', v2.action === 'unchanged' && v2.id === v1.id && only(diff(t, tally()), {}));
  const v3 = await call(A, 'log_visit', { id: hm.id, visited_on: '2026-09-20' });
  ok('S4b a different day is a different visit', v3.action === 'created' && v3.id !== v1.id);
  t = tally();
  const hm2 = await call(A, 'add_travel_mark', { place: 'Daunt Books Marylebone', locality: 'London', country: 'UK', visited_on: '2026-09-21' });
  ok('S5 a mark with visited_on is the explicit compound: mark + Keep + one check-in, nothing else', only(diff(t, tally()), { marks: 1, visits: 1, adopt: 1 }) && kept('mark', hm2.uid));

  // ---- Keep vs Own vs Warrant ("I bought that coffee") -------------------------
  console.log('\nkeep, own and warrant stay distinct');
  const [rc] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'Audit coffee', resolution: 'resolved', maker: 'Audit Roasters', product: 'Audit Blend',
    image_uid: (await call(A, 'upload_image', { image: PNG })).image_uid, workflow: 'for_another_time' }] })).items;
  const cid = rc.recommendation.target.id;
  t = tally();
  const o0 = await err(A, 'record_note_ownership', { id: cid });
  ok('S6 "I bought that coffee" (a recommended one): ownership alone is refused before Keep, naming keep_recommendation, and writes nothing',
     /keep_recommendation/.test(o0 || '') && only(diff(t, tally()), {}) && !kept('object', rc.recommendation.target.uid));
  t = tally();
  const k = await call(A, 'keep_recommendation', { recommendation_uid: rc.recommendation.uid });
  ok('S9 "keep it": adoption only; no ownership, warrant or check-in', k.kept.length === 1 && only(diff(t, tally()), { adopt: 1 }));
  t = tally();
  const o1 = await call(A, 'record_note_ownership', { id: cid });
  ok('S6b ...their words already say to keep it: Keep, then ownership -- ownership only, no warrant, no second Keep',
     o1.action === 'asserted' && only(diff(t, tally()), { own: 1 }) && kept('object', rc.recommendation.target.uid));
  const since = one("SELECT created_at FROM ownership_assertions WHERE note_uid=? ORDER BY id DESC LIMIT 1", rc.recommendation.target.uid).created_at;
  t = tally();
  const o2 = await call(A, 'record_note_ownership', { id: cid });
  ok('S7 saying it again records nothing and keeps the original start of ownership', o2.action === 'unchanged' && only(diff(t, tally()), {})
     && one("SELECT created_at FROM ownership_assertions WHERE note_uid=? AND state='owned' ORDER BY id DESC LIMIT 1", rc.recommendation.target.uid).created_at === since);
  await call(A, 'correct_note_ownership_mistake', { id: cid });
  ok('S8 ...so one correction really clears it, and the note stays Kept', kept('object', rc.recommendation.target.uid)
     && !one(`SELECT 1 FROM ownership_assertions a WHERE a.note_uid=? AND a.state='owned' AND NOT EXISTS (SELECT 1 FROM ownership_assertions b WHERE b.supersedes=a.uid)`, rc.recommendation.target.uid));
  t = tally();
  await call(A, 'warrant', { subject_type: 'note', id: cid, announce: false });
  const w2 = await call(A, 'warrant', { subject_type: 'note', id: cid, announce: false });
  ok('S10 warranting is its own act; a retry records nothing more', w2.action === 'unchanged' && only(diff(t, tally()), { war: 1 }));

  // ---- note vs recommendation ------------------------------------------------------
  console.log('\nnote_object vs record_recommendations');
  t = tally();
  const nb = await call(A, 'note_object', { headline: 'Audit notebook', image: (await call(A, 'upload_image', { image: PNG })).ref });
  ok('S11 note_object still means Note + Keep, nothing else', only(diff(t, tally()), { notes: 1, adopt: 1 }) && kept('object', nb.uid));
  t = tally();
  const nb2 = await call(A, 'note_object', { headline: 'Audit notebook', image: (await call(A, 'upload_image', { image: PNG })).ref });
  ok('S12 a retry is refused as already noted, and nothing is created', nb2.action === 'unchanged' && only(diff(t, tally()), {}));
  t = tally();
  const rb = await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'bookshops worth a look in London', workflow: 'destination_objects' }] });
  ok('S13 "recommend some bookshops": a recommendation only, nothing kept, no mark', only(diff(t, tally()), { recs: 1 }) && rb.items[0].recommendation.target === null);
  t = tally();
  const rb2 = await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'bookshops worth a look in London', workflow: 'destination_objects' }] });
  ok('S14 recording it again returns the same recommendation', !rb2.items[0].created && only(diff(t, tally()), {}));
  const [far] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'Hatchards (Piccadilly)', resolution: 'resolved', place_name: 'Hatchards', locality: 'Bath',
    workflow: 'for_another_time' }] })).items;
  ok('S15 same name in another city is a different place: not merged into the London mark', far.target_origin === 'created_for_recommendation' && far.recommendation.target.uid !== hm.uid);

  // ---- asking to note/mark something already recommended keeps THAT record --
  console.log('\nnote or mark something already recommended');
  const [rn] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'Audit Fountain Pen', resolution: 'resolved', product: 'Audit Fountain Pen',
    image_uid: (await call(A, 'upload_image', { image: PNG })).image_uid, workflow: 'for_another_time' }] })).items;
  t = tally();
  const kn = await call(A, 'note_object', { headline: 'Audit Fountain Pen', image: (await call(A, 'upload_image', { image: PNG })).ref });
  ok('S20 note_object on a recommended thing keeps the recommended record: no second note', kn.action === 'kept' && kn.uid === rn.recommendation.target.uid
     && kept('object', kn.uid) && only(diff(t, tally()), { adopt: 1 }));
  const [rm] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'Jikko', resolution: 'resolved', place_name: 'Jikko', locality: 'Sakai', country: 'JP',
    workflow: 'for_another_time' }] })).items;
  t = tally();
  const km = await call(A, 'add_travel_mark', { place: 'Jikko', locality: 'Sakai', country: 'JP', visited_on: '2026-09-10' });
  ok('S21 add_travel_mark on a recommended place keeps that mark (and records the visit they stated): no second mark', km.action === 'kept'
     && km.uid === rm.recommendation.target.uid && only(diff(t, tally()), { adopt: 1, visits: 1 }), JSON.stringify([km, diff(t, tally())]));

  // ---- invalid input writes nothing ------------------------------------------------
  console.log('\ninvalid input');
  t = tally();
  const bad = [
    await err(A, 'record_recommendations', { items: [{ kind: 'object', label: 'x', workflow: 'my_own_workflow' }] }),
    await err(A, 'record_recommendations', { items: [{ kind: 'gadget', label: 'x', workflow: 'cold_start' }] }),
    await err(A, 'record_recommendations', { items: [{ kind: 'object', label: 'x', resolution: 'resolved', workflow: 'cold_start' }] }),
    await err(A, 'record_recommendations', { items: [] }),
    await err(A, 'resolve_recommendation', { recommendation_uid: 'nope' }),
    await err(A, 'keep_recommendation', { recommendation_uid: rb.items[0].recommendation.uid }),
    await err(A, 'dismiss_recommendation', { recommendation_uid: rb.items[0].recommendation.uid, reason: 'meh' }),
    await err(A, 'set_stop_note', { stop_uid: 'nope', note_uid: nb.uid }),
    await err(A, 'log_visit', { id: hm.id, visited_on: '2026-02-30' }),
    await err(A, 'comment', { subject_type: 'note', id: noteId(fx.notePublic), body: '  ' })];
  ok('S16 each is refused with a reason, and nothing is written', bad.every(Boolean) && only(diff(t, tally()), {}), bad.map((b) => !!b).join(','));

  // ---- another member ---------------------------------------------------------------
  console.log('\nanother member');
  t = tally();
  const denied = [
    await err(B, 'edit_note', { id: nb.id, headline: 'x' }), await err(B, 'delete_note', { id: nb.id }),
    await err(B, 'record_note_ownership', { id: nb.id }), await err(B, 'warrant', { subject_type: 'note', id: nb.id }),
    await err(B, 'log_visit', { id: hm.id, visited_on: '2026-09-01' }), await err(B, 'edit_travel_mark', { id: hm.id, why: 'x' }),
    await err(B, 'list_checkins', { mark_id: hm.id }),
    await err(B, 'read_comments', { subject_type: 'note', id: cid }),        // private, and outside B's reach
    await err(B, 'keep_recommendation', { recommendation_uid: rc.recommendation.uid }), await err(B, 'resolve_recommendation', { recommendation_uid: rb.items[0].recommendation.uid, maker: 'x' }),
    await err(B, 'list_stop_notes', { itinerary_uid: fx.itinerary })];
  ok('S17 every write or private read on A’s records is refused for B, and nothing changes', denied.every(Boolean) && only(diff(t, tally()), {}), denied.map((d) => !!d).join(','));
  ok('S17b refusals never confirm that a private record exists', !denied.some((d) => /Audit coffee|Audit Blend/.test(d)));

  // ---- comments -----------------------------------------------------------------------
  t = tally();
  const c1 = await call(A, 'comment', { subject_type: 'note', id: noteId(fx.notePublic), body: 'Audit remark' });
  const c2 = await call(A, 'comment', { subject_type: 'note', id: noteId(fx.notePublic), body: 'Audit remark' });
  ok('S18 a retried comment is not posted twice', c1.action === 'created' && c2.action === 'unchanged' && c2.id === c1.id && only(diff(t, tally()), { comments: 1 }));

  // ---- stop notes -----------------------------------------------------------------------
  const st = one('SELECT s.uid FROM itinerary_stops s JOIN itineraries i ON i.id=s.itinerary_id WHERE i.uid=? LIMIT 1', fx.itinerary).uid;
  t = tally();
  await call(A, 'set_stop_note', { stop_uid: st, note_uid: nb.uid });
  await call(A, 'set_stop_note', { stop_uid: st, note_uid: nb.uid });
  ok('S19 attaching twice leaves one attachment; the note, ownership and keep are untouched', only(diff(t, tally()), { stopnotes: 1 }));
  await call(A, 'set_stop_note', { stop_uid: st, note_uid: nb.uid, attached: false });
  ok('S19b detaching removes only the attachment', only(diff(t, tally()), {}) && !!one('SELECT 1 FROM objects WHERE uid=?', nb.uid));

  // ---- output minimisation ------------------------------------------------------------------
  console.log('\noutput minimisation');
  const blob = JSON.stringify(outputs);
  const leaks = ['api_token', 'password', 'pass"', 'session', 'sid"', 'trace', 'request_id', 'connection_uid', 'auth_method', '@x.com', fx.tokA, fx.tokB, fx.sidA, fx.sidB]
    .filter((k) => blob.includes(k));
  ok('M1 no token, session, trace, request, connection or auth identifiers, and no email, in any result', leaks.length === 0, leaks.join(', '));
  const recOut = JSON.stringify(outputs.filter(([name]) => /recommend/.test(name)));
  ok('M2 recommendation results carry no timestamps or internal user ids', !/created_at|updated_at|user_id/.test(recOut));

  const rn2 = (await call(B, 'recent_notes', { limit: 50 })).items;
  ok('M3 recent_notes: another member\u2019s note carries no provenance (agent, timestamp); the caller\u2019s own keep theirs; field is already_renoted',
     rn2.some((x) => x.handle !== 'bea') && rn2.filter((x) => x.handle !== 'bea').every((x) => x.provenance === null)
     && rn2.filter((x) => x.handle === 'bea').every((x) => x.provenance && x.provenance.action)
     && rn2.every((x) => 'already_renoted' in x && !('already_adopted' in x)));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
