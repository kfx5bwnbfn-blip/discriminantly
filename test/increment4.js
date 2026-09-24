// Increment 4: the Recommended experience on the web.
//   S  structure: where proposals sit, what they say, in what order
//   N  things proposed at a stop, nested under it, and keeping them
//   Q  a proposed plan: its own page, keeping one place, keeping the plan
//   O  a proposed note or mark: its own page and Keep
//   V  reactions
//   D  deleting a kept plan or composition, then reviewing what it added
//   E  the ensemble worksurface's Keep, attributed to the member
//   M  the additive MCP fields (origin, relation) and Keep attaching to its stop
//   BASE=http://localhost:PORT DB_PATH=<db> node test/increment4.js
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const orphans = require('./orphans');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) { console.error('DB_PATH is required'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(DB_PATH + '.fixture.json', 'utf8'));
const db = new DatabaseSync(DB_PATH);
const one = (sql, ...a) => db.prepare(sql).get(...a);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  (' + x + ')' : '')); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const rpc = async (T, name, args) => (await (await fetch(BASE + '/mcp/' + T, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
const call = async (T, name, args) => { const r = await rpc(T, name, args); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const err = async (T, name, args) => { const r = await rpc(T, name, args); return r.isError ? r.content[0].text : null; };
const page = async (sid, url) => { const r = await fetch(BASE + url, { headers: sid ? { cookie: 'sid=' + sid } : {}, redirect: 'manual' }); return { status: r.status, body: await r.text() }; };
const post = async (sid, url, form = {}, referer = null) => { const r = await fetch(BASE + url, { method: 'POST', redirect: 'manual',
  headers: { cookie: 'sid=' + sid, 'content-type': 'application/x-www-form-urlencoded', ...(referer ? { referer: BASE + referer } : {}) }, body: new URLSearchParams(form) });
  return { status: r.status, location: r.headers.get('location') }; };
const A = fx.tokA, B = fx.tokB, SA = fx.sidA, SB = fx.sidB;
const kept = (t, uid) => !!one(`SELECT 1 FROM ${{ object: 'adopted_objects', mark: 'adopted_marks', itinerary: 'adopted_itineraries' }[t]} WHERE uid=?`, uid);
const idOf = (table, uid) => one(`SELECT id FROM ${table} WHERE uid=?`, uid).id;
const stopUid = (planUid, label) => one('SELECT s.uid FROM itinerary_stops s JOIN itineraries i ON i.id=s.itinerary_id WHERE i.uid=? AND s.label=?', planUid, label).uid;
const count = (sql, ...a) => one(sql, ...a).n;
const evidence = () => JSON.stringify({ v: count('SELECT COUNT(*) n FROM visits'), o: count('SELECT COUNT(*) n FROM ownership_assertions'), w: count('SELECT COUNT(*) n FROM warrants') });
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = b ? s.indexOf(b, i + a.length) : -1; return s.slice(i, j < 0 ? undefined : j); };

(async () => {
  const img = (await call(A, 'upload_image', { image: PNG })).image_uid;
  const mk = (place, locality, lat, lng) => call(A, 'add_travel_mark', { place, locality, country: 'United Kingdom', lat, lng, allow_duplicate: true });
  const day = async (plan, label) => { await call(A, 'arrange_itinerary', { itinerary_uid: plan, create_day: { label } });
    return one('SELECT g.uid FROM itinerary_groups g JOIN itineraries i ON i.id=g.itinerary_id WHERE i.uid=? ORDER BY g.id DESC', plan).uid; };

  // ---- the active plan, with things proposed at its stops -------------------
  const moh = await mk('I4 Museum', 'London', 51.5316, -0.0763), lw = await mk('I4 Houseware shop', 'London', 51.5243, -0.0716);
  const shep = await mk('I4 Bindery', 'London', 51.5250, -0.0740);
  const plan = await call(A, 'create_itinerary', { title: 'I4 London', private: false });
  const d1 = await day(plan.uid, 'Day 1');
  const [s1, s2] = (await call(A, 'add_itinerary_stops', { itinerary_uid: plan.uid, stops: [
    { label: 'Museum', mark_uid: moh.uid, group_uid: d1 }, { label: 'Shop', mark_uid: lw.uid, group_uid: d1 }] })).stops.map((x) => x.uid);
  const cat = await call(A, 'note_object', { headline: 'I4 Catalogue', image: img, allow_duplicate: true });
  await call(A, 'set_stop_note', { stop_uid: s1, note_uid: cat.uid });
  const [book, sideboard, mug] = (await call(A, 'record_recommendations', { items: [
    { kind: 'object', label: 'I4 Sixties book', resolution: 'resolved', image_uid: img, workflow: 'destination_objects', context_itinerary_uid: plan.uid, context_stop_uid: s1, rationale: 'Sold in the museum shop.' },
    { kind: 'object', label: 'I4 sideboard in the 1960s room', workflow: 'destination_objects', context_itinerary_uid: plan.uid, context_stop_uid: s1 },
    { kind: 'object', label: 'I4 porcelain mug', resolution: 'resolved', image_uid: img, workflow: 'destination_objects', context_itinerary_uid: plan.uid, context_stop_uid: s2 }] })).items.map((x) => x.recommendation);

  // ---- three plans proposed "for another time", in reverse order ------------
  const propose = async (label, locality, relation, rationale, stops) => {
    const [r] = (await call(A, 'record_recommendations', { items: [{ kind: 'itinerary', label, locality, workflow: 'for_another_time', origin_itinerary_uid: plan.uid, relation, rationale }] })).items;
    const g = await day(r.recommendation.target.uid, 'Day 1');
    await call(A, 'add_itinerary_stops', { itinerary_uid: r.recommendation.target.uid, stops: stops.map((s) => ({ ...s, group_uid: g })) });
    return r.recommendation;
  };
  const berlin = await propose('I4 somewhere less traditional', 'Berlin', 'different', 'I4 why Berlin', [{ label: 'I4 Archive', new_place: { name: 'I4 Archive', locality: 'Berlin', country: 'Germany', lat: 52.5089, lng: 13.3576 } }]);
  const stockholm = await propose('I4 the same mix elsewhere', 'Stockholm', 'similar', 'I4 why Stockholm', [{ label: 'I4 Tenn', new_place: { name: 'I4 Tenn', locality: 'Stockholm', country: 'Sweden', lat: 59.3326, lng: 18.0795 } }]);
  const ldn = await propose('I4 another side of craft', 'London', 'same_city', 'I4 why London again', [
    { label: 'I4 Bindery', mark_uid: shep.uid },
    { label: 'I4 Paper shop', new_place: { name: 'I4 Paper shop', locality: 'London', country: 'United Kingdom', lat: 51.5260, lng: -0.0750 } },
    { label: 'I4 slow morning', kind: 'particular' }]);
  const lPlan = ldn.target.uid;
  const paperStop = stopUid(lPlan, 'I4 Paper shop');
  const [pen, knife] = (await call(A, 'record_recommendations', { items: [
    { kind: 'object', label: 'I4 brass pen', resolution: 'resolved', image_uid: img, workflow: 'destination_objects', context_itinerary_uid: lPlan, context_stop_uid: paperStop },
    { kind: 'object', label: 'I4 petty knife', workflow: 'destination_objects', context_itinerary_uid: lPlan, context_stop_uid: paperStop }] })).items.map((x) => x.recommendation);
  const paperMark = one('SELECT mark_uid FROM itinerary_stops WHERE uid=?', paperStop).mark_uid;
  const planId = idOf('itineraries', plan.uid), lPlanId = idOf('itineraries', lPlan);

  // =========================================================================
  console.log('\nwhere proposals sit, and what they say');
  let pg = (await page(SA, `/t/${planId}`)).body;
  const iMain = pg.indexOf('class="itin-main"'), iSide = pg.indexOf('class="itin-side"'), iRecs = pg.indexOf('class="itin-recs"');
  ok('S1 the plan with proposals gets the three-area layout, in DOM order plan, map and nearby, then proposals', /itin-cols has-recs/.test(pg) && iMain > 0 && iMain < iSide && iSide < iRecs);
  const iNear = pg.indexOf('itin-sugg'), iMap = pg.indexOf('itin-map');
  ok('S2 on one column that order is the reading order: the map and "Nearby, from your catalogue" come before "For another time"', iMap > 0 && iMap < iRecs && (iNear < 0 || iNear < iRecs) && pg.indexOf('For another time') > iRecs);
  const recs = between(pg, 'class="itin-recs"', '</aside>');
  const kinds = [...recs.matchAll(/<p class="rec-kind">([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  ok('S3 three proposals in their bounded order: the same city, somewhere similar, a different direction', kinds.length === 3
     && /^Next time in London/.test(kinds[0]) && /^Like I4 London, in Stockholm/.test(kinds[1]) && /^Another direction · Berlin/.test(kinds[2]), kinds.join(' | '));
  ok('S4 each carries its title, its reason and when it was proposed', ['I4 another side of craft', 'I4 the same mix elsewhere', 'I4 somewhere less traditional', 'I4 why London again', 'I4 why Stockholm', 'I4 why Berlin'].every((t) => recs.includes(t))
     && (recs.match(/proposed \d+ \w+/g) || []).length === 3);
  const lCard = between(recs, `data-rec="${ldn.uid}"`, '</article>');
  ok('S5 exploring shows compact stops: a tile per stop, a place already theirs filled with "In your marks", a proposed place with its own Keep', (lCard.match(/class="rec-stop[ "]/g) || []).length === 3
     && /rec-stop is-kept[\s\S]*?I4 Bindery[\s\S]*?In your marks/.test(lCard) && lCard.includes(`/m/${idOf('marks', paperMark)}/keep`));
  ok('S6 things proposed at a stop hang inside its tile: proposed with Keep, still to identify without', /rec-kid"><span class="rec-kid-st">↳ <i>Proposed<\/i>[^<]*<\/span><a[^>]*>I4 brass pen/.test(lCard)
     && lCard.includes(`/r/${pen.uid}/keep`) && /rec-kid is-unres[\s\S]*?Still to identify[\s\S]*?I4 petty knife/.test(lCard) && !lCard.includes(`/r/${knife.uid}/keep`));
  ok('S7 each open proposal offers Keep this plan and the two reactions; nothing implies a visit', lCard.includes(`/r/${ldn.uid}/keep`) && /Not this trip/.test(lCard) && /Not for me/.test(lCard)
     && !/Check in/i.test(recs));
  ok('S8 the map previews a proposal only where its places fall on this map: London rings, no Stockholm or Berlin', pg.includes(`class="rec-pins" data-rec="${ldn.uid}"`)
     && !pg.includes(`data-rec="${stockholm.uid}"><g`) && !pg.includes(`class="rec-pins" data-rec="${berlin.uid}"`) && /map-legend/.test(pg));
  const pgB = await page(SB, `/t/${planId}`);
  ok('S9 another member viewing the public plan sees none of it: no column, no proposed rows, no uids', pgB.status === 200 && !/itin-recs|rec-plan|Proposed|has-recs/.test(pgB.body)
     && ![book, sideboard, mug, ldn, stockholm, berlin].some((r) => pgB.body.includes(r.uid)));
  const plain = await call(A, 'create_itinerary', { title: 'I4 no proposals' });
  const pgPlain = (await page(SA, `/t/${idOf('itineraries', plain.uid)}`)).body;
  ok('S10 a plan with nothing proposed is exactly as before: no third area, no heading', !/has-recs|itin-recs|For another time/.test(pgPlain));

  // =========================================================================
  console.log('\nthings proposed at a stop, in the plan itself');
  const tl = between(pg, 'class="itin-main"', 'class="itin-side"');
  const stop1 = between(tl, `id="stop-${s1}"`, `id="stop-${s2}"`);
  ok('N1 under the stop, not beside it: the kept note, then the proposed book (Keep, Not for me), then the sideboard still to identify', /Worth noticing here[\s\S]*?I4 Catalogue/.test(stop1)
     && /is-proposed[\s\S]*?<i>Proposed<\/i> · worth seeking here[\s\S]*?I4 Sixties book/.test(stop1) && stop1.includes(`/r/${book.uid}/keep`)
     && /is-unresolved[\s\S]*?Still to identify[\s\S]*?I4 sideboard/.test(stop1) && !stop1.includes(`/r/${sideboard.uid}/keep`));
  ok('N2 nested rows carry no stop number or time: they are not stops', !/stop-when/.test(between(stop1, 'stop-notes', '</ul>')));
  const ev0 = evidence();
  const kb = await post(SA, `/r/${book.uid}/keep`, {}, `/t/${planId}`);
  const bookUid = book.target.uid;
  const adP = one("SELECT p.actor_type, p.source_kind FROM provenance p JOIN adoptions a ON a.uid=p.entity_uid WHERE p.entity_type='adoption' AND a.subject_uid=?", bookUid);
  ok('N3 Keep from under the stop: one tap, back to the plan; the book is kept by the member (web), from its recommendation', kb.status === 303 && kb.location === `/t/${planId}`
     && kept('object', bookUid) && adP.actor_type === 'user' && adP.source_kind === 'recommendation');
  ok('N4 ...and it joins the stop it was proposed for, so it stays nested there, now as theirs',
     count('SELECT COUNT(*) n FROM itinerary_stop_notes a JOIN itinerary_stops s ON s.id=a.stop_id JOIN objects o ON o.id=a.note_id WHERE s.uid=? AND o.uid=?', s1, bookUid) === 1);
  pg = (await page(SA, `/t/${planId}`)).body;
  const stop1b = between(between(pg, 'class="itin-main"', 'class="itin-side"'), `id="stop-${s1}"`, `id="stop-${s2}"`);
  ok('N5 the page shows it in place as the member’s note, no longer proposed', /Worth noticing here<\/span><span class="ens-comp-label">I4 Sixties book/.test(stop1b) && !stop1b.includes(`/r/${book.uid}/keep`));
  const rm = await post(SA, `/r/${mug.uid}/react`, { reason: 'not_for_me' }, `/t/${planId}`);
  ok('N6 Not for me is recorded exactly, and the row leaves the stop', rm.status === 303 && one('SELECT reaction FROM recommendations WHERE uid=?', mug.uid).reaction === 'not_for_me'
     && !(await page(SA, `/t/${planId}`)).body.includes('I4 porcelain mug'));
  ok('N7 keeping recorded no visit, ownership or warrant', evidence() === ev0);

  // =========================================================================
  console.log('\na proposed plan');
  let pp = (await page(SA, `/t/${lPlanId}`)).body;
  const head = between(pp, 'itin-head', 'itin-group');
  ok('Q1 its own page says why it exists and offers Keep this plan and the reactions; no Edit, no editing form, no owner script', /Next time in/.test(head) && head.includes('I4 why London again')
     && head.includes(`/r/${ldn.uid}/keep`) && /Not this trip/.test(head) && !/class="card-edit"/.test(between(pp, 'itin-note', 'itin-shell')) && !/itin-edit-form|stop-add-disc|stop-menu/.test(pp));
  const paperId = idOf('marks', paperMark);
  const paperCard = between(pp, 'Proposed for', 'prop-line');
  ok('Q2 a proposed place is its mark card in the proposed state: "Proposed for", its title set straight, Directions and Keep, no Check in', pp.includes('is-proposed') && /mark-title-straight/.test(pp)
     && pp.includes(`/m/${paperId}/keep`) && !pp.includes(`data-checkin="/m/${paperId}/checkin"`) && paperCard.length > 0);
  ok('Q3 the place already theirs keeps its ordinary card, arced title and Check in', pp.includes(`data-checkin="/m/${idOf('marks', shep.uid)}/checkin"`));
  const kp = await post(SA, `/m/${paperId}/keep`, {}, `/t/${lPlanId}`);
  const adPaper = one("SELECT p.source_ref, p.actor_type FROM provenance p JOIN adoptions a ON a.uid=p.entity_uid WHERE p.entity_type='adoption' AND a.subject_uid=?", paperMark);
  ok('Q4 keeping one place keeps that place only, citing the proposal; the plan stays proposed', kp.status === 303 && kept('mark', paperMark) && !kept('itinerary', lPlan)
     && adPaper.source_ref === ldn.uid && adPaper.actor_type === 'user');
  pg = (await page(SA, `/t/${planId}`)).body;
  ok('Q5 in the column its tile is filled now, and its Keep has gone', new RegExp(`rec-stop is-kept[\\s\\S]*?I4 Paper shop[\\s\\S]*?In your marks`).test(between(pg, `data-rec="${ldn.uid}"`, '</article>'))
     && !pg.includes(`/m/${paperId}/keep`));
  ok('Q6 editing a proposed plan or place is still refused on the web', (await post(SA, `/t/${lPlanId}`, { title: 'Mine' })).status === 400
     && (await page(SA, `/m/${idOf('marks', one("SELECT m.uid FROM marks m WHERE m.name='I4 Tenn'").uid)}/edit`)).status === 409);
  const ev1 = evidence();
  const kPlan = await post(SA, `/r/${ldn.uid}/keep`, {}, `/t/${planId}`);
  ok('Q7 Keep this plan: the plan is theirs, its places kept or reused, unresolved stays unresolved, things proposed at its stops stay proposed', kPlan.status === 303 && kept('itinerary', lPlan)
     && kept('mark', paperMark) && kept('mark', shep.uid) && !kept('object', pen.target.uid) && one('SELECT resolution FROM itinerary_stops WHERE uid=?', stopUid(lPlan, 'I4 slow morning')).resolution === 'particular');
  pg = (await page(SA, `/t/${planId}`)).body;
  const lCardK = between(pg, `data-rec="${ldn.uid}"`, '</article>');
  ok('Q8 the column shows it kept, in place: the member’s byline, "kept", Open the itinerary, and what did not happen', /rec-plan is-kept/.test(pg) && /privately planned/.test(lCardK)
     && lCardK.includes(`/t/${lPlanId}`) && /No visits, ownership or warrants were recorded/.test(lCardK) && !lCardK.includes(`/r/${ldn.uid}/keep`));
  ok('Q9 keeping the plan recorded no visit, ownership or warrant', evidence() === ev1);
  pp = (await page(SA, `/t/${lPlanId}`)).body;
  ok('Q10 its own page is an ordinary plan now: Edit and the owner’s controls are back', /class="card-edit"/.test(pp) && /stop-add-disc/.test(pp) && !/itin-prop-acts/.test(pp));

  // =========================================================================
  console.log('\na proposed note, and its own page');
  const [soap] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'I4 hand balm', resolution: 'resolved', image_uid: img, workflow: 'cold_start', rationale: 'I4 why the balm' }] })).items.map((x) => x.recommendation);
  const soapId = idOf('objects', soap.target.uid);
  let op = (await page(SA, `/o/${soapId}`)).body;
  ok('O1 a proposed note’s page: "Proposed for", its reason, Keep and Not for me, one line; no Edit, no Owned switch, no comment form', /Proposed for/.test(op) && op.includes('I4 why the balm')
     && op.includes(`/o/${soapId}/keep`) && op.includes(`/r/${soap.uid}/react`) && /Keep it to edit, own, comment on or warrant it/.test(op)
     && !op.includes(`/o/${soapId}/edit"`) && !/owned-row/.test(op) && !op.includes(`action="/o/${soapId}/comments"`));
  await post(SA, `/o/${soapId}/keep`, {}, `/o/${soapId}`);
  op = (await page(SA, `/o/${soapId}`)).body;
  ok('O2 kept from its page, it becomes an ordinary note in place: Edit, the Owned switch and comments appear', kept('object', soap.target.uid) && op.includes(`/o/${soapId}/edit"`) && /owned-row/.test(op)
     && op.includes(`action="/o/${soapId}/comments"`) && !/Proposed for/.test(op));
  const pe = await call(A, 'create_pending_ensemble', { title: 'I4 pending', artifact_uid: img, components: [{ label: 'the chair', image_uid: img }] });
  await call(A, 'resolve_ensemble_component', { component_uid: pe.components[0].component_uid, label: 'I4 Staged chair', identity_basis: 'user_identity' });
  const staged = one('SELECT note_uid FROM ensemble_components WHERE uid=?', pe.components[0].component_uid).note_uid;
  const sp = (await page(SA, `/o/${idOf('objects', staged)}`)).body;
  ok('O3 a note staged in a pending composition says it is kept with the composition, and offers no Keep of its own', /Kept with its composition/.test(sp) && !sp.includes(`/o/${idOf('objects', staged)}/keep`)
     && (await post(SA, `/o/${idOf('objects', staged)}/keep`)).status === 409 && !kept('object', staged));

  // =========================================================================
  console.log('\nreactions');
  await post(SA, `/r/${stockholm.uid}/react`, { reason: 'not_this_trip' }, `/t/${planId}`);
  pg = (await page(SA, `/t/${planId}`)).body;
  const sCard = between(pg, `data-rec="${stockholm.uid}"`, '</article>');
  ok('V1 Not this trip is recorded as given; the proposal stays, set back, saying so, without Keep', one('SELECT reaction FROM recommendations WHERE uid=?', stockholm.uid).reaction === 'not_this_trip'
     && /rec-plan is-reacted/.test(pg) && /Not this trip/.test(sCard) && !sCard.includes(`/r/${stockholm.uid}/keep`));

  // =========================================================================
  console.log('\ndeleting a kept plan, then reviewing what it added');
  await call(A, 'log_visit', { id: idOf('marks', shep.uid), visited_on: '2026-09-01' });
  const del = await post(SA, `/t/${lPlanId}/delete`);
  ok('D1 deleting the kept plan deletes the plan only, then offers the review', del.status === 303 && del.location === `/review/itinerary/${lPlan}` && !one('SELECT 1 FROM itineraries WHERE uid=?', lPlan)
     && kept('mark', paperMark) && kept('mark', shep.uid));
  const rv = (await page(SA, del.location)).body;
  ok('D2 the review lists each place with what makes removing it consequential; nothing is selected', /I4 Paper shop[\s\S]*?kept with this plan/.test(rv) && /I4 Bindery[\s\S]*?yours since[\s\S]*?Checked in once/.test(rv)
     && !/<input type="checkbox" name="pick"[^>]*checked/.test(rv) && /Delete selected/.test(rv) && /Keep them all/.test(rv));
  const rd = await post(SA, '/review/delete', { from: `itinerary:${lPlan}`, pick: `mark:${paperMark}` });
  const dp = one("SELECT actor_type, source_kind, source_ref FROM provenance WHERE entity_type='mark' AND entity_uid=? AND action='deleted'", paperMark);
  ok('D3 deleting the chosen one is its own act, recorded as the member’s, naming the review; the other stays', rd.status === 303 && !one('SELECT 1 FROM marks WHERE uid=?', paperMark)
     && dp.actor_type === 'user' && dp.source_kind === 'review_cleanup' && dp.source_ref === lPlan && kept('mark', shep.uid));
  ok('D4 the review cannot be used on another member’s deletion', (await page(SB, `/review/itinerary/${lPlan}`)).status === 404
     && (await post(SB, '/review/delete', { from: `itinerary:${lPlan}`, pick: `mark:${shep.uid}` })).status === 303 && !!one('SELECT 1 FROM marks WHERE uid=?', shep.uid));

  // =========================================================================
  console.log('\nthe composition worksurface');
  const pe2 = await call(A, 'create_pending_ensemble', { title: 'I4 web keep', artifact_uid: img, components: [{ label: 'I4 Wishbone chair', image_uid: img, identity_basis: 'maker_model' }] });
  const kw = await post(SA, `/e/${pe2.ensemble_id}/keep`);
  const ek = one("SELECT actor_type FROM provenance WHERE entity_type='ensemble' AND entity_uid=? AND fields='status:saved'", pe2.ensemble_uid);
  ok('E1 Keep on the web works again, and is recorded as the member’s own act', kw.status === 303 && one('SELECT status FROM ensembles WHERE id=?', pe2.ensemble_id).status === 'saved' && ek && ek.actor_type === 'user');
  const chair = one('SELECT note_uid FROM ensemble_components WHERE ensemble_id=?', pe2.ensemble_id).note_uid;
  const ed = await post(SA, `/e/${pe2.ensemble_id}/delete`);
  ok('E2 deleting the kept composition leaves its note and offers the review', ed.status === 303 && ed.location === `/review/ensemble/${pe2.ensemble_uid}` && kept('object', chair)
     && /I4 Wishbone chair[\s\S]*?kept with this composition/.test((await page(SA, ed.location)).body));

  // =========================================================================
  console.log('\nMCP: where a proposal came from; Keep joins its stop');
  const lv = (await call(A, 'list_recommendations', { status: 'all' })).groups.flatMap((g) => g.items).find((x) => x.uid === berlin.uid);
  ok('M1 the recommendation reports its origin and relation', lv && lv.origin && lv.origin.itinerary_uid === plan.uid && lv.origin.itinerary_title === 'I4 London' && lv.origin.relation === 'different');
  const e1 = await err(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'I4 bad', workflow: 'for_another_time', relation: 'similar' }] });
  const bPlan = await call(B, 'create_itinerary', { title: 'I4 B plan' });
  const e2 = await err(A, 'record_recommendations', { items: [{ kind: 'itinerary', label: 'I4 bad 2', workflow: 'for_another_time', origin_itinerary_uid: bPlan.uid, relation: 'similar' }] });
  ok('M2 a relation needs an origin, and the origin must be the member’s own plan', /origin_itinerary_uid/.test(e1 || '') && /no such itinerary/.test(e2 || ''));
  const [cup] = (await call(A, 'record_recommendations', { items: [{ kind: 'object', label: 'I4 cup', resolution: 'resolved', image_uid: img, workflow: 'destination_objects', context_itinerary_uid: plan.uid, context_stop_uid: s2 }] })).items.map((x) => x.recommendation);
  await call(A, 'keep_recommendation', { recommendation_uid: cup.uid });
  ok('M3 keep_recommendation of a thing proposed for a stop attaches it to that stop, as on the web',
     count('SELECT COUNT(*) n FROM itinerary_stop_notes a JOIN itinerary_stops s ON s.id=a.stop_id JOIN objects o ON o.id=a.note_id WHERE s.uid=? AND o.uid=?', s2, cup.target.uid) === 1);

  const o = orphans(db);
  ok('I1 no orphans', o.length === 0, o.join(', '));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('increment4 test error:', e.message); process.exit(2); });
