// MCP contract guard (live part).
//
// The submitted ChatGPT Plugin's MCP surface is frozen while it is under
// review. This compares what a running server actually generates with the
// checked-in snapshot test/fixtures/submitted-mcp-contract.json:
//   - tools/list: every tool definition (also checked from source by the suite)
//   - initialize: server info, capabilities, server instructions
//   - OAuth discovery and protected-resource metadata, and the unauthenticated
//     challenge header
//   - the key/type shape of real results from representative tools, including
//     my_itineraries on a Stop that has a Note attached (Stop -> Note must not
//     leak into the frozen response)
//
// Normalised on purpose: the site origin (it differs between local and
// production) becomes {ORIGIN}; the signed-in member's name and handle at the
// start of the server instructions become {MEMBER_NAME} and {MEMBER_HANDLE};
// protocolVersion is always requested as
// 2025-06-18 because initialize echoes the client's value; result shapes keep
// key names and value types, never values (ids, uids and text vary per run).
//
// Usage (server running; see docs/plugin-submission.md, "MCP freeze"):
//   BASE=http://localhost:3000 TOKEN=<member api token> SID=<that member's session cookie> [DB_PATH=...] node test/mcp-contract.js
//   ... --record   rewrites the snapshot. Only do this as a deliberate decision
//                  when the freeze is lifted or a contract change is approved.
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, 'fixtures', 'submitted-mcp-contract.json');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''), TOKEN = process.env.TOKEN, SID = process.env.SID;
const RECORD = process.argv.includes('--record');
if (!TOKEN || !SID) { console.error('TOKEN and SID are required (a member api token and that member\u2019s session cookie).'); process.exit(2); }

const norm = (v) => JSON.parse(JSON.stringify(v).split(BASE).join('{ORIGIN}').split('https://www.discriminantly.com').join('{ORIGIN}'));
const shape = (v) => v === null ? 'null' : Array.isArray(v) ? (v.length ? [shape(v[0])] : []) : typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])])) : typeof v;
const rpc = async (method, params, auth = true) => {
  const r = await fetch(BASE + '/mcp/' + TOKEN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
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

  const now = norm({
    tools,
    initialize: { serverInfo: init.serverInfo, capabilities: init.capabilities,
      // the instructions open by naming the signed-in member; that is per-account, not contract
      instructions: String(init.instructions).replace(/connected to discriminant\.ly as .*? \(@[a-z0-9]+\)/, 'connected to discriminant.ly as {MEMBER_NAME} (@{MEMBER_HANDLE})') },
    discovery: { authorization_server: asj, protected_resource: prm, unauthenticated: { status: unauth.status, www_authenticate: unauth.headers.get('www-authenticate') } },
    result_shapes: results,
  });

  if (RECORD) { fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n'); console.log('recorded', FILE, '-', tools.length, 'tools'); return; }
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let fail = 0;
  const cmp = (label, a, b) => { const same = JSON.stringify(a) === JSON.stringify(b); if (!same) fail++; console.log((same ? '  ok   ' : '  FAIL ') + label); };
  cmp('tool definitions (' + tools.length + ' tools)', now.tools, want.tools);
  for (const t of want.tools) { const live = now.tools.find((x) => x.name === t.name); if (!live) console.log('       missing: ' + t.name); else if (JSON.stringify(live) !== JSON.stringify(t)) console.log('       changed: ' + t.name); }
  for (const t of now.tools) if (!want.tools.find((x) => x.name === t.name)) console.log('       added: ' + t.name);
  cmp('server info and capabilities', [now.initialize.serverInfo, now.initialize.capabilities], [want.initialize.serverInfo, want.initialize.capabilities]);
  cmp('server instructions', now.initialize.instructions, want.initialize.instructions);
  cmp('OAuth authorization-server metadata', now.discovery.authorization_server, want.discovery.authorization_server);
  cmp('protected-resource metadata', now.discovery.protected_resource, want.discovery.protected_resource);
  cmp('unauthenticated challenge', now.discovery.unauthenticated, want.discovery.unauthenticated);
  for (const k of Object.keys(want.result_shapes)) cmp('result shape: ' + k, now.result_shapes[k], want.result_shapes[k]);
  cmp('Stop -> Note does not change the frozen my_itineraries result', now.result_shapes.my_itineraries_one_after_stop_note, now.result_shapes.my_itineraries_one);
  console.log(fail ? `\n${fail} contract difference(s): the submitted MCP surface has drifted.` : '\nMCP contract matches the submitted snapshot.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('contract guard error:', e.message); process.exit(2); });
