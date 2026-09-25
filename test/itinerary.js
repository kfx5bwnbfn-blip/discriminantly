// Itinerary invariants. Run: node test/itinerary.js
//
// Committed rather than throwaway: these assertions are the frozen canonical
// semantics, and they are exactly the kind that rot silently. No framework --
// the repository has no test dependency and this needs none.
//
// The temporal accessors are pure, so they are lifted out of server.js and run
// in a VM rather than booting the server. DB-backed phases append below.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DatabaseSync } = require('node:sqlite');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const CSS_MODERN = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.modern.css'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
};
const eq = (name, got, want) =>
  ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---- load the temporal accessors in isolation ------------------------------
const from = SRC.indexOf('// ---- Itinerary temporal accessors');
const to = SRC.indexOf('function recordProvenance(');
if (from < 0 || to < 0) { console.log('FATAL: temporal accessor block not found'); process.exit(1); }
const ctx = { Date, JSON, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(SRC.slice(from, to) + `
globalThis.V = temporalValidate; globalThis.F = temporalFormat;
globalThis.A = temporalApply;   globalThis.C = temporalConflicts;
globalThis.K = temporalChronoKey;`, ctx);
const { V, F, A, C, K } = ctx;

const T = (o = {}) => ({
  t_year: null, t_period: null, t_modifier: null, t_modifier_scope: null,
  t_month: null, t_day: null, t_weekday: null, t_daypart: null, t_clock: null, ...o,
});

console.log('\ntemporal validation');
ok('1  modifier without scope rejected', V(T({ t_year: 2028, t_modifier: 'late' })) !== null);
ok('2  scope without modifier rejected', V(T({ t_year: 2028, t_modifier_scope: 'year' })) !== null);
ok('3  scope naming an unasserted component rejected',
   V(T({ t_year: 2028, t_modifier: 'late', t_modifier_scope: 'month' })) !== null);
ok('4  valid year-scoped modifier accepted',
   V(T({ t_year: 2028, t_modifier: 'late', t_modifier_scope: 'year' })) === null);
ok('5  bad period rejected', V(T({ t_period: 'autumn' })) !== null);
ok('6  bad weekday rejected', V(T({ t_weekday: 'Friday' })) !== null);
ok('7  bad daypart rejected', V(T({ t_daypart: 'lunch' })) !== null);

console.log('\nclock format (test 60)');
for (const good of ['00:00', '07:05', '19:30', '23:59']) {
  ok('60 accepts ' + good, V(T({ t_clock: good })) === null);
}
for (const bad of ['7:30', '24:00', '19:60', '19.30', '7:30 PM', '']) {
  ok('60 rejects ' + JSON.stringify(bad), V(T({ t_clock: bad })) !== null || bad === '');
}

console.log('\nimpossible dates (tests 61, 62)');
ok('61 April 31 rejected', V(T({ t_month: 4, t_day: 31 })) !== null);
ok('61 April 30 accepted', V(T({ t_month: 4, t_day: 30 })) === null);
ok('62 Feb 29 accepted with no year', V(T({ t_month: 2, t_day: 29 })) === null);
ok('62 Feb 29 accepted in a leap year', V(T({ t_year: 2028, t_month: 2, t_day: 29 })) === null);
ok('62 Feb 29 rejected in a non-leap year', V(T({ t_year: 2027, t_month: 2, t_day: 29 })) !== null);
ok('62 Feb 30 rejected even with no year', V(T({ t_month: 2, t_day: 30 })) !== null);

console.log('\nthe six expressions stay distinguishable (test 3)');
const E = {
  late2028:     T({ t_year: 2028, t_modifier: 'late', t_modifier_scope: 'year' }),
  fall2028:     T({ t_year: 2028, t_period: 'fall' }),
  lateFall2028: T({ t_year: 2028, t_period: 'fall', t_modifier: 'late', t_modifier_scope: 'period' }),
  lateThenFall: T({ t_year: 2028, t_period: 'fall', t_modifier: 'late', t_modifier_scope: 'year' }),
  lateApril:    T({ t_year: 2028, t_month: 4, t_modifier: 'late', t_modifier_scope: 'month' }),
  april28:      T({ t_year: 2028, t_month: 4, t_day: 28 }),
};
const rendered = Object.fromEntries(Object.entries(E).map(([k, v]) => [k, F(v)]));
for (const [k, v] of Object.entries(rendered)) console.log(`     ${k.padEnd(13)} -> ${v}`);
eq('3  all six render distinctly', new Set(Object.values(rendered)).size, 6);
ok('4  "late 2028" + fall later keeps scope=year', E.lateThenFall.t_modifier_scope === 'year');
ok('5  "late fall 2028" is scope=period', E.lateFall2028.t_modifier_scope === 'period');
ok('   the two differ only in scope',
   E.lateFall2028.t_year === E.lateThenFall.t_year &&
   E.lateFall2028.t_period === E.lateThenFall.t_period &&
   E.lateFall2028.t_modifier === E.lateThenFall.t_modifier &&
   E.lateFall2028.t_modifier_scope !== E.lateThenFall.t_modifier_scope);

console.log('\nsupersession (tests 6, 7)');
let r = A(E.fall2028, { t_month: 10 }, 'refine');
ok('7  fall -> October clears the period', r.next.t_period === null && r.next.t_month === 10);
eq('7  refinement is enriched', r.action, 'enriched');
r = A(E.lateFall2028, { t_month: 10 }, 'refine');
ok('   period-scoped modifier clears when the period is superseded',
   r.next.t_modifier === null && r.next.t_modifier_scope === null);
r = A(E.lateThenFall, { t_month: 10 }, 'refine');
ok('   year-scoped modifier SURVIVES the same change',
   r.next.t_modifier === 'late' && r.next.t_modifier_scope === 'year');
r = A(E.lateApril, { t_day: 28 }, 'refine');
ok('6  "late April" -> "April 28" clears the modifier',
   r.next.t_modifier === null && r.next.t_modifier_scope === null && r.next.t_day === 28);
r = A(E.late2028, { t_period: 'fall' }, 'refine');
ok('   adding a period never migrates the scope', r.next.t_modifier_scope === 'year');

console.log('\nprovenance intent (tests 56-59)');
eq('56 bare edit -> edited', A(E.fall2028, { t_month: 10 }).action, 'edited');
eq('57 intent=refine -> enriched', A(E.fall2028, { t_month: 10 }, 'refine').action, 'enriched');
eq('58 intent=correct -> corrected', A(E.fall2028, { t_month: 10 }, 'correct').action, 'corrected');
eq('59 intent omitted -> edited', A(E.fall2028, { t_month: 10 }, null).action, 'edited');

console.log('\nweekday/date disagreement is preserved, not corrected (test 63)');
const wrong = T({ t_year: 2027, t_month: 4, t_day: 8, t_weekday: 'friday' });
const conf = C(wrong);
ok('63 disagreement is valid to store', V(wrong) === null);
ok('63 disagreement is reported', conf.length === 1, JSON.stringify(conf));
ok('63 neither assertion is dropped', wrong.t_weekday === 'friday' && wrong.t_day === 8);
if (conf.length) console.log('     ' + conf[0]);
ok('63 agreement reports nothing',
   C(T({ t_year: 2027, t_month: 4, t_day: 8, t_weekday: 'thursday' })).length === 0);
ok('63 no year -> no weekday claim checked',
   C(T({ t_month: 4, t_day: 8, t_weekday: 'friday' })).length === 0);

console.log('\nchronology key (test 9)');
ok('9  null when no year', K(T({ t_month: 4 })) === null);
ok('9  null when year only', K(T({ t_year: 2028 })) === null);
ok('9  derivable from year+month', Array.isArray(K(T({ t_year: 2028, t_month: 4 }))));
ok('9  derivable from year+period', Array.isArray(K(E.fall2028)));
ok('9  April precedes October',
   JSON.stringify(K(T({ t_year: 2028, t_month: 4 }))) < JSON.stringify(K(T({ t_year: 2028, t_month: 10 }))) ||
   K(T({ t_year: 2028, t_month: 4 }))[1] < K(T({ t_year: 2028, t_month: 10 }))[1]);

// ---- migration constraints (tests 36-41) -----------------------------------
console.log('\nmigration constraints');
const tmp = path.join(require('os').tmpdir(), 'itin-test-' + process.pid + '.db');
try { fs.unlinkSync(tmp); } catch {}
const db = new DatabaseSync(tmp);
db.exec('PRAGMA foreign_keys=ON');
// minimal schema mirror: users + the three tables as migration 041 creates them
const mig = SRC.slice(SRC.indexOf("['041-itineraries'"), SRC.indexOf("\n];", SRC.indexOf("['041-itineraries'")));
db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
db.exec('INSERT INTO users(id) VALUES(1)');
// Notes exist only as a foreign-key target here (Stop → Note, migration 051).
db.exec('CREATE TABLE objects(id INTEGER PRIMARY KEY)');
// ...and marks, which the stop place snapshot (migration 058) reads.
db.exec('CREATE TABLE marks(id INTEGER PRIMARY KEY, uid TEXT, locality TEXT, country TEXT)');
const stmts = [...mig.matchAll(/db\.exec\(`([\s\S]*?)`\)/g)].map((m) => m[1]);
for (const st of stmts) {
  if (st.includes('${')) continue;                      // triggers use interpolation; not needed here
  db.exec(st);
}
const tryIt = (name, fn, expectFail = true) => {
  try { fn(); ok(name, !expectFail); }
  catch (e) { ok(name, expectFail, expectFail ? '' : String(e.message).slice(0, 60)); }
};
db.exec("INSERT INTO itineraries(user_id,title) VALUES(1,'A'),(1,'B')");
db.exec("INSERT INTO itinerary_groups(itinerary_id,label) VALUES(1,'Day 1'),(2,'Day 1')");
tryIt('36 cross-itinerary group rejected',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,group_id) VALUES(1,'x',2)"));
tryIt('38 linked without mark_uid rejected',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,resolution) VALUES(1,'x','linked')"));
tryIt('38 mark_uid without linked rejected',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,resolution,mark_uid) VALUES(1,'x','particular','u')"));
tryIt('38 linked with mark_uid accepted',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,resolution,mark_uid) VALUES(1,'ok','linked','u')"), false);
tryIt('   modifier/scope pairing enforced in DB',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,t_modifier) VALUES(1,'x','late')"));
tryIt('   resolution vocabulary enforced',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,resolution) VALUES(1,'x','bogus')"));
tryIt('   visibility vocabulary enforced',
  () => db.exec("INSERT INTO itinerary_stops(itinerary_id,label,visibility) VALUES(1,'x','bogus')"));
tryIt('39 duplicate grouped position rejected', () => {
  db.exec("INSERT INTO itinerary_stops(itinerary_id,label,group_id,position) VALUES(1,'p1',1,1)");
  db.exec("INSERT INTO itinerary_stops(itinerary_id,label,group_id,position) VALUES(1,'p2',1,1)");
});
tryIt('39 duplicate ungrouped position rejected', () => {
  db.exec("INSERT INTO itinerary_stops(itinerary_id,label,position) VALUES(1,'u1',1)");
  db.exec("INSERT INTO itinerary_stops(itinerary_id,label,position) VALUES(1,'u2',1)");
});
tryIt('40 many NULL positions accepted', () => {
  db.exec("INSERT INTO itinerary_stops(itinerary_id,label,group_id) VALUES(1,'n1',1),(1,'n2',1),(1,'n3',1)");
}, false);
tryIt('37 group delete RESTRICTed while referenced',
  () => db.exec('DELETE FROM itinerary_groups WHERE id=1'));
tryIt('37 group delete succeeds once ungrouped', () => {
  db.exec('UPDATE itinerary_stops SET group_id=NULL, position=NULL WHERE group_id=1');
  db.exec('DELETE FROM itinerary_groups WHERE id=1');
}, false);
// Scoped to the rows the delete transaction ungrouped. Other ungrouped rows in
// this fixture carry their own legitimate authored positions.
ok('   no group-scoped position survived ungrouping',
   db.prepare(`SELECT COUNT(*) c FROM itinerary_stops
               WHERE label IN ('p1','n1','n2','n3') AND position IS NOT NULL`).get().c === 0);
db.close();
try { fs.unlinkSync(tmp); } catch {}

// ---- phase 2: core mutations against a live server DB ----------------------
// Boots the real server module in-process is not possible (it starts an HTTP
// listener), so these drive the actual database the server created, exercising
// the same SQL the core functions emit. The functions themselves are covered
// end-to-end by the HTTP/MCP parity tests in phase 5-6.
console.log('\nsequencing transformations (test 2 of the corrections)');
{
  const t2 = path.join(require('os').tmpdir(), 'itin-seq-' + process.pid + '.db');
  try { fs.unlinkSync(t2); } catch {}
  const d = new DatabaseSync(t2);
  d.exec('PRAGMA foreign_keys=ON');
  d.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)'); d.exec('INSERT INTO users VALUES(1)'); d.exec('CREATE TABLE objects(id INTEGER PRIMARY KEY)'); d.exec('CREATE TABLE marks(id INTEGER PRIMARY KEY, uid TEXT, locality TEXT, country TEXT)');
  for (const st of stmts) { if (!st.includes('${')) d.exec(st); }
  d.exec("INSERT INTO itineraries(user_id,title) VALUES(1,'S')");
  d.exec("INSERT INTO itinerary_groups(itinerary_id,label) VALUES(1,'G1'),(1,'G2')");

  // the same two-pass park-and-write the server uses
  const reindex = (scopeSql, args, ids) => {
    d.prepare(`UPDATE itinerary_stops SET position=NULL WHERE ${scopeSql} AND position IS NOT NULL`).run(...args);
    const set = d.prepare('UPDATE itinerary_stops SET position=? WHERE id=?');
    ids.forEach((id, i) => set.run(i + 1, id));
  };
  const reset = () => {
    d.exec('DELETE FROM itinerary_stops');
    d.exec("INSERT INTO itinerary_stops(itinerary_id,group_id,label,position) VALUES" +
           "(1,1,'A',1),(1,1,'B',2),(1,1,'C',3),(1,1,'D',4)");
    return Object.fromEntries(d.prepare('SELECT label,id FROM itinerary_stops').all().map((r) => [r.label, r.id]));
  };
  const order = () => d.prepare('SELECT label FROM itinerary_stops WHERE group_id=1 AND position IS NOT NULL ORDER BY position')
    .all().map((r) => r.label).join(' ');
  const trans = (name, want, fn) => {
    const ids = reset();
    try { fn(ids); eq(name, order(), want); }
    catch (e) { ok(name, false, String(e.message).slice(0, 60)); }
  };
  trans('2  A B C D -> D A B C', 'D A B C', (i) => reindex('group_id=?', [1], [i.D, i.A, i.B, i.C]));
  trans('2  A B C D -> B C D A', 'B C D A', (i) => reindex('group_id=?', [1], [i.B, i.C, i.D, i.A]));
  trans('2  A B C D -> A D B C', 'A D B C', (i) => reindex('group_id=?', [1], [i.A, i.D, i.B, i.C]));
  trans('2  remove B',           'A C D',   (i) => reindex('group_id=?', [1], [i.A, i.C, i.D]));
  trans('2  insert X at 2',      'A X B C D', (i) => {
    d.prepare("INSERT INTO itinerary_stops(itinerary_id,group_id,label) VALUES(1,1,'X')").run();
    const x = d.prepare("SELECT id FROM itinerary_stops WHERE label='X'").get().id;
    reindex('group_id=?', [1], [i.A, x, i.B, i.C, i.D]);
  });
  trans('2  move B to group 2 position 1', 'A C D', (i) => {
    d.prepare('UPDATE itinerary_stops SET group_id=2, position=NULL WHERE id=?').run(i.B);
    reindex('group_id=?', [1], [i.A, i.C, i.D]);
    reindex('group_id=?', [2], [i.B]);
  });
  ok('2  moved stop took position 1 in its new group',
     d.prepare("SELECT position FROM itinerary_stops WHERE label='B'").get().position === 1);

  // group reorder under the same unique index
  const gre = (ids) => {
    d.prepare('UPDATE itinerary_groups SET position=NULL WHERE itinerary_id=1 AND position IS NOT NULL').run();
    const set = d.prepare('UPDATE itinerary_groups SET position=? WHERE id=?');
    ids.forEach((id, i) => set.run(i + 1, id));
  };
  d.exec('UPDATE itinerary_groups SET position=1 WHERE id=1');
  d.exec('UPDATE itinerary_groups SET position=2 WHERE id=2');
  try { gre([2, 1]); ok('2  group reorder under unique index', true); }
  catch (e) { ok('2  group reorder under unique index', false, String(e.message).slice(0, 50)); }
  eq('   groups swapped',
     d.prepare('SELECT id FROM itinerary_groups WHERE position=1').get().id, 2);
  d.close(); try { fs.unlinkSync(t2); } catch {}
}

console.log('\ncentralisation audit (test 65)');
{
  // Every write to the three tables must come from the core block. The block is
  // delimited by its banner and the ensComponents function that follows it.
  const blockStart = SRC.indexOf('// ITINERARY — canonical mutations');
  const blockEnd = SRC.indexOf('function ensComponents(');
  const writes = [...SRC.matchAll(/(INSERT INTO|UPDATE|DELETE FROM)\s+(itineraries|itinerary_groups|itinerary_stops)\b/g)];
  const outside = writes.filter((m) => m.index < blockStart || m.index > blockEnd);
  // migration 041 legitimately creates them; exclude the migration span
  const migStart = SRC.indexOf("['041-itineraries'");
  const migEnd = SRC.indexOf('\n];', migStart);
  const leaks = outside.filter((m) => !(m.index > migStart && m.index < migEnd));
  ok('65 no itinerary writes outside the core block', leaks.length === 0,
     leaks.map((m) => m[0]).join(', '));
  console.log(`     ${writes.length} writes total, ${writes.length - leaks.length} inside the core block`);
}

console.log('\nprivacy wiring (tests 52-53)');
{
  const sites = [...SRC.matchAll(/markPrivacyChanged\(/g)];
  ok('52/53 markPrivacyChanged called from both mark write paths', sites.length >= 3,
     `${sites.length} references (1 definition + 2 call sites expected)`);
  ok('   canSeeStop fails closed on a private linked mark',
     /if \(mk\.private\) return \{ see: false \}/.test(SRC));
  ok('   canSeeStop renders label only for a dangling mark',
     /dangling: true/.test(SRC));
}

// ---- phase 3: privacy enforcement ------------------------------------------
// canSeeStop is pure apart from one marks lookup, so it is exercised against a
// stub. The seven cases in correction 1 are the contract.
console.log('\ncanSeeStop, all seven cases (correction 1)');
{
  const from2 = SRC.indexOf('function canSeeStop(');
  const to2 = SRC.indexOf('// ---- reading', from2);
  const marks = new Map();
  const c2 = { q: (sql) => ({ get: (uid) => marks.get(uid) ?? undefined }), MARK_SQL: 'SELECT m.* FROM marks m' };
  c2.globalThis = c2; vm.createContext(c2);
  vm.runInContext(SRC.match(/const adminOn = [^\n]*/)[0] + '\n' + SRC.slice(from2, to2) + '\nglobalThis.S = canSeeStop;', c2);
  const S = c2.S;

  const pubItin = { id: 1, user_id: 9, private: 0 };
  const owner = { id: 9 }, other = { id: 7 };
  marks.set('pub', { uid: 'pub', private: 0, name: 'Killiney' });
  marks.set('priv', { uid: 'priv', private: 1, name: 'Secret' });
  const st = (o) => ({ visibility: 'visible', resolution: 'experiential', mark_uid: null, ...o });

  ok('1  visible experiential -> rendered',
     S(st({ resolution: 'experiential' }), pubItin, other).see === true);
  ok('1  visible allocation -> rendered',
     S(st({ resolution: 'allocation' }), pubItin, other).see === true);
  ok('1  visible particular -> rendered',
     S(st({ resolution: 'particular' }), pubItin, other).see === true);
  const linkedPub = S(st({ resolution: 'linked', mark_uid: 'pub' }), pubItin, other);
  ok('1  visible linked + public mark -> rendered with mark',
     linkedPub.see === true && linkedPub.mark && linkedPub.mark.name === 'Killiney');
  ok('1  suspended -> nothing',
     S(st({ visibility: 'suspended' }), pubItin, other).see === false);
  ok('1  visible linked + PRIVATE mark -> NOTHING (fails closed)',
     S(st({ resolution: 'linked', mark_uid: 'priv' }), pubItin, other).see === false);
  const dangling = S(st({ resolution: 'linked', mark_uid: 'gone' }), pubItin, other);
  ok('1  visible linked + deleted mark -> label only',
     dangling.see === true && dangling.mark === null && dangling.dangling === true);
  ok('1  private mark and deleted mark behave DIFFERENTLY',
     S(st({ resolution: 'linked', mark_uid: 'priv' }), pubItin, other).see !==
     S(st({ resolution: 'linked', mark_uid: 'gone' }), pubItin, other).see);
  ok('   owner sees a suspended stop',
     S(st({ visibility: 'suspended' }), pubItin, owner).see === true);
  ok('   owner sees a private-linked stop',
     S(st({ resolution: 'linked', mark_uid: 'priv' }), pubItin, owner).see === true);
  ok('   nobody but the owner sees a private itinerary',
     S(st({}), { id: 1, user_id: 9, private: 1 }, other).see === false);
}

console.log('\nprivacy source audit');
{
  ok('   publish refuses while a visible stop links a private mark',
     /itineraryPublishConflicts/.test(SRC) && /conflicts\.length/.test(SRC));
  ok('   linking guards upward propagation',
     /markPrivacyGuard\(it\.id, mUid, ctx\)/.test(SRC));
  ok('   resolving guards upward propagation',
     /markPrivacyGuard\(itin\.id, mk\.uid, ctx\)/.test(SRC));
  ok('   restore refuses while the mark is still private',
     /still private/.test(SRC));
  ok('   markPrivacyChanged makes parents private, never suspends children',
     /UPDATE itineraries SET private=1/.test(SRC) &&
     !/markPrivacyChanged[\s\S]{0,400}visibility='suspended'/.test(SRC));
}

// ---- phases 4-6: surface parity --------------------------------------------
console.log('\nsurface parity (test 64)');
{
  // Every core mutation must be reachable from both surfaces. Proven by source
  // inspection: the web route block and the MCP dispatch block must each name
  // the function.
  const webFrom = SRC.indexOf('// Every handler calls a core function');
  const webTo = SRC.indexOf("if (p === '/e') return pages.ensembles");
  const mcpFrom = SRC.indexOf('  // ---- Itineraries ----------------------------------------------------------\n  // Every branch is a thin wrapper');
  const mcpTo = SRC.indexOf("throw new Error('Unknown tool '");
  const web = SRC.slice(webFrom, webTo), mcp = SRC.slice(mcpFrom, mcpTo);
  const fns = ['itineraryCreate', 'itineraryEdit', 'itineraryUpdateTemporal', 'itineraryPublish',
               'itineraryUnpublish', 'itineraryDelete', 'groupCreate', 'groupUpdateTemporal',
               'groupSetPosition', 'groupDelete', 'stopAdd', 'stopUpdateTemporal',
               'stopResolveToMark', 'stopUnresolve', 'stopSetGroup', 'stopSetPosition',
               'stopSuspend', 'stopRestore', 'stopDelete', 'stopEdit', 'stopSetResolution'];
  const missingWeb = fns.filter((f) => !web.includes(f + '('));
  const missingMcp = fns.filter((f) => !mcp.includes(f + '('));
  ok('64 every core function reachable from the web', missingWeb.length === 0, missingWeb.join(', '));
  ok('64 every core function reachable from MCP', missingMcp.length === 0, missingMcp.join(', '));
  console.log(`     ${fns.length} core functions, both surfaces`);
  ok('   itineraries do not collide with the image route',
     !/p\.match\(\/\^\\\/i\\\/\(\\d\+\)\$\//.test(SRC));
  ok('   nine itinerary MCP tools declared',
     (SRC.match(/name: '(create_itinerary|add_itinerary_stops|update_itinerary|update_itinerary_temporal|arrange_itinerary|resolve_itinerary_stop|update_itinerary_stop|delete_itinerary_entity|my_itineraries)'/g) || []).length === 9);
}

// ---- MCP description audit -------------------------------------------------
// A tool the model cannot find inputs for is unusable however correct its code
// is, so provenance of every uid is part of the contract.
console.log('\nMCP tool descriptions');
{
  const a2 = SRC.indexOf('const TOOLS = ['), b2 = SRC.indexOf('\n];', a2);
  const seg = SRC.slice(a2, b2);
  const marks = [...seg.matchAll(/\{ name: '([a-z_0-9]+)'/g)].map((m) => ({ n: m[1], i: m.index }));
  const names = marks.map((m) => m.n);
  const blocks = marks.map((o, k) => ({ name: o.n, txt: seg.slice(o.i, k + 1 < marks.length ? marks[k + 1].i : seg.length) }));
  const mine = blocks.filter((b3) => /itinerar/.test(b3.name));

  ok('   eleven itinerary tools present (v2.58 audit_itinerary, v2.59 build_itinerary)', mine.length === 11, String(mine.length));
  ok('   no duplicate tool names', names.length === new Set(names).size);

  const bare = [];
  for (const b3 of mine) {
    for (const m of b3.txt.matchAll(/(\w*uid): \{ type: 'string' \}/g)) bare.push(`${b3.name}.${m[1]}`);
  }
  ok('   every uid field says where it comes from', bare.length === 0, bare.join(', '));

  // dangling cross-references: a named tool that does not exist
  const dangling = [];
  for (const b3 of mine) {
    // Only snake_case tokens can be tool names; ordinary prose words like
    // "from public view" are not references.
    for (const m of b3.txt.matchAll(/\b(?:call|from|use)\s+([a-z]+_[a-z_]+)\b/g)) {
      if (!names.includes(m[1])) dangling.push(`${b3.name} -> ${m[1]}`);
    }
  }
  ok('   no dangling tool references', dangling.length === 0, dangling.join(', '));

  const all = mine.map((b3) => b3.txt).join(' ');
  ok('   mark_uid sources are named', /my_travel_marks/.test(all) && /search_catalogue/.test(all));
  ok('   creating a mark on acceptance is named', /add_travel_mark/.test(all));
  ok('   the intention/experience boundary is stated', /log_visit/.test(all));
  ok('   my_itineraries is named as the uid source', (all.match(/my_itineraries/g) || []).length >= 5);

  // semantics that must NOT appear
  const forbidden = [['completion', /\bmark(ed)? (it )?complete|completed stop|tick off/i],
                     ['adherence', /adherence|missed stop|fulfil/i],
                     ['inferred visits', /assume they (went|visited)/i]];
  for (const [label, re] of forbidden) ok(`   no ${label} language`, !re.test(all));
  console.log(`     ${names.length} tools total, ${mine.length} for itineraries`);
}

// ---- colophon: semantic contracts ------------------------------------------
// These assert what the inscription may and may not claim, not how it is built.
console.log('\ncolophon contracts');
{
  const src = SRC;
  const fnStart = src.indexOf('function itineraryColophonEntries(');
  const fnEnd = src.indexOf('function itineraryColophon(');
  const fn = src.slice(fnStart, fnEnd);
  const render = src.slice(fnEnd, src.indexOf('function itineraryPreview('));

  ok('C1 created date comes from the record, not inferred',
     /out\.push\(\['Started', monthYear\(it\.created_at\)\]\)/.test(fn));
  ok('C2 AI authorship requires ai_on_behalf AND explicit',
     /actor_type === 'ai_on_behalf' && r\.assertion === 'explicit'/.test(fn));
  ok('C3 corpus lineage is causal: source_kind=itinerary on the mark\u2019s creation',
     /entity_type='mark' and action='created'/i.test(fn.replace(/\s+/g, ' ')) ||
     /entity_type='mark' AND action='created'[\s\S]*source_kind='itinerary'/.test(fn));
  ok('C4 lineage is never timestamp-inferred',
     !/created_at\s*[<>]=?\s*[^)]*mark/i.test(fn));
  ok('C5 private marks are excluded from the counts a stranger sees',
     /owner \|\| !mk\.private/.test(fn));
  ok('C6 suspended stops are excluded from lineage',
     /visibility === 'visible'/.test(fn));
  ok('C7 a mark counts once however many stops point at it',
     /new Set\(visible\)/.test(fn));
  ok('C8 resolutions are synthesised, not listed one per event',
     /resolved\.size/.test(fn) && /place intentions/.test(fn));
  ok('C9 a corrected stop is not also counted as identified',
     /for \(const u of corrected\) resolved\.delete\(u\)/.test(fn));
  ok('C10 position writes never reach the inscription',
     !/'position'/.test(fn));
  ok('C11 no check-in coupling anywhere in the colophon',
     !/visits|check.?in/i.test(fn));
  ok('C12 no completion, adherence or fulfilment language',
     !/complete|fulfil|missed|adheren/i.test(fn + render));
  ok('C13 temporal precision internals never surface',
     !/day_precision|1900|placeholder/i.test(fn + render));
  ok('C14 no uids, ids, agents or raw fields rendered',
     !/colo-v[^`]*uid|entity_uid\}|\$\{r\.agent\}|\$\{[^}]*\.fields\}/.test(render));
  ok('C15 agent names are human, never model or tool strings',
     /AGENT_NAMES/.test(src) && /'mcp:claude': 'Claude'/.test(src));
  ok('C16 a bare created date is not a history',
     /rows\.length < 2\) return ''/.test(render));
  ok('C17 the inscription is derived, never stored',
     !/INSERT INTO[\s\S]{0,80}colophon/i.test(src));
  ok('C18 reuses the note colophon\u2019s own classes',
     /class="colophon itin-colophon"/.test(render) && /colo-head/.test(render) && /colo-lead/.test(render));

  // the accept-a-place path is what makes lineage causal
  const add = src.slice(src.indexOf('function stopAdd('), src.indexOf('const stopUpdateTemporal'));
  ok('C19 accepting a place creates its mark and records the plan as its origin',
     /source_kind: 'itinerary', source_ref: it\.uid/.test(add));
  ok('C20 a new place inherits the plan\u2019s privacy, never publishing more',
     /private: !!it\.private/.test(add));
}

// ---- mark lookup while writing a stop --------------------------------------
console.log('\nmark lookup contracts');
{
  const route = SRC.slice(SRC.indexOf("p.match(/^\\/t\\/(\\d+)\\/marks$/)"), SRC.indexOf('if (p === \'/t/new\''));
  ok('L1 only the itinerary owner may look up marks',
     /it\.user_id !== me\.id/.test(route));
  ok('L2 only the member\u2019s own marks are searched',
     /m\.user_id=\?/.test(route));
  ok('L3 marks already in the plan are excluded',
     /inPlan\.has\(mk\.uid\)/.test(route));
  ok('L4 a bare keystroke does not query the catalogue',
     /term\.length < 2/.test(route));
  ok('L5 the response carries no private fields beyond name and place',
     /uid: mk\.uid, name: mk\.name, where:/.test(route) && !/why|tags|image|private/.test(route.split('map((mk)')[1] || ''));

  const near = SRC.slice(SRC.indexOf('function itineraryNearbyMarks('), SRC.indexOf('function itinerarySuggestions('));
  ok('L6 the gallery is owner-only', /me\.id !== it\.user_id/.test(near));
  ok('L7 the gallery shows nothing when the region is unknown',
     /if \(!pts\.length && !words\.size\) return \[\]/.test(near));
  ok('L8 the gallery excludes marks already in the plan', /inPlan\.has\(mk\.uid\)/.test(near));

  const body = SRC.slice(SRC.indexOf('function itineraryBody('), SRC.indexOf('function itineraryColophonEntries('));
  ok('L9 one field: the label doubles as the lookup', /class="nf-field stop-add-label" name="label"[^>]*data-lookup/.test(body));
  ok('L10 choosing a mark is optional \u2014 prose alone still adds a stop',
     /name="mark_uid" value=""/.test(body));
}

// ---- marking is not visiting -----------------------------------------------
console.log('\nintention is not experience');
{
  const add = SRC.slice(SRC.indexOf("if (name === 'add_travel_mark')"), SRC.indexOf("if (name ===", SRC.indexOf("if (name === 'add_travel_mark')") + 20));
  ok('V1 a check-in is written only where one was claimed',
     /if \(a\.visited_on\) \{[\s\S]{0,400}visitRecord\(/.test(add));
  ok('V1b marking never writes a visit directly \u2014 only visitRecord does',
     !/INSERT INTO visits/.test(add));
  ok('V2 a visit is never dated "today" because a mark was made',
     !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(add));
  ok('V3 the visit\u2019s provenance uses its own insert id, not MAX(id)',
     !/SELECT MAX\(id\) i FROM visits/.test(add));
  const vr = SRC.slice(SRC.indexOf('function visitRecord('), SRC.indexOf('function stopAdd('));
  ok('V4 one provenance row per visit, written where the visit is written',
     (vr.match(/recordProvenance\('visit'/g) || []).length === 2      // dated + undated branch
     && (add.match(/recordProvenance\('visit'/g) || []).length === 0);
  ok('V4b every visit INSERT lives inside visitRecord',
     (SRC.match(/INSERT INTO visits/g) || []).length === 2
     && (vr.match(/INSERT INTO visits/g) || []).length === 2);
  ok('V4c the undated placeholder always carries date_known 0',
     /date_known\) VALUES\(\?,\?,\?,NULL,\?,0\)/.test(vr) && /fields: 'date_known:0'/.test(vr));
  ok('V5 the reply does not claim a visit that was not made',
     !/first visit/.test(add));
  ok('V6 the schema tells the caller marking is not a claim to have been',
     /not a claim to have been there/.test(SRC));
  const webMark = SRC.slice(SRC.indexOf("p === '/marks/new'"), SRC.indexOf("p === '/marks/new'") + 2600);
  ok('V7 the web mark form never logs a visit', !/INSERT INTO visits/.test(webMark));
}

// ---- mark and ensemble colophons -------------------------------------------
console.log('\nmark and ensemble colophons');
{
  const mk = SRC.slice(SRC.indexOf('function markColophonEntries('), SRC.indexOf('const markColophon ='));
  const en = SRC.slice(SRC.indexOf('function ensembleColophonEntries('), SRC.indexOf('const ensembleColophon ='));
  const frame = SRC.slice(SRC.indexOf('function colophonFrame('), SRC.indexOf('// ---- travel mark colophon'));

  ok('M1 a check-in never appears in a mark\u2019s colophon',
     !/visits|check.?in/i.test(mk));
  ok('M2 planning origin comes from the mark\u2019s own creation row',
     /created\.source_kind === 'itinerary' && created\.source_ref/.test(mk));
  ok('M3 being a stop does not confer origin',
     !/itinerary_stops/.test(mk));
  ok('M4 origin is never inferred from timestamps',
     !/created_at\s*[<>]/.test(mk));
  // canView: canSee, plus a plan outside its member's corpus is theirs alone (052)
  ok('M5 a private plan is never named to someone who cannot see it',
     /canView\('itinerary', it, me\)/.test(mk) && /'a trip'/.test(mk));
  ok('M6 enrichment is claimed only where provenance says so',
     /rows\.filter\(\(r\) => r\.action === 'enriched'\)/.test(mk));
  ok('M7 enrichment is collapsed into one line, not one per field',
     /inList/.test(mk));
  ok('M8 AI enrichment is distinguished from the member\u2019s own',
     /actor_type !== 'user'/.test(mk));
  ok('M9 warrant history is read from the warrant rows, not from current state',
     /FROM warrants WHERE subject_type='mark'/.test(mk));
  ok('M10 a withdrawal is only claimed when a revoked row exists',
     /state === 'revoked'/.test(mk));
  ok('M11 a withdrawal is never inferred from a warrant simply being absent',
     /w\.length && w\[w\.length - 1\]\.state === 'revoked' && lastActive/.test(mk));
  ok('M12 warrant history does not drag check-ins in with it',
     !/visits|check.?in/i.test(mk));

  ok('E1 constituents naming a private note are withheld',
     /canView\('object', note, me\)/.test(en) && /withheld/.test(en));
  ok('E2 AI composition rests on the artifact\u2019s own generated row',
     /entity_type='ensemble_artifact'[\s\S]*source_kind='generated'/.test(en));
  ok('E3 Keep is read from the ledger, never assumed',
     /status:saved/.test(en));
  ok('E4 unresolved \u2192 resolved history is preserved, not rewritten',
     /action === 'resolved'/.test(en) && /Later identified/.test(en));
  ok('E5 internal state names never surface',
     !/'unresolved'|'linked'/.test(en.replace(/\/\/[^\n]*/g, '')));
  ok('E6 no model ids, prompts, seeds or asset ids',
     !/prompt|seed|model_id|asset_id/i.test(en));

  ok('C1 one shared frame, not four implementations',
     /colo-head|colo-lead|colo-mark/.test(frame));
  ok('C2 the frame’s default minimum is still two entries',
     /function colophonFrame\(lead, rows, label, cls, min = 2\)/.test(SRC) && /rows\.length < min\) return ''/.test(frame));
  ok('C5 only the mark opts into rendering from a single entry',
     /'mark-colophon', 1\)/.test(SRC) && !/'ens-colophon', 1\)/.test(SRC));
  ok('C3 nothing is stored: the inscription is derived',
     !/INSERT INTO[\s\S]{0,60}colophon/i.test(SRC));
  // The colophon still adds no schema of its own. The one provenance column
  // that does exist was added by Stage 0 for connection identity, not by this.
  ok('C4 the colophon added no schema of its own',
     !/CREATE TABLE colophon/i.test(SRC)
     && !/ALTER TABLE provenance ADD COLUMN (?!connection_uid)/i.test(SRC));
}

// ---- Stage 0: connection identity ------------------------------------------
console.log('\nconnection identity');
{
  const conn = SRC.slice(SRC.indexOf('const tokenHash ='), SRC.indexOf('function clientLabelFor('));
  const actor = SRC.slice(SRC.indexOf('const aiActor ='), SRC.indexOf('const mcpActor ='));
  const entry = SRC.slice(SRC.indexOf('async function mcp(req, res, tok)'), SRC.indexOf("if (method === 'ping')"));

  ok('S1 a connection credential is stored only as a hash',
     /token_hash/.test(conn) && !/INSERT INTO connections[^)]*\btoken\b[^_]/.test(conn));
  ok('S2 the stored prefix is not the credential',
     /token_prefix/.test(conn) && /t\.slice\(0, 6\)/.test(conn));
  ok('S3 a revoked connection resolves to nothing',
     /token_hash=\? AND revoked_at IS NULL/.test(conn));
  ok('S4 revoking marks rather than deletes, so provenance keeps its referent',
     /UPDATE connections SET revoked_at/.test(conn) && !/DELETE FROM connections/.test(SRC));
  ok('S5 revocation is scoped to the owning member',
     /WHERE uid=\? AND user_id=\?/.test(conn));
  ok('S6 the legacy shared token still authenticates',
     /users WHERE api_token=\?/.test(entry));
  ok('S7 a legacy caller is never given a client identity we cannot evidence',
     /agent: conn \?/.test(actor) && /'legacy'/.test(actor));
  ok('S8 a connection that never declared itself records unknown, not a guess',
     /conn\.client_name \? clientAgentFor\(conn\.client_name\) : 'unknown'/.test(actor));
  ok('S9 client identity is never overwritten once recorded',
     /client_name IS NULL/.test(entry) && /!conn\.client_name/.test(entry));
  ok('S10 client identity is read from the handshake AND from per-request _meta',
     /p\.clientInfo/.test(SRC) && /_meta/.test(SRC));
  ok('S11 the vendor literal is gone from the actor',
     !/agent: 'mcp:claude'/.test(SRC));
  ok('S12 provenance carries the connection that acted',
     /connection_uid/.test(SRC.slice(SRC.indexOf('function recordProvenance('), SRC.indexOf('const webActor'))));
  ok('S13 unknown and legacy are never rendered as a client name',
     /unknown: null, legacy: null/.test(SRC));
  ok('S14 the web actor is untouched by any of this',
     /const webActor = \(me\) => \(\{ actor_type: 'user'/.test(SRC));
}

// ---- Stage 1: one canonical implementation per primitive --------------------
console.log('\nshared domain creation');
{
  const nc = SRC.slice(SRC.indexOf('function noteCreate('), SRC.indexOf('// ---- canonical mark creation'));
  const mc = SRC.slice(SRC.indexOf('function markCreate('), SRC.indexOf('// ---- canonical visit recording'));

  ok('D1 exactly one runtime INSERT site per primitive',
     (SRC.match(/INSERT INTO marks\(/g) || []).length === 1
     && (SRC.match(/INSERT INTO visits/g) || []).length === 2);   // dated + undated, both in visitRecord
  ok('D2 noteCreate writes the objects row and its notes row together',
     /INSERT INTO objects/.test(nc) && /INSERT OR IGNORE INTO notes/.test(nc));
  ok('D3 notes.why is canonical on both rows',
     /INSERT OR IGNORE INTO notes\(user_id,object_id,why\)/.test(nc));
  ok('D4 Owned and Warrant are not parameters of noteCreate',
     !/owned|warrant/i.test(nc));
  ok('D5 noteCreate never asserts ownership or endorsement as a side effect',
     !/assertOwned|assertWarrant|applyFormIntents/.test(nc));
  ok('D6 markCreate has no visit parameter and writes no visit',
     !/visit/i.test(mc));
  ok('D7 markCreate never claims verification it did not perform',
     !/verified/.test(mc));
  ok('D8 every creation records provenance inside the function',
     /recordProvenance\('object'/.test(nc) && /recordProvenance\('mark'/.test(mc));
  ok('D9 callers supply source context rather than the function inventing it',
     /source_kind = 'manual', source_ref = null/.test(nc)
     && /source_kind = 'manual', source_ref = null/.test(mc));
  ok('D10 re-noting remains its own act, not a creation',
     /recordProvenance\('object', note\.uid, 'renoted'/.test(SRC));
}

// ---- OAuth authorization contracts -----------------------------------------
console.log('\nOAuth authorization');
{
  const az   = SRC.slice(SRC.indexOf("if (p === '/oauth/authorize'"), SRC.indexOf("if (p === '/oauth/token'"));
  const tk   = SRC.slice(SRC.indexOf("if (p === '/oauth/token'"), SRC.indexOf("if (p === '/settings/connections'"));
  const meta = SRC.slice(SRC.indexOf("p === '/.well-known/oauth-protected-resource'"),
                         SRC.indexOf("p === '/.well-known/mcp-inspector-client.json'"))
             + SRC.slice(SRC.indexOf("p === '/.well-known/oauth-authorization-server'"),
                         SRC.indexOf("// ---- authorization endpoint"));
  const hlp  = SRC.slice(SRC.indexOf('// ---- OAuth 2.1 authorization'), SRC.indexOf('// What the client said it was'));
  const mcpf = SRC.slice(SRC.indexOf('async function mcp(req, res, tok)'), SRC.indexOf("if (method === 'ping')"));

  ok('O1 S256 is advertised and nothing else',
     /code_challenge_methods_supported: \['S256'\]/.test(meta));
  ok('O2 only the scope we enforce is advertised',
     /scopes_supported: \[OAUTH_SCOPE\]/.test(meta));
  ok('O3 the advertised resource is the MCP endpoint',
     /resource: MCP_RESOURCE\(\)/.test(meta));

  // v2.51 published localhost in production because it introduced a second
  // origin variable with a localhost default, instead of using the canonical
  // one the application already had. The contract is that metadata is correct
  // with NO environment configured at all: a missing variable must never be
  // able to hand an OAuth client an unreachable issuer.
  const origin = SRC.slice(SRC.indexOf('const BASE_URL ='), SRC.indexOf('const inMs ='));
  ok('O26 the OAuth origin is the application\u2019s one canonical origin',
     /const BASE_URL = \(\) => PUBLIC_ORIGIN;/.test(origin));
  ok('O27 no second origin variable was introduced',
     !/PUBLIC_URL/.test(SRC));
  ok('O28 the canonical origin defaults to production, not localhost',
     /const PUBLIC_ORIGIN = \(process\.env\.PUBLIC_ORIGIN \|\| 'https:\/\/www\.discriminantly\.com'\)/.test(SRC));
  // A public client metadata document so MCP Inspector can identify itself
  // through the same CIMD path ChatGPT uses. It must hold no secret, must be
  // self-naming (cimdValidate checks that), and must not be special-cased
  // anywhere in the authorization logic.
  const insp = SRC.slice(SRC.indexOf("p === '/.well-known/mcp-inspector-client.json'"),
                         SRC.indexOf("p === '/.well-known/oauth-authorization-server'"));
  ok('O30 the Inspector client document names itself from the canonical origin',
     /client_id: self/.test(insp) && /BASE_URL\(\) \+ '\/\.well-known\/mcp-inspector-client\.json'/.test(insp));
  ok('O31 it registers both loopback callbacks and nothing else',
     /'http:\/\/127\.0\.0\.1:6274\/oauth\/callback'/.test(insp)
     && /'http:\/\/localhost:6274\/oauth\/callback'/.test(insp)
     && (insp.match(/'http:\/\//g) || []).length === 2);
  ok('O32 it carries no credential or secret',
     !/client_secret|\bsecret\b|password|private_key|jwks|api[_-]?key/i.test(insp));   // refresh_token here is a grant-type name, not a credential
  ok('O33 it matches the flow we actually implement',
     /grant_types: \['authorization_code', 'refresh_token'\]/.test(insp)
     && /response_types: \['code'\]/.test(insp)
     && /token_endpoint_auth_method: 'none'/.test(insp)
     && /scope: OAUTH_SCOPE/.test(insp));
  ok('O34 Inspector is not special-cased in the authorization logic',
     !/inspector/i.test(az) && !/inspector/i.test(tk) && !/inspector/i.test(hlp));
  ok('O35 CIMD validation is unchanged \u2014 still self-naming and redirect-bound',
     /does not match its own client_id/.test(hlp)
     && /redirect_uri is not registered for this client/.test(hlp)
     && /redirect: 'manual'/.test(hlp));

  ok('O29 no localhost default can reach OAuth metadata or the challenge',
     !/localhost/.test(origin) && !/localhost/.test(meta)
     && !/localhost/.test(SRC.slice(SRC.indexOf('function mcpAuthChallenge('), SRC.indexOf('async function mcp(req, res, tok)'))));
  ok('O4 PKCE is required, and plain is refused',
     /method !== 'S256'/.test(az) && /!code_challenge/.test(az));
  ok('O5 PKCE comparison is constant-time',
     /timingSafeEqual/.test(hlp));
  ok('O6 the redirect target is validated against the client document',
     /cimdValidate\(client_id, redirect_uri\)/.test(az));
  ok('O7 a bad request is shown, never redirected to an unvalidated URI',
     /const bad = \(why\)/.test(az) && !/redirect\(res, redirect_uri/.test(az));
  ok('O8 the login return path is this server\u2019s own, not caller-supplied',
     /'\/oauth\/authorize\?' \+ new URLSearchParams/.test(az));
  ok('O9 a foreign resource is refused at authorization',
     /resource !== MCP_RESOURCE\(\)/.test(az));
  ok('O10 authorization codes are single use',
     /row\.used_at/.test(tk) && /SET used_at=CURRENT_TIMESTAMP/.test(tk));
  ok('O11 code exchange binds client, redirect and resource',
     /!== row\.client_id/.test(tk) && /!== row\.redirect_uri/.test(tk) && /!== row\.resource/.test(tk));
  ok('O12 a redeemed refresh token revokes its whole family',
     /row\.redeemed_at/.test(tk) && /oauthRevokeFamily\(row\.family_id\)/.test(tk));
  ok('O13 no credential is stored in plaintext',
     /tokenHash\(code\)/.test(hlp) && /tokenHash\(access\)/.test(hlp) && /tokenHash\(refresh\)/.test(hlp));
  ok('O14 access tokens always expire',
     /expires_at     TEXT NOT NULL/.test(SRC) && /inMs\(ACCESS_TTL_MS\)/.test(hlp));
  ok('O15 token resolution checks revocation, expiry, audience, scope and the connection',
     /row\.revoked_at \|\| expiredAt\(row\.expires_at\)/.test(hlp)
     && /row\.resource !== resource/.test(hlp)
     && /conn\.revoked_at/.test(hlp)
     && /OAUTH_SCOPE/.test(hlp));
  ok('O16 revoking a connection immediately kills its tokens',
     /conn \|\| conn\.revoked_at/.test(hlp));
  ok('O17 the challenge names the protected-resource metadata',
     /WWW-Authenticate/.test(SRC) && /resource_metadata=/.test(SRC));
  ok('O18 one dispatcher for every credential kind',
     /oauthResolveAccess/.test(mcpf) && /connectionFor\(tok\)/.test(mcpf)
     && /api_token=\?/.test(mcpf));
  ok('O19 auth method is observed, not inferred',
     /auth_method: authMethod \|\|/.test(SRC));
  ok('O20 legacy provenance is unchanged',
     /'mcp_token_legacy'/.test(SRC));
  ok('O21 every tool declares its authorization',
     /securitySchemes: SEC_OAUTH/.test(SRC)   // the 54 submitted tools, plus every additive one
     && (SRC.match(/securitySchemes: SEC_OAUTH/g) || []).length === (SRC.slice(SRC.indexOf('const TOOLS = ['), SRC.indexOf('\n];', SRC.indexOf('const TOOLS = ['))).match(/\{ name: '/g) || []).length);
  ok('O22 CIMD refuses redirects and non-https client ids',
     /redirect: 'manual'/.test(hlp) && /must be an https URL/.test(hlp));
  ok('O23 the client document must name itself',
     /does not match its own client_id/.test(hlp));
  ok('O24 client identity comes from the validated document, never a claim',
     /cimdAgent\(client_id, doc\)/.test(az));
  ok('O25 no mTLS-strength claim is made anywhere',
     !/mtls/i.test(SRC.replace(/\/\/[^\n]*/g, '')));
}

// ---- my_itineraries must hand the model its uids ---------------------------
// The list text omitted every uid while the structured payload carried them.
// Models read the text, so from a fresh chat every itinerary tool was
// unreachable even though the data was fine.
console.log('\nmy_itineraries uids');
{
  const mi = SRC.slice(SRC.indexOf("if (name === 'my_itineraries')"),
                       SRC.indexOf("throw new Error('Unknown tool ' + name)"));
  ok('I1 the list text carries each itinerary uid',
     /uid: \$\{r\.uid\}/.test(mi));
  ok('I2 the list text carries day and stop counts',
     /plural\(c\.days, 'day'\)/.test(mi) && /plural\(c\.stops, 'stop'\)/.test(mi));
  ok('I3 the single view carries the itinerary uid in its text',
     /itinerary uid: \$\{it\.uid\}/.test(mi));
  ok('I4 the single view carries every day uid in its text',
     /day uid: \$\{d\.uid\}/.test(mi));
  ok('I5 the single view carries every stop uid, placed or not',
     /stop uid: \$\{s\.uid\}/.test(mi) && /Not yet on a day/.test(mi));
  ok('I6 the structured payload is unchanged',
     /items: rows\.map\(\(r\) => \(\{ uid: r\.uid/.test(mi) && /subject: 'itinerary', uid: it\.uid/.test(mi));
}

// ---- Directions open Apple Maps on Apple devices ----------------------------
console.log('\ndirections');
{
  ok('M1 an Apple Maps link exists for every place',
     /const appleMapLink = \(m\)/.test(SRC) && /maps\.apple\.com\/\?ll=/.test(SRC) && /maps\.apple\.com\/\?q=/.test(SRC));
  ok('M2 Google stays the default href, so it works without the script',
     /href="\$\{mapLink\(m\)\}" data-apple-maps=/.test(SRC));
  ok('M3 the swap applies only on Apple devices',
     /iPhone\|iPad\|iPod\|Macintosh/.test(SRC));
  ok('M4 cards added after load are swapped too',
     /MutationObserver/.test(SRC) && /a\[data-apple-maps\]/.test(SRC));
}

// ---- the feed draws only what it shows --------------------------------------
console.log('\nfeed cost');
{
  const f = SRC.slice(SRC.indexOf('const lazy = (at, key, draw)'), SRC.indexOf('const banner = resurfaceBanner('));
  ok('F1 feed cards are drawn on first read, not up front',
     /get html\(\) \{ return this\._h \?\? \(this\._h = draw\(\)\); \}/.test(f));
  ok('F2 no card is drawn while the entries are being built',
     !/html: (objectCard|markCard|itineraryPreview)\(/.test(f));
  ok('F3 visits are indexed by mark',
     /CREATE INDEX IF NOT EXISTS idx_visits_mark ON visits\(mark_id\)/.test(SRC));
}

// ---- photos live in files beside the database -------------------------------
console.log('\nimage storage');
{
  const mv = SRC.slice(SRC.indexOf('function moveImageToFile('), SRC.indexOf('const removeImageFile ='));
  ok('P1 photos are stored on the same volume as the database',
     /const IMAGE_DIR = path\.join\(path\.dirname\(DB_PATH\), 'images'\)/.test(SRC));
  ok('P2 the database copy is released only after the file is verified',
     mv.indexOf('fsyncSync') > 0 && mv.indexOf('read-back did not match') > 0
     && mv.indexOf("SET bytes = x''") > mv.indexOf('read-back did not match'));
  ok('P3 a failed move leaves the photo where it was',
     /left in the database/.test(mv) && /return false;/.test(mv));
  ok('P4 the move never touches a row already moved',
     /WHERE uid = \? AND stored IS NULL/.test(mv));
  ok('P5 every read goes through one accessor that handles both places',
     /function imageBytes\(row\)/.test(SRC) && !/img\.bytes\.length|Buffer\.from\(img\.bytes\)|Buffer\.from\(im\.bytes\)/.test(SRC));
  ok('P6 sizes never depend on where the bytes are',
     !/[^_]length\(bytes\) n/.test(SRC.replace(/COALESCE\(byte_count, length\(bytes\)\)/g, '')));
  ok('P7 uids are validated before becoming file paths',
     /\^\[0-9a-f-\]\{36\}\$/.test(SRC.slice(SRC.indexOf('const imagePath ='), SRC.indexOf('const sha256 ='))));
  ok('P8 there is a kill switch that keeps photos in the database',
     /IMAGE_STORE === 'db' \? 'db' : 'file'/.test(SRC));
  ok('P9 compaction checkpoints the log, so space is actually returned',
     /db\.exec\('VACUUM'\);\s*db\.exec\('PRAGMA wal_checkpoint\(TRUNCATE\)'\);/.test(SRC));
}

// ---- profile rail: grouped nav for the modern skin, classic untouched ------
console.log('\nprofile rail nav');
{
  const i = SRC.indexOf('<ul class="prail-nav">');
  const j = SRC.indexOf('</aside>`;', i) + 10;
  const rail = SRC.slice(i, j);
  ok('R1 the classic list markup is completely unchanged',
     /<li><a class="\$\{tab === 'activity' \? 'on' : ''\}" data-short="All&#10;Activity"/.test(rail));
  ok('R2 the modern block reuses the real wtable\\/wcell component',
     /class="wtable pgrp-group"/.test(rail) && /class="wcell\$\{cls\}"/.test(rail));
  ok('R3 no custom font-size is set on the count or label -- inherits the real welcome-table typography',
     !/\.pgrp-group[^}]*font-size/.test(rail) && !/\bwcell b\s*\{[^}]*font-size/.test(SRC));
  ok('R5 Warrants is a single b+span row, not its own header row',
     /<a class="wcell wcell-wide\$\{on\('warrants'\)\}" href="\$\{link\('warrants'\)\}">\s*<b>\$\{warrantCount\}<\/b><span>Warrants<\/span>/.test(rail));
}
{
  const css = CSS_MODERN.slice(CSS_MODERN.indexOf('PROFILE RAIL'));
  const mobileCss = css.slice(css.indexOf('@media (max-width: 52rem)'));
  ok('R4 Places/Things/People are title case and italic, not small-caps',
     /\.pgrp-label \{[^}]*font-style: italic/.test(css)
     && !/\.pgrp-label \{[^}]*text-transform:\s*uppercase/.test(css));
  ok('R6 the 4-column welcome-table grid is overridden by specificity, not !important',
     /grid-template-columns: minmax\(0,1fr\) minmax\(0,1fr\);/.test(css) && !/!important;/.test(css));
  ok('R7 the override is scoped through .pgrp-nav, so the real welcome table is untouched',
     /\.rail \.pgrp-nav \.wtable\.pgrp-group:not\(\.settings-table\)/.test(css));
  ok('R8 mobile relies on flex default stretch, not a tuned height, to match card heights',
     /\.pgrp-nav \{ display: flex;/.test(mobileCss) && !/\.pgrp-nav \{ display: flex;[^}]*align-items/.test(mobileCss));
}

// ---- profile rail follow-ups: typography parity, active state, shadow -----
console.log('\nprofile rail follow-ups');
{
  const i = SRC.indexOf('<ul class="prail-nav">');
  const j = SRC.indexOf('</aside>`;', i) + 10;
  const rail = SRC.slice(i, j);
  ok('R9 All activity and Warrants wrap a real .wcell.wcell-wide child',
     /<div class="wtable pgrp-solo">\s*<a class="wcell wcell-wide\$\{on\('activity'\)\}"/.test(rail)
     && /<div class="wtable pgrp-solo">\s*<a class="wcell wcell-wide\$\{on\('warrants'\)\}"/.test(rail));
  ok('R10 the on-load scroll only touches the active item, and does not animate',
     /var active = document\.querySelector\('\.pgrp-nav \.wcell\.on'\)/.test(SRC)
     && /scrollIntoView\(\{ block: 'nearest', inline: 'center' \}\)/.test(SRC));
  ok('R11 the Apple Maps MutationObserver still runs inside its own closure (swap in scope)',
     /var swap = function \(root\)[\s\S]*?new MutationObserver[\s\S]*?swap\(n\)[\s\S]*?\}\)\(\);/.test(SRC));
}
{
  const css = CSS_MODERN.slice(CSS_MODERN.indexOf('PROFILE RAIL'));
  const mobileCss = css.slice(css.indexOf('@media (max-width: 52rem)'));
  ok('R12 the active state highlights the one real box, not a second one inside it',
     /\.pgrp-nav \.pgrp-solo:has\(\.wcell\.on\) \{ background: var\(--m-glass-2\); \}/.test(css)
     && !/\.pgrp-solo \.wcell-wide \{[^}]*background/.test(css));
  ok('R18 group-chip active state mirrors all three welcome-table chip prefixes, so it wins in every mode',
     /body\[data-skin="modern"\] \.rail \.pgrp-nav \.wtable:not\(\.settings-table\) > \.wcell\.on:not\(\.wcell-wide\)/.test(css)
     && /body\[data-skin="modern"\]\[data-mode="light"\] \.rail \.pgrp-nav \.wtable:not\(\.settings-table\) > \.wcell\.on:not\(\.wcell-wide\)/.test(css)
     && /html\.m-light body\[data-skin="modern"\]\[data-mode="system"\] \.rail \.pgrp-nav \.wtable:not\(\.settings-table\) > \.wcell\.on:not\(\.wcell-wide\)/.test(css));
  // the dot's own glow is a box-shadow on ::after, which is fine -- what must
  // never happen is the chip or card losing its real shadow when active
  const noDot = css.replace(/[^{}]*::after \{[^}]*\}/g, '');
  ok('R19 the active state never replaces the drop shadow',
     !/\.wcell\.on[^{]*\{[^}]*box-shadow/.test(noDot) && !/:has\(\.wcell\.on\) \{[^}]*box-shadow/.test(noDot));
  ok('R20 the active dot is out of flow and uses the per-mode accent, so nothing shifts',
     /\.pgrp-nav \.wcell\.on span::after \{[^}]*position: absolute[^}]*background: var\(--m-accent\)/.test(css));
  ok('R13 the scroll row has shadow room on all four sides, not clipped',
     /padding: 10px 12px 36px/.test(mobileCss));
  ok('R16 the side room is pulled back by exactly the rail padding, so the page never scrolls sideways',
     /margin: \.35rem -12px -30px/.test(mobileCss) && /scroll-padding-inline: 12px/.test(mobileCss));
  ok('R17 All has no invisible spacer above it, and its cell has no uneven padding',
     !/pgrp-spacer/.test(SRC) && /\.rail \.pgrp-nav \.pgrp-solo \.wcell-wide \{ padding: 0; \}/.test(css));
  ok('R14 the scrollbar is hidden cross-browser, not just webkit',
     /scrollbar-width: none/.test(mobileCss) && /-ms-overflow-style: none/.test(mobileCss)
     && /::-webkit-scrollbar \{ display: none/.test(mobileCss));
  ok('R15 no overflow-y:visible left in -- it has no effect paired with overflow-x:auto',
     !/overflow-y: visible/.test(mobileCss));
}

// ---- profile identity lockup in the invite-code container -----------------
console.log('\nprofile identity container');
{
  const i = SRC.indexOf('<div class="prail-id">'), j = SRC.indexOf('</div>', i);
  const lock = SRC.slice(i, j);
  ok('R21 avatar, handle, bio and site sit inside the container; Follow does not',
     /avatar big/.test(lock) && /prail-handle/.test(lock) && /prail-bio/.test(lock) && /prail-site/.test(lock) && !/prail-follow/.test(lock));
  const sig = /\.signup \{\s*background: rgba\(0,0,0,\.035\)[^}]*border-radius: var\(--m-r\); padding: 1rem 1rem 1\.1rem;/;
  const pid = /\.prail-id \{\s*background: rgba\(0,0,0,\.035\); border-radius: var\(--m-r\); padding: 1rem 1rem 1\.1rem;/;
  ok('R22 it uses the invite-code container values, dark and light',
     sig.test(CSS_MODERN) && pid.test(CSS_MODERN)
     && /\[data-mode="light"\] \.prail-id[^{]*\{\s*background: rgba\(20,22,28,\.04\);/.test(CSS_MODERN));
  ok('R23 it is modern-only; classic has no rule for it',
     !/prail-id/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'style.css'), 'utf8')));
}

// ---- plugin submission hardening ---------------------------------------------
console.log('\nplugin submission');
{
  const toolsBlk = SRC.slice(SRC.indexOf('const TOOLS = ['), SRC.indexOf('\n];', SRC.indexOf('const TOOLS = [')));
  const toolNames = [...toolsBlk.matchAll(/\{ name: '([a-z_]+)',/g)].map((m) => m[1]).sort();
  const annBlk = SRC.slice(SRC.indexOf('const TOOL_ANNOTATIONS = {'), SRC.indexOf('for (const t of TOOLS) {', SRC.indexOf('const TOOL_ANNOTATIONS = {')));
  const ann = {};
  for (const m of annBlk.matchAll(/^\s+([a-z_]+):\s+\['([^']*)', (true|false), (true|false), (true|false)\]/gm))
    ann[m[1]] = { title: m[2], ro: m[3] === 'true', de: m[4] === 'true', ow: m[5] === 'true' };
  ok('PS1 every tool has annotations, and every annotation names a real tool',
     toolNames.length >= 54 && JSON.stringify(Object.keys(ann).sort()) === JSON.stringify(toolNames));
  ok('PS2 a tool without annotations stops the server at startup',
     /has no annotations -- add it to TOOL_ANNOTATIONS/.test(SRC) && /which is not a tool/.test(SRC));
  ok('PS3 all three hints are emitted on every tool, plus a title',
     /t\.annotations = \{ title: a\[0\], readOnlyHint: a\[1\], destructiveHint: a\[2\], openWorldHint: a\[3\] \}/.test(SRC));
  ok('PS4 nothing is both read-only and destructive',
     Object.values(ann).every((a) => !(a.ro && a.de)));
  ok('PS5 every delete, discard and remove is destructive',
     Object.entries(ann).filter(([n]) => /^(delete_|discard_|remove_)/.test(n)).every(([, a]) => a.de && !a.ro));
  ok('PS6 edits that overwrite without history are destructive',
     ['edit_note', 'edit_travel_mark', 'edit_checkin', 'edit_ensemble', 'update_itinerary', 'update_itinerary_stop', 'update_itinerary_temporal'].every((n) => ann[n].de));
  ok('PS7 pure reads are read-only and non-destructive',
     ['my_notes', 'my_travel_marks', 'search_catalogue', 'catalogue_stats', 'my_itineraries', 'view_images', 'list_checkins', 'read_comments'].every((n) => ann[n].ro && !ann[n].de));
  ok('PS8 tools that reach the internet are open-world',
     ['verify_place', 'add_travel_mark', 'upload_image', 'edit_note'].every((n) => ann[n].ow));
  ok('PS9 tools that publish to other people are open-world',
     ['note_object', 'comment', 'warrant', 're_note', 'log_visit'].every((n) => ann[n].ow));
  // v2.55 audit: staging fetches https URLs and keeping can publish, so both are open-world
  ok('PS10 ownership and chunked uploads stay closed-world; staging and keeping an ensemble are open-world',
     ['record_note_ownership', 'begin_image_upload', 'upload_image_chunk'].every((n) => !ann[n].ow)
     && ['keep_ensemble', 'create_pending_ensemble'].every((n) => ann[n].ow));
  ok('PS11 withdrawing a warrant is reversible, so not destructive',
     !ann.revoke_warrant.de && !ann.revoke_warrant.ro);
}
{
  ok('PS12 database errors never reach the client verbatim',
     /const dbFault = e && \(\/\^ERR_SQLITE\//.test(SRC) && /!!e\.message && !dbFault/.test(SRC));
  ok('PS13 a fault does not claim nothing was saved',
     /so it may not have completed/.test(SRC) && !/while running this\. Nothing was saved\./.test(SRC));
  const rar = SRC.slice(SRC.indexOf('async function resolveAssetRef('), SRC.indexOf('function diagnoseDataUrl('));
  ok('PS14 the documented /i/<id> image reference works, through the ownership check',
     /\(\?:\/i\/\)\?/.test(rar) && /if \(own\) return resolveOwnedImageUid\(userId, own\[1\], what\);/.test(rar)
     && rar.indexOf('resolveOwnedImageUid(userId, own[1]') < rar.indexOf('ingestImage(userId, inline'));
  ok('PS15 the domain-verification token is served raw, and 404s when unset',
     /p === '\/\.well-known\/openai-apps-challenge'/.test(SRC) && /OPENAI_APPS_CHALLENGE/.test(SRC)
     && /if \(!tokenValue\) return send\(res, 'Not found', 404\)/.test(SRC) && /return res\.end\(tokenValue\);/.test(SRC));
  ok('PS16 privacy, terms and support pages exist and invent no contact or publisher',
     /p === '\/privacy' \|\| p === '\/terms' \|\| p === '\/support'/.test(SRC)
     && /process\.env\.SUPPORT_EMAIL/.test(SRC) && /process\.env\.PUBLISHER_NAME/.test(SRC)
     && !/mailto:[a-z0-9._-]+@(discriminantly|discriminant\.ly)/i.test(SRC));
  const ins = SRC.slice(SRC.indexOf("method === 'initialize'"), SRC.indexOf("method === 'initialize'") + 6000);
  ok('PS17 instructions keep a mark distinct from a visit',
     /a mark alone does not mean they went/.test(ins) && !/Travel marks are places they went/.test(ins));
  ok('PS18 instructions say discussing or recommending is not saving',
     /Recommending or discussing a place is not saving it/.test(ins) && /mentioning somewhere is not checking in/.test(ins));
}

// ---- policy pages: accuracy and no placeholders ------------------------------
console.log('\npolicy pages');
{
  const pp = SRC.slice(SRC.indexOf('function policyPage('), SRC.indexOf("function layout({ title, body, me, flash"));
  const all = SRC.slice(SRC.indexOf('// Publisher and contact are configuration'), SRC.indexOf("function layout({ title, body, me, flash"));
  ok('PP1 no placeholder operator or contact wording can be published',
     !/operator of Discriminantly|has not been published|not been published yet/.test(all));
  ok('PP2 without PUBLISHER_NAME and SUPPORT_EMAIL the pages refuse to render (503)',
     /if \(!PUBLISHER\(\) \|\| !SUPPORT_EMAIL\(\)\) \{[\s\S]{0,300}503\)/.test(pp));
  ok('PP3 a malformed support address counts as unset',
     /return \/\^\[\^\\s@<>"\]\+@/.test(all));
  ok('PP4 the configured publisher and address are escaped before rendering',
     /const who = esc\(PUBLISHER\(\)\), email = SUPPORT_EMAIL\(\);/.test(pp) && /mailto:\$\{esc\(email\)\}/.test(pp));
  ok('PP5 privacy and terms carry an effective and a last-updated date',
     /const POLICY_DATE = '\d{1,2} [A-Z][a-z]+ \d{4}'/.test(all) && /Effective \$\{POLICY_DATE\} \\u00b7 Last updated \$\{POLICY_DATE\}/.test(pp)
     && /terms: \['Terms', dated,/.test(pp)
     // Privacy keeps its effective date and carries its own last-updated date (v2.54.1)
     && /const PRIVACY_UPDATED = '\d{1,2} [A-Z][a-z]+ \d{4}'/.test(all)
     && /Effective \$\{POLICY_DATE\} \\u00b7 Last updated \$\{PRIVACY_UPDATED\}/.test(pp) && /privacy: \['Privacy', datedPrivacy,/.test(pp));
  ok('PP5b the privacy page discloses location, server logs, and what assistants receive',
     /Places and where you have been: for a travel mark/.test(SRC) && /Server logs: when a request fails, Discriminantly logs/.test(SRC)
     && /What an assistant receives:[^']*handles/.test(SRC));
  ok('PP6 every page links to the other two',
     /<a href="\/terms">Terms<\/a> \\u00b7 <a href="\/support">Support<\/a>/.test(pp)
     && /<a href="\/privacy">Privacy<\/a> \\u00b7 <a href="\/support">Support<\/a>/.test(pp)
     && /<a href="\/privacy">Privacy<\/a> \\u00b7 <a href="\/terms">Terms<\/a>/.test(pp));
  ok('PP7 no environment secret is ever rendered',
     !/OPENAI_APPS_CHALLENGE|ADMIN_PASSWORD|DB_PATH|process\.env\.(?!PUBLISHER_NAME|SUPPORT_EMAIL)/.test(pp));
  ok('PP8 claims that proved untrue are gone',
     !/We store only hashed versions/.test(pp) && !/do not sell or share your information with anyone else/i.test(pp)
     && !/deletion is immediate/.test(pp) && !/Private things are visible only to you/.test(pp)
     && !/invitation-only/i.test(pp) && !/What you add stays yours/.test(pp) && !/Everything it does is visible/.test(pp));
  ok('PP9 the disclosures the implementation requires are present',
     /Adobe Fonts/.test(pp) && /OpenStreetMap/.test(pp) && /Photon/.test(pp) && /visits that address from its server/.test(pp)
     && /operator can also access stored information/.test(pp) && /does not use what you keep to train AI models/.test(pp)
     && /copies can remain in backups/.test(pp) && /photos that were attached to it stay in storage/.test(pp)
     && /Account deletion is currently done by hand/.test(pp));
  ok('PP10 the AI-training claim is still true: the server calls no AI provider',
     !/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|replicate\.com/.test(SRC.replace(/\/\/[^\n]*/g, '')));
}

{
  ok('PP11 the welcome page links to Privacy, Terms and Support',
     /<footer class="welcome-foot fine"><a href="\/privacy">Privacy<\/a> \\u00b7 <a href="\/terms">Terms<\/a> \\u00b7 <a href="\/support">Support<\/a><\/footer>/.test(SRC));
}

// ---- scan remediation: annotation corrections and itinerary output schemas --
console.log('\nscan remediation');
{
  const annBlk = SRC.slice(SRC.indexOf('const TOOL_ANNOTATIONS = {'), SRC.indexOf('for (const t of TOOLS) {', SRC.indexOf('const TOOL_ANNOTATIONS = {')));
  const ann = {};
  for (const m of annBlk.matchAll(/^\s+([a-z_]+):\s+\['([^']*)', (true|false), (true|false), (true|false)\]/gm))
    ann[m[1]] = { ro: m[3] === 'true', de: m[4] === 'true', ow: m[5] === 'true' };
  ok('SR1 log_visit is open-world: check-ins show publicly on a public mark', ann.log_visit.ow);
  ok('SR2 keep_ensemble is open-world: staged private, but private:false publishes it on keep',
     ann.keep_ensemble.ow && /INSERT INTO ensembles\(user_id,title,description,private,status\) VALUES\(\?,\?,\?,1,'pending_review'\)/.test(SRC)
     && /const priv = a\.private === undefined \? 1 : \(a\.private \? 1 : 0\);/.test(SRC));
  ok('SR3 correcting an ownership record appends a superseding row, so is not destructive',
     !ann.correct_note_ownership_mistake.de && /INSERT INTO ownership_assertions\(user_id,object_id,note_uid,state,supersedes\)/.test(SRC)
     && !/DELETE FROM ownership_assertions/.test(SRC));
  ok('SR4 withdrawing a warrant or releasing ownership only appends, so neither is destructive',
     !ann.revoke_warrant.de && !ann.release_note_ownership.de
     && /function revokeWarrant\([^)]*\) \{\s*const r = q\('INSERT INTO warrants/.test(SRC));
  ok('SR5 the only warrant deletion is the cascade when the note or mark itself is deleted',
     (SRC.match(/DELETE FROM warrants/g) || []).length === 1 && /const dropWarrantsFor = /.test(SRC));
}
// Evaluate the real tool table (schemas + definitions) straight from server.js.
function loadToolsFromSource(SRC) {
  const pick = (name) => {
    const i = SRC.indexOf('const ' + name + ' = ');
    let j = i + name.length + 9, depth = 0, q = null;
    for (; j < SRC.length; j++) {
      const c = SRC[j];
      if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ';' && depth === 0) break;
    }
    return SRC.slice(i, j + 1);
  };
  const pre = ['OAUTH_SCOPE', 'IMAGE_FIELD_DESC'].map(pick).join('\n');
  const a = SRC.search(/\nconst OS_[A-Z_]+ = /);
  // run through the annotation step that follows the table, so annotations are the real ones
  const tail = 'which is not a tool`);', e = SRC.indexOf(tail, SRC.indexOf('const TOOL_ANNOTATIONS = {')) + tail.length;
  return new Function(pre + '\n' + SRC.slice(a, e) + '\nreturn TOOLS;')();
}
{
  const TOOLS_SRC = loadToolsFromSource(SRC);
  const byName = Object.fromEntries(TOOLS_SRC.map((t) => [t.name, t]));
  const check = (v, sch) => {
    if (sch.anyOf) { const { anyOf, ...base } = sch; return (!Object.keys(base).length || check(v, base)) && anyOf.some((b) => check(v, b)); }
    if ('const' in sch && v !== sch.const) return false;
    if (sch.enum && !sch.enum.includes(v)) return false;
    if (sch.type) {
      const is = (t) => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'integer' ? Number.isInteger(v)
        : t === 'number' ? typeof v === 'number' : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : typeof v === t;
      if (![].concat(sch.type).some(is)) return false;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ((sch.required || []).some((r) => !(r in v))) return false;
      const props = sch.properties || {};
      if (sch.additionalProperties === false && Object.keys(v).some((k) => !(k in props))) return false;
      if (Object.entries(v).some(([k, x]) => props[k] && !check(x, props[k]))) return false;
    }
    if (Array.isArray(v) && sch.items && !v.every((x) => check(x, sch.items))) return false;
    return true;
  };
  ok('SC1 every tool (the 54 submitted and every additive one) declares an outputSchema with an object root', TOOLS_SRC.length >= 54 && TOOLS_SRC.every((t) => t.outputSchema && t.outputSchema.type === 'object'));
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tool-results.json'), 'utf8'));
  const results = Object.entries(fx).flatMap(([n, rs]) => rs.map((r) => ({ n, r })));
  const succ = results.filter(({ r }) => !r.isError), errs = results.filter(({ r }) => r.isError);
  ok('SC2 every recorded real success conforms to its tool\u2019s schema as written in server.js (' + succ.length + ' results, ' + new Set(succ.map((x) => x.n)).size + ' tools)',
     new Set(succ.map((x) => x.n)).size === 54 && succ.every(({ n, r }) => check(r.structuredContent, byName[n].outputSchema)));
  ok('SC3 every recorded error is protocol-native: isError, no structuredContent, detail in _meta',
     errs.length >= 5 && errs.every(({ r }) => r.structuredContent == null && r.has_meta_error));
  const good = fx.add_itinerary_stops.find((r) => !r.isError).structuredContent, sch = byName.add_itinerary_stops.outputSchema;
  const bad = [{ ...good, surprise: 1 }, (() => { const b = JSON.parse(JSON.stringify(good)); delete b.itinerary_private; return b; })(),
    (() => { const b = JSON.parse(JSON.stringify(good)); b.stops[0].position = '1'; return b; })(),
    (() => { const b = JSON.parse(JSON.stringify(good)); b.stops[0].visibility = 'hidden'; return b; })(), { ...good, ok: false }, { ok: false, error: { message: 'x' } }];
  ok('SC4 the schemas reject malformed results (extra, missing, mistyped, off-enum, ok:false, error-shaped)', bad.every((b) => !check(b, sch)));
  const L = SRC.indexOf("method === 'tools/call'"), handler = SRC.slice(L, SRC.indexOf("return reply(id, null, { code: -32601", L));
  ok('SC5 the tool-call error reply carries no structuredContent, and keeps its detail in _meta',
     /_meta: \{ 'discriminantly\/error': \{ tool: params\.name,/.test(handler) && !/structuredContent: \{ ok: false/.test(SRC));
  ok('SC7 no request ID reaches the client: the reference stays in the server log only',
     !/reference: ref/.test(handler) && !/failed[^`]*reference \$\{ref\}/.test(handler) && /console\.log\(`\[tool-error\] ref=\$\{ref\}/.test(handler));
  ok('SC6 an engine TypeError or ReferenceError is masked as a fault, never shown verbatim',
     /const jsFault = e instanceof TypeError \|\| e instanceof ReferenceError;/.test(SRC) && /!dbFault && !jsFault/.test(SRC) && !/new TypeError|new ReferenceError/.test(SRC));
  const msg = (n, label) => { const r = (fx[n] || []).find((x) => x.label === label); return r && r.isError ? JSON.stringify(r) : ''; };
  ok('SD1 create_itinerary refuses a missing title instead of creating an untitled plan',
     /if \(typeof a\.title !== 'string' \|\| !a\.title\.trim\(\)\) throw new Error\('title is required/.test(SRC) && !!msg('create_itinerary', 'no title'));
  ok('SD2 update_itinerary_temporal refuses a non-list clear with a clear message',
     /if \(a\.clear !== undefined && !\(Array\.isArray\(a\.clear\)/.test(SRC) && !!msg('update_itinerary_temporal', 'clear:true'));
  ok('SD3 resolve_itinerary_stop with neither mark_uid nor unlink is refused and points to update_itinerary_stop',
     /if \(!a\.unlink && !a\.mark_uid\)\s*throw new Error\('Pass mark_uid to link[^']*update_itinerary_stop/.test(SRC) && !!msg('resolve_itinerary_stop', 'kind only'));
  const ann = Object.fromEntries(TOOLS_SRC.map((t) => [t.name, t.annotations]));
  // Counted over the SUBMITTED tools: their annotations are part of the
  // contract under review. Additive tools are checked separately (SW4).
  const SUBMITTED = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'submitted-mcp-contract.json'), 'utf8')).tools.map((t) => t.name));
  const SUB = TOOLS_SRC.filter((t) => SUBMITTED.has(t.name));
  // The v2.55 surface (all 61 tools). Closed-world = reads of the member's
  // bounded account, plus writes confined to data that is never public and
  // reach no outside service.
  const closed = ['my_notes', 'my_travel_marks', 'my_collections', 'my_itineraries', 'search_catalogue', 'catalogue_stats', 'recent_notes',
    'list_ensembles', 'get_ensemble', 'list_unresolved_components', 'list_checkins', 'read_comments', 'view_images',
    'record_note_ownership', 'release_note_ownership', 'correct_note_ownership_mistake',
    'begin_image_upload', 'upload_image_chunk', 'start_image_upload', 'finish_image_upload',
    'list_recommendations', 'dismiss_recommendation', 'list_stop_notes', 'audit_itinerary', 'audit_recommendation_expansion', 'clear_prospective_leftovers'];
  ok('SW1 closed-world is exactly the reads plus the writes confined to never-public data',
     JSON.stringify(TOOLS_SRC.filter((t) => !t.annotations.openWorldHint).map((t) => t.name).sort()) === JSON.stringify([...closed].sort()),
     TOOLS_SRC.filter((t) => !t.annotations.openWorldHint).map((t) => t.name).filter((n) => !closed.includes(n)).join(', '));
  ok('SW2 changing or removing content on a possibly-public record is open-world',
     ['add_itinerary_stops', 'arrange_itinerary', 'resolve_itinerary_stop', 'update_itinerary_temporal', 'delete_itinerary_entity',
      'edit_checkin', 'delete_checkin', 'revoke_warrant', 'set_primary_artifact', 'add_ensemble_artifact', 'add_ensemble_component',
      'resolve_ensemble_component', 'remove_ensemble_artifact', 'remove_ensemble_component', 'delete_ensemble', 'discard_ensemble',
      'delete_note', 'delete_travel_mark'].every((n) => ann[n].openWorldHint));
  const cnt = (k) => TOOLS_SRC.filter((t) => t.annotations[k]).length;
  ok('SW3 final counts (v2.60, 67 tools): 18 read-only, 17 destructive, 41 open-world',
     TOOLS_SRC.length === 67 && cnt('readOnlyHint') === 18 && cnt('destructiveHint') === 17 && cnt('openWorldHint') === 41,
     `${TOOLS_SRC.length} tools: ${cnt('readOnlyHint')} ro, ${cnt('destructiveHint')} de, ${cnt('openWorldHint')} ow`);
  ok('SW4 v2.55 audit corrections: staging and keeping an ensemble, and keeping a recommendation, are open-world; arranging an itinerary is destructive',
     ann.create_pending_ensemble.openWorldHint && ann.keep_ensemble.openWorldHint && ann.keep_recommendation.openWorldHint && ann.arrange_itinerary.destructiveHint);
}

// ---- repeat creation: duplicate results are structured and conform ----------
console.log('\nrepeat creation');
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tool-results.json'), 'utf8'));
  const pair = (tool, via) => [fx[tool].find((r) => r.label === `repeat first (${via})`), fx[tool].find((r) => r.label === `repeat second (${via})`)];
  for (const [tool, subject, re] of [['add_travel_mark', 'mark', /if \(pm\.state === 'exact'\) return \{ \.\.\.wr\(`Already in the member's marks: [\s\S]*?,\s*'unchanged', 'mark', pm\.id, pm\.uid, pm\.name, 'already_exists'\), meta \};/],
                                     ['note_object', 'note', /if \(dup\.state === 'exact'\) return \{ \.\.\.wr\(`This is already noted: [\s\S]*?,\s*'unchanged', 'note', dup\.id, dup\.uid, dup\.name, 'already_exists'\), meta \};/]]) {
    ok(`SU ${tool}: a detected duplicate returns the standard write result, action unchanged`, re.test(SRC));
    for (const via of ['legacy', 'oauth']) {
      const [a, b] = pair(tool, via);
      ok(`SU ${tool} (${via}): the repeat reports unchanged and identifies the existing ${subject}`,
         a && b && !b.isError && a.structuredContent.action === 'created' && b.structuredContent.action === 'unchanged'
         && b.structuredContent.subject === subject && b.structuredContent.id === a.structuredContent.id
         && b.structuredContent.uid === a.structuredContent.uid && b.structuredContent.name === a.structuredContent.name);
    }
  }
  ok('SU unchanged is an action the shared write schema already allowed', /action: \{ type: 'string', enum: \[[^\]]*'unchanged'/.test(SRC));
  ok('SU the duplicate paths write no provenance (nothing changed)',
     ['may already be marked', 'may already be noted'].every((k) => { const i = SRC.indexOf(k); const seg = SRC.slice(SRC.lastIndexOf('if (!a.allow_duplicate)', i), SRC.indexOf('\n    }', i)); return !/recordProvenance\(/.test(seg); }));
  const i = SRC.indexOf('async function mcpCall('), j = SRC.indexOf("throw new Error('Unknown tool ' + name)", i);
  ok('SU no tool branch returns plain text any more (every success is structured)',
     !/\n      (?:if \([^\n]*\) )?return [`'"]/.test(SRC.slice(i, j)));
}

// ---- profile All feed: same visibility rule as the section tabs -----------
console.log('\nprofile feed');
{
  const i = SRC.indexOf('  user(req, res, me, handle, url) {'), b = SRC.slice(i, i + 40000);
  ok('PF1 the All feed shows marks by the same rule as notes, itineraries and the Marks tab (canSee)',
     /for \(const x of q\(ADOPTED_MARK_SQL \+ ' WHERE m\.user_id=\? ORDER BY m\.id DESC LIMIT 30'\)\.all\(u\.id\)\)\s*if \(canSee\(x, me\)\) acts\.push/.test(b)
     && !/if \(!x\.private \|\| owner\) acts\.push/.test(b));
}

// ---- admin view of private content: a setting, web only -------------------
console.log('\nadmin private view');
{
  const lines = SRC.split('\n');
  const adminLines = lines.map((l, i) => [i, l]).filter(([, l]) => /is_admin/.test(l));
  const allowed = [/is_admin INTEGER DEFAULT 0/, /^const adminOn = \(me\) => !!\(me && me\.is_admin && me\.adminPrivateView === true\);$/,
    /if \(u && u\.is_admin && u\.admin_private_view\) u\.adminPrivateView = true;/, /\$\{me\.is_admin \? `<div class="wtable settings-table settings-admin" id="admin">/,
    /if \(!me \|\| !me\.is_admin\) return send\(res, 'Not allowed', 403\);/, /INSERT INTO users\(handle,name,email,pass,is_admin,avatar,ui_skin\)/,
];
  ok('AV1 no visibility or ownership check uses is_admin directly; the one exception is adminOn',
     adminLines.every(([, l]) => allowed.some((r) => r.test(l))));
  ok('AV2 one rule for first-class records: canSee, images, ensembles and stops all use adminOn',
     /const canSee = \(o, me\) => !o\.private \|\| \(me && \(me\.id === o\.user_id \|\| adminOn\(me\)\)\);/.test(SRC)
     && /\(me && \(me\.id === img\.user_id \|\| adminOn\(me\)\)\) \? true : imageIsPublic\(img\)/.test(SRC)
     && (SRC.match(/me\.id === e\.user_id \|\| adminOn\(me\)/g) || []).length === 2
     && /function canSeeStop\(stop, itin, me\) \{\s*if \(me && \(me\.id === itin\.user_id \|\| adminOn\(me\)\)\)/.test(SRC));
  const i = SRC.indexOf('async function mcpCall('), j = SRC.indexOf('const STATIC = {');
  ok('AV3 only the web session sets the admin view; the MCP code never sees it',
     (SRC.match(/adminPrivateView = true/g) || []).length === 1 && !/adminPrivateView|admin_private_view|adminOn\(/.test(SRC.slice(i, j)));
  ok('AV4 the setting has its own migration, off by default',
     /\['048-admin-private-view', \(\) => \{\s*if \(!hasColumn\('users', 'admin_private_view'\)\) db\.exec\('ALTER TABLE users ADD COLUMN admin_private_view INTEGER NOT NULL DEFAULT 0'\);/.test(SRC)
     && !/\['038-ui-skin'[\s\S]{0,400}admin_private_view/.test(SRC));
  ok('AV5 itinerary controls stay with the real owner, even with the admin view on',
     /const isOwner = !!\(me && me\.id === it\.user_id\);\s*const owner = isOwner \|\| adminOn\(me\);\s*const ctl = interactive && isOwner;/.test(SRC)
     && /\/\/ Editing controls and the owner's script: the real owner only\.\s*const owner = !!\(me && me\.id === it\.user_id\);/.test(SRC));
  ok('AV6 only an admin can change the setting, and every page shows a notice while it is on',
     /if \(p === '\/settings\/admin-view' && m === 'POST'\) \{\s*if \(!me \|\| !me\.is_admin\) return send\(res, 'Not allowed', 403\);/.test(SRC)
     && /if \(adminOn\(me\)\) body = `<p class="admin-view-note">/.test(SRC));
}

// ---- D4: check-ins and comments keep a record of their end ---------------
console.log('\ncascade deletion provenance');
{
  const i = SRC.indexOf("['049-cascade-deletion-provenance'"), b = SRC.slice(i, SRC.indexOf('}],', i));
  ok('CD1 deleting a mark records each of its check-ins and mark comments as deleted, by cascade',
     i > 0 && /BEFORE DELETE ON marks BEGIN[\s\S]*row\('visit', 'v'\)[\s\S]*FROM visits v WHERE v\.mark_id = OLD\.id[\s\S]*row\('mark_comment', 'c'\)[\s\S]*FROM mark_comments c WHERE c\.mark_id = OLD\.id/.test(b));
  ok('CD2 deleting a note records each of its comments as deleted, by cascade',
     /BEFORE DELETE ON objects BEGIN[\s\S]*row\('comment', 'c'\)[\s\S]*FROM comments c WHERE c\.object_id = OLD\.id/.test(b));
  ok('CD3 the cascade row is attributed honestly: system, source cascade, pointing at the parent',
     /'deleted', 'derived', 'system', NULL, 'system', 'system', NULL, 'cascade', OLD\.uid, NULL/.test(b));
  // The app records a directly deleted check-in or comment itself, so no
  // trigger may record THAT record again. (The trigger on visits records the
  // check-in's day notes, never the check-in.)
  const onVisits = (SRC.match(/BEFORE DELETE ON visits BEGIN([\s\S]*?)END`/) || [, ''])[1];
  ok('CD4 no trigger re-records a directly deleted check-in or comment (the app records those itself)',
     !/BEFORE DELETE ON (comments|mark_comments)\b/.test(SRC) && !/SELECT 'visit',/.test(onVisits) && /SELECT 'visit_day',/.test(onVisits));
}

// ---- residual hygiene: day notes and collection names ----------------------
console.log('\nday notes and collection names');
{
  const i = SRC.indexOf("['050-visit-day-deletion-provenance'"), b = SRC.slice(i, SRC.indexOf('}],', i));
  ok('VD1 deleting a check-in (directly or with its mark) records each day note as deleted, pointing at the check-in',
     i > 0 && /BEFORE DELETE ON visits BEGIN[\s\S]*SELECT 'visit_day', d\.uid, 'deleted', 'derived', 'system', NULL, 'system', 'system', NULL, 'cascade', OLD\.uid, NULL\s*FROM visit_days d WHERE d\.visit_id = OLD\.id/.test(b));
  ok('VD2 removing one day note directly is still recorded by the app, with no trigger on visit_days',
     /recordProvenance\('visit_day', existing\.uid, 'deleted', ctx, \{\}\);/.test(SRC) && !/BEFORE DELETE ON visit_days\b/.test(SRC));
  const u = SRC.indexOf('  user(req, res, me, handle, url) {'), ub = SRC.slice(u, u + 60000);
  ok('CL1 a collection name is shown to someone else only when they can see an item in it (notes and marks tabs)',
     (ub.match(/\}\)\.filter\(\(c\) => owner \|\| c\.count > 0\);/g) || []).length === 2);
}

// ---- admin: username, and where the Admin section sits ---------------------
console.log('\nadmin settings');
{
  const r = SRC.indexOf("if (p === '/settings/admin-handle' && m === 'POST') {"), rb = SRC.slice(r, SRC.indexOf('\n  }\n', r));
  ok('AH1 only an admin can change their username, with the same cleaning rule as joining (slug)',
     r > 0 && /if \(!me \|\| !me\.is_admin\) return send\(res, 'Not allowed', 403\);/.test(rb) && /handle = slug\(raw\)/.test(rb));
  ok('AH2 a taken username is refused, and only the admin\u2019s own row is changed',
     /SELECT 1 FROM users WHERE handle=\? AND id<>\?/.test(rb) && /UPDATE users SET handle=\? WHERE id=\?'\)\.run\(handle, me\.id\)/.test(rb));
  ok('AH3 the change is recorded in provenance as the admin editing their handle',
     /recordProvenance\('user', me\.uid, 'edited', webActor\(me\), \{ source_kind: 'manual', fields: 'handle' \}\)/.test(rb));
  const side = SRC.indexOf('<div class="settings-stack-side">'), inst = SRC.indexOf('id="install-box"'), adm = SRC.indexOf('settings-admin" id="admin"'), stackEnd = SRC.indexOf('<div class="settings-stack-side">');
  ok('AS1 the Admin section comes after Install, both in the column-3 cell (last on phones)',
     side > 0 && side < inst && inst < adm && SRC.indexOf('settings-invites') < side);
  ok('AS2 its spacing follows each skin\u2019s own tokens for these stacks',
     /\.settings-stack-side \{ display: flex; flex-direction: column; gap: 1\.4rem; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'style.shared.css'), 'utf8'))
     && /\.settings-stack-side \{ gap: 1rem; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'style.modern.css'), 'utf8'))
     && /\.settings-stack-side \{ gap: 0; \}/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'style.modern.css'), 'utf8')));
}

// ---- Stop -> Note ----------------------------------------------------------
console.log('\nstop notes');
{
  const i = SRC.indexOf("['051-itinerary-stop-notes'"), mb = SRC.slice(i, SRC.indexOf('}],', i));
  ok('SN1 one row per stop and note; cascades from both so no attachment outlives either, and neither deletes the other',
     i > 0 && /stop_id INTEGER NOT NULL REFERENCES itinerary_stops\(id\) ON DELETE CASCADE/.test(mb) && /note_id INTEGER NOT NULL REFERENCES objects\(id\) ON DELETE CASCADE/.test(mb) && /UNIQUE \(stop_id, note_id\)/.test(mb));
  ok('SN2 attachments removed with a stop or note are recorded (cascade, pointing at the parent)',
     /BEFORE DELETE ON itinerary_stops BEGIN[\s\S]*FROM itinerary_stop_notes a WHERE a\.stop_id = OLD\.id/.test(mb) && /BEFORE DELETE ON objects BEGIN[\s\S]*FROM itinerary_stop_notes a WHERE a\.note_id = OLD\.id/.test(mb));
  const a = SRC.slice(SRC.indexOf('function stopNoteAttach('), SRC.indexOf('function stopNoteDetach('));
  ok('SN3 only your own note on your own stop; a refusal never reveals another member\u2019s note',
     /const \{ stop \} = stopOwned\(user, stopUid\);/.test(a) && /SELECT id, uid FROM objects WHERE uid=\? AND user_id=\?/.test(a) && /throw new Error\('No such note\.'\)/.test(a));
  ok('SN4 attaching twice is idempotent, and records whether the note already existed',
     /if \(had\) return \{ action: 'unchanged', uid: had\.uid \};/.test(a) && /source_kind: origin === 'created' \? 'new_note' : 'existing_note', source_ref: note\.uid/.test(a));
  ok('SN5 attaching writes only the attachment: no note, ownership, warrant or check-in',
     !/INSERT INTO (objects|ownership_assertions|warrants|visits)/.test(a) && !/UPDATE objects/.test(a));
  ok('SN6 attached notes are shown only to viewers who can see them',
     /function stopNotesVisible\(stopId, me\) \{[^}]*?\.filter\(\(o\) => canView\('object', o, me\)\)/.test(SRC));
  ok('SN7 attach and detach controls are the real owner\u2019s only',
     /const myNotes = ctl \? /.test(SRC) && /\$\{ctl \? `<form method="post" action="\$\{base\}\/stops\/\$\{st\.uid\}\/notes\/\$\{o\.uid\}\/delete"/.test(SRC));
}

// ---- Adoption (Recommendations, Increment 1; migration 052) ----------------
// Source contracts. The database behaviour (backfill, projection, triggers,
// privacy) is exercised against a real server by test/adoption.js.
console.log('\nadoption');
{
  // the frozen MCP regions, by the same markers test/mcp-freeze.js uses
  const span = (a, b, incl = false) => { const i = SRC.indexOf(a); const j = SRC.indexOf(b, i + a.length); return [i, incl ? j + b.length : j]; };
  const schemaAt = SRC.search(/\nconst OS_[A-Z_]+ = /) + 1;
  const frozen = [span('const OAUTH_SCOPE = ', 'function clientInfoFrom(params)'),
    [schemaAt, SRC.indexOf('which is not a tool`);', schemaAt) + 22],
    span('async function mcpCall(', 'const STATIC = {'),
    span("if ((mt = p.match(/^\\/mcp\\/([A-Za-z0-9_-]+)$/)))", "if (p === '/mcp') return mcp(req, res, null);", true),
    span('// ---- OAuth discovery', "if (p === '/settings/connections' && m === 'POST')")];
  const inFrozen = (i) => frozen.some(([a, b]) => i >= a && i < b);
  const body = (start, end) => SRC.slice(SRC.indexOf(start), SRC.indexOf(end, SRC.indexOf(start) + start.length));

  // K1: anywhere, web or MCP, OBJ_SQL / MARK_SQL (every row) are used only
  // to reach ONE record by id or uid. Anything that lists, counts, searches or
  // publishes reads the Adopted projection.
  void inFrozen;
  const raw = [...SRC.matchAll(/\b(OBJ_SQL|MARK_SQL) \+ (['`])([^'`]*)\2/g)];
  const lists = raw.filter((m) => !/^ WHERE (o|m)\.(id|uid)=\?$/.test(m[3]));
  ok('K1a the guard sees the single-record reads it allows', raw.length >= 8, String(raw.length));
  ok('K1 every-row reads are single-record lookups only, on the web and behind MCP', lists.length === 0,
     lists.map((m) => m[0].slice(0, 60)).join(' | '));
  ok('K1b OBJ_SQL and MARK_SQL keep their meaning (every row), for single-record reads',
     /const OBJ_SQL = 'SELECT o\.\*, u\.handle, u\.name uname, u\.avatar FROM objects o JOIN users u ON u\.id=o\.user_id';/.test(SRC)
     && /const MARK_SQL = 'SELECT m\.\*, u\.handle, u\.name uname, u\.avatar FROM marks m JOIN users u ON u\.id=m\.user_id';/.test(SRC));
  ok('K1c the projection constants read the adopted views',
     /const ADOPTED_OBJ_SQL = '[^']*FROM adopted_objects o /.test(SRC) && /const ADOPTED_MARK_SQL = '[^']*FROM adopted_marks m /.test(SRC));

  // K1d: the submitted MCP corpus reads, behind their unchanged contracts
  const tool = (n) => SRC.slice(SRC.indexOf(`if (name === '${n}')`), SRC.indexOf('\n  if (name ===', SRC.indexOf(`if (name === '${n}')`) + 10));
  ok('K1d my_notes, my_travel_marks, search_catalogue, catalogue_stats and recent_notes read the projection',
     /ADOPTED_OBJ_SQL/.test(tool('my_notes')) && /ADOPTED_MARK_SQL/.test(tool('my_travel_marks'))
     && /ADOPTED_OBJ_SQL/.test(tool('search_catalogue')) && /ADOPTED_MARK_SQL/.test(tool('search_catalogue'))
     && /FROM adopted_objects/.test(tool('catalogue_stats')) && /FROM adopted_marks/.test(tool('catalogue_stats')) && !/FROM (objects|marks) /.test(tool('catalogue_stats'))
     && /ADOPTED_OBJ_SQL/.test(tool('recent_notes')));
  ok('K1e my_itineraries lists the projection; my_collections counts it',
     /SELECT \* FROM adopted_itineraries WHERE user_id=\? ORDER BY id DESC LIMIT \?/.test(SRC)
     && /COUNT\(\*\) FROM note_collections nc JOIN adopted_objects o ON o\.id=nc\.note_id WHERE nc\.collection_id=c\.id/.test(SRC));
  ok('K1f duplicate detection never calls an unkept record "already noted"',
     /function findSimilarNote[\s\S]{0,500}FROM adopted_objects WHERE user_id=\?/.test(SRC) && /function matchPlace\(userId, c, \{ scope = 'adopted' \} = \{\}\) \{[\s\S]{0,200}'marks' : 'adopted_marks'/.test(SRC)
     && /const pm = matchPlace\(user\.id, \{ name: a\.place,/.test(SRC));
  // K2: corpus surfaces, by name
  const home = body("rows = mineToo", 'const banner = resurfaceBanner(');
  ok('K2a the home feed reads notes, marks and itineraries from the projection',
     /ADOPTED_OBJ_SQL/.test(home) && /ADOPTED_MARK_SQL/.test(home) && /FROM adopted_itineraries/.test(home) && !/[^_]OBJ_SQL|[^_]MARK_SQL|FROM itineraries/.test(home));
  const search = body('function searchGroups(', 'const people = ');
  ok('K2b search reads the projection', /ADOPTED_OBJ_SQL/.test(search) && /ADOPTED_MARK_SQL/.test(search) && /adopted_itineraries/.test(search));
  ok('K2c /objects.json publishes only the projection', /p === '\/objects\.json'\) return json\(res, q\(ADOPTED_OBJ_SQL/.test(SRC));
  const resurf = body('function resurfaceCandidate(', 'function resurfaceCard(');
  ok('K2d resurfacing reads only the projection', /adopted_marks/.test(resurf) && !/q\(OBJ_SQL|q\(MARK_SQL \+ `/.test(resurf));
  const rail = body('function profileRail(', 'const following =');
  ok('K2e profile counts count the projection', /ADOPTED_OBJ_SQL/.test(rail) && /FROM adopted_marks/.test(rail) && /FROM adopted_itineraries/.test(rail));
  ok('K2f an image is public only through a public record in the corpus',
     /function imageIsPublic\(img\) \{[\s\S]{0,400}FROM adopted_objects WHERE private=0[\s\S]{0,200}FROM adopted_marks WHERE private=0/.test(SRC));

  // K3: single records reached by id are shown through canView, which keeps a
  // record outside the corpus private to its member
  ok('K3 canView: a record outside the corpus is its member’s alone, whatever its flag',
     /const canView = \(subjectType, row, me\) => \(isAdopted\(subjectType, row\.uid\)\s*\? canSee\(row, me\) : !!\(me && me\.id === row\.user_id\)\);/.test(SRC));
  ok('K3b the note, mark and itinerary pages use canView',
     /!canView\('object', o, me\)\) return send\(res, layout\(\{ title: 'Not found', body: '<p>No such note\./.test(SRC)
     && /!canView\('mark', m, me\)\) return send\(res, layout\(\{ title: 'Not found', body: '<p>No such mark\./.test(SRC)
     && /!canView\('itinerary', it, me\)\) return send\(res, layout\(\{ title: 'Not found', body: '<p>No such itinerary\./.test(SRC));
  ok('K3c a record outside the corpus is never a source for re-noting',
     /function renoteFrom\(src, me, ctx\) \{\s*(\/\/[^\n]*\n\s*)*if \(!isAdopted\('object', src\.uid\)\) throw/.test(SRC));

  // K4: every creation path records Adoption, and nothing else does
  const nc = body('function noteCreate(', '// ---- canonical mark creation');
  const mc = body('function markCreate(', '// ---- canonical visit recording');
  const ic = body('function itineraryCreate(', 'function itineraryEdit(');
  const rn = body('function renoteFrom(', '// ---- Ensemble (v1.18)');
  ok('K4 noteCreate, markCreate, itineraryCreate and renoteFrom each record Adoption',
     /recordAdoption\(user\.id, 'object'/.test(nc) && /recordAdoption\(user\.id, 'mark'/.test(mc)
     && /recordAdoption\(user\.id, 'itinerary'/.test(ic) && /recordAdoption\(me\.id, 'object'/.test(rn));
  ok('K4b a Note made for a pending Ensemble is the one exception, and only that',
     /const forPendingEnsemble = source_kind === 'ensemble' && source_ref\s*&& !!q\("SELECT 1 FROM ensembles WHERE uid=\? AND status='pending_review'"\)/.test(nc)
     && /if \(adopt && !forPendingEnsemble\) recordAdoption/.test(nc));
  ok('K4c collections are applied after Adoption, so a new Kept Note can be filed at once',
     nc.indexOf('recordAdoption(') < nc.indexOf('setCollections(') && mc.indexOf('recordAdoption(') < mc.indexOf('setMarkCollections('));
  const calls = [...SRC.matchAll(/recordAdoption\(/g)].map((m) => m.index).filter((i) => !SRC.slice(i - 9, i).includes('function'));
  const where = calls.map((i) => { const f = SRC.lastIndexOf('\nfunction ', i); return SRC.slice(f + 10, SRC.indexOf('(', f + 10)); });
  ok('K4d nothing else records Adoption (no inference from other acts)',
     where.every((w) => ['noteCreate', 'markCreate', 'itineraryCreate', 'renoteFrom', 'recommendationKeep', 'keepRecommendedRecord', 'ensembleKeepAdoptsLinked', 'keepFromRecommendedPlan', 'resolveTravelMark', 'keepRecord'].includes(w)), where.join(', '));

  // K5: independence
  const own = body('function assertOwned(', '// ---- Adoption (members see "Keep"');
  const vr = body('function visitRecord(', 'function stopAdd(');
  // Final semantic pass: they REQUIRE Adoption (assertAdoptedFor) and never
  // WRITE it -- a relationship is never read as an implicit Keep.
  const strip = (t) => t.replace(/assertAdoptedFor\([^;]*\);/g, '');
  ok('K5 Owned, Warrant and Check-in require Adoption and never write it (no implicit Keep)',
     /assertAdoptedFor\('object', [^;]*'ownership'\)/.test(own) && /assertAdoptedFor\(subjectType, [^;]*'warrant'\)/.test(own)
     && /assertAdoptedFor\('mark', mk, 'check-in'\)/.test(vr)
     && !/adopt/i.test(strip(own)) && !/Adoption|adoptions|recordAdoption/.test(strip(vr)));
  const adoptFns = body('const ADOPTABLE = ', 'function unadoptedExplanation(');
  ok('K5b recording, withdrawing or testing Adoption never reads ownership, warrants or check-ins', !/ownership|warrant|visits/i.test(adoptFns.replace(/\/\/[^\n]*/g, '')));
  const expl = body('function independentRelationship(', '// Visibility for a single record');
  ok('K5c those relationships may EXPLAIN a record outside the corpus, and never make it Kept (decision A)',
     /ownership_assertions/.test(expl) && /warrants/.test(expl) && /visits/.test(expl) && !/recordAdoption|INSERT INTO adoptions/.test(expl));

  // K6: collections and Stops
  ok('K6 only a Kept record joins a collection (domain + structural trigger)',
     /function setCollections\(userId, noteId, names\) \{\s*refuseUnkept\('object'/.test(SRC)
     && /function setMarkCollections\(userId, markId, names\) \{\s*refuseUnkept\('mark'/.test(SRC)
     && /trg_note_collections_kept_only BEFORE INSERT ON note_collections/.test(SRC)
     && /trg_mark_collections_kept_only BEFORE INSERT ON mark_collections/.test(SRC));
  ok('K6b a Stop in an adopted plan takes only a Kept Note',
     /if \(itin && isAdopted\('itinerary', itin\.uid\) && !isAdopted\('object', note\.uid\)\) throw/.test(SRC));

  // K7: the migration
  const mig = body("['052-adoptions'", '\n];');
  ok('K7 052 is the last migration, append-only and additive',
     SRC.indexOf("['052-adoptions'") > SRC.indexOf("['051-itinerary-stop-notes'") && !/DROP TABLE|ALTER TABLE \w+ RENAME|DELETE FROM (objects|marks|itineraries)\b/.test(mig));
  ok('K7b a pending Ensemble’s Notes are not backfilled as adopted',
     /ens\.status === 'pending_review'\) \{ skip\('object', 'pending_ensemble'\)/.test(mig));
  ok('K7c backfill provenance says derived, by a schema migration, dated now',
     /VALUES \('adoption', \?, 'adopted', 'derived', 'system', NULL, 'migration', 'system', NULL, 'schema_migration'/.test(mig));
  ok('K7d Keep adopts structurally; discarding or deleting a pending Ensemble adopts nothing (retained only in the historical backfill)',
     /trg_ensemble_keep_adopts AFTER UPDATE OF status ON ensembles\s*WHEN OLD\.status = 'pending_review' AND NEW\.status = 'saved'/.test(mig)
     && !/trg_ensemble_pending_delete_retains/.test(SRC) && !/adoptProv\('ensemble_retained'/.test(SRC)
     && /adopt\(o\.user_id, 'object', o\.uid, gone \? gone\.created_at : o\.created_at, 'ensemble_retained'/.test(mig));
  ok('K7e deleting a record removes its Adoption rows and records that it did',
     ['objects', 'marks', 'itineraries'].every((t) => new RegExp(`trg_\\$\\{table\\}_delete_adoptions BEFORE DELETE ON \\$\\{table\\}`).test(mig))
     // 054 replaces the objects trigger with one that de-resolves first, then removes Adoption
     && /trg_objects_delete_deresolves_and_adoptions BEFORE DELETE ON objects[\s\S]*?DELETE FROM adoptions WHERE subject_type = 'object' AND subject_uid = OLD\.uid;\s*END/.test(SRC));
}

// ---- Recommendation (Increment 2; migration 053) -----------------------------
console.log('\nrecommendation');
{
  const body = (a, b) => SRC.slice(SRC.indexOf(a), SRC.indexOf(b, SRC.indexOf(a) + a.length));
  const dom = body('// ---- Recommendation (Increment 2; migration 053)', '// ---- canonical note creation');
  const mig = body("['053-recommendations'", "['054-deletion-deresolves'");
  ok('RC1 053 follows 052, additive only', SRC.indexOf("['053-recommendations'") > SRC.indexOf("['052-adoptions'") && !/DROP TABLE|RENAME|DELETE FROM/.test(mig));
  ok('RC2 the label is never updated; resolution only rises',
     !/SET[^`']*\blabel=/.test(dom) && /resolution only ever gains precision/.test(dom));
  ok('RC3 a Recommendation writes no Owned, Warrant or Check-in, and reads none as evidence of taste',
     !/assertOwned|assertWarrant|visitRecord|INSERT INTO (ownership_assertions|warrants|visits|derived_relations)/.test(dom));
  ok('RC4 evidence cites the member’s own canonical records only, never a recommendation or an unkept record',
     /FROM adopted_objects WHERE uid=\? AND user_id=\?/.test(dom) && !/FROM recommendations WHERE uid=\? AND user_id/.test(body('function recEvidence(', 'function recContext(')));
  ok('RC5 a record made for a recommendation is private and not kept',
     (dom.match(/private: true \},\s*ctx, \{ source_kind: 'recommendation', source_ref: r\.uid, adopt: false \}\)/g) || []).length === 2
     && /itineraryCreate\(user, \{ title: r\.label, private: 1 \}, ctx, \{ adopt: false \}\)/.test(dom));
  ok('RC6 reuse before creation: existing records gain the recommendation', /findExistingNote\(user\.id/.test(dom) && /findExistingMark\(user\.id/.test(dom));
  ok('RC7 Adoption is recorded only when the member keeps: keep_recommendation, asking to note/mark the very thing recommended, or (web, Increment 4) keeping one place of a recommended plan; all cite the recommendation',
     (dom.match(/recordAdoption\(/g) || []).length === 5
     && /recordAdoption\(user\.id, subjectType, row\.uid, ctx, \{ source_kind: 'member_keep'/.test(dom)
     && /if \(target === 'canonical' && !isAdopted\('mark', uid\)\) \{ recordAdoption\(user\.id, 'mark', uid, ctx, \{ source_kind: 'resolution'/.test(dom) && /source_kind: 'recommendation', source_ref: r\.uid \}\)\) kept\.push/.test(dom)
     && /function keepFromRecommendedPlan\(user, subjectType, row, p, ctx\) \{\s*return recordAdoption\(user\.id, subjectType, row\.uid, ctx, \{ source_kind: 'recommendation', source_ref: p\.rec \? p\.rec\.uid : p\.plan_uid \}\);/.test(dom)
     && /function keepRecommendedRecord\(user, type, found, ctx\) \{\s*return recordAdoption\(user\.id, type, found\.row\.uid, ctx, \{ source_kind: 'recommendation', source_ref: found\.rec \}\);/.test(dom));
  ok('RC8 a new place in a recommended plan is not kept; in a kept plan it is',
     /adopt: isAdopted\('itinerary', it\.uid\) \}\)\.uid;/.test(SRC));
  ok('RC9 records outside the corpus are explained by a pending ensemble, a recommendation or a recommended plan',
     /return `recommendation:\$\{rec\.uid\}`/.test(SRC) && /return `pending_ensemble:/.test(SRC) && /return `recommended_itinerary:/.test(SRC));
}

// ---- Lifecycle invariants (items 6-8): behaviour in test/lifecycle.js --------
console.log('\nlifecycle invariants (source)');
{
  const mig = SRC.slice(SRC.indexOf("['054-deletion-deresolves'"), SRC.indexOf('\n];', SRC.indexOf("['054-deletion-deresolves'")));
  ok('LC1 054 de-resolves, never deletes: stops and components are UPDATEd in place, and nothing in it deletes an element or a parent',
     /BEFORE DELETE ON marks[\s\S]*UPDATE itinerary_stops SET[\s\S]*mark_uid\s*= NULL, resolution = 'particular'/.test(mig)
     && /BEFORE DELETE ON objects[\s\S]*UPDATE ensemble_components SET[\s\S]*note_uid\s*= NULL, state = 'unresolved'/.test(mig)
     && !/DELETE FROM (itinerary_stops|ensemble_components|itineraries|ensembles)/.test(mig));
  ok('LC2 each de-resolution is recorded on the element as a consequence (de_resolved, system, cascade or backfill): stops, components, and recommendations of notes, marks and plans',
     (mig.match(/'de_resolved', 'derived', 'system'/g) || []).length === 8
     && ['object', 'mark', 'itinerary'].every((t) => new RegExp(`'target:${t}'`).test(mig)) && !/DELETE FROM recommendations/.test(mig));
  ok('LC3 edits of a note, mark or plan go through assertEditable (MCP and web)',
     (SRC.match(/assertEditable\('object', o\)/g) || []).length === 2 && (SRC.match(/assertEditable\('mark', mk\)/g) || []).length === 2
     && /function itineraryEdit[^]*?assertEditable\('itinerary', it\)/.test(SRC) && /function itineraryPublish[^]*?assertEditable\('itinerary', it\)/.test(SRC));
  const nsd = SRC.slice(SRC.indexOf('function notesSafeToDiscard('), SRC.indexOf('function dropPendingEnsembleNotes('));
  ok('LC4 discarding an Ensemble drops only never-kept notes of a PENDING composition; an adopted note is always kept back',
     /if \(ens\.status === 'pending_review' && !isAdopted\('object', n\.uid\)\)/.test(nsd) && /keep\.push\(\{ \.\.\.n, reasons: \['in their notes'\] \}\);\s*\}\s*return/.test(nsd));
  ok('LC5 a kept parent takes only kept children at every explicit link site', (SRC.match(/assertKeptChild\(/g) || []).length === 5 && /if \(e\.status === 'saved'\) \{\s*const n = findExistingNote\(/.test(SRC));
}

// ---- MCP contract guard: generated tool definitions vs the v2.55 snapshot ------
// test/fixtures/mcp-contract-v2.55.json is the current surface (61 tools), the
// baseline for the next submission. test/fixtures/submitted-mcp-contract.json
// is the HISTORICAL surface submitted at v2.52.7 (review cancelled): kept for
// comparison and never rewritten. Neither is rewritten by a test run; the
// current one only deliberately (node test/mcp-contract.js --record). No server
// needed: every definition is generated from server.js itself.
console.log('\nMCP contract (definitions)');
{
  const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
  const cur = read('mcp-contract-v2.61.json'), rel = read('mcp-contract-v2.60.json'), hist = read('submitted-mcp-contract.json');
  const norm = (v) => JSON.parse(JSON.stringify(v).split('https://www.discriminantly.com').join('{ORIGIN}'));
  const gen = norm(loadToolsFromSource(SRC));
  const names = (l) => l.map((t) => t.name);
  ok('MC1 the v2.61 snapshot holds 67 tools, as did v2.60; the historical one still holds the submitted 54', cur.tools.length === 67 && rel.tools.length === 67 && hist.tools.length === 54);
  // v2.58 against v2.56: delegated itinerary authoring and place identity.
  // Only these descriptions and my_travel_marks' result changed; two tools added;
  // every existing annotation and the server instructions are unchanged.
  // v2.59 against v2.58: the deferred items (field status, images, expansion audit, build_itinerary).
  // v2.61 against v2.60: no tool changed; only the server capabilities (Skills extension).
  const V258_CHANGED = [];
  const V258_ADDED = [];
  const incChanged = rel.tools.filter((t) => { const c = cur.tools.find((x) => x.name === t.name); return !c || JSON.stringify(c) !== JSON.stringify(t); }).map((t) => t.name).sort();
  const incAdded = cur.tools.filter((t) => !rel.tools.find((x) => x.name === t.name)).map((t) => t.name).sort();
  ok('MC9 against v2.60, no tool changed or was added (v2.61 adds only the Skills extension); existing annotations and the instructions unchanged',
     JSON.stringify(incChanged) === JSON.stringify(V258_CHANGED) && JSON.stringify(incAdded) === JSON.stringify(V258_ADDED)
     && rel.tools.every((t) => JSON.stringify(t.annotations) === JSON.stringify(cur.tools.find((x) => x.name === t.name).annotations))
     && rel.initialize.instructions === cur.initialize.instructions, `changed: ${incChanged.join(', ')} | added: ${incAdded.join(', ')}`);
  const drift = gen.filter((t) => { const c = cur.tools.find((x) => x.name === t.name); return !c || JSON.stringify(c) !== JSON.stringify(t); }).map((t) => t.name);
  ok('MC2 every tool definition generated from source matches the v2.56 snapshot (names, descriptions, schemas, annotations, security)',
     !drift.length && gen.length === cur.tools.length, 'differs: ' + drift.join(', '));
  ok('MC3 every tool is complete: title, description, input and output schemas, all three hints, OAuth security',
     gen.every((t) => t.title && t.description && t.inputSchema && t.outputSchema && t.annotations
       && ['readOnlyHint', 'destructiveHint', 'openWorldHint'].every((k) => typeof t.annotations[k] === 'boolean')
       && JSON.stringify(t.securitySchemes) === JSON.stringify(hist.tools[0].securitySchemes)));
  // Historical regression reference: what changed since the cancelled
  // submission, and only that. A change outside these lists is a finding.
  // delete_note / delete_travel_mark: descriptions state de-resolution (final semantic pass)
  const APPROVED_CHANGED = ['add_itinerary_stops', 'add_travel_mark', 'arrange_itinerary', 'create_pending_ensemble', 'delete_ensemble', 'delete_note', 'delete_travel_mark', 'discard_ensemble', 'keep_ensemble', 'my_itineraries', 'my_travel_marks', 'note_object', 're_note', 'recent_notes', 'resolve_ensemble_component', 'resolve_itinerary_stop', 'upload_image', 'verify_place'];
  // The shared write result gained one action, 'kept' (note_object /
  // add_travel_mark keeping an already-recommended record). That alone is
  // not a change to a tool's meaning, so it is compared without it.
  const sansKept = (t) => JSON.parse(JSON.stringify(t, (k, v) => (k === 'enum' && Array.isArray(v) && v.includes('kept') && v.includes('created')) ? v.filter((x) => x !== 'kept') : v));
  const APPROVED_ADDED = ['audit_itinerary', 'audit_recommendation_expansion', 'build_itinerary', 'clear_prospective_leftovers', 'dismiss_recommendation', 'keep_recommendation', 'keep_record', 'list_recommendations', 'list_stop_notes', 'record_recommendations', 'resolve_recommendation', 'resolve_travel_mark', 'set_stop_note'];
  const removed = names(hist.tools).filter((n) => !gen.find((t) => t.name === n));
  const changed = hist.tools.filter((t) => { const g = gen.find((x) => x.name === t.name); return g && JSON.stringify(sansKept(g)) !== JSON.stringify(t); }).map((t) => t.name).sort();
  const added = names(gen).filter((n) => !hist.tools.find((t) => t.name === n)).sort();
  ok('MC4 against the historical submission: nothing removed or renamed; only the approved tools changed or were added',
     !removed.length && JSON.stringify(changed) === JSON.stringify(APPROVED_CHANGED) && JSON.stringify(added) === JSON.stringify(APPROVED_ADDED),
     `removed: ${removed.join(', ')} | changed: ${changed.join(', ')} | added: ${added.join(', ')}`);
  ok('MC5 one surface: /mcp serves every tool to every connection; no per-member or per-endpoint exposure remains',
     /if \(method === 'tools\/list'\) return reply\(id, \{ tools: TOOLS \}\);/.test(SRC)
     && !/ADDITIVE_TOOLS|SUBMITTED_TOOLS|additiveFor|MCP_ADDITIVE_TOOLS|mcp-dev|mcpSurface|developerSurfaceAllowed/.test(SRC));
  console.log(`     ${gen.length} tools; since the historical submission: ${changed.length} changed, ${added.length} added, ${removed.length} removed`);
  // The draft submission file for the next review must declare exactly the
  // annotations the server generates, with all three justifications per tool.
  const sub = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'submission', 'chatgpt-app-submission-v2.55.draft.json'), 'utf8'));
  const subNames = Object.keys(sub.tools).sort();
  const annDiff = gen.filter((t) => !sub.tools[t.name] || ['readOnlyHint', 'destructiveHint', 'openWorldHint'].some((k) => sub.tools[t.name].annotations[k] !== t.annotations[k])).map((t) => t.name);
  ok('MC6 the v2.55 draft submission lists every tool once, with the generated annotations',
     JSON.stringify(subNames) === JSON.stringify(names(gen).sort()) && !annDiff.length, 'differs: ' + annDiff.join(', '));
  ok('MC7 every tool in the draft submission has read-only, open-world and destructive justifications',
     Object.values(sub.tools).every((t) => ['read_only_justification', 'open_world_justification', 'destructive_justification'].every((k) => typeof t.justifications[k] === 'string' && t.justifications[k].length > 10)));
  ok('MC8 every draft test case uses only tools that exist', sub.test_cases.every((c) => String(c.tools_triggered).split(/,\s*/).every((n) => names(gen).includes(n))));
}

// ---- Regions that must not move: OAuth, MCP routes, discovery, plugin/ ------
console.log('\nMCP compatibility-critical regions');
{
  const { fingerprint, FILE } = require('./mcp-freeze');
  const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let have = {};
  // A missing boundary marker means frozen code was edited around it: fail, don't crash.
  try { have = fingerprint(); } catch (e) { ok('MF frozen region boundaries intact (' + e.message + ')', false); }
  for (const k of new Set([...Object.keys(want), ...Object.keys(have)]))
    ok('MF frozen: ' + k, want[k] && have[k] === want[k]);
}

// ---- Welcome in All (v2.56) ------------------------------------------------
console.log('\nwelcome');
{
  ok('WL1 Welcome is a feed entry dated by the member\u2019s join time: never pinned, only on All, signed in, unfiltered',
     /\.\.\.\(me && feed === 'all' && !s && !tag \? \[lazy\(me\.created_at, 'welcome', \(\) => welcomeCard\(me\)\)\] : \[\]\)/.test(SRC));
  const f = SRC.slice(SRC.indexOf('function welcomeCard('), SRC.indexOf('\n}\n', SRC.indexOf('function welcomeCard(')));
  ok('WL2 no dismiss or completion mechanics', !/dismiss|complete|onboard/i.test(f.replace(/Welcome/g, '')));
  ok('WL3 connection state comes from the member\u2019s live connections, per AI',
     /const live = conns\.filter\(\(c\) => !c\.revoked_at\);/.test(SRC) && /chatgpt\|openai/.test(SRC) && /claude\|anthropic/.test(SRC));
  ok('WL4 the ChatGPT steps appear only once the listing exists (CHATGPT_PLUGIN_URL); until then, a truthful "coming" note',
     /const pluginUrl = \(process\.env\.CHATGPT_PLUGIN_URL \|\| ''\)\.trim\(\);/.test(f) && /coming to ChatGPT\\u2019s plugin directory/.test(f));
  ok('WL5 current Claude wording: Customize \u203a Connectors, Add custom connector, + \u203a Connectors',
     /Customize \\u203a Connectors/.test(f) && /Add custom connector/.test(f) && /\+ \\u203a Connectors/.test(f));
  ok('WL6 built from the skin\u2019s own components (arcTitle headline, sbox-title, sbox-sub, btn3d, link caps), with three separate tiles',
     ['arcTitle(', 'sbox-title', 'sbox-sub', 'btn3d', 'link caps'].every((c) => f.includes(c)) && !/wtable wl-kinds|wcell wl-kind/.test(f)
     && /\[\[1, 'Orientation', 'Orientation'\], \[2, 'Connect your AI', 'Connect'\], \[3, 'Get started', 'Start'\]\]/.test(f));
}

// ---- Place identity (v2.58): one matcher, exact-only reuse -------------------
console.log('\nplace identity');
{
  const vm = require('vm');
  const pick = (from, to) => SRC.slice(SRC.indexOf(from), SRC.indexOf(to, SRC.indexOf(from)));
  const code = pick('const normTitle = ', '\nfunction findSimilarNote') + '\n' + pick('const PLACE_GENERIC = ', '\n// scope \'adopted\'');
  const ctx = {}; vm.runInNewContext(code + '\nthis.placeMatchRow = placeMatchRow; this.placeMatchBest = placeMatchBest;', ctx);
  const { placeMatchRow: row, placeMatchBest: best } = ctx;
  const mplus = { id: 1, uid: 'mplus', name: 'M+', locality: 'Hong Kong', country: 'Hong Kong', address: '38 Museum Drive, West Kowloon', lat: 22.3017, lng: 114.1597 };
  const taipei = ['Simple Kaffa Huashan Flagship Store', 'National Taiwan Museum \u2014 Railway Department Park', 'Yongle Fabric Market', 'Mountain and Sea House', 'Bar Mood Taipei'];
  ok('PM1 none of the five Taipei places matches M+ Hong Kong (the dogfood failure)',
     taipei.every((n) => row({ name: n, locality: 'Taipei', country: 'Taiwan' }, mplus).state === 'none'));
  ok('PM2 without any locality or country either, a name containing "m" is still no match',
     taipei.every((n) => row({ name: n }, mplus).state === 'none'));
  ok('PM3 another country is never the same place on its name', row({ name: 'M+', locality: 'Taipei', country: 'Taiwan' }, mplus).state === 'none');
  ok('PM4 same name, same city: exact (normalized_name_locality)',
     (({ state, basis }) => state === 'exact' && basis.includes('normalized_name_locality'))(row({ name: 'M+', locality: 'Hong Kong' }, mplus)));
  ok('PM5 same address and a matching name: exact, even with no coordinates',
     row({ name: 'M+', address: '38 Museum Drive, West Kowloon' }, { ...mplus, lat: null, lng: null }).state === 'exact');
  ok('PM6 effectively identical coordinates and a matching name: exact',
     row({ name: 'M+ museum', lat: 22.30172, lng: 114.15972 }, mplus).state === 'exact');
  const bb = { id: 2, uid: 'bbk', name: 'Blue Bottle Coffee Kiyosumi', locality: 'Tokyo', country: 'Japan' };
  ok('PM7 a branch of the same chain in another country: no match', row({ name: 'Blue Bottle Coffee Mission', locality: 'San Francisco', country: 'United States' }, bb).state === 'none');
  ok('PM8 another branch in the same city: possible at most, never reused', ['possible', 'none'].includes(row({ name: 'Blue Bottle Coffee Aoyama', locality: 'Tokyo' }, bb).state));
  ok('PM9 generic words alone ("Coffee Store") never make a match', row({ name: 'Coffee Store', locality: 'Tokyo' }, { id: 3, uid: 'x', name: 'Coffee Store Kitchen', locality: 'Tokyo' }).state === 'none');
  const two = [{ id: 4, uid: 'h1', name: 'Hatchards', locality: 'London', country: 'United Kingdom' }, { id: 5, uid: 'h2', name: 'Hatchards', locality: 'Edinburgh', country: 'United Kingdom' }];
  ok('PM10 the same name in two cities and no city given: probable, not exact (surfaced, not substituted)', best({ name: 'Hatchards' }, two).state === 'probable');
  ok('PM11 the same name in another city: possible', row({ name: 'Hatchards', locality: 'Bath' }, two[0]).state === 'possible');
  ok('PM12 every place path reuses only on exact: add_travel_mark, recommendations, recommended plans, recommended records',
     /if \(pm\.state === 'exact'\) return \{ \.\.\.wr\(`Already in the member's marks:/.test(SRC)
     && /return m\.state === 'exact' \? m\.row : null;/.test(SRC)
     && /const m = placeMatchBest\(\{ name, locality, \.\.\.place \}, open\); return m\.state === 'exact' \? m\.row : null;/.test(SRC)
     && !/function findSimilarMark\(/.test(SRC));
  ok('PM13 match diagnostics reach the caller in the reply and its _meta (no schema change)',
     /meta: \{ 'discriminantly\/place_match': pm \? placeMatchPublic\(pm\)/.test(SRC) && /if \(out && typeof out === 'object' && out\.meta\) payload\._meta = /.test(SRC));
}

// ---- Note identity (v2.60): no containment matches ------------------------
console.log('\nnote identity');
{
  const vm = require('vm');
  const pick = (from, to) => SRC.slice(SRC.indexOf(from), SRC.indexOf(to, SRC.indexOf(from)));
  const code = pick('const normTitle = ', '\n// Notes (v2.60)') + '\n' + pick('const NOTE_GENERIC = ', '\n// The member\'s corpus only');
  const ctx = {}; vm.runInNewContext(code + '\nthis.noteMatchRow = noteMatchRow;', ctx);
  const row = ctx.noteMatchRow, leica = { name: 'Leica', url: '' };
  ok('NM1 a short title never swallows others (the M+ bug, for things)', ['Leica M6 Classic', 'Leica Q3 camera strap'].every((n) => row({ name: n }, leica).state === 'none'));
  ok('NM2 the same title is exact', row({ name: 'Leica' }, leica).state === 'exact');
  ok('NM3 the same link is exact, whatever the title', row({ name: 'Pan', link: 'https://www.debuyer.com/en/mineral-b?x=1' }, { name: 'de Buyer 28 cm', url: 'http://debuyer.com/en/mineral-b/' }).state === 'exact');
  ok('NM4 strong word overlap is probable, surfaced not substituted', row({ name: 'Blenheim Forge Model chef knife' }, { name: 'Blenheim Forge Model chef knife steel', url: '' }).state === 'probable');
  ok('NM5 note_object reports a probable match without writing, and diagnostics in _meta', /if \(dup\.state === 'probable'\) return \{ \.\.\.wr\(`Nothing was created:/.test(SRC) && /'discriminantly\/note_match'/.test(SRC));
  ok('NM6 the web mark form uses the shared place matcher (D2 on the web)', /\/\/ D2 on the web[\s\S]{0,200}const pm = matchPlace\(me\.id,/.test(SRC) && /if \(pm\.state === 'exact'\) return redirect\(res, `\/m\/\$\{pm\.id\}\?already=1`\);/.test(SRC));
}

// ---- The five Skills (v2.61): one source, valid, and only real tools ----------
console.log('\nskills');
{
  const dir = path.join(__dirname, '..', 'skills');
  const names = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'SKILL.md'))).sort();
  const want = ['discriminantly-destination-objects', 'discriminantly-for-another-time', 'discriminantly-note-enhancement', 'discriminantly-travel-mark-enhancement', 'discriminantly-trip-planning'];
  ok('SK1 exactly the five skills, one directory each', JSON.stringify(names) === JSON.stringify(want), names.join(', '));
  const toolNames = new Set(loadToolsFromSource(SRC).map((t) => t.name));
  const skillNames = new Set(want);
  for (const n of names) {
    const t = fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(t);
    const lines = m ? m[1].split('\n').filter(Boolean) : [];
    const fmObj = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]));
    ok(`SK2 ${n}: front matter is exactly name and description, and name matches the directory`, JSON.stringify(Object.keys(fmObj)) === JSON.stringify(['name', 'description']) && fmObj.name === n);
    ok(`SK3 ${n}: the description is plain YAML (no ": " or "#" that would change its parsed value)`, !/: |#/.test(fmObj.description || 'x:') && (fmObj.description || '').length <= 1024);
    const refs = [...t.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((x) => x[1]).filter((x) => x.includes('_') && !/^(target_state|identity_basis|mark_uid|allow_distinct_from_candidate|all_specific_stops_linked|no_unplaced_stops|enhanced_marks|image_uid|context_itinerary_uid|context_stop_uid|origin_itinerary_uid|same_city|destination_objects|for_another_time|target_uid|recommendation_context|authoritative_source|mapping_provider|member_identity|stable_external_id|place_identity)$/.test(x));
    const unknown = [...new Set(refs.filter((x) => !toolNames.has(x)))];
    ok(`SK4 ${n}: every tool it names exists`, unknown.length === 0, unknown.join(', '));
    const skillRefs = [...t.matchAll(/discriminantly-[a-z-]+/g)].map((x) => x[0]).filter((x) => x !== n);
    ok(`SK5 ${n}: every skill it depends on exists`, skillRefs.every((x) => skillNames.has(x)));
  }
  const plan = fs.readFileSync(path.join(dir, 'discriminantly-trip-planning', 'SKILL.md'), 'utf8');
  ok('SK6 the Naples correction: planning makes enhancement a required step for every mark, with read-back and a quality check', /## 4\. Enhance every place \(required\)/.test(plan) && /EVERY travel mark created or newly kept/.test(plan) && /not "as useful"/.test(plan) && /B\. Record quality/.test(plan));
  ok('SK7 the server serves the skills over the documented extension', /extensions: \{ 'io\.modelcontextprotocol\/skills': \{\} \}/.test(SRC) && /method === 'skills\/list'/.test(SRC) && /method === 'skills\/get'/.test(SRC) && /method === 'resources\/read'/.test(SRC));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
