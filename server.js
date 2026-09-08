// discriminant.ly — zero-dependency Node 22 server (node:sqlite + http + crypto)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
// The stylesheet is fingerprinted by content: a deploy changes the URL, so a
// browser can never serve a stale copy while the markup has moved on.
const assetHash = (rel) => {
  try {
    return crypto.createHash('sha1')
      .update(fs.readFileSync(path.join(__dirname, 'public', rel))).digest('hex').slice(0, 10);
  } catch { return String(Date.now()); }
};
const CSS_V = assetHash('style.css');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'discriminantly.db');
const SECURE = process.env.NODE_ENV === 'production';

// ---------- database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, handle TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, city TEXT DEFAULT '',
  bio TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY, from_user INTEGER REFERENCES users(id), used_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS objects (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL, maker TEXT DEFAULT '', origin TEXT DEFAULT '', material TEXT DEFAULT '',
  category TEXT DEFAULT '', tier TEXT DEFAULT '', url TEXT DEFAULT '', image TEXT DEFAULT '',
  why TEXT DEFAULT '', tags TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
-- Travel marks: places worth returning to. Distinct from notes (objects):
-- a mark has a location and accumulates visits over time.
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,            -- the place
  locality TEXT DEFAULT '',      -- city / region, shown under the name
  country TEXT DEFAULT '',
  address TEXT DEFAULT '',
  lat REAL, lng REAL,
  why TEXT DEFAULT '',           -- why it is worth remembering
  tags TEXT DEFAULT '', url TEXT DEFAULT '', image TEXT DEFAULT '',
  private INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY, mark_id INTEGER NOT NULL REFERENCES marks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visited_on TEXT NOT NULL,      -- YYYY-MM-DD, the day itself rather than when it was logged
  body TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mark_collections (
  mark_id INTEGER NOT NULL REFERENCES marks(id) ON DELETE CASCADE,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (mark_id, collection_id));
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (follower_id, followee_id));
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY, object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, name));
CREATE TABLE IF NOT EXISTS object_collections (
  object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY (object_id, collection_id));
CREATE TABLE IF NOT EXISTS notes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  why TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, object_id));
`);
// ---------- migrations ----------
// Every schema change lives here, runs once, and is recorded. Nothing is ever
// dropped or rewritten: migrations only add. The file on the volume is the
// source of truth, so a deploy changes code, never data.
db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

const hasColumn = (table, col) => {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col); }
  catch { return false; }
};
const addColumn = (table, col, decl) => () => { if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); };

// Append only. Never edit or renumber an entry that has shipped.
const MIGRATIONS = [
  ['001-objects-tags',     addColumn('objects', 'tags', "TEXT DEFAULT ''")],
  ['002-users-api-token',  addColumn('users', 'api_token', 'TEXT')],
  ['003-users-avatar',     addColumn('users', 'avatar', "TEXT DEFAULT ''")],
  ['004-users-site',       addColumn('users', 'site', "TEXT DEFAULT ''")],
  ['005-objects-private',  addColumn('objects', 'private', 'INTEGER DEFAULT 0')],
  ['006-visits-rating',    addColumn('visits', 'rating', 'INTEGER')],
  // Notes and travel marks keep separate collections. Rebuilds the table so the
  // uniqueness is per kind, and splits any collection currently used by both.
  ['008-collection-kinds', () => {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN');
    db.exec(`CREATE TABLE collections_new (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, name, kind))`);
    db.exec(`INSERT INTO collections_new(id, user_id, name, kind, created_at)
      SELECT c.id, c.user_id, c.name,
        CASE WHEN EXISTS(SELECT 1 FROM mark_collections mc WHERE mc.collection_id = c.id)
              AND NOT EXISTS(SELECT 1 FROM object_collections oc WHERE oc.collection_id = c.id)
             THEN 'mark' ELSE 'note' END,
        c.created_at FROM collections c`);
    // a collection used by both becomes two: the notes keep the original, the marks get a copy
    const shared = db.prepare(`SELECT c.id, c.user_id, c.name FROM collections c
      WHERE EXISTS(SELECT 1 FROM mark_collections mc WHERE mc.collection_id = c.id)
        AND EXISTS(SELECT 1 FROM object_collections oc WHERE oc.collection_id = c.id)`).all();
    for (const c of shared) {
      const r = db.prepare(`INSERT INTO collections_new(user_id, name, kind) VALUES(?,?,'mark')`).run(c.user_id, c.name);
      db.prepare('UPDATE mark_collections SET collection_id=? WHERE collection_id=?').run(r.lastInsertRowid, c.id);
    }
    db.exec('DROP TABLE collections');
    db.exec('ALTER TABLE collections_new RENAME TO collections');
    db.exec('COMMIT');
    db.exec('PRAGMA foreign_keys=ON');
  }, { ownTransaction: true }],
  ['009-images', () => db.exec(`CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)],
  ['007-mark-comments',    () => db.exec(`CREATE TABLE IF NOT EXISTS mark_comments (
      id INTEGER PRIMARY KEY, mark_id INTEGER NOT NULL REFERENCES marks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP)`)],
  ['010-marks-verified',   addColumn('marks', 'verified', 'INTEGER DEFAULT 0')],

  // ---- v1.11 foundation ----------------------------------------------------
  // UIDs identify the durable thing; provenance records the durable history of
  // what happened to it. Integer ids stay as internal join keys and as the
  // human-facing short form in URLs — uids are for export, provenance
  // references, and anything outside this database.
  ['011-entity-uids', () => {
    // A UUIDv4 built in pure SQL, so the trigger below needs no JS.
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    for (const t of ['users', 'objects', 'marks', 'visits', 'collections']) {
      if (!hasColumn(t, 'uid')) db.exec(`ALTER TABLE ${t} ADD COLUMN uid TEXT`);
      // SQLite cannot add a UNIQUE column, so: add nullable, backfill, then index.
      for (const r of db.prepare(`SELECT id FROM ${t} WHERE uid IS NULL OR uid=''`).all()) {
        db.prepare(`UPDATE ${t} SET uid=? WHERE id=?`).run(crypto.randomUUID(), r.id);
      }
      // A trigger rather than instrumenting every INSERT: the invariant then
      // holds for seed data, migrations, and any future write path that forgets.
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${t}_uid AFTER INSERT ON ${t}
        WHEN NEW.uid IS NULL OR NEW.uid = ''
        BEGIN UPDATE ${t} SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_uid ON ${t}(uid)`);
    }
  }],

  // An append-only log of assertions. Rows are never updated or deleted, so the
  // sequence of creation and material edits stays reconstructible. This is
  // parallel history — the entity tables still hold current state.
  ['012-provenance', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS provenance (
      id            INTEGER PRIMARY KEY,
      entity_type   TEXT NOT NULL,
      entity_uid    TEXT NOT NULL,
      action        TEXT NOT NULL,          -- created | edited | enriched | deleted
      assertion     TEXT NOT NULL,          -- explicit | observed | derived | inferred | unknown
      actor_type    TEXT NOT NULL,          -- user | ai_on_behalf | system | unknown
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      agent         TEXT NOT NULL,          -- web | mcp:claude | migration | legacy
      auth_method   TEXT,                   -- session | mcp_token | system | unknown
      source_kind   TEXT,                   -- manual | unfurl | photon | remark
      source_ref    TEXT,
      fields        TEXT,
      created_at    TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_prov_entity ON provenance(entity_type, entity_uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_prov_actor ON provenance(actor_user_id)');

    // Legacy backfill. We cannot know whether these were created by the member,
    // by an AI through MCP, or by seeding — so we record 'unknown' rather than
    // inventing an actor. Timestamps are copied so ordering stays truthful.
    for (const [type, table] of [['object', 'objects'], ['mark', 'marks'],
                                 ['visit', 'visits'], ['collection', 'collections']]) {
      for (const r of db.prepare(`SELECT uid, user_id, created_at FROM ${table}`).all()) {
        db.prepare(`INSERT INTO provenance
          (entity_type, entity_uid, action, assertion, actor_type, actor_user_id,
           agent, auth_method, source_kind, created_at)
          VALUES (?,?,'created','unknown','unknown',?,'legacy','unknown',NULL,?)`)
          .run(type, r.uid, r.user_id ?? null, r.created_at);
      }
    }
  }],

  // The derived layer. Created empty and stays empty in v1.11 — nothing is
  // inferred yet. Its existence is the point: when derivation arrives it has a
  // home that carries confidence and cites its evidence, so it can never be
  // mistaken for something the member asserted. Dropping this table must never
  // lose anything that cannot be recomputed.
  ['013-derived-relations', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS derived_relations (
      id           INTEGER PRIMARY KEY,
      subject_type TEXT NOT NULL, subject_uid TEXT NOT NULL,
      predicate    TEXT NOT NULL,
      object_type  TEXT NOT NULL, object_uid  TEXT NOT NULL,
      assertion    TEXT NOT NULL,        -- derived | inferred
      confidence   REAL,
      method       TEXT,
      evidence     TEXT,                 -- JSON array of the evidence uids used
      computed_at  TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_derived_subject ON derived_relations(subject_type, subject_uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_derived_object ON derived_relations(object_type, object_uid)');
  }],

  // marks.verified previously meant "coordinates were supplied", which is not
  // the same claim as "checked against mapping data". The column keeps its
  // values untouched; what changes is that a verification claim now requires a
  // provenance row naming what was actually checked. Legacy rows say 'unknown'
  // because the evidence does not establish that Photon was ever consulted.
  // Re-marking. A user encountered another user's Mark and deliberately created
  // their own from it. The new Mark is wholly theirs — this is adoption of
  // judgment, not shared ownership. The lineage is kept twice on purpose: this
  // column answers "where did this come from", the provenance row answers
  // "when and how did that happen".
  //
  // What this records is precise: THIS USER'S JUDGMENT WAS USEFUL ENOUGH TO
  // THAT USER THAT THEY ADOPTED THE MARK. It is not a claim of similar taste.
  // Any such inference belongs in derived_relations, citing this evidence.
  ['014-verification-semantics', () => {
    for (const r of db.prepare('SELECT uid, user_id, created_at FROM marks WHERE verified=1').all()) {
      db.prepare(`INSERT INTO provenance
        (entity_type, entity_uid, action, assertion, actor_type, actor_user_id,
         agent, auth_method, source_kind, source_ref, created_at)
        VALUES ('mark',?,'enriched','unknown','unknown',?,'legacy','unknown','unknown',NULL,?)`)
        .run(r.uid, r.user_id ?? null, r.created_at);
    }
  }],
  ['015-remark-lineage', () => {
    if (!hasColumn('marks', 'remarked_from_uid')) db.exec('ALTER TABLE marks ADD COLUMN remarked_from_uid TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_marks_remarked_from ON marks(remarked_from_uid)');
  }],

  // Scope is recorded but not enforced in v1.11. Its presence is what allows
  // Retrieve/Interpret/Propose/Execute to be separated later without reissuing
  // every existing connector URL.
  ['016-token-scope', addColumn('users', 'api_token_scope', "TEXT DEFAULT 'full'")],

  // Comments and follows are canonical evidence but were never given a uid —
  // they only have an integer id (comments) or no id at all (follows, a
  // composite-key join table). Provenance needs entity_uid, so this extends
  // the exact mechanism 011 established to three more tables. Not a redesign
  // of comments or follows: no new fields, no new capability, same pattern.
  ['017-secondary-uids', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    for (const t of ['comments', 'mark_comments', 'follows']) {
      if (!hasColumn(t, 'uid')) db.exec(`ALTER TABLE ${t} ADD COLUMN uid TEXT`);
      // Explicit alias: on a table with `id INTEGER PRIMARY KEY`, id is a
      // rowid alias, and SELECT rowid otherwise comes back keyed as "id" —
      // aliasing it to _rid makes the property name predictable either way.
      for (const r of db.prepare(`SELECT rowid AS _rid FROM ${t} WHERE uid IS NULL OR uid=''`).all()) {
        db.prepare(`UPDATE ${t} SET uid=? WHERE rowid=?`).run(crypto.randomUUID(), r._rid);
      }
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${t}_uid AFTER INSERT ON ${t}
        WHEN NEW.uid IS NULL OR NEW.uid = ''
        BEGIN UPDATE ${t} SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_uid ON ${t}(uid)`);
    }
  }],

  // Images predate the v1.11 foundation and were out of scope for 011/017.
  // Same mechanism, same reasoning: a stable uid is required before an image
  // can carry provenance, and every other entity in the evidence graph has one.
  ['018-image-uids', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    if (!hasColumn('images', 'uid')) db.exec('ALTER TABLE images ADD COLUMN uid TEXT');
    for (const r of db.prepare("SELECT rowid AS _rid FROM images WHERE uid IS NULL OR uid=''").all()) {
      db.prepare('UPDATE images SET uid=? WHERE rowid=?').run(crypto.randomUUID(), r._rid);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_images_uid AFTER INSERT ON images
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE images SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_images_uid ON images(uid)');
  }],

];

function backupTo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);   // a consistent snapshot, safe while running
  return file;
}

function runMigrations() {
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const pending = MIGRATIONS.filter(([id]) => !done.has(id));
  if (!pending.length) return;

  // Take a snapshot before touching the schema, so any change is reversible.
  // A fresh install has nothing to protect, so skip the noise.
  let hasData = false;
  try { hasData = db.prepare('SELECT COUNT(*) c FROM users').get().c > 0; } catch {}
  if (hasData) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { console.log(`Backed up to ${backupTo(path.join(path.dirname(DB_PATH), 'backups', `pre-migration-${stamp}.db`))}`); }
    catch (e) { console.error('Backup failed, refusing to migrate:', e.message); process.exit(1); }
  }
  for (const [id, fn, opts] of pending) {
    try {
      if (opts && opts.ownTransaction) {          // rebuilds toggle PRAGMAs, which a transaction forbids
        fn();
        db.prepare('INSERT INTO schema_migrations(id) VALUES(?)').run(id);
        console.log(`Migration applied: ${id}`);
        continue;
      }
      db.exec('BEGIN');
      fn();
      db.prepare('INSERT INTO schema_migrations(id) VALUES(?)').run(id);
      db.exec('COMMIT');
      console.log(`Migration applied: ${id}`);
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`Migration ${id} failed, nothing was changed:`, e.message);
      process.exit(1);
    }
  }
}
runMigrations();

// `node server.js --backup [file]` for an on-demand snapshot
if (process.argv.includes('--backup')) {
  const target = process.argv[process.argv.indexOf('--backup') + 1]
    || path.join(path.dirname(DB_PATH), 'backups', `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  console.log(`Wrote ${backupTo(target)}`);
  process.exit(0);
}
const q = (sql) => db.prepare(sql);
const avatar = (u, cls = 'avatar') => u.avatar ? `<img class="${cls}" src="${esc(u.avatar)}" alt="">` : `<span class="${cls} avatar-initial">${esc((u.handle || '?')[0].toUpperCase())}</span>`;
const stackDate = (t) => { const d = new Date(t + 'Z'); return `<time class="stackdate" datetime="${t}"><span class="mon">${d.toLocaleDateString('en-CA', { month: 'short' })}</span><span class="day">${d.getDate()}</span><span class="yr">${d.getFullYear()}</span></time>`; };
function setCollections(userId, objectId, names) {
  q('DELETE FROM object_collections WHERE object_id=?').run(objectId);
  for (const n of [...new Set(names.map((x) => String(x).trim()).filter(Boolean))]) {
    q("INSERT OR IGNORE INTO collections(user_id,name,kind) VALUES(?,?,'note')").run(userId, n);
    const c = q("SELECT id FROM collections WHERE user_id=? AND name=? AND kind='note'").get(userId, n);
    q('INSERT OR IGNORE INTO object_collections(object_id,collection_id) VALUES(?,?)').run(objectId, c.id);
  }
}
const followCounts = (id) => ({ followers: q('SELECT COUNT(*) c FROM follows WHERE followee_id=?').get(id).c, following: q('SELECT COUNT(*) c FROM follows WHERE follower_id=?').get(id).c });
const isFollowing = (a, b) => !!q('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(a, b);
const objCollections = (objectId) => q('SELECT c.id, c.name FROM object_collections oc JOIN collections c ON c.id=oc.collection_id WHERE oc.object_id=? ORDER BY c.name').all(objectId);
const canSee = (o, me) => !o.private || (me && (me.id === o.user_id || me.is_admin));
const tagList = (t) => String(t || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

const CATEGORIES_UNUSED = ['Table', 'Kitchen', 'Wardrobe', 'Study', 'Workshop', 'Outdoors', 'Travel', 'Home', 'Timepieces & jewellery', 'Other'];
const TIERS = ['Under $100', '$100–500', '$500–2,000', '$2,000–10,000', '$10,000 and up'];

// ---------- helpers ----------
// ---- provenance ------------------------------------------------------------
// Append-only. Every create and material edit adds a row; nothing is ever
// updated or deleted, so the sequence of assertions stays reconstructible.
//
// The actor is derived from HOW the request authenticated, never passed by the
// caller — a route cannot accidentally (or deliberately) misattribute a write.
// `ctx` comes from actorFor(): a session cookie yields a user, an MCP token
// yields ai_on_behalf.
function recordProvenance(entity_type, entity_uid, action, ctx, extra = {}) {
  if (!entity_uid) return;                       // nothing to attach history to
  q(`INSERT INTO provenance
      (entity_type, entity_uid, action, assertion, actor_type, actor_user_id,
       agent, auth_method, source_kind, source_ref, fields)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(entity_type, entity_uid, action,
         extra.assertion || ctx.assertion || 'explicit',
         ctx.actor_type, ctx.actor_user_id ?? null, ctx.agent, ctx.auth_method,
         extra.source_kind || null, extra.source_ref || null,
         extra.fields ? (Array.isArray(extra.fields) ? extra.fields.join(',') : extra.fields) : null);
}
// The web surface: a signed-in member acting directly.
const webActor = (me) => ({ actor_type: 'user', actor_user_id: me ? me.id : null,
  agent: 'web', auth_method: 'session', assertion: 'explicit' });
// The MCP surface: an AI acting on the member's behalf. Canonical evidence —
// something really did happen — but attributed so it can never be mistaken for
// the member typing it themselves.
const mcpActor = (user) => ({ actor_type: 'ai_on_behalf', actor_user_id: user.id,
  agent: 'mcp:claude', auth_method: 'mcp_token', assertion: 'explicit' });
// A system process contributing information from an external source.
const systemActor = (me) => ({ actor_type: 'system', actor_user_id: me ? me.id : null,
  agent: 'system', auth_method: 'system', assertion: 'derived' });
// The most recent assertion about an entity, so an AI consuming a tool result
// can say how the record came to exist rather than guessing.
function provenanceOf(entity_type, entity_uid) {
  if (!entity_uid) return null;
  const r = q(`SELECT action, assertion, actor_type, agent, created_at FROM provenance
    WHERE entity_type=? AND entity_uid=? ORDER BY id DESC LIMIT 1`).get(entity_type, entity_uid);
  return r || null;
}
const uidOf = (table, id) => { const r = q(`SELECT uid FROM ${table} WHERE rowid=?`).get(id); return r ? r.uid : null; };
// Rejects strings that merely look like YYYY-MM-DD but aren't a real calendar
// date (2026-02-30, month 13, non-leap Feb 29). Date's own constructor is too
// forgiving for this — it silently rolls 2026-02-30 into March 2 — so validity
// is checked by round-tripping through Date.UTC and comparing every field.
function isValidCalendarDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const acc = (id) => 'Nº ' + String(id).padStart(4, '0');
const hashPass = (p) => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(p, s, 32).toString('hex'); };
const checkPass = (p, h) => { const [s, k] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(k, 'hex'), crypto.scryptSync(p, s, 32)); };
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'member';

function currentUser(req) {
  const t = cookies(req).sid; if (!t) return null;
  return q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t) || null;
}
function readBody(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 8e6) req.destroy(); }); req.on('end', () => res(Object.fromEntries(new URLSearchParams(b)))); });
}
function readBodyMulti(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 8e6) req.destroy(); }); req.on('end', () => { const p = new URLSearchParams(b); const o = Object.fromEntries(p); o.coll = p.getAll('coll'); res(o); }); });
}
function send(res, html, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(html);
}
function redirect(res, to, extra = {}) { res.writeHead(303, { Location: to, ...extra }); res.end(); }
function json(res, data) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data, null, 2)); }
const timeAgo = (t) => {
  const then = new Date(t + 'Z'), mins = (Date.now() - then) / 6e4;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`;          // up to a week
  const sameYear = then.getFullYear() === new Date().getFullYear();
  return then.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
};

// ---------- templates ----------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 3.2 3.9 11.1V20.8h16.2V11.1zM9.7 20.8v-6.9h4.6v6.9z"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="19" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2.2c2.35 0 4.15 2.2 4.15 5.05S14.35 12.3 12 12.3 7.85 10.1 7.85 7.25 9.65 2.2 12 2.2z"/><path fill="currentColor" d="M12 13.4c3.4 0 6.1 2.05 6.1 4.6v3.4H5.9v-3.4c0-2.55 2.7-4.6 6.1-4.6z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M22.77 9.77 L22.77 14.23 L20.36 14.01 L19.33 16.49 L21.19 18.04 L18.04 21.19 L16.49 19.33 L14.01 20.36 L14.23 22.77 L9.77 22.77 L9.99 20.36 L7.51 19.33 L5.96 21.19 L2.81 18.04 L4.67 16.49 L3.64 14.01 L1.23 14.23 L1.23 9.77 L3.64 9.99 L4.67 7.51 L2.81 5.96 L5.96 2.81 L7.51 4.67 L9.99 3.64 L9.77 1.23 L14.23 1.23 L14.01 3.64 L16.49 4.67 L18.04 2.81 L21.19 5.96 L19.33 7.51 L20.36 9.99 Z M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="10" height="23" aria-hidden="true"><circle cx="12" cy="5.4" r="4.4" fill="currentColor"/><path fill="currentColor" d="M10.6 9.2h2.8v13.4l-1.4 1.4-1.4-1.4z"/><path fill="currentColor" d="M13.4 13.4h4v2.2h-4zM13.4 17.4h3v2.2h-3z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 4.5 16.5 12 9 19.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  compose: '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.3v9.4M7.3 12h9.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="17" height="19" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 17.5V21M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lens: '<svg viewBox="0 0 44 48" width="44" height="48" aria-hidden="true"><defs><linearGradient id="glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><circle cx="18" cy="17" r="12.6" fill="url(%23glare)"/><circle cx="18" cy="17" r="12.6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M26.9 26.2 29.4 28.7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="31.4" cy="31" r="2.3" fill="currentColor"/><circle cx="31.8" cy="36.4" r="1.7" fill="currentColor"/><circle cx="32" cy="41.4" r="1.3" fill="currentColor"/></svg>',
};

function layout({ title, body, me, flash, cls = '', nav = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<script>
/* Saved to the home screen, iOS draws the page under the status bar and the
   island. Flag that case so the fixed bar can reserve the safe area. Runs
   before paint, so the bar is never briefly the wrong height. */
(function () {
  var standalone = window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
  if (standalone) document.documentElement.className += ' is-app';
})();
</script>
<script>
// Registered mainly so Chrome's installability check sees a fetch handler —
// see /sw.js for why. Deferred to load so it never competes with paint.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}
// Captured globally (not only on /settings) because Chrome can fire this on
// any eligible page, and the member might land on Settings afterward rather
// than on the page where it actually fired.
window.__installPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__installPrompt = e;
  document.dispatchEvent(new Event('discriminantly:install-available'));
});
window.addEventListener('appinstalled', function () {
  window.__installPrompt = null;
  document.dispatchEvent(new Event('discriminantly:installed'));
});
</script>
<title>${esc(title ? title + ' — discriminant.ly' : 'discriminant.ly')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://use.typekit.net/fbk5zyg.css">
<link href="https://fonts.googleapis.com/css2?family=Rokkitt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" type="image/png" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" sizes="192x192" href="/icon-192.png">
<link rel="icon" sizes="512x512" href="/icon-512.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Discriminantly">
<meta name="theme-color" content="#262727"><link rel="stylesheet" href="/style.css?v=${CSS_V}"></head><body class="${cls}${me ? ' is-in' : ''}">
${me ? `<nav class="iconrail" aria-label="Main">
  <a href="/" title="Home" class="${nav === 'home' ? 'on' : ''}">${ICONS.home}</a>
  <a href="/u/${esc(me.handle)}" title="Your profile" class="${nav === 'profile' ? 'on' : ''}">${ICONS.person}</a>
  <a href="/settings" title="Account settings" class="${nav === 'settings' ? 'on' : ''}">${ICONS.gear}</a>
  <a class="iconrail-btn iconrail-compose" id="compose-btn" href="/new" title="Post a note or travel mark">${ICONS.lens}</a>
</nav>
<div class="searchbar" id="searchbar"><div class="wrap"><form method="get" action="/"><input type="search" name="q" placeholder="Search discriminant.ly" aria-label="Search discriminant.ly" id="searchinput" autocapitalize="sentences"></form></div></div>
<script>
(function () {
  var si = document.getElementById('searchinput'), sb = document.getElementById('searchbar');
  if (!si) return;
  var ph = si.getAttribute('placeholder');
  si.addEventListener('focus', function () { si.setAttribute('placeholder', ''); sb.classList.add('is-active'); });
  si.addEventListener('blur', function () { if (!si.value) { si.setAttribute('placeholder', ph); sb.classList.remove('is-active'); } });
})();
</script>
<div class="curtain" id="curtain">
  <div class="curtain-frame"><div class="curtain-body">
    <div class="seg-panels">
      <div class="seg-panel is-on" data-kind="note">${noteForm(me, {}, { idp: 'ct', compact: true, seg: true })}</div>
      <div class="seg-panel" data-kind="mark">${markForm(me, {}, { idp: 'ctm', seg: true })}</div>
    </div>
  </div></div>
  <div class="curtain-tail" aria-hidden="true"><span class="tail-band"></span><span class="tail-bridge"></span><span class="tail-edge"></span></div>
  <button class="curtain-nub" id="curtain-nub" aria-expanded="false" aria-controls="curtain">
    <span class="nub-label">Create a<br>new note</span>
    <span class="nub-icon">${ICONS.lens}</span>
  </button>
</div>
<script>

// Downscale in the browser before upload: a phone photo is 4000px and several
// megabytes, which is wasteful to store and slow to send.
function readImage(file, cb) {
  if (!file || file.type.indexOf('image/') !== 0) return;
  var r = new FileReader();
  r.onload = function () {
    var img = new Image();
    img.onload = function () {
      var MAX = 1600, w = img.width, h = img.height;
      if (Math.max(w, h) > MAX) { var k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = function () { cb(r.result); };   // svg and the like pass through
    img.src = r.result;
  };
  r.readAsDataURL(file);
}
(function () {
  var c = document.getElementById('curtain'), nub = document.getElementById('curtain-nub');
  if (!c) return;
  function open() { c.classList.add('is-open'); nub.setAttribute('aria-expanded', 'true'); }
  function close() { c.classList.remove('is-open'); nub.setAttribute('aria-expanded', 'false'); }
  nub.addEventListener('click', function () { c.classList.contains('is-open') ? close() : open(); });
  c.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });

  // Any page can raise the confirm curtain: title, copy, button label, an
  // optional text field, and the form action it posts to.
  // The rail's compose control opens the curtain where there is one, and
  // otherwise just follows through to the form page.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#compose-btn');
    if (!t) return;
    var c = document.getElementById('curtain');
    if (!c || getComputedStyle(c).display === 'none') return;   // mobile: let the link work
    e.preventDefault();
    c.classList.add('is-open');
    var f = c.querySelector('.seg-panel.is-on input[name="url"], .seg-panel.is-on input[name="name"]');
    if (f) setTimeout(function () { f.focus(); }, 380);
  });

  // Tile the feed into real column elements rather than CSS multi-column.
  // Safari paints fragmentation seams at column boundaries — a stray rule above
  // the first card in the second column — and real columns cannot do that.
  window.layoutFeed = function () {
    document.querySelectorAll('.grid, .activity-feed').forEach(function (grid) {
      if (!grid.__items) grid.__items = [];
      // gather anything not already parked in a column
      [].slice.call(grid.children).forEach(function (child) {
        if (!child.classList.contains('feed-col')) grid.__items.push(child);
        else [].slice.call(child.children).forEach(function (g) { if (grid.__items.indexOf(g) < 0) grid.__items.push(g); });
      });
      var MIN = 480, GAP = 32;
      var n = Math.max(1, Math.floor((grid.clientWidth + GAP) / (MIN + GAP)));
      if (grid.__cols === n && grid.__built) {
        // same shape: just place any newly added items
        var cols = grid.querySelectorAll('.feed-col');
        grid.__items.forEach(function (it) {
          if (it.parentNode && it.parentNode.classList.contains('feed-col')) return;
          var shortest = cols[0];
          for (var i = 1; i < cols.length; i++) if (cols[i].offsetHeight < shortest.offsetHeight) shortest = cols[i];
          shortest.appendChild(it);
        });
        return;
      }
      grid.__cols = n; grid.__built = true;
      grid.innerHTML = '';
      grid.style.display = 'flex';
      grid.style.alignItems = 'flex-start';
      grid.style.gap = GAP + 'px';
      var cols = [];
      for (var i = 0; i < n; i++) {
        var c = document.createElement('div');
        c.className = 'feed-col';
        c.style.flex = '1 1 0'; c.style.minWidth = '0';
        grid.appendChild(c); cols.push(c);
      }
      grid.__items.forEach(function (it, i) {
        if (n === 1) { cols[0].appendChild(it); return; }
        var shortest = cols[0];
        for (var k = 1; k < cols.length; k++) if (cols[k].offsetHeight < shortest.offsetHeight) shortest = cols[k];
        shortest.appendChild(it);
      });
    });
  };
  // the grid is further down the page than this script, so wait for parse
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { layoutFeed(); });
  else layoutFeed();
  var relayoutTimer;
  window.addEventListener('resize', function () {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(function () {
      document.querySelectorAll('.grid, .activity-feed').forEach(function (g) { g.__built = false; });
      layoutFeed();
    }, 150);
  });

  window.askConfirm = function (opts) {
    var dlg = document.getElementById('confirm-dialog');
    if (!dlg) return;
    dlg.querySelector('.dlg-title').textContent = opts.title || 'Are you sure?';
    dlg.querySelector('.dlg-copy').innerHTML = opts.copy || '';
    dlg.querySelector('.nf-post').textContent = opts.cta || 'Confirm';
    dlg.querySelector('[data-dismiss]').textContent = opts.dismiss || 'Cancel';
    dlg.querySelector('form').action = opts.action || '';
    var fld = dlg.querySelector('.dlg-input');
    if (fld) { fld.hidden = !opts.field; fld.value = opts.value || ''; if (opts.field) fld.setAttribute('placeholder', opts.field); }
    dlg.classList.add('is-open');
  };
  document.addEventListener('DOMContentLoaded', function () {
    var cdlg = document.getElementById('confirm-dialog');
    if (!cdlg) return;
    cdlg.querySelectorAll('[data-dismiss]').forEach(function (x) {
      x.addEventListener('click', function () { cdlg.classList.remove('is-open'); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cdlg.classList.remove('is-open'); });
  });

  // Show more: fetch the next page and append it, so the feed never reloads.
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('.more-link');
    if (!link || link.dataset.busy) return;
    e.preventDefault();
    link.dataset.busy = '1';
    var was = link.textContent; link.textContent = 'Loading…';
    fetch(link.href, { headers: { 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var grid = document.getElementById('feed-grid');
        var next = doc.getElementById('feed-grid');
        if (!grid || !next) { location.href = link.href; return; }

        var existing = grid.__items ? grid.__items.length : grid.children.length;
        Array.prototype.slice.call(next.children, existing).forEach(function (n) { grid.appendChild(n); });
        if (window.layoutFeed) window.layoutFeed();
        var nextMore = doc.querySelector('.more-link');
        var wrap = link.parentNode;
        if (nextMore) { link.href = nextMore.getAttribute('href'); link.textContent = was; delete link.dataset.busy; }
        else wrap.remove();
        history.replaceState(null, '', link.href);
      })
      .catch(function () { location.href = link.href; });
  });

  // Delete from an edit page
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.nf-del');
    if (!t) return;
    window.askConfirm({ title: 'Delete ' + t.dataset.kind, cta: 'Delete ' + t.dataset.kind,
      action: t.dataset.del,
      copy: 'Delete <b>' + t.dataset.title + '</b>? This cannot be undone.' });
  });

  // Check in asks first, and takes an optional line about the visit
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-checkin]');
    if (!t) return;
    window.askConfirm({ title: 'Check in', cta: 'Log this visit', dismiss: 'Cancel',
      action: t.dataset.checkin, copy: 'Log today as a visit to <b>' + t.dataset.place + '</b>.',
      field: 'A LINE ABOUT THIS VISIT (OPTIONAL)' });
  });

  // Feed-card maps don't load until asked for. They're non-interactive here
  // regardless (pointer-events: none — the real, pannable map lives on the
  // mark's own page), so nothing is lost by not paying for an OpenStreetMap
  // embed load — a full HTML/CSS/JS page per card — until someone actually
  // wants to see it.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-map-src]');
    if (!t || t.querySelector('iframe')) return;
    var f = document.createElement('iframe');
    f.src = t.dataset.mapSrc; f.title = t.dataset.mapTitle || 'Map'; f.loading = 'lazy';
    t.replaceChildren(f);
  });

  // Note / Travel Mark: swap the panel, easing the height so nothing jumps.
  // Delegated, so it serves the curtain and the post page alike.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.seg-btn');
    if (!btn) return;
    var panels = btn.closest('.seg-panels');
    if (!panels) return;
    var kind = btn.dataset.seg;
    var from = panels.querySelector('.seg-panel.is-on');
    var to = panels.querySelector('.seg-panel[data-kind="' + kind + '"]');
    if (!to || from === to) return;
    panels.style.height = from.offsetHeight + 'px';
    from.classList.remove('is-on'); to.classList.add('is-on');
    panels.querySelectorAll('.seg-btn').forEach(function (x) {
      var on = x.dataset.seg === kind;
      x.classList.toggle('on', on); x.setAttribute('aria-selected', on);
    });
    var target = to.offsetHeight;
    requestAnimationFrame(function () { panels.style.height = target + 'px'; });
    setTimeout(function () { panels.style.height = ''; }, 380);
  });

})();
</script>`
  : `<header class="masthead"><div class="wrap">
  <a class="mark" href="/welcome"><img src="/mark.png" alt="" width="17" height="23"><span>discriminant.ly</span></a>
  <form class="signin" method="post" action="/login"><input name="email" type="email" placeholder="email" required><input name="password" type="password" placeholder="password" required><button class="link caps">Sign in</button></form>
</div></header>`}
<script>
  // The fixed bar's height varies with font loading and device chrome, so
  // measure it rather than trusting a constant. Prevents both a dark gap under
  // the bar and content sliding beneath it.
  (function () {
    var bar = document.querySelector('.searchbar') || document.querySelector('.masthead');
    if (!bar) return;
    var syncBar = function () {
      var h = Math.round(bar.getBoundingClientRect().height);
      if (h) document.documentElement.style.setProperty('--bar-h', h + 'px');
    };
    syncBar();
    requestAnimationFrame(syncBar);          // after the first layout
    setTimeout(syncBar, 300);                // and once the safe-area insets settle
    window.addEventListener('resize', syncBar);
    window.addEventListener('orientationchange', syncBar);
    window.addEventListener('pageshow', syncBar);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncBar);
    if (window.ResizeObserver) new ResizeObserver(syncBar).observe(bar);
  })();

</script>
${me ? `<div class="curtain dialog" id="confirm-dialog">
  <div class="curtain-frame"><div class="curtain-body">
    <form method="post" action="">
      <div class="nf-box">
        <p class="dlg-title">Delete collection</p>
        <p class="dlg-copy">Delete “<span class="dlg-name"></span>”? The notes inside stay put — only the collection is removed.</p>
        <textarea class="nf-field dlg-input" name="body" rows="3" maxlength="600" hidden></textarea>
        <button class="nf-post">Delete collection</button>
        <div class="nf-foot"><span></span><button type="button" class="nf-link-btn" data-dismiss>Cancel</button></div>
      </div>
    </form>
  </div></div>
  <div class="curtain-tail"><span class="tail-band"></span></div>
</div>
<div class="curtain dialog" id="avatar-dialog">
  <div class="curtain-frame"><div class="curtain-body">
    <div class="nf-box">
      <p class="dlg-title">Profile photo</p>
      <p class="dlg-copy">Choose a photo, or drop one here. It is cropped to a circle and stored with your profile.</p>
      <div class="drop-zone" id="avatar-drop"><img id="avatar-preview" alt="" hidden><span class="drop-hint">Drag a photo here</span></div>
      <input type="file" id="avatar-file" accept="image/*" hidden>
      <button type="button" class="nf-post" id="avatar-choose">Choose a photo</button>
      <div class="nf-foot"><button type="button" class="nf-link-btn" id="avatar-apply">Use photo</button><button type="button" class="nf-link-btn" data-dismiss-avatar>Cancel</button></div>
    </div>
  </div></div>
  <div class="curtain-tail"><span class="tail-band"></span></div>
</div>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var dlg = document.getElementById('avatar-dialog'), pick = document.getElementById('avatar-pick');
  if (!dlg || !pick) return;
  var file = document.getElementById('avatar-file'), drop = document.getElementById('avatar-drop'),
      prev = document.getElementById('avatar-preview'), url = document.getElementById('avatar-url'), data = '';
  function open() { dlg.classList.add('is-open'); } function close() { dlg.classList.remove('is-open'); }
  pick.addEventListener('click', function () { file.click(); });   // straight to the OS picker
  dlg.querySelectorAll('[data-dismiss-avatar]').forEach(function (b) { b.addEventListener('click', close); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  document.getElementById('avatar-choose').addEventListener('click', function () { file.click(); });
  file.addEventListener('change', function () { if (file.files[0]) load(file.files[0]); });
  ['dragenter','dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); }); });
  ['dragleave','drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); }); });
  drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) load(f); });
  drop.addEventListener('click', function () { file.click(); });
  function load(f) {
    if (f.type.indexOf('image/') !== 0) return;
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        open();
        // square centre-crop, downscaled, so the stored photo stays small
        var S = 320, cv = document.createElement('canvas'); cv.width = cv.height = S;
        var n = Math.min(img.width, img.height);
        cv.getContext('2d').drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, S, S);
        data = cv.toDataURL('image/jpeg', 0.86);
        prev.src = data; prev.hidden = false; drop.classList.add('has-image');
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }
  document.getElementById('avatar-apply').addEventListener('click', function () {
    if (data) { url.value = data; close(); url.form.submit(); }
  });
});
</script>` : ''}
${flash ? `<div class="flash"><div class="wrap">${esc(flash)}</div></div>` : ''}
<main class="wrap">${body}</main>
<script>
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('.share-mark');
  if (!b) return;
  var url = location.origin + b.dataset.share, title = b.dataset.title;
  if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); return; }
  navigator.clipboard.writeText(url).then(function () {
    var t = b.textContent; b.textContent = 'Link copied'; setTimeout(function () { b.textContent = t; }, 1600);
  });
});
</script>
</body></html>`;
}


// The note form card. Rendered on /new and /o/:id/edit, and inside the drop-down curtain.
// `idp` namespaces element ids so two copies can coexist on one page.
const segControl = (active) => `<div class="seg" role="tablist">
  <button type="button" class="seg-btn ${active === 'note' ? 'on' : ''}" data-seg="note" role="tab" aria-selected="${active === 'note'}">Note</button>
  <button type="button" class="seg-btn ${active === 'mark' ? 'on' : ''}" data-seg="mark" role="tab" aria-selected="${active === 'mark'}">Travel Mark</button>
</div>`;

function noteForm(me, o = {}, { err = '', picked = null, idp = 'pg', compact = false, seg = false } = {}) {
  const editing = !!o.id;
  const mine = q("SELECT id, name FROM collections WHERE user_id=? AND kind='note' ORDER BY name").all(me.id);
  const sel = new Set(picked ? picked : editing ? objCollections(o.id).map((c) => c.name) : []);
  const dropId = `img-drop-${idp}`, inputId = `img-input-${idp}`, prevId = `img-prev-${idp}`;
  return `
<form method="post" action="${editing ? `/o/${o.id}/edit` : '/new'}" class="nf${compact ? ' nf-compact' : ''}">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <div class="nf-box">
    <div class="nf-top"><span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${o.private ? 'checked' : ''}><span></span></label></div>
    ${seg ? segControl('note') : ''}
    <details class="nf-drop" id="drop-${idp}">
      <summary><span class="nf-drop-label">${sel.size ? esc([...sel].join(', ')) : 'Select a collection'}</span></summary>
      <div class="nf-drop-menu">
        ${mine.map((c) => `<label class="nf-opt"><input type="checkbox" name="coll" value="${esc(c.name)}" ${sel.has(c.name) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        <label class="nf-opt nf-opt-new"><span>+ New collection</span>
          <input class="nf-field" name="newcoll" placeholder="Name it" value=""></label>
      </div>
    </details>
    <div class="nf-lookup" id="unfurl-${idp}">
      <input class="nf-field" name="url" id="url-${idp}" type="url" autocomplete="off"
             placeholder="PASTE A LINK — FILLS THE FIELDS BELOW" value="${esc(o.url)}">
      <p class="lookup-note" id="unfurl-note-${idp}" hidden></p>
    </div>
    <div class="nf-image" id="${dropId}">
      <div class="img-pick" id="pick-${idp}" hidden>
        <button type="button" class="img-arrow" data-step="-1" aria-label="Previous image">‹</button>
        <span class="img-count" id="pick-count-${idp}"></span>
        <button type="button" class="img-arrow" data-step="1" aria-label="Next image">›</button>
      </div>
      <img class="nf-image-preview" id="${prevId}" src="${esc(o.image)}" alt="" ${o.image ? '' : 'hidden'}>
      <input class="nf-field" id="${inputId}" name="image" type="text" placeholder="TAP TO CHOOSE, OR DRAG AN IMAGE HERE" value="${esc(o.image)}" required>
    </div>
    <div class="nf-stack">
      <input class="nf-field" name="name" id="f-title-${idp}" placeholder="TITLE (REQUIRED)" required maxlength="120" value="${esc(o.name)}">
      <textarea class="nf-field" name="why" id="f-why-${idp}" rows="${compact ? 5 : 7}" maxlength="1000" placeholder="COMMENTS">${esc(o.why)}</textarea>
      <input class="nf-field" name="tags" placeholder="#HASHTAGS" value="${esc(o.tags)}">
    </div>
    <button class="nf-post">${editing ? 'Save note' : 'Post note'}</button>
    <div class="nf-foot">
      ${editing ? `<button type="button" class="nf-link-btn nf-del" data-del="/o/${o.id}/delete" data-kind="note" data-title="${esc(o.name)}">Delete</button>` : '<span></span>'}
      ${compact ? '<button type="button" class="nf-link-btn" data-close>Cancel</button>' : `<a class="nf-link-btn" href="${editing ? `/o/${o.id}` : '/'}">Cancel</a>`}
    </div>
  </div>
</form>
<script>
(function () {
  var drop = document.getElementById('${dropId}'), input = document.getElementById('${inputId}'), preview = document.getElementById('${prevId}');
  if (!drop) return;
  function refresh() { if (input.value) { preview.src = input.value; preview.hidden = false; drop.classList.add('has-image'); } else { preview.hidden = true; drop.classList.remove('has-image'); } }
  input.addEventListener('input', refresh);
  var pick = document.createElement('input');
  pick.type = 'file'; pick.accept = 'image/*'; pick.style.display = 'none';
  drop.appendChild(pick);
  drop.addEventListener('click', function (e) { if (e.target === input) return; pick.click(); });
  pick.addEventListener('change', function () { readImage(pick.files[0], function (d) { input.value = d; refresh(); }); });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); }); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    var dt = e.dataTransfer, file = dt.files && dt.files[0];
    if (file && file.type.indexOf('image/') === 0) { readImage(file, function (d) { input.value = d; refresh(); }); return; }
    var uri = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (uri) { input.value = uri.trim(); refresh(); }
  });
  // Flip through the images a page offered: arrows, swipe, or arrow keys.
  (function () {
    var strip = document.getElementById('pick-${idp}');
    if (!strip) return;
    var label = document.getElementById('pick-count-${idp}');
    var list = [], at = 0;
    var shot = document.getElementById('${prevId}');
    var reveal = function () { strip.hidden = !(list.length > 1 && shot && !shot.hidden && shot.naturalWidth > 0); };
    var show = function () {
      if (!list.length) { strip.hidden = true; return; }
      label.textContent = (at + 1) + ' / ' + list.length;
      input.value = list[at];
      refresh();
      strip.hidden = true;              // stay hidden until this one paints
      shot.addEventListener('load', reveal, { once: true });
      shot.addEventListener('error', function () { strip.hidden = true; }, { once: true });
      if (shot.complete && shot.naturalWidth > 0) reveal();
    };
    window.__picks = window.__picks || {};
    window.__picks['${idp}'] = function (pics, adopt) {
      list = pics; at = 0;
      label.textContent = '1 / ' + list.length;
      if (adopt) show(); else reveal();   // only reveal if a picture is already showing
    };
    var step = function (n) { if (!list.length) return; at = (at + n + list.length) % list.length; show(); };
    strip.addEventListener('click', function (e) {
      var btn = e.target.closest('.img-arrow'); if (!btn) return;
      e.preventDefault(); e.stopPropagation(); step(+btn.dataset.step);
    });
    // swipe across the box
    var x0 = null;
    drop.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    drop.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { e.preventDefault(); step(dx < 0 ? 1 : -1); }
    });
    // and with a pointer, for the desktop
    var px = null;
    drop.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse') px = e.clientX; });
    drop.addEventListener('pointerup', function (e) {
      if (px === null) return; var dx = e.clientX - px; px = null;
      if (Math.abs(dx) > 60) { e.preventDefault(); e.stopPropagation(); step(dx < 0 ? 1 : -1); }
    });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    });
  })();

  // Paste a link and the server reads the page's Open Graph tags. Only empty
  // fields are filled, so nothing you have already written is overwritten.
  var urlIn = document.getElementById('url-${idp}'), unote = document.getElementById('unfurl-note-${idp}');
  if (urlIn) {
    var lastTried = ${editing ? "urlIn.value.trim()" : "''"};   // editing: never refill from the link
    var tryUnfurl = function () {
      var v = urlIn.value.trim();
      var low = v.toLowerCase();
      if ((low.indexOf('http:') !== 0 && low.indexOf('https:') !== 0) || v === lastTried) return;
      lastTried = v;
      unote.hidden = false; unote.textContent = 'Reading the page…';
      fetch('/api/unfurl?url=' + encodeURIComponent(v))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) { unote.textContent = 'Could not read that page — fill the fields in yourself.'; return; }
          var t = document.getElementById('f-title-${idp}'), w = document.getElementById('f-why-${idp}');
          var filled = [];
          if (t && !t.value && d.title) { t.value = d.title; filled.push('title'); }
          if (w && !w.value && d.description) { w.value = d.description; filled.push('description'); }
          var pics = (d.images && d.images.length) ? d.images : (d.image ? [d.image] : []);
          if (pics.length && window.__picks && window.__picks['${idp}']) window.__picks['${idp}'](pics, !input.value);
          if (input && !input.value && d.image) { input.value = d.image; refresh(); filled.push('image'); }
          unote.textContent = filled.length ? 'Filled in the ' + filled.join(', ') + '. Edit as you like.'
                                            : 'Nothing new found on that page.';
        })
        .catch(function () { unote.textContent = 'Could not read that page — fill the fields in yourself.'; });
    };
    urlIn.addEventListener('change', tryUnfurl);
    urlIn.addEventListener('paste', function () { setTimeout(tryUnfurl, 60); });
    // iOS has no Cmd+V — pasting is only ever the long-press menu, and WebKit
    // has a history of firing 'paste' inconsistently for that path. 'input'
    // fires on every value change regardless of how the text arrived (typing,
    // any paste method, dictation), so it is the reliable fallback trigger.
    var inputTimer;
    urlIn.addEventListener('input', function () { clearTimeout(inputTimer); inputTimer = setTimeout(tryUnfurl, 500); });
    if (urlIn.value) setTimeout(tryUnfurl, 120);   // arrived pre-filled (e.g. the iOS Shortcut)
  }

  var det = document.getElementById('drop-${idp}');
  if (det) {
    var lbl = det.querySelector('.nf-drop-label');
    function syncLabel() {
      var on = [].slice.call(det.querySelectorAll('input[name=coll]:checked')).map(function (i) { return i.value; });
      lbl.textContent = on.length ? on.join(', ') : 'Select a collection';
    }
    det.addEventListener('change', syncLabel);
    document.addEventListener('click', function (e) { if (!det.contains(e.target)) det.removeAttribute('open'); });
    syncLabel();
  }
  refresh();
})();
</script>`;
}

function emptyState(me, kind, subject = null) {
  const own = !subject || (me && subject.id === me.id);
  const who = own ? null : esc(subject.handle);
  const lines = {
    notes: own ? ['You have not created any notes yet'] : [`${who} has not created any notes yet`],
    following: own ? ["Perhaps it's time you made some friends"] : [`Perhaps it's time ${who} made some friends`],
    followers: own ? ["Strangers are just friends you haven't met yet"] : [`Strangers are just friends ${who} hasn't met yet`],
    feed: own ? ['Where did all the activity go?', 'Must have been something I said']
              : ['Where did all the activity go?', `Must have been something ${who} said`],
    activity: own ? ['Where did all the activity go?', 'Must have been something I said']
                  : ['Where did all the activity go?', `Must have been something ${who} said`],
    tagged: ['Nothing noted under this tag yet'],
  }[kind] || ['Nothing here yet'];

  let suggest = '';
  if (own && (kind === 'notes' || kind === 'feed')) {
    const picks = q(OBJ_SQL + ' WHERE o.private=0' + (me ? ' AND o.user_id<>?' : '') + ' ORDER BY RANDOM() LIMIT 4').all(...(me ? [me.id] : []));
    if (picks.length) suggest = `<h3 class="lbl suggest-title">You might like</h3>
      <div class="grid">${picks.map((o) => objectCard(o, me)).join('')}</div>`;
  } else if (own && kind === 'following') {
    const picks = me ? q('SELECT * FROM users WHERE id<>? AND id NOT IN (SELECT followee_id FROM follows WHERE follower_id=?) ORDER BY RANDOM() LIMIT 5').all(me.id, me.id) : [];
    if (picks.length) suggest = `<h3 class="lbl suggest-title">You might like</h3>
      <ul class="people">${picks.map((p) => {
        const n = q('SELECT COUNT(*) c FROM objects WHERE user_id=? AND private=0').get(p.id).c;
        return `<li><a class="person" href="/u/${esc(p.handle)}">${avatar(p)}<span class="person-name">${esc(p.handle)}<em>${n} ${n === 1 ? 'note' : 'notes'}</em></span></a>
        <form method="post" action="/u/${esc(p.handle)}/follow"><button class="btn">Follow</button></form></li>`;
      }).join('')}</ul>`;
  }
  return `<div class="empty-state"><p class="empty-line">${lines.map((l) => `<span>${l}</span>`).join('')}</p></div>${suggest ? `<div class="empty-rule"></div>${suggest}` : ''}`;
}


// ---------- travel marks ----------
const MARK_SQL = 'SELECT m.*, u.handle, u.name uname, u.avatar FROM marks m JOIN users u ON u.id=m.user_id';
const markCollections = (id) => q('SELECT c.id, c.name FROM mark_collections mc JOIN collections c ON c.id=mc.collection_id WHERE mc.mark_id=? ORDER BY c.name').all(id);
const markVisits = (id) => q('SELECT v.*, u.handle FROM visits v JOIN users u ON u.id=v.user_id WHERE v.mark_id=? ORDER BY v.visited_on DESC, v.id DESC').all(id);
function setMarkCollections(userId, markId, names) {
  q('DELETE FROM mark_collections WHERE mark_id=?').run(markId);
  for (const n of [...new Set(names.map((x) => String(x).trim()).filter(Boolean))]) {
    q("INSERT OR IGNORE INTO collections(user_id,name,kind) VALUES(?,?,'mark')").run(userId, n);
    const c = q("SELECT id FROM collections WHERE user_id=? AND name=? AND kind='mark'").get(userId, n);
    q('INSERT OR IGNORE INTO mark_collections(mark_id,collection_id) VALUES(?,?)').run(markId, c.id);
  }
}
// A pasted https:// URL is kept as-is. A data: URL from the uploader is decoded
// and stored as bytes, so pages reference /i/<id> and the browser can cache it
// instead of re-downloading the picture inside every HTML response.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Only these four are accepted. SVG is deliberately excluded — it can carry
// script and is already excluded from unfurl image candidates for that reason.
const IMAGE_MIME_ALLOW = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// The declared mime is only ever a client-supplied string. Check the actual
// bytes start with the right signature before trusting it, since MCP exposes
// this to a wider input surface than a browser's own file picker.
function imageBytesMatchMime(bytes, mime) {
  const b = bytes;
  if (mime === 'image/png') return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/jpeg') return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/gif') return b.length >= 6 && b.toString('ascii', 0, 4) === 'GIF8';
  if (mime === 'image/webp') return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
// Every image gets exactly one 'created' provenance row, regardless of which
// of the five call sites reached it — actorCtx defaults to a web session, so
// the four existing web-form callers get provenance with no change on their
// part; the MCP upload tool passes mcpActor(user) explicitly.
function storeImage(userId, value, actorCtx) {
  const v = (value || '').trim();
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(v);
  if (!m) return v;                                  // not a data: URL — an external link passes through unchanged
  const mime = m[1].toLowerCase();
  if (!IMAGE_MIME_ALLOW.has(mime)) return '';
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return '';
  if (!imageBytesMatchMime(bytes, mime)) return '';   // declared type does not match the actual bytes
  const r = q('INSERT INTO images(user_id,mime,bytes) VALUES(?,?,?)').run(userId, mime, bytes);
  const uid = uidOf('images', r.lastInsertRowid);
  recordProvenance('image', uid, 'created', actorCtx || webActor({ id: userId }), { source_kind: 'manual' });
  return `/i/${r.lastInsertRowid}`;
}

// Feeds render a page at a time. The link works without JavaScript; with it,
// the next page is fetched and appended in place.
const PAGE = 25;
const pageOf = (rows, url) => {
  const off = Math.max(0, +url.searchParams.get('offset') || 0);
  return { off, slice: rows.slice(0, off + PAGE), more: rows.length > off + PAGE, total: rows.length };
};
const moreLink = (url, off, more) => {
  if (!more) return '';
  const sp = new URLSearchParams(url.search);
  sp.set('offset', String(off + PAGE));
  return `<div class="more"><a class="nf-post more-link" href="?${sp}">Show more</a></div>`;
};

// Structured data (schema.org via JSON-LD). Where a page has it, it's often
// more complete than Open Graph — full image galleries rather than one
// share-crop, and the literal product name/description rather than a blurb
// written for a social card. We read it when present and prefer it, but every
// site still gets a full answer from meta tags when it's absent.
function collectJsonLd(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }   // some sites ship invalid JSON-LD; skip rather than fail
    for (const item of Array.isArray(data) ? data : [data]) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item['@graph'])) nodes.push(...item['@graph']);
      else nodes.push(item);
    }
  }
  return nodes;
}
const ldTypeIs = (node, want) => {
  const t = node && node['@type'];
  return !!t && (Array.isArray(t) ? t : [t]).some((x) => String(x).toLowerCase() === want);
};
const ldImages = (val) => {
  const out = [];
  const add = (v) => { if (typeof v === 'string') out.push(v); else if (v && v.url) out.push(v.url); };
  (Array.isArray(val) ? val : [val]).forEach(add);
  return out;
};
const stripTags = (t) => String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Pull title, description and image out of a page's metadata.
function unfurl(html, base) {
  const head = html.split(/<\/head>/i)[0] || html;
  const metaTags = head.match(/<meta\b[^>]*>/gi) || [];
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'))
           || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
    return m ? m[1] : '';
  };
  const meta = (...names) => {
    for (const want of names) {
      for (const tag of metaTags) {
        const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
        if (key !== want) continue;
        const content = attr(tag, 'content').trim();
        if (content) return decodeEntities(content);
      }
    }
    return '';
  };
  const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  // Gather every image the page offers, best first, so the member can flip
  // through them rather than being handed whichever one came first.
  const candidates = [];
  const push = (v) => {
    if (!v) return;
    let abs; try { abs = new URL(v, base).href; } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    if (/\.svg($|\?)/i.test(abs)) return;             // logos and sprites, rarely the subject
    if (!candidates.includes(abs)) candidates.push(abs);
  };
  // Structured data first: a Product node's image array is usually the real
  // gallery, so it goes ahead of the single social-share image below.
  const ldNodes = collectJsonLd(html);
  const ldProduct = ldNodes.find((n) => ldTypeIs(n, 'product'));
  const ldItem = ldProduct || ldNodes.find((n) =>
    ['article', 'newsarticle', 'blogposting', 'recipe', 'event'].some((t) => ldTypeIs(n, t)));
  if (ldItem && ldItem.image) ldImages(ldItem.image).forEach(push);

  for (const tag of metaTags) {
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/.test(key)) push(attr(tag, 'content'));
  }
  const linkImg = head.match(/<link[^>]+rel\s*=\s*["']image_src["'][^>]*>/i);
  if (linkImg) push((linkImg[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1]);
  // then the body's own pictures, skipping obvious chrome
  for (const m2 of html.matchAll(/<img\b[^>]*>/gi)) {
    if (candidates.length >= 8) break;
    const tag = m2[0];
    if (/class\s*=\s*["'][^"']*(logo|icon|avatar|sprite|badge)/i.test(tag)) continue;
    push(attr(tag, 'src') || attr(tag, 'data-src'));
  }
  const ldTitle = ldItem && ldItem.name ? decodeEntities(stripTags(ldItem.name)) : '';
  let ldDesc = '';
  if (ldItem && ldItem.description) {
    ldDesc = decodeEntities(stripTags(ldItem.description));
    if (ldDesc.length > 600) ldDesc = ldDesc.slice(0, 599).replace(/\s+\S*$/, '') + '…';   // trim at a word, not mid-word
  }
  return {
    title: ldTitle || meta('og:title', 'twitter:title') || decodeEntities(titleTag.trim()),
    description: ldDesc || meta('og:description', 'twitter:description', 'description'),
    image: candidates[0] || '',
    images: candidates.slice(0, 8),
    site: meta('og:site_name') || base.hostname.replace(/^www\./, ''),
  };
}
const decodeEntities = (t) => t
  .replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|#39|nbsp|mdash|ndash|rsquo|lsquo|ldquo|rdquo);/gi, (m0, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
             rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' }[e.toLowerCase()] || m0;
  });

const placeLine = (m) => [m.locality, m.country].filter(Boolean).join(', ');
const mapLink = (m) => m.lat != null && m.lng != null
  ? `https://www.google.com/maps/search/?api=1&query=${m.lat},${m.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([m.name, m.address, placeLine(m)].filter(Boolean).join(' '))}`;
const mapEmbed = (m) => {
  if (m.lat == null || m.lng == null) return '';
  const d = 0.004, [la, ln] = [m.lat, m.lng];
  const bbox = [ln - d, la - d / 2, ln + d, la + d / 2].join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${la}%2C${ln}`;
};
// The place name set on concentric arcs, in the manner of an apothecary label.
// Type size stays constant; long names wrap onto further lines, each on a
// tighter radius than the one above so the block nests like a seal.
function arcTitle(text, id) {
  const SIZE = 29, EM = 0.53, W = 460, MAX_CHORD = 432;
  const TOP = SIZE * 0.88;                       // room for ascenders on the top line
  const width = (t) => t.length * SIZE * EM;

  // wrap on words to whatever fits the widest chord
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (width(next) > MAX_CHORD && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);

  const gap = SIZE * 1.34;                       // the ends of a wide arc dip, so lines need air
  const r0 = lines.length === 1 ? 175 : 138 + gap * (lines.length - 1);   // a single line curves gently
  const cy = TOP + r0;
  const paths = [], texts = [];
  let lowest = 0;
  lines.forEach((ln, i) => {
    const r = r0 - i * gap;                                  // each line sits inside the last
    const half = Math.min(width(ln) / (2 * r), Math.asin(Math.min(MAX_CHORD / 2 / r, 1)));
    const [x0, y0] = [W / 2 - r * Math.sin(half), cy - r * Math.cos(half)];
    const [x1, y1] = [W / 2 + r * Math.sin(half), cy - r * Math.cos(half)];
    paths.push(`<path id="arc-${id}-${i}" fill="none" d="M ${x0.toFixed(1)},${y0.toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}"/>`);
    texts.push(`<text><textPath href="#arc-${id}-${i}" startOffset="50%" text-anchor="middle">${esc(ln)}</textPath></text>`);
    lowest = Math.max(lowest, y0 + SIZE * 0.34);   // the arc's ends sit lower than its apex
  });
  return `<svg class="arc-title" viewBox="0 0 ${W} ${Math.ceil(lowest + 6)}" role="img" aria-label="${esc(text)}">
    <defs>${paths.join('')}</defs>
    <g font-size="${SIZE}">${texts.join('')}</g>
  </svg>`;
}

const prettyDay = (d) => {
  const dt = new Date(d + 'T00:00:00Z');
  return isNaN(dt) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// A mark card. Single column and centred, on paper rather than the note card's
// cool grey — a place should not read like an object.
function markCard(m, me, full = false) {
  const visits = markVisits(m.id);
  const tags = tagList(m.tags);
  const cs = markCollections(m.id);
  const embed = mapEmbed(m);
  return `<article class="note travelmark ${full ? 'note-full' : ''}">
  <div class="byline"><span class="byline-who"><a href="/u/${esc(m.handle)}">${avatar({ handle: m.handle, avatar: m.avatar })}</a>${stackDate(m.created_at)}</span>${me && me.id === m.user_id ? `<a class="card-edit" href="/m/${m.id}/edit">Edit</a>` : ''}</div>
  <div class="card">
    <div class="text">
      ${m.image ? `<a class="mark-photo" href="/m/${m.id}"><img src="${esc(m.image)}" alt="${esc(m.name)}"></a>` : ''}
      <p class="who"><a href="/u/${esc(m.handle)}">${esc(m.handle)}</a> ${m.private ? '<span class="who-private">privately marked</span>' : 'marked'}</p>
      ${cs.length ? `<p class="colls">${cs.map((c) => `<a href="/u/${esc(m.handle)}?tab=marks&c=${c.id}">${esc(c.name)}</a>`).join(' · ')}</p>` : ''}
      <h2 class="mark-title"><a href="/m/${m.id}">${arcTitle(m.name, m.id)}</a></h2>
      ${placeLine(m) ? `<p class="mark-where">${esc(placeLine(m))}</p>` : ''}
      ${m.address ? `<p class="mark-address">${esc(m.address)}</p>` : ''}
      ${m.why ? `<p class="body">${esc(m.why)}</p>` : ''}
      ${tags.length ? `<p class="tags">${tags.map((t) => `<a href="/?t=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(', ')}</p>` : ''}
      ${m.url ? `<p class="link"><span class="lbl">Link:</span> <a href="${esc(m.url)}" rel="noopener">${esc(m.url.length > 34 ? m.url.slice(0, 34) + '…' : m.url)}</a></p>` : ''}
      ${embed ? `${full
        ? `<div class="mark-map"><iframe src="${embed}" loading="lazy" title="Map of ${esc(m.name)}"></iframe></div>`
        : `<div class="mark-map" data-map-src="${esc(embed)}" data-map-title="Map of ${esc(m.name)}"><div class="mark-map-placeholder">Show map</div></div>`}
      <p class="map-credit">© OpenStreetMap contributors</p>` : ''}
      <div class="noteit mark-visits">
        <div class="mark-buttons">
          <a class="btn-note" href="${mapLink(m)}" rel="noopener">Directions</a>
          ${me && me.id === m.user_id ? `<button type="button" class="btn-note" data-checkin="/m/${m.id}/checkin" data-place="${esc(m.name)}">Check in</button>` : ''}
          ${me && me.id !== m.user_id ? `<form method="post" action="/m/${m.id}/remark"><button class="btn-note">Mark this</button></form>` : ''}
        </div>
      </div>
      <div class="mark-foot"><button type="button" class="nf-link-btn share-mark" data-share="/m/${m.id}" data-title="${esc(m.name)}">Share</button></div>
    </div>
  </div></article>`;
}

// The mark form, shared by /marks/new and /m/:id/edit.
function markForm(me, m = {}, { err = '', picked = null, idp = 'mk', seg = false } = {}) {
  const editing = !!m.id;
  const mine = q("SELECT id, name FROM collections WHERE user_id=? AND kind='mark' ORDER BY name").all(me.id);
  const sel = new Set(picked ? picked : editing ? markCollections(m.id).map((c) => c.name) : []);
  return `
<form method="post" action="${editing ? `/m/${m.id}/edit` : '/marks/new'}" class="nf">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <div class="nf-box">
    <div class="nf-top"><span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${m.private ? 'checked' : ''}><span></span></label></div>
    ${seg ? segControl('mark') : ''}
    <details class="nf-drop" id="drop-${idp}">
      <summary><span class="nf-drop-label">${sel.size ? esc([...sel].join(', ')) : 'Select a collection'}</span></summary>
      <div class="nf-drop-menu">
        ${mine.map((c) => `<label class="nf-opt"><input type="checkbox" name="coll" value="${esc(c.name)}" ${sel.has(c.name) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        <label class="nf-opt nf-opt-new"><span>+ New collection</span><input class="nf-field" name="newcoll" placeholder="Name it" value=""></label>
      </div>
    </details>
    <div class="nf-stack">
      <input class="nf-field" name="url" type="url" placeholder="LINK" value="${esc(m.url || '')}">
    </div>
    <input type="hidden" name="image" value="${esc(m.image || '')}">
    <div class="nf-lookup" id="lookup-${idp}">
      <input class="nf-field" id="lookup-input-${idp}" type="text" autocomplete="off" placeholder="SEARCH FOR A PLACE — FILLS THE FIELDS BELOW">
      <ul class="lookup-list" id="lookup-list-${idp}" hidden></ul>
    </div>
    <div class="nf-stack">
      <input class="nf-field" name="name" id="f-name-${idp}" placeholder="PLACE (REQUIRED)" required maxlength="120" value="${esc(m.name || '')}">
      <input class="nf-field" name="locality" id="f-locality-${idp}" placeholder="CITY" maxlength="80" value="${esc(m.locality || '')}">
      <input class="nf-field" name="country" id="f-country-${idp}" placeholder="COUNTRY" maxlength="80" value="${esc(m.country || '')}">
      <input class="nf-field" name="address" id="f-address-${idp}" placeholder="ADDRESS" maxlength="200" value="${esc(m.address || '')}">
      <textarea class="nf-field" name="why" rows="5" maxlength="1000" placeholder="WHY IT IS WORTH RETURNING TO">${esc(m.why || '')}</textarea>
      <input class="nf-field" name="tags" placeholder="#HASHTAGS" value="${esc(m.tags || '')}">
    </div>
    <div class="nf-stack">
      <input class="nf-field" name="latlng" id="f-latlng-${idp}" placeholder="LAT, LNG (OPTIONAL)" value="${m.lat != null ? `${m.lat}, ${m.lng}` : ''}">
    </div>
    <button class="nf-post">${editing ? 'Save mark' : 'Add travel mark'}</button>
    <div class="nf-foot">
      ${editing ? `<button type="button" class="nf-link-btn nf-del" data-del="/m/${m.id}/delete" data-kind="travel mark" data-title="${esc(m.name)}">Delete</button>` : '<span></span>'}
      <a class="nf-link-btn" href="${editing ? `/m/${m.id}` : '/'}">Cancel</a>
    </div>
  </div>
</form>
<script>
(function () {
  // Place lookup via Photon (Komoot). OSM data, no API key, built for
  // search-as-you-type. Nominatim explicitly forbids client-side autocomplete.
  var lk = document.getElementById('lookup-input-${idp}'), list = document.getElementById('lookup-list-${idp}');
  if (lk) {
    var timer, controller;
    lk.addEventListener('input', function () {
      clearTimeout(timer);
      var term = lk.value.trim();
      if (term.length < 3) { list.hidden = true; return; }
      timer = setTimeout(function () {          // debounced: one request per pause, not per keystroke
        if (controller) controller.abort();
        controller = new AbortController();
        fetch('https://photon.komoot.io/api/?limit=6&q=' + encodeURIComponent(term), { signal: controller.signal })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            list.innerHTML = '';
            (d.features || []).forEach(function (f) {
              var pr = f.properties || {};
              var where = [pr.city || pr.town || pr.village || pr.county, pr.country].filter(Boolean).join(', ');
              var li = document.createElement('li');
              li.innerHTML = '<b></b><em></em>';
              li.querySelector('b').textContent = pr.name || pr.street || term;
              li.querySelector('em').textContent = where;
              li.addEventListener('click', function () {
                var set = function (id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; };
                set('f-name-${idp}', pr.name || '');
                set('f-locality-${idp}', pr.city || pr.town || pr.village || pr.county || '');
                set('f-country-${idp}', pr.country || '');
                set('f-address-${idp}', [pr.housenumber, pr.street, pr.postcode].filter(Boolean).join(' '));
                if (f.geometry && f.geometry.coordinates)
                  set('f-latlng-${idp}', f.geometry.coordinates[1].toFixed(5) + ', ' + f.geometry.coordinates[0].toFixed(5));
                list.hidden = true; lk.value = '';
              });
              list.appendChild(li);
            });
            list.hidden = !list.children.length;
          }).catch(function () { list.hidden = true; });
      }, 320);
    });
    document.addEventListener('click', function (e) { if (!lk.parentNode.contains(e.target)) list.hidden = true; });
  }
  var det = document.getElementById('drop-${idp}');
  if (det) { var lbl = det.querySelector('.nf-drop-label');
    function sync() { var on = [].slice.call(det.querySelectorAll('input[name=coll]:checked')).map(function (i) { return i.value; });
      lbl.textContent = on.length ? on.join(', ') : 'Select a collection'; }
    det.addEventListener('change', sync);
    document.addEventListener('click', function (e) { if (!det.contains(e.target)) det.removeAttribute('open'); });
  }
})();
</script>`;
}

function profileRail(u, me, tab) {
  const owner = me && me.id === u.id;
  const visible = q(OBJ_SQL + ' WHERE o.user_id=?').all(u.id).filter((o) => canSee(o, me));
  const fc = followCounts(u.id);
  const markCount = q('SELECT COUNT(*) c FROM marks WHERE user_id=?' + (me && me.id === u.id ? '' : ' AND private=0')).get(u.id).c;
  const following = me && me.id !== u.id && isFollowing(me.id, u.id);
  const link = (t) => `/u/${esc(u.handle)}?tab=${t}`;
  return `<aside class="rail profile-rail">
    <a href="/u/${esc(u.handle)}">${avatar(u, 'avatar big')}</a><p class="prail-handle">${esc(u.handle)}</p>
    ${u.bio ? `<p class="prail-bio">${esc(u.bio)}</p>` : ''}${u.site ? `<p class="prail-site"><a href="${esc(u.site)}" rel="noopener">${esc(u.site.replace(/^https?:\/\//, ''))}</a></p>` : ''}
    ${me && me.id !== u.id ? `<form method="post" action="/u/${esc(u.handle)}/${following ? 'unfollow' : 'follow'}" class="prail-follow"><button class="btn ${following ? 'btn-on' : ''} block">${following ? 'Following' : 'Follow'}</button></form>` : ''}
    <ul class="prail-nav">
      <li><a class="${tab === 'activity' ? 'on' : ''}" data-short="All&#10;Activity" href="${link('activity')}">All Activity <span>›</span></a></li>
      <li><a class="${tab === 'notes' ? 'on' : ''}" data-short="Notes" data-count="${visible.length}" href="${link('notes')}">Notes: ${visible.length} <span>›</span></a></li>
      <li><a class="${tab === 'marks' ? 'on' : ''}" data-short="Marks" data-count="${markCount}" href="${link('marks')}">Travel Marks: ${markCount} <span>›</span></a></li>
      <li><a class="${tab === 'followers' ? 'on' : ''}" data-short="Followers" data-count="${fc.followers}" href="${link('followers')}">Followers: ${fc.followers} ${fc.followers === 1 ? 'person' : 'people'} <span>›</span></a></li>
      <li><a class="${tab === 'following' ? 'on' : ''}" data-short="Following" data-count="${fc.following}" href="${link('following')}">Following: ${fc.following} ${fc.following === 1 ? 'person' : 'people'} <span>›</span></a></li>
    </ul>

  </aside>`;
}

const OBJ_SQL = 'SELECT o.*, u.handle, u.name uname, u.avatar FROM objects o JOIN users u ON u.id=o.user_id';

function objectCard(o, me, full = false) {
  const noted = me ? q('SELECT 1 FROM notes WHERE user_id=? AND object_id=?').get(me.id, o.id) : null;
  const tags = tagList(o.tags);
  const shortUrl = o.url ? (o.url.length > 34 ? o.url.slice(0, 34) + '…' : o.url) : '';
  return `<article class="note ${full ? 'note-full' : ''} ${o.image ? 'has-image' : ''}">
  <div class="byline"><span class="byline-who"><a href="/u/${esc(o.handle)}">${avatar({ name: o.uname, handle: o.handle, avatar: o.avatar })}</a>${stackDate(o.created_at)}</span>${me && me.id === o.user_id ? `<a class="card-edit" href="/o/${o.id}/edit">Edit</a>` : ''}</div>
  <div class="card">
    <div class="card-head">
      <p class="who"><a href="/u/${esc(o.handle)}">${esc(o.handle)}</a> ${o.private ? '<span class="who-private">privately noted</span>' : 'noted'}</p>
      ${(() => { const cs = objCollections(o.id); return cs.length ? `<p class="colls">${cs.map((c) => `<a href="/u/${esc(o.handle)}?tab=notes&c=${c.id}">${esc(c.name)}</a>`).join(' · ')}</p>` : ''; })()}
    </div>
    <div class="text">
      <h2><a href="/o/${o.id}">${esc(o.name)}</a></h2>
      ${o.why ? (() => {
        // roughly seven lines at the card's measure, or seven typed lines
        const long = !full && (o.why.length > 330 || o.why.split('\n').length > 7);
        return `<p class="body${long ? ' is-clamped' : ''}">${esc(o.why)}</p>${long ? `<p class="more-inline"><a href="/o/${o.id}">…more</a></p>` : ''}`;
      })() : ''}
      ${tags.length ? `<p class="tags">${tags.map((t) => `<a href="/?t=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(', ')}</p>` : ''}
      ${o.url ? `<p class="link"><span class="lbl">Link:</span> <a href="${esc(o.url)}" rel="noopener">${esc(shortUrl)}</a></p>` : ''}
      <div class="noteit">
        ${me ? `<form method="post" action="/o/${o.id}/${noted ? 'unnote' : 'note'}"><button class="btn-note ${noted ? 'is-noted' : ''}">${noted ? 'Noted' : 'Note this'}</button></form>` : `<a class="btn-note" href="/login">Note this</a>`}
      </div>
    </div>
    ${o.image ? `<a class="figure" href="/o/${o.id}"><img src="${esc(o.image)}" alt="${esc(o.name)}"></a>` : ''}
  </div></article>`;
}



function field(name, label, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function select(name, label, opts, value = '') {
  return `<label>${label}<select name="${name}"><option value="">—</option>${opts.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
}

// ---------- pages ----------
const pages = {
  home(req, res, me, url) {
    const s = (url.searchParams.get('q') || '').trim();
    const tag = (url.searchParams.get('t') || '').trim().toLowerCase();
    const feed = me && ['following', 'followers'].includes(url.searchParams.get('feed')) ? url.searchParams.get('feed') : 'all';
    // Searching looks through the member's own private entries too — the point
    // of a search is to find your own things. Browsing the feed unsearched is
    // unchanged: it stays the public network view it has always been.
    const mineToo = !!(me && s);
    let rows = mineToo
      ? q(OBJ_SQL + ' WHERE o.private=0 OR o.user_id=? ORDER BY o.id DESC LIMIT 200').all(me.id)
      : q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC LIMIT 200').all();
    if (feed === 'following') { const ids = new Set(q('SELECT followee_id id FROM follows WHERE follower_id=?').all(me.id).map((r) => r.id)); rows = rows.filter((o) => ids.has(o.user_id)); }
    if (feed === 'followers') { const ids = new Set(q('SELECT follower_id id FROM follows WHERE followee_id=?').all(me.id).map((r) => r.id)); rows = rows.filter((o) => ids.has(o.user_id)); }
    if (tag) rows = rows.filter((o) => tagList(o.tags).includes(tag));
    if (s) { const k = s.toLowerCase(); rows = rows.filter((o) => (o.name + ' ' + o.why + ' ' + o.tags).toLowerCase().includes(k)); }
    rows = rows.filter((o) => canSee(o, me));   // belt and braces: never leak another member's private note
    // marks share the feed with notes — one journal, two kinds of entry
    let marks = mineToo
      ? q(MARK_SQL + ' WHERE m.private=0 OR m.user_id=? ORDER BY m.id DESC').all(me.id)
      : q(MARK_SQL + ' WHERE m.private=0 ORDER BY m.id DESC').all();
    if (feed === 'following') { const ids = new Set(q('SELECT followee_id id FROM follows WHERE follower_id=?').all(me.id).map((r) => r.id)); marks = marks.filter((x) => ids.has(x.user_id)); }
    if (feed === 'followers') { const ids = new Set(q('SELECT follower_id id FROM follows WHERE followee_id=?').all(me.id).map((r) => r.id)); marks = marks.filter((x) => ids.has(x.user_id)); }
    if (tag) marks = marks.filter((x) => tagList(x.tags).includes(tag));
    if (s) { const k = s.toLowerCase(); marks = marks.filter((x) => (x.name + ' ' + x.why + ' ' + x.tags + ' ' + x.locality + ' ' + x.country).toLowerCase().includes(k)); }
    marks = marks.filter((x) => canSee(x, me));
    const entries = [...rows.map((o) => ({ at: o.created_at, html: objectCard(o, me) })),
                     ...marks.map((x) => ({ at: x.created_at, html: markCard(x, me) }))]
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const page = pageOf(entries, url);
    const members = q('SELECT handle, name, avatar FROM users ORDER BY created_at LIMIT 12').all();
    const tagCounts = {}; for (const o of q('SELECT tags FROM objects WHERE private=0').all()) for (const t of tagList(o.tags)) tagCounts[t] = (tagCounts[t] || 0) + 1;
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 16);
    const heading = { all: 'Activity from the entire network', following: 'From people you follow', followers: 'From your followers' }[feed];

    let rail;
    if (me) {
      const notes = q('SELECT COUNT(*) c FROM objects WHERE user_id=?').get(me.id).c;
      const markTally = q('SELECT COUNT(*) c FROM marks WHERE user_id=?').get(me.id).c;
      const fc = followCounts(me.id);
      const fl = (k, label, short) => `<li><a class="${feed === k ? 'on' : ''}" data-short="${short}" href="/${k === 'all' ? '' : `?feed=${k}`}"><span class="fl-label">${label}</span>${feed === k ? '' : ' <span>›</span>'}</a></li>`;
      rail = `<ul class="feednav">${fl('all', 'All Discriminant.ly', 'All')}${fl('following', 'From People You Follow', 'Following')}${fl('followers', 'From Your Followers', 'Followers')}</ul>
      <div class="wtable">
        <div class="wcell wcell-wide"><a href="/u/${esc(me.handle)}">${avatar(me, 'avatar big')}</a><p class="welcome-name">Welcome ${esc(me.handle)}</p></div>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=notes"><b>${notes}</b><span>Notes</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=marks"><b>${markTally}</b><span>Travel Marks</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=followers"><b>${fc.followers}</b><span>Followers</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=following"><b>${fc.following}</b><span>Following</span></a>
        <form class="wcell wcell-wide wcell-btn" method="post" action="/logout"><button class="btn3d block">Logout</button></form>
      </div>
      <p class="rail-post"><a class="btn3d block" href="/new">Post a new note</a></p>`;
    } else {
      rail = `<p class="rail-title">Start remembering:</p>
      <ol class="steps"><li><span>1</span>Save what catches your eye</li><li><span>2</span>Remember where you've been</li><li><span>3</span>Connect to your AI</li></ol>
      <form class="signup" method="get" action="/join"><label class="lbl">Invite code</label><input name="code" placeholder=""><button class="btn3d block">Sign me up</button></form>
`;
    }
    const body = `
<div class="cols">
  <aside class="rail">
    ${rail}
    ${topTags.length ? `<h3 class="lbl ruled">Tags</h3><p class="tags rail-tags">${topTags.map(([t]) => `<a href="/?t=${encodeURIComponent(t)}" class="${t === tag ? 'on' : ''}">#${esc(t)}</a>`).join(', ')}</p>` : ''}
    ${me ? '' : `<h3 class="lbl ruled">About us</h3>
    <p class="about">Discriminantly is an independent, personal and portable memory for your taste—the things you notice, the places you go, and the experiences worth remembering.</p>
    <p class="about">Keep it for yourself, share what you choose, and connect your taste to AI— ChatGPT or Claude.</p>
    <p class="about">Your taste is yours. Keep it private when you choose, connect it on your terms, and put it to use wherever you go.</p>
    <ul class="members">${members.map((u) => `<li><a href="/u/${esc(u.handle)}">${avatar(u)}<span>${esc(u.handle)}</span></a></li>`).join('')}</ul>`}
  </aside>
  <section class="feed feed-plain is-tiled">
    <h3 class="strip">${s ? `Results for “${esc(s)}”` : tag ? `#${esc(tag)}` : heading}</h3>
    ${entries.length ? `<div class="grid" id="feed-grid">${page.slice.map((e) => e.html).join('')}</div>${moreLink(url, page.off, page.more)}`
      : (me ? emptyState(me, feed === 'all' ? (tag ? 'tagged' : 'feed') : feed) : '<p class="empty pad">Nothing here yet.</p>')}
  </section>
</div>`;
    send(res, layout({ title: '', body, me, nav: 'home' }));
  },

  object(req, res, me, url, id) {
    const o = q(OBJ_SQL + ' WHERE o.id=?').get(id); if (!o || !canSee(o, me)) return send(res, layout({ title: 'Not found', body: '<p>No such note.</p>', me }), 404);
    const tags = tagList(o.tags);
    const noters = q('SELECT u.handle, u.name, u.avatar FROM notes n JOIN users u ON u.id=n.user_id WHERE n.object_id=? AND n.user_id<>? ORDER BY n.created_at').all(id, o.user_id);
    const cmts = q('SELECT c.*, u.handle, u.name, u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.object_id=? ORDER BY c.created_at').all(id);
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: o.name, url: o.url || undefined, image: o.image || undefined, description: o.why, keywords: tags.join(', ') || undefined };
    const author = q('SELECT * FROM users WHERE id=?').get(o.user_id);
    const body = `<div class="cols profile-cols">${profileRail(author, me, 'notes')}
<section class="feed profile-feed">
<h3 class="strip"><a class="crumb" href="/u/${esc(author.handle)}">${esc(author.handle)}</a> › <a class="crumb" href="/u/${esc(author.handle)}?tab=notes">Notes</a> › <span class="crumb-here">Note</span></h3>
<div class="grid grid-single">${objectCard(o, me, true)}</div>
${noters.length ? `<div class="section-rule"></div>
<section class="noters">
  <details class="noters-fold" id="noters-fold" open>
    <summary><span class="lbl noters-title" data-open="Also noted by" data-shut="Also noted by ${noters.length} ${noters.length === 1 ? 'person' : 'people'}">Also noted by</span></summary>
    <ul class="noter-list ${noters.length === 1 ? 'is-one' : ''}">${noters.map((n) => `<li><a href="/u/${esc(n.handle)}">${avatar(n)}<span>${esc(n.handle)}</span></a></li>`).join('')}</ul>
  </details>
</section>` : ''}
<div class="section-rule"></div>
<section class="comments">
  <h3 class="lbl">Comments</h3>
  ${me ? `<form method="post" action="/o/${o.id}/comments" class="comment-form"><textarea class="nf-field" name="body" rows="3" maxlength="600" placeholder="ADD A COMMENT" required></textarea><button class="nf-post">Post comment</button></form><div class="section-rule comment-rule"></div>` : `<a class="nf-post comment-signin" href="/login">Post a comment</a><div class="section-rule comment-rule"></div>`}
  <ul class="comment-list">${cmts.map((c) => `<li><a href="/u/${esc(c.handle)}">${avatar(c)}</a><div class="comment-body"><p class="comment-meta"><a href="/u/${esc(c.handle)}">${esc(c.handle)}</a> · <span class="stamp">${timeAgo(c.created_at)}</span></p><p>${esc(c.body)}</p></div></li>`).join('') || '<li class="empty pad">No comments yet.</li>'}</ul>
</section>
<script>
(function () {
  var f = document.getElementById('noters-fold'); if (!f) return;
  var list = f.querySelector('.noter-list'), t = f.querySelector('.noters-title');
  function label() { t.textContent = f.open ? t.dataset.open : t.dataset.shut; }
  // one row stays open; more than one starts collapsed
  var first = list.firstElementChild;
  if (first && list.scrollHeight > first.offsetHeight * 1.6) f.open = false;
  label(); f.addEventListener('toggle', label);
})();
</script>
</section></div>
<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    send(res, layout({ title: o.name, body, me, cls: 'is-article' }));
  },

  mark(req, res, me, url, id) {
    const m = q(MARK_SQL + ' WHERE m.id=?').get(id);
    if (!m || (m.private && !(me && (me.id === m.user_id || me.is_admin)))) return send(res, layout({ title: 'Not found', body: '<p>No such mark.</p>', me }), 404);
    const owner = me && me.id === m.user_id;
    const visits = markVisits(m.id);
    const cmts = q('SELECT c.*, u.handle, u.avatar FROM mark_comments c JOIN users u ON u.id=c.user_id WHERE c.mark_id=? ORDER BY c.created_at').all(m.id);
    const ask = url.searchParams.get('ask') && owner && !visits.length;
    const author = q('SELECT * FROM users WHERE id=?').get(m.user_id);
    // Lineage. Both directions are explicit evidence, not inference: who this
    // Mark was adopted from, and who has since adopted it.
    const source = m.remarked_from_uid
      ? q('SELECT mk.id, mk.name, u.handle FROM marks mk JOIN users u ON u.id=mk.user_id WHERE mk.uid=?').get(m.remarked_from_uid)
      : null;
    const remarkers = q(`SELECT mk.id, u.handle, u.name, u.avatar FROM marks mk
      JOIN users u ON u.id=mk.user_id WHERE mk.remarked_from_uid=? ORDER BY mk.created_at`).all(m.uid);
    const body = `<div class="cols profile-cols">${profileRail(author, me, 'marks')}
<section class="feed profile-feed">
<h3 class="strip"><a class="crumb" href="/u/${esc(author.handle)}">${esc(author.handle)}</a> › <a class="crumb" href="/u/${esc(author.handle)}?tab=marks">Travel Marks</a> › <span class="crumb-here">Mark</span></h3>
<div class="mark-layout ${visits.length ? 'has-log' : ''}">
  <div class="mark-main"><div class="grid grid-single">${markCard(m, me, true)}</div></div>
  ${visits.length ? `<aside class="visit-log">
    <h3 class="lbl">Check-ins</h3>
    <ol class="timeline">${visits.map((v) => `<li>
      <span class="tl-date">${esc(prettyDay(v.visited_on))}</span>
      ${v.body ? `<span class="tl-body">${esc(v.body)}</span>` : ''}
      ${owner ? `<span class="tl-actions">
        <button class="tl-edit" data-edit="/m/${m.id}/visits/${v.id}/edit" data-day="${esc(prettyDay(v.visited_on))}" data-body="${esc(v.body || '')}" aria-label="Edit this check-in">Edit</button>
        <button class="tl-del" data-del="/m/${m.id}/visits/${v.id}/delete" data-day="${esc(prettyDay(v.visited_on))}" aria-label="Remove this check-in">×</button>
      </span>` : ''}
    </li>`).join('')}</ol>
  </aside>` : ''}
</div>
${source
  ? `<p class="remark-source">Marked from <a href="/m/${source.id}">@${esc(source.handle)}’s mark</a></p>`
  : (m.remarked_from_uid ? `<p class="remark-source remark-source-gone">Marked from a place since removed.</p>` : '')}
${remarkers.length ? `<div class="section-rule"></div>
<section class="noters">
  <details class="noters-fold" open>
    <summary><span class="lbl noters-title" data-open="Also marked by" data-shut="Also marked by ${remarkers.length} ${remarkers.length === 1 ? 'person' : 'people'}">Also marked by</span></summary>
    <ul class="noter-list ${remarkers.length === 1 ? 'is-one' : ''}">${remarkers.map((n) => `<li><a href="/m/${n.id}">${avatar(n)}<span>${esc(n.handle)}</span></a></li>`).join('')}</ul>
  </details>
</section>` : ''}
<div class="section-rule"></div>
<section class="comments">
  <h3 class="lbl">Comments</h3>
  ${me ? `<form method="post" action="/m/${m.id}/comments" class="comment-form"><textarea class="nf-field" name="body" rows="3" maxlength="600" placeholder="ADD A COMMENT" required></textarea><button class="nf-post">Post comment</button></form><div class="section-rule comment-rule"></div>`
       : `<a class="nf-post comment-signin" href="/login">Post a comment</a><div class="section-rule comment-rule"></div>`}
  <ul class="comment-list">${cmts.map((c) => `<li><a href="/u/${esc(c.handle)}">${avatar(c)}</a><div class="comment-body"><p class="comment-meta"><a href="/u/${esc(c.handle)}">${esc(c.handle)}</a> · <span class="stamp">${timeAgo(c.created_at)}</span></p><p>${esc(c.body)}</p></div></li>`).join('') || '<li class="empty pad">No comments yet.</li>'}</ul>
</section>
</section></div>
<script>
document.querySelectorAll('.tl-edit').forEach(function (b) {
  b.addEventListener('click', function () {
    window.askConfirm({ title: 'Edit check-in', cta: 'Save remark', action: b.dataset.edit,
      copy: 'Your note on <b>' + b.dataset.day + '</b>.',
      field: 'A LINE ABOUT THIS VISIT (OPTIONAL)', value: b.dataset.body });
  });
});
document.querySelectorAll('.tl-edit').forEach(function (b) {
  b.addEventListener('click', function () {
    window.askConfirm({ title: 'Edit check-in', cta: 'Save', action: b.dataset.edit,
      copy: 'Your note on <b>' + b.dataset.day + '</b>.',
      field: 'A LINE ABOUT THIS VISIT (OPTIONAL)', value: b.dataset.body });
  });
});
document.querySelectorAll('.tl-del').forEach(function (b) {
  b.addEventListener('click', function () {
    window.askConfirm({ title: 'Remove check-in', cta: 'Remove check-in', action: b.dataset.del,
      copy: 'Remove the check-in on <b>' + b.dataset.day + '</b>? The mark itself stays.' });
  });
});
${ask ? `window.askConfirm({ title: 'Were you there today?',
  copy: 'Log today as your first visit to <b>${esc(m.name)}</b>? You can check in any time from the card.',
  cta: 'Log today', dismiss: 'Not now', action: '/m/${m.id}/checkin', field: 'A LINE ABOUT THIS VISIT (OPTIONAL)' });` : ''}
</script>`;
    send(res, layout({ title: m.name, body, me }));
  },

  markForm(req, res, me, m = {}, err = '', picked = null) {
    const body = `<div class="notecard-page">${markForm(me, m, { err, picked })}</div>`;
    send(res, layout({ title: m.id ? 'Edit mark' : 'Add a travel mark', body, me }));
  },

  // Both post pages render the same pair of panels as the curtain, so the
  // selector behaves identically wherever you start from.
  composePage(req, res, me, which, { o = {}, m = {}, err = '', picked = null } = {}) {
    const body = `<div class="notecard-page">
      <div class="seg-panels">
        <div class="seg-panel ${which === 'note' ? 'is-on' : ''}" data-kind="note">${noteForm(me, o, { idp: 'pg', err: which === 'note' ? err : '', picked: which === 'note' ? picked : null, seg: true })}</div>
        <div class="seg-panel ${which === 'mark' ? 'is-on' : ''}" data-kind="mark">${markForm(me, m, { idp: 'pgm', err: which === 'mark' ? err : '', picked: which === 'mark' ? picked : null, seg: true })}</div>
      </div>
    </div>`;
    send(res, layout({ title: which === 'mark' ? 'Add a travel mark' : 'Post a note', body, me }));
  },

  form(req, res, me, o = {}, err = '', picked = null) {
    const editing = !!o.id;
    const body = `<div class="notecard-page">${noteForm(me, o, { err, picked, idp: 'pg' })}</div>`;
    send(res, layout({ title: editing ? 'Edit note' : 'Post a new note', body, me }));
  },

  user(req, res, me, handle, url) {
    const u = q('SELECT * FROM users WHERE handle=?').get(handle); if (!u) return send(res, layout({ title: 'Not found', body: '<p>No such member.</p>', me }), 404);
    const owner = me && me.id === u.id;
    const tab = ['activity', 'notes', 'marks', 'followers', 'following'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'activity';
    const cid = +url.searchParams.get('c') || 0; const vis = url.searchParams.get('v') || 'all'; const s = (url.searchParams.get('q') || '').trim();
    const visible = q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC').all(u.id).filter((o) => canSee(o, me));
    const fc = followCounts(u.id);
    const colls = q("SELECT id, name FROM collections WHERE user_id=? AND kind='note' ORDER BY name").all(u.id).map((c) => {
      const ids = new Set(q('SELECT object_id FROM object_collections WHERE collection_id=?').all(c.id).map((r) => r.object_id));
      const items = visible.filter((o) => ids.has(o.id)); return { ...c, count: items.length, image: (items.find((o) => o.image) || {}).image || '' };
    });
    const link = (t, extra = '') => `/u/${esc(u.handle)}?tab=${t}${extra}`;

    let main = '';
    if (tab === 'followers' || tab === 'following') {
      const rows = tab === 'followers'
        ? q('SELECT u.* FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followee_id=? ORDER BY f.created_at DESC').all(u.id)
        : q('SELECT u.* FROM follows f JOIN users u ON u.id=f.followee_id WHERE f.follower_id=? ORDER BY f.created_at DESC').all(u.id);
      main = `<h3 class="strip">${tab === 'followers' ? `${fc.followers} ${fc.followers === 1 ? 'person follows' : 'people follow'} ${esc(u.handle)}` : `${esc(u.handle)} follows ${fc.following} ${fc.following === 1 ? 'person' : 'people'}`}</h3>
      <ul class="people">${rows.map((p) => {
        const pc = followCounts(p.id); const following = me && isFollowing(me.id, p.id);
        return `<li><a class="person" href="/u/${esc(p.handle)}">${avatar(p)}<span class="person-name">${esc(p.handle)}<em>${q('SELECT COUNT(*) c FROM objects WHERE user_id=? AND private=0').get(p.id).c} notes · ${pc.followers} followers</em></span></a>
        ${me && me.id !== p.id ? `<form method="post" action="/u/${esc(p.handle)}/${following ? 'unfollow' : 'follow'}"><input type="hidden" name="back" value="${esc(url.pathname + url.search)}"><button class="btn ${following ? 'btn-on' : ''}">${following ? 'Following' : 'Follow'}</button></form>` : ''}</li>`;
      }).join('')}</ul>${rows.length ? '' : emptyState(me, tab, u)}`;
    } else if (tab === 'marks') {
      let rows = q(MARK_SQL + ' WHERE m.user_id=? ORDER BY m.id DESC').all(u.id)
        .filter((x) => !x.private || (me && (me.id === x.user_id || me.is_admin)));
      if (owner && vis === 'public') rows = rows.filter((x) => !x.private);
      if (owner && vis === 'private') rows = rows.filter((x) => x.private);
      if (cid) { const ids = new Set(q('SELECT mark_id FROM mark_collections WHERE collection_id=?').all(cid).map((r) => r.mark_id)); rows = rows.filter((x) => ids.has(x.id)); }
      if (s) { const k = s.toLowerCase(); rows = rows.filter((x) => (x.name + ' ' + x.why + ' ' + x.tags + ' ' + x.locality + ' ' + x.country).toLowerCase().includes(k)); }
      const all = q(MARK_SQL + ' WHERE m.user_id=?').all(u.id).filter((x) => !x.private || (me && (me.id === x.user_id || me.is_admin)));
      const countrySel = url.searchParams.getAll('country').filter(Boolean);
      const citySel = url.searchParams.getAll('city').filter(Boolean);
      if (countrySel.length) rows = rows.filter((x) => countrySel.includes(x.country));
      if (citySel.length) rows = rows.filter((x) => citySel.includes(x.locality));
      const countries = [...new Set(all.map((x) => x.country).filter(Boolean))].sort();
      // the city list follows whichever countries are chosen
      const cities = [...new Set(all.filter((x) => !countrySel.length || countrySel.includes(x.country))
        .map((x) => x.locality).filter(Boolean))].sort();
      const q1 = (o) => {
        const sp = new URLSearchParams({ tab: 'marks' });
        if (vis !== 'all' && !('v' in o)) o = { ...o, v: vis };
        Object.entries(o).forEach(([k, v]) => v && sp.set(k, v));
        if (!('country' in o)) countrySel.forEach((c) => sp.append('country', c));
        if (!('city' in o)) citySel.forEach((c) => sp.append('city', c));
        return `/u/${esc(u.handle)}?${sp}`;
      };
      const mcolls = q("SELECT id, name FROM collections WHERE user_id=? AND kind='mark' ORDER BY name").all(u.id).map((c) => {
        const ids = new Set(q('SELECT mark_id FROM mark_collections WHERE collection_id=?').all(c.id).map((r) => r.mark_id));
        return { ...c, count: all.filter((x) => ids.has(x.id)).length };
      });
      const mtile = (id, name, count, on) => `<div class="tile-slot"><a class="tile ${on ? 'on' : ''}" href="${q1({ c: id || '' })}"><span class="tile-img"><span class="tile-glyph">${ICONS.lens}</span></span><span class="tile-name">${esc(name)}</span><span class="tile-count">${count}</span></a>${owner && id && on ? `<button type="button" class="tile-del" data-del-id="${id}" data-del-name="${esc(name)}" aria-label="Delete collection"><img src="/close.png" alt="" width="28" height="28"></button>
  <button type="button" class="tile-ren" aria-label="Rename collection">···</button>
  <form class="tile-edit" method="post" action="/collections/${id}/rename">
    <input name="name" value="${esc(name)}" maxlength="40" required>
    <span class="tile-ctas"><button class="tile-cta tile-cta-go">Save</button><button type="button" class="tile-cta" data-cancel-ren>Cancel</button></span>
  </form>` : ''}</div>`;
      const chip = (label, href, on) => `<a class="place-chip ${on ? 'on' : ''}" href="${href}">${esc(label)}</a>`;
      main = `<h3 class="strip">${esc(u.handle)}'s Travel Marks</h3>
      <div class="tiles-wrap">
        <div class="tiles-nav"><button type="button" class="tiles-arrow" data-scroll="-1" aria-label="Scroll collections left"><img src="/chev.png" alt="" width="26" height="26"></button><button type="button" class="tiles-arrow" data-scroll="1" aria-label="Scroll collections right"><img src="/chev.png" alt="" width="26" height="26"></button></div>
        <div class="tiles" id="tiles">${mtile(0, 'All marks', all.length, !cid)}${mcolls.map((c) => mtile(c.id, c.name, c.count, c.id === cid)).join('')}${owner ? `
          <form class="tile tile-new" method="post" action="/collections/new">
            <input type="hidden" name="kind" value="mark">
            <span class="tile-img"><img src="/plus-sm.png" alt="" width="40" height="40"></span>
            <span class="tile-name">New collection</span>
            <span class="tile-count"><input name="name" placeholder="NAME IT" maxlength="40" required><span class="tile-ctas"><button class="tile-cta tile-cta-go">Save</button><button type="button" class="tile-cta" data-cancel-new>Cancel</button></span></span>
          </form>` : ''}</div>
      </div>
      <form class="place-filters" method="get" action="/u/${esc(u.handle)}" id="place-form">
        <input type="hidden" name="tab" value="marks">
        ${cid ? `<input type="hidden" name="c" value="${cid}">` : ''}
        ${vis !== 'all' ? `<input type="hidden" name="v" value="${esc(vis)}">` : ''}
        ${s ? `<input type="hidden" name="q" value="${esc(s)}">` : ''}
        <details class="nf-drop place-drop">
          <summary><span class="nf-drop-label">${countrySel.length ? esc(countrySel.join(', ')) : 'All countries'}</span></summary>
          <div class="nf-drop-menu">
            ${countries.map((c) => `<label class="nf-opt"><input type="checkbox" name="country" value="${esc(c)}" ${countrySel.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('') || '<span class="nf-opt is-empty">No countries yet</span>'}
          </div>
        </details>
        <details class="nf-drop place-drop"${cities.length ? '' : ' data-empty'}>
          <summary><span class="nf-drop-label">${citySel.length ? esc(citySel.join(', ')) : 'All cities'}</span></summary>
          <div class="nf-drop-menu">
            ${cities.map((c) => `<label class="nf-opt"><input type="checkbox" name="city" value="${esc(c)}" ${citySel.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('') || '<span class="nf-opt is-empty">No cities yet</span>'}
          </div>
        </details>
      </form>
      <form class="within" method="get" action="/u/${esc(u.handle)}"><input type="hidden" name="tab" value="marks">${cid ? `<input type="hidden" name="c" value="${cid}">` : ''}${vis !== 'all' ? `<input type="hidden" name="v" value="${esc(vis)}">` : ''}<input type="search" name="q" placeholder="Search within below" value="${esc(s)}"></form>
      ${owner ? `<div class="vis-tabs">${[['all', 'Public & Private Marks', 'All'], ['public', 'Public Marks', 'Public'], ['private', 'Private Marks', 'Private']].map(([k, l, sh]) => `<a class="${vis === k ? 'on' : ''}" data-short="${sh}" href="${q1({ c: cid || '', v: k === 'all' ? '' : k })}">${l}</a>`).join('')}</div>
      <a class="post-box" href="/marks/new"><img class="plus" src="/plus.png" alt="" width="68" height="68"><span>Add a travel mark</span></a>` : ''}
      ${(() => { const pg = pageOf(rows, url); return rows.length
        ? `<div class="grid" id="feed-grid">${pg.slice.map((x) => markCard(x, me)).join('')}</div>${moreLink(url, pg.off, pg.more)}`
        : '<p class="empty pad">No travel marks here yet.</p>'; })()}
      <script>
      (function () {
        var t = document.getElementById('tiles');
        // land on the active collection already in view — centred where a
        // centred scroll is possible, simply visible where it is not (the
        // strip can't centre a tile flush against either end).
        if (t) {
          var on = t.querySelector('.tile.on');
          if (on) {
            var slot = on.closest('.tile-slot') || on;
            var target = slot.offsetLeft - (t.clientWidth - slot.offsetWidth) / 2;
            target = Math.max(0, Math.min(target, t.scrollWidth - t.clientWidth));
            t.scrollLeft = target;
          }
        }
        if (t) document.querySelectorAll('.tiles-arrow').forEach(function (b) {
          b.addEventListener('click', function () { t.scrollBy({ left: (+b.dataset.scroll) * Math.max(240, t.clientWidth * 0.6), behavior: 'smooth' }); });
        });
        var nw = document.querySelector('.tile-new');
        if (nw) {
          nw.addEventListener('click', function (e) { if (e.target.hasAttribute('data-cancel-new')) return; nw.classList.add('is-open'); nw.querySelector('input[name=name]').focus(); nw.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' }); });
          var cx = nw.querySelector('[data-cancel-new]');
          if (cx) cx.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); nw.classList.remove('is-open'); nw.querySelector('input[name=name]').value = ''; });
        }
        var placeForm = document.getElementById('place-form');
        var placeDirty = false;
        if (placeForm) {
          placeForm.addEventListener('change', function () { placeDirty = true; });
          var applyPlaces = function () { if (placeDirty) { placeDirty = false; placeForm.submit(); } };
          document.addEventListener('click', function (e) {
            document.querySelectorAll('.place-drop[open]').forEach(function (d) {
              if (!d.contains(e.target)) { d.removeAttribute('open'); applyPlaces(); }
            });
          });
          placeForm.querySelectorAll('.place-drop').forEach(function (d) {
            d.addEventListener('toggle', function () { if (!d.open) applyPlaces(); });
          });
        }
        document.querySelectorAll('.tile-ren').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var slot = b.closest('.tile-slot');
            slot.classList.add('is-renaming');
            var f = slot.querySelector('.tile-edit input');
            if (f) { f.focus(); f.select(); }
          });
        });
        document.querySelectorAll('[data-cancel-ren]').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            b.closest('.tile-slot').classList.remove('is-renaming');
          });
        });
        document.querySelectorAll('.tile-del').forEach(function (b) {
          b.addEventListener('click', function () {
            window.askConfirm({ title: 'Delete collection', cta: 'Delete collection',
              action: '/collections/' + b.dataset.delId + '/delete?tab=marks',
              copy: 'Delete “<b>' + b.dataset.delName + '</b>”? The marks inside stay put — only the collection is removed.' });
          });
        });
      })();
      </script>`;
    } else if (tab === 'notes') {
      let rows = visible;
      if (owner && vis === 'public') rows = rows.filter((o) => !o.private);
      if (owner && vis === 'private') rows = rows.filter((o) => o.private);
      if (cid) { const ids = new Set(q('SELECT object_id FROM object_collections WHERE collection_id=?').all(cid).map((r) => r.object_id)); rows = rows.filter((o) => ids.has(o.id)); }
      if (s) rows = rows.filter((o) => (o.name + ' ' + o.why + ' ' + o.tags).toLowerCase().includes(s.toLowerCase()));
      const tile = (id, name, count, image, on) => `<div class="tile-slot"><a class="tile ${on ? 'on' : ''}" href="${link('notes', `&c=${id}${vis !== 'all' ? '&v=' + vis : ''}`)}"><span class="tile-img" ${image ? `style="background-image:url('${esc(image)}')"` : ''}>${image ? '' : `<span class="tile-glyph">${ICONS.lens}</span>`}</span><span class="tile-name">${esc(name)}</span><span class="tile-count">${count}</span></a>${owner && id && on ? `<button type="button" class="tile-del" data-del-id="${id}" data-del-name="${esc(name)}" aria-label="Delete collection"><img src="/close.png" alt="" width="28" height="28"></button>
  <button type="button" class="tile-ren" aria-label="Rename collection">···</button>
  <form class="tile-edit" method="post" action="/collections/${id}/rename">
    <input name="name" value="${esc(name)}" maxlength="40" required>
    <span class="tile-ctas"><button class="tile-cta tile-cta-go">Save</button><button type="button" class="tile-cta" data-cancel-ren>Cancel</button></span>
  </form>` : ''}</div>`;
      main = `<h3 class="strip">${esc(u.handle)}'s Notes</h3>
      <div class="tiles-wrap">
        <div class="tiles-nav"><button type="button" class="tiles-arrow" data-scroll="-1" aria-label="Scroll collections left"><img src="/chev.png" alt="" width="26" height="26"></button><button type="button" class="tiles-arrow" data-scroll="1" aria-label="Scroll collections right"><img src="/chev.png" alt="" width="26" height="26"></button></div>
        <div class="tiles" id="tiles">${tile(0, 'All notes', visible.length, '', !cid)}${colls.map((c) => tile(c.id, c.name, c.count, c.image, c.id === cid)).join('')}${owner ? `
          <form class="tile tile-new" method="post" action="/collections/new">
            <span class="tile-img"><img src="/plus-sm.png" alt="" width="40" height="40"></span>
            <span class="tile-name">New collection</span>
            <span class="tile-count"><input name="name" placeholder="NAME IT" maxlength="40" required><span class="tile-ctas"><button class="tile-cta tile-cta-go">Save</button><button type="button" class="tile-cta" data-cancel-new>Cancel</button></span></span>
          </form>` : ''}</div>
      </div>
      <form class="within" method="get" action="/u/${esc(u.handle)}"><input type="hidden" name="tab" value="notes">${cid ? `<input type="hidden" name="c" value="${cid}">` : ''}${vis !== 'all' ? `<input type="hidden" name="v" value="${esc(vis)}">` : ''}<input type="search" name="q" placeholder="Search within below" value="${esc(s)}"></form>
      ${owner ? `<div class="vis-tabs">${[['all', 'Public & Private Notes', 'All'], ['public', 'Public Notes', 'Public'], ['private', 'Private Notes', 'Private']].map(([k, l, sh]) => `<a class="${vis === k ? 'on' : ''}" data-short="${sh}" href="${link('notes', `&v=${k}${cid ? '&c=' + cid : ''}`)}">${l}</a>`).join('')}</div>
      <a class="post-box" href="/new"><img class="plus" src="/plus.png" alt="" width="68" height="68"><span>Post a new Note</span></a>` : ''}
      ${rows.length ? (() => { const pg = pageOf(rows, url); return `<div class="grid" id="feed-grid">${pg.slice.map((o) => objectCard(o, me)).join('')}</div>${moreLink(url, pg.off, pg.more)}`; })()
        : emptyState(me, 'notes', u)}
    <script>
    (function () {
      var t = document.getElementById('tiles');
      // land on the active collection already in view — centred where a
      // centred scroll is possible, simply visible where it is not (the
      // strip can't centre a tile flush against either end).
      if (t) {
        var on = t.querySelector('.tile.on');
        if (on) {
          var slot = on.closest('.tile-slot') || on;
          var target = slot.offsetLeft - (t.clientWidth - slot.offsetWidth) / 2;
          target = Math.max(0, Math.min(target, t.scrollWidth - t.clientWidth));
          t.scrollLeft = target;
        }
      }
      if (t) document.querySelectorAll('.tiles-arrow').forEach(function (b) {
        b.addEventListener('click', function () { t.scrollBy({ left: (+b.dataset.scroll) * Math.max(240, t.clientWidth * 0.6), behavior: 'smooth' }); });
      });
      var nw = document.querySelector('.tile-new');
      if (nw) {
        nw.addEventListener('click', function (e) { if (e.target.hasAttribute('data-cancel-new')) return; nw.classList.add('is-open'); nw.querySelector('input').focus(); nw.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' }); });
        var cx = nw.querySelector('[data-cancel-new]');
        if (cx) cx.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); nw.classList.remove('is-open'); nw.querySelector('input').value = ''; });
      }
      var dlg = document.getElementById('confirm-dialog');
      if (dlg) {
        var placeForm = document.getElementById('place-form');
        var placeDirty = false;
        if (placeForm) {
          placeForm.addEventListener('change', function () { placeDirty = true; });
          var applyPlaces = function () { if (placeDirty) { placeDirty = false; placeForm.submit(); } };
          document.addEventListener('click', function (e) {
            document.querySelectorAll('.place-drop[open]').forEach(function (d) {
              if (!d.contains(e.target)) { d.removeAttribute('open'); applyPlaces(); }
            });
          });
          placeForm.querySelectorAll('.place-drop').forEach(function (d) {
            d.addEventListener('toggle', function () { if (!d.open) applyPlaces(); });
          });
        }
        document.querySelectorAll('.tile-ren').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            var slot = b.closest('.tile-slot');
            slot.classList.add('is-renaming');
            var f = slot.querySelector('.tile-edit input');
            if (f) { f.focus(); f.select(); }
          });
        });
        document.querySelectorAll('[data-cancel-ren]').forEach(function (b) {
          b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            b.closest('.tile-slot').classList.remove('is-renaming');
          });
        });
        document.querySelectorAll('.tile-del').forEach(function (b) {
          b.addEventListener('click', function () {
            dlg.querySelector('.dlg-name').textContent = b.dataset.delName;
            dlg.querySelector('form').action = '/collections/' + b.dataset.delId + '/delete';
            dlg.classList.add('is-open');
          });
        });
        dlg.querySelectorAll('[data-dismiss]').forEach(function (b) { b.addEventListener('click', function () { dlg.classList.remove('is-open'); }); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') dlg.classList.remove('is-open'); });
      }
    })();
    </script>`;
    } else {
      const acts = [];
      for (const o of visible) acts.push({ at: o.created_at, card: o });
      for (const n of q('SELECT n.created_at, o.id, o.name, o.private, o.user_id FROM notes n JOIN objects o ON o.id=n.object_id WHERE n.user_id=? AND o.user_id<>? ORDER BY n.created_at DESC LIMIT 30').all(u.id, u.id))
        if (canSee(n, me)) acts.push({ at: n.created_at, html: `collected <a href="/o/${n.id}">${esc(n.name)}</a>` });
      for (const x of q(MARK_SQL + ' WHERE m.user_id=? ORDER BY m.id DESC LIMIT 30').all(u.id))
        if (!x.private || owner) acts.push({ at: x.created_at, card: null, html: null, mark: x });
      for (const f of q('SELECT f.created_at, u2.handle FROM follows f JOIN users u2 ON u2.id=f.followee_id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 20').all(u.id))
        acts.push({ at: f.created_at, html: `followed <a href="/u/${esc(f.handle)}">${esc(f.handle)}</a>` });
      acts.sort((a, b) => (a.at < b.at ? 1 : -1));
      main = `<h3 class="strip">All activity</h3>
      <div class="activity-feed" id="feed-grid">${pageOf(acts, url).slice.map((a) => a.mark
        ? `<div class="act-note">${markCard(a.mark, me)}</div>`
        : a.card
        ? `<div class="act-note">${objectCard(a.card, me)}</div>`
        : `<div class="act-line"><span class="act-date">${timeAgo(a.at)}</span><span>${esc(u.handle)} ${a.html}</span></div>`).join('')}</div>${acts.length ? '' : emptyState(me, 'activity', u)}`;
    } 
    const body = `<div class="cols profile-cols">${profileRail(u, me, tab)}
  <section class="feed profile-feed is-tiled">${main}</section>
</div>`;
    send(res, layout({ title: u.handle, body, me, nav: me && me.id === u.id ? 'profile' : '' }));
  },

  login(req, res, me, err = '') {
    const body = `<h3 class="strip dark-strip">Sign in</h3>
<div class="settings">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <form method="post" action="/login" class="wtable settings-table">
    <div class="wcell wcell-wide">
      <label class="slabel">Email<input name="email" type="email" required autofocus></label>
      <label class="slabel">Password<input name="password" type="password" required></label>
      <button class="btn3d block">Sign in</button>
    </div>
    <div class="wcell wcell-wide"><p class="fine center">Have an invite code? <a href="/join">Join discriminant.ly</a></p></div>
  </form>
</div>`;
    send(res, layout({ title: 'Sign in', body, me, cls: 'is-dark-page' }));
  },

  join(req, res, me, code = '', err = '') {
    const body = `<h3 class="strip dark-strip">Join discriminant.ly</h3>
<div class="settings">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <form method="post" action="/join" class="wtable settings-table">
    <div class="wcell wcell-wide">
      <p class="fine center join-intro">Membership is by invitation. Enter the code a member sent you.</p>
      <label class="slabel">Invite code<input name="code" value="${esc(code)}" required></label>
      <label class="slabel">Your name<input name="name" required></label>
      <label class="slabel">Handle<input name="handle" required pattern="[a-z0-9]{2,24}" title="lowercase letters and numbers"></label>
      <label class="slabel">Email<input name="email" type="email" required></label>
      <label class="slabel">Password<input name="password" type="password" required minlength="8"></label>
      <button class="btn3d block">Create account</button>
    </div>
    <div class="wcell wcell-wide"><p class="fine center">Already a member? <a href="/login">Sign in</a></p></div>
  </form>
</div>`;
    send(res, layout({ title: 'Join', body, me, cls: 'is-dark-page' }));
  },

  invites(req, res, me) {
    const mine = q('SELECT * FROM invites WHERE from_user=? ORDER BY created_at DESC').all(me.id);
    const unused = mine.filter((i) => !i.used_by);
    const body = `<h3 class="strip dark-strip">Invites</h3>
<div class="settings">
  <div class="wtable settings-table">
    <div class="wcell wcell-wide">
      <p class="sbox-title">Bring someone in</p>
      <p class="sbox-sub">Each member may hold a few open invites at a time.</p>
      <form method="post" action="/invites"><button class="btn3d block" ${unused.length >= 5 ? 'disabled' : ''}>Create an invite</button></form>
      <p class="fine center">${unused.length} of 5 open</p>
    </div>
  </div>
  ${mine.length ? `<div class="wtable settings-table">
    <div class="wcell wcell-wide">
      <p class="sbox-title">Your invites</p>
      ${mine.map((i) => `<div class="invite-row">
        ${i.used_by
          ? `<p class="fine center">Used by @${esc(q('SELECT handle FROM users WHERE id=?').get(i.used_by).handle)}</p>`
          : `<p class="conn-url"><code>${esc(baseUrl(req))}/join?code=${i.code}</code></p>`}
      </div>`).join('')}
    </div>
  </div>` : ''}
</div>`;
    send(res, layout({ title: 'Invites', body, me, cls: 'is-dark-page' }));
  },

  settings(req, res, me, err = '') {
    const body = `<h3 class="strip dark-strip">Your Account Settings</h3>
<div class="settings">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <form method="post" action="/settings" class="wtable settings-table">
    <div class="wcell wcell-wide">
      <button type="button" class="avatar-pick" id="avatar-pick" title="Change profile image">${avatar(me, 'avatar big')}<span class="avatar-pick-hint">Change</span></button>
      <p class="lbl set-cap">Change profile image</p>
      <label class="slabel">Image URL<input name="avatar" id="avatar-url" value="${esc(me.avatar)}" placeholder="https:// or upload a photo"></label>
    </div>
    <div class="wcell wcell-wide">
      <label class="slabel">Email:<input value="${esc(me.email)}" disabled></label>
      <label class="slabel">Username:<input value="${esc(me.handle)}" disabled></label>
      <label class="slabel">Name:<input name="name" value="${esc(me.name)}" required></label>
      <label class="slabel">City:<input name="city" value="${esc(me.city)}"></label>
      <label class="slabel">Website:<input name="site" type="url" value="${esc(me.site)}" placeholder="https://"></label>
      <label class="slabel">About you:<textarea name="bio" rows="3" maxlength="300">${esc(me.bio)}</textarea></label>
      <button class="btn3d block">Save changes</button>
    </div>
  </form>
  <div class="wtable settings-table">
    <div class="wcell wcell-wide">
      <p class="sbox-title">The Connector</p>
      <p class="sbox-sub">Add this URL to Claude or ChatGPT to Note things directly from any conversation</p>
      ${me.api_token ? `<p class="conn-url"><code>${esc(baseUrl(req))}/mcp/${esc(me.api_token)}</code></p>` : '<p class="empty center">No connector URL yet.</p>'}
      <p class="fine center">Claude: Settings → Connectors → Add custom connector.<br>ChatGPT (paid plans): Settings → Connectors → Advanced → Developer mode, then Create → No authentication.<br>Treat the URL like a password.</p>
      <form method="post" action="/settings/token"><button class="btn3d block">${me.api_token ? 'Replace connector URL' : 'Create connector URL'}</button></form>
    </div>
    <div class="wcell wcell-wide"><a class="btn3d block" href="/invites">Invites</a></div>
    <div class="wcell wcell-wide"><form method="post" action="/logout"><button class="btn3d block">Sign out</button></form></div>
    <div class="wcell wcell-wide install-box" id="install-box" hidden>
      <p class="sbox-title">Install Discriminantly</p>
      <p class="sbox-sub">Keep it on your Home Screen and open it like an app.</p>
      <button type="button" class="btn3d block" id="install-btn">Install Discriminantly</button>
    </div>
  </div>
</div>
<div class="curtain dialog" id="install-dialog">
  <div class="curtain-frame"><div class="curtain-body">
    <div class="nf-box">
      <p class="dlg-title">Install Discriminantly</p>
      <p class="dlg-copy">Keep Discriminantly on your Home Screen and open it like an app.</p>
      <ol class="install-steps">
        <li>Tap the Share button</li>
        <li>Choose "Add to Home Screen"</li>
        <li>Tap "Add"</li>
      </ol>
      <button type="button" class="nf-post" data-dismiss-install>Got it</button>
      <p class="fine center">Once installed, Discriminantly opens without Safari's browser controls.</p>
    </div>
  </div></div>
  <div class="curtain-tail"><span class="tail-band"></span></div>
</div>
<script>
(function () {
  var box = document.getElementById('install-box');
  if (!box) return;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  function reveal() { if (!document.documentElement.classList.contains('is-app')) box.hidden = false; }
  if (isIOS || window.__installPrompt) reveal();
  document.addEventListener('discriminantly:install-available', reveal);
  document.addEventListener('discriminantly:installed', function () { box.hidden = true; });

  document.getElementById('install-btn').addEventListener('click', async function () {
    if (window.__installPrompt) {
      window.__installPrompt.prompt();
      await window.__installPrompt.userChoice;
      window.__installPrompt = null;
      box.hidden = true;
    } else if (isIOS) {
      document.getElementById('install-dialog').classList.add('is-open');
    }
  });
  var dlg = document.getElementById('install-dialog');
  dlg.querySelectorAll('[data-dismiss-install]').forEach(function (b) {
    b.addEventListener('click', function () { dlg.classList.remove('is-open'); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') dlg.classList.remove('is-open'); });
})();
</script>`;
    send(res, layout({ title: 'Settings', body, me, cls: 'is-dark-page', nav: 'settings' }));
  },

  welcome(req, res, me) {
    const body = `
<section class="splash">
  <img class="splash-mark" src="/mark.png" alt="" width="60" height="80">
  <p class="splash-word">discriminant.ly</p>
  <h1 class="splash-h">Your taste. Remembered.</h1>
  <p class="splash-sub">Keep the things you notice, the places you go, and the experiences worth remembering. Discriminantly builds a personal, portable memory of your taste—one that grows richer over time and travels with you.</p>
  <a class="btn splash-enter" href="/">Enter</a>
  <div class="splash-install" id="splash-install" hidden>
    <button type="button" class="nf-post" id="splash-install-btn">Install Discriminantly</button>
  </div>
</section>
<div class="shot-wrap">
  <div class="shot-shadow"></div>
  <div class="shot-frame">
    <div class="shot-chrome"><span></span><span></span><span></span></div>
    <img src="/welcome-shot.jpg" alt="Discriminantly on the desktop" width="1800" height="1055">
  </div>
</div>
<div class="curtain dialog" id="splash-install-dialog">
  <div class="curtain-frame"><div class="curtain-body">
    <div class="nf-box">
      <p class="dlg-title">Install Discriminantly</p>
      <p class="dlg-copy">Keep Discriminantly on your Home Screen and open it like an app.</p>
      <ol class="install-steps">
        <li>Tap the Share button</li>
        <li>Choose "Add to Home Screen"</li>
        <li>Tap "Add"</li>
      </ol>
      <button type="button" class="nf-post" data-dismiss-splash-install>Got it</button>
      <div class="nf-foot"><span></span><button type="button" class="nf-link-btn" data-dismiss-splash-install>Close</button></div>
    </div>
  </div></div>
  <div class="curtain-tail"><span class="tail-band"></span></div>
</div>
<script>
(function () {
  var box = document.getElementById('splash-install'), dlg = document.getElementById('splash-install-dialog');
  if (!box || !dlg) return;
  // Only offered on a phone or tablet, and never once already installed —
  // the demo shot below already makes the case on a desktop.
  var isMobile = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  if (isMobile && !document.documentElement.classList.contains('is-app')) box.hidden = false;
  document.getElementById('splash-install-btn').addEventListener('click', function () { dlg.classList.add('is-open'); });
  dlg.querySelectorAll('[data-dismiss-splash-install]').forEach(function (b) {
    b.addEventListener('click', function () { dlg.classList.remove('is-open'); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') dlg.classList.remove('is-open'); });
})();
</script>`;
    send(res, layout({ title: 'Welcome', body, me, cls: 'is-welcome' }));
  },

  about(req, res, me) {
    send(res, layout({ title: 'About', me, body: `<h1>About</h1><p>discriminant.ly was designed with a single focus: to serve as an elegant social sharing platform for its members to collect, share and discover the most interesting fine goods from around the world.</p><p>Every entry is one object, one maker, and one honest reason from the member who noted it. Nothing is sponsored. Membership is by invitation.</p>` }));
  },
};

const baseUrl = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

// ---------- MCP endpoint (Streamable HTTP, JSON-RPC) ----------
// One shared description for every `image` parameter, so the warning can't
// drift out of sync across tools. The failure this exists to prevent: an AI
// holds real image bytes (a file the member shared, or one it generated) and
// passes its own local file path straight through as if it were already a
// stored reference. That path only means something inside the AI's own
// environment — the resulting note renders a broken image, silently, days
// later, with no error at creation time to catch it.
const IMAGE_FIELD_DESC = 'An image reference: either a real https:// URL to an existing picture, or a /i/<id> reference returned by upload_image. If you have the image\'s actual bytes rather than a public URL — a file the member shared with you, or one you generated — call upload_image first and use its returned reference here. Never pass a local file path from your own environment (anything starting with /mnt/ or similar); that path only exists in this conversation and the image will not load once the note is saved.';

// ---- MCP output schemas -----------------------------------------------
// Written from the actual runtime shapes verified in the v1.14 audit, not
// from an idealized version of them. Where two tools return "the same"
// entity type with different fields (notes: recent_notes has handle+url,
// my_notes has url only, search_catalogue has neither; marks: my_travel_marks
// has verified+visit_count, search_catalogue has neither) — that difference
// is documented per-tool on purpose. Unifying those shapes is a runtime
// change, out of scope here; this only describes what already exists.
const OS_PROVENANCE = { type: ['object', 'null'], additionalProperties: false,
  required: ['action', 'assertion', 'actor_type', 'agent', 'created_at'],
  properties: { action: { type: 'string' }, assertion: { type: 'string' }, actor_type: { type: 'string' },
    agent: { type: 'string' }, created_at: { type: 'string' } } };
const OS_ITEMS = (itemSchema) => ({ type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: itemSchema } } });

const OS_RECENT_NOTE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'why', 'tags', 'url', 'handle', 'private', 'provenance'],
  properties: { type: { const: 'object' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, why: { type: 'string' }, tags: { type: 'string' }, url: { type: 'string' },
    handle: { type: 'string' }, private: { type: 'boolean' }, provenance: OS_PROVENANCE } };
const OS_MY_NOTE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'why', 'tags', 'url', 'private', 'provenance'],
  properties: { type: { const: 'object' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, why: { type: 'string' }, tags: { type: 'string' }, url: { type: 'string' },
    private: { type: 'boolean' }, provenance: OS_PROVENANCE } };
const OS_SEARCH_NOTE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'why', 'tags', 'private', 'provenance'],
  properties: { type: { const: 'object' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, why: { type: 'string' }, tags: { type: 'string' },
    private: { type: 'boolean' }, provenance: OS_PROVENANCE } };
const OS_SEARCH_MARK = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'locality', 'country', 'why', 'tags', 'private', 'remarked_from_uid', 'provenance'],
  properties: { type: { const: 'mark' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, locality: { type: 'string' }, country: { type: 'string' }, why: { type: 'string' },
    tags: { type: 'string' }, private: { type: 'boolean' }, remarked_from_uid: { type: ['string', 'null'] },
    provenance: OS_PROVENANCE } };
const OS_MARK = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'locality', 'country', 'why', 'tags', 'private', 'verified', 'remarked_from_uid', 'visit_count', 'provenance'],
  properties: { type: { const: 'mark' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, locality: { type: 'string' }, country: { type: 'string' }, why: { type: 'string' },
    tags: { type: 'string' }, private: { type: 'boolean' }, verified: { type: 'boolean' },
    remarked_from_uid: { type: ['string', 'null'] }, visit_count: { type: 'integer' }, provenance: OS_PROVENANCE } };
const OS_COLLECTION = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'name', 'kind', 'count', 'provenance'],   // no integer id — collections genuinely have none today
  properties: { type: { const: 'collection' }, uid: { type: 'string' }, name: { type: 'string' },
    kind: { type: 'string' }, count: { type: 'integer' }, provenance: OS_PROVENANCE } };
const OS_VISIT = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'visited_on', 'body', 'provenance'],
  properties: { type: { const: 'visit' }, uid: { type: 'string' }, id: { type: 'integer' },
    visited_on: { type: 'string' }, body: { type: 'string' }, provenance: OS_PROVENANCE } };
const OS_IMAGE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'ref', 'mime', 'bytes', 'provenance'],
  properties: { type: { const: 'image' }, uid: { type: 'string' }, id: { type: 'integer' },
    ref: { type: 'string' }, mime: { type: 'string' }, bytes: { type: 'integer' }, provenance: OS_PROVENANCE } };
const OS_STATS = { type: 'object', additionalProperties: false,
  required: ['notes', 'marks', 'notes_without_image', 'notes_by_collection', 'marks_by_country'],
  properties: { notes: { type: 'integer' }, marks: { type: 'integer' }, notes_without_image: { type: 'integer' },
    notes_by_collection: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'count'], properties: { name: { type: 'string' }, count: { type: 'integer' } } } },
    marks_by_country: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['country', 'count'], properties: { country: { type: 'string' }, count: { type: 'integer' } } } } } };

const TOOLS = [
  { name: 'note_object', description: 'Post a new note to discriminant.ly as the connected member. Use when the user wants to note, log, bookmark or post a fine object.',
    inputSchema: { type: 'object', required: ['headline', 'image'], properties: {
      headline: { type: 'string', description: 'Short headline: the object and maker, e.g. "Mauviel M\'250 copper saucepan"' },
      description: { type: 'string', description: 'One to three sentences: what it is and why it is worth noting, in the member\'s voice' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase tags, e.g. ["kitchen","copper","france"]' },
      link: { type: 'string', description: 'URL where the object can be found' },
      image: { type: 'string', description: IMAGE_FIELD_DESC + ' Required — every note carries an image.' },
      collections: { type: 'array', items: { type: 'string' }, description: 'Names of the member\'s collections to file this under (created if new). A note may sit in several.' },
      private: { type: 'boolean', description: 'True to keep the note visible only to the member' },
      allow_duplicate: { type: 'boolean', description: 'Set true only after the member confirms this is genuinely different from a similarly-named note the tool flagged.' } } } },
  { name: 'my_collections', description: 'List the connected member\'s collections with counts.', inputSchema: { type: 'object', properties: {} },
    outputSchema: OS_ITEMS(OS_COLLECTION) },
  { name: 'recent_notes', description: 'List the most recent notes on discriminant.ly (all members). Optional search query.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } } },
    outputSchema: OS_ITEMS(OS_RECENT_NOTE) },
  { name: 'my_notes', description: 'List the connected member\'s own notes.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 20 } } },
    outputSchema: OS_ITEMS(OS_MY_NOTE) },
  { name: 'edit_note', description: 'Edit a note the connected member owns. Only pass the fields being changed — anything omitted is left as is.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The note\'s id, e.g. from note_object\'s "Noted as #7" or from recent_notes/my_notes.' },
      headline: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      link: { type: 'string' },
      image: { type: 'string', description: IMAGE_FIELD_DESC },
      collections: { type: 'array', items: { type: 'string' }, description: 'Replaces the note\'s full set of collections.' },
      private: { type: 'boolean' } } } },
  { name: 'delete_note', description: 'Permanently delete a note the connected member owns. Cannot be undone.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  { name: 'edit_travel_mark', description: 'Edit a travel mark the connected member owns. Only pass the fields being changed — anything omitted is left as is. To log a new visit instead of changing the mark itself, use log_visit.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The mark\'s id, e.g. from add_travel_mark\'s "Marked #3" or from my_travel_marks/search_catalogue.' },
      place: { type: 'string' },
      locality: { type: 'string' },
      country: { type: 'string' },
      address: { type: 'string' },
      lat: { type: 'number' }, lng: { type: 'number' },
      why: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      link: { type: 'string' }, image: { type: 'string', description: IMAGE_FIELD_DESC },
      collections: { type: 'array', items: { type: 'string' }, description: 'Replaces the mark\'s full set of collections.' },
      private: { type: 'boolean' } } } },
  { name: 'delete_travel_mark', description: 'Permanently delete a travel mark the connected member owns, including its visit history. Cannot be undone.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
  { name: 'upload_image', description: 'Upload image bytes to Discriminantly and receive a stable reference. Call this first, then pass the returned reference as the image argument to note_object, edit_note, add_travel_mark, or edit_travel_mark. This tool does not create or modify a Note or Travel Mark by itself — it only stores an image and hands back where to find it.',
    inputSchema: { type: 'object', required: ['image'], properties: {
      image: { type: 'string', description: 'A data URL, e.g. "data:image/jpeg;base64,....". PNG, JPEG, WEBP, or GIF only, up to 6 MB decoded.' } } },
    outputSchema: OS_IMAGE },
  { name: 'verify_place', description: 'Check whether a place can be found in mapping data before adding it as a travel mark. Uses the same OpenStreetMap lookup as this app\'s own "search for a place" field — free, no business listings or opening hours, but a real geographic database rather than a guess. Call this before add_travel_mark whenever the member has not given a precise address, or whenever you are not confident the name/city is exactly right. Show the match (or the fact that nothing was found) to the member before writing anything. If several candidates come back, ask which one. If nothing comes back, say so plainly and ask whether to add it anyway without verification, or to try again with more detail — never invent coordinates or an address to fill the gap.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'The place name, ideally with its city, e.g. "Nahm restaurant Bangkok"' },
      limit: { type: 'integer', default: 5 } } } },
  { name: 'add_travel_mark', description: 'Add or create a new travel mark: record a place worth returning to — a restaurant, hotel, shop, view. Use this rather than note_object when the subject is somewhere the member went, not something they might own. Call verify_place first unless the member has given a precise address or you already know the place well; pass its coordinates through as lat/lng so the mark is grounded rather than guessed.',
    inputSchema: { type: 'object', required: ['place'], properties: {
      place: { type: 'string', description: 'Name of the place' },
      locality: { type: 'string', description: 'City or region. Fill this in yourself if you know the place — do not make the member supply it.' },
      country: { type: 'string', description: 'Fill in from your own knowledge of the place where possible.' },
      address: { type: 'string', description: 'Street address if known.' },
      lat: { type: 'number', description: 'Latitude if known; enables the map on the card.' },
      lng: { type: 'number' },
      why: { type: 'string', description: 'Why it is worth returning to, written in the member\'s voice from what they said. If they were vague, draw on the conversation and on what you know of the place to write two useful sentences — what it is, what to order or do, what makes it worth the return.' },
      tags: { type: 'array', items: { type: 'string' } },
      link: { type: 'string' }, image: { type: 'string', description: IMAGE_FIELD_DESC },
      collections: { type: 'array', items: { type: 'string' } },
      visited_on: { type: 'string', description: 'YYYY-MM-DD. Defaults to today; logs the first visit.' },
      private: { type: 'boolean' },
      allow_duplicate: { type: 'boolean', description: 'Set true only after the member confirms this is genuinely different from a similarly-named mark the tool flagged.' } } } },
  { name: 'log_visit', description: 'Add a visit to an existing travel mark. Use when the member returns somewhere they have already marked. Keep it light — a date is enough, and a line about it is optional.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer' },
      visited_on: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      body: { type: 'string', description: 'One line, only if the member said something worth keeping.' } } } },
  { name: 'list_checkins', description: 'List the check-ins on a travel mark the member owns, most recent first. Use this to find a specific check-in\'s id before editing or deleting it — no other tool exposes individual check-in ids.',
    inputSchema: { type: 'object', required: ['mark_id'], properties: {
      mark_id: { type: 'integer', description: 'The travel mark\'s id.' } } },
    outputSchema: OS_ITEMS(OS_VISIT) },
  { name: 'edit_checkin', description: 'Edit a check-in the member owns, identified by its own id (from list_checkins). Only pass the fields being changed — visited_on, body, or both. Anything omitted is left as is.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The check-in\'s id, from list_checkins.' },
      visited_on: { type: 'string', description: 'YYYY-MM-DD. Must be a real calendar date.' },
      body: { type: 'string' } } } },
  { name: 'delete_checkin', description: 'Permanently delete a single check-in the member owns. Does not affect the travel mark itself or its other check-ins. Cannot be undone.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer' } } } },
  { name: 'my_travel_marks', description: 'List the connected member\'s travel marks with visit counts. Optional search across place, city, country and tags.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 20 } } },
    outputSchema: OS_ITEMS(OS_MARK) },
  { name: 'search_catalogue', description: 'Search the connected member\'s own notes and travel marks — the actual catalogue, not just recent entries. Searches title, description, tags, and (for marks) city and country. Use this whenever the member asks what they have noted or marked about something, before adding something new to check whether it already exists, or to find an item to edit when only given a rough description.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'Keywords to search for, e.g. "copper pan" or "bangkok"' },
      kind: { type: 'string', enum: ['note', 'mark', 'both'], default: 'both', description: 'Restrict to notes, travel marks, or search both.' },
      limit: { type: 'integer', default: 15 } } },
    outputSchema: OS_ITEMS({ oneOf: [OS_SEARCH_NOTE, OS_SEARCH_MARK] }) },
  { name: 'catalogue_stats', description: 'Counts and breakdowns of the connected member\'s catalogue: totals, notes by collection, marks by country, and how many entries have no image. Use this for "how many" or "what is my" questions rather than counting a list yourself.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: OS_STATS },
];
// Duplicate detection: a cheap normalized-string match rather than a new
// dependency. Catches "de Buyer Mineral B" vs "de Buyer Mineral B Pro, 28cm"
// — the common way a catalogue quietly forks the same object into two rows.
const normTitle = (s) => String(s || '').toLowerCase()
  .replace(/['’]/g, '')                // apostrophes vanish rather than splitting the word: M'250 and M250 must match
  .replace(/[^a-z0-9]+/g, ' ').trim();
function findSimilarNote(userId, title) {
  const norm = normTitle(title);
  if (!norm) return null;
  for (const r of q('SELECT id, name FROM objects WHERE user_id=?').all(userId)) {
    const rn = normTitle(r.name);
    if (rn && (rn === norm || rn.includes(norm) || norm.includes(rn))) return r;
  }
  return null;
}
function findSimilarMark(userId, place) {
  const norm = normTitle(place);
  if (!norm) return null;
  for (const r of q('SELECT id, name FROM marks WHERE user_id=?').all(userId)) {
    const rn = normTitle(r.name);
    if (rn && (rn === norm || rn.includes(norm) || norm.includes(rn))) return r;
  }
  return null;
}

async function mcpCall(user, name, a = {}) {
  const fmt = (o) => `#${o.id} ${o.name} — ${o.why}${o.tags ? ` [${o.tags}]` : ''}${o.url ? ` ${o.url}` : ''} (by ${o.handle}, ${o.created_at})`;
  if (name === 'note_object') {
    if (!a.headline) throw new Error('headline is required');
    if (!a.image) throw new Error('image is required: every note carries an image');
    if (!a.allow_duplicate) {
      const dup = findSimilarNote(user.id, a.headline);
      if (dup) return `This looks like it may already be noted: #${dup.id} "${dup.name}". If it's genuinely a different item, call note_object again with allow_duplicate: true.`;
    }
    const r = q('INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,?,?,?,?,?)').run(user.id, String(a.headline).trim(), String(a.description || '').trim(), tagList(Array.isArray(a.tags) ? a.tags.join(',') : a.tags).join(', '), a.link || '', a.image || '', a.private ? 1 : 0);
    q('INSERT OR IGNORE INTO notes(user_id,object_id) VALUES(?,?)').run(user.id, r.lastInsertRowid);
    if (Array.isArray(a.collections)) setCollections(user.id, r.lastInsertRowid, a.collections);
    recordProvenance('object', uidOf('objects', r.lastInsertRowid), 'created', mcpActor(user),
      { source_kind: a.link ? 'unfurl' : 'manual', source_ref: a.link || null });
    return `Noted as #${r.lastInsertRowid}: ${a.headline}${a.private ? ' (private)' : ''}${Array.isArray(a.collections) && a.collections.length ? ' in ' + a.collections.join(', ') : ''}`;
  }
  if (name === 'recent_notes') {
    const lim = Math.min(+a.limit || 10, 50); const sq = (a.query || '').trim();
    const rows = sq ? q(OBJ_SQL + ' WHERE o.private=0 AND (o.name LIKE ? OR o.why LIKE ? OR o.tags LIKE ?) ORDER BY o.id DESC LIMIT ?').all(`%${sq}%`, `%${sq}%`, `%${sq}%`, lim) : q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC LIMIT ?').all(lim);
    return { text: rows.map(fmt).join('\n') || 'No notes yet.',
      structured: { items: rows.map((o) => ({ type: 'object', uid: o.uid, id: o.id, name: o.name, why: o.why,
        tags: o.tags, url: o.url, handle: o.handle, private: !!o.private, provenance: provenanceOf('object', o.uid) })) } };
  }
  if (name === 'my_collections') {
    const rows = q(`SELECT c.uid, c.name, c.kind,
        (SELECT COUNT(*) FROM object_collections oc WHERE oc.collection_id=c.id) n
      FROM collections c WHERE c.user_id=? ORDER BY c.name`).all(user.id);
    return { text: rows.map((c) => `${c.name} (${c.n})`).join('\n') || 'No collections yet.',
      structured: { items: rows.map((c) => ({ type: 'collection', uid: c.uid, name: c.name, kind: c.kind || 'note',
        count: c.n, provenance: provenanceOf('collection', c.uid) })) } };
  }
  if (name === 'my_notes') {
    const rows = q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC LIMIT ?').all(user.id, Math.min(+a.limit || 20, 50));
    return { text: rows.map(fmt).join('\n') || 'No notes yet.',
      structured: { items: rows.map((o) => ({ type: 'object', uid: o.uid, id: o.id, name: o.name, why: o.why,
        tags: o.tags, url: o.url, private: !!o.private, provenance: provenanceOf('object', o.uid) })) } };
  }
  if (name === 'edit_note') {
    if (!a.id) throw new Error('id is required');
    const o = q('SELECT * FROM objects WHERE id=?').get(a.id);
    if (!o) throw new Error(`No note #${a.id}`);
    if (o.user_id !== user.id) throw new Error(`Note #${a.id} does not belong to this member`);
    const name_ = a.headline !== undefined ? String(a.headline).trim() : o.name;
    const why = a.description !== undefined ? String(a.description).trim() : o.why;
    const tags = a.tags !== undefined ? tagList(Array.isArray(a.tags) ? a.tags.join(',') : a.tags).join(', ') : o.tags;
    const url = a.link !== undefined ? a.link : o.url;
    const image = a.image !== undefined ? a.image : o.image;
    const priv = a.private !== undefined ? (a.private ? 1 : 0) : o.private;
    q('UPDATE objects SET name=?,why=?,tags=?,url=?,image=?,private=? WHERE id=?').run(name_, why, tags, url, image, priv, o.id);
    if (Array.isArray(a.collections)) setCollections(user.id, o.id, a.collections);
    recordProvenance('object', o.uid, 'edited', mcpActor(user), { source_kind: 'manual' });
    return `Updated #${o.id}: ${name_}`;
  }
  if (name === 'upload_image') {
    if (!a.image) throw new Error('image is required');
    const ref = storeImage(user.id, a.image, mcpActor(user));
    if (!ref) throw new Error('Could not store that image — check it is PNG, JPEG, WEBP, or GIF, matches its declared type, and is under 6 MB.');
    const idNum = +ref.split('/')[2];
    const img = q('SELECT uid, mime, length(bytes) AS bytes FROM images WHERE id=?').get(idNum);
    return { text: `Uploaded: ${ref} (${img.mime}, ${Math.round(img.bytes / 1024)} KB)`,
      structured: { type: 'image', uid: img.uid, id: idNum, ref, mime: img.mime, bytes: img.bytes,
        provenance: provenanceOf('image', img.uid) } };
  }
  if (name === 'verify_place') {
    const q_ = String(a.query || '').trim();
    if (!q_) throw new Error('query is required');
    const lim = Math.min(+a.limit || 5, 10);
    try {
      const r = await fetch(`https://photon.komoot.io/api/?limit=${lim}&q=${encodeURIComponent(q_)}`,
        { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return `Could not reach the mapping service (status ${r.status}). Tell the member verification failed and ask whether to add the mark anyway.`;
      const data = await r.json();
      const feats = Array.isArray(data.features) ? data.features : [];
      if (!feats.length) return `No match found for "${q_}" in mapping data. This does not mean the place is wrong — small or new places are often missing from OpenStreetMap. Tell the member plainly and ask whether to add it anyway without verification, or to try again with a more precise name or city.`;
      return feats.map((f, i) => {
        const p = f.properties || {};
        const where = [p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country].filter(Boolean).join(', ');
        const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
        return `${i + 1}. ${p.name || q_}${where ? ' — ' + where : ''}${lat != null ? ` (${lat.toFixed(5)}, ${lng.toFixed(5)})` : ''}`;
      }).join('\n') + '\n\nShow these to the member and confirm which one (if any) is correct before calling add_travel_mark with its address and coordinates.';
    } catch (e) {
      return `Could not reach the mapping service (${e.name === 'TimeoutError' ? 'timed out' : 'network error'}). Tell the member verification failed and ask whether to add the mark anyway.`;
    }
  }
  if (name === 'add_travel_mark') {
    if (!a.place) throw new Error('place is required');
    if (!a.allow_duplicate) {
      const dup = findSimilarMark(user.id, a.place);
      if (dup) return `This looks like it may already be marked: #${dup.id} "${dup.name}". If it's a genuinely different place, call add_travel_mark again with allow_duplicate: true — or if the member is returning, use log_visit on #${dup.id} instead.`;
    }
    // Coordinates being supplied is not the same claim as "this was checked
    // against mapping data" — verified defaults to 0 here exactly as it does
    // on the web path. Provenance records the coordinates honestly below,
    // without asserting a verification that did not happen.
    const r = q('INSERT INTO marks(user_id,name,locality,country,address,lat,lng,why,tags,url,image,private,verified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(user.id, String(a.place).trim(), a.locality || '', a.country || '', a.address || '',
           a.lat ?? null, a.lng ?? null, String(a.why || '').trim(),
           tagList(Array.isArray(a.tags) ? a.tags.join(',') : a.tags).join(', '), a.link || '', a.image || '', a.private ? 1 : 0, 0);
    if (Array.isArray(a.collections)) setMarkCollections(user.id, r.lastInsertRowid, a.collections);
    const day = a.visited_on || new Date().toISOString().slice(0, 10);
    q('INSERT INTO visits(mark_id,user_id,visited_on,body) VALUES(?,?,?,?)').run(r.lastInsertRowid, user.id, day, '');
    recordProvenance('mark', uidOf('marks', r.lastInsertRowid), 'created', mcpActor(user),
      { source_kind: 'manual' });
    // A verification claim must name what it rests on. Coordinates supplied by
    // the caller are evidence of coordinates, not proof a lookup happened — so
    // the source is recorded as 'coordinates_supplied', never 'photon', unless
    // a lookup is what actually produced them.
    if (a.lat != null && a.lng != null) {
      recordProvenance('mark', uidOf('marks', r.lastInsertRowid), 'enriched',
        { actor_type: 'system', actor_user_id: user.id, agent: 'mcp:claude',
          auth_method: 'mcp_token', assertion: 'derived' },
        { source_kind: 'coordinates_supplied', source_ref: `${a.lat},${a.lng}` });
    }
    recordProvenance('visit', uidOf('visits', q('SELECT MAX(id) i FROM visits').get().i), 'created', mcpActor(user),
      { source_kind: 'manual' });
    const verifiedNote = a.lat != null && a.lng != null ? '' : ' — not verified against mapping data; mention this to the member';
    return `Marked #${r.lastInsertRowid}: ${a.place}${a.locality ? ', ' + a.locality : ''} (first visit ${day})${verifiedNote}`;
  }
  if (name === 'edit_travel_mark') {
    if (!a.id) throw new Error('id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.id);
    if (!mk) throw new Error(`No travel mark #${a.id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.id} does not belong to this member`);
    const name_ = a.place !== undefined ? String(a.place).trim() : mk.name;
    const locality = a.locality !== undefined ? a.locality : mk.locality;
    const country = a.country !== undefined ? a.country : mk.country;
    const address = a.address !== undefined ? a.address : mk.address;
    const lat = a.lat !== undefined ? a.lat : mk.lat;
    const lng = a.lng !== undefined ? a.lng : mk.lng;
    const why = a.why !== undefined ? String(a.why).trim() : mk.why;
    const tags = a.tags !== undefined ? tagList(Array.isArray(a.tags) ? a.tags.join(',') : a.tags).join(', ') : mk.tags;
    const url = a.link !== undefined ? a.link : mk.url;
    const image = a.image !== undefined ? a.image : mk.image;
    const priv = a.private !== undefined ? (a.private ? 1 : 0) : mk.private;
    q('UPDATE marks SET name=?,locality=?,country=?,address=?,lat=?,lng=?,why=?,tags=?,url=?,image=?,private=? WHERE id=?')
      .run(name_, locality, country, address, lat, lng, why, tags, url, image, priv, mk.id);
    if (Array.isArray(a.collections)) setMarkCollections(user.id, mk.id, a.collections);
    recordProvenance('mark', mk.uid, 'edited', mcpActor(user), { source_kind: 'manual' });
    return `Updated #${mk.id}: ${name_}`;
  }
  if (name === 'delete_travel_mark') {
    if (!a.id) throw new Error('id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.id);
    if (!mk) throw new Error(`No travel mark #${a.id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.id} does not belong to this member`);
    recordProvenance('mark', mk.uid, 'deleted', mcpActor(user));
    q('DELETE FROM marks WHERE id=?').run(mk.id);
    return `Deleted #${mk.id}: ${mk.name}`;
  }
  if (name === 'log_visit') {
    if (!a.id) throw new Error('id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.id);
    if (!mk) throw new Error(`No travel mark #${a.id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.id} does not belong to this member`);
    const day = a.visited_on || new Date().toISOString().slice(0, 10);
    const v = q('INSERT INTO visits(mark_id,user_id,visited_on,body) VALUES(?,?,?,?)').run(mk.id, user.id, day, String(a.body || '').trim());
    recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', mcpActor(user), { source_kind: 'manual' });
    const n = q('SELECT COUNT(*) c FROM visits WHERE mark_id=?').get(mk.id).c;
    return `Logged a visit to ${mk.name} on ${day} — ${n} ${n === 1 ? 'visit' : 'visits'} total`;
  }
  if (name === 'list_checkins') {
    if (!a.mark_id) throw new Error('mark_id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.mark_id);
    if (!mk) throw new Error(`No travel mark #${a.mark_id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.mark_id} does not belong to this member`);
    const vs = markVisits(mk.id);   // already ordered visited_on DESC, id DESC — reused as-is
    return { text: vs.map((v) => `#${v.id} ${v.visited_on}${v.body ? ` — ${v.body}` : ''}`).join('\n')
        || 'No check-ins yet.',
      structured: { items: vs.map((v) => ({ type: 'visit', uid: v.uid, id: v.id,
        visited_on: v.visited_on, body: v.body, provenance: provenanceOf('visit', v.uid) })) } };
  }
  if (name === 'edit_checkin') {
    if (!a.id) throw new Error('id is required');
    // Ownership runs through the parent mark, not visits.user_id, so a
    // check-in can never be edited by anyone but the mark's owner.
    const v = q(`SELECT v.*, m.user_id AS mark_owner FROM visits v
      JOIN marks m ON m.id = v.mark_id WHERE v.id = ?`).get(a.id);
    if (!v) throw new Error(`No such check-in #${a.id}`);
    if (v.mark_owner !== user.id) throw new Error(`Check-in #${a.id} does not belong to this member`);
    if (a.visited_on !== undefined && !isValidCalendarDate(a.visited_on))
      throw new Error(`"${a.visited_on}" is not a real calendar date — use YYYY-MM-DD.`);
    const changed = [];
    const visited_on = a.visited_on !== undefined ? a.visited_on : v.visited_on;
    const body = a.body !== undefined ? String(a.body).trim() : v.body;
    if (visited_on !== v.visited_on) changed.push('visited_on');
    if (body !== v.body) changed.push('body');
    if (changed.length) {
      q('UPDATE visits SET visited_on=?, body=? WHERE id=?').run(visited_on, body, v.id);
      recordProvenance('visit', v.uid, 'edited', mcpActor(user), { source_kind: 'manual', fields: changed.join(',') });
    }
    return `Updated check-in #${v.id}: ${visited_on}${body ? ` — ${body}` : ''}`;
  }
  if (name === 'delete_checkin') {
    if (!a.id) throw new Error('id is required');
    const v = q(`SELECT v.*, m.user_id AS mark_owner FROM visits v
      JOIN marks m ON m.id = v.mark_id WHERE v.id = ?`).get(a.id);
    if (!v) throw new Error(`No such check-in #${a.id}`);
    if (v.mark_owner !== user.id) throw new Error(`Check-in #${a.id} does not belong to this member`);
    recordProvenance('visit', v.uid, 'deleted', mcpActor(user));
    q('DELETE FROM visits WHERE id=?').run(v.id);
    return `Deleted check-in #${v.id}`;
  }
  if (name === 'my_travel_marks') {
    const lim = Math.min(+a.limit || 20, 50); const k = (a.query || '').trim().toLowerCase();
    let rows = q(MARK_SQL + ' WHERE m.user_id=? ORDER BY m.id DESC').all(user.id);
    if (k) rows = rows.filter((x) => (x.name + ' ' + x.why + ' ' + x.tags + ' ' + x.locality + ' ' + x.country).toLowerCase().includes(k));
    const top = rows.slice(0, lim);
    return { text: top.map((x) => {
        const vs = markVisits(x.id);
        return `#${x.id} ${x.name}${placeLine(x) ? ' — ' + placeLine(x) : ''}${x.why ? ` — ${x.why}` : ''} [${vs.length} ${vs.length === 1 ? 'visit' : 'visits'}${vs[0] ? ', last ' + vs[0].visited_on : ''}]`;
      }).join('\n') || 'No travel marks yet.',
      structured: { items: top.map((x) => ({ type: 'mark', uid: x.uid, id: x.id, name: x.name, locality: x.locality,
        country: x.country, why: x.why, tags: x.tags, private: !!x.private, verified: !!x.verified,
        remarked_from_uid: x.remarked_from_uid || null, visit_count: markVisits(x.id).length,
        provenance: provenanceOf('mark', x.uid) })) } };
  }
  if (name === 'search_catalogue') {
    const k = String(a.query || '').trim();
    if (!k) throw new Error('query is required');
    const lim = Math.min(+a.limit || 15, 50);
    const kind = a.kind === 'note' || a.kind === 'mark' ? a.kind : 'both';
    const kl = k.toLowerCase();
    const hits = [];
    if (kind !== 'mark') {
      q(OBJ_SQL + ' WHERE o.user_id=? AND (o.name LIKE ? OR o.why LIKE ? OR o.tags LIKE ?) ORDER BY o.id DESC')
        .all(user.id, `%${k}%`, `%${k}%`, `%${k}%`)
        .forEach((o) => hits.push({ at: o.created_at,
          line: `NOTE #${o.id} ${o.name} — ${o.why}${o.tags ? ` [${o.tags}]` : ''}`,
          item: { type: 'object', uid: o.uid, id: o.id, name: o.name, why: o.why, tags: o.tags, private: !!o.private } }));
    }
    if (kind !== 'note') {
      q(MARK_SQL + ' WHERE m.user_id=?').all(user.id)
        .filter((x) => (x.name + ' ' + x.why + ' ' + x.tags + ' ' + x.locality + ' ' + x.country).toLowerCase().includes(kl))
        .forEach((x) => hits.push({ at: x.created_at,
          line: `MARK #${x.id} ${x.name}${placeLine(x) ? ' — ' + placeLine(x) : ''}${x.why ? ` — ${x.why}` : ''}`,
          item: { type: 'mark', uid: x.uid, id: x.id, name: x.name, locality: x.locality, country: x.country,
                  why: x.why, tags: x.tags, private: !!x.private, remarked_from_uid: x.remarked_from_uid || null } }));
    }
    hits.sort((x, y) => (x.at < y.at ? 1 : -1));
    const top = hits.slice(0, lim);
    return {
      text: top.map((h) => h.line).join('\n') || `Nothing in the catalogue matches "${k}".`,
      structured: { items: top.map((h) => ({ ...h.item, provenance: provenanceOf(h.item.type, h.item.uid) })) },
    };
  }
  if (name === 'catalogue_stats') {
    const notes = q('SELECT COUNT(*) c FROM objects WHERE user_id=?').get(user.id).c;
    const marks = q('SELECT COUNT(*) c FROM marks WHERE user_id=?').get(user.id).c;
    const noImage = q("SELECT COUNT(*) c FROM objects WHERE user_id=? AND (image IS NULL OR image='')").get(user.id).c;
    const byColl = q(`SELECT c.name, COUNT(*) n FROM object_collections oc
      JOIN collections c ON c.id=oc.collection_id JOIN objects o ON o.id=oc.object_id
      WHERE o.user_id=? GROUP BY c.id ORDER BY n DESC`).all(user.id);
    const byCountry = q("SELECT country, COUNT(*) n FROM marks WHERE user_id=? AND country<>'' GROUP BY country ORDER BY n DESC").all(user.id);
    const lines = [`${notes} notes, ${marks} travel marks.`];
    if (noImage) lines.push(`${noImage} note${noImage === 1 ? '' : 's'} with no image.`);
    if (byColl.length) lines.push('Notes by collection: ' + byColl.map((r) => `${r.name} (${r.n})`).join(', '));
    if (byCountry.length) lines.push('Marks by country: ' + byCountry.map((r) => `${r.country} (${r.n})`).join(', '));
    // An aggregate has no single provenance — it summarises many rows, not one.
    // Structured form carries the counts as data rather than only as prose.
    return { text: lines.join('\n'),
      structured: { notes, marks, notes_without_image: noImage,
        notes_by_collection: byColl.map((r) => ({ name: r.name, count: r.n })),
        marks_by_country: byCountry.map((r) => ({ country: r.country, count: r.n })) } };
  }
  if (name === 'delete_note') {
    if (!a.id) throw new Error('id is required');
    const o = q('SELECT * FROM objects WHERE id=?').get(a.id);
    if (!o) throw new Error(`No note #${a.id}`);
    if (o.user_id !== user.id) throw new Error(`Note #${a.id} does not belong to this member`);
    recordProvenance('object', o.uid, 'deleted', mcpActor(user));
    q('DELETE FROM objects WHERE id=?').run(o.id);
    return `Deleted #${a.id}: ${o.name}`;
  }
  throw new Error('Unknown tool ' + name);
}
async function mcp(req, res, tok) {
  const user = q('SELECT * FROM users WHERE api_token=?').get(tok);
  if (!user) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"invalid token"}'); }
  if (req.method === 'GET') { res.writeHead(405); return res.end(); }
  if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
  const reply = (id, result, error) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })); };
  if (Array.isArray(msg) || msg.id === undefined) { res.writeHead(202); return res.end(); } // notifications
  const { id, method, params = {} } = msg;
  if (method === 'initialize') return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'discriminant.ly', version: '1.3' }, instructions: `You are connected to discriminant.ly as ${user.name} (@${user.handle}). When the user wants to note an object, write a crisp headline and a short description in their voice, propose tags, and call note_object. Notes are objects; travel marks are places the member went — use add_travel_mark and log_visit for those, and edit_travel_mark/delete_travel_mark to change or remove one. Before adding a travel mark, call verify_place unless you already have a precise address — show the member the match (or the fact that nothing was found) and get their confirmation before writing; never invent coordinates. Both note_object and add_travel_mark also check for a similarly-named existing entry and will decline with a message rather than create a duplicate; if that happens, tell the user what already exists and ask before retrying with allow_duplicate. Before answering any question about what the member has already catalogued — "have I noted...", "what's in my...", "how many..." — call search_catalogue or catalogue_stats rather than guessing from memory or only checking recent_notes. Use edit_note to change an existing note (only pass the fields being changed) and delete_note to remove one — both require the note's id and only work on this member's own notes. Confirm with the user before deleting anything.` });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const out = await mcpCall(user, params.name, params.arguments);
      // Text stays exactly as it was, so existing clients are unaffected.
      // structuredContent is additive and carries provenance, so the six
      // questions in the MCP Policy remain answerable inside the AI's context
      // rather than only inside our database.
      const payload = { content: [{ type: 'text', text: typeof out === 'string' ? out : out.text }] };
      if (out && typeof out === 'object' && out.structured) payload.structuredContent = out.structured;
      return reply(id, payload);
    } catch (e) { return reply(id, { content: [{ type: 'text', text: e.message }], isError: true }); }
  }
  return reply(id, null, { code: -32601, message: 'Method not found' });
}

// ---------- router ----------
const STATIC = { '/style.css': 'text/css', '/mark.png': 'image/png', '/nub.png': 'image/png', '/favicon.png': 'image/png', '/apple-touch-icon.png': 'image/png', '/icon-192.png': 'image/png', '/icon-256.png': 'image/png', '/icon-512.png': 'image/png', '/icon-512-maskable.png': 'image/png', '/plus.png': 'image/png', '/plus-sm.png': 'image/png', '/minus.png': 'image/png', '/chev.png': 'image/png', '/close.png': 'image/png', '/sw.js': 'application/javascript', '/manifest.webmanifest': 'application/manifest+json', '/welcome-shot.jpg': 'image/jpeg' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  // HEAD is routed as GET, with the body suppressed — uptime checks and link
  // checkers use it, and it should answer like the GET it mirrors.
  const isHead = req.method === 'HEAD';
  const m = isHead ? 'GET' : req.method;
  if (isHead) { const end = res.end.bind(res); res.end = () => end(); }
  const me = currentUser(req);
  const need = () => { redirect(res, '/login'); return true; };
  let mt;

  if ((mt = p.match(/^\/i\/(\d+)$/))) {
    const img = q('SELECT mime, bytes FROM images WHERE id=?').get(+mt[1]);
    if (!img) return send(res, 'Not found', 404);
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': img.bytes.length,
      'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.end(Buffer.from(img.bytes));
  }
  if ((mt = p.match(/^\/avatars\/([a-z0-9_-]+\.png)$/))) {
    const f = path.join(__dirname, 'public', 'avatars', mt[1]);
    if (!fs.existsSync(f)) return send(res, 'Not found', 404);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(f).pipe(res);
  }
  if ((mt = p.match(/^\/seed\/([a-z0-9_-]+\.jpg)$/))) {
    const f = path.join(__dirname, 'public', 'seed', mt[1]);
    if (!fs.existsSync(f)) return send(res, 'Not found', 404);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(f).pipe(res);
  }
  if (STATIC[p]) {
    const versioned = url.searchParams.has('v');
    res.writeHead(200, { 'Content-Type': STATIC[p],
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300' });
    return fs.createReadStream(path.join(__dirname, 'public', p)).pipe(res);
  }
  if (m === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 'Bad origin', 403);

  if ((mt = p.match(/^\/mcp\/([A-Za-z0-9_-]+)$/))) return mcp(req, res, mt[1]);
  // Read a page's Open Graph tags so a pasted link can fill the form. Done on
  // the server because the browser cannot fetch other origins.
  if (p === '/api/unfurl' && m === 'GET') {
    if (!me) return send(res, JSON.stringify({ error: 'auth' }), 403, 'application/json');
    const target = url.searchParams.get('url') || '';
    const json = (o, code = 200) => send(res, JSON.stringify(o), code, 'application/json');
    let u;
    try { u = new URL(target); } catch { return json({ error: 'bad url' }, 400); }
    if (!/^https?:$/.test(u.protocol)) return json({ error: 'bad scheme' }, 400);
    // do not let the form probe the private network
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(u.hostname))
      return json({ error: 'blocked' }, 400);
    try {
      const r = await fetch(u.href, {
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
        headers: { 'User-Agent': 'discriminantly/1.0 (+https://discriminantly.com)', 'Accept': 'text/html,*/*' },
      });
      if (!r.ok) return json({ error: 'status ' + r.status }, 200);
      const type = r.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml/i.test(type)) return json({ error: 'not html' }, 200);
      const body = (await r.text()).slice(0, 400000);   // enough for <head>
      return json(unfurl(body, u));
    } catch (e) {
      return json({ error: e.name === 'TimeoutError' ? 'timeout' : 'fetch failed' }, 200);
    }
  }
  if ((mt = p.match(/^\/collections\/(\d+)\/rename$/)) && m === 'POST') {
    if (!me) return need();
    const c = q('SELECT * FROM collections WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (!c) return send(res, 'Not yours', 403);
    const b = await readBody(req); const name = (b.name || '').trim();
    if (name && name !== c.name) {
      const clash = q('SELECT id FROM collections WHERE user_id=? AND name=? AND kind=? AND id<>?').get(me.id, name, c.kind, c.id);
      if (!clash) {
        q('UPDATE collections SET name=? WHERE id=?').run(name, c.id);
        recordProvenance('collection', c.uid, 'edited', webActor(me), { source_kind: 'manual', fields: 'name' });
      }
    }
    return redirect(res, `/u/${me.handle}?tab=${c.kind === 'mark' ? 'marks' : 'notes'}&c=${c.id}`);
  }
  if (p === '/collections/new' && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req); const name = (b.name || '').trim();
    const kind = b.kind === 'mark' ? 'mark' : 'note';
    if (name) {
      const r = q('INSERT OR IGNORE INTO collections(user_id,name,kind) VALUES(?,?,?)').run(me.id, name, kind);
      if (r.changes) recordProvenance('collection', uidOf('collections', r.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    }
    return redirect(res, `/u/${me.handle}?tab=${kind === 'mark' ? 'marks' : 'notes'}`);
  }
  if ((mt = p.match(/^\/collections\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const c = q('SELECT * FROM collections WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (c) {
      recordProvenance('collection', c.uid, 'deleted', webActor(me));
      q('DELETE FROM collections WHERE id=?').run(c.id);
    }
    return redirect(res, `/u/${me.handle}?tab=${c && c.kind === 'mark' ? 'marks' : 'notes'}`);
  }
  if (p === '/admin/backup' && m === 'GET') {
    if (!me || !me.is_admin) return send(res, 'Not allowed', 403);
    const tmp = path.join(path.dirname(DB_PATH), 'backups', `download-${Date.now()}.db`);
    try {
      backupTo(tmp);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="discriminantly-${new Date().toISOString().slice(0, 10)}.db"` });
      const stream = fs.createReadStream(tmp);
      stream.pipe(res);
      stream.on('close', () => { try { fs.unlinkSync(tmp); } catch {} });
      return;
    } catch (e) { return send(res, 'Backup failed: ' + e.message, 500); }
  }
  if (p === '/settings/token' && m === 'POST') { if (!me) return need(); q('UPDATE users SET api_token=? WHERE id=?').run(token(24), me.id); return redirect(res, '/settings'); }
  if (p === '/' && m === 'GET') return pages.home(req, res, me, url);
  if (p === '/about') return pages.about(req, res, me);
  if (p === '/welcome') return pages.welcome(req, res, me);
  if (p === '/objects.json') return json(res, q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC').all().map((o) => ({ id: o.id, headline: o.name, description: o.why, tags: tagList(o.tags), link: o.url, image: o.image, noted_by: o.handle, collections: objCollections(o.id).map((c) => c.name), created_at: o.created_at })));

  if (p === '/login') {
    if (m === 'GET') return pages.login(req, res, me);
    const b = await readBody(req); const u = q('SELECT * FROM users WHERE email=?').get((b.email || '').toLowerCase().trim());
    if (!u || !checkPass(b.password || '', u.pass)) return pages.login(req, res, me, 'That email and password do not match.');
    const t = token(); q('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, u.id);
    return redirect(res, '/', { 'Set-Cookie': `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${SECURE ? '; Secure' : ''}` });
  }
  if (p === '/logout' && m === 'POST') { const t = cookies(req).sid; if (t) q('DELETE FROM sessions WHERE token=?').run(t); return redirect(res, '/', { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' }); }

  if (p === '/join') {
    if (m === 'GET') return pages.join(req, res, me, url.searchParams.get('code') || '');
    const b = await readBody(req); const code = (b.code || '').trim();
    const inv = q('SELECT * FROM invites WHERE code=? AND used_by IS NULL').get(code);
    if (!inv) return pages.join(req, res, me, code, 'That invite code is not valid or has been used.');
    const handle = slug(b.handle || ''); const email = (b.email || '').toLowerCase().trim();
    if (q('SELECT 1 FROM users WHERE handle=? OR email=?').get(handle, email)) return pages.join(req, res, me, code, 'That handle or email is already taken.');
    if ((b.password || '').length < 8) return pages.join(req, res, me, code, 'Password needs at least 8 characters.');
    const r = q('INSERT INTO users(handle,name,email,pass) VALUES(?,?,?,?)').run(handle, (b.name || '').trim() || handle, email, hashPass(b.password));
    q('UPDATE invites SET used_by=? WHERE code=?').run(r.lastInsertRowid, code);
    const t = token(); q('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(t, r.lastInsertRowid);
    return redirect(res, '/new', { 'Set-Cookie': `sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${SECURE ? '; Secure' : ''}` });
  }

  if (p === '/marks/new') {
    if (!me) return need();
    if (m === 'GET') return pages.composePage(req, res, me, 'mark');
    const b = await readBodyMulti(req); const colls = [...b.coll, ...(b.newcoll || '').split(',')];
    if (!(b.name || '').trim()) return pages.markForm(req, res, me, b, 'A mark needs a place name.', colls);
    const [lat, lng] = (b.latlng || '').split(',').map((x) => parseFloat(x));
    const r = q('INSERT INTO marks(user_id,name,locality,country,address,lat,lng,why,tags,url,image,private) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(me.id, b.name.trim(), b.locality || '', b.country || '', b.address || '',
           isNaN(lat) ? null : lat, isNaN(lng) ? null : lng, (b.why || '').trim(),
           tagList(b.tags).join(', '), b.url || '', storeImage(me.id, b.image), b.private ? 1 : 0);
    setMarkCollections(me.id, r.lastInsertRowid, colls);
    recordProvenance('mark', uidOf('marks', r.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    return redirect(res, `/m/${r.lastInsertRowid}?ask=1`);   // offer a check-in rather than assuming one
  }
  if ((mt = p.match(/^\/m\/(\d+)$/))) return pages.mark(req, res, me, url, +mt[1]);
  if ((mt = p.match(/^\/m\/(\d+)\/edit$/))) {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin);
    if (!mk) return send(res, 'Not yours', 403);
    if (m === 'GET') return pages.markForm(req, res, me, mk);
    const b = await readBodyMulti(req);
    const [lat, lng] = (b.latlng || '').split(',').map((x) => parseFloat(x));
    q('UPDATE marks SET name=?,locality=?,country=?,address=?,lat=?,lng=?,why=?,tags=?,url=?,image=?,private=? WHERE id=?')
      .run((b.name || mk.name).trim(), b.locality || '', b.country || '', b.address || '',
           isNaN(lat) ? null : lat, isNaN(lng) ? null : lng, (b.why || '').trim(),
           tagList(b.tags).join(', '), b.url || '', storeImage(me.id, b.image), b.private ? 1 : 0, mk.id);
    setMarkCollections(mk.user_id, mk.id, [...b.coll, ...(b.newcoll || '').split(',')]);
    recordProvenance('mark', mk.uid, 'edited', webActor(me), { source_kind: 'manual' });
    return redirect(res, `/m/${mk.id}`);
  }
  // Re-mark: create my own Mark from someone else's. The new Mark is wholly
  // mine; theirs is untouched. What carries over are facts about the place.
  // What does not is anything they authored — `why` is their reasoning in their
  // own voice, and copying it would silently put their words in my mouth.
  if ((mt = p.match(/^\/m\/(\d+)\/remark$/)) && m === 'POST') {
    if (!me) return need();
    const src = q('SELECT * FROM marks WHERE id=?').get(+mt[1]);
    if (!src) return send(res, 'No such travel mark', 404);
    if (src.private && src.user_id !== me.id) return send(res, 'Not yours', 403);
    // Re-marking your own Mark is duplication, not adoption of another's
    // judgment, and would contaminate the directional signal.
    if (src.user_id === me.id) return send(res, 'You cannot re-mark your own travel mark', 400);
    const r = q(`INSERT INTO marks
        (user_id,name,locality,country,address,lat,lng,why,tags,url,image,private,verified,remarked_from_uid)
        VALUES (?,?,?,?,?,?,?,'','',?,?,0,0,?)`)
      .run(me.id, src.name, src.locality, src.country, src.address, src.lat, src.lng,
           src.url || '', src.image || '', src.uid);
    //  copied: name, locality, country, address, lat/lng, image, url
    //  empty : why (theirs), tags (authored), collections, verified, private
    //  never : visits — experience is personal and not transferable
    recordProvenance('mark', uidOf('marks', r.lastInsertRowid), 'created', webActor(me),
      { source_kind: 'remark', source_ref: src.uid });
    return redirect(res, `/m/${r.lastInsertRowid}/edit`);   // they write their own why
  }
  if ((mt = p.match(/^\/m\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin);
    if (!mk) return send(res, 'Not yours', 403);
    recordProvenance('mark', mk.uid, 'deleted', webActor(me));
    q('DELETE FROM marks WHERE id=?').run(mk.id);
    return redirect(res, `/u/${me.handle}?tab=marks`);
  }
  if ((mt = p.match(/^\/m\/(\d+)\/comments$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT id FROM marks WHERE id=?').get(+mt[1]); if (!mk) return send(res, 'Not found', 404);
    const b = await readBody(req); const t = (b.body || '').trim();
    if (t) {
      const r = q('INSERT INTO mark_comments(mark_id,user_id,body) VALUES(?,?,?)').run(mk.id, me.id, t);
      recordProvenance('mark_comment', uidOf('mark_comments', r.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    }
    return redirect(res, `/m/${mk.id}`);
  }
  if ((mt = p.match(/^\/m\/(\d+)\/checkin$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (!mk) return send(res, 'Not yours', 403);
    const b = await readBody(req);
    const v = q('INSERT INTO visits(mark_id,user_id,visited_on,body) VALUES(?,?,?,?)')
      .run(mk.id, me.id, new Date().toISOString().slice(0, 10), (b.body || '').trim());
    recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    return redirect(res, `/m/${mk.id}`);
  }
  if ((mt = p.match(/^\/m\/(\d+)\/visits$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (!mk) return send(res, 'Not yours', 403);
    const b = await readBody(req);
    if (b.visited_on) {
      const v = q('INSERT INTO visits(mark_id,user_id,visited_on,body) VALUES(?,?,?,?)')
        .run(mk.id, me.id, b.visited_on, (b.body || '').trim());
      recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    }
    return redirect(res, `/m/${mk.id}`);
  }
  if ((mt = p.match(/^\/m\/(\d+)\/visits\/(\d+)\/edit$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (!mk) return send(res, 'Not yours', 403);
    const b = await readBody(req);
    q('UPDATE visits SET body=? WHERE id=? AND mark_id=?').run((b.body || '').trim(), +mt[2], mk.id);
    recordProvenance('visit', uidOf('visits', +mt[2]), 'edited', webActor(me), { source_kind: 'manual', fields: 'body' });
    return redirect(res, `/m/${mk.id}`);
  }
  if ((mt = p.match(/^\/m\/(\d+)\/visits\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (mk) {
      const vu = uidOf('visits', +mt[2]);
      const r = q('DELETE FROM visits WHERE id=? AND mark_id=?').run(+mt[2], mk.id);
      if (r.changes && vu) recordProvenance('visit', vu, 'deleted', webActor(me));
    }
    return redirect(res, `/m/${mt[1]}`);
  }
  if (p === '/new') {
    if (!me) return need();
    if (m === 'GET') return pages.composePage(req, res, me, 'note', { o: { url: url.searchParams.get('url') || '' } });
    const b = await readBodyMulti(req); const colls = [...b.coll, ...(b.newcoll || '').split(',')];
    if (!(b.name || '').trim()) return pages.form(req, res, me, b, 'A note needs a title.', colls);
    if (!(b.image || '').trim()) return pages.form(req, res, me, b, 'Every note needs an image.', colls);
    const r = q('INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,?,?,?,?,?)')
      .run(me.id, b.name.trim(), (b.why || '').trim(), tagList(b.tags).join(', '), b.url || '', storeImage(me.id, b.image), b.private ? 1 : 0);
    q('INSERT OR IGNORE INTO notes(user_id,object_id,why) VALUES(?,?,?)').run(me.id, r.lastInsertRowid, '');
    setCollections(me.id, r.lastInsertRowid, colls);
    recordProvenance('object', uidOf('objects', r.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    return redirect(res, `/o/${r.lastInsertRowid}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)$/))) return pages.object(req, res, me, url, +mt[1]);
  if ((mt = p.match(/^\/o\/(\d+)\/(note|unnote)$/)) && m === 'POST') {
    if (!me) return need();
    if (mt[2] === 'note') {
      // A re-note is explicit evidence: this member adopted another's record.
      // INSERT OR IGNORE no-ops if it already exists — log nothing in that case.
      const r = q('INSERT OR IGNORE INTO notes(user_id,object_id) VALUES(?,?)').run(me.id, +mt[1]);
      if (r.changes) recordProvenance('object', uidOf('objects', +mt[1]), 'renoted', webActor(me), { source_kind: 'renote' });
    } else if (!q('SELECT 1 FROM objects WHERE id=? AND user_id=?').get(+mt[1], me.id)) {
      const r = q('DELETE FROM notes WHERE user_id=? AND object_id=?').run(me.id, +mt[1]);
      if (r.changes) recordProvenance('object', uidOf('objects', +mt[1]), 'unrenoted', webActor(me), { source_kind: 'renote' });
    }
    return redirect(res, req.headers.referer || `/o/${mt[1]}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/comments$/)) && m === 'POST') {
    if (!me) return need();
    const o = q('SELECT id FROM objects WHERE id=?').get(+mt[1]); if (!o) return send(res, 'Not found', 404);
    const b = await readBody(req); const body = (b.body || '').trim();
    if (body) {
      const r = q('INSERT INTO comments(object_id,user_id,body) VALUES(?,?,?)').run(o.id, me.id, body);
      recordProvenance('comment', uidOf('comments', r.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    }
    return redirect(res, `/o/${o.id}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/edit$/))) {
    if (!me) return need();
    const o = q('SELECT * FROM objects WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin); if (!o) return send(res, 'Not yours', 403);
    if (m === 'GET') return pages.form(req, res, me, o);
    const b = await readBodyMulti(req);
    q('UPDATE objects SET name=?,why=?,tags=?,url=?,image=?,private=? WHERE id=?')
      .run((b.name || o.name).trim(), (b.why || '').trim(), tagList(b.tags).join(', '), b.url || '', storeImage(me.id, b.image), b.private ? 1 : 0, o.id);
    setCollections(o.user_id, o.id, [...b.coll, ...(b.newcoll || '').split(',')]);
    recordProvenance('object', o.uid, 'edited', webActor(me), { source_kind: 'manual' });
    return redirect(res, `/o/${o.id}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const o = q('SELECT * FROM objects WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin); if (!o) return send(res, 'Not yours', 403);
    recordProvenance('object', o.uid, 'deleted', webActor(me));
    q('DELETE FROM objects WHERE id=?').run(o.id);
    return redirect(res, `/u/${me.handle}?tab=notes`);
  }
  if ((mt = p.match(/^\/u\/([a-z0-9]+)\/(follow|unfollow)$/)) && m === 'POST') {
    if (!me) return need();
    const t = q('SELECT id FROM users WHERE handle=?').get(mt[1]); if (!t || t.id === me.id) return redirect(res, '/');
    const b = await readBody(req);
    // Explicit, directional attention evidence — never interpreted here as
    // similarity or preference. Guarded by r.changes so a no-op (already
    // following, or not following) writes no provenance.
    if (mt[2] === 'follow') {
      const r = q('INSERT OR IGNORE INTO follows(follower_id,followee_id) VALUES(?,?)').run(me.id, t.id);
      if (r.changes) recordProvenance('follow', uidOf('follows', r.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    } else {
      const fu = q('SELECT uid FROM follows WHERE follower_id=? AND followee_id=?').get(me.id, t.id);
      const r = q('DELETE FROM follows WHERE follower_id=? AND followee_id=?').run(me.id, t.id);
      if (r.changes && fu) recordProvenance('follow', fu.uid, 'deleted', webActor(me));
    }
    return redirect(res, b.back || `/u/${mt[1]}`);
  }
  if ((mt = p.match(/^\/u\/([a-z0-9]+)$/))) return pages.user(req, res, me, mt[1], url);
  if (p === '/invites') {
    if (!me) return need();
    if (m === 'POST') { if (q('SELECT COUNT(*) c FROM invites WHERE from_user=? AND used_by IS NULL').get(me.id).c < 5) q('INSERT INTO invites(code,from_user) VALUES(?,?)').run(token(6), me.id); return redirect(res, '/invites'); }
    return pages.invites(req, res, me);
  }
  if (p === '/settings') {
    if (!me) return need();
    if (m === 'GET') return pages.settings(req, res, me);
    const b = await readBody(req); q('UPDATE users SET name=?,city=?,bio=?,avatar=?,site=? WHERE id=?').run((b.name || me.name).trim(), b.city || '', b.bio || '', b.avatar || '', b.site || '', me.id);
    return redirect(res, `/u/${me.handle}`);
  }
  send(res, layout({ title: 'Not found', body: '<p>That page does not exist.</p>', me }), 404);
}

// ---------- bootstrap admin + optional seed ----------
const freshInstall = q('SELECT COUNT(*) c FROM users').get().c === 0;
if (freshInstall && process.env.NODE_ENV === 'production') {
  console.warn('');
  console.warn('  ****************************************************************');
  console.warn('  *  EMPTY DATABASE at ' + DB_PATH);
  console.warn('  *  A new one is being created. If this service had content, the');
  console.warn('  *  volume is NOT mounted and the previous data is gone.');
  console.warn('  *  Mount a volume at ' + path.dirname(DB_PATH) + ' before adding more.');
  console.warn('  ****************************************************************');
  console.warn('');
}
if (freshInstall) {
  const email = process.env.ADMIN_EMAIL || 'admin@discriminant.ly', pass = process.env.ADMIN_PASSWORD || 'changeme1';
  q('INSERT INTO users(handle,name,email,pass,is_admin,avatar) VALUES(?,?,?,?,1,?)').run(process.env.ADMIN_HANDLE || 'elicierto', process.env.ADMIN_NAME || 'Brian Elicierto', email, hashPass(pass), '/avatars/elicierto.png');
  const code = token(6); q('INSERT INTO invites(code,from_user) VALUES(?,1)').run(code);
  console.log(`First run: admin ${email} / ${pass}. One invite code: ${code}`);
  if (process.env.SEED) require('./seed')(db);
}

const counts = ['users', 'objects', 'marks', 'visits', 'comments']
  .map((t) => `${t} ${q(`SELECT COUNT(*) c FROM ${t}`).get().c}`).join(', ');
console.log(`Database: ${DB_PATH} (${(fs.statSync(DB_PATH).size / 1024).toFixed(0)} KB) — ${counts}`);

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e); send(res, 'Something went wrong.', 500); })).listen(PORT, () => console.log(`discriminant.ly on http://localhost:${PORT}`));
