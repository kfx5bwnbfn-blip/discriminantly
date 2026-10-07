// v2.69.1 write safety, from the Muse dogfooding debrief:
//   - an argument a tool does not accept is reported, never a silent success;
//   - add_itinerary_stops is all or nothing, and checks before it creates;
//   - a kept plan reuses a place the member already keeps;
//   - an overlapping check-in is recorded but called out;
//   - recommendations whose plan was deleted say so.
// Self-contained: starts its own server on a fresh database.
//
//   node test/write-safety.js
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 500) : '')); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'write-safety-'));
const port = 5400 + Math.floor(Math.random() * 400);
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), DB_PATH: path.join(work, 'd.db'), SEED: '1', ADMIN_PASSWORD: 'prototype1', PUBLIC_ORIGIN: 'http://localhost:' + port } });
let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
const post = (p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'content-type': 'application/json' } }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(b));
  });
  r.on('error', reject); r.write(body); r.end();
});
let TOK; let rid = 0;
const call = async (name, args) => {
  const j = JSON.parse(await post('/mcp/' + TOK, JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } })));
  const r = j.result; return { text: r.content[0].text, s: r.structuredContent, meta: r._meta || {}, err: !!r.isError };
};

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await post('/', '{}'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    TOK = crypto.randomBytes(16).toString('hex');
    { const d = new DatabaseSync(path.join(work, 'd.db')); d.exec('PRAGMA busy_timeout=5000'); d.prepare('UPDATE users SET api_token=? WHERE id=1').run(TOK); d.close(); }
    const db = new DatabaseSync(path.join(work, 'd.db'), { readOnly: true });
    const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

    console.log('ignored arguments');
    const it = await call('create_itinerary', { title: 'Write safety test' });
    const itUid = it.s.uid;
    const add = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [{ label: 'Dinner' }] });
    const stopUid = add.s.stops[0].uid;
    const plain = await call('update_itinerary_stop', { stop_uid: stopUid, label: 'Dinner at eight' });
    ok('WS1 a conforming call is unchanged: no notice, no ignored-arguments meta', !/NOT APPLIED/.test(plain.text) && !('discriminantly/ignored_arguments' in plain.meta), plain.text);
    const timed = await call('update_itinerary_stop', { stop_uid: stopUid, time: '7:00 PM' });
    ok('WS2 `time` on update_itinerary_stop is reported as not applied, with where times go',
      /NOT APPLIED: update_itinerary_stop does not accept `time`/.test(timed.text) && /update_itinerary_temporal/.test(timed.text) && /clock "19:00"/.test(timed.text), timed.text);
    ok('WS3 ...and named in _meta (names only, never values)', JSON.stringify(timed.meta['discriminantly/ignored_arguments']) === '["time"]' && !JSON.stringify(timed.meta).includes('7:00'));
    ok('WS4 ...and logged by name only', /\[tool-ignored-args\] tool=update_itinerary_stop member=@\S+ args=\[time\]/.test(log) && !/7:00 PM/.test(log));
    const nested = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [{ label: 'Drinks', start_time: '21:00' }] });
    ok('WS5 an undeclared key inside a stop is reported as stops[].start_time', /`stops\[\]\.start_time`/.test(nested.text) && !nested.err, nested.text);
    const tmp = await call('update_itinerary_temporal', { target: 'stop', uid: stopUid, clock: '19:00' });
    ok('WS6 the right way still works and carries no notice', !tmp.err && !/NOT APPLIED/.test(tmp.text), tmp.text);
    const hidden = await call('note_object', { headline: 'x', image_uid: 'nope' });
    ok('WS7 a name a handler reads but does not declare (note_object image_uid) is never reported', !/NOT APPLIED/.test(hidden.text), hidden.text);
    const ro = await call('my_itineraries', { uid: itUid, verbose: true });
    ok('WS8 read tools report ignored names too', /NOT APPLIED: my_itineraries does not accept `verbose`/.test(ro.text));
    {
      // The allow-list stays in step with the code: every argument a handler
      // reads is declared in its inputSchema or listed in ARGS_READ_UNDECLARED.
      const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
      const listed = Function('return ' + src.match(/const ARGS_READ_UNDECLARED = (\{[\s\S]*?\n\});/)[1])();
      const tools = JSON.parse(await post('/mcp/' + TOK, JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/list' }))).result.tools;
      const start = src.indexOf('async function mcpCall('), body = src.slice(start, src.indexOf('\n}\n', start));
      const marks = [...body.matchAll(/name === '([a-z_]+)'/g)].map((m) => [m.index, m[1]]);
      const missing = [];
      for (let i = 0; i < marks.length; i++) {
        const seg = body.slice(marks[i][0], i + 1 < marks.length ? marks[i + 1][0] : body.length);
        const t = tools.find((x) => x.name === marks[i][1]); if (!t) continue;
        const props = Object.keys((t.inputSchema && t.inputSchema.properties) || {});
        for (const k of new Set([...seg.matchAll(/\ba\.([A-Za-z_]+)/g)].map((m) => m[1])))
          if (!k.startsWith('_') && !props.includes(k) && !(listed[t.name] || []).includes(k)) missing.push(`${t.name}.${k}`);
      }
      // delete_note's segment runs into the temporal helpers it shares; those
      // names belong to update_itinerary_temporal, which declares them.
      const real = missing.filter((m) => !/^delete_note\./.test(m));
      ok('WS9 every argument a handler reads is declared or allow-listed', real.length === 0, real.join(', '));
    }

    console.log('add_itinerary_stops is all or nothing');
    const marks0 = count('marks'), stops0 = count('itinerary_stops');
    const bad = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [
      { label: 'Gallery', new_place: { name: 'Write Safety Gallery', locality: 'Picton', country: 'Canada' } },
      { label: 'Supper', clock: '7:00 PM' }] });
    ok('WS10 a refused second stop refuses the call, naming the stop', bad.err && /Stop 2 \("Supper"\): clock must be HH:MM, 24-hour/.test(bad.text) && /No stops were added/.test(bad.text), bad.text);
    ok('WS11 ...and nothing from the first stop remains: no stop, no Mark', count('marks') === marks0 && count('itinerary_stops') === stops0, `${count('marks')} vs ${marks0}`);
    const solo = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [{ label: 'Gallery', clock: 'nine', new_place: { name: 'Write Safety Gallery', locality: 'Picton', country: 'Canada' } }] });
    ok('WS12 a single refused stop keeps its original message and creates no Mark', solo.err && /^clock must be HH:MM, 24-hour/.test(solo.text) && count('marks') === marks0, solo.text);
    const good = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [
      { label: 'Gallery', new_place: { name: 'Write Safety Gallery', locality: 'Picton', country: 'Canada' } }, { label: 'Supper', clock: '19:00' }] });
    ok('WS13 the corrected call adds both, with one new Mark', !good.err && good.s.stops.length === 2 && count('marks') === marks0 + 1, good.text);

    console.log('a kept plan reuses a place the member keeps');
    const m = await call('add_travel_mark', { place: 'Write Safety Bistro', locality: 'Picton', country: 'Canada', why: 'Test.' });
    const marks1 = count('marks');
    const again = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [{ label: 'Bistro', new_place: { name: 'Write Safety Bistro', locality: 'Picton', country: 'Canada' } }] });
    ok('WS14 new_place naming a kept Mark links that Mark instead of duplicating it', !again.err && count('marks') === marks1 && again.s.stops[0].mark_uid === m.s.uid, again.text);
    const fresh = await call('add_itinerary_stops', { itinerary_uid: itUid, stops: [{ label: 'Cafe', new_place: { name: 'Write Safety Cafe', locality: 'Picton', country: 'Canada' } }] });
    ok('WS15 a place the member does not have still gets a new kept Mark, as submitted', !fresh.err && count('marks') === marks1 + 1, fresh.text);

    console.log('overlapping check-ins are called out');
    const mid = m.s.id;
    const v1 = await call('log_visit', { id: mid, visited_on: '2026-09-12', body: 'Lovely.' });
    ok('WS16 a first check-in carries no warning', !v1.err && !/POSSIBLE DUPLICATE/.test(v1.text), v1.text);
    const v2 = await call('log_visit', { id: mid, visited_on: '2026-09-12', body: 'Lovely evening.' });
    ok('WS17 a second check-in on the same date is recorded and called out', !v2.err && /POSSIBLE DUPLICATE/.test(v2.text) && /delete_checkin/.test(v2.text)
      && db.prepare('SELECT COUNT(*) c FROM visits WHERE mark_id=?').get(mid).c === 2, v2.text);
    const v3 = await call('log_visit', { id: mid, visited_on: '2026-09-12', body: 'Lovely evening.' });
    ok('WS18 an identical retry is still absorbed, as before', /was just recorded; nothing new was added/.test(v3.text) && db.prepare('SELECT COUNT(*) c FROM visits WHERE mark_id=?').get(mid).c === 2, v3.text);
    const v4 = await call('log_visit', { id: mid, visited_on: '2026-09-20' });
    ok('WS19 a different date carries no warning', !/POSSIBLE DUPLICATE/.test(v4.text), v4.text);

    console.log('recommendations whose plan was deleted');
    const plan = await call('create_itinerary', { title: 'Soon deleted' });
    const rec = await call('record_recommendations', { items: [{ kind: 'place', label: 'A quiet bar', workflow: 'for_another_time', context_itinerary_uid: plan.s.uid }] });
    ok('WS20 recommendation recorded', !rec.err, rec.text);
    await call('delete_itinerary_entity', { kind: 'itinerary', uid: plan.s.uid });
    const list = await call('list_recommendations', {});
    const grp = (list.s.groups || []).find((g) => g.itinerary_uid === plan.s.uid);
    ok('WS21 its group is titled as a deleted plan, not "A trip"', grp && grp.title === 'A plan that has since been deleted', JSON.stringify(grp));
    db.close();
  } catch (e) { console.error(e); fail++; } finally {
    proc.kill(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
