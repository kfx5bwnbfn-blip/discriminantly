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
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('error:', e.message); process.exit(2); });
