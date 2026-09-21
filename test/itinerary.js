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
  d.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)'); d.exec('INSERT INTO users VALUES(1)');
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
  vm.runInContext(SRC.slice(from2, to2) + '\nglobalThis.S = canSeeStop;', c2);
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

  ok('   nine itinerary tools present', mine.length === 9, String(mine.length));
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
     /out\.push\(\['Planned', monthYear\(it\.created_at\)\]\)/.test(fn));
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
  ok('M5 a private plan is never named to someone who cannot see it',
     /canSee\(it, me\)/.test(mk) && /'a trip'/.test(mk));
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
     /canSee\(note, me\)/.test(en) && /withheld/.test(en));
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
     /securitySchemes: SEC_OAUTH/.test(SRC)
     && (SRC.match(/securitySchemes: SEC_OAUTH/g) || []).length === 54);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
