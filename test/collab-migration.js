// Migration 062 (shared itineraries) on a database made by the PREVIOUS
// release: linked stops are backfilled with their Mark's identity fields only,
// the backfill is idempotent, and the identity survives the Mark's deletion.
//
//   BASELINE_DIR=/path/to/previous/release node test/collab-migration.js
const { spawn, execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASELINE_DIR;
if (!BASE) { console.error('BASELINE_DIR is required'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 500) : '')); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-mig-')), DB = path.join(work, 'd.db');
const env = (port) => { const e = { ...process.env, PORT: String(port), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', PUBLIC_ORIGIN: 'http://localhost:' + port }; delete e.MUSE_ORIGIN; return e; };
function boot(dir, port) {
  const p = spawn(process.execPath, ['server.js'], { cwd: dir, env: env(port), stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', (d) => { p.log += d; }); p.stderr.on('data', (d) => { p.log += d; });
  return p;
}
const req = (port, p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method: body ? 'POST' : 'GET', path: p, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const up = async (port) => { for (let i = 0; i < 100; i++) { try { await req(port, '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('server did not start'); };
const stop = (p) => new Promise((r) => { p.on('exit', r); p.kill(); });
const db = () => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout=5000'); return d; };

(async () => {
  let old, neu;
  try {
    // 1. the previous release makes the data
    const p1 = 6300 + Math.floor(Math.random() * 300);
    old = boot(BASE, p1); await up(p1);
    const tok = crypto.randomBytes(16).toString('hex');
    { const d = db(); d.prepare('UPDATE users SET api_token=? WHERE id=1').run(tok); d.close(); }
    let rid = 0;
    const call = async (name, args) => JSON.parse(await req(p1, '/mcp/' + tok, JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }))).result;
    const it = (await call('create_itinerary', { title: 'Old plan' })).structuredContent;
    const add = (await call('add_itinerary_stops', { itinerary_uid: it.uid, stops: [
      { label: 'Dinner', new_place: { name: 'Old Theia', locality: 'Picton', country: 'Canada', address: '15 Ross St', lat: 44.007, lng: -77.141, why: 'PERSONAL-WHY' } },
      { label: 'A walk', kind: 'experiential' }] })).structuredContent;
    const linked = add.stops[0], mark = add.stops[0].mark_uid;
    { const d = db(); d.prepare("UPDATE marks SET tags='personal-tag', external_id='osm:node/42', identity_basis='stable_external_id' WHERE uid=?").run(mark); d.close(); }
    await stop(old); old = null;
    { const d = db(); const cols = d.prepare('PRAGMA table_info(itinerary_stops)').all().map((c) => c.name); d.close();
      ok('MG0 the previous release has no stop place-identity columns', !cols.includes('place_name') && cols.includes('place_locality')); }

    // 2. this release upgrades it
    const p2 = p1 + 1;
    neu = boot(ROOT, p2); await up(p2);
    ok('MG1 migration 062 ran and reported its backfill', /Migration applied: 062-shared-itineraries/.test(neu.log) && /Place identity backfilled on 1 linked stop/.test(neu.log), neu.log.slice(0, 800));
    const d = db();
    const st = d.prepare('SELECT * FROM itinerary_stops WHERE uid=?').get(linked.uid);
    ok('MG2 the linked stop carries its Mark’s identity: name, address, position, city, country, external id, basis',
      st.place_name === 'Old Theia' && st.place_address === '15 Ross St' && st.place_lat === 44.007 && st.place_lng === -77.141
      && st.place_locality === 'Picton' && st.place_country === 'Canada' && st.place_external_id === 'osm:node/42' && st.place_identity_basis === 'stable_external_id', JSON.stringify(st));
    ok('MG3 nothing personal was copied (no why, no tags anywhere on the stop)', !JSON.stringify(st).includes('PERSONAL-WHY') && !JSON.stringify(st).includes('personal-tag'));
    const exp = d.prepare('SELECT * FROM itinerary_stops WHERE uid=?').get(add.stops[1].uid);
    ok('MG4 a stop with no Mark is left as it was', exp.place_name === '' && exp.place_address === '' && exp.place_lat === null);
    ok('MG5 no membership rows: the plan is still single-owner', d.prepare('SELECT COUNT(*) n FROM itinerary_members').get().n === 0);
    d.close();
    await stop(neu); neu = null;
    const rep = JSON.parse(execFileSync(process.execPath, ['server.js', '--place-backfill-report'], { cwd: ROOT, env: env(0) }).toString().trim().split('\n').pop());
    ok('MG6 idempotent: a dry run afterwards finds nothing to change', rep.stops === 0 && rep.dryRun === true, JSON.stringify(rep));
    { const d2 = db(); d2.prepare('DELETE FROM marks WHERE uid=?').run(mark);
      const after = d2.prepare('SELECT * FROM itinerary_stops WHERE uid=?').get(linked.uid); d2.close();
      ok('MG7 the identity survives the source Mark’s deletion', after.mark_uid === null && after.place_name === 'Old Theia' && after.place_address === '15 Ross St' && after.place_external_id === 'osm:node/42'); }
  } catch (e) { console.error(e); fail++; } finally {
    for (const p of [old, neu]) if (p) p.kill();
    await new Promise((r) => setTimeout(r, 300)); fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
