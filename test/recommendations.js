// Recommendation (Increment 2, migration 053) and the additive MCP tools
// (Increment 3), against a running server and its database, driven the way an
// AI client drives it. Walks the founder dogfood loop end to end:
//
//   Skill selects -> recommend -> Recommended -> resolve -> keep -> adopted
//   corpus, with the Recommendation kept as history and Owned / Check-in /
//   Warrant untouched.
//
//   BASE=http://localhost:PORT DB_PATH=<db> node test/recommendations.js
// Uses the fixture sidecar written by test/fixtures/build-adoption-fixture.js.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('DB_PATH is required'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(DB_PATH + '.fixture.json', 'utf8'));
const db = new DatabaseSync(DB_PATH);
const one = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  (' + x + ')' : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// One MCP surface, /mcp, for every connection (v2.55).
const MCP = '/mcp/';
const rpc = async (T, name, args, path = MCP) => (await (await fetch(BASE + path + T, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
const call = async (T, name, args) => { const r = await rpc(T, name, args); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const errOf = async (T, name, args) => { const r = await rpc(T, name, args); return r.isError ? r.content[0].text : null; };
const page = async (sid, url) => (await fetch(BASE + url, { headers: sid ? { cookie: 'sid=' + sid } : {}, redirect: 'manual' })).status;
const kept = (type, uid) => !!one(`SELECT 1 FROM ${{ object: 'adopted_objects', mark: 'adopted_marks', itinerary: 'adopted_itineraries' }[type]} WHERE uid=?`, uid);
const A = fx.tokA, B = fx.tokB;
const img = async () => (await call(A, 'upload_image', { image: PNG })).image_uid;
const counts = () => ({ own: one('SELECT COUNT(*) n FROM ownership_assertions').n, war: one('SELECT COUNT(*) n FROM warrants').n,
  vis: one('SELECT COUNT(*) n FROM visits').n, derived: one('SELECT COUNT(*) n FROM derived_relations').n });

(async () => {
  const post = (T, path, body) => fetch(BASE + path + T, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }) });
  const list = async (T, path = MCP) => (await (await post(T, path, { method: 'tools/list' })).json()).result.tools.map((t) => t.name);
  const instr = async (T, path = MCP) => (await (await post(T, path, { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()).result.instructions;
  const tools = await list(A);
  // B stands in for any other member. Every tool reaches every member, so the
  // cross-member checks test the DOMAIN's own refusals.
  const asAdmin = () => {};
  console.log('\nadditive tools');
  const bTools = await list(B);
  ok('R0 /mcp lists all 67 tools (v2.58-v2.60 additions included), the recommendation and stop-note tools among them, for every connection alike',
     ['record_recommendations', 'resolve_recommendation', 'list_recommendations', 'keep_recommendation', 'dismiss_recommendation', 'set_stop_note', 'list_stop_notes', 'resolve_travel_mark', 'audit_itinerary', 'audit_recommendation_expansion', 'build_itinerary', 'keep_record', 'clear_prospective_leftovers'].every((n) => tools.includes(n))
     && tools.length === 67 && JSON.stringify(tools) === JSON.stringify(bTools), String(tools.length));
  ok('R0b the server instructions carry the RECOMMENDATIONS paragraph for every connection',
     /RECOMMENDATIONS\./.test(await instr(A)) && (await instr(A)).split('\n').slice(1).join('\n') === (await instr(B)).split('\n').slice(1).join('\n'));
  ok('R0c there is no second, developer-only endpoint', (await post(A, '/mcp-dev/', { method: 'tools/list' })).status === 404);
  const c0 = counts();
  const notesBefore = (await call(A, 'catalogue_stats', {})).notes;

  // ---- progressive resolution, "for another time" --------------------------
  console.log('\nprogressive resolution');
  const [r1] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'medium-roast Kaʻu coffee', workflow: 'for_another_time',
    rationale: 'You keep coming back to Hawaiian coffees.', evidence_uids: [fx.notePublic] }] })).items;
  ok('R1 an unresolved proposition is recorded as exactly that: no record, nothing kept',
     r1.created && r1.recommendation.resolution === 'unresolved' && r1.recommendation.target === null && r1.recommendation.status === 'open');
  asAdmin(true);
  ok('R1b it is private to its member, rationale and evidence included', /No such recommendation/.test(await errOf(B, 'resolve_recommendation', { recommendation_uid: r1.recommendation.uid, maker: 'x' }))
     && (await call(B, 'list_recommendations', {})).total === 0);
  asAdmin(false);
  const p1 = await call(A, 'resolve_recommendation', { recommendation_uid: r1.recommendation.uid, resolution: 'partial', maker: 'Kaʻu Coffee Mill' });
  ok('R2 partial: the producer is known, the product is not, and that is kept as the truth', p1.recommendation.resolution === 'partial'
     && p1.recommendation.known.maker === 'Kaʻu Coffee Mill' && !p1.recommendation.known.product && p1.recommendation.target === null
     && p1.recommendation.label === 'medium-roast Kaʻu coffee');
  ok('R2b it cannot be kept until it is a specific thing', /resolve it to a specific thing/.test(await errOf(A, 'keep_recommendation', { recommendation_uid: r1.recommendation.uid })));
  ok('R2c resolution never goes backwards', /only ever gains precision/.test(await errOf(A, 'resolve_recommendation', { recommendation_uid: r1.recommendation.uid, resolution: 'unresolved' })));
  const p2 = await call(A, 'resolve_recommendation', { recommendation_uid: r1.recommendation.uid, resolution: 'resolved', product: 'Medium Roast', variant: '7 oz', image_uid: await img() });
  const coffee = p2.recommendation.target;
  ok('R3 resolved: it gets a private record of its own that is NOT kept', coffee && coffee.type === 'note' && !coffee.kept
     && one('SELECT private FROM objects WHERE uid=?', coffee.uid).private === 1 && coffee.name === 'Kaʻu Coffee Mill Medium Roast, 7 oz');
  ok('R3b every step is its own enriched provenance row, naming the fields', all(`SELECT action, fields FROM provenance WHERE entity_type='recommendation' AND entity_uid=? ORDER BY id`, r1.recommendation.uid)
     .map((r) => r.action).join(',') === 'created,enriched,enriched');

  // ---- isolation: existing tools and pages do not see it ------------------
  console.log('\nisolation from the adopted corpus');
  ok('R4 my_notes, search_catalogue, catalogue_stats and recent_notes do not see it',
     !(await call(A, 'my_notes', { limit: 50 })).items.some((n) => n.uid === coffee.uid)
     && !(await call(A, 'search_catalogue', { query: 'Medium Roast' })).items.some((n) => n.uid === coffee.uid)
     && (await call(A, 'catalogue_stats', {})).notes === notesBefore
     && !(await call(B, 'recent_notes', { limit: 50 })).items.some((n) => n.uid === coffee.uid));
  ok('R4b its owner can open it; nobody else can', await page(fx.sidA, '/o/' + coffee.id) === 200 && await page(fx.sidB, '/o/' + coffee.id) === 404 && await page(null, '/o/' + coffee.id) === 404);
  ok('R4c an old client’s note_object on the same thing is refused as a duplicate of nothing: it makes a Kept note, as it always has',
     (await call(A, 'note_object', { headline: 'Some other kept thing', image: (await call(A, 'upload_image', { image: PNG })).ref })).action === 'created');

  // ---- reuse: an existing record gains the recommendation --------------------
  console.log('\nreuse, never duplicate');
  const marksBefore = one('SELECT COUNT(*) n FROM marks').n;
  const [h1] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'Fixture place', resolution: 'resolved', target_uid: fx.mark,
    workflow: 'destination_objects', context_itinerary_uid: fx.itinerary }] })).items;
  ok('R5 recommending something they already have points at it: nothing new is made', h1.target_origin === 'pre_existing'
     && h1.recommendation.target.uid === fx.mark && h1.recommendation.target.kept && one('SELECT COUNT(*) n FROM marks').n === marksBefore);
  const [h2] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'the Fixture place again', resolution: 'resolved', place_name: 'Fixture place', locality: 'L',
    workflow: 'for_another_time' }] })).items;
  ok('R5b a resolved place is matched to their existing mark rather than duplicated', h2.target_origin === 'pre_existing' && h2.recommendation.target.uid === fx.mark
     && one('SELECT COUNT(*) n FROM marks').n === marksBefore);
  const [h3] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'Fixture place', resolution: 'resolved', target_uid: fx.mark,
    workflow: 'destination_objects', context_itinerary_uid: fx.itinerary }] })).items;
  ok('R5c the same proposition in the same context is the same assertion, returned not repeated', !h3.created && h3.recommendation.uid === h1.recommendation.uid);

  // ---- evidence is canonical only ---------------------------------------------
  console.log('\nnever taste evidence');
  ok('R6 a recommendation cannot be cited as evidence', /never evidence/.test(await errOf(A, 'record_recommendations', { items: [{ kind: 'object', label: 'x', workflow: 'cold_start', evidence_uids: [r1.recommendation.uid] }] })));
  ok('R6b nor can a record that exists only because of one', /never evidence/.test(await errOf(A, 'record_recommendations', { items: [{ kind: 'object', label: 'y', workflow: 'cold_start', evidence_uids: [coffee.uid] }] })));
  ok('R6c a failed batch writes nothing', !one("SELECT 1 FROM recommendations WHERE label IN ('x','y')"));

  // ---- keep ----------------------------------------------------------------------
  console.log('\nkeep');
  const k1 = await call(A, 'keep_recommendation', { recommendation_uid: r1.recommendation.uid });
  ok('R7 keeping brings the same note into the corpus; the recommendation stays as history', k1.kept.length === 1 && k1.kept[0].uid === coffee.uid && kept('object', coffee.uid)
     && k1.recommendation.status === 'kept' && (await call(A, 'my_notes', { limit: 50 })).items.some((n) => n.uid === coffee.uid)
     && (await call(A, 'catalogue_stats', {})).notes === notesBefore + 2);
  ok('R7b the adoption cites the recommendation and the AI acting for the member', !!one(`SELECT 1 FROM adoptions a JOIN provenance p ON p.entity_type='adoption' AND p.entity_uid=a.uid
     WHERE a.subject_uid=? AND p.source_kind='recommendation' AND p.source_ref=? AND p.actor_type='ai_on_behalf'`, coffee.uid, r1.recommendation.uid));
  ok('R7c keeping twice changes nothing', (await call(A, 'keep_recommendation', { recommendation_uid: r1.recommendation.uid })).kept.length === 0);
  const c1 = counts();
  ok('R8 independence: no ownership, warrant, check-in or derived relation came with any of it', JSON.stringify(c0) === JSON.stringify(c1), JSON.stringify([c0, c1]));

  // ---- dismiss --------------------------------------------------------------------
  const [d1] = (await call(A, 'record_recommendations', { items: [{ kind: 'experience', label: 'manta night snorkel', resolution: 'partial', maker: 'An operator on the Kona coast',
    workflow: 'destination_objects', context_itinerary_uid: fx.itinerary }] })).items;
  ok('R9 an experience with its operator known and its offering not is a valid partial recommendation', d1.recommendation.resolution === 'partial' && d1.recommendation.target === null);
  const dd = await call(A, 'dismiss_recommendation', { recommendation_uid: d1.recommendation.uid, reason: 'not_this_trip' });
  ok('R9b "not this trip" is recorded as exactly that; the open list leaves it out; nothing is deleted', dd.recommendation.status === 'not_this_trip' && dd.recommendation.reaction === 'not_this_trip'
     && !JSON.stringify(await call(A, 'list_recommendations', {})).includes(d1.recommendation.uid)
     && JSON.stringify(await call(A, 'list_recommendations', { status: 'not_this_trip' })).includes(d1.recommendation.uid)
     && !JSON.stringify(await call(A, 'list_recommendations', { status: 'not_for_me' })).includes(d1.recommendation.uid));
  const [d2] = (await call(A, 'record_recommendations', { items: [{ kind: 'place', label: 'a loud rooftop bar', workflow: 'for_another_time' }] })).items;
  const dd2 = await call(A, 'dismiss_recommendation', { recommendation_uid: d2.recommendation.uid, reason: 'not_for_me' });
  const acts = (u) => all("SELECT action FROM provenance WHERE entity_type='recommendation' AND entity_uid=? ORDER BY id", u).map((r) => r.action);
  ok('R9c the reactions stay distinct assertions, each its own provenance action, and derive nothing',
     dd2.recommendation.status === 'not_for_me' && acts(d1.recommendation.uid).includes('not_this_trip') && acts(d2.recommendation.uid).includes('not_for_me')
     && !acts(d2.recommendation.uid).includes('not_this_trip') && one('SELECT COUNT(*) n FROM derived_relations').n === 0
     && JSON.stringify(await call(A, 'list_recommendations', { status: 'reacted' })).includes(d2.recommendation.uid));

  // ---- a recommended itinerary, end to end --------------------------------------
  console.log('\nrecommended itinerary');
  const [ri] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'Three days on the Big Island', workflow: 'cold_start',
    rationale: 'Coffee farms and the water.' }] })).items;
  const planUid = ri.recommendation.target.uid;
  ok('R10 a recommended itinerary is an ordinary itinerary, private and not kept', ri.recommendation.resolution === 'resolved' && !kept('itinerary', planUid)
     && one('SELECT private FROM itineraries WHERE uid=?', planUid).private === 1);
  ok('R10b my_itineraries does not list it, but opens it by uid', !JSON.stringify(await call(A, 'my_itineraries', {})).includes(planUid)
     && (await call(A, 'my_itineraries', { uid: planUid })).uid === planUid);
  const planId = one('SELECT id FROM itineraries WHERE uid=?', planUid).id;
  ok('R10c on the web it is its member’s alone', await page(fx.sidA, '/t/' + planId) === 200 && await page(fx.sidB, '/t/' + planId) === 404
     && !(await (await fetch(BASE + '/t', { headers: { cookie: 'sid=' + fx.sidA } })).text()).includes('Three days on the Big Island'));
  await call(A, 'add_itinerary_stops', { itinerary_uid: planUid, stops: [
    { label: 'Coffee farm', new_place: { name: 'Big Island Farm', locality: 'Kona', country: 'US' } },
    { label: 'Somewhere for sunset', kind: 'experiential' }] });
  const farm = one("SELECT uid FROM marks WHERE name='Big Island Farm'").uid;
  ok('R11 a new place added to a recommended plan is a Mark the plan explains, not kept', !kept('mark', farm)
     && !(await call(A, 'my_travel_marks', { limit: 50 })).items.some((m) => m.uid === farm));
  const farmStop = one("SELECT s.uid FROM itinerary_stops s WHERE s.mark_uid=?", farm).uid;
  const marksNow = one('SELECT COUNT(*) n FROM marks').n;
  await call(A, 'add_itinerary_stops', { itinerary_uid: planUid, stops: [{ label: 'Hatchards again', new_place: { name: 'Fixture place', locality: 'L', country: 'C' } }] });
  ok('R11b a place the member already has a Mark for is reused in a recommended plan, not duplicated (decision C)',
     one('SELECT COUNT(*) n FROM marks').n === marksNow && !!one("SELECT 1 FROM itinerary_stops s JOIN itineraries i ON i.id=s.itinerary_id WHERE i.uid=? AND s.mark_uid=?", planUid, fx.mark));
  const lv = await rpc(A, 'log_visit', { id: one('SELECT id FROM marks WHERE uid=?', farm).id, visited_on: '2026-09-01' });
  ok('R11c checking in at a place in a recommended plan is refused before Keep: no visit, not kept', lv.isError === true && !kept('mark', farm)
     && one('SELECT COUNT(*) n FROM visits v JOIN marks m ON m.id=v.mark_id WHERE m.uid=?', farm).n === 0);
  const [bag] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'a bag of their peaberry', resolution: 'resolved', maker: 'Big Island Farm', product: 'Peaberry',
    image_uid: await img(), workflow: 'destination_objects', context_itinerary_uid: planUid, context_stop_uid: farmStop }] })).items;
  const sn = await call(A, 'set_stop_note', { stop_uid: farmStop, note_uid: bag.recommendation.target.uid });
  ok('R12 a recommended note can sit under a stop in a recommended plan', sn.stops.find((s) => s.stop_uid === farmStop).notes.some((n) => n.uid === bag.recommendation.target.uid && !n.kept));
  ok('R12b stop_notes reads it back; my_itineraries’ submitted shape does not change', (await call(A, 'list_stop_notes', { itinerary_uid: planUid })).stops.some((s) => s.notes.length === 1)
     && !JSON.stringify(await call(A, 'my_itineraries', { uid: planUid })).includes(bag.recommendation.target.uid));
  ok('R12c in a kept plan, only a kept note can be attached', /Only a kept note/.test(await errOf(A, 'set_stop_note', {
    stop_uid: one('SELECT s.uid FROM itinerary_stops s JOIN itineraries i ON i.id=s.itinerary_id WHERE i.uid=? LIMIT 1', fx.itinerary).uid, note_uid: bag.recommendation.target.uid })));
  const listed = await call(A, 'list_recommendations', { context_itinerary_uid: planUid });
  ok('R13 Recommended groups by trip', listed.groups.length === 1 && listed.groups[0].title === 'Three days on the Big Island' && listed.groups[0].items[0].context.stop_label === 'Coffee farm');
  const kp = await call(A, 'keep_recommendation', { recommendation_uid: ri.recommendation.uid });
  ok('R14 keeping the plan keeps it, its new place and the note under its stop, in one act', kept('itinerary', planUid) && kept('mark', farm) && kept('object', bag.recommendation.target.uid)
     && kp.kept.length === 3);
  ok('R14b the same stops, nothing copied; the unresolved stop stays unresolved', one('SELECT COUNT(*) n FROM itinerary_stops WHERE itinerary_id=?', planId).n === 3
     && one("SELECT resolution FROM itinerary_stops WHERE itinerary_id=? AND label='Somewhere for sunset'", planId).resolution === 'experiential');
  ok('R14c now it is one of their plans, and the item recommendation is still history',
     JSON.stringify(await call(A, 'my_itineraries', {})).includes(planUid) && !!one('SELECT 1 FROM recommendations WHERE uid=?', bag.recommendation.uid));

  // ---- across members ---------------------------------------------------------
  console.log('\nacross members');
  asAdmin(true);
  ok('R15 another member can use none of it: context, target, evidence, stops, plans', 
     /No such itinerary/.test(await errOf(B, 'record_recommendations', { items: [{ kind: 'object', label: 'z', workflow: 'cold_start', context_itinerary_uid: planUid }] }))
     && /No such note/.test(await errOf(B, 'record_recommendations', { items: [{ kind: 'object', label: 'z', resolution: 'resolved', workflow: 'cold_start', target_uid: fx.notePublic }] }))
     && /never evidence/.test(await errOf(B, 'record_recommendations', { items: [{ kind: 'object', label: 'z', workflow: 'cold_start', evidence_uids: [fx.notePublic] }] }))
     && !!(await errOf(B, 'set_stop_note', { stop_uid: farmStop, note_uid: fx.bNote }))
     && !!(await errOf(B, 'list_stop_notes', { itinerary_uid: planUid }))
     && !!(await errOf(B, 'keep_recommendation', { recommendation_uid: bag.recommendation.uid }))
     && !!(await errOf(B, 'dismiss_recommendation', { recommendation_uid: bag.recommendation.uid })));
  asAdmin(false);

  // ---- invariants -----------------------------------------------------------
  console.log('\ninvariants');
  const orph = require('./orphans')(db);
  ok('I1 no orphans: every record outside the corpus is explained by a truthful relationship', orph.length === 0, orph.join(', '));
  ok('I2 every recommendation belongs to one member and has its creation in provenance', one(`SELECT COUNT(*) n FROM recommendations r WHERE NOT EXISTS
     (SELECT 1 FROM provenance p WHERE p.entity_type='recommendation' AND p.entity_uid=r.uid AND p.action='created')`).n === 0);
  await call(A, 'delete_note', { id: coffee.id });
  ok('I3 deleting a target leaves the recommendation as history: its dead target reference is cleared (migration 054), resolution and known details kept', (await call(A, 'list_recommendations', { status: 'all' })).groups.flatMap((g) => g.items)
     .some((v) => v.uid === r1.recommendation.uid && v.target === null && v.resolution === 'resolved' && Object.keys(v.known).length > 0));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
