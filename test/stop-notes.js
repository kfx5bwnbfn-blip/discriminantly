// Stop -> Note behaviour, against a running server with two members.
// Set up as in /tmp/sn.sh (docs): an admin (TA, cookie /tmp/cjA) and a member
// (TB, cookie /tmp/cjB), plus /tmp/itin-before.json captured before upgrade.
const fs = require('fs'); const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('data/discriminantly.db');
const B = 'http://localhost:3000';
const call = async (T, n, a) => (await (await fetch(B + '/mcp/' + T, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: n, arguments: a } }) })).json()).result;
const sid = (f) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.includes('\tsid\t')).split('\t').pop().trim();
const SA = sid('/tmp/cjA'), SB = sid('/tmp/cjB');
const post = async (cookie, url, form = {}) => (await fetch(B + url, { method: 'POST', headers: { cookie: 'sid=' + cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), redirect: 'manual' }));
const page = async (cookie, url) => (await fetch(B + url, { headers: cookie ? { cookie: 'sid=' + cookie } : {} })).text();
const one = (sql, ...a) => db.prepare(sql).get(...a); const all = (sql, ...a) => db.prepare(sql).all(...a);
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x ? '  (' + x + ')' : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async () => {
  const TA = process.env.TA, TB = process.env.TB;
  // existing itinerary and its AI-facing output must be unchanged
  const before = JSON.parse(fs.readFileSync('/tmp/itin-before.json', 'utf8'));
  const after = (await call(TA, 'my_itineraries', { uid: before.uid })).structuredContent;
  ok('existing itinerary: my_itineraries output identical after the upgrade (MCP contract untouched)', JSON.stringify(before) === JSON.stringify(after));
  const it = one('SELECT * FROM itineraries WHERE uid=?', before.uid);
  const [sA, sB2] = all('SELECT * FROM itinerary_stops WHERE itinerary_id=? ORDER BY id', it.id);
  const htmlBefore = await page(null, '/t/' + it.id);
  ok('existing itineraries have no child notes and render none', !htmlBefore.includes('stop-notes') && one('SELECT count(*) n FROM itinerary_stop_notes').n === 0);
  // notes: A has a public and a private note; B has a private and a public note
  const mk = async (T, h, priv) => (await call(T, 'note_object', { headline: h, image: (await call(T, 'upload_image', { image: PNG })).structuredContent.ref, private: priv, link: 'https://example.com/' + h.replace(/\W/g, '') })).structuredContent;
  const nPub = await mk(TA, 'Kona Peaberry Medium Roast', false), nPriv = await mk(TA, 'Gift for Jane', true);
  const bPriv = await mk(TB, 'Bea secret', true), bPub = await mk(TB, 'Bea public', false);
  const noteBefore = one('SELECT * FROM objects WHERE id=?', nPub.id);
  const counts = () => ({ own: one('SELECT count(*) n FROM ownership_assertions').n, war: one('SELECT count(*) n FROM warrants').n, vis: one('SELECT count(*) n FROM visits').n, notes: one('SELECT count(*) n FROM objects').n });
  const c0 = counts();
  // attach
  let r = await post(SA, `/t/${it.id}/stops/${sA.uid}/notes`, { note_uid: nPub.uid });
  const att = one('SELECT * FROM itinerary_stop_notes WHERE stop_id=? AND note_id=?', sA.id, nPub.id);
  ok('attach an existing note to a stop', r.status === 303 && !!att && !!att.uid);
  const pv = all('SELECT action, actor_type, source_kind, source_ref FROM provenance WHERE entity_uid=?', att.uid);
  ok('attach is recorded: created, by the user, existing note, pointing at the note', pv.length === 1 && pv[0].action === 'created' && pv[0].actor_type === 'user' && pv[0].source_kind === 'existing_note' && pv[0].source_ref === nPub.uid, JSON.stringify(pv));
  r = await post(SA, `/t/${it.id}/stops/${sA.uid}/notes`, { note_uid: nPub.uid });
  ok('attaching the same note again is idempotent: one row, no second history entry', r.status === 303 && one('SELECT count(*) n FROM itinerary_stop_notes WHERE stop_id=? AND note_id=?', sA.id, nPub.id).n === 1 && all('SELECT 1 FROM provenance WHERE entity_uid=?', att.uid).length === 1);
  const c1 = counts();
  ok('attaching creates no note, ownership, warrant or check-in', JSON.stringify(c0) === JSON.stringify(c1), JSON.stringify(c1));
  const noteAfter = one('SELECT * FROM objects WHERE id=?', nPub.id);
  ok('the note itself is untouched and keeps its identity', JSON.stringify(noteBefore) === JSON.stringify(noteAfter));
  // the same note on a second stop and in a second itinerary
  const it2 = (await call(TA, 'create_itinerary', { title: 'Second plan' })).structuredContent;
  await call(TA, 'add_itinerary_stops', { itinerary_uid: it2.uid, stops: [{ label: 'Somewhere', kind: 'particular' }] });
  const s2 = one('SELECT * FROM itinerary_stops WHERE itinerary_id=(SELECT id FROM itineraries WHERE uid=?)', it2.uid);
  const it2id = one('SELECT id FROM itineraries WHERE uid=?', it2.uid).id;
  await post(SA, `/t/${it.id}/stops/${sB2.uid}/notes`, { note_uid: nPub.uid });
  await post(SA, `/t/${it2id}/stops/${s2.uid}/notes`, { note_uid: nPub.uid });
  ok('one note may sit under several stops and itineraries without being duplicated', one('SELECT count(*) n FROM itinerary_stop_notes WHERE note_id=?', nPub.id).n === 3 && counts().notes === c0.notes);
  // retrieval: the note renders inside its stop, as a child row linking to the note
  const html = await page(SA, '/t/' + it.id);
  const li = html.slice(html.indexOf(`data-stop="${sA.uid}"`), html.indexOf('</li></ul>', html.indexOf(`data-stop="${sA.uid}"`)) + 10);
  ok('itinerary page shows the note inside its stop, linking to the note', li.includes('class="ens-comps stop-notes"') && li.includes(`href="/o/${nPub.id}"`) && li.includes('Kona Peaberry Medium Roast') && li.includes('Worth noticing here'));
  ok('the child row is not a stop (no data-stop, not a stop card)', !/class="[^"]*stop-note[^"]*"[^>]*data-stop/.test(html) && !(html.match(/stop-note"/g) || []).some(() => false));
  // unrelated stop edits keep the attachment
  await post(SA, `/t/${it.id}/stops/${sA.uid}`, { label: 'Coffee producer (renamed)', t_daypart: 'morning' });
  ok('editing the stop (wording, time of day) keeps its notes', one('SELECT label FROM itinerary_stops WHERE id=?', sA.id).label === 'Coffee producer (renamed)' && !!one('SELECT 1 FROM itinerary_stop_notes WHERE stop_id=? AND note_id=?', sA.id, nPub.id));
  // privacy
  await post(SA, `/t/${it.id}/stops/${sA.uid}/notes`, { note_uid: nPriv.uid });
  const own = await page(SA, '/t/' + it.id), other = await page(SB, '/t/' + it.id), anon = await page(null, '/t/' + it.id);
  ok('a private note on a published plan: owner sees it; another member and signed-out visitors do not', own.includes('Gift for Jane') && !other.includes('Gift for Jane') && !anon.includes('Gift for Jane'));
  ok('a public note on a published plan is visible to others', other.includes('Kona Peaberry Medium Roast') && anon.includes('Kona Peaberry Medium Roast'));
  ok('others get no attach or detach controls', !other.includes('stop-note-attach') && !other.includes('stop-note-detach') && !anon.includes('stop-note-detach'));
  // authorisation
  r = await post(SA, `/t/${it.id}/stops/${sA.uid}/notes`, { note_uid: bPriv.uid });
  const t1 = await r.text();
  r = await post(SA, `/t/${it.id}/stops/${sA.uid}/notes`, { note_uid: bPub.uid });
  const t2 = await r.text();
  ok("attaching another member's note is refused the same way, private or public (reveals nothing)", t1 === 'No such note.' && t2 === 'No such note.' && !one('SELECT 1 FROM itinerary_stop_notes WHERE note_id IN (?,?)', bPriv.id, bPub.id));
  r = await post(SB, `/t/${it.id}/stops/${sA.uid}/notes`, { note_uid: bPub.uid });
  ok("another member cannot attach to someone else's stop", r.status === 400 && (await r.text()) === 'No such stop.');
  r = await post(SB, `/t/${it.id}/stops/${sA.uid}/notes/${nPub.uid}/delete`);
  ok("another member cannot detach from someone else's stop", r.status === 400 && !!one('SELECT 1 FROM itinerary_stop_notes WHERE stop_id=? AND note_id=?', sA.id, nPub.id));
  // detach
  const attPriv = one('SELECT uid FROM itinerary_stop_notes WHERE stop_id=? AND note_id=?', sA.id, nPriv.id).uid;
  r = await post(SA, `/t/${it.id}/stops/${sA.uid}/notes/${nPriv.uid}/delete`);
  const dv = all('SELECT action, actor_type, source_ref FROM provenance WHERE entity_uid=? ORDER BY id', attPriv);
  ok('detach removes only the attachment, keeps the note, and is recorded with the user as actor', !one('SELECT 1 FROM itinerary_stop_notes WHERE uid=?', attPriv) && !!one('SELECT 1 FROM objects WHERE id=?', nPriv.id) && dv.at(-1).action === 'deleted' && dv.at(-1).actor_type === 'user' && dv.at(-1).source_ref === sA.uid, JSON.stringify(dv));
  // deleting a stop / itinerary / note
  const attS2 = one('SELECT uid FROM itinerary_stop_notes WHERE stop_id=?', sB2.id).uid;
  await post(SA, `/t/${it.id}/stops/${sB2.uid}/delete`);
  ok('deleting a stop removes its attachments, never the note, and records them', !one('SELECT 1 FROM itinerary_stop_notes WHERE uid=?', attS2) && !!one('SELECT 1 FROM objects WHERE id=?', nPub.id) && one("SELECT source_kind k, source_ref r FROM provenance WHERE entity_uid=? AND action='deleted'", attS2).k === 'cascade');
  const attIt2 = one('SELECT uid FROM itinerary_stop_notes WHERE stop_id=?', s2.id).uid;
  await call(TA, 'delete_itinerary_entity', { kind: 'itinerary', uid: it2.uid });
  ok('deleting an itinerary removes its attachments, never the note, and records them', !one('SELECT 1 FROM itinerary_stop_notes WHERE uid=?', attIt2) && !!one('SELECT 1 FROM objects WHERE id=?', nPub.id) && one("SELECT source_kind k FROM provenance WHERE entity_uid=? AND action='deleted'", attIt2).k === 'cascade');
  const attA = one('SELECT uid FROM itinerary_stop_notes WHERE stop_id=? AND note_id=?', sA.id, nPub.id).uid;
  await call(TA, 'delete_note', { id: nPub.id });
  const pageAfterNoteDelete = await fetch(B + '/t/' + it.id, { headers: { cookie: 'sid=' + SA } });
  ok('deleting the note leaves no attachment behind, records it, and the plan still renders', !one('SELECT 1 FROM itinerary_stop_notes WHERE uid=?', attA) && one("SELECT source_kind k, source_ref r FROM provenance WHERE entity_uid=? AND action='deleted'", attA).r === nPub.uid && pageAfterNoteDelete.status === 200);
  ok('no orphaned attachments anywhere', one('SELECT count(*) n FROM itinerary_stop_notes a LEFT JOIN objects o ON o.id=a.note_id LEFT JOIN itinerary_stops s ON s.id=a.stop_id WHERE o.id IS NULL OR s.id IS NULL').n === 0);
  console.log(`\n${pass} passed, ${fail} failed`);
})();
