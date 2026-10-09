// v2.78: visit-date summaries never present a storage date as a visit date.
//
// An undated check-in stores the day it was logged in visits.visited_on purely
// so rows sort, with date_known=0. Every summary must consult date_known and
// say "date unknown", never show that placeholder as when the member went.
// Synthetic fixtures only, modelled on a real report (an undated visit whose
// note mentions a year, logged on the day the summary then claimed).
//
//   node test/visit-dates.js            (prints the MCP output it checked)
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 500) : '')); };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'visits-')), DB = path.join(work, 'd.db');
const port = 6900 + Math.floor(Math.random() * 300);
const env = { ...process.env, PORT: String(port), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off' }; delete env.MUSE_ORIGIN;
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
const req = (p, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method: body ? 'POST' : 'GET', path: p, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  }); r.on('error', reject); if (body) r.write(body); r.end();
});
const run = (sql, ...a) => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout=5000'); try { return d.prepare(sql).run(...a); } finally { d.close(); } };
const LOGGED = '2026-10-09';            // the day the fixture's undated visits were "logged"
(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await req('/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const tok = crypto.randomBytes(16).toString('hex');
    run('UPDATE users SET api_token=? WHERE id=1', tok);
    let rid = 0;
    const call = async (name, args) => JSON.parse((await req('/mcp/' + tok, JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }))).body).result;
    const mark = async (place) => (await call('add_travel_mark', { place, locality: 'Testville', country: 'Nowhere', allow_duplicate: true })).structuredContent.id;
    const visit = async (id, a) => (await call('log_visit', { id, ...a })).structuredContent;
    // Pin every undated visit's storage date and every created_at, so the test
    // does not depend on the day it runs.
    const pin = () => { run("UPDATE visits SET visited_on=? WHERE date_known=0", LOGGED); run("UPDATE visits SET created_at=? || ' 12:00:00'", LOGGED); };

    const undated = await mark('Zq Undated Tavern');
    await visit(undated, { date_unknown: true, body: 'Visited in 2019; exact date not recalled.' });
    const one = await mark('Zq One Dated');
    await visit(one, { visited_on: '2024-05-03' });
    const many = await mark('Zq Many Dated');
    await visit(many, { visited_on: '2023-01-10' });
    await visit(many, { visited_on: '2025-06-01', ended_on: '2025-06-03' });
    await visit(many, { visited_on: '2024-02-02' });
    const mixed = await mark('Zq Mixed Bar');
    await visit(mixed, { visited_on: '2022-08-08' });
    await visit(mixed, { date_unknown: true, body: 'Some time in the nineties.' });
    const twoUndated = await mark('Zq Two Undated');
    await visit(twoUndated, { date_unknown: true });
    await visit(twoUndated, { date_unknown: true, body: 'Again, sometime.' });
    const none = await mark('Zq Never Been');
    const created = await mark('Zq Created Late');
    await visit(created, { visited_on: '2020-03-04' });
    pin();
    run("UPDATE visits SET created_at='2026-01-01 08:00:00' WHERE mark_id=?", created);
    run("UPDATE marks SET created_at='2025-12-31 09:00:00' WHERE id=?", created);

    const list = await call('my_travel_marks', { query: 'Zq', limit: 20 });
    const lines = Object.fromEntries(list.content[0].text.split('\n').map((l) => [+(l.match(/^#(\d+)/) || [])[1], l]));
    const items = Object.fromEntries(list.structuredContent.items.map((x) => [x.id, x]));
    const bracket = (id) => (lines[id].match(/\[([^\]]*)\]$/) || [])[1];
    console.log('\n  my_travel_marks text, as checked:'); for (const id of [undated, one, many, mixed, twoUndated, none, created]) console.log('    ' + bracket(id) + '   <- ' + items[id].name + '  visits=' + JSON.stringify(items[id].visits));
    console.log('');

    ok('VD1 one undated visit: no logging date is shown as a visit date', bracket(undated) === '1 visit, date unknown' && !lines[undated].includes(LOGGED), lines[undated]);
    ok('VD2 a year in the note is not turned into a date (text or structure)', !/\b2019-\d\d|last 2019/.test(lines[undated]) && JSON.stringify(items[undated].visits) === '["Date unknown"]');
    const ck = (await call('list_checkins', { mark_id: undated })).structuredContent.items[0];
    ok('VD3 the check-in itself is unchanged: unknown date, null fields, the note as written', ck.date_known === false && ck.visited_on === null && ck.ended_on === null && ck.range === 'Date unknown' && ck.body === 'Visited in 2019; exact date not recalled.', JSON.stringify(ck));
    ok('VD4 one dated visit: its date', bracket(one) === '1 visit, last 2024-05-03', bracket(one));
    ok('VD5 several dated visits: the latest (a multi-day stay by its first day), count right', bracket(many) === '3 visits, last 2025-06-01', bracket(many));
    ok('VD6 several dated visits: structured labels newest first, the stay as its true range', /2025/.test(items[many].visits[0]) && /2024/.test(items[many].visits[1]) && /2023/.test(items[many].visits[2]) && /1.{1,3}3/.test(items[many].visits[0]) && items[many].visit_count === 3, JSON.stringify(items[many].visits));
    ok('VD7 mixed: the total counts both, and the date is labelled as the latest dated visit', bracket(mixed) === '2 visits, latest dated visit 2022-08-08; 1 without a date', bracket(mixed));
    ok('VD8 mixed: structured shows the dated one and "Date unknown", never the logging date', items[mixed].visit_count === 2 && items[mixed].visits.includes('Date unknown') && !JSON.stringify(items[mixed].visits).includes('Oct 9, 2026') && !lines[mixed].includes(LOGGED), JSON.stringify(items[mixed].visits));
    ok('VD9 several undated visits: plural, still no date', bracket(twoUndated) === '2 visits, dates unknown' && JSON.stringify(items[twoUndated].visits) === '["Date unknown","Date unknown"]', bracket(twoUndated));
    ok('VD10 zero visits: just the count', bracket(none) === '0 visits' && items[none].visit_count === 0 && items[none].visits.length === 0, bracket(none));
    ok('VD11 creation and update times never stand in for the visit date', bracket(created) === '1 visit, last 2020-03-04' && !lines[created].includes('2026-01-01') && !lines[created].includes('2025-12-31'), bracket(created));
    // text and structure state the same facts, for every fixture
    const agree = [undated, one, many, mixed, twoUndated, none, created].every((id) => {
      const it = items[id], b = bracket(id), n = +b.split(' ')[0];
      const undatedN = it.visits.filter((l) => l === 'Date unknown').length;
      return n === it.visit_count && (undatedN === 0 ? !/unknown|without a date/.test(b) : /unknown|without a date/.test(b))
        && (undatedN === it.visit_count ? !/\d{4}-\d\d-\d\d/.test(b) : true);
    });
    ok('VD12 text and structured output agree on the count and on which visits have dates', agree);

    // delete_checkin of an undated visit names it as undated, not by the storage date
    const del = await call('delete_checkin', { id: ck.id });
    ok('VD13 deleting an undated check-in reports it as "Date unknown", not the logging date', del.structuredContent.name === 'Date unknown' && !JSON.stringify(del).includes(LOGGED), JSON.stringify(del.structuredContent));
    // the web resurfacing "you checked in here N years ago" reads only dated visits
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const onThisDay = src.slice(src.indexOf('// 1. ON THIS DAY'), src.indexOf('// 2. ON THIS DAY'));
    ok('VD14 "On this day" anniversaries consider dated check-ins only', /date_known\s*<>\s*0|date_known\s*=\s*1/.test(onThisDay));
  } catch (e) { console.error(e); fail++; } finally { proc.kill(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(work, { recursive: true, force: true }); }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
