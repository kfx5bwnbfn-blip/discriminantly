// Place identity and delegated itinerary authoring (v2.58), live through MCP.
// Scenarios A-I of the MCP refinements brief. Needs a running server:
//   BASE=http://localhost:3000 TOKEN=<member api token> DB_PATH=data/discriminantly.db node test/place-identity.js
const path = require('path'); const { DatabaseSync } = require('node:sqlite');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''), TOKEN = process.env.TOKEN;
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'discriminantly.db'));
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const raw = async (name, a) => (await (await fetch(`${BASE}/mcp/${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } }) })).json()).result;
const call = async (name, a) => { const r = await raw(name, a); if (r.isError) throw new Error(`${name}: ${r.content[0].text}`); return r.structuredContent; };
const one = (sql, ...a) => db.prepare(sql).get(...a);
const counts = () => ({ visits: one('SELECT COUNT(*) n FROM visits').n, warrants: one('SELECT COUNT(*) n FROM warrants').n, owned: one('SELECT COUNT(*) n FROM ownership_assertions').n });
(async () => {
  const before = counts();
  // B. false duplicate: M+ Hong Kong must not absorb Taipei places
  const mplus = await call('resolve_travel_mark', { place: 'M+', locality: 'Hong Kong', country: 'Hong Kong', address: '38 Museum Drive, West Kowloon', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  const kaffa = await call('resolve_travel_mark', { place: 'Simple Kaffa Huashan Flagship Store', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('B1 a Taipei place is created, not matched to M+ Hong Kong', kaffa.action === 'created' && kaffa.mark.uid !== mplus.mark.uid && kaffa.match.state === 'none', JSON.stringify(kaffa.match));
  const viaAdd = await raw('add_travel_mark', { place: 'Yongle Fabric Market', locality: 'Taipei', country: 'Taiwan' });
  ok('B2 add_travel_mark (the same matcher) creates it too, with diagnostics in _meta', viaAdd.structuredContent.action === 'created' && viaAdd._meta['discriminantly/place_match'].state === 'none');
  // C. exact reuse
  const again = await call('resolve_travel_mark', { place: 'Simple Kaffa Huashan Flagship Store', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('C1 resolving it again reuses the same uid (exact: normalized name + locality)', again.mark.uid === kaffa.mark.uid && again.match.state === 'exact' && again.match.basis.includes('normalized_name_locality'));
  const enriched = await call('resolve_travel_mark', { place: 'Simple Kaffa Huashan Flagship Store', locality: 'Taipei', country: 'Taiwan', address: '1 Bade Rd, Zhongzheng', why: 'The flagship.', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('C2 a reuse fills only empty fields and says which', enriched.action === 'enriched' && enriched.changed.includes('address') && enriched.changed.includes('why') && enriched.mark.uid === kaffa.mark.uid);
  ok('C3 no duplicate mark was made', one("SELECT COUNT(*) n FROM marks WHERE name='Simple Kaffa Huashan Flagship Store'").n === 1);
  // D. resolver fallback: authoritative address, no coordinates
  const museum = await call('resolve_travel_mark', { place: 'National Taiwan Museum', locality: 'Taipei', country: 'Taiwan', address: '2 Xiangyang Rd, Zhongzheng', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  const mt = (await call('my_travel_marks', { query: 'National Taiwan Museum' })).items[0];
  ok('D1 persisted with the authoritative address and no coordinates', museum.action === 'created' && mt.location.address && mt.location.lat === undefined && mt.location.source === 'authoritative_source');
  ok('D2 place_identity says resolved, from an authoritative address', mt.place_identity.status === 'resolved' && mt.place_identity.basis.includes('authoritative_address'));
  const invent = await raw('resolve_travel_mark', { place: 'Bar Mood', locality: 'Taipei', lat: 25.04, lng: 121.55, identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('D3 coordinates without a mapping or member source are refused, writing nothing', invent.isError && /Coordinates need a source/.test(invent.content[0].text) && !one("SELECT 1 FROM marks WHERE name='Bar Mood'"));
  // E. several plausible candidates
  await call('resolve_travel_mark', { place: 'Hatchards', locality: 'London', country: 'United Kingdom', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  const edi = await call('resolve_travel_mark', { place: 'Hatchards', locality: 'Edinburgh', country: 'United Kingdom', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('E0 the same name in another city is created, naming the candidate (possible)', edi.action === 'created' && edi.match.state === 'possible');
  const nH = one("SELECT COUNT(*) n FROM marks WHERE name='Hatchards'").n;
  const amb = await call('resolve_travel_mark', { place: 'Hatchards', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('E1 an ambiguous name returns a candidate and creates nothing', amb.action === 'candidate' && amb.mark === null && one("SELECT COUNT(*) n FROM marks WHERE name='Hatchards'").n === nH, JSON.stringify(amb.match));
  // A + F. a plan the member asked the AI to build: canonical marks, stops, the AI's order
  const it = await call('create_itinerary', { title: 'Taipei, one extra day' });
  const moun = await call('resolve_travel_mark', { place: 'Mountain and Sea House', locality: 'Taipei', country: 'Taiwan', address: '94 Section 1, Bade Rd', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  await call('add_itinerary_stops', { itinerary_uid: it.uid, stops: [{ label: 'Coffee first', mark_uid: kaffa.mark.uid }, { label: 'The museum', mark_uid: museum.mark.uid }, { label: 'Dinner', mark_uid: moun.mark.uid }] });
  const full = await call('my_itineraries', { uid: it.uid });
  const stops = full.unplaced.map((st) => st.uid);
  await call('arrange_itinerary', { itinerary_uid: it.uid, create_day: { label: 'Day 1' }, assign: stops.map((u, i) => ({ stop_uid: u, position: i + 1 })) });
  const after = await call('my_itineraries', { uid: it.uid });
  ok('A1 the plan, its canonical marks and the AI\u2019s order are all written in one flow', after.days && after.days[0] && after.days[0].stops.length === 3 && [kaffa, museum, moun].every((m) => m.mark.kept));
  ok('A2 nothing experiential was inferred: no visits, warrants or ownership', JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(counts()));
  // I. audit
  const good = await call('audit_itinerary', { itinerary_uid: it.uid, expect: { all_specific_stops_linked: true, no_unplaced_stops: true, ordered: true, enhanced_marks: true } });
  ok('I1 a complete plan is satisfied, with ordering complete and no conflicts', good.satisfied && good.checks.sequencing === 'complete' && !good.checks.conflicts.length && !good.checks.unresolved_particular_stops.length, JSON.stringify(good.failed));
  ok('I2 a missing website or note does not fail it (gaps still reported)', good.checks.linked_marks_missing_core_fields.some((x) => x.missing.includes('link')) && good.satisfied);
  const bad = await call('create_itinerary', { title: 'Half-built' });
  await call('add_itinerary_stops', { itinerary_uid: bad.uid, stops: [{ label: 'That noodle place', kind: 'particular' }, { label: 'Coffee', mark_uid: kaffa.mark.uid }] });
  const badFull = await call('my_itineraries', { uid: bad.uid });
  await call('arrange_itinerary', { itinerary_uid: bad.uid, create_day: { label: 'Day 1' }, assign: [{ stop_uid: badFull.unplaced[1].uid }] });
  const au = await call('audit_itinerary', { itinerary_uid: bad.uid, expect: { all_specific_stops_linked: true, no_unplaced_stops: true, ordered: true } });
  const noodle = badFull.unplaced.find((st) => st.label === 'That noodle place');
  ok('I3 an incomplete plan is not satisfied and names the exact stops', !au.satisfied && au.checks.unresolved_particular_stops[0].stop_uid === noodle.uid && au.checks.unplaced_stops[0].stop_uid === noodle.uid && au.failed.includes('ordered'), JSON.stringify(au));
  const nochange = counts();
  ok('I4 audit_itinerary writes nothing', JSON.stringify(nochange) === JSON.stringify(before) && one('SELECT COUNT(*) n FROM itinerary_stops WHERE itinerary_id=(SELECT id FROM itineraries WHERE uid=?)', bad.uid).n === 2);
  // G. recommendation provenance pointing at a canonical plan mark: no keep needed
  const g = await call('resolve_travel_mark', { place: 'Bar Mood Taipei', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'canonical',
    recommendation_context: { workflow: 'destination_objects', itinerary_uid: it.uid, rationale: 'Near dinner.' } });
  const recs = await call('list_recommendations', { status: 'all' });
  const flat = JSON.stringify(recs);
  ok('G1 a canonical plan mark can carry the recommendation and is kept without keep_recommendation', g.mark.kept && !!g.recommendation_uid && flat.includes(g.recommendation_uid) && flat.includes(g.mark.uid));
  // H. the recommendation orbit: optional ideas stay unkept until kept
  const fat = await call('resolve_travel_mark', { place: 'Wistaria Tea House', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'recommendation',
    recommendation_context: { workflow: 'for_another_time', rationale: 'For a slower visit.' } });
  const mine = await call('my_travel_marks', { query: 'Wistaria' });
  ok('H1 a For another time place is a private, unkept mark, outside my_travel_marks', !fat.mark.kept && !mine.items.length && one('SELECT private FROM marks WHERE uid=?', fat.mark.uid).private === 1);
  const kept = await call('keep_recommendation', { recommendation_uid: fat.recommendation_uid });
  const mine2 = await call('my_travel_marks', { query: 'Wistaria' });
  ok('H2 keeping it later brings the same mark into their marks (existing keep semantics)', mine2.items.length === 1 && mine2.items[0].uid === fat.mark.uid, JSON.stringify(kept).slice(0, 160));
  ok('H3 and still no visits, warrants or ownership anywhere', JSON.stringify(counts()) === JSON.stringify(before));
  // J. per-field status: researched absence is recorded, and a value supersedes it
  const street = await call('resolve_travel_mark', { place: 'Dihua Street', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'canonical', unavailable: ['link', 'address', 'coordinates'] });
  ok('J1 fields researched and absent are "unavailable"; untouched ones "not_attempted"', street.fields.link === 'unavailable' && street.fields.address === 'unavailable' && street.fields.why === 'not_attempted', JSON.stringify(street.fields));
  const street2 = await call('resolve_travel_mark', { place: 'Dihua Street', locality: 'Taipei', country: 'Taiwan', link: 'https://example.org/dihua', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('J2 supplying a value later makes it present', street2.fields.link === 'present' && street2.mark.uid === street.mark.uid);
  const itJ = await call('create_itinerary', { title: 'A street walk' });
  await call('add_itinerary_stops', { itinerary_uid: itJ.uid, stops: [{ label: 'Walk Dihua Street', mark_uid: street.mark.uid }] });
  const auJ = await call('audit_itinerary', { itinerary_uid: itJ.uid, expect: { enhanced_marks: true } });
  const entJ = auJ.checks.linked_marks_missing_core_fields[0];
  ok('J3 an audit lists unavailable fields apart from missing ones, and a street with no address or coordinates still counts as grounded', auJ.satisfied && entJ.unavailable.includes('address') && !entJ.missing.includes('address'), JSON.stringify(auJ));
  // K. images: an uploaded picture on a resolved mark
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await call('upload_image', { image: PNG });
  const pic = await call('resolve_travel_mark', { place: 'Lin Liu-Hsin Puppet Theatre Museum', locality: 'Taipei', country: 'Taiwan', image_uid: up.image_uid, identity_basis: ['authoritative_source'], target_state: 'canonical' });
  ok('K1 an uploaded image is stored on the mark', pic.fields.image === 'present' && !!one('SELECT image FROM marks WHERE uid=?', pic.mark.uid).image);
  // L. For another time, checked
  const origin = await call('create_itinerary', { title: 'Taipei, an extra day (origin)' });
  const rs = await call('record_recommendations', { items: [
    { kind: 'itinerary', label: 'Slower Taipei', workflow: 'for_another_time', origin_itinerary_uid: origin.uid, relation: 'same_city' },
    { kind: 'itinerary', label: 'Like Taipei, in Tainan', workflow: 'for_another_time', origin_itinerary_uid: origin.uid, relation: 'similar' } ] });
  const same = rs.items[0].recommendation.target.uid;
  await call('add_itinerary_stops', { itinerary_uid: same, stops: [{ label: 'A tea house', kind: 'particular' }] });
  const ex = await call('audit_recommendation_expansion', { origin_itinerary_uid: origin.uid });
  ok('L1 the expansion audit reports which relations are present', ex.relations.same_city.present && ex.relations.similar.present && !ex.relations.different.present && !ex.complete);
  ok('L2 and what is malformed (the similar plan has no stops), with its uid', ex.malformed.length === 1 && ex.malformed[0].recommendation_uid === rs.items[1].recommendation.uid && /no stops/.test(ex.malformed[0].reason), JSON.stringify(ex.malformed));
  // M. build_itinerary
  const plans0 = one('SELECT COUNT(*) n FROM itineraries').n, marks0 = one('SELECT COUNT(*) n FROM marks').n, ev0 = counts();
  const built = await call('build_itinerary', { title: 'Taipei in two days', days: [
    { label: 'Day 1', stops: [{ label: 'Coffee', mark_uid: kaffa.mark.uid }, { label: 'Fabric', place: { place: 'Yongle Fabric Market', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'] } }] },
    { label: 'Day 2', stops: [{ label: 'Tea', place: { place: 'Wistaria Tea House', locality: 'Taipei', country: 'Taiwan', address: '1 Xinsheng S Rd', identity_basis: ['authoritative_source'] } }, { label: 'Leave the afternoon free', kind: 'allocation' }] } ] });
  ok('M1 one call writes the plan, its days, stops in order and canonical marks, then audits it', built.action === 'created' && built.days.length === 2 && built.days[1].stops.length === 2 && built.audit.satisfied && built.audit.checks.sequencing === 'complete', JSON.stringify(built.audit));
  ok('M2 existing exact marks are reused, not duplicated (Yongle Fabric Market, Wistaria Tea House)', built.marks.every((m) => m.action !== 'created') && one("SELECT COUNT(*) n FROM marks WHERE name='Yongle Fabric Market'").n === 1, JSON.stringify(built.marks));
  ok('M3 a recommendation-only mark used by the build becomes canonical and stays single (Wistaria)', one("SELECT COUNT(*) n FROM marks WHERE name='Wistaria Tea House'").n === 1);
  ok('M4 building records no visits, warrants or ownership', JSON.stringify(counts()) === JSON.stringify(ev0));
  const plans1 = one('SELECT COUNT(*) n FROM itineraries').n;
  const amb2 = await call('build_itinerary', { title: 'Ambiguous', days: [{ stops: [{ label: 'Books', place: { place: 'Hatchards', identity_basis: ['authoritative_source'] } }] }] });
  ok('M5 a probable match stops the build before anything is written, and names the candidate', amb2.action === 'candidates' && amb2.candidates[0].match.candidate_name === 'Hatchards' && one('SELECT COUNT(*) n FROM itineraries').n === plans1);
  const marks1 = one('SELECT COUNT(*) n FROM marks').n;
  const broken = await raw('build_itinerary', { title: 'Will fail', days: [{ stops: [{ label: 'New place', place: { place: 'Rollback Test Cafe', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'] } }] },
    { stops: [{ label: 'Bad', mark_uid: '00000000-0000-0000-0000-000000000000' }] }] });
  ok('M6 a failure part-way writes nothing at all: no plan, no new mark', broken.isError && one('SELECT COUNT(*) n FROM itineraries').n === plans1 && one('SELECT COUNT(*) n FROM marks').n === marks1 && !one("SELECT 1 FROM marks WHERE name='Rollback Test Cafe'"));
  // N. dates, not instants
  const mn = await call('my_travel_marks', { limit: 3 });
  const stamp = JSON.stringify(mn).match(/"created_at":"([^"]*)"/);
  ok('N1 tool results carry dates, not timestamps', !stamp || /^\d{4}-\d{2}-\d{2}$/.test(stamp[1]), stamp ? stamp[1] : 'no created_at');
  // O. general Keep
  const idea = await call('resolve_travel_mark', { place: 'Taipei Fine Arts Museum', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'recommendation', recommendation_context: { workflow: 'for_another_time' } });
  const k1 = await call('keep_record', { type: 'mark', uid: idea.mark.uid });
  const k2 = await call('keep_record', { type: 'mark', uid: idea.mark.uid });
  ok('O1 keep_record keeps an unkept mark (through its recommendation), and again changes nothing', k1.action === 'kept' && k1.via === 'recommendation' && k2.action === 'unchanged' && (await call('my_travel_marks', { query: 'Fine Arts' })).items.length === 1, JSON.stringify(k1));
  const k3 = await raw('keep_record', { type: 'mark', uid: '00000000-0000-0000-0000-000000000000' });
  ok('O2 an unknown uid is refused without writing', k3.isError && /No such travel mark/.test(k3.content[0].text));
  ok('O3 keeping records no visit, warrant or ownership', JSON.stringify(counts()) === JSON.stringify(before));
  // P. leftovers: explicit, and only what nothing uses
  const rp = await call('record_recommendations', { items: [{ kind: 'itinerary', label: 'A plan for later', workflow: 'for_another_time' }] });
  const rplan = rp.items[0].recommendation.target.uid;
  await call('add_itinerary_stops', { itinerary_uid: rplan, stops: [{ label: 'Leftover Noodles', new_place: { name: 'Leftover Noodles', locality: 'Taipei', country: 'Taiwan' } }] });
  await call('delete_itinerary_entity', { kind: 'itinerary', uid: rplan });
  const lo = await call('clear_prospective_leftovers', {});
  ok('P1 a place left by a deleted, never-kept recommended plan is listed, and nothing is deleted without confirm', lo.action === 'listed' && lo.items.some((x) => x.name === 'Leftover Noodles') && !!one("SELECT 1 FROM marks WHERE name='Leftover Noodles'"));
  ok('P2 nothing kept is ever listed', !lo.items.some((x) => one('SELECT 1 FROM marks WHERE uid=?', x.uid) && [kaffa, museum, moun].some((m) => m.mark.uid === x.uid)));
  const done = await call('clear_prospective_leftovers', { confirm: true });
  ok('P3 with confirm it deletes exactly those, recording each deletion', done.action === 'deleted' && !one("SELECT 1 FROM marks WHERE name='Leftover Noodles'")
     && !!one("SELECT 1 FROM provenance WHERE action='deleted' AND source_kind='review_cleanup'"));
  // Q. a stop remembers where its place was
  const snap = await call('resolve_travel_mark', { place: 'Snapshot Cafe', locality: 'Taipei', country: 'Taiwan', identity_basis: ['authoritative_source'], target_state: 'canonical' });
  const itQ = await call('create_itinerary', { title: 'Snapshot plan' });
  await call('add_itinerary_stops', { itinerary_uid: itQ.uid, stops: [{ label: 'Cafe', mark_uid: snap.mark.uid }] });
  await call('delete_travel_mark', { id: snap.mark.id });
  const afterQ = await call('my_itineraries', { uid: itQ.uid });
  const stQ = afterQ.unplaced[0];
  ok('Q1 after its mark is deleted, the stop still says where it was', stQ && !stQ.mark_uid && stQ.place && stQ.place.locality === 'Taipei' && stQ.place.country === 'Taiwan', JSON.stringify(stQ));
  // R. retry safety
  const r1 = await call('create_itinerary', { title: 'Retry me' }), r2 = await call('create_itinerary', { title: 'Retry me' });
  ok('R1 a retried create_itinerary returns the plan just made', r2.action === 'unchanged' && r2.uid === r1.uid && one("SELECT COUNT(*) n FROM itineraries WHERE title='Retry me'").n === 1);
  await call('add_itinerary_stops', { itinerary_uid: r1.uid, stops: [{ label: 'One' }, { label: 'Two' }] });
  await call('add_itinerary_stops', { itinerary_uid: r1.uid, stops: [{ label: 'One' }, { label: 'Two' }] });
  ok('R2 a retried add_itinerary_stops adds nothing more', one('SELECT COUNT(*) n FROM itinerary_stops WHERE itinerary_id=(SELECT id FROM itineraries WHERE uid=?)', r1.uid).n === 2);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('error:', e.message); process.exit(2); });
