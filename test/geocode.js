// v2.77: server-side map placement for marks saved without coordinates.
// Photon is stubbed (GEOCODE_STUB), so the matching rules are tested exactly.
//
//   node test/geocode.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 400) : '')); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-')), DB = path.join(work, 'd.db'), STUB = path.join(work, 'stub.json');
const F = (name, street, num, city, state, country, lat, lng, type = 'house', extra = {}) => ({ geometry: { coordinates: [lng, lat] },
  properties: { name, street, housenumber: num, city, state, country, type, osm_type: 'N', osm_id: Math.floor(Math.random() * 1e9), ...extra } });
fs.writeFileSync(STUB, JSON.stringify({
  // street and number match, same city
  'Theia, 7 Elizabeth Street, Picton, Canada': [F('', 'Elizabeth Street', '7', 'Picton', 'Ontario', 'Canada', 44.0091, -77.1405)],
  // the name matches (no street data), city given as a ward with the prefecture as state
  'KAMA-ASA Kappabashi Store, 2-24-1 Matsugaya, Taito-ku, Tokyo 111-0036, Japan, Tokyo, Japan': [F('Kama-Asa Kappabashi Store', '', '', 'Taito', 'Tokyo', 'Japan', 35.7136, 139.7880, 'shop')],
  // only a namesake in another city: refused on every query
  'Nushi, 1 Main St, Kyoto, Japan': [F('Nushi', 'Main St', '1', 'Osaka', 'Osaka', 'Japan', 34.69, 135.50)],
  '1 Main St, Kyoto, Japan': [], 'Nushi, Kyoto, Japan': [F('Nushi', '', '', 'Osaka', 'Osaka', 'Japan', 34.69, 135.50)],
  // the street matches but the number differs: refused
  'Bar X, 15 Ross St, Picton, Canada': [F('', 'Ross St', '99', 'Picton', 'Ontario', 'Canada', 44.0, -77.1)],
  '15 Ross St, Picton, Canada': [], 'Bar X, Picton, Canada': [F('Picton', '', '', 'Picton', 'Ontario', 'Canada', 44.0, -77.1, 'city')],
}));
const port = 6600 + Math.floor(Math.random() * 300);
const env = { ...process.env, PORT: String(port), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE_STUB: STUB }; delete env.GEOCODE; delete env.MUSE_ORIGIN;
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
const req = (p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method: body ? 'POST' : 'GET', path: p, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  }); r.on('error', reject); if (body) r.write(body); r.end();
});
const db = () => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout=5000'); return d; };
const one = (sql, ...a) => { const d = db(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await req('/'); break; } catch { await wait(100); } }
    const tok = crypto.randomBytes(16).toString('hex');
    { const d = db(); d.prepare('UPDATE users SET api_token=? WHERE id=1').run(tok); d.close(); }
    let rid = 0;
    const call = async (name, args) => JSON.parse((await req('/mcp/' + tok, JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }))).body).result;
    const add = async (a) => (await call('add_travel_mark', a)).structuredContent;
    const theia = await add({ place: 'Theia', address: '7 Elizabeth Street', locality: 'Picton', country: 'Canada' });
    const kama = await add({ place: 'KAMA-ASA Kappabashi Store', address: '2-24-1 Matsugaya, Taito-ku, Tokyo 111-0036, Japan', locality: 'Tokyo', country: 'Japan', private: true });
    const nushi = await add({ place: 'Nushi', address: '1 Main St', locality: 'Kyoto', country: 'Japan' });
    const barx = await add({ place: 'Bar X', address: '15 Ross St', locality: 'Picton', country: 'Canada' });
    const given = await add({ place: 'Given', address: '1 Front St', locality: 'Toronto', country: 'Canada', lat: 43.6, lng: -79.4 });
    const idOf = (x) => x.id || (x.items && x.items[0] && x.items[0].id);
    await wait(7000);
    const m = (x) => one('SELECT * FROM marks WHERE id=?', idOf(x));
    ok('GC1 a mark saved with only an address gets its pin when the street and number match', m(theia).lat === 44.0091 && m(theia).lng === -77.1405, JSON.stringify(m(theia)));
    ok('GC2 a name match in the same city places it (prefecture/ward cities count)', m(kama).lat === 35.7136, JSON.stringify(m(kama)));
    ok('GC3 a namesake in another city is never used', m(nushi).lat === null);
    ok('GC4 the same street with a different number is not enough, and a city-level result is never used', m(barx).lat === null);
    ok('GC5 coordinates the caller gave are never touched', m(given).lat === 43.6 && !one('SELECT 1 FROM geocode_attempts WHERE mark_id=?', idOf(given)));
    const pv = one("SELECT * FROM provenance WHERE entity_type='mark' AND entity_uid=? AND action='enriched'", m(theia).uid);
    ok('GC6 the lookup is in the mark’s history as the system’s act, from Photon, for lat/lng only', pv && pv.actor_type === 'system' && pv.source_kind === 'photon' && /^osm:N\//.test(pv.source_ref) && pv.fields === 'lat,lng', JSON.stringify(pv));
    ok('GC7 it never claims the mark was verified', m(theia).verified === 0 || m(theia).verified == null);
    ok('GC8 each outcome is recorded once per address', one('SELECT outcome FROM geocode_attempts WHERE mark_id=?', idOf(nushi)).outcome === 'no_match' && one('SELECT outcome FROM geocode_attempts WHERE mark_id=?', idOf(theia)).outcome === 'placed');
    ok('GC9 the log names ids and outcomes, never a place name or address', /geocode mark #\d+ placed/.test(log) && !/geocode[^\n]*(Theia|Elizabeth|Kappabashi|Nushi)/.test(log));
    const page = (await req('/m/' + idOf(theia))).body;
    ok('GC10 and the map shows on the mark', /class="mark-map/.test(page));
  } catch (e) { console.error(e); fail++; } finally { proc.kill(); await wait(300); fs.rmSync(work, { recursive: true, force: true }); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
