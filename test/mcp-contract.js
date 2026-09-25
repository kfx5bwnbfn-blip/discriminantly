// MCP contract guard (live part).
//
// Compares what a running server actually generates with the current contract
// snapshot, test/fixtures/mcp-contract-v2.60.json (63 tools: v2.56 plus resolve_travel_mark and audit_itinerary; formerly 61:
// additive Increment 4 fields; the v2.55 snapshot stays as the release baseline):
//   - tools/list: every tool definition (also checked from source by the suite)
//   - initialize: server info, capabilities, server instructions
//   - OAuth discovery and protected-resource metadata, and the unauthenticated
//     challenge header
//   - the key/type shape of real results from representative tools
// Any difference fails. The historical surface submitted at v2.52.7 (review
// cancelled), test/fixtures/submitted-mcp-contract.json, is kept as a
// regression reference: --historical prints what changed since then, and fails
// only if a historical tool disappeared or OAuth/discovery changed.
//
// Normalised on purpose: the site origin becomes {ORIGIN}; the signed-in
// member's name and handle at the start of the server instructions become
// {MEMBER_NAME} and {MEMBER_HANDLE}; protocolVersion is requested at a fixed
// value; result shapes keep key names and value types, never values.
//
// Usage (server running):
//   BASE=http://localhost:3000 TOKEN=<member api token> SID=<that member's session cookie> [DB_PATH=...] node test/mcp-contract.js
//   ... --record      rewrites the CURRENT snapshot, as a deliberate decision
//                     when a contract change is approved. The historical
//                     snapshot is never rewritten.
//   ... --historical  compare with the historical submission instead
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, 'fixtures', 'mcp-contract-v2.60.json');
const HIST = path.join(__dirname, 'fixtures', 'submitted-mcp-contract.json');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''), TOKEN = process.env.TOKEN, SID = process.env.SID;
const RECORD = process.argv.includes('--record'), HISTORICAL = process.argv.includes('--historical');
const MCP_PATH = '/mcp/';
if (!TOKEN || !SID) { console.error('TOKEN and SID are required (a member api token and that member\u2019s session cookie).'); process.exit(2); }

const norm = (v) => JSON.parse(JSON.stringify(v).split(BASE).join('{ORIGIN}').split('https://www.discriminantly.com').join('{ORIGIN}'));
const shape = (v) => v === null ? 'null' : Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])])) : typeof v;
const rpc = async (method, params, auth = true) => {
  const r = await fetch(BASE + MCP_PATH + TOKEN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
};
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-guard', version: '1' } });
  const tools = (await rpc('tools/list', {})).tools;
  const asj = await (await fetch(BASE + '/.well-known/oauth-authorization-server')).json();
  const prm = await (await fetch(BASE + '/.well-known/oauth-protected-resource')).json();
  const unauth = await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });

  // representative results: the tools whose output is built from shared domain helpers
  const img = (await call('upload_image', { image: PNG })).ref;
  const note = await call('note_object', { headline: 'Contract guard note', image: img });
  const mark = await call('add_travel_mark', { place: 'Contract guard place', locality: 'L', country: 'C' });
  await call('log_visit', { id: mark.id, visited_on: '2026-09-01', body: 'x' });
  const it = await call('create_itinerary', { title: 'Contract guard plan' });
  await call('add_itinerary_stops', { itinerary_uid: it.uid, stops: [{ label: 'A stop', kind: 'particular' }, { label: 'Contract guard place', mark_uid: mark.uid }] });
  const one = await call('my_itineraries', { uid: it.uid });
  const stop = one.unplaced[0];
  // Attach a Note to that Stop through the web route: the frozen MCP view must
  // not change. The itinerary's integer id (the web URL) is read from the local
  // database, and the attachment is checked, so this can never pass vacuously.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'discriminantly.db'));
  const tid = db.prepare('SELECT id FROM itineraries WHERE uid=?').get(it.uid).id;
  const att = await fetch(`${BASE}/t/${tid}/stops/${stop.uid}/notes`, { method: 'POST', headers: { cookie: 'sid=' + SID, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ note_uid: note.uid }), redirect: 'manual' });
  const attached = db.prepare('SELECT COUNT(*) n FROM itinerary_stop_notes a JOIN itinerary_stops s ON s.id=a.stop_id WHERE s.uid=?').get(stop.uid).n;
  if (att.status !== 303 || attached !== 1) throw new Error(`could not attach a note to the stop (status ${att.status}, rows ${attached}); the Stop -> Note check would be vacuous`);
  const oneAfter = await call('my_itineraries', { uid: it.uid });
  const results = {
    search_catalogue: shape(await call('search_catalogue', { query: 'Contract guard' })),
    my_notes: shape(await call('my_notes', { limit: 3 })),
    my_travel_marks: shape(await call('my_travel_marks', {})),
    list_checkins: shape(await call('list_checkins', { mark_id: mark.id })),
    my_itineraries_list: shape(await call('my_itineraries', {})),
    my_itineraries_one: shape(one),
    my_itineraries_one_after_stop_note: shape(oneAfter),
  };
  if (!HISTORICAL) {
    // v2.55 tools, recorded only in the current snapshot
    // a public note of the caller's own, queried by its unique headline, so the
    // shape never depends on whatever other members noted most recently
    // (another member's item carries provenance null: test/tool-audit.js M3)
    const probe = 'Recent notes probe ' + Date.now().toString(36);   // unique: never another member's probe
    await call('note_object', { headline: probe, image: img, private: false });
    results.recent_notes = shape(await call('recent_notes', { query: probe, limit: 1 }));
    const rec = await call('record_recommendations', { items: [{ kind: 'object', label: 'Contract guard proposition', workflow: 'for_another_time' }] });
    results.record_recommendations = shape(rec);
    results.list_recommendations = shape(await call('list_recommendations', {}));
    results.dismiss_recommendation = shape(await call('dismiss_recommendation', { recommendation_uid: rec.items[0].recommendation.uid, reason: 'not_for_me' }));
    results.list_stop_notes = shape(await call('list_stop_notes', { itinerary_uid: it.uid }));
  }

  const now = norm({
    tools,
    initialize: { serverInfo: init.serverInfo, capabilities: init.capabilities,
      // the instructions open by naming the signed-in member; that is per-account, not contract
      instructions: String(init.instructions).replace(/connected to discriminant\.ly as .*? \(@[a-z0-9]+\)/, 'connected to discriminant.ly as {MEMBER_NAME} (@{MEMBER_HANDLE})') },
    discovery: { authorization_server: asj, protected_resource: prm, unauthenticated: { status: unauth.status, www_authenticate: unauth.headers.get('www-authenticate') } },
    result_shapes: results,
  });

  if (RECORD) { fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n'); console.log('recorded', FILE, '-', tools.length, 'tools'); return; }
  const want = JSON.parse(fs.readFileSync(HISTORICAL ? HIST : FILE, 'utf8'));
  let fail = 0;
  const cmp = (label, a, b) => { const same = JSON.stringify(a) === JSON.stringify(b); if (!same) fail++; console.log((same ? '  ok   ' : '  FAIL ') + label); };
  const info = (label) => console.log('  info ' + label);
  const removed = want.tools.filter((t) => !now.tools.find((x) => x.name === t.name)).map((t) => t.name);
  const changed = want.tools.filter((t) => { const l = now.tools.find((x) => x.name === t.name); return l && JSON.stringify(l) !== JSON.stringify(t); }).map((t) => t.name);
  const added = now.tools.filter((t) => !want.tools.find((x) => x.name === t.name)).map((t) => t.name);
  if (HISTORICAL) {
    // the shared write result gained the 'kept' action; tools whose only
    // difference is that are listed separately
    const sansKept = (t) => JSON.parse(JSON.stringify(t, (k, v) => (k === 'enum' && Array.isArray(v) && v.includes('kept') && v.includes('created')) ? v.filter((x) => x !== 'kept') : v));
    const meaning = changed.filter((n) => JSON.stringify(sansKept(now.tools.find((x) => x.name === n))) !== JSON.stringify(want.tools.find((x) => x.name === n)));
    cmp(`no historical tool removed or renamed (${want.tools.length})`, removed, []);
    info('changed since the historical submission: ' + (meaning.join(', ') || 'none'));
    info(`${changed.length - meaning.length} more differ only by the write result's new 'kept' action`);
    info('added since the historical submission: ' + (added.join(', ') || 'none'));
    info('server instructions ' + (now.initialize.instructions === want.initialize.instructions ? 'unchanged' : 'changed'));
  } else {
    cmp(`tool definitions (${now.tools.length} tools, all exactly as the v2.60 snapshot)`, now.tools, want.tools);
    for (const n of removed) console.log('       missing: ' + n);
    for (const n of changed) console.log('       changed: ' + n);
    for (const n of added) console.log('       added: ' + n);
    cmp('server info and capabilities', [now.initialize.serverInfo, now.initialize.capabilities], [want.initialize.serverInfo, want.initialize.capabilities]);
    cmp('server instructions', now.initialize.instructions, want.initialize.instructions);
  }
  cmp('OAuth authorization-server metadata', now.discovery.authorization_server, want.discovery.authorization_server);
  cmp('protected-resource metadata', now.discovery.protected_resource, want.discovery.protected_resource);
  cmp('unauthenticated challenge', now.discovery.unauthenticated, want.discovery.unauthenticated);
  // v2.58 added place_identity and location to each mark in my_travel_marks
  // (additive; every existing field is unchanged). Against the historical
  // submission those two keys are removed before comparing; everything else
  // in the shape must still match exactly.
  const sansIdentity = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'place_identity' || k === 'location') ? undefined : x));
  for (const k of Object.keys(want.result_shapes)) cmp('result shape: ' + k,
    HISTORICAL && k === 'my_travel_marks' ? sansIdentity(now.result_shapes[k]) : now.result_shapes[k], want.result_shapes[k]);
  cmp('Stop -> Note does not change the my_itineraries result', now.result_shapes.my_itineraries_one_after_stop_note, now.result_shapes.my_itineraries_one);
  console.log(fail ? `\n${fail} contract difference(s) from the ${HISTORICAL ? 'historical submission' : 'v2.60 snapshot'}.`
    : (HISTORICAL ? '\nHistorical comparison: nothing removed; OAuth, discovery and shared result shapes unchanged.' : '\nMCP contract matches the v2.60 snapshot.'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('contract guard error:', e.message); process.exit(2); });
