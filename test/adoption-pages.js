// Captures what members actually see, for the Increment 1 parity check: the
// same database served by the code before migration 052 and after it must
// look the same to every viewer, except where the Adopted projection is meant
// to change it (a Note made for an Ensemble still pending review, which is not
// in its member's corpus).
//
//   BASE=http://localhost:PORT DB_PATH=<db> node test/adoption-pages.js <out.json>
//
// Reads the fixture sidecar (<DB_PATH>.fixture.json) for the session cookies.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '');
// Compare mode:
//   node test/adoption-pages.js compare <before-full> <before-without-pending> <after> <pendingNoteId> <pendingEnsembleId>
// before-full: the old code on the fixture. before-without-pending: the old
// code on the same fixture with the pending-ensemble Note deleted, which is
// exactly the corpus the Adopted projection should present.
if (process.argv[2] === 'compare') {
  const [full, without, after] = process.argv.slice(3, 6).map((f) => JSON.parse(require('fs').readFileSync(f, 'utf8')));
  // Increment 4 changes two things on every page on purpose: the delete
  // confirmation can take its own copy, and a kept plan's or composition's
  // Delete says what stays. Both are folded back here, and nothing else is.
  const inc4 = (s) => s.split("'</b>? ' + (t.dataset.copy || 'This cannot be undone.') });").join("'</b>? This cannot be undone.' });")
    .replace(/ data-copy="[^"]*"/g, '')
    // v2.56 Welcome: a new card in All for signed-in members, and its styles.
    // Folded back as a whole article; everything else on the page still compares.
    .replace(/<article class="card welcome-card"[\s\S]*?<\/article>/g, '')
    // v2.60.3: the travel mark photo moved under the arched title. Folded out on
    // both sides; everything else on the page still compares, in order.
    .replace(/\s*<a class="mark-photo" href="[^"]*"><img [^>]*><\/a>/g, '')
    // ...and a mark with no photo leaves an empty line that moved with it.
    // Whitespace-only lines carry no meaning in HTML, so neither side keeps them.
    .replace(/\n[ \t]*(?=\n)/g, '');
  for (const set of [full, without, after]) for (const k of Object.keys(set)) set[k].body = inc4(set[k].body);
  const pendingNote = `owner /o/${process.argv[6]}`, pendingEns = `owner /e/${process.argv[7]}`;
  const digits = (x) => x.replace(/\d+/g, '#');
  let pass = 0, fail = 0;
  const ok = (n, c) => { c ? pass++ : fail++; if (!c) console.log('  FAIL ' + n); };
  for (const k of Object.keys(after)) {
    const a = after[k];
    if (!k.startsWith('owner ')) {
      ok(`${k}: identical to the old code for every non-owner viewer`, a.status === full[k].status && a.body === full[k].body);
    } else if (k === pendingNote || k === pendingEns) {
      // the pending Note's own page and its Ensemble's: still the owner's,
      // only the corpus count beside it changes
      // Increment 4: the staged Note, on its own page and in its pending
      // composition, now shows as staged ("Kept with its composition").
      ok(`${k}: the owner still reaches it`, a.status === 200 && /Kept with its composition/.test(a.body));
    } else {
      ok(`${k}: identical to the old code without the pending Note`, a.status === without[k].status && a.body === without[k].body);
    }
  }
  console.log(`  parity: ${pass} views checked, ${fail} differ`);
  process.exit(fail ? 1 : 0);
}
const DB_PATH = process.env.DB_PATH, OUT = process.argv[2];
if (!DB_PATH || !OUT) { console.error('usage: BASE=... DB_PATH=... node test/adoption-pages.js <out.json>'); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(DB_PATH + '.fixture.json', 'utf8'));
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const viewers = { anon: null, owner: fx.sidA, other: fx.sidB };
const urls = ['/', '/?feed=all', '/?q=fixture', '/?q=piece', '/objects.json', '/t', '/t?u=elicierto',
  '/u/elicierto', '/u/elicierto?tab=notes', '/u/elicierto?tab=marks', '/u/elicierto?tab=warrants',
  '/u/elicierto?tab=ensembles', '/u/bea', '/u/bea?tab=notes', '/u/bea?tab=following', '/u/elicierto?tab=followers',
  ...db.prepare('SELECT id FROM objects ORDER BY id').all().map((r) => `/o/${r.id}`),
  ...db.prepare('SELECT id FROM marks ORDER BY id').all().map((r) => `/m/${r.id}`),
  ...db.prepare('SELECT id FROM itineraries ORDER BY id').all().map((r) => `/t/${r.id}`),
  ...db.prepare('SELECT id FROM ensembles ORDER BY id').all().map((r) => `/e/${r.id}`)];
// Values that differ between two boots of the same code and data.
const norm = (s) => s
  .replace(/\?v=[0-9a-f]{10}/g, '?v=X')
  .replace(/>(\d+[smhdwy]|\d+mo) ago</g, '>[ago]<')
  .replace(/<h3 class="lbl suggest-title">You might like<\/h3>[\s\S]*?<\/div>/g, '[suggestions]');
(async () => {
  const out = {};
  for (const [who, sid] of Object.entries(viewers)) {
    for (const u of urls) {
      const r = await fetch(BASE + u, { headers: sid ? { cookie: 'sid=' + sid } : {}, redirect: 'manual' });
      out[`${who} ${u}`] = { status: r.status, body: norm(await r.text()) };
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`captured ${Object.keys(out).length} views`);
})().catch((e) => { console.error(e); process.exit(1); });
