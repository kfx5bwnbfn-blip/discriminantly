// Builds a database exercising every path that creates a Note, Mark or
// Itinerary, against a RUNNING server. Used to check migration 052's backfill
// against data written by the code as it was before Adoption existed:
//
//   1. boot the pre-052 server on an empty DB_PATH with SEED=1
//   2. BASE=http://localhost:PORT DB_PATH=<same file> node test/fixtures/build-adoption-fixture.js
//   3. stop it, check out the new code, boot on the same file (052 runs)
//   4. DB_PATH=<same file> node test/adoption.js --fixture
//
// Writes <DB_PATH>.fixture.json naming the uids the checks expect in each class.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('DB_PATH is required'); process.exit(2); }
const db = new DatabaseSync(DB_PATH);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Two members with tokens and sessions, written directly: the fixture is about
// corpus records, not about sign-up.
const tokA = crypto.randomBytes(16).toString('hex'), tokB = crypto.randomBytes(16).toString('hex');
db.prepare('UPDATE users SET api_token=? WHERE id=1').run(tokA);
let b = db.prepare("SELECT id FROM users WHERE handle='bea'").get();
if (!b) {
  db.prepare("INSERT INTO users(handle,name,email,pass) VALUES('bea','Bea','bea@x.com','x:y')").run();
  b = db.prepare("SELECT id FROM users WHERE handle='bea'").get();
}
db.prepare('UPDATE users SET api_token=? WHERE id=?').run(tokB, b.id);
const sidA = crypto.randomBytes(16).toString('hex'), sidB = crypto.randomBytes(16).toString('hex');
db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,1)').run(sidA);
db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(sidB, b.id);

const call = async (T, name, args) => {
  const r = await (await fetch(BASE + '/mcp/' + T, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  if (r.result.isError) throw new Error(name + ': ' + r.result.content[0].text);
  return r.result.structuredContent;
};
const img = async (T) => (await call(T, 'upload_image', { image: PNG })).ref;
const imgUid = async (T) => (await call(T, 'upload_image', { image: PNG })).image_uid;

(async () => {
  const out = { tokA, tokB, sidA, sidB, seed: db.prepare('SELECT uid FROM objects WHERE user_id=1').all().map((r) => r.uid) };
  // plain notes and marks
  out.notePublic = (await call(tokA, 'note_object', { headline: 'Fixture public note', image: await img(tokA), collections: ['Fixture shelf'] })).uid;
  out.notePrivate = (await call(tokA, 'note_object', { headline: 'Fixture private note', image: await img(tokA), private: true })).uid;
  const bNote = await call(tokB, 'note_object', { headline: 'Bea public note', image: await img(tokB) });
  out.renote = (await call(tokA, 're_note', { id: bNote.id })).uid;
  const mk = await call(tokA, 'add_travel_mark', { place: 'Fixture place', locality: 'L', country: 'C' });
  out.mark = mk.uid;
  await call(tokA, 'log_visit', { id: mk.id, visited_on: '2026-09-01', body: 'x' });
  // an itinerary, and a Mark it created (the Mark boundary)
  const it = await call(tokA, 'create_itinerary', { title: 'Fixture plan' });
  out.itinerary = it.uid;
  await call(tokA, 'add_itinerary_stops', { itinerary_uid: it.uid, stops: [
    { label: 'Fixture new place', new_place: { name: 'Fixture itinerary place', locality: 'L', country: 'C' } }] });
  out.itineraryMark = db.prepare("SELECT uid FROM marks WHERE name='Fixture itinerary place'").get().uid;

  const comp = async (label, basis = 'user_identity') => ({ label, identity_basis: basis, image_uid: await imgUid(tokA) });
  // E1: kept directly -> Keep materialises a Note
  const e1 = await call(tokA, 'create_pending_ensemble', { title: 'Fixture kept', artifact_uid: await imgUid(tokA),
    components: [await comp('Kept piece')] });
  const k1 = await call(tokA, 'keep_ensemble', { id: e1.ensemble_id });
  out.keptByKeep = k1.notes_created[0];
  // E2: still pending, one piece resolved while pending -> a Note that is NOT corpus
  const e2 = await call(tokA, 'create_pending_ensemble', { title: 'Fixture pending', artifact_uid: await imgUid(tokA),
    components: [await comp('Pending piece', 'unidentified')] });
  await call(tokA, 'resolve_ensemble_component', { component_uid: e2.components[0].component_uid, label: 'Pending piece' });
  out.pendingNote = db.prepare("SELECT note_uid FROM ensemble_components WHERE uid=?").get(e2.components[0].component_uid).note_uid;
  out.pendingEnsemble = e2.ensemble_uid;
  // E3: resolved while pending, then kept -> corpus from the moment of Keep
  const e3 = await call(tokA, 'create_pending_ensemble', { title: 'Fixture resolved then kept', artifact_uid: await imgUid(tokA),
    components: [await comp('Resolved then kept', 'unidentified')] });
  await call(tokA, 'resolve_ensemble_component', { component_uid: e3.components[0].component_uid, label: 'Resolved then kept' });
  out.resolvedThenKept = db.prepare("SELECT note_uid FROM ensemble_components WHERE uid=?").get(e3.components[0].component_uid).note_uid;
  await call(tokA, 'keep_ensemble', { id: e3.ensemble_id });
  // E4: resolved while pending, edited (so it survives), then discarded -> retained
  const e4 = await call(tokA, 'create_pending_ensemble', { title: 'Fixture discarded', artifact_uid: await imgUid(tokA),
    components: [await comp('Retained piece', 'unidentified'), await comp('Dropped piece', 'unidentified')] });
  await call(tokA, 'resolve_ensemble_component', { component_uid: e4.components[0].component_uid, label: 'Retained piece' });
  await call(tokA, 'resolve_ensemble_component', { component_uid: e4.components[1].component_uid, label: 'Dropped piece' });
  out.retainedNote = db.prepare("SELECT note_uid FROM ensemble_components WHERE uid=?").get(e4.components[0].component_uid).note_uid;
  const retainedId = db.prepare('SELECT id FROM objects WHERE uid=?').get(out.retainedNote).id;
  await call(tokA, 'edit_note', { id: retainedId, description: 'edited while pending' });
  const d4 = await call(tokA, 'discard_ensemble', { id: e4.ensemble_id });
  if (!d4.notes_kept.some((k) => k.uid === out.retainedNote)) throw new Error('fixture: retained note was not kept on discard');
  out.bNote = bNote.uid;
  fs.writeFileSync(DB_PATH + '.fixture.json', JSON.stringify(out, null, 2));
  console.log('fixture written', DB_PATH + '.fixture.json');
})().catch((e) => { console.error(e); process.exit(1); });
