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
const CSS_MODERN_V = assetHash('style.modern.css');
const CSS_SHARED_V = assetHash('style.shared.css');
// The classic skin is the default and the one every existing member sees.
const SKINS = new Set(['classic', 'modern']), MODES = new Set(['system', 'light', 'dark']);
// A member's skin is their setting. A signed-out visitor has none, so the
// welcome, login and join pages follow a `skin` cookie (set whenever a member
// changes theirs, so logging out does not snap the look back), and otherwise
// DEFAULT_SKIN — classic unless the site is told otherwise.
const DEFAULT_SKIN = SKINS.has(process.env.DEFAULT_SKIN) ? process.env.DEFAULT_SKIN : 'modern';
// The request currently being rendered. layout() reads the look cookies from
// it so that EVERY page — not just the three that happened to pass `req` —
// resolves a signed-out visitor's theme the same way.
let CURRENT_REQ = null;
const skinOf = (u, req) => {
  if (u && SKINS.has(u.ui_skin)) return u.ui_skin;   // a member's explicit choice, either way
  const c = req && /(?:^|;\s*)skin=(\w+)/.exec(req.headers.cookie || '');
  return c && SKINS.has(c[1]) ? c[1] : DEFAULT_SKIN;
};
const modeOf = (u, req) => {
  if (u && MODES.has(u.ui_mode)) return u.ui_mode;
  const c = req && /(?:^|;\s*)mode=(\w+)/.exec(req.headers.cookie || '');
  return c && MODES.has(c[1]) ? c[1] : 'system';
};

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
                                            -- renoted | unrenoted            (v1.11)
                                            -- asserted | released | revoked | corrected (v1.15)
                                            -- Actions name the member's act, not the SQL used
                                            -- to persist it: an ownership release or a warrant
                                            -- revocation appends a row, it deletes nothing.
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

  // Owned. An append-only log of ownership assertions, never a boolean.
  //
  // Keyed on (user_id, object_id) because objects are SHARED: a re-note adds a
  // row to `notes`, it does not copy the object. A column on `objects` would
  // therefore make one member's ownership visible as everyone's — and would
  // also ride along in OBJ_SQL's `SELECT o.*` to eleven read paths, including
  // the public unauthenticated /objects.json. A separate table makes the
  // privacy rule structural rather than a template convention.
  //
  // state: 'owned'     — I own this
  //        'released'  — I no longer own this (a real lifecycle transition)
  //        'retracted' — the earlier assertion was a mistake (a correction)
  // supersedes: uid of the row this corrects. A retracted row's target is
  // excluded when computing ownership periods, so a correction never leaves a
  // false period behind, while both rows remain visible as history.
  ['019-ownership-assertions', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS ownership_assertions (
      id         INTEGER PRIMARY KEY,
      uid        TEXT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      object_id  INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      state      TEXT NOT NULL,
      supersedes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_ownership_uid AFTER INSERT ON ownership_assertions
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE ownership_assertions SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_uid ON ownership_assertions(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ownership_subject ON ownership_assertions(user_id, object_id, id)');
  }],

  // Warrant. Same append-only shape, but polymorphic over notes and marks.
  //
  // Deliberately a separate table from ownership rather than one shared
  // "assertion" table: `published` must not exist anywhere near Owned rows,
  // where publication is forbidden. Keeping them apart makes that structural.
  //
  // subject_uid is polymorphic (objects.uid | marks.uid), so SQLite cannot
  // give it a foreign key — integrity is enforced in the delete paths instead.
  // published applies ONLY to state='active' rows: it records whether that
  // particular act of warranting was announced. Nothing that computes
  // endorsement ever reads it, so publication stays social metadata rather
  // than part of what a Warrant means.
  ['020-warrants', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS warrants (
      id           INTEGER PRIMARY KEY,
      uid          TEXT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_type TEXT NOT NULL,
      subject_uid  TEXT NOT NULL,
      state        TEXT NOT NULL,
      published    INTEGER NOT NULL DEFAULT 0,
      supersedes   TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_warrants_uid AFTER INSERT ON warrants
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE warrants SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_warrants_uid ON warrants(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_warrants_subject ON warrants(user_id, subject_type, subject_uid, id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_warrants_feed ON warrants(subject_type, subject_uid, state)');
  }],

  // ---- v1.17: the relationship is the record ------------------------------
  // A Note becomes a first-class, user-owned record of one member's
  // relationship to a thing, exactly as a Mark already is for a place. The
  // `objects` table keeps its physical name — 27 call sites change meaning,
  // and renaming as well would make the diff unreviewable for no semantic
  // gain — but from here `objects.user_id` means the Note's OWNER, not the
  // author of a row other people point at.
  ['021-note-lineage', () => {
    if (!hasColumn('objects', 'renoted_from_uid')) db.exec('ALTER TABLE objects ADD COLUMN renoted_from_uid TEXT');
    if (!hasColumn('objects', 'updated_at')) db.exec('ALTER TABLE objects ADD COLUMN updated_at TEXT');
    // Lineage is a plain TEXT uid with NO foreign key, mirroring
    // marks.remarked_from_uid: deleting a source must never cascade into an
    // adopter's record, and there must be no referential edge to cascade along.
    db.exec('CREATE INDEX IF NOT EXISTS idx_objects_renoted_from ON objects(renoted_from_uid)');
    // DELIBERATELY NON-UNIQUE. Re-noting the same source twice is a valid
    // canonical user action: each adoption is its own record and may later
    // diverge. A UNIQUE index here would break that and the failure would look
    // like a database error rather than the policy change it actually is.
    // Do not "optimise" this into a unique index.
    db.exec('CREATE INDEX IF NOT EXISTS idx_objects_owner_lineage ON objects(user_id, renoted_from_uid)');
  }],

  // Collections organise the member's own Notes. The old object_collections
  // keyed on the shared object, and setCollections deleted every user's rows
  // for that object before reinserting its own — a cross-user data-loss bug
  // that only stayed hidden because re-noters could never organise anything.
  ['022-note-collections', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS note_collections (
      note_id       INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, collection_id))`);
    db.exec('INSERT OR IGNORE INTO note_collections(note_id, collection_id) SELECT object_id, collection_id FROM object_collections');
  }],

  // Owned moves from an integer FK to a stable Note uid, matching Warrant and
  // making the assertion portable. The old column stays for one release so a
  // rollback has something to read; nothing writes it after this.
  ['023-ownership-note-uid', () => {
    if (!hasColumn('ownership_assertions', 'note_uid')) db.exec('ALTER TABLE ownership_assertions ADD COLUMN note_uid TEXT');
    db.exec(`UPDATE ownership_assertions SET note_uid =
      (SELECT o.uid FROM objects o WHERE o.id = ownership_assertions.object_id)
      WHERE note_uid IS NULL OR note_uid = ''`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_ownership_note ON ownership_assertions(user_id, note_uid, id)');
  }],

  // An explicit "these two Notes are the same thing" is canonical evidence a
  // member asserted. It cannot live in derived_relations: that table is named
  // for computation and carries confidence/computed_at, so putting a user's
  // own statement there would launder explicit evidence into derived.
  ['024-note-relations', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS note_relations (
      id               INTEGER PRIMARY KEY,
      uid              TEXT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_note_uid TEXT NOT NULL,
      predicate        TEXT NOT NULL,        -- 'same_thing_as' only in this release
      object_note_uid  TEXT NOT NULL,
      basis            TEXT NOT NULL,        -- 'user' | 'external'
      source_ref       TEXT,
      state            TEXT NOT NULL,        -- 'active' | 'retracted'
      supersedes       TEXT,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_note_relations_uid AFTER INSERT ON note_relations
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE note_relations SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_note_relations_uid ON note_relations(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_note_relations_subject ON note_relations(user_id, subject_note_uid, state)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_note_relations_object ON note_relations(user_id, object_note_uid, state)');
  }],

  // Materialise every existing adoption as an independent Note.
  //
  // HONESTY: we copy the shared row as it stands TODAY because no historical
  // snapshot was ever recorded. Two provenance rows say so — one carrying the
  // real original adoption timestamp (that relationship genuinely existed
  // then), one dated now recording that the representation was materialised
  // during migration. No prior field values are invented, because none are
  // asserted.
  ['025-materialise-adoptions', () => {
    const adoptions = db.prepare(`
      SELECT n.user_id AS adopter, n.object_id, n.created_at AS adopted_at,
             o.uid AS src_uid, o.name, o.why, o.tags, o.url, o.image, o.private
        FROM notes n JOIN objects o ON o.id = n.object_id
       WHERE n.user_id <> o.user_id`).all();
    const ins = db.prepare(`INSERT INTO objects(user_id,name,why,tags,url,image,private,renoted_from_uid,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const prov = db.prepare(`INSERT INTO provenance
      (entity_type,entity_uid,action,assertion,actor_type,actor_user_id,agent,auth_method,source_kind,source_ref,fields,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const a of adoptions) {
      const r = ins.run(a.adopter, a.name, a.why, a.tags, a.url, a.image, a.private, a.src_uid, a.adopted_at);
      const uid = db.prepare('SELECT uid FROM objects WHERE rowid=?').get(r.lastInsertRowid).uid;
      // 1. the adoption itself — real, and it really happened then
      prov.run('object', uid, 'renoted', 'explicit', 'user', a.adopter, 'web', 'session', 'renote', a.src_uid, null, a.adopted_at);
      // 2. the representation — materialised now, from the then-current shared row
      prov.run('object', uid, 'migrated', 'explicit', 'system', null, 'migration', 'system', 'schema_migration', a.src_uid,
        'name,why,tags,url,image,private', now);
      // carry the adopter's own assertions onto their new Note
      db.prepare('UPDATE ownership_assertions SET note_uid=? WHERE user_id=? AND object_id=?')
        .run(uid, a.adopter, a.object_id);
      db.prepare('UPDATE warrants SET subject_uid=? WHERE user_id=? AND subject_type=\'object\' AND subject_uid=?')
        .run(uid, a.adopter, a.src_uid);
    }
    // `notes` is retired as a join table. The rows stay (nothing is ever
    // dropped) but nothing reads or writes them after this migration.
    if (adoptions.length) console.log(`  materialised ${adoptions.length} adopted note(s)`);
  }],

  // ---- v1.18: image access repair (prerequisite for Ensemble) -------------
  // Stored refs move from /i/<sequential integer> to /i/<uid>. The integer
  // form was guessable AND unauthenticated, so a private note's bytes could be
  // fetched by counting upwards; it is also database-local, which made exports
  // meaningless elsewhere. The route still resolves the old form, but now
  // behind the same visibility check, so nothing already linked breaks.
  ['026-image-uid-refs', () => {
    if (!hasColumn('images', 'source')) db.exec("ALTER TABLE images ADD COLUMN source TEXT DEFAULT 'upload'");
    for (const t of ['objects', 'marks']) {
      const rows = db.prepare(`SELECT id, image FROM ${t} WHERE image LIKE '/i/%'`).all();
      for (const r of rows) {
        const m = /^\/i\/(\d+)$/.exec(r.image);
        if (!m) continue;                                  // already a uid, or an external URL
        const img = db.prepare('SELECT uid FROM images WHERE id=?').get(+m[1]);
        if (!img || !img.uid) continue;                    // dangling ref: leave it exactly as it is
        db.prepare(`UPDATE ${t} SET image=? WHERE id=?`).run(`/i/${img.uid}`, r.id);
      }
    }
  }],

  // ---- v1.18: Ensemble ----------------------------------------------------
  // A durable AI-composited arrangement of things. First-class and user-owned,
  // like a Note or a Mark.
  ['027-ensembles', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS ensembles (
      id                   INTEGER PRIMARY KEY,
      uid                  TEXT,
      user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title                TEXT NOT NULL DEFAULT '',
      description          TEXT NOT NULL DEFAULT '',
      private              INTEGER NOT NULL DEFAULT 0,
      primary_artifact_uid TEXT,
      created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at           TEXT)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_ensembles_uid AFTER INSERT ON ensembles
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE ensembles SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ensembles_uid ON ensembles(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ensembles_owner ON ensembles(user_id, id)');
  }],

  // A component keeps its uid for life. Resolution changes what we know about
  // the constituent (state, note_uid), never which constituent participated —
  // so there is deliberately no replacement-row column here. label/image_uid
  // are the Ensemble's OWN representation, which is what lets a public
  // Ensemble describe a constituent whose Note is private.
  ['028-ensemble-components', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS ensemble_components (
      id          INTEGER PRIMARY KEY,
      uid         TEXT,
      ensemble_id INTEGER NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      state       TEXT NOT NULL DEFAULT 'unresolved',   -- unresolved | linked
      note_uid    TEXT,          -- non-FK on purpose: survives Note deletion as history
      image_uid   TEXT,
      label       TEXT NOT NULL DEFAULT '',
      source_url  TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_ens_comp_uid AFTER INSERT ON ensemble_components
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE ensemble_components SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ens_comp_uid ON ensemble_components(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ens_comp_ens ON ensemble_components(ensemble_id, position, id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ens_comp_note ON ensemble_components(note_uid)');
  }],

  // An artifact is an immutable rendering. Its lineage snapshot records what
  // participated AT GENERATION TIME and is never rewritten afterwards, which
  // is what keeps an old rendering truthful once components resolve or Notes
  // are edited.
  ['029-ensemble-artifacts', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS ensemble_artifacts (
      id          INTEGER PRIMARY KEY,
      uid         TEXT,
      ensemble_id INTEGER NOT NULL REFERENCES ensembles(id) ON DELETE CASCADE,
      image_uid   TEXT NOT NULL,
      lineage     TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_ens_art_uid AFTER INSERT ON ensemble_artifacts
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE ensemble_artifacts SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ens_art_uid ON ensemble_artifacts(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ens_art_ens ON ensemble_artifacts(ensemble_id, id)');
  }],


  ['030-image-dedupe-dims', () => {
    for (const col of ['sha256', 'width', 'height']) {
      if (!hasColumn('images', col)) db.exec(`ALTER TABLE images ADD COLUMN ${col} ${col === 'sha256' ? 'TEXT' : 'INTEGER'}`);
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_images_sha ON images(user_id, sha256)');
    // backfill for what is already stored
    for (const r of db.prepare('SELECT rowid AS rid, mime, bytes FROM images WHERE sha256 IS NULL').all()) {
      const b = Buffer.from(r.bytes);
      const d = imageDimensions(b, r.mime);
      db.prepare('UPDATE images SET sha256=?, width=?, height=? WHERE rowid=?')
        .run(crypto.createHash('sha256').update(b).digest('hex'), d.w || null, d.h || null, r.rid);
    }
  }],


  ['031-ensemble-review', () => {
    if (!hasColumn('ensembles', 'status')) db.exec("ALTER TABLE ensembles ADD COLUMN status TEXT NOT NULL DEFAULT 'saved'");
    db.exec('CREATE INDEX IF NOT EXISTS idx_ensembles_status ON ensembles(user_id, status, id)');
    // Anything that already exists was created under the old semantics, where
    // saving WAS the commitment — so it is already saved, not pending.
    db.exec("UPDATE ensembles SET status='saved' WHERE status IS NULL OR status=''");
  }],

  // Storage and load-time work. sha256 lets identical bytes be stored once —
  // regenerating a composition, or reusing one product photo across several
  // ensembles, is common and currently duplicates the whole blob. width/height
  // are parsed from the file header (no image library needed) so every <img>
  // can carry real dimensions, which stops layout shift and lets the browser
  // reserve space before the bytes arrive.
  // Ensemble review lifecycle. A composition is persisted the moment it is
  // generated — so nothing is lost while the member decides — but persisting
  // is not yet the commitment that materialises Notes. status separates the
  // two: 'pending_review' is durable, private and inspectable; 'saved' is the
  // commitment boundary the Note-materialisation rules already key on.
  // Deliberately scoped to Ensemble; Notes and Marks get no draft state.
  // Chunked image ingestion (v1.27). A whole image crossing as ONE MCP string
  // argument has proven unreliable at sizes we consider useful — a 310 KB
  // payload succeeded while a later 135 KB one was truncated — so the size of
  // any single tool argument must stop being load-bearing. These two tables
  // stage bytes across several small calls; nothing here is a durable image,
  // and only finish_image_upload creates a row in `images`.
  ['032-image-upload-sessions', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    db.exec(`CREATE TABLE IF NOT EXISTS image_uploads (
      id          INTEGER PRIMARY KEY,
      uid         TEXT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime        TEXT NOT NULL,
      total_bytes INTEGER NOT NULL,
      sha256      TEXT,
      source      TEXT NOT NULL DEFAULT 'upload',
      status      TEXT NOT NULL DEFAULT 'open',      -- open | finished
      image_uid   TEXT,                              -- set once finalised, so retries are idempotent
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at  TEXT NOT NULL)`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_image_uploads_uid AFTER INSERT ON image_uploads
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE image_uploads SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_image_uploads_uid ON image_uploads(uid)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_image_uploads_owner ON image_uploads(user_id, status)');
    // One row per chunk, keyed by index: a repeated chunk overwrites nothing and
    // an out-of-order chunk is just another row, so retries stay harmless.
    db.exec(`CREATE TABLE IF NOT EXISTS image_upload_chunks (
      upload_id  INTEGER NOT NULL REFERENCES image_uploads(id) ON DELETE CASCADE,
      idx        INTEGER NOT NULL,
      bytes      BLOB NOT NULL,
      sha256     TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (upload_id, idx))`);
  }],

  // Multi-day check-ins (v1.29). A check-in is one visit; ended_on turns it
  // into one CONTINUOUS visit spanning a date range, NULL meaning single-day —
  // so every existing row is already correct and no backfill is needed.
  // visit_days holds day-level commentary INSIDE that visit, sparsely: a row
  // exists only where the member wrote something for that date. The range
  // defines the days; the rows record what was said about some of them.
  ['033-multi-day-checkins', () => {
    const SQL_UUID = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    if (!hasColumn('visits', 'ended_on')) db.exec('ALTER TABLE visits ADD COLUMN ended_on TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS visit_days (
      id         INTEGER PRIMARY KEY,
      uid        TEXT,
      visit_id   INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      day        TEXT NOT NULL,                 -- YYYY-MM-DD, within the visit's range
      body       TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      UNIQUE (visit_id, day))`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS trg_visit_days_uid AFTER INSERT ON visit_days
      WHEN NEW.uid IS NULL OR NEW.uid = ''
      BEGIN UPDATE visit_days SET uid = ${SQL_UUID} WHERE rowid = NEW.rowid; END`);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_visit_days_uid ON visit_days(uid)');
  }],

  // Undated check-ins (v1.30). "I was there" is worth recording even when
  // "when" is gone. visited_on is NOT NULL and cannot be relaxed without
  // rebuilding the table, so an undated visit keeps a placeholder date (the
  // day it was logged) purely for storage and sort order, and date_known=0
  // is the truth. Every reader consults the flag; the placeholder is never
  // shown or returned.
  ['034-undated-checkins', () => {
    if (!hasColumn('visits', 'date_known')) db.exec('ALTER TABLE visits ADD COLUMN date_known INTEGER NOT NULL DEFAULT 1');
  }],

  // Adopt linked pictures (v1.36). Notes created over MCP used to store the
  // retailer's URL verbatim: the image was never actually brought in, so it
  // could vanish when that page changed and had no image_uid, which is why an
  // AI could see has_image:true yet have nothing to look at. Fetching at
  // startup would be slow and could hang boot, so this migration only RECORDS
  // which rows need adopting; adoptLinkedImages() does the fetching in the
  // background once the server is up, and is safe to re-run.
  ['035-linked-image-adoption', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS linked_image_backlog (
      id         INTEGER PRIMARY KEY,
      kind       TEXT NOT NULL,                    -- 'object' | 'mark'
      row_id     INTEGER NOT NULL,
      url        TEXT NOT NULL,
      state      TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
      note       TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (kind, row_id))`);
    db.exec(`INSERT OR IGNORE INTO linked_image_backlog(kind, row_id, url)
      SELECT 'object', id, image FROM objects WHERE image LIKE 'http%'`);
    db.exec(`INSERT OR IGNORE INTO linked_image_backlog(kind, row_id, url)
      SELECT 'mark', id, image FROM marks WHERE image LIKE 'http%'`);
  }],

  // Ingestion mode (v1.38). A diagnostic switch, not a feature: we know a large
  // inline payload gets truncated, but not whether chunking itself costs us
  // anything on images small enough to go in one call. 'auto' is the shipping
  // behaviour; the other two force one path so the same test can be run twice.
  ['036-ingest-mode', () => {
    if (!hasColumn('users', 'ingest_mode')) db.exec("ALTER TABLE users ADD COLUMN ingest_mode TEXT NOT NULL DEFAULT 'auto'");
  }],

  // Collection membership moved to note_collections in 022, but that migration
  // copied ONCE — anything written to the old table afterwards (seed data, and
  // any older deploy) was stranded, so collections showed a count of 0 while
  // plainly containing notes. Re-run the copy; it is idempotent.
  ['037-collection-membership-sweep', () => {
    db.exec('INSERT OR IGNORE INTO note_collections(note_id, collection_id) SELECT object_id, collection_id FROM object_collections');
  }],

  // Skins (v1.41). 'classic' is the revived 2013 design, kept exactly as it
  // is; 'modern' is a second stylesheet layered over the same markup. ui_mode
  // is light / dark / system and only means anything under the modern skin.
  ['038-ui-skin', () => {
    if (!hasColumn('users', 'ui_skin')) db.exec("ALTER TABLE users ADD COLUMN ui_skin TEXT NOT NULL DEFAULT 'classic'");
    if (!hasColumn('users', 'ui_mode')) db.exec("ALTER TABLE users ADD COLUMN ui_mode TEXT NOT NULL DEFAULT 'system'");
  }],

  // Modern glass becomes the default (v1.48). 038 gave every row 'classic'
  // as a column default, which recorded no choice at all — so move those rows
  // to 'modern' and let the switch record real choices from here on.
  ['039-modern-default', () => {
    db.exec("UPDATE users SET ui_skin='modern' WHERE ui_skin='classic'");
  }],
  ['040-resurfaced', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS resurfaced (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_type TEXT NOT NULL,
      subject_id   INTEGER NOT NULL,
      surfaced_on  TEXT NOT NULL,
      PRIMARY KEY (user_id, subject_type, subject_id))`);
  }],


  // ---- Itinerary (v1.97) ---------------------------------------------------
  // Three canonical tables. Purely additive: nothing existing is altered.
  //
  // Temporal components repeat at all three scopes by design. NULL means "not
  // asserted" everywhere; nothing is ever a placeholder. The nine columns are
  // identical at each scope so one accessor can read any of them.
  ['041-itineraries', () => {
    db.exec(`CREATE TABLE IF NOT EXISTS itineraries (
      id         INTEGER PRIMARY KEY,
      uid        TEXT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT '',
      context    TEXT NOT NULL DEFAULT '',
      private    INTEGER NOT NULL DEFAULT 0,
      t_year           INTEGER,
      t_period         TEXT CHECK (t_period IS NULL OR t_period IN ('spring','summer','fall','winter')),
      t_modifier       TEXT CHECK (t_modifier IS NULL OR t_modifier IN ('early','mid','late')),
      t_modifier_scope TEXT CHECK (t_modifier_scope IS NULL OR t_modifier_scope IN ('year','period','month')),
      t_month          INTEGER CHECK (t_month IS NULL OR (t_month BETWEEN 1 AND 12)),
      t_day            INTEGER CHECK (t_day IS NULL OR (t_day BETWEEN 1 AND 31)),
      t_weekday        TEXT CHECK (t_weekday IS NULL OR t_weekday IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
      t_daypart        TEXT CHECK (t_daypart IS NULL OR t_daypart IN ('morning','afternoon','evening','night')),
      t_clock          TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      -- A modifier and the component it scopes are one assertion: both
      -- present or both absent. A partial UPDATE is the likeliest way to
      -- break it, so the database refuses rather than the caller remembering.
      CHECK ((t_modifier IS NULL) = (t_modifier_scope IS NULL)))`);

    // UNIQUE(id, itinerary_id) is redundant as a key but required as the target
    // of the composite foreign key below, which is what stops a Stop pointing at
    // another Itinerary's group.
    db.exec(`CREATE TABLE IF NOT EXISTS itinerary_groups (
      id           INTEGER PRIMARY KEY,
      uid          TEXT,
      itinerary_id INTEGER NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
      label        TEXT NOT NULL DEFAULT '',
      position     INTEGER CHECK (position IS NULL OR position >= 1),
      t_year           INTEGER,
      t_period         TEXT CHECK (t_period IS NULL OR t_period IN ('spring','summer','fall','winter')),
      t_modifier       TEXT CHECK (t_modifier IS NULL OR t_modifier IN ('early','mid','late')),
      t_modifier_scope TEXT CHECK (t_modifier_scope IS NULL OR t_modifier_scope IN ('year','period','month')),
      t_month          INTEGER CHECK (t_month IS NULL OR (t_month BETWEEN 1 AND 12)),
      t_day            INTEGER CHECK (t_day IS NULL OR (t_day BETWEEN 1 AND 31)),
      t_weekday        TEXT CHECK (t_weekday IS NULL OR t_weekday IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
      t_daypart        TEXT CHECK (t_daypart IS NULL OR t_daypart IN ('morning','afternoon','evening','night')),
      t_clock          TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT,
      CHECK ((t_modifier IS NULL) = (t_modifier_scope IS NULL)),
      UNIQUE (id, itinerary_id))`);

    // mark_uid is deliberately NOT a foreign key, following
    // ensemble_components.note_uid: a Stop survives deletion of the Mark it
    // referenced, keeping its own label as history.
    //
    // The composite FK uses RESTRICT rather than SET NULL: SET NULL would try to
    // null itinerary_id too (it is part of the key) and fail against NOT NULL.
    // RESTRICT means a group cannot be deleted until groupDelete() has ungrouped
    // its Stops and cleared their group-scoped positions -- the database compels
    // the correct transaction rather than merely permitting it.
    db.exec(`CREATE TABLE IF NOT EXISTS itinerary_stops (
      id           INTEGER PRIMARY KEY,
      uid          TEXT,
      itinerary_id INTEGER NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
      group_id     INTEGER,
      label        TEXT NOT NULL DEFAULT '',
      mark_uid     TEXT,
      resolution   TEXT NOT NULL DEFAULT 'experiential'
                     CHECK (resolution IN ('linked','particular','experiential','allocation')),
      position     INTEGER CHECK (position IS NULL OR position >= 1),
      visibility   TEXT NOT NULL DEFAULT 'visible'
                     CHECK (visibility IN ('visible','suspended')),
      t_year           INTEGER,
      t_period         TEXT CHECK (t_period IS NULL OR t_period IN ('spring','summer','fall','winter')),
      t_modifier       TEXT CHECK (t_modifier IS NULL OR t_modifier IN ('early','mid','late')),
      t_modifier_scope TEXT CHECK (t_modifier_scope IS NULL OR t_modifier_scope IN ('year','period','month')),
      t_month          INTEGER CHECK (t_month IS NULL OR (t_month BETWEEN 1 AND 12)),
      t_day            INTEGER CHECK (t_day IS NULL OR (t_day BETWEEN 1 AND 31)),
      t_weekday        TEXT CHECK (t_weekday IS NULL OR t_weekday IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
      t_daypart        TEXT CHECK (t_daypart IS NULL OR t_daypart IN ('morning','afternoon','evening','night')),
      t_clock          TEXT,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at   TEXT,
      CHECK ((t_modifier IS NULL) = (t_modifier_scope IS NULL)),
      -- linked iff a Mark is referenced. Both directions in one expression;
      -- mark_uid IS NOT NULL yields 0/1 so the comparison is determinate.
      CHECK ((resolution = 'linked') = (mark_uid IS NOT NULL)),
      FOREIGN KEY (group_id, itinerary_id)
        REFERENCES itinerary_groups(id, itinerary_id) ON DELETE RESTRICT)`);

    // Same UUIDv4-in-SQL the 011 migration uses; redeclared because that one is
    // scoped to its own migration function.
    const UUID_SQL = `lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||
      substr(hex(randomblob(2)),2)||'-'||substr('89ab',abs(random())%4+1,1)||
      substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))`.replace(/\s+/g, '');
    for (const t of ['itineraries', 'itinerary_groups', 'itinerary_stops']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS trg_${t}_uid AFTER INSERT ON ${t}
        FOR EACH ROW WHEN NEW.uid IS NULL
        BEGIN UPDATE ${t} SET uid = ${UUID_SQL} WHERE rowid = NEW.rowid; END`);
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_itin_user ON itineraries(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_itin_group_itin ON itinerary_groups(itinerary_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_itin_stop_itin ON itinerary_stops(itinerary_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_itin_stop_group ON itinerary_stops(group_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_itin_stop_mark ON itinerary_stops(mark_uid)');

    // Authored rank is unique within its sequencing scope. NULLs are distinct in
    // SQLite unique indexes, so any number of unsequenced rows coexist; the
    // partial predicate keeps the index to authored rows only.
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_itin_group_pos
      ON itinerary_groups(itinerary_id, position) WHERE position IS NOT NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_itin_stop_pos_grouped
      ON itinerary_stops(group_id, position) WHERE position IS NOT NULL AND group_id IS NOT NULL`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_itin_stop_pos_ungrouped
      ON itinerary_stops(itinerary_id, position) WHERE position IS NOT NULL AND group_id IS NULL`);
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
// Collections organise the member's OWN Notes. The delete is scoped to this
// member's collections: the previous unscoped `DELETE ... WHERE object_id=?`
// wiped every user's membership for a shared object.
function setCollections(userId, noteId, names) {
  q(`DELETE FROM note_collections WHERE note_id=? AND collection_id IN
       (SELECT id FROM collections WHERE user_id=?)`).run(noteId, userId);
  for (const n of [...new Set(names.map((x) => String(x).trim()).filter(Boolean))]) {
    q("INSERT OR IGNORE INTO collections(user_id,name,kind) VALUES(?,?,'note')").run(userId, n);
    const c = q("SELECT id FROM collections WHERE user_id=? AND name=? AND kind='note'").get(userId, n);
    q('INSERT OR IGNORE INTO note_collections(note_id,collection_id) VALUES(?,?)').run(noteId, c.id);
  }
}
const followCounts = (id) => ({ followers: q('SELECT COUNT(*) c FROM follows WHERE followee_id=?').get(id).c, following: q('SELECT COUNT(*) c FROM follows WHERE follower_id=?').get(id).c });
const isFollowing = (a, b) => !!q('SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?').get(a, b);
const objCollections = (noteId) => q(`SELECT c.id, c.name FROM note_collections nc
  JOIN collections c ON c.id=nc.collection_id WHERE nc.note_id=? ORDER BY c.name`).all(noteId);
const canSee = (o, me) => !o.private || (me && (me.id === o.user_id || me.is_admin));
// An image is public only while some public record actually shows it. Nothing
// else makes bytes public: an orphan upload, or one used solely by private
// records, stays owner-only. Both reference forms are checked because rows
// written before the uid migration may still carry /i/<integer>.
function imageIsPublic(img) {
  const a = `/i/${img.uid}`, b = `/i/${img.id}`;
  if (q('SELECT 1 FROM objects WHERE private=0 AND (image=? OR image=?)').get(a, b)) return true;
  if (q('SELECT 1 FROM marks WHERE private=0 AND (image=? OR image=?)').get(a, b)) return true;
  if (hasTable('ensemble_artifacts')
    && q(`SELECT 1 FROM ensemble_artifacts f JOIN ensembles e ON e.id=f.ensemble_id
          WHERE e.private=0 AND f.image_uid=?`).get(img.uid)) return true;
  if (hasTable('ensemble_components')
    && q(`SELECT 1 FROM ensemble_components c JOIN ensembles e ON e.id=c.ensemble_id
          WHERE e.private=0 AND c.image_uid=?`).get(img.uid)) return true;
  return false;
}
const imageVisibleTo = (img, me) =>
  (me && (me.id === img.user_id || me.is_admin)) ? true : imageIsPublic(img);
const hasTable = (t) => !!q("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
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
// ---- Itinerary temporal accessors ------------------------------------------
// Nine components, at three scopes, with one rule: NULL means the member did
// not assert it. Nothing is ever a placeholder, so every reader can ask "is
// this column null" rather than consulting a precision flag.
//
// `t_modifier_scope` is canonical, never derived. "late 2028" and "late fall
// 2028" differ only in that column, and reconstructing it from whichever
// components happen to coexist would silently move the modifier when a period
// is added later.
const T_COLS = ['t_year', 't_period', 't_modifier', 't_modifier_scope',
                't_month', 't_day', 't_weekday', 't_daypart', 't_clock'];
const T_PERIODS  = ['spring', 'summer', 'fall', 'winter'];
const T_MODS     = ['early', 'mid', 'late'];
const T_SCOPES   = ['year', 'period', 'month'];
const T_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const T_DAYPARTS = ['morning', 'afternoon', 'evening', 'night'];
const T_MONTHS   = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];   // Feb: see below
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const temporalOf = (row) => { const t = {}; for (const k of T_COLS) t[k] = row[k] ?? null; return t; };
const temporalEmpty = (t) => T_COLS.every((k) => t[k] === null || t[k] === undefined);

// Rejects what cannot be true. Does NOT reject assertions that merely disagree
// with each other -- a weekday contradicting a date is two valid claims the
// member made, and temporalConflicts() surfaces it instead.
function temporalValidate(t) {
  const has = (k) => t[k] !== null && t[k] !== undefined && t[k] !== '';
  if (has('t_period') && !T_PERIODS.includes(t.t_period)) return 'period must be one of ' + T_PERIODS.join(', ');
  if (has('t_modifier') && !T_MODS.includes(t.t_modifier)) return 'modifier must be one of ' + T_MODS.join(', ');
  if (has('t_modifier_scope') && !T_SCOPES.includes(t.t_modifier_scope)) return 'modifier scope must be one of ' + T_SCOPES.join(', ');
  if (has('t_weekday') && !T_WEEKDAYS.includes(t.t_weekday)) return 'weekday must be a lowercase English day name';
  if (has('t_daypart') && !T_DAYPARTS.includes(t.t_daypart)) return 'daypart must be one of ' + T_DAYPARTS.join(', ');
  if (has('t_clock') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.t_clock)) return 'clock must be HH:MM, 24-hour';
  if (has('t_year') && (t.t_year < 1 || t.t_year > 9999)) return 'year is out of range';
  if (has('t_month') && (t.t_month < 1 || t.t_month > 12)) return 'month must be 1-12';
  if (has('t_day') && (t.t_day < 1 || t.t_day > 31)) return 'day must be 1-31';

  // Pairing, and the scope must name something actually asserted.
  if (has('t_modifier') !== has('t_modifier_scope')) return 'modifier and modifier scope must be given together';
  if (has('t_modifier_scope')) {
    const backing = { year: 't_year', period: 't_period', month: 't_month' }[t.t_modifier_scope];
    if (!has(backing)) return `modifier scope '${t.t_modifier_scope}' needs ${backing.slice(2)} to be asserted`;
  }

  // A day must exist in its month. With no year asserted, February accepts 29:
  // rejecting it would manufacture a year the member never gave.
  if (has('t_day') && has('t_month')) {
    let max = DAYS_IN_MONTH[t.t_month - 1];
    if (t.t_month === 2 && has('t_year')) max = isLeap(t.t_year) ? 29 : 28;
    if (t.t_day > max) return `${T_MONTHS[t.t_month - 1]} has no day ${t.t_day}`;
  }
  return null;
}

// Two assertions that are each valid but disagree. Reported, never corrected,
// and neither is dropped -- the same treatment group date conflicts get.
function temporalConflicts(t) {
  const out = [];
  if (t.t_weekday && t.t_year && t.t_month && t.t_day) {
    const actual = T_WEEKDAYS[(new Date(Date.UTC(t.t_year, t.t_month - 1, t.t_day)).getUTCDay() + 6) % 7];
    if (actual !== t.t_weekday) {
      out.push(`${t.t_weekday[0].toUpperCase()}${t.t_weekday.slice(1)} does not fall on ` +
               `${T_MONTHS[t.t_month - 1]} ${t.t_day}, ${t.t_year} (that is a ` +
               `${actual[0].toUpperCase()}${actual.slice(1)})`);
    }
  }
  return out;
}

// The only place temporal state becomes words. Reads which components exist
// plus the modifier's canonical scope.
function temporalFormat(t) {
  if (!t || temporalEmpty(t)) return '';
  const mod = t.t_modifier, scope = t.t_modifier_scope;
  const m = t.t_month ? T_MONTHS[t.t_month - 1] : null;
  const wd = t.t_weekday ? t.t_weekday[0].toUpperCase() + t.t_weekday.slice(1) : null;
  const parts = [];

  if (m && t.t_day) parts.push(`${scope === 'month' && mod ? mod + ' ' : ''}${m} ${t.t_day}${t.t_year ? ', ' + t.t_year : ''}`);
  else if (m) parts.push(`${scope === 'month' && mod ? mod + ' ' : ''}${m}${t.t_year ? ' ' + t.t_year : ''}`);
  else if (t.t_period) parts.push(`${scope === 'period' && mod ? mod + ' ' : ''}${t.t_period}${t.t_year ? ' ' + t.t_year : ''}`);
  else if (t.t_year) parts.push(`${scope === 'year' && mod ? mod + ' ' : ''}${t.t_year}`);

  // A year-scoped modifier alongside a period or month is a separate claim from
  // the head phrase, so it is said separately rather than moved.
  if (mod && scope === 'year' && (t.t_period || t.t_month)) parts.push(`${mod} in the year`);
  if (mod && scope === 'period' && t.t_month) parts.push(`${mod} in the ${t.t_period}`);

  const head = parts.join(', ');
  const when = [wd, head].filter(Boolean).join(' \u00b7 ');
  const clock = t.t_clock ? prettyClock(t.t_clock) : null;
  const time = [t.t_daypart ? t.t_daypart : null, clock].filter(Boolean).join(', ');
  return [when, time].filter(Boolean).join(' \u00b7 ');
}
const prettyClock = (hhmm) => {
  const [h, mn] = hhmm.split(':').map(Number);
  const ap = h < 12 ? 'AM' : 'PM'; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mn).padStart(2, '0')} ${ap}`;
};

// Applies an incoming assertion over an existing one.
//
// `intent` is supplied by the caller because only the caller knows the member's
// act: 'refine' when the plan became more precise, 'correct' when the earlier
// assertion was wrong, and null when a bare edit reveals neither. Null is the
// default and yields 'edited' -- the provenance action must describe evidence
// that exists, not a guess about motive.
function temporalApply(existing, incoming, intent = null) {
  const next = { ...existing };
  const changed = [];
  for (const k of T_COLS) {
    if (!(k in incoming)) continue;
    const v = incoming[k] === '' ? null : incoming[k];
    if (next[k] !== v) { next[k] = v; changed.push(k); }
  }

  // Supersession, scoped to the member's act. A month supersedes a period; a
  // component finer than the modifier's scope supersedes the modifier, because
  // the imprecision it described no longer exists. Scope itself never migrates.
  if ('t_month' in incoming && incoming.t_month != null && next.t_period && !('t_period' in incoming)) {
    next.t_period = null; changed.push('t_period');
    if (next.t_modifier_scope === 'period') { next.t_modifier = null; next.t_modifier_scope = null; changed.push('t_modifier', 't_modifier_scope'); }
  }
  if ('t_day' in incoming && incoming.t_day != null && next.t_modifier_scope === 'month') {
    next.t_modifier = null; next.t_modifier_scope = null; changed.push('t_modifier', 't_modifier_scope');
  }

  const action = intent === 'refine' ? 'enriched' : intent === 'correct' ? 'corrected' : 'edited';
  return { next, changed: [...new Set(changed)], action };
}

// A sortable tuple, or null when chronology is not determinable from what was
// asserted. Returning null is what lets derived ordering decline rather than guess.
function temporalChronoKey(t) {
  if (!t || t.t_year == null) return null;
  if (t.t_month != null) return [t.t_year, t.t_month, t.t_day ?? 0];
  if (t.t_period) return [t.t_year, { spring: 3, summer: 6, fall: 9, winter: 12 }[t.t_period], 0];
  return null;
}

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

// ---------- Owned + Warrant (v1.15) ----------
// Both are append-only assertion logs. Current state is the newest row that has
// not been superseded by a later correction. There is deliberately one function
// per primitive that computes this, so the supersession rule cannot drift
// between the web, MCP and export paths.
//
// Three-valued on purpose: null means NEVER ASSERTED, which is not the same as
// 'released'/'revoked' and is emphatically not negative evidence. Nothing
// downstream may collapse these.
// How worn an owned thing looks. Patina is private evidence — it is only ever
// rendered for the owner themselves, because the length of time someone has
// owned something is not other people's business. Thresholds are the ones
// Brian specified: new, a day, a week, three months, a year, three years.
// ============================================================================
// RESURFACING — v1
// ----------------------------------------------------------------------------
// The corpus occasionally returns one of the member's own records to the All
// feed because something factual about its history makes it worth encountering
// again. Not recommendation, not inferred sentiment, not a Memories product.
//
// Scope is deliberately narrow: the signed-in All feed only, at most ONE
// insertion per page, and nothing at all when no candidate clears its floor.
// Following and Followers are out — the network is not developed enough for
// social resurfacing to teach us anything yet.
//
// The evidence contract governs the copy. Each type is a verb tied to a
// specific column, and the interface may not claim more than the column says:
//
//   visits.visited_on      -> "You checked in here"   (a day they were there)
//   objects.created_at     -> "You recorded this"     (a day they wrote it down)
//   COUNT(visits) >= 2     -> "N recorded visits"
//   ensembles.created_at   -> "Composed together"
//
// Note creation is NEVER rendered as discovery, purchase, or affection, and
// repeated visits are NEVER rendered as a favourite. Ownership timestamps are
// deliberately absent: ownership_assertions.created_at supports only "marked
// as owned", which is a colophon fact, not a resurfacing headline.
// ============================================================================
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const inWords = (n) => (n > 0 && n < WORDS.length ? WORDS[n] : String(n));
// How long ago, said the way a person would say it. Still strictly derived
// from the stored date — the phrasing changes, the evidence does not.
const yearsAgoWords = (iso) => {
  const then = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  const y = new Date().getUTCFullYear() - then.getUTCFullYear();
  return y <= 0 ? 'earlier this year' : y === 1 ? 'a year ago today' : `${inWords(y)} years ago today`;
};
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const longDate = (iso) => { const d = String(iso).slice(0, 10).split('-');
  return d.length === 3 ? `${MONTHS[+d[1] - 1]} ${+d[2]}, ${d[0]}` : String(iso); };
const monthYear = (iso) => { const d = String(iso).slice(0, 10).split('-');
  return d.length >= 2 ? `${MONTHS[+d[1] - 1]} ${d[0]}` : String(iso); };

// Deterministic per (member, day): a refresh does not reshuffle, tomorrow may
// differ. No ranking — eligibility plus a floor plus a cooldown is the whole
// selection model, and it stays explainable in one sentence.
function seededPick(seedStr, list) {
  if (!list.length) return null;
  let h = 2166136261;
  for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return list[h % list.length];
}

// A record surfaced recently is not eligible again, in any type, for 60 days.
const RESURFACE_COOLDOWN_DAYS = 60;
// Today is deliberately excluded from the cooldown: a record surfaced this
// morning must stay eligible for the rest of the day, or the block vanishes on
// the first refresh. The cooldown starts tomorrow and runs for 60 days.
const recentlySurfaced = (userId) => new Set(
  q(`SELECT subject_type || ':' || subject_id k FROM resurfaced
     WHERE user_id=? AND surfaced_on > date('now', ?) AND surfaced_on < date('now')`)
    .all(userId, `-${RESURFACE_COOLDOWN_DAYS} days`).map((r) => r.k));
const noteCooldown = (set, o) => !set.has('note:' + o.id);
const markCooldown = (set, m) => !set.has('mark:' + m.id);

// Every candidate carries the evidence that produced it, so the copy can never
// drift away from the column it came from.
function resurfaceCandidate(me) {
  const today = new Date().toISOString().slice(0, 10);
  const seed = (k) => `${me.id}:${today}:${k}`;
  const md = today.slice(5, 10);
  const cold = recentlySurfaced(me.id);
  const types = [];

  // 1. ON THIS DAY — a check-in on this calendar date in an earlier year.
  const visitDay = q(`SELECT v.visited_on, m.id mark_id FROM visits v JOIN marks m ON m.id=v.mark_id
    WHERE v.user_id=? AND v.visited_on IS NOT NULL AND v.visited_on <> ''
      AND strftime('%m-%d', v.visited_on)=? AND v.visited_on < date('now','-1 year')`).all(me.id, md);
  const vd = seededPick(seed('visit-day'), visitDay);
  if (vd) { const m = q(MARK_SQL + ' WHERE m.id=?').get(vd.mark_id);
    if (m && markCooldown(cold, m)) types.push({ kind: 'on-this-day', label: 'On this day',
      fact: `You checked in here ${yearsAgoWords(vd.visited_on)}`, m }); }

  // 2. ON THIS DAY — a note recorded on this date in an earlier year. Recorded,
  //    not discovered: created_at is the day it was written down, nothing more.
  const noteDay = q(OBJ_SQL + ` WHERE o.user_id=? AND strftime('%m-%d', o.created_at)=?
    AND o.created_at < date('now','-1 year')`).all(me.id, md).filter((o) => noteCooldown(cold, o));
  const nd = seededPick(seed('note-day'), noteDay);
  if (nd) types.push({ kind: 'on-this-day', label: 'On this day',
    fact: `You wrote this down ${yearsAgoWords(nd.created_at)}`, o: nd });

  // 3. THIS MONTH BEFORE — the understudy, used only when no exact-day
  //    candidate exists, so the two never appear on the same day.
  if (!types.length) {
    const monthNotes = q(OBJ_SQL + ` WHERE o.user_id=? AND strftime('%m', o.created_at)=?
      AND o.created_at < date('now','-1 year')`).all(me.id, today.slice(5, 7)).filter((o) => noteCooldown(cold, o));
    const mn = seededPick(seed('month'), monthNotes);
    if (mn) types.push({ kind: 'this-month', label: 'Earlier in ' + MONTHS[+today.slice(5, 7) - 1],
      fact: `You wrote this down in ${monthYear(mn.created_at)}`, o: mn });
  }

  // 4. RETURNED TO — explicit repeated check-ins. Repetition is reported as a
  //    count; it is never converted into a preference.
  const returned = q(MARK_SQL + ` WHERE m.user_id=? AND
    (SELECT COUNT(*) FROM visits v WHERE v.mark_id=m.id) >= 2`).all(me.id).filter((m) => markCooldown(cold, m));
  const rt = seededPick(seed('returned'), returned);
  if (rt) { const n = q('SELECT COUNT(*) c FROM visits WHERE mark_id=?').get(rt.id).c;
    types.push({ kind: 'returned', label: 'Somewhere you\u2019ve been back to',
      fact: `You\u2019ve checked in ${inWords(n)} times`, m: rt }); }

  // 5. USED TOGETHER BEFORE — an explicit Ensemble relationship, at least a
  //    season old so it is history rather than this week's work.
  const ens = q(`SELECT * FROM ensembles WHERE user_id=? AND created_at < date('now','-90 days')
    AND (SELECT COUNT(*) FROM ensemble_components c WHERE c.ensemble_id=ensembles.id AND c.note_uid IS NOT NULL) >= 2`).all(me.id);
  const en = seededPick(seed('ens'), ens);
  if (en) { const comp = q(OBJ_SQL + ` JOIN ensemble_components c ON c.note_uid=o.uid
      WHERE c.ensemble_id=? ORDER BY c.position LIMIT 1`).get(en.id);
    if (comp && noteCooldown(cold, comp)) types.push({ kind: 'together', label: 'You put these together',
      fact: `Composed with another note in ${monthYear(en.created_at)}`, o: comp, href: `/e/${en.id}` }); }

  // One insertion. Rotate which type wins by the day, so a member with several
  // eligible histories does not see the same kind every morning.
  const eligible = types.filter((b) => (b.o ? canSee(b.o, me) : b.m ? canSee(b.m, me) : false));
  return seededPick(seed('type'), eligible);
}

function resurfaceCard(block, me) {
  const inner = block.o ? objectCard(block.o, me) : markCard(block.m, me);
  const label = block.href ? `<a href="${block.href}">${esc(block.label)}</a>` : esc(block.label);
  return `<aside class="resurface" data-kind="${block.kind}" aria-label="Resurfaced from your records">
    <p class="resurface-eyebrow">${label}<span class="fact">${esc(block.fact)}</span></p>
    <div class="resurface-body">${inner}</div>
  </aside>`;
}

// The block sits ABOVE the feed grid, not inside it. Spliced among the
// organic entries it would be an editorial interruption masquerading as one
// of the member's own posts — a small dishonesty. Standing above the stream
// in its own frame, it can be read as furniture and skipped past.
function resurfaceBanner(me, feed, searching) {
  if (!me || feed !== 'all') return { html: '', skip: null };   // All feed only
  // A search is a question with an answer; an editorial resurfacing above it
  // would be an interruption pretending to be a result.
  if (searching) return { html: '', skip: null };
  const block = resurfaceCandidate(me);
  if (!block) return { html: '', skip: null };                  // nothing eligible: show nothing
  const rec = block.o ? ['note', block.o.id] : ['mark', block.m.id];
  q(`INSERT INTO resurfaced(user_id, subject_type, subject_id, surfaced_on)
     VALUES(?,?,?,date('now'))
     ON CONFLICT(user_id, subject_type, subject_id) DO UPDATE SET surfaced_on=date('now')`).run(me.id, rec[0], rec[1]);
  // A record shown in the frame must not also appear in the column beneath it.
  // Usually it is old enough not to collide, but a recent one would otherwise
  // be presented twice on the same screen.
  return { html: resurfaceCard(block, me), skip: rec.join(':') };
}

// ============================================================================
// PROVENANCE COLOPHON
// ----------------------------------------------------------------------------
// The record's history inscribed into the page around it — marginalia on
// desktop, below the comments on a phone. Not an activity log and not a
// metadata panel: the substrate underneath may be comprehensive, the
// inscription above it is a selective editorial projection.
//
// Same evidence discipline as resurfacing. In particular
// ownership_assertions.created_at supports "Marked as owned" and NOT "Owned
// since" — the schema has no explicit ownership start date, and the interface
// may not launder a row's timestamp into a biographical claim.
//
// Implementation history (edits, image swaps, privacy toggles, migrations) is
// never included; none of it is provenance.
// ============================================================================
function colophonEntries(o) {
  const out = [];
  out.push(['Recorded', monthYear(o.created_at)]);

  if (o.renoted_from_uid) {
    const src = q('SELECT u.handle FROM objects s JOIN users u ON u.id=s.user_id WHERE s.uid=?').get(o.renoted_from_uid);
    if (src) out.push(['Re-noted from', src.handle]);
  }
  // the owner's own assertion, latest wins
  const own = q(`SELECT created_at, state FROM ownership_assertions WHERE user_id=? AND object_id=?
    ORDER BY id DESC LIMIT 1`).get(o.user_id, o.id);
  if (own && own.state === 'owned') out.push(['Marked as owned', monthYear(own.created_at)]);

  const nw = q(`SELECT * FROM warrants WHERE subject_type='object' AND subject_uid=? AND user_id=? ORDER BY id`)
    .all(o.uid, o.user_id);
  const nLastActive = [...nw].reverse().find((r) => r.state === 'active');
  if (nLastActive) out.push(['Warranted', monthYear(nLastActive.created_at)]);
  if (nw.length && nw[nw.length - 1].state === 'revoked' && nLastActive) {
    out.push(['Warrant withdrawn', monthYear(nw[nw.length - 1].created_at)]);
  }

  const ens = q('SELECT COUNT(DISTINCT ensemble_id) c FROM ensemble_components WHERE note_uid=?').get(o.uid).c;
  if (ens) out.push(['Composed in', `${ens} ${ens === 1 ? 'Ensemble' : 'Ensembles'}`]);
  return out;
}

// The whole composition is the watermark — heading, mark, rules and type all
// at one opacity, sitting directly on the atmospheric field with no glass
// beneath it. The device is placed after the first entry so it sits inside the
// history rather than crowning it; the crest-like silhouette comes from the
// type widths alone, never from a drawn shape.
// The colophon is centred against the note card's height on wide screens.
// The card's height is not knowable in CSS — it depends on the image, the
// description and how many tags wrap — so it is measured once after layout
// settles and written to a custom property. Below the breakpoint the rule
// does not apply and this is inert.
const COLOPHON_SCRIPT = `<script>
(function () {
  var colo = document.querySelector('.colophon'); if (!colo) return;
  var card = document.querySelector('.grid-single .note') || document.querySelector('.grid-single');
  if (!card) return;
  var place = function () {
    if (!matchMedia('(min-width: 78rem)').matches) { colo.style.removeProperty('--colo-top'); return; }
    var feed = colo.parentElement.getBoundingClientRect();
    var c = card.getBoundingClientRect();
    var mid = (c.top - feed.top) + c.height / 2;          // card centre, feed-relative
    colo.style.setProperty('--colo-top', Math.max(0, Math.round(mid - colo.offsetHeight / 2)) + 'px');
  };
  place();
  addEventListener('resize', place);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  var img = card.querySelector('img'); if (img && !img.complete) img.addEventListener('load', place);
})();
<\/script>`;

function colophon(o) {
  const rows = colophonEntries(o);
  if (!rows.length) return '';
  const entry = ([k, v]) => `<span class="colo-k">${esc(k)}</span><span class="colo-v">${esc(v)}</span>`;
  return `<aside class="colophon" aria-label="Provenance">
  <span class="colo-head">Provenance</span><span class="colo-rule"></span>
  <span class="colo-lead">This note was</span>
  ${entry(rows[0])}
  <img class="colo-mark" src="/mark.png" alt="" width="17" height="23">
  ${rows.slice(1).map(entry).join('\n  ')}
  <span class="colo-rule"></span>
</aside>` + COLOPHON_SCRIPT;
}

// A travel mark's wear comes from the oldest check-in, not from when the mark
// was written down: the place has been part of the member's life since the
// first time they actually went, which is the date that means something.
function markPatinaTier(markId) {
  const r = q(`SELECT MIN(COALESCE(NULLIF(visited_on,''), date(created_at))) first FROM visits WHERE mark_id=?`).get(markId);
  if (!r || !r.first) return 0;
  const days = (Date.now() - Date.parse(r.first + 'T00:00:00Z')) / 86400000;
  if (!isFinite(days)) return 0;
  if (days < 1) return 1;
  if (days < 7) return 2;
  if (days < 90) return 3;
  if (days < 365) return 4;
  if (days < 365 * 3) return 5;
  return 6;
}
// Two aged cards side by side were showing the same constellation, because the
// dust is one tiled image. Each record offsets the tile by its own amount —
// derived from its id so it is stable across reloads, and a prime-ish stride
// so consecutive ids land far apart rather than drifting by a few pixels.
function patinaOffset(kind, id) {
  const h = (kind === 'mark' ? 7919 : 6271) * (id + 13);
  return ` style="--patina-x:${h % 997}px;--patina-y:${(h * 31) % 991}px"`;
}
function ownedPatinaTier(since) {
  if (!since) return 1;
  const days = (Date.now() - Date.parse(since.replace(' ', 'T') + 'Z')) / 86400000;
  if (!isFinite(days) || days < 1) return 1;      // new
  if (days < 7) return 2;                          // a day
  if (days < 90) return 3;                         // a week
  if (days < 365) return 4;                        // three months
  if (days < 365 * 3) return 5;                    // a year
  return 6;                                        // three years and beyond
}
function ownedState(userId, objectId) {
  const rows = q(`SELECT * FROM ownership_assertions
    WHERE user_id=? AND object_id=? ORDER BY id`).all(userId, objectId);
  if (!rows.length) return { state: null, since: null, history_count: 0 };
  const corrected = new Set(rows.filter((r) => r.supersedes).map((r) => r.supersedes));
  const live = rows.filter((r) => r.state !== 'retracted' && !corrected.has(r.uid));
  const last = live[live.length - 1];
  return { state: last ? last.state : null,
           since: last ? last.created_at : null,
           history_count: rows.length };
}
function warrantState(userId, subjectType, subjectUid) {
  const rows = q(`SELECT * FROM warrants
    WHERE user_id=? AND subject_type=? AND subject_uid=? ORDER BY id`).all(userId, subjectType, subjectUid);
  if (!rows.length) return { state: null, since: null, published: false, history_count: 0 };
  const corrected = new Set(rows.filter((r) => r.supersedes).map((r) => r.supersedes));
  const live = rows.filter((r) => r.state !== 'retracted' && !corrected.has(r.uid));
  const last = live[live.length - 1];
  return { state: last ? last.state : null,
           since: last ? last.created_at : null,
           // published is meaningful only while a warrant is active
           published: !!(last && last.state === 'active' && last.published),
           history_count: rows.length };
}
// Is this subject publicly warranted by its owner? Drives the seal on a card.
// Reads state only — never `published`, which is social metadata.
const publicWarrant = (userId, subjectType, subjectUid) =>
  warrantState(userId, subjectType, subjectUid).state === 'active';

function assertOwned(userId, objectId, ctx) {
  const r = q('INSERT INTO ownership_assertions(user_id,object_id,note_uid,state) VALUES(?,?,?,\'owned\')').run(userId, objectId, uidOf('objects', objectId));
  recordProvenance('ownership', uidOf('ownership_assertions', r.lastInsertRowid), 'asserted', ctx, { source_kind: 'manual' });
  return uidOf('ownership_assertions', r.lastInsertRowid);
}
function releaseOwned(userId, objectId, ctx) {
  const r = q('INSERT INTO ownership_assertions(user_id,object_id,note_uid,state) VALUES(?,?,?,\'released\')').run(userId, objectId, uidOf('objects', objectId));
  recordProvenance('ownership', uidOf('ownership_assertions', r.lastInsertRowid), 'released', ctx, { source_kind: 'manual' });
  return uidOf('ownership_assertions', r.lastInsertRowid);
}
// A correction, not a lifecycle transition: it must not leave a period during
// which the member is recorded as having owned the thing. The superseded row
// stays visible as "what was asserted"; ownedState() excludes it from periods.
function correctOwned(userId, objectId, ctx) {
  const rows = q(`SELECT * FROM ownership_assertions
    WHERE user_id=? AND object_id=? ORDER BY id`).all(userId, objectId);
  const corrected = new Set(rows.filter((r) => r.supersedes).map((r) => r.supersedes));
  const live = rows.filter((r) => r.state !== 'retracted' && !corrected.has(r.uid));
  const target = live[live.length - 1];
  if (!target || target.state !== 'owned') return null;   // nothing to correct
  const r = q('INSERT INTO ownership_assertions(user_id,object_id,note_uid,state,supersedes) VALUES(?,?,?,\'retracted\',?)')
    .run(userId, objectId, uidOf('objects', objectId), target.uid);
  recordProvenance('ownership', uidOf('ownership_assertions', r.lastInsertRowid), 'corrected', ctx,
    { source_kind: 'correction', source_ref: target.uid });
  return uidOf('ownership_assertions', r.lastInsertRowid);
}
function assertWarrant(userId, subjectType, subjectUid, publish, ctx) {
  const r = q('INSERT INTO warrants(user_id,subject_type,subject_uid,state,published) VALUES(?,?,?,\'active\',?)')
    .run(userId, subjectType, subjectUid, publish ? 1 : 0);
  recordProvenance('warrant', uidOf('warrants', r.lastInsertRowid), 'asserted', ctx,
    { source_kind: 'manual', fields: publish ? 'published' : 'quiet' });
  return uidOf('warrants', r.lastInsertRowid);
}
function revokeWarrant(userId, subjectType, subjectUid, ctx) {
  const r = q('INSERT INTO warrants(user_id,subject_type,subject_uid,state,published) VALUES(?,?,?,\'revoked\',0)')
    .run(userId, subjectType, subjectUid);
  recordProvenance('warrant', uidOf('warrants', r.lastInsertRowid), 'revoked', ctx, { source_kind: 'manual' });
  return uidOf('warrants', r.lastInsertRowid);
}
// subject_uid is polymorphic, so SQLite cannot cascade it. The four delete
// paths call this explicitly. Consistent with the v1.11 cascade policy: the
// parent's own 'deleted' provenance explains the removal, so no per-warrant
// deletion rows are written (writing 'deleted' here would also contradict the
// vocabulary, since every other warrant transition is an append).
const dropWarrantsFor = (subjectType, subjectUid) =>
  q('DELETE FROM warrants WHERE subject_type=? AND subject_uid=?').run(subjectType, subjectUid);
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

function layout({ title, body, me, flash, cls = '', nav = '', req = null }) {
  req = req || CURRENT_REQ;
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
<meta name="theme-color" content="${skinOf(me, req) !== 'modern' ? '#262727' : modeOf(me, req) === 'light' ? '#e4e7f0' : modeOf(me, req) === 'dark' ? '#15161f' : '#15161f'}">${skinOf(me, req) === 'modern' && modeOf(me, req) === 'system' ? `
<meta name="theme-color" content="#e4e7f0" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#15161f" media="(prefers-color-scheme: dark)">` : ''}<link rel="stylesheet" href="/style.css?v=${CSS_V}"><link rel="stylesheet" href="/style.shared.css?v=${CSS_SHARED_V}">${skinOf(me, req) === 'modern' ? `<link rel="stylesheet" href="/style.modern.css?v=${CSS_MODERN_V}">` : ''}${skinOf(me, req) === 'modern' && modeOf(me, req) === 'system' ? `<script>(function(){var m=matchMedia('(prefers-color-scheme: light)');var b=document.documentElement;function f(){b.classList.toggle('m-light',m.matches);}f();m.addEventListener('change',f);})();</script>` : ''}</head><body class="${cls}${me ? ' is-in' : ''}" data-skin="${skinOf(me, req)}" data-mode="${modeOf(me, req)}">${skinOf(me, req) === 'modern' ? '<div class="m-backdrop" aria-hidden="true"></div>' : ''}
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
`
  : `<header class="masthead"><div class="wrap">
  <a class="mark" href="/welcome"><img src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="17" height="23"><span>discriminant.ly</span></a>
  <form class="signin" method="post" action="/login"><input name="email" type="email" placeholder="email" required><input name="password" type="password" placeholder="password" required><button class="link caps">Sign in</button></form>
</div></header>`}

<script>

// Bound the size of a browser upload without visibly degrading it. A phone
// photo is 4000px and several megabytes, which is slow to send — but these are
// pictures of things the member cares about, so the ceiling is generous and
// the quality high. Anything already within the ceiling is re-encoded at near
// full quality rather than being squeezed.
function readImage(file, cb) {
  if (!file || file.type.indexOf('image/') !== 0) return;
  var r = new FileReader();
  r.onload = function () {
    var img = new Image();
    img.onload = function () {
      var MAX = 2560, w = img.width, h = img.height;
      if (Math.max(w, h) > MAX) { var k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.94));
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
})();

// Everything below runs regardless of whether a curtain exists on the page —
// it must not live inside the IIFE above, whose \`if (!c) return;\` guard was
// silently skipping all of it (layoutFeed included) on every page that has
// no curtain, i.e. every signed-out page.
(function () {
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
    // Optional callbacks, added for the Owned release-vs-correction question,
    // where BOTH buttons are real outcomes rather than confirm/cancel. Existing
    // callers pass neither and keep the plain form-action behaviour untouched.
    dlg.__onConfirm = opts.onConfirm || null;
    dlg.__onDismiss = opts.onDismiss || null;
    dlg.__twoWay = !!(opts.onConfirm || opts.onDismiss);
    dlg.classList.add('is-open');
  };
  document.addEventListener('DOMContentLoaded', function () {
    var cdlg = document.getElementById('confirm-dialog');
    if (!cdlg) return;
    // In two-way mode the dismiss button is a real second outcome, not a
    // cancel, so it fires its callback rather than merely closing.
    cdlg.querySelectorAll('[data-dismiss]').forEach(function (x) {
      x.addEventListener('click', function () {
        cdlg.classList.remove('is-open');
        var cb = cdlg.__onDismiss; cdlg.__onDismiss = null; cdlg.__onConfirm = null;
        if (cb) cb();
      });
    });
    // The confirm button normally submits the dialog's form. When a callback
    // is supplied there is no form action to submit, so stop the submit and
    // run the callback instead.
    cdlg.querySelector('form').addEventListener('submit', function (ev) {
      if (!cdlg.__twoWay) return;
      ev.preventDefault();
      cdlg.classList.remove('is-open');
      var cb = cdlg.__onConfirm; cdlg.__onConfirm = null; cdlg.__onDismiss = null; cdlg.__twoWay = false;
      if (cb) cb();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { cdlg.classList.remove('is-open'); cdlg.__onConfirm = null; cdlg.__onDismiss = null; cdlg.__twoWay = false; }
    });
  });

  // Show more: fetch the next page and append it, so the feed never reloads.
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('.more-link');
    if (!link || link.dataset.busy) return;
    // A search group pages itself: replace that group's cards and its own
    // link, and leave every other group exactly as it is.
    if (link.classList.contains('search-more')) {
      e.preventDefault(); link.dataset.busy = '1';
      var wasT = link.textContent; link.textContent = 'Loading';
      var key = link.dataset.group;
      fetch(link.href, { headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var next = doc.getElementById('group-' + key), here = document.getElementById('group-' + key);
          if (!next || !here) { location.href = link.href; return; }
          // layoutFeed caches the items it has already placed, so a wholesale
          // replacement has to clear that cache or the new cards are never
          // tiled -- and the old ones would be remembered forever.
          here.__items = null; here.__built = false; here.__cols = 0;
          here.removeAttribute('style');
          here.innerHTML = next.innerHTML;
          var nl = doc.querySelector('.search-more[data-group="' + key + '"]');
          if (nl) { link.href = nl.getAttribute('href'); link.textContent = wasT; delete link.dataset.busy; }
          else link.parentNode.remove();
          history.replaceState(null, '', link.href);
          if (window.layoutFeed) try { window.layoutFeed(); } catch (err) {}
        })
        .catch(function () { location.href = link.href; });
      return;
    }
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
    var ec = e.target.closest && e.target.closest('[data-ens-cancel]');
    if (ec) { e.preventDefault(); var tg = document.querySelector('.itin-edit-toggle'); if (tg) tg.checked = false; return; }
    // the itinerary listing's create card sits outside the itinerary page's
    // own script, so its Cancel is handled here with the other delegated ones
    var ic = e.target.closest && e.target.closest('[data-itin-new-cancel]');
    if (ic) { e.preventDefault(); var dd = ic.closest('details'); if (dd) dd.open = false; return; }
    var cc = e.target.closest && e.target.closest('[data-cmt-cancel]');
    if (cc) { e.preventDefault(); var li = cc.closest('li'); var tg2 = li && li.querySelector('.cmt-toggle');
      if (tg2) tg2.checked = false; return; }
    var t = e.target.closest && e.target.closest('.nf-del');
    if (!t) return;
    window.askConfirm({ title: 'Delete ' + t.dataset.kind, cta: 'Delete ' + t.dataset.kind,
      action: t.dataset.del,
      copy: 'Delete <b>' + t.dataset.title + '</b>? This cannot be undone.' });
  });

  // ---- check-in dialog: single day by default, "+ Add end date" makes it a
  // continuous multi-day visit with optional day-level notes. Day rows are
  // derived from the range in the browser; only rows with text are posted.
  window.openCheckin = function (o) {
    var dlg = document.getElementById('checkin-dialog'); if (!dlg) return;
    var f = dlg.querySelector('.ck-form'), startEl = dlg.querySelector('#ck-start'), endEl = dlg.querySelector('#ck-end');
    var endLbl = dlg.querySelector('.ck-end-lbl'), rangeEl = dlg.querySelector('.nf-range'), daysWrap = dlg.querySelector('.ck-days-wrap');
    var daysEl = dlg.querySelector('.nf-days'), toggle = dlg.querySelector('.ck-toggle-end'), dates = dlg.querySelector('.nf-dates');
    var today = new Date().toISOString().slice(0, 10);
    var existingDays = {}; (o.days || []).forEach(function (d) { existingDays[d.date] = d.body; });
    var typed = {};                                   // text typed this session, keyed by date

    f.action = o.action || '';
    dlg.querySelector('.ck-place').textContent = o.place || '';
    dlg.querySelector('.dlg-title').textContent = o.editing ? 'Edit check-in' : 'Check in';
    dlg.querySelector('.ck-cta').textContent = o.editing ? 'Save' : 'Log this visit';
    f.querySelector('[name=drop_days]').value = '';
    startEl.value = o.start || today; startEl.max = today;
    endEl.max = today;
    dlg.querySelector('#ck-body').value = o.body || '';
    var hasEnd = !!o.end; endEl.value = o.end || '';

    var fmt = function (ymd) { var d = new Date(ymd + 'T00:00:00Z'); return d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
    var datesIn = function (a, b) { var out = [], d = new Date(a + 'T00:00:00Z'), z = new Date(b + 'T00:00:00Z'); for (; d <= z; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };

    var renderDays = function () {
      var a = startEl.value, b = endEl.value;
      if (!hasEnd || !a || !b || b < a) { daysWrap.hidden = true; daysEl.innerHTML = ''; return; }
      var list = datesIn(a, b), open = false;
      daysEl.innerHTML = list.map(function (day) {
        var body = (typed[day] !== undefined ? typed[day] : (existingDays[day] || ''));
        var has = !!body.trim();
        return '<details class="nf-day"' + (has && list.length <= 7 ? ' open' : '') + ' data-day="' + day + '">'
          + '<summary><span class="tl-date">' + fmt(day) + '</span>'
          + '<span class="nf-day-preview">' + (has ? body.replace(/</g, '&lt;') : '') + '</span>'
          + '<span class="nf-link-btn">' + (has ? 'Edit' : '+ Add a line') + '</span></summary>'
          + '<textarea class="nf-field" name="day_' + day + '" rows="2" maxlength="600" aria-label="Note for ' + fmt(day) + '">' + body.replace(/</g, '&lt;') + '</textarea></details>';
      }).join('');
      daysWrap.hidden = false;
    };
    var renderRange = function () {
      var a = startEl.value, b = endEl.value;
      endEl.min = a || '';
      if (hasEnd && b && b < a) { endEl.value = a; b = a; }
      dates.classList.toggle('has-end', hasEnd); endEl.hidden = !hasEnd; endLbl.hidden = !hasEnd;
      toggle.textContent = hasEnd ? 'Remove end date' : '+ Add end date';
      if (!hasEnd || !a) { rangeEl.hidden = true; renderDays(); return; }
      if (!b) { rangeEl.textContent = 'Choose an end date to add daily notes'; rangeEl.hidden = false; renderDays(); return; }
      var n = datesIn(a, b).length;
      var A = new Date(a + 'T00:00:00Z'), B = new Date(b + 'T00:00:00Z'), M = function (x) { return x.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }); };
      var txt = A.getUTCFullYear() !== B.getUTCFullYear() ? fmt(a) + ', ' + A.getUTCFullYear() + ' – ' + fmt(b) + ', ' + B.getUTCFullYear()
        : A.getUTCMonth() !== B.getUTCMonth() ? M(A) + ' ' + A.getUTCDate() + ' – ' + M(B) + ' ' + B.getUTCDate() + ', ' + B.getUTCFullYear()
        : M(A) + ' ' + A.getUTCDate() + ' – ' + B.getUTCDate() + ', ' + B.getUTCFullYear();
      rangeEl.textContent = txt + ' · ' + n + ' day' + (n === 1 ? '' : 's'); rangeEl.hidden = false;
      renderDays();
    };
    toggle.onclick = function () { hasEnd = !hasEnd; if (!hasEnd) endEl.value = ''; renderRange(); };
    // "Date unknown?" — the visit is recorded, the date is not. Everything
    // date-shaped goes with it: the inputs, the range, the day notes, and the
    // end-date affordance. The overall line stays.
    var undated = dlg.querySelector('#ck-undated'), datesBlock = dlg.querySelector('.ck-dates-block'), undatedNote = dlg.querySelector('.ck-undated-note');
    var applyUndated = function () {
      var on = undated.checked;
      datesBlock.hidden = on; toggle.hidden = on; undatedNote.hidden = !on;
      startEl.required = !on;
      if (on) { daysWrap.hidden = true; } else { renderRange(); }
    };
    undated.checked = !!o.undated; undated.onchange = applyUndated; applyUndated();
    startEl.onchange = renderRange; endEl.onchange = renderRange;
    daysEl.oninput = function (e) { var ta = e.target.closest('textarea'); if (ta) typed[ta.name.slice(4)] = ta.value; };
    // keep the empty-row affordance honest: hide it once the row is open
    daysEl.ontoggle = function (e) { var d = e.target; if (d.open) { var t = d.querySelector('textarea'); if (t && !t.value) setTimeout(function () { t.focus(); }, 0); } };
    renderRange();

    // The contraction guard, asked ONCE: the server answers 409 with the
    // dates whose notes would fall outside the new range, and we confirm
    // before resubmitting with explicit consent.
    f.onsubmit = function (e) {
      if (!o.editing) return;                                  // creation has nothing to lose
      e.preventDefault();
      var data = new URLSearchParams(new FormData(f)).toString();
      fetch(f.action, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-quiet': '1' }, body: data })
        .then(function (r) {
          if (r.status === 409) return r.json().then(function (g) {
            dlg.classList.remove('is-open');
            window.askConfirm({ title: 'Shorten this visit?', copy: g.message.replace(/</g, '&lt;'),
              cta: 'Keep the dates as they were', dismiss: 'Shorten and remove those notes', action: '',
              onConfirm: function () { dlg.classList.add('is-open'); },
              onDismiss: function () { f.querySelector('[name=drop_days]').value = '1'; f.onsubmit = null; f.submit(); } });
          });
          if (!r.ok) return r.text().then(function (t) { alert(t); });
          location.reload();
        });
    };
    dlg.classList.add('is-open');
    setTimeout(function () { (o.editing ? dlg.querySelector('#ck-body') : startEl).focus(); }, 60);
  };
  // Delegated: this script runs before the dialog markup exists further down
  // the document, so binding directly to the buttons matched nothing and
  // Cancel did nothing at all.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#checkin-dialog [data-dismiss]');
    if (!b) return;
    e.preventDefault();
    var d = document.getElementById('checkin-dialog');
    if (d) d.classList.remove('is-open');
  });

  document.addEventListener('DOMContentLoaded', function () {
  // ---- modern glass: motion. Stagger the sheets' arrival, let the smoke
  // layer answer scroll and pointer, and give each sheet a specular that
  // tracks the pointer. All of it is CSS-driven; this only sets numbers. ----
  (function () {
    var body = document.body; if (body.dataset.skin !== 'modern') return;
    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      var i = 0;
      document.querySelectorAll('.card, .prail, .wtable, .tile, .ens-tile, .post-box, .timeline li, .ens-parts, .empty').forEach(function (el) { el.style.setProperty('--m-i', String(Math.min(i++, 14))); });
      body.classList.add('m-arrive');
      setTimeout(function () { body.classList.remove('m-arrive'); }, 1600);
      // parallax: the smoke drifts a little against the scroll, and leans toward the pointer
      var px = 0, py = 0, sy = 0, raf = null;
      var root = document.documentElement;
      var apply = function () { raf = null; root.style.setProperty('--m-px', (px * 10).toFixed(1) + 'px'); root.style.setProperty('--m-py', (py * 8 - sy * 0.06).toFixed(1) + 'px'); };
      var queue = function () { if (!raf) raf = requestAnimationFrame(apply); };
      addEventListener('scroll', function () { sy = scrollY; queue(); }, { passive: true });
      if (matchMedia('(hover: hover)').matches) addEventListener('pointermove', function (e) { px = e.clientX / innerWidth - .5; py = e.clientY / innerHeight - .5; queue(); }, { passive: true });
    }
    if (matchMedia('(hover: hover)').matches) {
      // the lift, plus a picture parallax inside the card — no rotation, and
      // no pointer-following highlight; both were tried in earlier passes
      // and read as more distracting than the depth cue was worth
      var tilted = null;
      document.addEventListener('pointermove', function (e) {
        var el = e.target.closest && e.target.closest('.card, .ens-tile, .post-box'); if (!el) { if (tilted) { tilted.classList.remove('m-tilt'); tilted.style.removeProperty('--m-rx'); tilted.style.removeProperty('--m-ry'); tilted = null; } return; }
        var r = el.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
        if (reduce) return;
        // the lift, plus a picture parallax inside the card — no rotation
        if (tilted && tilted !== el) tilted.classList.remove('m-tilt');
        tilted = el; el.classList.add('m-tilt');
        el.style.setProperty('--m-tx', ((nx - .5) * -8).toFixed(1) + 'px');
        el.style.setProperty('--m-ty', ((ny - .5) * -6).toFixed(1) + 'px');
      }, { passive: true });
      document.addEventListener('pointerleave', function () { if (tilted) { tilted.classList.remove('m-tilt'); tilted = null; } }, true);
    }
  })();

  // ---- travel-mark cards fold in feeds. Tap the card body to open; links
  // and buttons inside keep working as themselves. ----
  document.querySelectorAll('.mark-collapsible').forEach(function (card) {
    var more = card.querySelector('.mark-more'); var text = card.querySelector('.text'); if (!more || !text) return;
    var toggle = function (open) {
      card.classList.toggle('is-open', open); more.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) { var m = card.querySelector('.mark-map[data-map-src]'); if (m && !m.querySelector('iframe')) {
        var f = document.createElement('iframe'); f.src = m.dataset.mapSrc; f.loading = 'lazy'; f.title = m.dataset.mapTitle || 'Map'; m.innerHTML = ''; m.appendChild(f); } }
    };
    // On touch, a scroll that starts on the card body still fires a click
    // when the finger lifts — so dragging past a card was opening it, and an
    // opened card looks exactly like the old always-expanded one. Only treat
    // it as a tap if the pointer barely moved and the press was brief.
    var sx = 0, sy = 0, st = 0, moved = false;
    text.addEventListener('pointerdown', function (e) {
      sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false;
    }, { passive: true });
    text.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) moved = true;
    }, { passive: true });
    text.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, label, form, .switch')) return;
      if (moved || Date.now() - st > 700) return;          // a drag or a long press, not a tap
      toggle(!card.classList.contains('is-open'));
    });
  });
  // ---- profile tabs (All / Public / Private) filter the cards already on the
  // page instead of reloading it, so the scroll position survives ----
  document.querySelectorAll('.vis-tabs').forEach(function (tabs) {
    if (tabs.classList.contains('look-modes')) return;
    var links = tabs.querySelectorAll('a[href*="v="]'); if (!links.length) return;
    links.forEach(function (a) { a.addEventListener('click', function (e) {
      var v = new URL(a.href, location.href).searchParams.get('v'); if (!v) return;
      var notes = [].slice.call(document.querySelectorAll('.grid .note[data-private]'));
      // Filtering in place is only honest when the whole list is in the DOM.
      // These tabs sit above a paginated feed: with 25 of 60 notes loaded, a
      // client-side pass can only hide what it can see, so a member whose
      // recent notes are all private saw an empty Public tab — and then a
      // mixed one, because the Show more link still carried the old view.
      // When there are more pages, let the link navigate and let the server
      // filter the full set.
      if (document.querySelector('.more-link')) return;
      var expected = notes.filter(function (n) {
        var priv = n.dataset.private === '1';
        return v === 'public' ? !priv : v === 'private' ? priv : true;
      }).length;
      if (!notes.length) return;                        // nothing to filter: navigate
      e.preventDefault();
      links.forEach(function (x) { x.classList.toggle('on', x === a); });
      notes.forEach(function (n) {
        var priv = n.dataset.private === '1';
        n.hidden = v === 'public' ? priv : v === 'private' ? !priv : false;
      });
      if (window.layoutFeed) try { window.layoutFeed(); } catch (err) {}
      var shown = notes.filter(function (n) {
        return n.isConnected && getComputedStyle(n).display !== 'none';
      }).length;
      if (shown !== expected) { location.href = a.href; return; }
      var u = new URL(location.href); u.searchParams.set('v', v); history.replaceState(null, '', u);
    }); });
  });

  });

  // Check in asks first, and takes an optional line about the visit
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-checkin]');
    if (!t) return;
    window.openCheckin({ action: t.dataset.checkin, place: t.dataset.place, editing: false });
  });

  // Owned. ON is an unambiguous assertion — one tap, no confirmation.
  // OFF is genuinely ambiguous, so it asks the one question that resolves it:
  // a lifecycle release ("sold it") and a correction ("wrong button") mean
  // different things and must not both be recorded as a release.
  document.addEventListener('change', function (e) {
    var box = e.target;
    var t = box.closest && box.closest('[data-owned]');
    if (!t || box.type !== 'checkbox') return;
    // Posts in the background so the feed never reloads and the reader keeps
    // their scroll position. The switch moves immediately; if the request
    // fails it snaps back rather than showing a state that was never saved.
    var send = function (intent, shouldEnd) {
      t.classList.add('is-saving');
      fetch(t.dataset.owned, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-quiet': '1' },
        body: 'intent=' + intent, credentials: 'same-origin',
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        box.checked = shouldEnd; t.dataset.on = shouldEnd ? '1' : '0';
      }).catch(function () {
        box.checked = !shouldEnd;                   // put it back, nothing was saved
        t.classList.add('is-failed');
        setTimeout(function () { t.classList.remove('is-failed'); }, 1200);
      }).then(function () { t.classList.remove('is-saving'); });
    };
    if (box.checked) return send('own', true);
    box.checked = true;                             // hold until the meaning is resolved
    window.askConfirm({
      title: 'Owned', cta: 'I no longer own it', dismiss: 'It was marked by mistake',
      copy: 'Are you saying you no longer own <b>' + t.dataset.title + '</b>, or that the ownership mark was a mistake?',
      onConfirm: function () { send('release', false); },
      onDismiss: function () { send('correct', false); },
    });
  });

  // Auto-save the ensemble's title, description and privacy. Delegated on
  // document rather than resolved at parse time: this script block runs in the
  // masthead, before the form exists in the DOM, so querying for the form here
  // would find nothing and silently do nothing.
  (function () {
    var timer, inflight = false;
    var flash = function (f, msg, bad) {
      var note = f.querySelector('[data-saved]');
      if (!note) return;
      note.textContent = msg; note.hidden = false;
      note.classList.toggle('is-bad', !!bad);
      clearTimeout(note.__t);
      note.__t = setTimeout(function () { note.hidden = true; }, 2200);
    };
    var save = function (f) {
      if (inflight) return;
      inflight = true;
      var d = new URLSearchParams();
      f.querySelectorAll('input[name], textarea[name]').forEach(function (el) {
        if (el.type === 'checkbox') { if (el.checked) d.set(el.name, el.value || '1'); }
        else d.set(el.name, el.value);
      });
      fetch(f.getAttribute('action'), { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-quiet': '1' }, body: d.toString() })
        .then(function (r) { if (!r.ok) throw new Error(r.status); flash(f, 'Saved'); })
        .catch(function () { flash(f, 'Not saved — press Save', true); })
        .then(function () { inflight = false; });
    };
    document.addEventListener('input', function (e) {
      var f = e.target.closest && e.target.closest('form[data-autosave]');
      if (!f || e.target.type === 'checkbox') return;
      clearTimeout(timer); timer = setTimeout(function () { save(f); }, 900);
    });
    // a privacy change is a decision, not a draft — save it at once
    document.addEventListener('change', function (e) {
      var f = e.target.closest && e.target.closest('form[data-autosave]');
      if (!f || e.target.type !== 'checkbox') return;
      clearTimeout(timer); save(f);
    });
    // never lose an edit that was mid-debounce when the page closes
    window.addEventListener('beforeunload', function () {
      var f = document.querySelector('form[data-autosave]');
      if (f && timer) { clearTimeout(timer); save(f); }
    });
  })();

  // Post-form Warrant control. Clicking the CTA slides the seal down in its
  // place and records the intent; clicking the seal asks before withdrawing.
  // Nothing is written until the form is saved.
  document.addEventListener('click', function (e) {
    var cta = e.target.closest && e.target.closest('.nf-warrant-cta');
    var seal = e.target.closest && e.target.closest('.nf-warrant.is-warranted .warrant-seal-form');
    var wrap = (cta || seal) && (cta || seal).closest('.nf-warrant');
    if (!wrap) return;
    var intent = wrap.querySelector('input[name="warrant_intent"]');
    if (cta) {
      // announce by default on a public subject — the Private toggle on the
      // same form decides; the server refuses to publish a private one anyway
      var priv = wrap.closest('form').querySelector('input[name="private"]');
      intent.value = priv && priv.checked ? 'warrant_quiet' : 'warrant';
      wrap.classList.add('is-warranted');
      return;
    }
    e.preventDefault();
    window.askConfirm({ title: 'Warrant', cta: 'Remove my Warrant', dismiss: 'Keep it',
      copy: 'Remove your Warrant from <b>' + wrap.dataset.title + '</b>? Your private history will still show you warranted it.',
      onConfirm: function () { intent.value = 'revoke'; wrap.classList.remove('is-warranted'); },
      onDismiss: function () {} });
  });
  // Post-form Owned toggle. ON is one action. OFF asks release-vs-correction
  // and stores the resolved intent — the server never sees the ambiguity.
  document.addEventListener('change', function (e) {
    var box = e.target, wrap = box.closest && box.closest('[data-owned-ctl]');
    if (!wrap || box.name !== 'owned_now') return;
    var intent = wrap.querySelector('input[name="owned_intent"]');
    var was = box.dataset.was === '1';
    if (box.checked) { intent.value = was ? '' : 'own'; return; }
    if (!was) { intent.value = ''; return; }          // never asserted, nothing to resolve
    box.checked = true;
    window.askConfirm({ title: 'Owned', cta: 'I no longer own it', dismiss: 'It was marked by mistake',
      copy: 'Are you saying you no longer own <b>' + wrap.dataset.title + '</b>, or that the ownership mark was a mistake?',
      onConfirm: function () { intent.value = 'release'; box.checked = false; },
      onDismiss: function () { intent.value = 'correct'; box.checked = false; } });
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
</script>

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
<div class="curtain dialog" id="checkin-dialog">
  <div class="curtain-frame"><div class="curtain-body">
    <form method="post" action="" class="ck-form">
      <div class="nf-box">
        <p class="dlg-title">Check in</p>
        <p class="dlg-copy">A visit to <b class="ck-place"></b>.</p>
        <input type="hidden" name="drop_days" value="">
        <div class="nf-top"><span class="nf-lbl">Date unknown?</span><label class="switch"><input type="checkbox" name="date_unknown" value="1" id="ck-undated"><span></span></label></div>
        <p class="nf-range ck-undated-note" hidden>Recorded as a visit with no date.</p>
        <div class="nf-stack ck-dates-block">
          <label class="nf-lbl" for="ck-start">Date<span class="ck-end-lbl" hidden> · End date</span></label>
          <div class="nf-dates">
            <input class="nf-field" type="date" id="ck-start" name="visited_on" required>
            <input class="nf-field" type="date" id="ck-end" name="ended_on" aria-label="End date" hidden>
          </div>
          <p class="nf-range" aria-live="polite" hidden></p>
        </div>
        <div class="nf-stack">
          <label class="nf-lbl" for="ck-body">About this visit</label>
          <textarea class="nf-field" id="ck-body" name="body" rows="2" maxlength="600" placeholder="A LINE ABOUT THIS VISIT (OPTIONAL)"></textarea>
        </div>
        <div class="ck-days-wrap" hidden>
          <span class="nf-lbl">Daily notes</span>
          <div class="nf-days"></div>
        </div>
        <button type="button" class="nf-link-btn ck-toggle-end">+ Add end date</button>
        <button class="nf-post ck-cta">Log this visit</button>
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
        // an avatar is displayed small, so it stays a thumbnail — but at 2x for
        // retina, with high-quality resampling
        var S = 640, cv = document.createElement('canvas'); cv.width = cv.height = S;
        var n = Math.min(img.width, img.height);
        var acx = cv.getContext('2d');
        acx.imageSmoothingEnabled = true; acx.imageSmoothingQuality = 'high';
        acx.drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, S, S);
        data = cv.toDataURL('image/jpeg', 0.92);
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
    <div class="nf-top">${formWarrantControl('object', o, me)}<span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${o.private ? 'checked' : ''}><span></span></label></div>
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
    <div class="nf-foot ${editing ? 'nf-foot-3' : ''}">
      ${editing
        ? `<button type="button" class="nf-link-btn nf-del" data-del="/o/${o.id}/delete" data-kind="note" data-title="${esc(o.name)}">Delete</button>${formOwnedControl(o, me)}`
        : `<span class="nf-foot-left">${formOwnedControl(o, me)}</span>`}
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
    marks: own ? ['You have not marked any places yet'] : [`${who} has not marked any places yet`],
    ensembles: own ? ['No ensembles yet', 'Ask your AI to compose one']
                   : [`${who} has not saved any ensembles yet`],
    warrants: own ? ['Nothing warranted yet'] : [`${who} has not warranted anything yet`],
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
// Undated visits have no position in time, so they follow every dated one.
const markVisits = (id) => q('SELECT v.*, u.handle FROM visits v JOIN users u ON u.id=v.user_id WHERE v.mark_id=? ORDER BY v.date_known DESC, v.visited_on DESC, v.id DESC').all(id);
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
// Web uploads are downscaled in the browser before they ever arrive, so these
// ceilings really govern what an AI may send over MCP. A genuine phone photo
// of a thing is routinely 10-20 MB, and rejecting it is a real failure to the
// member, so source images get room; generated compositions get more again.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATED_BYTES = 24 * 1024 * 1024;   // AI-generated compositions run large
// Chunk size for the chunked upload path. Chosen for RELIABILITY, not throughput:
// a 135 KB single argument has been truncated in practice, so this sits far
// below that. 32 KB of raw bytes is ~43,700 base64 characters — a small JSON
// string by any measure — and a 1 MB image is still only 32 calls.
const UPLOAD_CHUNK_BYTES = 32 * 1024;
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

// Is the file STRUCTURALLY COMPLETE, not merely correctly headed? A payload cut
// short in transit — a runtime truncating a large inline argument, a dropped
// connection — keeps its header intact and passes every magic-byte check, so
// header validation alone will happily store half an image that renders as a
// grey band. Each format ends with a known terminator, so completeness is
// checkable without decoding. A truncated image is refused outright: salvaging
// partial pixel data would mean storing something the member never sent.
function imageBytesComplete(b, mime) {
  if (!b || !b.length) return false;
  if (mime === 'image/jpeg') {
    // EOI (FFD9); some encoders append a little padding, so scan back a bit
    for (let i = b.length - 2; i >= Math.max(0, b.length - 64); i--) {
      if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
    }
    return false;
  }
  if (mime === 'image/png') return b.length >= 12 && b.toString('ascii', b.length - 8, b.length - 4) === 'IEND';
  if (mime === 'image/gif') return b[b.length - 1] === 0x3b;
  if (mime === 'image/webp') { const declared = b.readUInt32LE(4); return b.length >= declared + 8; }
  return true;
}
// Pull pixel dimensions straight out of the file header. No image library is
// needed for this — each format puts the size in a fixed, well-known place —
// and knowing it lets every <img> carry width/height so the browser reserves
// the right space before the bytes arrive.
function imageDimensions(b, mime) {
  try {
    if (mime === 'image/png' && b.length >= 24) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (mime === 'image/gif' && b.length >= 10) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (mime === 'image/webp' && b.length >= 30) {
      const fmt = b.toString('ascii', 12, 16);
      if (fmt === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
      if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') {
        const n = b.readUInt32LE(21);
        return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === 'image/jpeg') {
      // walk the segment markers to the frame header that carries the size
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* a malformed header just means no dimensions */ }
  return { w: null, h: null };
}

// Every image gets exactly one 'created' provenance row, regardless of which
// of the five call sites reached it — actorCtx defaults to a web session, so
// the four existing web-form callers get provenance with no change on their
// part; the MCP upload tool passes mcpActor(user) explicitly.
function storeImage(userId, value, actorCtx, source) {
  const v = (value || '').trim();
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(v);
  if (!m) return v;                                  // not a data: URL — an external link passes through unchanged
  const mime = m[1].toLowerCase();
  if (!IMAGE_MIME_ALLOW.has(mime)) return '';
  const bytes = Buffer.from(m[2], 'base64');
  // A generated composition is the artifact the member came to create, and
  // models emit large PNGs; uploads stay at the tighter limit.
  const cap = source === 'generated' ? MAX_GENERATED_BYTES : MAX_IMAGE_BYTES;
  if (!bytes.length || bytes.length > cap) return '';
  if (!imageBytesMatchMime(bytes, mime)) return '';   // declared type does not match the actual bytes
  if (!imageBytesComplete(bytes, mime)) return '';    // arrived truncated — never store a partial image
  // Content dedupe is DELIBERATELY NOT DONE here. Reusing one row for identical
  // bytes would merge records across a privacy boundary: the same photo in a
  // public note and a private one becomes a single row, and imageIsPublic()
  // then answers "public" for both — silently defeating the private note's
  // image privacy. The sha256 is still recorded so a future, privacy-aware
  // dedupe (or an offline report of wasted space) is possible without a
  // backfill. See the implementation notes.
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const dim = imageDimensions(bytes, mime);
  const r = q('INSERT INTO images(user_id,mime,bytes,sha256,width,height) VALUES(?,?,?,?,?,?)')
    .run(userId, mime, bytes, sha, dim.w, dim.h);
  const uid = uidOf('images', r.lastInsertRowid);
  if (source) q('UPDATE images SET source=? WHERE rowid=?').run(source, r.lastInsertRowid);
  recordProvenance('image', uid, 'created', actorCtx || webActor({ id: userId }), { source_kind: 'manual' });
  // Reference by uid, never by the sequential integer: the integer is
  // guessable and is meaningless outside this database.
  return `/i/${uid}`;
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
  // `url` already carries v= when the server rendered a filtered view, so the
  // next page stays in the same view. (The client tab handler no longer
  // rewrites the URL behind this link's back.)
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
  //
  // Ranking matters more than collecting: shops put a header logo, payment
  // badges and "you may also like" thumbnails in the same document as the one
  // product shot you actually want. So each candidate carries a score, and the
  // list is sorted by it — structured product data first, then the social
  // share image, then body pictures weighted by how product-like they look.
  const scored = new Map();
  const JUNK = /(logo|icon|sprite|badge|avatar|placeholder|spinner|loading|pixel|1x1|blank|payment|visa|mastercard|paypal|amex|klarna|trustpilot|flag[-_/]|social|facebook|twitter|instagram|pinterest|youtube|newsletter|banner|swatch)/i;
  const push = (v, score = 0) => {
    if (!v) return;
    let abs; try { abs = new URL(v, base).href; } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    if (/\.svg($|\?)/i.test(abs)) return;             // logos and sprites, rarely the subject
    if (/\.(gif)($|\?)/i.test(abs)) return;           // spacers and spinners
    if (JUNK.test(abs)) score -= 60;
    // data URIs and tracking pixels are never the product
    if (/^data:/i.test(abs)) return;
    const prev = scored.get(abs);
    if (prev === undefined || score > prev) scored.set(abs, score);
  };
  // Structured data first: a Product node's image array is usually the real
  // gallery, so it goes ahead of the single social-share image below.
  const ldNodes = collectJsonLd(html);
  const ldProduct = ldNodes.find((n) => ldTypeIs(n, 'product'));
  const ldItem = ldProduct || ldNodes.find((n) =>
    ['article', 'newsarticle', 'blogposting', 'recipe', 'event'].some((t) => ldTypeIs(n, t)));
  // A Product's own gallery is the most trustworthy signal on the page.
  if (ldItem && ldItem.image) ldImages(ldItem.image).forEach((u, i) => push(u, (ldProduct ? 1000 : 700) - i));

  for (const tag of metaTags) {
    const key = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/.test(key)) push(attr(tag, 'content'), 600);
  }
  const linkImg = head.match(/<link[^>]+rel\s*=\s*["']image_src["'][^>]*>/i);
  if (linkImg) push((linkImg[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1], 550);

  // Then the body's own pictures. Prefer the main/product region, prefer large
  // declared dimensions, and read the lazy-loading attributes shops actually
  // use — a plain src= scan misses most modern product galleries entirely.
  const main = (html.match(/<(?:main|article)\b[\s\S]*?<\/(?:main|article)>/i) || [])[0] || '';
  const gallery = (html.match(/<[^>]+(?:class|id)\s*=\s*["'][^"']*(?:product|gallery|pdp|hero|main-image|photo)[^"']*["'][\s\S]{0,20000}/i) || [])[0] || '';
  const scanImgs = (source, bonus) => {
    if (!source) return;
    for (const m2 of source.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
      const tag = m2[0];
      if (/class\s*=\s*["'][^"']*(logo|icon|avatar|sprite|badge)/i.test(tag)) continue;
      // biggest srcset entry wins — that is the full-resolution product shot
      const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
      let best = '', bestW = 0;
      if (srcset) for (const part of srcset.split(',')) {
        const [u, w] = part.trim().split(/\s+/);
        const n = w && w.endsWith('w') ? parseInt(w) : 0;
        if (u && n >= bestW) { best = u; bestW = n; }
      }
      const w = parseInt(attr(tag, 'width')) || 0, h = parseInt(attr(tag, 'height')) || 0;
      if ((w && w < 80) || (h && h < 80)) continue;          // thumbnails and chrome
      let size = 0;
      if (bestW >= 1200) size = 90; else if (bestW >= 600) size = 60; else if (bestW) size = 30;
      if (!size && w >= 800) size = 80; else if (!size && w >= 400) size = 50;
      const src = best || attr(tag, 'data-zoom-image') || attr(tag, 'data-large_image')
        || attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'src');
      push(src, bonus + size);
    }
  };
  scanImgs(gallery, 400);      // an explicit product/gallery container
  scanImgs(main, 300);         // the page's main content
  scanImgs(html, 100);         // anything else, last resort
  const candidates = [...scored.entries()]
    .filter(([, s]) => s > -40)                 // drop the clearly-junk matches
    .sort((a, b) => b[1] - a[1]).map(([u]) => u);
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
  // Wear is private evidence, shown only to the member whose mark it is.
  const markTier = (me && m.user_id === me.id) ? markPatinaTier(m.id) : 0;
  return `<article class="note travelmark ${full ? 'note-full' : 'mark-collapsible'}" data-private="${m.private ? 1 : 0}"${markTier ? ` data-patina="${markTier}"` + patinaOffset('mark', m.id) : ''}>
  <div class="byline"><span class="byline-who"><a href="/u/${esc(m.handle)}">${avatar({ handle: m.handle, avatar: m.avatar })}</a>${stackDate(m.created_at)}</span>${me && me.id === m.user_id ? `<a class="card-edit" href="/m/${m.id}/edit">Edit</a>` : ''}</div>
  <div class="card">
    ${warrantSeal(m, 'mark', me)}
    <div class="text">
      ${m.image ? `<a class="mark-photo" href="/m/${m.id}"><img src="${esc(m.image)}" alt="${esc(m.name)}"></a>` : ''}
      <p class="who"><a href="/u/${esc(m.handle)}">${esc(m.handle)}</a> ${m.private ? '<span class="who-private">privately marked</span>' : 'marked'}</p>
      ${cs.length ? `<p class="colls">${cs.map((c) => `<a href="/u/${esc(m.handle)}?tab=marks&c=${c.id}">${esc(c.name)}</a>`).join(' · ')}</p>` : ''}
      <h2 class="mark-title"><a href="/m/${m.id}">${arcTitle(m.name, m.id)}</a></h2>
      ${placeLine(m) ? `<p class="mark-where">${esc(placeLine(m))}</p>` : ''}
      ${m.address ? `<p class="mark-address">${esc(m.address)}</p>` : ''}
      ${full ? '' : '<div class="mark-more" aria-hidden="true"><div class="mark-more-inner">'}
      ${m.why ? `<p class="body">${esc(m.why)}</p>` : ''}
      ${tags.length ? `<p class="tags">${tags.map((t) => `<a href="/?t=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(', ')}</p>` : ''}
      ${m.url ? `<p class="link"><span class="lbl">Link:</span> <a href="${esc(m.url)}" rel="noopener">${esc(m.url.length > 34 ? m.url.slice(0, 34) + '…' : m.url)}</a></p>` : ''}
      ${embed ? `${full
        ? `<div class="mark-map"><iframe src="${embed}" loading="lazy" title="Map of ${esc(m.name)}"></iframe></div>`
        : `<div class="mark-map" data-map-src="${esc(embed)}" data-map-title="Map of ${esc(m.name)}"><div class="mark-map-placeholder">Show map</div></div>`}
      <p class="map-credit">© OpenStreetMap contributors</p>` : ''}
      ${full ? '' : '</div></div><span class="mark-hint">Tap for more</span>'}
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
    <div class="nf-top">${formWarrantControl('mark', m, me)}<span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${m.private ? 'checked' : ''}><span></span></label></div>
    ${seg ? segControl('mark') : ''}
    <details class="nf-drop" id="drop-${idp}">
      <summary><span class="nf-drop-label">${sel.size ? esc([...sel].join(', ')) : 'Select a collection'}</span></summary>
      <div class="nf-drop-menu">
        ${mine.map((c) => `<label class="nf-opt"><input type="checkbox" name="coll" value="${esc(c.name)}" ${sel.has(c.name) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        <label class="nf-opt nf-opt-new"><span>+ New collection</span><input class="nf-field" name="newcoll" placeholder="Name it" value=""></label>
      </div>
    </details>
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
      <input class="nf-field" name="url" type="url" placeholder="LINK" value="${esc(m.url || '')}">
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
  const ensCount = q('SELECT COUNT(*) c FROM ensembles WHERE user_id=?' + (me && me.id === u.id ? '' : ' AND private=0')).get(u.id).c;
  const itinCount = q('SELECT COUNT(*) c FROM itineraries WHERE user_id=?' + (me && me.id === u.id ? '' : ' AND private=0')).get(u.id).c;
  // A visitor's warrant count only ever reflects PUBLIC subjects: a warrant on
  // a private note or mark is not something anyone but the owner should see
  // exists, since that would leak the existence of the private record itself.
  const warrantCount = (() => {
    const objUids = warrantedSubjectUids(u.id, 'object'), markUids = warrantedSubjectUids(u.id, 'mark');
    const ownerView = me && me.id === u.id;
    const objN = ownerView ? objUids.size
      : [...objUids].filter((uid) => { const o = q('SELECT private FROM objects WHERE uid=?').get(uid); return o && !o.private; }).length;
    const markN = ownerView ? markUids.size
      : [...markUids].filter((uid) => { const m = q('SELECT private FROM marks WHERE uid=?').get(uid); return m && !m.private; }).length;
    return objN + markN;
  })();
  const following = me && me.id !== u.id && isFollowing(me.id, u.id);
  const link = (t) => `/u/${esc(u.handle)}?tab=${t}`;
  return `<aside class="rail profile-rail">
    <a href="/u/${esc(u.handle)}">${avatar(u, 'avatar big')}</a><p class="prail-handle">${esc(u.handle)}</p>
    ${u.bio ? `<p class="prail-bio">${esc(u.bio)}</p>` : ''}${u.site ? `<p class="prail-site"><a href="${esc(u.site)}" rel="noopener">${esc(u.site.replace(/^https?:\/\//, ''))}</a></p>` : ''}
    ${me && me.id !== u.id ? `<form method="post" action="/u/${esc(u.handle)}/${following ? 'unfollow' : 'follow'}" class="prail-follow"><button class="btn3d block ${following ? 'is-following' : ''}">${following ? 'Following' : 'Follow'}</button></form>` : ''}
    <ul class="prail-nav">
      <li><a class="${tab === 'activity' ? 'on' : ''}" data-short="All&#10;Activity" data-short-modern="All" href="${link('activity')}">All Activity <span>›</span></a></li>
      <li><a class="${tab === 'notes' ? 'on' : ''}" data-short="Notes" data-count="${visible.length}" href="${link('notes')}">Notes: ${visible.length} <span>›</span></a></li>
      <li><a class="${tab === 'marks' ? 'on' : ''}" data-short="Marks" data-count="${markCount}" href="${link('marks')}">Travel Marks: ${markCount} <span>›</span></a></li>
      <li><a class="${tab === 'itineraries' ? 'on' : ''}" data-short="Itineraries" data-count="${itinCount}" href="${'/t' + (me && me.id === u.id ? '' : '?u=' + encodeURIComponent(u.handle))}">Itineraries: ${itinCount} <span>›</span></a></li>
      <li><a class="${tab === 'ensembles' ? 'on' : ''}" data-short="Ensembles" data-count="${ensCount}" href="${link('ensembles')}">Ensembles: ${ensCount} <span>›</span></a></li>
      <li><a class="${tab === 'warrants' ? 'on' : ''}" data-short="Warrants" data-count="${warrantCount}" href="${link('warrants')}">Warrants: ${warrantCount} <span>›</span></a></li>
      <li><a class="${tab === 'followers' ? 'on' : ''}" data-short="Followers" data-count="${fc.followers}" href="${link('followers')}">Followers: ${fc.followers} ${fc.followers === 1 ? 'person' : 'people'} <span>›</span></a></li>
      <li><a class="${tab === 'following' ? 'on' : ''}" data-short="Following" data-count="${fc.following}" href="${link('following')}">Following: ${fc.following} ${fc.following === 1 ? 'person' : 'people'} <span>›</span></a></li>
    </ul>

  </aside>`;
}

// The Warrant control on a post form: a CTA that, once clicked, slides the
// seal down in its place. Both the CTA and the seal are always in the markup;
// `is-warranted` on the wrapper decides which shows. The member's choice is
// carried as a hidden `warrant_intent` and applied by the server after save —
// on a NEW note there is no id to assert against until then, and on an edit
// this keeps the two controls consistent with each other.
function formWarrantControl(subjectType, row, me) {
  const active = row.uid ? warrantState(me.id, subjectType, row.uid).state === 'active' : false;
  return `<div class="nf-warrant ${active ? 'is-warranted' : ''}" data-warrant-ctl data-title="${esc(row.name || '')}">
    <input type="hidden" name="warrant_intent" value="">
    <button type="button" class="nf-link-btn nf-warrant-cta">Warrant</button>
    <span class="warrant-seal warrant-seal-form" aria-label="Warranted" title="Warranted">${warrantSealSvg()}</span>
  </div>`;
}
function formOwnedControl(row, me) {
  const on = row.id ? ownedState(me.id, row.id).state === 'owned' : false;
  return `<div class="nf-owned" data-owned-ctl data-title="${esc(row.name || '')}">
    <input type="hidden" name="owned_intent" value="">
    <span class="nf-lbl">Owned</span>
    <label class="switch"><input type="checkbox" name="owned_now" value="1" ${on ? 'checked' : ''} data-was="${on ? '1' : '0'}" aria-label="Owned"><span></span></label>
  </div>`;
}
// Applies the post form's pending Owned/Warrant intents once the row exists.
// The form has already resolved any ambiguity client-side (release vs
// correction; announce vs quiet), so every intent arriving here is
// unambiguous. Empty intent = leave alone. Never called from the re-note or
// re-mark paths: those must not inherit either primitive.
function applyFormIntents(b, subjectType, row, me) {
  const ctx = webActor(me);
  if (subjectType === 'object') {
    const oi = b.owned_intent || '';
    if (oi === 'own' && ownedState(me.id, row.id).state !== 'owned') assertOwned(me.id, row.id, ctx);
    else if (oi === 'release' && ownedState(me.id, row.id).state === 'owned') releaseOwned(me.id, row.id, ctx);
    else if (oi === 'correct') correctOwned(me.id, row.id, ctx);
  }
  const wi = b.warrant_intent || '';
  const cur = warrantState(me.id, subjectType, row.uid).state;
  if ((wi === 'warrant' || wi === 'warrant_quiet') && cur !== 'active') {
    // a private subject can never publish — the flag is simply never set
    assertWarrant(me.id, subjectType, row.uid, !row.private && wi === 'warrant', ctx);
  } else if (wi === 'revoke' && cur === 'active') {
    revokeWarrant(me.id, subjectType, row.uid, ctx);
  }
}
// Adoption. Copies the source's current user-facing representation, mints a
// new uid, and records lineage — the same shape re-mark has always used. The
// adopter's own judgment starts empty: tags are authored, and privacy,
// collections, Owned and Warrant are theirs to set, never inherited.
// Canonical duplicate awareness. Two kinds of evidence only, both canonical,
// both scoped to the asking member:
//   already_adopted  — I hold Note(s) whose lineage points at this one
//   equivalent_notes — an explicit/external same_thing_as relation I recorded
// derived_relations is NEVER consulted here: inferred similarity is not
// canonical identity and must not be presented as "you've noted this before".
// These are informational. Nothing in the write path reads them.
function alreadyAdopted(userId, sourceUid) {
  const rows = q('SELECT uid FROM objects WHERE user_id=? AND renoted_from_uid=? ORDER BY id').all(userId, sourceUid);
  return { count: rows.length, note_uids: rows.map((r) => r.uid) };
}
// basis is preserved rather than flattened: an explicit user assertion and an
// externally supported identity are both canonical but are not the same claim.
function equivalentNotes(userId, noteUid) {
  return q(`SELECT uid AS relation_uid, basis,
      CASE WHEN subject_note_uid=? THEN object_note_uid ELSE subject_note_uid END AS note_uid
    FROM note_relations
    WHERE user_id=? AND state='active' AND predicate='same_thing_as'
      AND (subject_note_uid=? OR object_note_uid=?)`).all(noteUid, userId, noteUid, noteUid)
    .map((r) => ({ note_uid: r.note_uid, basis: r.basis, relation_uid: r.relation_uid }));
}
function renoteFrom(src, me, ctx) {
  const r = q(`INSERT INTO objects(user_id,name,why,tags,url,image,private,renoted_from_uid)
    VALUES(?,?,?,?,'',?,0,?)`).run(me.id, src.name, src.why, src.url || '', src.image || '', src.uid);
  const note = q('SELECT * FROM objects WHERE id=?').get(r.lastInsertRowid);
  recordProvenance('object', note.uid, 'renoted', ctx, { source_kind: 'renote', source_ref: src.uid });
  return note;
}
// ---------- Ensemble (v1.18) ----------
// A durable AI-composited arrangement of things. The AI composes and renders;
// Discriminantly is the system of record for what was composed.

// Emit an <img> carrying the stored pixel dimensions and lazy loading. The
// dimensions stop the page reflowing as each image lands, and lazy loading
// keeps a long ensemble list from fetching every composite up front.
// Load stored bytes as an MCP image block. Guarded by size: a 20 MB composite
// base64-encoded would swamp the model's context and help nobody, so oversized
// originals are described rather than inlined and the member can open them on
// the worksurface.
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
function imageBlock(ref) {
  const uid = (ref || '').startsWith('/i/') ? ref.slice(3) : '';
  if (!uid) return null;
  const im = q('SELECT mime, bytes FROM images WHERE uid=?').get(uid);
  if (!im || !im.bytes || im.bytes.length > MAX_INLINE_IMAGE_BYTES) return null;
  return { data: Buffer.from(im.bytes).toString('base64'), mimeType: im.mime };
}

function imgTag(ref, alt, cls, eager) {
  const uid = (ref || '').startsWith('/i/') ? ref.slice(3) : '';
  const d = uid ? q('SELECT width, height FROM images WHERE uid=?').get(uid) : null;
  const dim = d && d.width && d.height ? ` width="${d.width}" height="${d.height}"` : '';
  return `<img src="${esc(ref)}" alt="${esc(alt || '')}"${cls ? ` class="${cls}"` : ''}${dim}`
    + `${eager ? '' : ' loading="lazy" decoding="async"'}>`;
}

// Currently-active warrants for one user, batched rather than one query per
// row. Correction (supersedes) is not used by warrant writes today — only
// active/revoked — so "latest row per subject" is exactly current state.
function warrantedSubjectUids(userId, subjectType) {
  return new Set(q(`SELECT subject_uid FROM warrants w1 WHERE user_id=? AND subject_type=? AND state='active'
    AND id = (SELECT MAX(id) FROM warrants w2 WHERE w2.user_id=w1.user_id
              AND w2.subject_type=w1.subject_type AND w2.subject_uid=w1.subject_uid)`)
    .all(userId, subjectType).map((r) => r.subject_uid));
}

// A pending composition is owner-only whatever its private flag says: it has
// not been committed to the catalogue yet, so it must never appear publicly or
// in anyone else's view even briefly.
// ---------- multi-day check-ins (v1.29) ----------
// A check-in is one visit. ended_on = NULL means a single day; otherwise the
// visit runs visited_on..ended_on INCLUSIVE, and day-level commentary may be
// attached to any date in that range. These helpers carry every invariant so
// the web form and the MCP tools cannot drift apart.
const isYMD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v));
const todayYMD = () => new Date().toISOString().slice(0, 10);
const inRange = (day, start, end) => day >= start && day <= (end || start);

// A visit's dates as a person would say them, undated ones included.
const visitLabel = (v) => v.date_known === 0 ? UNDATED_LABEL : prettyRange(v.visited_on, v.ended_on);

// Validate a proposed range. Returns { start, end } with end null for single-day.
function normaliseVisitRange(visited_on, ended_on) {
  const start = String(visited_on || '').trim() || todayYMD();
  if (!isYMD(start)) throw new Error('visited_on must be a date in YYYY-MM-DD form.');
  if (start > todayYMD()) throw new Error('A check-in cannot be in the future.');
  let end = String(ended_on || '').trim() || null;
  if (end) {
    if (!isYMD(end)) throw new Error('ended_on must be a date in YYYY-MM-DD form.');
    if (end > todayYMD()) throw new Error('The end of a visit cannot be in the future.');
    if (end < start) throw new Error('ended_on cannot be before visited_on.');
    if (end === start) end = null;            // a one-day range IS a single day
  }
  return { start, end };
}

// Populated day rows that would fall outside a proposed range. The guard: a
// range edit must never silently discard day commentary.
function daysExcludedBy(visitId, start, end) {
  return q('SELECT day FROM visit_days WHERE visit_id=? AND body<>? ORDER BY day').all(visitId, '')
    .map((r) => r.day).filter((d) => !inRange(d, start, end));
}

// Write day commentary for a visit. `days` is [{date, body}]. Rows are sparse:
// an empty body deletes the row (or leaves nothing), a non-empty body creates
// or updates in place — the row's uid survives an edit, and a later note on a
// date whose row was removed is a new row with a new uid, matching how
// re-notes and re-marks already behave.
function applyVisitDays(visitId, start, end, days, ctx) {
  const seen = new Set();
  const out = { created: [], updated: [], removed: [] };
  for (const d of (days || [])) {
    const day = String(d && d.date || '').trim();
    if (!isYMD(day)) throw new Error(`Day "${day}" is not a date in YYYY-MM-DD form.`);
    if (seen.has(day)) throw new Error(`Day ${day} was given twice in one request.`);
    seen.add(day);
    if (!inRange(day, start, end)) throw new Error(`Day ${day} is outside this visit (${start}${end ? ` to ${end}` : ''}).`);
    const body = String(d.body || '').trim();
    const existing = q('SELECT id, uid FROM visit_days WHERE visit_id=? AND day=?').get(visitId, day);
    if (!body) {
      if (existing) {
        recordProvenance('visit_day', existing.uid, 'deleted', ctx, {});
        q('DELETE FROM visit_days WHERE id=?').run(existing.id);
        out.removed.push(day);
      }
      continue;                                  // empty stays sparse
    }
    if (existing) {
      q('UPDATE visit_days SET body=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(body, existing.id);
      recordProvenance('visit_day', existing.uid, 'edited', ctx, { fields: 'body' });
      out.updated.push(day);
    } else {
      const r = q('INSERT INTO visit_days(visit_id, day, body) VALUES(?,?,?)').run(visitId, day, body);
      recordProvenance('visit_day', uidOf('visit_days', r.lastInsertRowid), 'created', ctx, { source_kind: 'manual' });
      out.created.push(day);
    }
  }
  return out;
}

const visitDaysOf = (visitId) => q('SELECT uid, day, body FROM visit_days WHERE visit_id=? ORDER BY day').all(visitId);

// Every calendar date in a visit, inclusive — the UI derives its day slots from
// this, which is why empty days never need a row.
function datesInVisit(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z'), last = new Date((end || start) + 'T00:00:00Z');
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// "Feb 24" — for a day INSIDE a visit whose range already states the year
const prettyDayShort = (d) => new Date(d + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const UNDATED_LABEL = 'Date unknown';
// "Feb 24 – 29, 2024" / "Feb 28 – Mar 2, 2025" / "Dec 30, 2024 – Jan 2, 2025"
function prettyRange(start, end) {
  if (!end) return prettyDay(start);
  const a = new Date(start + 'T00:00:00Z'), b = new Date(end + 'T00:00:00Z');
  const M = (x) => x.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${prettyDay(start)} – ${prettyDay(end)}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${M(a)} ${a.getUTCDate()} – ${M(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${M(a)} ${a.getUTCDate()} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}

// A stored record's image as the MCP surface should see it. The stored value is
// a path ("/i/<uid>") or an external URL; a model needs the UID, because that is
// the only form the Ensemble tools accept. Without this a Note's image is
// invisible over MCP and an AI re-uploads a picture the member already has.
// Legacy rows (and any record whose picture was linked rather than ingested)
// keep an external URL in `image`. Surface it so an AI can still fetch and look
// at it — without it, such a note is invisible to anything visual.
// Pull linked pictures into storage, a few at a time, after boot. Each success
// rewrites the record to /i/<uid>, so the member's image stops depending on
// someone else's server and becomes viewable through view_images. A failure is
// recorded and the record is left exactly as it was — a broken link is still
// better than a blank note.
async function adoptLinkedImages(limit = 25) {
  let rows;
  try { rows = q("SELECT * FROM linked_image_backlog WHERE state='pending' ORDER BY id LIMIT ?").all(limit); }
  catch { return; }                                  // table not there yet
  for (const r of rows) {
    const table = r.kind === 'mark' ? 'marks' : 'objects';
    const rec = q(`SELECT id, user_id, image FROM ${table} WHERE id=?`).get(r.row_id);
    if (!rec || rec.image !== r.url) {               // edited or deleted since
      q("UPDATE linked_image_backlog SET state='done', note='superseded' WHERE id=?").run(r.id);
      continue;
    }
    try {
      const uid = await ingestImage(rec.user_id, r.url, { actor_kind: 'system', actor_label: 'image adoption' }, 'upload', 'A linked image');
      q(`UPDATE ${table} SET image=? WHERE id=?`).run(`/i/${uid}`, rec.id);
      q("UPDATE linked_image_backlog SET state='done' WHERE id=?").run(r.id);
      console.log(`[adopt] ${r.kind} #${rec.id} -> /i/${uid}`);
    } catch (e) {
      q("UPDATE linked_image_backlog SET state='failed', note=? WHERE id=?").run(String(e.message).slice(0, 200), r.id);
      console.log(`[adopt] ${r.kind} #${r.row_id} FAILED: ${String(e.message).slice(0, 120)}`);
    }
  }
}

// What the connector should tell a model about how to send images. Purely a
// troubleshooting control: 'auto' is what ships, and the forced modes exist so
// the same upload can be run down each path and compared in the logs.
const INGEST_MODES = new Set(['auto', 'always_chunk', 'never_chunk']);
function ingestDirective(u) {
  const mode = INGEST_MODES.has(u.ingest_mode) ? u.ingest_mode : 'auto';
  if (mode === 'always_chunk') return { mode, line: "INGESTION MODE: always_chunk. Send EVERY local image with "
    + "begin_image_upload and upload_image_chunk, however small, and do not use upload_image for local files at all." };
  if (mode === 'never_chunk') return { mode, line: "INGESTION MODE: never_chunk (diagnostic). Send local images as a "
    + "single inline data: URL to upload_image, however large, and do not use begin_image_upload or "
    + "upload_image_chunk. If an upload is refused as truncated or incomplete, report that plainly and do NOT fall "
    + "back to chunking — the point of this mode is to observe the failure." };
  return { mode, line: "INGESTION MODE: auto. Send local images with begin_image_upload; an image that fits one slice "
    + "takes a single call. Use upload_image for images already at a public https:// URL." };
}

const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://www.discriminantly.com').replace(/\/$/, '');
const imageUrlOf = (rec) => {
  const v = (rec && rec.image) || '';
  if (/^https?:\/\//i.test(v)) return v;
  // Demo seed notes point at static assets. They are public files, so give the
  // absolute URL rather than a bare path — otherwise has_image is true with
  // nothing an AI can actually reach, which is the worst of both.
  if (v.startsWith('/seed/')) return PUBLIC_ORIGIN + v;
  return null;
};
const imageUidOf = (rec) => {
  const v = (rec && rec.image) || '';
  return v.startsWith('/i/') ? v.slice(3) : null;
};

const ensCanSee = (e, me) => (e.status === 'pending_review')
  ? !!(me && (me.id === e.user_id || me.is_admin))
  : (!e.private || (me && (me.id === e.user_id || me.is_admin)));

// A component's OWN representation — label and image belong to the Ensemble,
// not to the linked Note. That is what lets a public Ensemble describe a
// constituent whose Note is private without touching the private record.
// ============================================================================
// ITINERARY — canonical mutations
// ----------------------------------------------------------------------------
// Every write to itineraries / itinerary_groups / itinerary_stops goes through
// this block. Web routes and MCP tools call these functions and never touch the
// tables directly, so the two surfaces cannot drift apart -- the failure Mark
// already demonstrates, with three separate INSERT INTO marks sites each
// carrying its own copy of validation and provenance.
//
// Every function takes ctx from webActor(me) or mcpActor(user), so authorship is
// derived from how the request authenticated and can never be supplied by a
// caller.
// ============================================================================

const itinById   = (id) => q('SELECT * FROM itineraries WHERE id=?').get(id);
const itinByUid  = (uid) => q('SELECT * FROM itineraries WHERE uid=?').get(uid);
const groupByUid = (uid) => q('SELECT * FROM itinerary_groups WHERE uid=?').get(uid);
const stopByUid  = (uid) => q('SELECT * FROM itinerary_stops WHERE uid=?').get(uid);

// UID is the durable external identity: MCP and any API speak uid, never rowid.
// Resolution happens AFTER the ownership check, so a uid probe cannot be used to
// discover whether a row exists.
function itinOwned(user, uid) {
  const it = itinByUid(uid);
  if (!it || it.user_id !== user.id) throw new Error('No such itinerary.');
  return it;
}
function stopOwned(user, uid) {
  const st = stopByUid(uid);
  if (!st) throw new Error('No such stop.');
  const it = itinById(st.itinerary_id);
  if (!it || it.user_id !== user.id) throw new Error('No such stop.');
  return { stop: st, itin: it };
}
function groupOwned(user, uid) {
  const g = groupByUid(uid);
  if (!g) throw new Error('No such day.');
  const it = itinById(g.itinerary_id);
  if (!it || it.user_id !== user.id) throw new Error('No such day.');
  return { group: g, itin: it };
}

// ---- collision-safe positional reindex -------------------------------------
// One mechanism, used by every operation that rearranges an ordered prefix.
//
// The partial unique indexes mean an intermediate state with two rows at the
// same rank aborts the transaction, and no single write order is safe for every
// transformation: A B C D -> D A B C shifts up, -> B C D A shifts down, and
// -> A D B C does both. Rather than reason about direction per operation, the
// whole scope is parked in a disjoint negative range and then written back in
// its final order. Two passes, always safe, no ordering analysis anywhere else.
function reindexScope(table, scopeSql, scopeArgs, orderedIds) {
  // Park the whole scope at NULL, then write the final ranks. NULL is exempt
  // from the partial unique index and satisfies the `position >= 1` check, so
  // no intermediate state can collide -- which a negative or offset parking
  // range would not achieve, the check forbidding it.
  //
  // The two passes are one transaction: a failure between them would otherwise
  // leave the scope unsequenced, silently discarding an authored order.
  const tx = !db.isTransaction;
  if (tx) db.exec('BEGIN');
  try {
    q(`UPDATE ${table} SET position=NULL WHERE ${scopeSql} AND position IS NOT NULL`).run(...scopeArgs);
    const set = q(`UPDATE ${table} SET position=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
    orderedIds.forEach((id, i) => set.run(i + 1, id));
    if (tx) db.exec('COMMIT');
  } catch (e) {
    if (tx) { try { db.exec('ROLLBACK'); } catch {} }
    throw e;
  }
}

// The authored prefix of a Stop sequencing scope, in order. Scope is the group
// when grouped, otherwise the itinerary's ungrouped set -- they never share one
// sequence, because "third on April 8" means nothing outside April 8.
function stopScope(stop) {
  return stop.group_id
    ? { sql: 'group_id=?', args: [stop.group_id] }
    : { sql: 'itinerary_id=? AND group_id IS NULL', args: [stop.itinerary_id] };
}
function stopPrefix(scope) {
  return q(`SELECT id, uid, position FROM itinerary_stops
            WHERE ${scope.sql} AND position IS NOT NULL ORDER BY position`).all(...scope.args);
}

// ---- itinerary --------------------------------------------------------------
function itineraryCreate(user, { title = '', context = '', temporal = {}, private: priv = 1 }, ctx) {
  const t = { ...temporalOf({}), ...temporal };
  const bad = temporalValidate(t); if (bad) throw new Error(bad);
  const cols = T_COLS.join(',');
  const r = q(`INSERT INTO itineraries(user_id,title,context,private,${cols})
               VALUES(?,?,?,?,${T_COLS.map(() => '?').join(',')})`)
    .run(user.id, String(title).trim(), String(context).trim(), priv ? 1 : 0, ...T_COLS.map((k) => t[k]));
  const uid = uidOf('itineraries', r.lastInsertRowid);
  recordProvenance('itinerary', uid, 'created', ctx, { source_kind: 'manual' });
  return itinByUid(uid);
}

function itineraryEdit(user, uid, { title, context }, ctx) {
  const it = itinOwned(user, uid);
  const fields = [];
  if (title !== undefined && title !== it.title) fields.push('title');
  if (context !== undefined && context !== it.context) fields.push('context');
  if (!fields.length) return it;
  q('UPDATE itineraries SET title=?, context=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(title !== undefined ? String(title).trim() : it.title,
         context !== undefined ? String(context).trim() : it.context, it.id);
  recordProvenance('itinerary', it.uid, 'edited', ctx, { fields: fields.join(',') });
  return itinById(it.id);
}

// intent is 'refine' | 'correct' | null. Null means the act carried no evidence
// of which it was, and the truthful action is 'edited'.
function temporalMutate(table, entityType, row, incoming, intent, ctx) {
  const { next, changed, action } = temporalApply(temporalOf(row), incoming, intent);
  if (!changed.length) return row;
  const bad = temporalValidate(next); if (bad) throw new Error(bad);
  q(`UPDATE ${table} SET ${T_COLS.map((k) => k + '=?').join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(...T_COLS.map((k) => next[k]), row.id);
  recordProvenance(entityType, row.uid, action, ctx, { fields: changed.join(',') });
  return q(`SELECT * FROM ${table} WHERE id=?`).get(row.id);
}
const itineraryUpdateTemporal = (user, uid, incoming, intent, ctx) =>
  temporalMutate('itineraries', 'itinerary', itinOwned(user, uid), incoming, intent, ctx);

// Publication refuses while a visible Stop links a Mark the public cannot see.
// The caller resolves it: publish those Marks, or suspend those Stops. There is
// no default and no silent proceed, and because MCP calls this same function an
// AI cannot publish past it either.
function itineraryPublishConflicts(itineraryId) {
  return q(`SELECT s.uid, s.label, m.id mark_id, m.name mark_name
            FROM itinerary_stops s JOIN marks m ON m.uid = s.mark_uid
            WHERE s.itinerary_id=? AND s.visibility='visible' AND m.private=1`).all(itineraryId);
}
function itineraryPublish(user, uid, ctx) {
  const it = itinOwned(user, uid);
  const conflicts = itineraryPublishConflicts(it.id);
  if (conflicts.length) {
    const err = new Error('This itinerary references private travel marks: ' +
      conflicts.map((c) => c.mark_name).join(', ') +
      '. Make those marks public, or suspend those stops, then publish again.');
    err.conflicts = conflicts;
    throw err;
  }
  if (!it.private) return it;
  q('UPDATE itineraries SET private=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(it.id);
  recordProvenance('itinerary', it.uid, 'edited', ctx, { fields: 'private' });
  return itinById(it.id);
}
function itineraryUnpublish(user, uid, ctx) {
  const it = itinOwned(user, uid);
  if (it.private) return it;
  q('UPDATE itineraries SET private=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(it.id);
  recordProvenance('itinerary', it.uid, 'edited', ctx, { fields: 'private' });
  return itinById(it.id);
}
function itineraryDelete(user, uid, ctx) {
  const it = itinOwned(user, uid);
  // RESTRICT guards groups against stops, so stops go first, then groups, then
  // the itinerary. The cascade would handle stops, but not the group order.
  q('DELETE FROM itinerary_stops WHERE itinerary_id=?').run(it.id);
  q('DELETE FROM itinerary_groups WHERE itinerary_id=?').run(it.id);
  q('DELETE FROM itineraries WHERE id=?').run(it.id);
  recordProvenance('itinerary', it.uid, 'deleted', ctx, {});
  return true;
}

// ---- groups -----------------------------------------------------------------
function groupCreate(user, itinUid, { label = '', temporal = {}, position = null }, ctx) {
  const it = itinOwned(user, itinUid);
  const t = { ...temporalOf({}), ...temporal };
  const bad = temporalValidate(t); if (bad) throw new Error(bad);
  const cols = T_COLS.join(',');
  const r = q(`INSERT INTO itinerary_groups(itinerary_id,label,position,${cols})
               VALUES(?,?,?,${T_COLS.map(() => '?').join(',')})`)
    .run(it.id, String(label).trim(), position ?? null, ...T_COLS.map((k) => t[k]));
  const uid = uidOf('itinerary_groups', r.lastInsertRowid);
  recordProvenance('itinerary_group', uid, 'created', ctx, { source_kind: 'manual' });
  return groupByUid(uid);
}
const groupUpdateTemporal = (user, uid, incoming, intent, ctx) =>
  temporalMutate('itinerary_groups', 'itinerary_group', groupOwned(user, uid).group, incoming, intent, ctx);

function groupEdit(user, uid, { label }, ctx) {
  const { group } = groupOwned(user, uid);
  if (label === undefined || label === group.label) return group;
  q('UPDATE itinerary_groups SET label=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(label).trim(), group.id);
  recordProvenance('itinerary_group', group.uid, 'edited', ctx, { fields: 'label' });
  return groupByUid(uid);
}

// Authored group arrangement. Groups with no position are not reordered here --
// they have no authored rank, and rendering derives their order per request.
function groupSetPosition(user, uid, wanted, ctx) {
  const { group, itin } = groupOwned(user, uid);
  const scope = { sql: 'itinerary_id=?', args: [itin.id] };
  const prefix = q(`SELECT id, uid FROM itinerary_groups
                    WHERE itinerary_id=? AND position IS NOT NULL ORDER BY position`).all(itin.id);
  const ids = prefix.map((r) => r.id).filter((id) => id !== group.id);
  if (wanted === null) {
    q('UPDATE itinerary_groups SET position=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(group.id);
    reindexScope('itinerary_groups', scope.sql, scope.args, ids);
  } else {
    const at = Math.max(1, Math.min(Number(wanted), ids.length + 1));
    ids.splice(at - 1, 0, group.id);
    reindexScope('itinerary_groups', scope.sql, scope.args, ids);
  }
  recordProvenance('itinerary_group', group.uid, 'edited', ctx, { fields: 'position' });
  return groupByUid(uid);
}

// Deleting a day ungroups its stops and clears their positions in the same
// statement. A position of 2 meant "second on April 8"; carried into the
// ungrouped scope it would assert an order the member never made -- and would
// collide with the ungrouped unique index. RESTRICT makes this order mandatory
// rather than merely correct.
function groupDelete(user, uid, ctx) {
  const { group, itin } = groupOwned(user, uid);
  const affected = q('SELECT uid FROM itinerary_stops WHERE group_id=?').all(group.id);
  q('UPDATE itinerary_stops SET group_id=NULL, position=NULL, updated_at=CURRENT_TIMESTAMP WHERE group_id=?').run(group.id);
  q('DELETE FROM itinerary_groups WHERE id=?').run(group.id);
  reindexScope('itinerary_groups', 'itinerary_id=?', [itin.id],
    q('SELECT id FROM itinerary_groups WHERE itinerary_id=? AND position IS NOT NULL ORDER BY position')
      .all(itin.id).map((r) => r.id));
  recordProvenance('itinerary_group', group.uid, 'deleted', ctx, {});
  for (const a of affected) recordProvenance('itinerary_stop', a.uid, 'edited', ctx, { fields: 'group_id,position' });
  return true;
}

// ---- stops ------------------------------------------------------------------
// resolution and mark_uid are derived together, never accepted as an
// independent pair: the CHECK constraint would reject a contradiction anyway,
// but the caller should not be able to express one.
function stopAdd(user, itinUid, { label = '', mark_uid = null, resolution = null,
                                  group_uid = null, temporal = {}, position = null,
                                  new_place = null }, ctx) {
  const it = itinOwned(user, itinUid);
  // Accepting a sufficiently identified place into a plan creates its Travel
  // Mark, per the Mark boundary: added to the itinerary IS marked. The Mark's
  // own creation provenance carries where it came from, so corpus lineage is
  // causal rather than guessed.
  if (!mark_uid && new_place && String(new_place.name || '').trim()) {
    const np = new_place;
    const r0 = q(`INSERT INTO marks(user_id,name,locality,country,address,lat,lng,why,tags,url,private)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(user.id, String(np.name).trim(), np.locality || null, np.country || null,
           np.address || null, np.lat ?? null, np.lng ?? null, np.why || '', np.tags || null,
           np.url || null, it.private ? 1 : 0);
    const mkUid = uidOf('marks', r0.lastInsertRowid);
    recordProvenance('mark', mkUid, 'created', ctx,
      { source_kind: 'itinerary', source_ref: it.uid });
    mark_uid = mkUid;
  }
  const t = { ...temporalOf({}), ...temporal };
  const bad = temporalValidate(t); if (bad) throw new Error(bad);

  let groupId = null;
  if (group_uid) {
    const { group } = groupOwned(user, group_uid);
    if (group.itinerary_id !== it.id) throw new Error('That day belongs to another itinerary.');
    groupId = group.id;
  }
  let res = resolution, mUid = null;
  if (mark_uid) {
    const mk = q('SELECT * FROM marks WHERE uid=?').get(mark_uid);
    if (!mk || mk.user_id !== user.id) throw new Error('No such travel mark.');
    mUid = mk.uid; res = 'linked';
  } else if (!res || res === 'linked') {
    res = 'experiential';        // no mark means it cannot be linked
  }
  if (!['linked', 'particular', 'experiential', 'allocation'].includes(res)) throw new Error('Unknown stop kind.');

  const cols = T_COLS.join(',');
  const r = q(`INSERT INTO itinerary_stops(itinerary_id,group_id,label,mark_uid,resolution,position,visibility,${cols})
               VALUES(?,?,?,?,?,?,'visible',${T_COLS.map(() => '?').join(',')})`)
    .run(it.id, groupId, String(label).trim(), mUid, res, position ?? null, ...T_COLS.map((k) => t[k]));
  const uid = uidOf('itinerary_stops', r.lastInsertRowid);
  recordProvenance('itinerary_stop', uid, 'created', ctx, { source_kind: 'manual', fields: res });

  // Privacy propagates upward: linking a private mark to a public itinerary
  // makes the itinerary private rather than disclosing the mark.
  if (mUid) markPrivacyGuard(it.id, mUid, ctx);
  return stopByUid(uid);
}

const stopUpdateTemporal = (user, uid, incoming, intent, ctx) =>
  temporalMutate('itinerary_stops', 'itinerary_stop', stopOwned(user, uid).stop, incoming, intent, ctx);

function stopEdit(user, uid, { label }, ctx) {
  const { stop } = stopOwned(user, uid);
  if (label === undefined || label === stop.label) return stop;
  q('UPDATE itinerary_stops SET label=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(String(label).trim(), stop.id);
  recordProvenance('itinerary_stop', stop.uid, 'edited', ctx, { fields: 'label' });
  return stopByUid(uid);
}

// Resolution mutates the Stop in place, exactly as ensemble components do. The
// row keeps its uid, its position, its group and its times, and the original
// label is never cleared -- it is what the member actually said, and what the
// interface shows as the intention the mark answered.
function stopResolveToMark(user, uid, markUid, intent, ctx) {
  const { stop, itin } = stopOwned(user, uid);
  const mk = q('SELECT * FROM marks WHERE uid=?').get(markUid);
  if (!mk || mk.user_id !== user.id) throw new Error('No such travel mark.');
  const action = intent === 'refine' ? 'enriched' : intent === 'correct' ? 'corrected' : 'edited';
  q(`UPDATE itinerary_stops SET mark_uid=?, resolution='linked', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(mk.uid, stop.id);
  recordProvenance('itinerary_stop', stop.uid, action, ctx, { fields: 'mark_uid,resolution' });
  markPrivacyGuard(itin.id, mk.uid, ctx);
  return stopByUid(uid);
}

function stopUnresolve(user, uid, resolution, ctx) {
  const { stop } = stopOwned(user, uid);
  const res = ['particular', 'experiential', 'allocation'].includes(resolution) ? resolution : 'particular';
  q(`UPDATE itinerary_stops SET mark_uid=NULL, resolution=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(res, stop.id);
  recordProvenance('itinerary_stop', stop.uid, 'corrected', ctx, { fields: 'mark_uid,resolution' });
  return stopByUid(uid);
}

function stopSetResolution(user, uid, resolution, ctx) {
  const { stop } = stopOwned(user, uid);
  if (stop.mark_uid) throw new Error('This stop is linked to a travel mark; unlink it first.');
  if (!['particular', 'experiential', 'allocation'].includes(resolution)) throw new Error('Unknown stop kind.');
  if (resolution === stop.resolution) return stop;
  q('UPDATE itinerary_stops SET resolution=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(resolution, stop.id);
  recordProvenance('itinerary_stop', stop.uid, 'edited', ctx, { fields: 'resolution' });
  return stopByUid(uid);
}

// Moving between groups clears the old position: the assertion was scoped to
// the group it was made in. A destination slot, if given, is a fresh assertion.
function stopSetGroup(user, uid, groupUid, destPosition, ctx) {
  const { stop, itin } = stopOwned(user, uid);
  let groupId = null;
  if (groupUid) {
    const { group } = groupOwned(user, groupUid);
    if (group.itinerary_id !== itin.id) throw new Error('That day belongs to another itinerary.');
    groupId = group.id;
  }
  if (groupId === stop.group_id && destPosition === undefined) return stop;

  const source = stopScope(stop);
  q('UPDATE itinerary_stops SET group_id=?, position=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(groupId, stop.id);
  // close the gap the move left behind
  reindexScope('itinerary_stops', source.sql, source.args,
    q(`SELECT id FROM itinerary_stops WHERE ${source.sql} AND position IS NOT NULL ORDER BY position`)
      .all(...source.args).map((r) => r.id));
  recordProvenance('itinerary_stop', stop.uid, 'edited', ctx, { fields: 'group_id,position' });
  if (destPosition !== undefined && destPosition !== null) stopSetPosition(user, uid, destPosition, ctx);
  return stopByUid(uid);
}

// The authored ordered prefix. position null removes the assertion; a number
// places the stop at that rank and shifts the rest. Contiguity is maintained by
// rebuilding the whole scope through reindexScope.
// Exchanging two neighbouring stops exchanges the slot as well as the rank:
// the member reads "morning" as belonging to the first thing they do, so a swap
// that left the times behind would silently re-time both stops. Only daypart
// and clock move -- a date belongs to the day, not to a position within it --
// and both stops get their own provenance row, because both were changed.
function stopSwap(user, uid, otherUid, ctx) {
  const { stop: a, itin } = stopOwned(user, uid);
  const { stop: b } = stopOwned(user, otherUid);
  if (a.itinerary_id !== b.itinerary_id || a.group_id !== b.group_id) throw new Error('Those stops are not in the same day.');
  if (a.position === null || b.position === null) throw new Error('Both stops must be in the order to swap.');
  const scope = stopScope(a);
  const ids = stopPrefix(scope).map((r) => r.id);
  const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
  ids[ia] = b.id; ids[ib] = a.id;
  const swapT = (a.t_daypart !== b.t_daypart) || (a.t_clock !== b.t_clock);
  const tx = !db.isTransaction;
  if (tx) db.exec('BEGIN');
  try {
    reindexScope('itinerary_stops', scope.sql, scope.args, ids);
    if (swapT) {
      q('UPDATE itinerary_stops SET t_daypart=?, t_clock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(b.t_daypart, b.t_clock, a.id);
      q('UPDATE itinerary_stops SET t_daypart=?, t_clock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(a.t_daypart, a.t_clock, b.id);
    }
    if (tx) db.exec('COMMIT');
  } catch (e) { if (tx) { try { db.exec('ROLLBACK'); } catch {} } throw e; }
  const fields = swapT ? 'position,t_daypart,t_clock' : 'position';
  recordProvenance('itinerary_stop', a.uid, 'edited', ctx, { fields });
  recordProvenance('itinerary_stop', b.uid, 'edited', ctx, { fields });
  return stopByUid(uid);
}

function stopSetPosition(user, uid, wanted, ctx) {
  const { stop } = stopOwned(user, uid);
  const scope = stopScope(stop);
  const ids = stopPrefix(scope).map((r) => r.id).filter((id) => id !== stop.id);
  if (wanted === null) {
    q('UPDATE itinerary_stops SET position=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(stop.id);
    reindexScope('itinerary_stops', scope.sql, scope.args, ids);
  } else {
    const at = Math.max(1, Math.min(Number(wanted), ids.length + 1));
    ids.splice(at - 1, 0, stop.id);
    reindexScope('itinerary_stops', scope.sql, scope.args, ids);
  }
  recordProvenance('itinerary_stop', stop.uid, 'edited', ctx, { fields: 'position' });
  return stopByUid(uid);
}

function stopSuspend(user, uid, ctx) {
  const { stop } = stopOwned(user, uid);
  if (stop.visibility === 'suspended') return stop;
  q(`UPDATE itinerary_stops SET visibility='suspended', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(stop.id);
  recordProvenance('itinerary_stop', stop.uid, 'edited', ctx, { fields: 'visibility' });
  return stopByUid(uid);
}
function stopRestore(user, uid, ctx) {
  const { stop, itin } = stopOwned(user, uid);
  if (stop.visibility === 'visible') return stop;
  if (stop.mark_uid && !itin.private) {
    const mk = q('SELECT private FROM marks WHERE uid=?').get(stop.mark_uid);
    if (mk && mk.private) throw new Error('That travel mark is still private. Make it public first, or keep the stop suspended.');
  }
  q(`UPDATE itinerary_stops SET visibility='visible', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(stop.id);
  recordProvenance('itinerary_stop', stop.uid, 'edited', ctx, { fields: 'visibility' });
  return stopByUid(uid);
}

function stopDelete(user, uid, ctx) {
  const { stop } = stopOwned(user, uid);
  const scope = stopScope(stop);
  q('DELETE FROM itinerary_stops WHERE id=?').run(stop.id);
  reindexScope('itinerary_stops', scope.sql, scope.args,
    q(`SELECT id FROM itinerary_stops WHERE ${scope.sql} AND position IS NOT NULL ORDER BY position`)
      .all(...scope.args).map((r) => r.id));
  recordProvenance('itinerary_stop', stop.uid, 'deleted', ctx, {});
  return true;
}

// ---- privacy ----------------------------------------------------------------
// Upward propagation at the moment of linking. Publicity never flows downward,
// so this only ever makes a parent private.
function markPrivacyGuard(itineraryId, markUid, ctx) {
  const it = itinById(itineraryId);
  if (!it || it.private) return;
  const mk = q('SELECT private FROM marks WHERE uid=?').get(markUid);
  if (!mk || !mk.private) return;
  q('UPDATE itineraries SET private=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(it.id);
  recordProvenance('itinerary', it.uid, 'edited', ctx, { fields: 'private', source_kind: 'mark_privacy' });
}

// Called from both marks.private write sites. A mark turning private takes every
// public itinerary that shows it private too, rather than suspending the stop:
// suspension would preserve publicity the member never asked to keep.
function markPrivacyChanged(markUid, nowPrivate, ctx) {
  if (!nowPrivate || !markUid) return [];
  const affected = q(`SELECT DISTINCT i.id, i.uid FROM itineraries i
                      JOIN itinerary_stops s ON s.itinerary_id = i.id
                      WHERE s.mark_uid=? AND s.visibility='visible' AND i.private=0`).all(markUid);
  for (const it of affected) {
    q('UPDATE itineraries SET private=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(it.id);
    recordProvenance('itinerary', it.uid, 'edited', ctx, { fields: 'private', source_kind: 'mark_privacy' });
  }
  return affected;
}

// A viewer who can see the itinerary sees a stop when it is visible -- a stop
// needs no mark to be legitimate, since particular, experiential and allocation
// stops are the substance of most plans.
//
// Linked stops distinguish three cases, and a private mark FAILS CLOSED: the
// stop renders nothing at all. Substituting the label would represent private
// child information through a public parent, which is the one thing the privacy
// rule forbids. A deleted mark is different -- there is no private information
// left to protect, so the retained label stands on its own.
function canSeeStop(stop, itin, me) {
  if (me && (me.id === itin.user_id || me.is_admin)) {
    const mk = stop.mark_uid ? q(MARK_SQL + ' WHERE m.uid=?').get(stop.mark_uid) : null;
    return { see: true, owner: true, mark: mk || null, dangling: !!(stop.mark_uid && !mk) };
  }
  if (itin.private) return { see: false };
  if (stop.visibility !== 'visible') return { see: false };
  if (stop.resolution !== 'linked' || !stop.mark_uid) return { see: true, owner: false, mark: null };
  const mk = q(MARK_SQL + ' WHERE m.uid=?').get(stop.mark_uid);
  if (!mk) return { see: true, owner: false, mark: null, dangling: true };   // deleted: label only
  if (mk.private) return { see: false };                                      // private: nothing
  return { see: true, owner: false, mark: mk };
}

// Form fields arrive as strings; empty means "not asserted", never zero.
const T_NUM = ['t_year', 't_month', 't_day'];
function temporalFromForm(b) {
  const t = {};
  for (const k of T_COLS) {
    if (!(k in b)) continue;
    const v = String(b[k] ?? '').trim();
    t[k] = v === '' ? null : (T_NUM.includes(k) ? Number(v) : v);
  }
  return t;
}
const hasTemporalForm = (b) => T_COLS.some((k) => k in b);

// Direct manipulation for the itinerary page. Dragging a stop by its handle and
// dropping it among the sequenced ones is the member asserting its place; the
// drop POSTs a position through the same route the form uses. Dropping onto
// another day's list moves it there with a fresh position. Nothing here infers
// order from where things happen to sit.
const ITIN_JS = `
(function(){
  var page=document.querySelector('.itin-page'); if(!page) return;
  var base=location.pathname.replace(/\\/$/,'');
  var dragging=null, over=null;
  // Reordering posts in the background and rearranges the DOM in place, so the
  // page does not flash. The server is still the authority: on failure the
  // page reloads so what is shown is what was actually saved.
  function post(url, data, onDone){
    var body=Object.keys(data).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(data[k]); }).join('&');
    fetch(url, {method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:body, redirect:'follow', credentials:'same-origin'})
      .then(function(r){ if(!r.ok) throw new Error('save failed'); if(onDone) onDone(); })
      .catch(function(){ location.reload(); });
  }
  // Renumber the visible prefix so the spine and the arrows stay truthful
  // between the move and the next full load.
  // The stop numbers and the map's pins read the same order, so both are
  // renumbered together the moment the order changes -- a pin still showing 2
  // beside a stop now numbered 1 would be a map that lies.
  function renumber(){
    var n=0, order=[];
    document.querySelectorAll('.itin-tl').forEach(function(ol2){
      Array.prototype.forEach.call(ol2.querySelectorAll('.stop.is-seq[data-stop]'), function(li){
        var lbl=li.querySelector('.stop-no');
        var idx=++n;                       // continuous across days, never per day
        if(lbl) lbl.textContent=idx+'.';
        order.push(li.getAttribute('data-stop'));
      });
    });
    var k=0; var seen={};
    order.forEach(function(uid,i){ seen[uid]=i+1; });
    document.querySelectorAll('.itin-map [data-pin]').forEach(function(g){
      var t=g.querySelector('.pin-n'); if(!t) return;
      var v=seen[g.getAttribute('data-pin')];
      t.textContent = v ? String(v) : '';
    });
  }
  // Exchange the two stops' time-of-day text, leaving each one's number where
  // the renumbering will put it.
  function whenText(li){
    var w=li.querySelector('.stop-when'); if(!w) return '';
    var n=w.querySelector('.stop-no');
    return Array.prototype.filter.call(w.childNodes, function(x){ return x!==n; })
      .map(function(x){ return x.textContent; }).join('');
  }
  function setWhen(li, txt){
    var w=li.querySelector('.stop-when');
    if(!w){ if(!txt) return; var head=li.querySelector('.stop-head'); if(!head) return;
      w=document.createElement('span'); w.className='stop-when'; head.insertBefore(w, head.firstChild); }
    var n=w.querySelector('.stop-no');
    w.textContent=''; if(n) w.appendChild(n);
    if(txt) w.appendChild(document.createTextNode(txt));
  }
  function swapWhen(a, b2){ var x=whenText(a), y=whenText(b2); setWhen(a, y); setWhen(b2, x); }
  function resequence(ol){
    var stops=Array.prototype.slice.call(ol.querySelectorAll('.stop[data-stop]'));
    var seen=0;
    stops.forEach(function(s2){ if(s2.classList.contains('is-seq')){ seen++; } });
    ol.setAttribute('data-seq', String(seen));
  }
  page.addEventListener('pointerdown', function(e){
    var h=e.target.closest('[data-drag]'); if(!h) return;
    dragging=h.closest('.stop'); dragging.classList.add('is-dragging'); e.preventDefault();
    h.setPointerCapture && h.setPointerCapture(e.pointerId);
  });
  page.addEventListener('pointermove', function(e){
    if(!dragging) return;
    var el=document.elementFromPoint(e.clientX,e.clientY); var li=el&&el.closest('.stop:not(.stop-add)');
    var ol=el&&el.closest('.itin-tl');
    document.querySelectorAll('.drop-before,.drop-into').forEach(function(x){x.classList.remove('drop-before','drop-into');});
    over=null;
    if(li && li!==dragging){ li.classList.add('drop-before'); over={li:li, ol:li.closest('.itin-tl')}; }
    else if(ol && !li){ ol.classList.add('drop-into'); over={li:null, ol:ol}; }
  });
  function finish(){
    if(!dragging) return;
    var d=dragging; dragging=null; d.classList.remove('is-dragging');
    document.querySelectorAll('.drop-before,.drop-into').forEach(function(x){x.classList.remove('drop-before','drop-into');});
    if(!over) return;
    var uid=d.getAttribute('data-stop');
    var destGroup=over.ol.getAttribute('data-group')||'';
    var srcGroup=d.closest('.itin-tl').getAttribute('data-group')||'';
    var pos;
    if(over.li){ var seq=Array.prototype.slice.call(over.ol.querySelectorAll('.stop.is-seq')); var i=seq.indexOf(over.li); pos = i>=0 ? i+1 : seq.length+1; }
    else pos = over.ol.querySelectorAll('.stop.is-seq').length+1;
    var data={position:String(pos)}; if(destGroup!==srcGroup) data.group_uid=destGroup;
    // move the node first so the drop lands where the pointer left it
    d.classList.add('is-seq');
    if(over.li) over.ol.insertBefore(d, over.li);
    else { var addLi=over.ol.querySelector('.stop-add'); if(addLi) over.ol.insertBefore(d, addLi); else over.ol.appendChild(d); }
    resequence(over.ol); if(over.ol!==d.closest('.itin-tl')) resequence(d.closest('.itin-tl'));
    renumber();
    post(base+'/stops/'+uid, data);
    over=null;
  }
  page.addEventListener('pointerup', finish); page.addEventListener('pointercancel', finish);

  // Looking up the member's own marks while writing a stop. Choosing one links
  // that mark; typing on without choosing leaves the prose as the intention.
  function pickerFor(form){ return {
    input: form.querySelector('[data-lookup]'), hidden: form.querySelector('input[name=mark_uid]'),
    picks: form.querySelector('.mark-picks'), chosen: form.querySelector('.mark-chosen'),
    kind: form.querySelector('.stop-add-kind') }; }
  function choose(form, uid, name){ var f=pickerFor(form);
    f.hidden.value=uid; f.input.value=name;
    f.chosen.querySelector('.mark-chosen-name').textContent=name; f.chosen.hidden=false;
    f.picks.hidden=true; f.picks.innerHTML='';
    if(f.kind) f.kind.hidden=true;                 // a linked stop has no kind to choose
  }
  function unchoose(form){ var f=pickerFor(form);
    f.hidden.value=''; f.chosen.hidden=true; if(f.kind) f.kind.hidden=false; }
  var lookupTimer=null;
  page.addEventListener('input', function(e){
    var input=e.target.closest('[data-lookup]'); if(!input) return;
    var form=input.closest('form'); var f=pickerFor(form);
    if(f.hidden.value) unchoose(form);
    clearTimeout(lookupTimer);
    var term=input.value.trim();
    if(term.length<2){ f.picks.hidden=true; f.picks.innerHTML=''; return; }
    lookupTimer=setTimeout(function(){
      fetch(base+'/marks?q='+encodeURIComponent(term), {credentials:'same-origin'})
        .then(function(r){ return r.json(); })
        .then(function(rows){
          if(!rows.length){ f.picks.hidden=true; f.picks.innerHTML=''; return; }
          f.picks.innerHTML=rows.map(function(m2){
            return '<button type="button" class="mark-pick" data-uid="'+m2.uid+'" data-name="'+m2.name.replace(/"/g,'&quot;')+'">'+
              '<span class="mark-pick-name"></span><span class="mark-pick-where"></span></button>'; }).join('');
          Array.prototype.forEach.call(f.picks.querySelectorAll('.mark-pick'), function(el,i){
            el.querySelector('.mark-pick-name').textContent=rows[i].name;
            el.querySelector('.mark-pick-where').textContent=rows[i].where||''; });
          f.picks.hidden=false;
        }).catch(function(){ f.picks.hidden=true; });
    }, 180);
  });
  page.addEventListener('click', function(e){
    var pick=e.target.closest('.mark-pick, .mark-chip');
    if(pick){ e.preventDefault(); choose(pick.closest('form'), pick.dataset.uid, pick.dataset.name); return; }
    var un=e.target.closest('[data-unpick]');
    if(un){ e.preventDefault(); unchoose(un.closest('form')); return; }
    // one card, two kinds of thing to add
    var seg=e.target.closest('[data-itin-seg]');
    if(seg){ e.preventDefault();
      var wrap=seg.closest('.stop-add-disc'); var kind=seg.dataset.itinSeg;
      wrap.querySelectorAll('[data-itin-seg]').forEach(function(x){
        var on=x.dataset.itinSeg===kind; x.classList.toggle('on', on); x.setAttribute('aria-selected', on?'true':'false'); });
      wrap.querySelectorAll('.itin-seg-panel').forEach(function(x){ x.classList.toggle('is-on', x.dataset.kind===kind); });
      return; }
    var ac=e.target.closest('[data-add-cancel]');
    if(ac){ e.preventDefault(); var d2=ac.closest('details'); if(d2) d2.open=false; }
  });

  // The Edit affordance in the byline opens the itinerary's own edit form --
  // the same place the Edit link sits on every other object.
  page.addEventListener('click', function(e){
    var cancel=e.target.closest('[data-itin-cancel],[data-stop-cancel]');
    if(cancel){ e.preventDefault();
      if(cancel.hasAttribute('data-itin-cancel')){ var tog=document.querySelector('.itin-edit-toggle'); if(tog) tog.checked=false; return; }
      var dd=cancel.closest('details'); if(dd) dd.open=false; return; }
    // Arrows are an alternative to dragging, writing the same canonical order.
    var mv=e.target.closest('[data-move]');
    if(mv){ e.preventDefault();
      var li=mv.closest('.stop'); var ol=li.closest('.itin-tl');
      var seq=Array.prototype.slice.call(ol.querySelectorAll('.stop.is-seq'));
      var i=seq.indexOf(li);
      var pos, ref, swapWith=null;
      if(i<0){ pos = mv.dataset.move==='up' ? 1 : seq.length+1; ref = mv.dataset.move==='up' ? seq[0] : null; }
      else if(mv.dataset.move==='up'){ if(i===0) return; pos=i; ref=seq[i-1]; swapWith=seq[i-1]; }
      else { if(i>=seq.length-1) return; pos=i+2; ref=seq[i+1].nextElementSibling; swapWith=seq[i+1]; }
      li.classList.add('is-seq');
      if(ref) ol.insertBefore(li, ref); else {
        var addLi=ol.querySelector('.stop-add'); if(addLi) ol.insertBefore(li, addLi); else ol.appendChild(li);
      }
      resequence(ol);
      renumber(ol);
      // an arrow IS an exchange with the neighbour, so the slot goes with it
      // The server exchanges the slot as well as the rank, so the page has to
      // show that exchange too -- otherwise the times would be a page-load out
      // of date. Swapping the text is what the server just did, not a guess.
      if(swapWith) swapWhen(li, swapWith);
      post(base+'/stops/'+li.getAttribute('data-stop'),
        swapWith ? {swap_with: swapWith.getAttribute('data-stop')} : {position:String(pos)});
    }
  });
})();`;

// ---- reading ----------------------------------------------------------------
// Three-tier group order, built once. Authored prefix first; then chronology
// where it is objectively derivable; then stable by id. Derived order is never
// written back, and a group with no authored position never precedes one with.
function groupOrder(itineraryId) {
  const rows = q('SELECT * FROM itinerary_groups WHERE itinerary_id=? ORDER BY id').all(itineraryId);
  const authored = rows.filter((g) => g.position !== null).sort((a, b) => a.position - b.position);
  const rest = rows.filter((g) => g.position === null);
  const keyed = rest.map((g) => ({ g, k: temporalChronoKey(temporalOf(g)) }));
  const withKey = keyed.filter((x) => x.k).sort((a, b) =>
    a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.g.id - b.g.id);
  const without = keyed.filter((x) => !x.k).sort((a, b) => a.g.id - b.g.id);
  return [...authored, ...withKey.map((x) => x.g), ...without.map((x) => x.g)];
}

// Groups whose label order and asserted chronology disagree. Reported so the
// member can resolve it; nothing is chosen for them and neither assertion moves.
function groupConflicts(itineraryId) {
  const rows = groupOrder(itineraryId).filter((g) => temporalChronoKey(temporalOf(g)));
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = temporalChronoKey(temporalOf(rows[i - 1])), b = temporalChronoKey(temporalOf(rows[i]));
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (cmp > 0) out.push(`${rows[i - 1].label || 'A day'} (${temporalFormat(temporalOf(rows[i - 1]))}) ` +
      `is arranged before ${rows[i].label || 'another day'} (${temporalFormat(temporalOf(rows[i]))})`);
  }
  return out;
}

const itineraryStops = (itineraryId, groupId) => q(
  `SELECT * FROM itinerary_stops WHERE itinerary_id=? AND ${groupId === null ? 'group_id IS NULL' : 'group_id=?'}
   ORDER BY CASE WHEN position IS NULL THEN 1 ELSE 0 END, position, id`)
  .all(...(groupId === null ? [itineraryId] : [itineraryId, groupId]));

function ensComponents(ensembleId) {
  return q('SELECT * FROM ensemble_components WHERE ensemble_id=? ORDER BY position, id').all(ensembleId);
}
// A snapshot of what an Ensemble is made of, for the listing chips. "Source
// images" reads better than "unresolved items": from the member's side these
// are the pictures the composition drew on that aren't (yet) their own notes.
function ensStats(ensembleId) {
  const comps = ensComponents(ensembleId);
  const fromNotes = comps.filter((c) => c.note_uid).length;
  return { total: comps.length, fromNotes, sourceImages: comps.length - fromNotes };
}
// Small labelled chips, in the welcome table's voice: a value over a caption.
// Used by the Ensemble tiles and the people cards so both read as one system.
const statChips = (pairs) => `<span class="statchips">${pairs
  .filter(([, v]) => v !== null && v !== undefined)
  .map(([label, v]) => `<span class="statchip"><b>${v}</b><span>${esc(label)}</span></span>`).join('')}</span>`;
function ensArtifacts(ensembleId) {
  return q('SELECT * FROM ensemble_artifacts WHERE ensemble_id=? ORDER BY id').all(ensembleId);
}
// Did this Note come into existence through this Ensemble? Read from
// provenance, never from a Note subtype — origin is history, not ontology.
function noteOriginFor(noteUid, ensembleUid) {
  if (!noteUid) return null;
  const r = q(`SELECT 1 FROM provenance WHERE entity_type='object' AND entity_uid=?
    AND action='created' AND source_kind='ensemble' AND source_ref=?`).get(noteUid, ensembleUid);
  return r ? 'created_by_ensemble' : 'pre_existing';
}
// Summarised resolution history for one component, from component-targeted
// provenance. Current state lives on the row; this is the audit trail.
function componentHistory(componentUid) {
  return q(`SELECT action, assertion, actor_type, source_kind, source_ref, fields, created_at
    FROM provenance WHERE entity_type='ensemble_component' AND entity_uid=? ORDER BY id`).all(componentUid)
    .map((r) => ({ action: r.action, basis: r.source_kind || null, note_uid: r.source_ref || null,
      actor: r.actor_type, assertion: r.assertion, superseded: r.fields || null, at: r.created_at }));
}

// Component view, privacy-aware. A viewer who cannot see the linked Note gets
// the Ensemble's own representation and NO trace of the private record —
// no uid, no link, no metadata. Enforced here, not in a template.
function componentView(c, ens, me) {
  const note = c.note_uid ? q('SELECT * FROM objects WHERE uid=?').get(c.note_uid) : null;
  const noteVisible = note && canSee(note, me);
  return {
    component_uid: c.uid,
    position: c.position,
    state: c.state,
    label: c.label || (noteVisible ? note.name : ''),
    image: c.image_uid ? `/i/${c.image_uid}` : (noteVisible ? note.image : '') || '',
    source_url: c.source_url || '',
    note_uid: noteVisible ? c.note_uid : null,
    note_id: noteVisible ? note.id : null,
    note_origin: noteVisible ? noteOriginFor(c.note_uid, ens.uid) : null,
    note_available: !!noteVisible,
    history: componentHistory(c.uid),
  };
}

function ensembleView(e, me) {
  const arts = ensArtifacts(e.id).map((a) => ({
    artifact_uid: a.uid, image: `/i/${a.image_uid}`,
    is_primary: a.uid === e.primary_artifact_uid,
    lineage: JSON.parse(a.lineage || '[]'), created_at: a.created_at }));
  return {
    type: 'ensemble', uid: e.uid, id: e.id, title: e.title, description: e.description,
    private: !!e.private, status: e.status || 'saved', created_at: e.created_at, updated_at: e.updated_at || null,
    primary_artifact_uid: e.primary_artifact_uid || null,
    artifacts: arts,
    components: ensComponents(e.id).map((c) => componentView(c, e, me)),
    provenance: provenanceOf('ensemble', e.uid),
  };
}

// The lineage snapshot: what participated AT GENERATION TIME. Written once,
// never rewritten — an artifact made while a chair was unidentified must still
// say so after the chair is identified.
const lineageOf = (ensembleId) => JSON.stringify(ensComponents(ensembleId).map((c) => ({
  component_uid: c.uid, state_at_generation: c.state,
  note_uid_at_generation: c.note_uid || null, label_at_generation: c.label || '',
  image_uid_at_generation: c.image_uid || null, position_at_generation: c.position })));

// Identity threshold for materialising a Note, judged by EVIDENCE CLASS and
// never by confidence. A 99%-certain visual guess is still inference and does
// not qualify; a maker/model the member supplied does.
const QUALIFYING_BASIS = new Set(['user_identity', 'maker_model', 'product_page', 'external_id', 'resolved_note']);
const componentQualifies = (c) => QUALIFYING_BASIS.has(c.identity_basis || '');

// The identity evidence a component was staged with. Recorded as provenance at
// staging time so Keep can apply the same evidence-class rule later without the
// model having to restate it — the decision must not depend on conversation.
function componentIdentityBasis(componentUid) {
  const r = q(`SELECT source_kind FROM provenance WHERE entity_type='ensemble_component'
    AND entity_uid=? AND action='created' ORDER BY id LIMIT 1`).get(componentUid);
  return r ? r.source_kind || '' : '';
}

// Reuse before creation, canonical evidence only. derived_relations is never
// consulted here: an inference must not silently become a canonical link.
function findExistingNote(userId, c) {
  if (c.note_uid) {
    const n = q('SELECT * FROM objects WHERE uid=? AND user_id=?').get(c.note_uid, userId);
    if (n) return n;
  }
  if (c.source_url) {
    const n = q('SELECT * FROM objects WHERE user_id=? AND url=? AND url<>\'\' ORDER BY id LIMIT 1').get(userId, c.source_url);
    if (n) return n;
  }
  if (c.label) {
    const n = q('SELECT * FROM objects WHERE user_id=? AND lower(name)=lower(?) ORDER BY id LIMIT 1').get(userId, c.label);
    if (n) return n;
  }
  return null;
}
// ---- asset ingestion (v1.20) --------------------------------------------
// A chat model cannot hand us image BYTES. Two independent reasons, either
// fatal on its own:
//   1. It does not have them. An attached photo reaches the model as vision
//      tokens; a picture it generated reaches it as an asset reference. In
//      neither case can it read the bytes back out.
//   2. Even if it could, it would have to EMIT them as output tokens. A 500 KB
//      photo is ~667,000 base64 characters — roughly 167,000 tokens, against a
//      per-turn output budget of a few thousand.
// So a data:-only contract is not a strict contract, it is an unbuildable one.
// We therefore accept what a client can actually supply — chiefly a URL we
// fetch ourselves — and normalise everything to one stored image.
const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i;

async function fetchImageAsDataUrl(rawUrl, what) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error(`${what}: "${String(rawUrl).slice(0, 60)}" is not a valid URL.`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`${what}: only http(s) image URLs can be fetched.`);
  // never let a supplied URL probe our own private network
  if (PRIVATE_HOST.test(u.hostname)) throw new Error(`${what}: that host is not reachable.`);
  let r;
  try {
    r = await fetch(u.href, { redirect: 'follow', signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'discriminantly/1.0 (+https://discriminantly.com)', Accept: 'image/*' } });
  } catch (e) {
    throw new Error(`${what}: could not fetch that image (${e.name === 'TimeoutError' ? 'timed out' : 'network error'}). `
      + `If the link is short-lived or needs a login, it cannot be read from here.`);
  }
  if (!r.ok) throw new Error(`${what}: the image URL returned HTTP ${r.status}.`);
  const mime = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_MIME_ALLOW.has(mime)) throw new Error(`${what}: that URL returned "${mime || 'no content type'}", not an image.`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error(`${what}: the image URL returned no data.`);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Validate an image_uid the caller already holds — from upload_image, or from
// a previous Ensemble read. This is the preferred path: the bytes are already
// stored, so nothing is fetched, decoded, optimised or duplicated. Ownership is
// checked against the acting member, not merely existence, so one member cannot
// mount another member's asset into their own Ensemble by guessing a uid.
function resolveOwnedImageUid(userId, uid, what) {
  const row = q('SELECT uid, user_id, length(bytes) n, mime FROM images WHERE uid=?').get(String(uid).trim());
  if (!row) throw new Error(`${what}: no stored image with uid "${String(uid).slice(0, 40)}". `
    + `Use the uid returned by upload_image, or pass an https:// URL instead.`);
  if (row.user_id !== userId) throw new Error(`${what}: that image belongs to a different member.`);
  if (!row.n) throw new Error(`${what}: that stored image is empty.`);
  if (!row.mime || !IMAGE_MIME_ALLOW.has(row.mime)) throw new Error(`${what}: that stored image is not a usable image type.`);
  return row.uid;
}

// Resolve one asset slot to a confirmed stored uid. image_uid wins when both
// are given: re-ingesting bytes we already hold would duplicate the BLOB for
// no gain, and the uid is the cheaper, more certain reference.
async function resolveAssetRef(userId, ref, ctx, source, what) {
  const uid = (ref && typeof ref.image_uid === 'string') ? ref.image_uid.trim() : '';
  if (uid) return resolveOwnedImageUid(userId, uid, what);
  const inline = (ref && typeof ref.image === 'string') ? ref.image.trim() : '';
  if (inline) return await ingestImage(userId, inline, ctx, source, what);
  return null;
}

// What actually arrived? When an inline data: URL is refused we can say a great
// deal about HOW it was damaged, which distinguishes "the runtime cut the
// argument short" from "the client built the base64 wrong". Cheap, and it is
// the only forensic record we get of a transport failure.
function diagnoseDataUrl(v) {
  const d = { prefix_intact: false, declared_mime: null, b64_chars: 0, quad_remainder: null,
    padded: false, decodable: false, decoded_bytes: 0, ends_with_eoi: null };
  const m = /^data:([\w/+.-]+);base64,([\s\S]*)$/i.exec(String(v || '').trim());
  if (!m) return d;
  d.prefix_intact = true; d.declared_mime = m[1].toLowerCase();
  const b64 = m[2];
  d.b64_chars = b64.length;
  d.quad_remainder = b64.length % 4;          // non-zero == cut mid-quad, i.e. hard truncation
  d.padded = b64.endsWith('=');
  try {
    const buf = Buffer.from(b64, 'base64');
    d.decodable = true; d.decoded_bytes = buf.length;
    if (d.declared_mime === 'image/jpeg') d.ends_with_eoi = buf.length >= 2 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  } catch { /* leave decodable false */ }
  return d;
}
// One line, no image data, so a transport failure is diagnosable after the fact.
function logDataUrlFailure(what, v) {
  const d = diagnoseDataUrl(v);
  console.log(`[image-reject] ${what} prefix=${d.prefix_intact} mime=${d.declared_mime} `
    + `b64_chars=${d.b64_chars} quad_remainder=${d.quad_remainder} padded=${d.padded} `
    + `decoded_bytes=${d.decoded_bytes} eoi=${d.ends_with_eoi}`);
  return d;
}

// Undo an ingest whose post-insert verification failed. Format, size and
// completeness are all checked BEFORE the row is written, so nothing malformed
// ever reaches this point — but the verification that runs AFTER the insert
// (ownership, byte-count fidelity, read-back) can still fail, and at that point
// the row is already committed. Throwing alone would leave an orphan and make
// the "nothing was saved" in the error a lie. Delete the row and its
// provenance so the failure is literally true.
function discardStoredImage(uid) {
  if (!uid) return;
  try {
    q("DELETE FROM provenance WHERE entity_type='image' AND entity_uid=?").run(uid);
    q('DELETE FROM images WHERE uid=?').run(uid);
  } catch { /* best effort: the caller is already failing the request */ }
}

// Prove an ingested image is durably stored, entirely server-side. A caller
// must never have to GET a private image URL to find out whether an upload
// worked — that request is unauthenticated from a model's environment and will
// correctly 404, which says nothing about storage. Every check here reads back
// what was actually persisted.
function verifyStoredImage(userId, uid, expectedBytes) {
  const row = q('SELECT id, uid, user_id, mime, length(bytes) n, width, height FROM images WHERE uid=?').get(uid);
  const problems = [];
  if (!row) problems.push('no image row for that uid');
  else {
    if (row.user_id !== userId) problems.push('stored under a different member');
    if (!row.n) problems.push('stored zero bytes');
    if (!row.mime || !IMAGE_MIME_ALLOW.has(row.mime)) problems.push('stored without a usable image type');
    if (expectedBytes != null && row.n !== expectedBytes) problems.push(`stored ${row.n} bytes, expected ${expectedBytes}`);
    // read the bytes back rather than trusting the length column
    const back = q('SELECT bytes FROM images WHERE uid=?').get(uid);
    if (!back || !back.bytes || !back.bytes.length) problems.push('bytes could not be read back');
  }
  return { verified: problems.length === 0, problems,
    row: row || null };
}

// One entry point. Takes whatever representation the caller could supply and
// returns a CONFIRMED stored image uid — confirmed meaning the row exists, the
// bytes are non-empty, and the owner can retrieve it through the normal path.
async function ingestImage(userId, input, ctx, source, what) {
  const v = typeof input === 'string' ? input.trim() : '';
  if (!v) return null;
  const dataUrl = /^data:image\//i.test(v) ? v
    : /^https?:\/\//i.test(v) ? await fetchImageAsDataUrl(v, what)
    : (() => { throw new Error(`${what}: expected an https:// image URL or a data: URL, got "${v.slice(0, 48)}".`); })();
  const uid = storeImageStrict(userId, dataUrl, ctx, source, what);
  // prove it, rather than trusting the insert
  const row = q('SELECT length(bytes) n, mime FROM images WHERE uid=?').get(uid);
  if (!row || !row.n || !row.mime) {
    discardStoredImage(uid);
    throw new Error(`${what}: stored but not retrievable afterwards; nothing was saved.`);
  }
  return uid;
}

// storeImage() is lenient by design: it passes non-data: values straight
// through (so a note can hold an external URL) and returns '' when bytes fail
// validation. Ensemble needs the opposite — an artifact or component image MUST
// end up as stored bytes we own, or the caller has to be told plainly. Doing
// `.split('/').pop()` on a lenient return produced two real bugs: an https URL
// became an image_uid of "chair.jpg", and an oversized image vanished while the
// save still reported success.
function storeImageStrict(userId, value, ctx, source, what) {
  const cap = source === 'generated' ? MAX_GENERATED_BYTES : MAX_IMAGE_BYTES;
  const v = (value || '').trim();
  if (!v) return null;
  if (!/^data:image\//i.test(v)) {
    throw new Error(`${what} must be sent as a data: URL containing the image itself, not a link `
      + `(got "${v.slice(0, 48)}..."). Fetch or generate the image and pass its bytes.`);
  }
  const ref = storeImage(userId, v, ctx, source);
  const uid = ref && ref.startsWith('/i/') ? ref.slice(3) : '';
  if (!uid) {
    // Record HOW an inline payload was damaged before refusing it. quad_remainder
    // is the discriminating signal: a non-zero value means the base64 was cut
    // mid-quad, which a client that built the string itself would never produce
    // — that is runtime truncation. Zero, with a missing EOI, points instead at
    // the client sending an already-incomplete file.
    if (/^data:image\//i.test(v)) logDataUrlFailure(what, v);
    throw new Error(`${what} could not be stored. It must be a COMPLETE PNG, JPEG, WEBP or GIF whose declared `
      + `type matches its actual bytes (limit ${Math.round(cap / (1024 * 1024))} MB). A common cause is an inline `
      + `data: URL cut short before it reached us — if so, prepare the image smaller (around 1536 px on the long `
      + `edge, roughly 300 KB) and send it again, or pass an https:// URL instead. Nothing was saved.`);
  }
  return uid;
}

// Cheap integrity check run inside the save transaction. Every uid the new
// records point at must resolve to a real row with non-empty bytes; if one
// does not, the whole save is rolled back rather than reported as complete.
// This is deliberately a few indexed lookups, not a re-read of the blobs.
function verifyEnsembleAssets(ens, saved) {
  const bad = [];
  const ck = (uid, what) => {
    if (!uid) return;
    const r = q('SELECT length(bytes) n, mime FROM images WHERE uid=?').get(uid);
    if (!r) bad.push(`${what}: image ${uid} was not stored`);
    else if (!r.n) bad.push(`${what}: image ${uid} stored zero bytes`);
    else if (!r.mime) bad.push(`${what}: image ${uid} has no content type`);
  };
  for (const c of q('SELECT label, image_uid, note_uid FROM ensemble_components WHERE ensemble_id=?').all(ens.id)) {
    ck(c.image_uid, `component "${c.label}"`);
    if (c.note_uid) {
      const n = q('SELECT name, image FROM objects WHERE uid=?').get(c.note_uid);
      if (!n) bad.push(`component "${c.label}": linked note ${c.note_uid} is missing`);
      // A Note created by this save was given the component's image, so an
      // empty or unresolvable value there is a propagation bug, not a
      // legitimately image-less note.
      else if (saved.notes_created.includes(c.note_uid)) {
        if (!n.image) bad.push(`note "${n.name}": created from a component that supplied an image, but has none`);
        else if (n.image.startsWith('/i/')) ck(n.image.slice(3), `note "${n.name}"`);
      }
    }
  }
  for (const a of q('SELECT uid, image_uid FROM ensemble_artifacts WHERE ensemble_id=?').all(ens.id)) {
    ck(a.image_uid, 'generated composition');
  }
  if (bad.length) throw new Error('The ensemble was not saved because some images did not persist: ' + bad.join('; '));
}

// Discard: the member looked at the saved composition and did not want it.
// This unwinds the save, including the Notes it created — but ONLY those, and
// only while they are still nothing more than a by-product of this Ensemble.
// A Note that has since taken on a life of its own is kept, because destroying
// it would delete something the member did, not something we did for them.
function notesSafeToDiscard(ens) {
  const created = q(`SELECT o.id, o.uid, o.name FROM objects o
    JOIN provenance p ON p.entity_uid = o.uid
    WHERE p.entity_type='object' AND p.action='created'
      AND p.source_kind='ensemble' AND p.source_ref=? AND o.user_id=?`).all(ens.uid, ens.user_id);
  const keep = [], drop = [];
  for (const n of created) {
    const reasons = [];
    if (q('SELECT 1 FROM ownership_assertions WHERE note_uid=?').get(n.uid)) reasons.push('marked owned');
    if (q('SELECT 1 FROM warrants WHERE subject_uid=?').get(n.uid)) reasons.push('warranted');
    if (q('SELECT 1 FROM note_collections WHERE note_id=?').get(n.id)) reasons.push('filed in a collection');
    if (q('SELECT 1 FROM objects WHERE renoted_from_uid=?').get(n.uid)) reasons.push('adopted by someone else');
    if (q('SELECT 1 FROM ensemble_components WHERE note_uid=? AND ensemble_id<>?').get(n.uid, ens.id)) reasons.push('used in another ensemble');
    if (q(`SELECT 1 FROM provenance WHERE entity_type='object' AND entity_uid=? AND action='edited'`).get(n.uid)) reasons.push('edited since');
    if (reasons.length) keep.push({ ...n, reasons }); else drop.push(n);
  }
  return { keep, drop };
}

// The compound save. Saving a durable composition is itself the evidence that
// its identifiable constituents are worth recording — so qualifying ones
// become Notes here, without a separate confirmation. Everything it did is
// reported back so the AI can say truthfully what happened.
function saveEnsembleComponents(ens, user, components, ctx, materialiseNotes) {
  const out = { components: [], notes_created: [], notes_reused: [], unresolved: [] };
  // Every constituent must be visually represented — the pieces are what the
  // composition is made of, and an Ensemble page listing bare labels is not
  // the record the member saved. The one exception is a piece already in their
  // notes: that note carries the picture, so asking for it twice is pointless.
  // Checked for all components before anything is written, so the error names
  // the offending piece rather than failing halfway through.
  for (const raw of (components || [])) {
    if (raw.__uid) continue;
    const nu = (raw.note_uid || '').trim();
    const linked = nu ? q('SELECT image FROM objects WHERE uid=? AND user_id=?').get(nu, user.id) : null;
    if (linked && linked.image) continue;
    throw new Error(`The component "${raw.label || '(unlabelled)'}" needs an image: pass its own picture as a `
      + `data: URL, or set note_uid to one of the member's existing notes that already has one. Nothing was saved.`);
  }
  let pos = 0;
  for (const raw of (components || [])) {
    const c = {
      label: (raw.label || '').trim(),
      source_url: (raw.source_url || '').trim(),
      note_uid: (raw.note_uid || '').trim() || null,
      identity_basis: raw.identity_basis || '',
      image: raw.image || '',
    };
    let noteUid = null, origin = null;

    // Store the supplied image ONCE, before any branch decides what to do with
    // it, and share that one asset between the component and any Note made
    // from it. Previously each branch stored its own copy and the qualifying
    // branch attached the image to the Note ONLY, leaving the component with
    // image_uid = NULL — so on a public Ensemble that constituent rendered
    // with no picture for anyone but the owner, because the only record
    // holding the image was the deliberately-private auto-created Note.
    // One row, two references: identical bytes, and the component carries the
    // Ensemble's own durable representation as the architecture requires.
    // Already ingested and confirmed before the transaction opened — a network
    // fetch must never run while a write transaction is held open.
    const imgUid = raw.__uid || null;
    const imgRef = imgUid ? `/i/${imgUid}` : '';

    // 1. an existing Note the member already has — reuse, never duplicate
    const existing = findExistingNote(user.id, c);
    if (existing) { noteUid = existing.uid; origin = 'pre_existing'; out.notes_reused.push(existing.uid); }

    // 2. otherwise materialise — but ONLY at the commitment moment. Staging a
    // composition for review is not yet the member saying it is worth keeping,
    // so a pending Ensemble records the identity evidence and leaves the
    // catalogue untouched until Keep.
    else if (materialiseNotes && componentQualifies(c) && c.label) {
      // Auto-created Notes are PRIVATE by default. Publishing a composition is
      // not an act of publishing every personal record behind it, so the
      // Ensemble's own privacy is deliberately not inherited here.
      const r = q(`INSERT INTO objects(user_id,name,why,tags,url,image,private)
        VALUES(?,?,'','',?,?,1)`).run(user.id, c.label, c.source_url, imgRef);
      noteUid = uidOf('objects', r.lastInsertRowid);
      recordProvenance('object', noteUid, 'created', ctx,
        { source_kind: 'ensemble', source_ref: ens.uid, fields: c.identity_basis });
      out.notes_created.push(noteUid);
      origin = 'created_by_ensemble';
    }

    const state = noteUid ? 'linked' : 'unresolved';
    const cr = q(`INSERT INTO ensemble_components(ensemble_id,position,state,note_uid,image_uid,label,source_url)
      VALUES(?,?,?,?,?,?,?)`).run(ens.id, pos++, state, noteUid, imgUid, c.label, c.source_url);
    const cuid = uidOf('ensemble_components', cr.lastInsertRowid);
    // Record the evidence class the member/AI actually supplied, whatever the
    // current state is — Keep re-reads this to decide what qualifies, so it
    // must survive the staging step rather than being flattened to
    // 'unidentified' just because no Note exists yet.
    recordProvenance('ensemble_component', cuid, 'created', ctx,
      { source_kind: c.identity_basis || 'unidentified', source_ref: noteUid || null });
    out.components.push({ component_uid: cuid, state, note_uid: noteUid, note_origin: origin,
      label: c.label, image_uid: imgUid || null });
    if (state === 'unresolved') out.unresolved.push(cuid);
  }
  return out;
}
const OBJ_SQL = 'SELECT o.*, u.handle, u.name uname, u.avatar FROM objects o JOIN users u ON u.id=o.user_id';

// The Warrant seal. Rendered from state alone — never from `published`, which
// is social metadata about the announcement, not part of what a warrant means.
// A public subject's warrant is visible to everyone; a private subject's is
// visible only to its owner, because the subject itself already is.
function warrantSealSvg() {
  return `<svg viewBox="0 0 34 52" width="34" height="52" role="img" focusable="false">
      <rect class="wsl-ribbon" x="9" y="0" width="16" height="30"/>
      <g transform="translate(0,18) scale(0.265625)">
        <circle cx="64" cy="64" r="60" fill="#FFC400"/>
        <g fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M64 20 C57 20 52 25 52 31 C52 37 57 41 60 45 C55 42 50 38 48 33 C46 38 47 44 52 48 C48 47 44 45 41 42 C42 50 47 55 53 59 C57 62 60 67 61 73 L64 86 L67 73 C68 67 71 62 75 59 C81 55 86 50 87 42 C84 45 80 47 76 48 C81 44 82 38 80 33 C78 38 73 42 68 45 C71 41 76 37 76 31 C76 25 71 20 64 20 Z"/>
          <path d="M34 41 C26 41 21 46 21 53 C21 59 25 63 31 66 C27 66 23 65 20 62 C21 68 25 73 31 76 C36 79 42 83 46 89 L52 96 L55 91 C52 80 47 69 42 61 C39 56 37 49 34 41 Z"/>
          <path d="M94 41 C102 41 107 46 107 53 C107 59 103 63 97 66 C101 66 105 65 108 62 C107 68 103 73 97 76 C92 79 86 83 82 89 L76 96 L73 91 C76 80 81 69 86 61 C89 56 91 49 94 41 Z"/>
          <path d="M64 27 L64 80"/>
          <path d="M60 40 C57 43 55 46 53 49"/>
          <path d="M68 40 C71 43 73 46 75 49"/>
          <path d="M39 50 C38 57 41 66 47 77"/>
          <path d="M89 50 C90 57 87 66 81 77"/>
          <path d="M47 92 C43 91 40 89 37 86 C36 91 39 95 44 99 C48 102 52 103 56 101"/>
          <path d="M81 92 C85 91 88 89 91 86 C92 91 89 95 84 99 C80 102 76 103 72 101"/>
          <rect x="49" y="89" width="30" height="6.5" rx="3.25"/>
          <rect x="49" y="96.5" width="30" height="6.5" rx="3.25"/>
        </g>
      </g>
    </svg>`;
}
function warrantSeal(row, subjectType, me) {
  const w = warrantState(row.user_id, subjectType, row.uid);
  if (w.state !== 'active') return '';
  if (row.private && (!me || me.id !== row.user_id)) return '';
  return `<span class="warrant-seal" title="Warranted" aria-label="Warranted">${warrantSealSvg()}</span>`;
}

function objectCard(o, me, full = false) {
  // Canonical duplicate awareness: do I already hold an active Note adopted
  // from this one? Read from my own Notes — never by dereferencing the source.
  const adopted = me ? q('SELECT id, uid FROM objects WHERE user_id=? AND renoted_from_uid=? ORDER BY id').all(me.id, o.uid) : [];
  const noted = adopted.length > 0;
  const tags = tagList(o.tags);
  const shortUrl = o.url ? (o.url.length > 34 ? o.url.slice(0, 34) + '…' : o.url) : '';
  // Computed inside the owned-row block below, which already runs only for the
  // owner; the article reads it after the template literal is evaluated, so it
  // is resolved here first rather than inside the string.
  let patinaTier = 0;
  if (me && o.user_id === me.id) {
    const ow = ownedState(me.id, o.id);
    if (ow.state === 'owned') patinaTier = ownedPatinaTier(ow.since);
  }
  return `<article class="note ${full ? 'note-full' : ''} ${o.image ? 'has-image' : ''}" data-private="${o.private ? 1 : 0}"${patinaTier ? ` data-patina="${patinaTier}"` + patinaOffset('note', o.id) : ''}>
  <div class="byline"><span class="byline-who"><a href="/u/${esc(o.handle)}">${avatar({ name: o.uname, handle: o.handle, avatar: o.avatar })}</a>${stackDate(o.created_at)}</span>${me && me.id === o.user_id ? `<a class="card-edit" href="/o/${o.id}/edit">Edit</a>` : ''}</div>
  <div class="card">
    ${warrantSeal(o, 'object', me)}
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
      ${(() => {
        // Build the contents first, and emit the .noteit box ONLY if there are
        // any. The box carries its own background, border and padding, so
        // rendering it empty — which is what happens on your own Note — leaves
        // a vestigial grey rectangle where the button used to be. When a button
        // IS present the markup and token are exactly as before.
        const inner = (() => {
          if (!me) return `<a class="btn-note" href="/login">Note this</a>`;
          if (o.user_id === me.id) return '';                       // your own Note
          // Duplicate awareness, never duplicate prevention: if they already
          // hold an adoption of this Note we say so and offer both paths, but
          // "Note this again" always works.
          const again = adopted.length
            ? `<p class="note-dupe">You’ve re-noted this before. <a href="/o/${adopted[0].id}">View your Note</a></p>` : '';
          return `${again}<form method="post" action="/o/${o.id}/note"><button class="btn-note">${adopted.length ? 'Note this again' : 'Note this'}</button></form>`;
        })();
        return inner ? `<div class="noteit">${inner}</div>` : '';
      })()}
    </div>
    ${o.image ? `<a class="figure" href="/o/${o.id}"><img src="${esc(o.image)}" alt="${esc(o.name)}"></a>` : ''}
    ${(() => {
      // Owned is private evidence: rendered only for the member themselves,
      // and only where they actually have a relationship to the object.
      // A viewer looking at someone else's note gets nothing at all here —
      // not a disabled control, not an empty element.
      // It is a sibling of .text and .figure, not a child of .text, so it can
      // span the full card width and sit below the image.
      if (!me) return '';
      if (o.user_id !== me.id) return '';
      const own = ownedState(me.id, o.id);
      const on = own.state === 'owned';
      // The exact .switch token used by the "Private?" toggle on the post form.
      return `<div class="owned-row">
        <span class="nf-lbl owned-label">Owned</span>
        <label class="switch" data-owned="/o/${o.id}/owned" data-on="${on ? '1' : '0'}" data-title="${esc(o.name)}">
          <input type="checkbox" ${on ? 'checked' : ''} aria-label="Owned"><span></span></label>
      </div>`;
    })()}
  </div></article>`;
}



function field(name, label, value = '', type = 'text', extra = '') {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function select(name, label, opts, value = '') {
  return `<label>${label}<select name="${name}"><option value="">—</option>${opts.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
}

// ---------- pages ----------
// Renders the days and stops of an itinerary: the day containers, the timeline,
// the mark cards and intention cards. Used by the article page in full and by
// the listing truncated -- the listing shows THIS rendering cut off, not a
// re-telling of it as a list. `limit` stops after that many stops and drops
// the add-controls; `interactive` false drops every owner control.
// The plan read top to bottom: every sequenced stop, day after day, then the
// unplaced ones. The number a reader sees comes from here and nowhere else,
// so the timeline and the map's pins always carry the same figure.
function itineraryNumbers(it) {
  const n = new Map();
  let i = 0;
  for (const g of groupOrder(it.id)) {
    for (const st of itineraryStops(it.id, g.id)) if (st.position !== null) n.set(st.uid, ++i);
  }
  for (const st of itineraryStops(it.id, null)) if (st.position !== null) n.set(st.uid, ++i);
  return n;
}

function itineraryBody(it, me, { interactive = true, limit = Infinity } = {}) {
  // `owner` governs what is VISIBLE (canSeeStop); `ctl` governs whether the
  // owner's controls render. A preview is the owner's own view minus controls.
  const isOwner = !!(me && (me.id === it.user_id || me.is_admin));
  const owner = isOwner;
  const ctl = interactive && isOwner;
  const groups = groupOrder(it.id);
  const base = `/t/${it.id}`;
  const tf = (row) => temporalFormat(temporalOf(row));
  const numbers = itineraryNumbers(it);
  let budget = limit;
  const take = (stops) => { const out = []; for (const st of stops) { if (budget <= 0) break; out.push(st); budget--; } return out; };

    // Marks from the member's own catalogue in this itinerary's region, not
    // already in the plan. Shown only when the region is actually known.
    const nearby = ctl ? itineraryNearbyMarks(it, me, 8) : [];

    // ---- one stop --------------------------------------------------------
    // Three surfaces by resolution: a resolved Mark is the familiar mark card
    // (glass); an unresolved or experiential stop is the flat visit-log tint;
    // open time is bare italic on the spine. Less resolved means less
    // material, never a warning colour. The stop's own ``·``·`` menu carries the
    // itinerary-specific actions so the mark card's own actions (Directions,
    // Check in) stay exactly what they are everywhere else.
    const stopRow = (st, inGroup) => {
      const vis = canSeeStop(st, it, me);
      if (!vis.see) return '';
      const when = tf(st);
      const withheld = owner && st.visibility === 'suspended';
      const seqd = st.position !== null;
      const dayOpts = groups.map((g) => `<option value="${g.uid}" ${g.id === st.group_id ? 'selected' : ''}>${esc(g.label || tf(g) || 'A day')}</option>`).join('');
      const menu = ctl ? `<details class="stop-menu"><summary aria-label="Stop actions">\u00b7\u00b7\u00b7</summary>
        <div class="stop-sheet">
          <form method="post" action="${base}/stops/${st.uid}" class="nf nf-compact stop-form"><div class="nf-box"><div class="nf-stack">
            <input type="hidden" name="mark_uid" value="">
            <input class="nf-field stop-add-label" name="label" value="${esc(st.label)}" placeholder="WORDING \u2014 OR LOOK UP A TRAVEL MARK" maxlength="200" autocomplete="off" data-lookup>
            ${st.mark_uid ? '' : `<select class="nf-field" name="resolution">
              <option value="particular" ${st.resolution === 'particular' ? 'selected' : ''}>A PARTICULAR PLACE</option>
              <option value="experiential" ${st.resolution === 'experiential' ? 'selected' : ''}>AN INTENTION</option>
              <option value="allocation" ${st.resolution === 'allocation' ? 'selected' : ''}>OPEN TIME</option></select>`}
            <select class="nf-field" name="t_daypart"><option value="">TIME OF DAY</option>${['morning', 'afternoon', 'evening', 'night'].map((d) => `<option ${st.t_daypart === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
            <input class="nf-field" name="t_clock" value="${esc(st.t_clock || '')}" placeholder="CLOCK, E.G. 19:30" pattern="([01]\\d|2[0-3]):[0-5]\\d">
            <select class="nf-field" name="group_uid"><option value="">NOT ON A DAY</option>${dayOpts}</select>
            </div>
          <!-- The same one-field lookup the add card uses: typing searches the
               member's own marks, and choosing one resolves this stop to it. -->
          <div class="mark-picks" hidden></div>
          <div class="mark-chosen" hidden><span class="mark-chosen-name"></span><button type="button" class="link caps" data-unpick>Not this</button></div>
          ${!st.mark_uid && nearby.length ? `<div class="mark-gallery">
            <span class="mark-gallery-h">Already in your catalogue</span>
            <div class="mark-gallery-row">${nearby.map((mk) => `<button type="button" class="mark-chip" data-uid="${esc(mk.uid)}" data-name="${esc(mk.name)}">
              <span class="mark-chip-name">${esc(mk.name)}</span><span class="mark-chip-where">${esc([mk.locality, mk.country].filter(Boolean).join(', '))}</span></button>`).join('')}</div>
          </div>` : ''}
            <button class="nf-post">Save</button>
            <div class="nf-foot nf-foot-3">
              <button type="button" class="nf-link-btn nf-del" data-del="${base}/stops/${st.uid}/delete" data-kind="stop" data-title="${esc(st.label || 'this stop')}">Delete</button>
              <span></span>
              <button type="button" class="nf-link-btn" data-stop-cancel>Cancel</button>
            </div>
          </div></form>
          <div class="stop-links">
            ${seqd ? `<form method="post" action="${base}/stops/${st.uid}"><input type="hidden" name="position" value=""><button class="link caps">Take out of the order</button></form>` : ''}
            ${st.mark_uid ? `<form method="post" action="${base}/stops/${st.uid}"><input type="hidden" name="unlink" value="1"><button class="link caps">Unlink the mark</button></form>` : ''}
            <form method="post" action="${base}/stops/${st.uid}/${withheld ? 'restore' : 'suspend'}"><button class="link caps">${withheld ? 'Show publicly again' : 'Withhold from public view'}</button></form>
            <form method="post" action="${base}/stops/${st.uid}/delete" onsubmit="return confirm('Remove this stop from the itinerary? The travel mark, if any, is untouched.')"><button class="link caps stop-del">Remove</button></form>
          </div>
        </div></details>` : '';
      // Title case, italic: it reads as a note about the stop rather than a label
      const titleCase = (t) => t.replace(/\b([a-z])/g, (m2) => m2.toUpperCase());
      // The number is the stop's place in the authored order, and it is the same
      // number the map's pin carries, so the two can be read together.
      const num = numbers.has(st.uid) ? `<span class="stop-no">${numbers.get(st.uid)}.</span>` : '';
      const time = (num || when) ? `<span class="stop-when">${num}${when ? esc(titleCase(when)) : ''}</span>` : '';
      const flag = withheld ? '<span class="stop-withheld">Withheld from public view</span>' : '';
      // Dragging asserts order; the arrows do the same thing for anyone who
      // would rather not drag. Both write a position through the same route.
      const handle = ctl ? `<span class="stop-move">
        <button type="button" class="stop-arrow" data-move="up" title="Move up" aria-label="Move up">\u2191</button>
        <span class="stop-handle" data-drag title="Drag to place in the order">\u2261</span>
        <button type="button" class="stop-arrow" data-move="down" title="Move down" aria-label="Move down">\u2193</button>
      </span>` : '';
      const attrs = `id="stop-${st.uid}" class="stop ${seqd ? 'is-seq' : ''} ${st.resolution === 'linked' ? 'is-mark' : st.resolution === 'allocation' ? 'is-open' : 'is-loose'} ${withheld ? 'is-withheld' : ''}" data-stop="${st.uid}"`;

      if (vis.mark) {
        return `<li ${attrs}>${handle}<div class="stop-head">${time}${flag}${menu}</div>${markCard(vis.mark, me)}</li>`;
      }
      if (st.resolution === 'allocation') {
        return `<li ${attrs}>${handle}<div class="stop-open"><span class="stop-label">${esc(st.label || 'Open')}</span>${time}${flag}${menu}</div></li>`;
      }
      // particular / experiential / dangling mark: a card of the same material
      // as the mark card, with an eyebrow in the same register as "MARKED", so
      // an intention is a peer of a resolved place rather than a lesser one.
      // Less resolved means less detail on the card, never less presence.
      const eb = vis.dangling ? 'Once marked' : st.resolution === 'particular' ? 'Somewhere particular' : 'Intended';
      return `<li ${attrs}><div class="stop-head">${time}${flag}${menu}</div>${handle}
        <div class="card stop-card ${st.resolution === 'particular' ? 'is-unres' : ''}">
          <span class="stop-eb">${eb}</span>
          <span class="stop-label">${esc(st.label || 'Unnamed stop')}</span>
          ${vis.dangling ? '<span class="stop-from">The travel mark this pointed at no longer exists</span>' : ''}
          ${st.resolution === 'particular' && ctl ? '<span class="stop-note">A place to identify \u2014 your AI can help find it</span>' : ''}
        </div></li>`;
    };

    // The spine is drawn over the authored prefix and stops there: a stop with
    // no position has not been placed, and a line through it would assert an
    // order the member never made.
    const list = (stops, groupUid) => {
      stops = take(stops);
      const rows = stops.map((st) => stopRow(st, !!groupUid)).filter(Boolean);
      const seq = stops.filter((st) => st.position !== null).length;
      // Progressive disclosure: one quiet button in the post-box register
      // opens the fields. The fields share one height and the Add button sits
      // on the same line at that height, so the row reads as one control.
      const add = ctl ? `<li class="stop-add"><details class="stop-add-disc">
        <summary class="post-box stop-add-open"><img class="plus" src="/plus.png" alt="" width="68" height="68"><span>Add stop or day</span></summary>
        <div class="seg itin-seg" role="tablist">
          <button type="button" class="seg-btn on" data-itin-seg="stop" role="tab" aria-selected="true">New stop</button>
          <button type="button" class="seg-btn" data-itin-seg="day" role="tab" aria-selected="false">Add day</button>
        </div>
        <div class="itin-seg-panels">
        <div class="itin-seg-panel is-on" data-kind="stop">
        <form method="post" action="${base}/stops" class="nf nf-compact stop-add-form">
          <div class="nf-box"><div class="nf-stack">
            <input type="hidden" name="group_uid" value="${groupUid || ''}">
            <input type="hidden" name="mark_uid" value="">
            <input class="nf-field stop-add-label" name="label" placeholder="${groupUid ? 'WHAT, OR WHERE (REQUIRED)' : 'SOMEWHERE, OR SOMETHING, YOU MEAN TO DO'}" required maxlength="200" autocomplete="off" data-lookup>
            <select class="nf-field stop-add-kind" name="resolution" aria-label="Kind"><option value="experiential">AN INTENTION</option><option value="particular">A PARTICULAR PLACE</option><option value="allocation">OPEN TIME</option></select>
          </div>
          <!-- One field. What the member types is the intention; anything in
               their own catalogue that matches appears here, and choosing one
               links that mark instead. Typing past the matches simply leaves
               the prose standing, which is a legitimate stop. -->
          <div class="mark-picks" hidden></div>
          <div class="mark-chosen" hidden><span class="mark-chosen-name"></span><button type="button" class="link caps" data-unpick>Not this</button></div>
          ${nearby.length ? `<div class="mark-gallery">
            <span class="mark-gallery-h">Already in your catalogue</span>
            <div class="mark-gallery-row">${nearby.map((mk) => `<button type="button" class="mark-chip" data-uid="${esc(mk.uid)}" data-name="${esc(mk.name)}">
              <span class="mark-chip-name">${esc(mk.name)}</span><span class="mark-chip-where">${esc([mk.locality, mk.country].filter(Boolean).join(', '))}</span></button>`).join('')}</div>
          </div>` : ''}
          <button class="nf-post stop-add-btn">Add stop</button>
          <div class="nf-foot"><span></span><button type="button" class="nf-link-btn" data-add-cancel>Cancel</button></div>
          </div></form></div>
        <div class="itin-seg-panel" data-kind="day">
          <form method="post" action="${base}/groups" class="nf nf-compact day-form"><div class="nf-box"><div class="nf-stack">
            <input class="nf-field" name="label" placeholder="LABEL \u2014 DAY ${groups.length + 1}, FRIDAY\u2026" maxlength="60">
            <select class="nf-field" name="t_month"><option value="">MONTH</option>${T_MONTHS.map((m2, i) => `<option value="${i + 1}">${m2}</option>`).join('')}</select>
            <input class="nf-field" name="t_day" type="number" min="1" max="31" placeholder="DAY OF MONTH">
            <input class="nf-field" name="t_year" type="number" min="1" max="9999" placeholder="YEAR">
            </div><button class="nf-post">Add day</button>
            <div class="nf-foot"><span></span><button type="button" class="nf-link-btn" data-add-cancel>Cancel</button></div>
          </div></form>
        </div></div></details></li>` : '';
      if (!rows.length && !add) return '';
      return `<ol class="itin-tl" data-seq="${seq}" data-group="${groupUid || ''}">${rows.join('')}${add}</ol>`;
    };

    // ---- days --------------------------------------------------------------
    // A heading reads as one line; tapped, it opens the components underneath
    // so "we're going in 2027" or "move Day 2 to April 10" edits a part, not a
    // string. Only the owner can open it.
    const dayHead = (g) => {
      const when = tf(g);
      const read = `<b>${esc(g.label || (when ? '' : 'A day'))}</b>${when ? `<span>${esc(when)}</span>` : ''}`;
      if (!ctl) return `<h4 class="itin-day">${read}<span class="rule"></span></h4>`;
      return `<details class="itin-day-edit"><summary class="itin-day">${read}<span class="rule"></span><i class="itin-day-hint">edit</i></summary>
        <form method="post" action="${base}/groups/${g.uid}" class="nf nf-compact day-form"><div class="nf-box"><div class="nf-stack">
          <input class="nf-field" name="label" value="${esc(g.label)}" placeholder="LABEL \u2014 DAY 1, FRIDAY\u2026" maxlength="60">
          <select class="nf-field" name="t_month"><option value="">MONTH</option>${T_MONTHS.map((m2, i) => `<option value="${i + 1}" ${g.t_month === i + 1 ? 'selected' : ''}>${m2}</option>`).join('')}</select>
          <input class="nf-field" name="t_day" type="number" min="1" max="31" value="${g.t_day ?? ''}" placeholder="DAY OF MONTH">
          <input class="nf-field" name="t_year" type="number" min="1" max="9999" value="${g.t_year ?? ''}" placeholder="YEAR">
          <select class="nf-field" name="t_weekday"><option value="">WEEKDAY</option>${T_WEEKDAYS.map((w) => `<option ${g.t_weekday === w ? 'selected' : ''}>${w}</option>`).join('')}</select>
          <input type="hidden" name="intent" value="">
          </div><button class="nf-post">Save</button></div></form>
        <div class="stop-links"><form method="post" action="${base}/groups/${g.uid}/delete" onsubmit="return confirm('Remove this day? Its stops stay, unplaced.')"><button class="link caps stop-del">Remove this day</button></form></div>
      </details>`;
    };


    const dayBlocks = groups.map((g) => {
      if (budget <= 0) return '';
      return `<section class="itin-group">${dayHead(g)}${list(itineraryStops(it.id, g.id), g.uid)}</section>`;
    }).join('');
    const unplaced = itineraryStops(it.id, null);
    const looseHead = groups.length && (unplaced.length || ctl)
      ? '<h4 class="itin-day itin-day-loose"><b>Not yet on the timeline</b><span class="rule"></span></h4>' : '';
    const looseBlock = budget > 0 && (unplaced.length || ctl)
      ? `<section class="itin-group itin-group-loose">${looseHead}${list(unplaced, null)}</section>` : '';
    return { html: dayBlocks + looseBlock, groups, owner };
}

// An itinerary as it appears in a feed or listing: the article's own shell,
// truncated after a few stops and faded. Used by the listing page, the home
// feed and the profile activity tab, so an itinerary is a first-class feed
// object with the same visibility rules as a note or a mark.
// ---- itinerary geography ----------------------------------------------------
// The linked marks that carry coordinates. Everything below is derived from
// these at read time; nothing is stored.
function itineraryGeo(it, me) {
  const rows = q(`SELECT s.uid stop_uid, s.label, s.position, s.group_id, m.* FROM itinerary_stops s
                  JOIN marks m ON m.uid = s.mark_uid
                  WHERE s.itinerary_id=? AND m.lat IS NOT NULL AND m.lng IS NOT NULL`).all(it.id)
    .filter((r) => canSeeStop({ visibility: 'visible', resolution: 'linked', mark_uid: r.uid }, it, me).see);
  return rows;
}

// A square map of the region the stops span, with numbered pins for each.
// OSM's embed takes one marker, so the pins are an SVG overlay mapped into
// the same bbox in Mercator space -- the bbox is what the embed displays, and
// it is made square in that space to match the square iframe, so the mapping
// is faithful. Shown only when at least one stop has coordinates.
function itineraryMap(it, me) {
  const pts = itineraryGeo(it, me);
  if (!pts.length) return '';
  const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI / 180) / 2));
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  let minLa = Math.min(...lats), maxLa = Math.max(...lats), minLn = Math.min(...lngs), maxLn = Math.max(...lngs);
  // pad, then square in Mercator
  const padLn = Math.max((maxLn - minLn) * 0.25, 0.01), padLa = Math.max((maxLa - minLa) * 0.25, 0.006);
  minLn -= padLn; maxLn += padLn; minLa -= padLa; maxLa += padLa;
  let y0 = merc(minLa), y1 = merc(maxLa);
  const w = (maxLn - minLn) * Math.PI / 180, h = y1 - y0;
  if (w > h) { const c = (y0 + y1) / 2; y0 = c - w / 2; y1 = c + w / 2; }
  else { const c = (minLn + maxLn) / 2, half = (h * 180 / Math.PI) / 2; minLn = c - half; maxLn = c + half; }
  const unmerc = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
  const bLa0 = unmerc(y0), bLa1 = unmerc(y1);
  const bbox = [minLn, bLa0, maxLn, bLa1].map((v) => v.toFixed(6)).join('%2C');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${pts[0].lat}%2C${pts[0].lng}`;
  // the same numbers the timeline shows, so a pin and its stop always agree
  const order = itineraryNumbers(it);
  const pins = pts.map((p) => {
    const x = ((p.lng - minLn) / (maxLn - minLn)) * 100;
    const y = (1 - (merc(p.lat) - y0) / (y1 - y0)) * 100;
    const n = order.get(p.stop_uid);
    return `<a data-pin="${esc(p.stop_uid)}" href="#stop-${esc(p.stop_uid)}" transform="translate(${x.toFixed(2)},${y.toFixed(2)})"><circle r="2.4" class="pin"/><text y="0.9" text-anchor="middle" class="pin-n">${n || ''}</text><title>${esc(p.name)}</title></a>`;
  }).join('');
  // mark-map carries the existing per-skin, per-mode tile filters, so the map
  // is tinted for classic and modern, light and dark, by the same rules the
  // mark page already uses. Nothing map-specific is invented here.
  // The pins are an overlay in bbox space, so they are only in register while
  // the map shows exactly that bbox. OSM's embed exposes no pan/zoom events to
  // follow, so the inline map is deliberately NOT interactive -- scrolling or
  // zooming it would leave the pins pointing at nothing. The caption opens the
  // real, interactive map instead.
  const big = `https://www.openstreetmap.org/?mlat=${pts[0].lat}&mlon=${pts[0].lng}#map=13/${pts[0].lat}/${pts[0].lng}`;
  return `<figure class="itin-map mark-map">
    <span class="itin-map-inner">
      <iframe src="${src}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" tabindex="-1" title="Map of ${esc(it.title)}"></iframe>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${pins}</svg>
    </span>
    <figcaption><a href="${big}" target="_blank" rel="noopener">${pts.length === 1 ? esc(pts[0].name) : `${pts.length} stops`} \u00b7 open the map</a></figcaption>
  </figure>`;
}

// Marks and notes near this itinerary that are not already in it. Marks by
// coordinates within the stops' region (widened), or by matching locality or
// country; notes by tags or names carrying the same place words. Only the
// member's own records, only those they can see. Shown only when there is
// something to show.
// The member's own marks in this itinerary's region that are not already in
// the plan. The same evidence the suggestions panel uses -- coordinates where
// the plan has them, otherwise the place words in its title and its linked
// marks -- so there is one notion of "this region", not two.
function itineraryNearbyMarks(it, me, limit = 8) {
  if (!me || me.id !== it.user_id) return [];
  const pts = itineraryGeo(it, me);
  const inPlan = new Set(q('SELECT mark_uid FROM itinerary_stops WHERE itinerary_id=? AND mark_uid IS NOT NULL').all(it.id).map((r) => r.mark_uid));
  const words = new Set();
  const addWords = (t) => String(t || '').toLowerCase().split(/[\s,\u2014\-\/]+/)
    .filter((w) => w.length > 3 && !['next', 'time', 'when', 'trip', 'with', 'from', 'that', 'this', 'somewhere'].includes(w))
    .forEach((w) => words.add(w));
  addWords(it.title);
  for (const l of q('SELECT m.locality, m.country FROM itinerary_stops s JOIN marks m ON m.uid=s.mark_uid WHERE s.itinerary_id=?').all(it.id)) {
    addWords(l.locality); addWords(l.country);
  }
  if (!pts.length && !words.size) return [];          // region unknown: show nothing

  let rows = [];
  if (pts.length) {
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    const dLa = Math.max((Math.max(...lats) - Math.min(...lats)) * 2, 0.15);
    const dLn = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 2, 0.15);
    rows = q(MARK_SQL + ' WHERE m.user_id=? AND m.lat BETWEEN ? AND ? AND m.lng BETWEEN ? AND ?')
      .all(me.id, Math.min(...lats) - dLa, Math.max(...lats) + dLa, Math.min(...lngs) - dLn, Math.max(...lngs) + dLn);
  }
  const byPlace = q(MARK_SQL + ' WHERE m.user_id=?').all(me.id).filter((mk) => {
    const hay = `${mk.locality || ''} ${mk.country || ''} ${mk.name || ''}`.toLowerCase();
    return [...words].some((w) => hay.includes(w));
  });
  const seen = new Set();
  return [...rows, ...byPlace]
    .filter((mk) => !inPlan.has(mk.uid) && !seen.has(mk.uid) && (seen.add(mk.uid), true))
    .slice(0, limit);
}

function itinerarySuggestions(it, me) {
  if (!me || me.id !== it.user_id) return '';
  const pts = itineraryGeo(it, me);
  const inItin = new Set(q('SELECT mark_uid FROM itinerary_stops WHERE itinerary_id=? AND mark_uid IS NOT NULL').all(it.id).map((r) => r.mark_uid));
  const linked = q(`SELECT m.locality, m.country FROM itinerary_stops s JOIN marks m ON m.uid=s.mark_uid WHERE s.itinerary_id=?`).all(it.id);
  const words = new Set();
  const addWords = (t) => String(t || '').toLowerCase().split(/[\s,\u2014\-\/]+/).filter((w) => w.length > 3 && !['next','time','when','trip','with','from','that','this','somewhere'].includes(w)).forEach((w) => words.add(w));
  addWords(it.title); for (const l of linked) { addWords(l.locality); addWords(l.country); }
  if (!words.size && !pts.length) return '';

  let marks = [];
  if (pts.length) {
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    const dLa = Math.max((Math.max(...lats) - Math.min(...lats)) * 2, 0.15), dLn = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 2, 0.15);
    marks = q(MARK_SQL + ` WHERE m.user_id=? AND m.lat BETWEEN ? AND ? AND m.lng BETWEEN ? AND ?`)
      .all(me.id, Math.min(...lats) - dLa, Math.max(...lats) + dLa, Math.min(...lngs) - dLn, Math.max(...lngs) + dLn);
  }
  const byPlace = q(MARK_SQL + ' WHERE m.user_id=?').all(me.id).filter((m) => {
    const hay = `${m.locality || ''} ${m.country || ''} ${m.name || ''}`.toLowerCase();
    return [...words].some((w) => hay.includes(w));
  });
  const seen = new Set();
  marks = [...marks, ...byPlace].filter((m) => !inItin.has(m.uid) && !seen.has(m.uid) && (seen.add(m.uid), true));

  const notes = q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC LIMIT 200').all(me.id).filter((o) => {
    const hay = `${o.tags || ''} ${o.name || ''} ${o.category || ''}`.toLowerCase();
    return [...words].some((w) => hay.includes(w));
  });
  if (!marks.length && !notes.length) return '';

  const group = (title, items, render, kind) => {
    if (!items.length) return '';
    const first = items.slice(0, 3).map(render).join(''), rest = items.slice(3).map(render).join('');
    return `<section class="itin-sugg-group">
      <h4 class="itin-day"><b>${title}</b><span>${items.length}</span><span class="rule"></span></h4>
      <div class="itin-sugg-list">${first}</div>
      ${rest ? `<details class="itin-sugg-more"><summary class="nf-post sugg-more-btn">Show more</summary><div class="itin-sugg-list">${rest}</div></details>` : ''}
    </section>`;
  };
  const markRow = (m) => `<div class="sugg"><a class="sugg-name" href="/m/${m.id}">${esc(m.name)}</a><span class="sugg-sub">${esc([m.locality, m.country].filter(Boolean).join(', '))}</span>
    <form method="post" action="/t/${it.id}/stops"><input type="hidden" name="mark_uid" value="${esc(m.uid)}"><input type="hidden" name="label" value="${esc(m.name)}"><button class="link caps">Add to itinerary</button></form></div>`;
  const noteRow = (o) => `<div class="sugg"><a class="sugg-name" href="/o/${o.id}">${esc(o.name)}</a><span class="sugg-sub">${esc(tagList(o.tags).slice(0, 3).map((t) => '#' + t).join(' '))}</span></div>`;
  return `<aside class="itin-sugg">
    <h3 class="strip">Nearby, from your catalogue</h3>
    ${group('Travel marks', marks, markRow)}${group('Notes', notes, noteRow)}
  </aside>`;
}

const inList = (a) => a.length < 2 ? (a[0] || '')
  : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

function colophonFrame(lead, rows, label, cls) {
  if (rows.length < 2) return '';        // a bare created date is not a history
  const entry = ([k, v]) => `<span class="colo-k">${esc(k)}</span><span class="colo-v">${esc(v)}</span>`;
  return `<aside class="colophon ${cls}" aria-label="${esc(label)}">
  <span class="colo-head">Provenance</span><span class="colo-rule"></span>
  <span class="colo-lead">${esc(lead)}</span>
  ${entry(rows[0])}
  <img class="colo-mark" src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="26" height="35">
  ${rows.slice(1).map(entry).join('\n  ')}
  <span class="colo-rule"></span>
</aside>`;
}

// ---- travel mark colophon ---------------------------------------------------
// How this place entered and evolved in the record. NOT what happened at the
// place: check-ins are experienced evidence with their own timeline, and never
// appear here. Being used as a stop does not rewrite a mark's origin either --
// only the mark's own creation row can say where it came from.
function markColophonEntries(m, me) {
  const out = [];
  const rows = q("SELECT * FROM provenance WHERE entity_type='mark' AND entity_uid=? ORDER BY id").all(m.uid);
  const created = rows.find((r) => r.action === 'created');
  out.push(['Marked', monthYear(m.created_at)]);

  // Causal, never inferred: only a creation row that names an itinerary can
  // say the mark was added while planning one.
  if (created && created.source_kind === 'itinerary' && created.source_ref) {
    const it = q('SELECT * FROM itineraries WHERE uid=?').get(created.source_ref);
    // A private plan is never named to someone who could not open it; the
    // fact that the mark came from planning is still true and still shown.
    const show = it && canSee(it, me);
    out.push(['Added while planning', show ? [it.title, temporalFormat(temporalOf(it))].filter(Boolean).join(' \u00b7 ') : 'a trip']);
  }

  // Enrichment is claimed only where provenance says it happened, and the
  // individual field writes are collapsed into one human line.
  const enriched = rows.filter((r) => r.action === 'enriched');
  if (enriched.length) {
    const what = new Set();
    for (const r of enriched) {
      if (r.source_kind === 'coordinates_supplied' || /coordinates|lat|lng/.test(String(r.fields || ''))) what.add('coordinates');
      for (const f of String(r.fields || '').split(',').map((x) => x.trim()).filter(Boolean)) {
        if (/address/.test(f)) what.add('address');
        else if (/why|description/.test(f)) what.add('description');
        else if (/locality|country/.test(f)) what.add('place');
      }
    }
    const byAi = enriched.some((r) => r.actor_type !== 'user');
    if (what.size) out.push([byAi ? 'Enriched by AI' : 'Enriched', inList([...what])]);
  }

  const corrected = rows.filter((r) => r.action === 'corrected');
  if (corrected.length) out.push(['Corrected', monthYear(corrected[corrected.length - 1].created_at)]);

  // Standing behind a place is an explicit act of judgment about the record,
  // so it is history worth inscribing. Warrant transitions are append-only --
  // asserting and revoking each insert their own row -- so the past survives a
  // withdrawal and is read from those rows, never from current state. The seal
  // keeps saying whether the mark is warranted NOW; this says what happened.
  // Like the seal, this reads state alone and ignores `published`.
  const w = q(`SELECT * FROM warrants WHERE subject_type='mark' AND subject_uid=? AND user_id=? ORDER BY id`)
    .all(m.uid, m.user_id);
  const lastActive = [...w].reverse().find((r) => r.state === 'active');
  if (lastActive) out.push(['Warranted', monthYear(lastActive.created_at)]);
  if (w.length && w[w.length - 1].state === 'revoked' && lastActive) {
    out.push(['Warrant withdrawn', monthYear(w[w.length - 1].created_at)]);
  }
  return out;
}
const markColophon = (m, me) => colophonFrame('This place was', markColophonEntries(m, me),
  'How this place entered the record', 'mark-colophon');

// ---- ensemble colophon ------------------------------------------------------
// What the composition was made from, and how it became durable. Keep is the
// corpus commitment boundary and is shown only where the ledger records that
// the member actually crossed it.
function ensembleColophonEntries(e, me) {
  const out = [];
  const rows = q("SELECT * FROM provenance WHERE entity_type='ensemble' AND entity_uid=? ORDER BY id").all(e.uid);
  out.push(['Composed', monthYear(e.created_at)]);

  // Constituents, named only where naming them reveals nothing withheld: a
  // component whose note the viewer cannot see is counted, never titled.
  const comps = q('SELECT * FROM ensemble_components WHERE ensemble_id=? ORDER BY id').all(e.id);
  const named = [], withheld = [];
  for (const c of comps) {
    const note = c.note_uid ? q(OBJ_SQL + ' WHERE o.uid=?').get(c.note_uid) : null;
    if (c.note_uid && !(note && canSee(note, me))) { withheld.push(c); continue; }
    if (c.label) named.push(c.label);
  }
  if (named.length) out.push(['From', named.slice(0, 4).join(' \u00b7 ') + (named.length > 4 ? ` \u00b7 and ${inWords(named.length - 4)} more` : '')]);
  else if (withheld.length) out.push(['From', `${inWords(withheld.length)} ${withheld.length === 1 ? 'piece' : 'pieces'} of your catalogue`]);

  // A component that began unresolved and was later identified is real history
  // and is preserved as such; the internal state names never surface.
  const cuids = comps.map((c) => c.uid);
  const res = cuids.length
    ? q(`SELECT * FROM provenance WHERE entity_type='ensemble_component' AND action IN ('resolved','corrected')
         AND entity_uid IN (${cuids.map(() => '?').join(',')})`).all(...cuids)
    : [];
  const later = new Set(res.filter((r) => r.action === 'resolved').map((r) => r.entity_uid));
  if (later.size) out.push(['Later identified', `${inWords(later.size)} ${later.size === 1 ? 'piece' : 'pieces'}`]);

  // The artifact's own creation row is what says the composition was generated.
  const art = q("SELECT * FROM provenance WHERE entity_type='ensemble_artifact' AND action='created' AND source_ref=? AND source_kind='generated' LIMIT 1").get(e.uid);
  if (art) out.push(['Composited with', agentName(art.agent) || 'your AI']);

  const kept = rows.filter((r) => r.action === 'edited' && String(r.fields || '').includes('status:saved'));
  if (kept.length) out.push(['Kept', monthYear(kept[kept.length - 1].created_at)]);
  return out;
}
const ensembleColophon = (e, me) => colophonFrame('This composition was', ensembleColophonEntries(e, me),
  'What this composition was made from', 'ens-colophon');

// ---- itinerary colophon -----------------------------------------------------
// How the plan took shape. Derived entirely from the append-only ledger and the
// canonical tables; nothing rendered here is stored. The discipline is
// selection: the ledger is comprehensive, the inscription is not. A provenance
// row earns a line only when it tells a member something about the plan that
// the itinerary itself does not already show.
//
// Nothing about execution appears here. Check-ins are evidence attached to a
// Travel Mark, not to a plan, and there is no Stop->Check-in relationship to
// read even if one wanted to.
const AGENT_NAMES = { 'mcp:claude': 'Claude', 'mcp:chatgpt': 'ChatGPT', 'mcp:gpt': 'ChatGPT' };
const agentName = (a) => AGENT_NAMES[a] || (a && a.startsWith('mcp:') ? 'your AI' : null);

// Notes adjacent to this one, in the same register as an itinerary's
// "Nearby, from your catalogue": two groupings, each showing three with the
// rest behind the same Show more. Only notes the viewer may actually see, and
// never the note being read.
// Search results, grouped by what kind of thing was found. Each group shows
// its first ten and keeps the rest behind the same Show more the feeds use;
// opening one pages that group alone, twenty at a time, without disturbing the
// others. Every group is privacy-filtered by the same rules its own surface
// uses, so search can never surface what a page would withhold.
const SEARCH_FIRST = 10, SEARCH_PAGE = 20;
function searchGroups(term, me, url) {
  const k = term.toLowerCase();
  const hit = (...parts) => parts.filter(Boolean).join(' ').toLowerCase().includes(k);
  const out = [];

  const notes = q(OBJ_SQL + (me ? ' WHERE o.private=0 OR o.user_id=?' : ' WHERE o.private=0') + ' ORDER BY o.id DESC LIMIT 600')
    .all(...(me ? [me.id] : [])).filter((o) => canSee(o, me) && hit(o.name, o.why, o.tags));
  const marks = q(MARK_SQL + (me ? ' WHERE m.private=0 OR m.user_id=?' : ' WHERE m.private=0') + ' ORDER BY m.id DESC LIMIT 600')
    .all(...(me ? [me.id] : [])).filter((m) => canSee(m, me) && hit(m.name, m.why, m.tags, m.locality, m.country));
  const itins = q('SELECT * FROM itineraries' + (me ? ' WHERE private=0 OR user_id=?' : ' WHERE private=0') + ' ORDER BY id DESC LIMIT 300')
    .all(...(me ? [me.id] : [])).filter((it) => canSee(it, me) && hit(it.title, it.context));
  const ens = q('SELECT * FROM ensembles' + (me ? ' WHERE private=0 OR user_id=?' : ' WHERE private=0') + ' ORDER BY id DESC LIMIT 300')
    .all(...(me ? [me.id] : [])).filter((e) => ensCanSee(e, me) && hit(e.title, e.description));
  const people = q('SELECT * FROM users ORDER BY id LIMIT 400').all()
    .filter((u) => hit(u.handle, u.name, u.bio));

  out.push(['notes', 'Notes', notes, (o) => objectCard(o, me)]);
  out.push(['marks', 'Travel marks', marks, (m) => markCard(m, me)]);
  out.push(['itineraries', 'Itineraries', itins, (it) => itineraryPreview(it, me)]);
  out.push(['ensembles', 'Ensembles', ens, (e) => {
    const pa = e.primary_artifact_uid ? q('SELECT image_uid FROM ensemble_artifacts WHERE uid=?').get(e.primary_artifact_uid) : null;
    const st = ensStats(e.id);
    return `<a class="ens-tile" href="/e/${e.id}">
      <span class="ens-tile-media">${pa ? imgTag('/i/' + pa.image_uid, e.title) : '<span class="ens-tile-blank"></span>'}</span>
      <span class="ens-tile-meta"><span class="ens-tile-t">${esc(e.title)}${e.private ? ' <i>private</i>' : ''}</span>
      ${e.description ? `<span class="ens-tile-d">${esc(e.description)}</span>` : ''}
      ${statChips([['pieces', st.total], ['from notes', st.fromNotes], ['sources', st.sourceImages]])}</span></a>`;
  }]);
  out.push(['people', 'People', people, (u) => `<article class="note"><div class="card"><div class="text">
    <a class="person" href="/u/${esc(u.handle)}">${avatar(u)}<span class="person-name">${esc(u.handle)}</span></a>
    ${u.bio ? `<p class="body">${esc(u.bio)}</p>` : ''}</div></div></article>`]);
  return out.filter(([, , rows]) => rows.length);
}

// One group's slice. `g_<key>` in the query carries how many that group has
// asked for, so each pages independently and a reload restores what was open.
function searchGroupHtml(key, title, rows, render, url) {
  const asked = Math.max(0, +url.searchParams.get('g_' + key) || 0);
  const show = asked ? Math.min(asked, rows.length) : Math.min(SEARCH_FIRST, rows.length);
  const more = rows.length > show;
  const sp = new URLSearchParams(url.search);
  sp.set('g_' + key, String(show + SEARCH_PAGE));
  return `<section class="search-group" data-group="${key}">
    <h4 class="itin-day"><b>${esc(title)}</b><span>${rows.length}</span><span class="rule"></span></h4>
    <div class="search-cards grid" id="group-${key}">${rows.slice(0, show).map(render).join('')}</div>
    ${more ? `<div class="more"><a class="nf-post more-link search-more" data-group="${key}" href="?${sp}">Show more</a></div>` : ''}
  </section>`;
}

function relatedNotes(o, me) {
  const seen = new Set([o.uid]);
  const mine = (rows) => rows.filter((r) => canSee(r, me) && !seen.has(r.uid) && (seen.add(r.uid), true));

  // Same collections: the member's own filing is the strongest adjacency there
  // is, because they put these together deliberately.
  const collIds = q('SELECT collection_id FROM note_collections WHERE note_id=?').all(o.id).map((r) => r.collection_id);
  const sameColl = collIds.length ? mine(q(OBJ_SQL + `
    JOIN note_collections nc ON nc.note_id = o.id
    WHERE nc.collection_id IN (${collIds.map(() => '?').join(',')}) AND o.id <> ?
    GROUP BY o.id ORDER BY o.id DESC LIMIT 60`).all(...collIds, o.id)) : [];

  // Shared tags, then words from the title. Ranked by how much is shared, so
  // the closest thing comes first rather than the newest.
  const tags = new Set(tagList(o.tags));
  const words = new Set(String(o.name || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !['with', 'from', 'that', 'this', 'your', 'have'].includes(w)));
  let similar = [];
  if (tags.size || words.size) {
    similar = mine(q(OBJ_SQL + ' WHERE o.id <> ? ORDER BY o.id DESC LIMIT 400').all(o.id))
      .map((r) => {
        const rt = new Set(tagList(r.tags));
        let score = 0;
        for (const t of tags) if (rt.has(t)) score += 3;
        const hay = `${r.name || ''} ${r.tags || ''}`.toLowerCase();
        for (const w of words) if (hay.includes(w)) score += 1;
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.r.id - a.r.id)
      .slice(0, 40).map((x) => x.r);
  }
  if (!sameColl.length && !similar.length) return '';

  const row = (n) => `<div class="sugg"><a class="sugg-name" href="/o/${n.id}">${esc(n.name)}</a>
    <span class="sugg-sub">${esc(tagList(n.tags).slice(0, 3).map((t) => '#' + t).join(' ') || n.handle)}</span></div>`;
  const group = (title, items) => {
    if (!items.length) return '';
    const first = items.slice(0, 3).map(row).join(''), rest = items.slice(3).map(row).join('');
    return `<section class="itin-sugg-group">
      <h4 class="itin-day"><b>${title}</b><span>${items.length}</span><span class="rule"></span></h4>
      <div class="itin-sugg-list">${first}</div>
      ${rest ? `<details class="itin-sugg-more"><summary class="nf-post sugg-more-btn">Show more</summary><div class="itin-sugg-list">${rest}</div></details>` : ''}
    </section>`;
  };
  return `<aside class="itin-sugg note-sugg">
    <h3 class="strip">Similar notes</h3>
    ${group('More notes from the same collections', sameColl)}${group('Other similar notes', similar)}
  </aside>`;
}

function itineraryColophonEntries(it, me) {
  const out = [];
  const owner = !!(me && (me.id === it.user_id || me.is_admin));
  const stops = q('SELECT * FROM itinerary_stops WHERE itinerary_id=?').all(it.id);
  const uids = stops.map((st) => st.uid);
  const rows = uids.length
    ? q(`SELECT * FROM provenance WHERE (entity_type='itinerary' AND entity_uid=?)
         OR (entity_type='itinerary_stop' AND entity_uid IN (${uids.map(() => '?').join(',')}))
         ORDER BY id`).all(it.uid, ...uids)
    : q("SELECT * FROM provenance WHERE entity_type='itinerary' AND entity_uid=?").all(it.uid);

  // ---- Tier 1: authorship ---------------------------------------------------
  out.push(['Planned', monthYear(it.created_at)]);
  // An AI line is earned only by actions the member authorised: every row in
  // this ledger is a canonical write that already happened. Unaccepted
  // suggestions are never written, so they cannot appear here.
  const aiRows = rows.filter((r) => r.actor_type === 'ai_on_behalf' && r.assertion === 'explicit');
  const aiAgent = aiRows.length ? agentName(aiRows[0].agent) : null;
  if (aiAgent) {
    const createdByAi = rows.some((r) => r.entity_type === 'itinerary' && r.action === 'created' && r.actor_type === 'ai_on_behalf');
    // "refined" only when the AI kept working on it after the plan existed
    const refined = aiRows.filter((r) => r.action !== 'created').length >= 3;
    out.push([createdByAi ? 'Planned with' : 'Refined with', aiAgent + (createdByAi && refined ? ', and refined since' : '')]);
  }

  // ---- Tier 2: corpus lineage ----------------------------------------------
  // Causal, never inferred: a Mark counts as "added while planning" only where
  // its own creation provenance says it came from this itinerary. Marks the
  // viewer cannot see are excluded from both counts, so a count can never
  // reveal a record ordinary rendering would withhold.
  const linked = stops.filter((st) => st.mark_uid && st.visibility === 'visible');
  const visible = linked.filter((st) => {
    const mk = q('SELECT private, user_id FROM marks WHERE uid=?').get(st.mark_uid);
    return mk && (owner || !mk.private);
  }).map((st) => st.mark_uid);
  // one Mark, one count, however many stops point at it
  const seenMarks = [...new Set(visible)];
  if (seenMarks.length) {
    const born = new Set(q(`SELECT entity_uid FROM provenance WHERE entity_type='mark' AND action='created'
      AND source_kind='itinerary' AND source_ref=? AND entity_uid IN (${seenMarks.map(() => '?').join(',')})`)
      .all(it.uid, ...seenMarks).map((r) => r.entity_uid));
    const fromCorpus = seenMarks.filter((u) => !born.has(u)).length;
    if (fromCorpus) out.push(['Built from', `${inWords(fromCorpus)} ${fromCorpus === 1 ? 'travel mark' : 'travel marks'} already kept`]);
    if (born.size) out.push(['Added while planning', `${inWords(born.size)} more`]);
  }

  // ---- Tier 3: meaningful evolution ----------------------------------------
  // Synthesis, not events. Ten resolutions are one line; a hundred position
  // writes are none, because reordering is how the surface works rather than
  // something that happened to the plan.
  const resolved = new Set(), corrected = new Set();
  for (const r of rows) {
    if (r.entity_type !== 'itinerary_stop' || !r.fields) continue;
    const f = String(r.fields);
    if (!f.includes('mark_uid')) continue;
    if (r.action === 'enriched') resolved.add(r.entity_uid);
    if (r.action === 'corrected') corrected.add(r.entity_uid);
  }
  for (const u of corrected) resolved.delete(u);
  if (resolved.size) out.push(['Later identified', `${inWords(resolved.size)} ${resolved.size === 1 ? 'place intention' : 'place intentions'}`]);
  if (corrected.size) out.push(['Corrected', `${inWords(corrected.size)} ${corrected.size === 1 ? 'stop' : 'stops'}`]);

  // Stops added after the plan's first day tell the member the plan kept
  // growing; stops added the same day are just how it was written.
  const day = (t) => String(t || '').slice(0, 10);
  const later = stops.filter((st) => day(st.created_at) > day(it.created_at)).length;
  if (later) out.push(['Added since', `${inWords(later)} ${later === 1 ? 'stop' : 'stops'}`]);

  // Temporal structure: that dates arrived at all, never which or how precise.
  const dated = q(`SELECT COUNT(*) c FROM itinerary_groups WHERE itinerary_id=?
    AND (t_year IS NOT NULL OR t_month IS NOT NULL OR t_day IS NOT NULL OR t_weekday IS NOT NULL)`).get(it.id).c;
  const days = q('SELECT COUNT(*) c FROM itinerary_groups WHERE itinerary_id=?').get(it.id).c;
  if (days && dated) out.push(['Set across', `${inWords(days)} ${days === 1 ? 'dated day' : 'dated days'}`]);
  return out;
}

// The visual grammar is shared; the storytelling is not. This renders any
// primitive's entries in the colophon the Note and Itinerary already use --
// the same head, rule, lead, maker's mark and key/value inscriptions.
function itineraryColophon(it, me) {
  const rows = itineraryColophonEntries(it, me);
  if (rows.length < 2) return '';        // a bare created date is not a history
  const entry = ([k, v]) => `<span class="colo-k">${esc(k)}</span><span class="colo-v">${esc(v)}</span>`;
  return `<aside class="colophon itin-colophon" aria-label="How this plan took shape">
  <span class="colo-head">Provenance</span><span class="colo-rule"></span>
  <span class="colo-lead">This plan was</span>
  ${entry(rows[0])}
  <img class="colo-mark" src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="26" height="35">
  ${rows.slice(1).map(entry).join('\n  ')}
  <span class="colo-rule"></span>
</aside>`;
}

function itineraryPreview(it, me) {
  const tf = (row) => temporalFormat(temporalOf(row));
  const total = q('SELECT COUNT(*) c FROM itinerary_stops WHERE itinerary_id=?').get(it.id).c;
  const shown = 3;
  const rendered = itineraryBody(it, me, { interactive: false, limit: shown });
  const when = tf(it);
  const au = q('SELECT handle, avatar FROM users WHERE id=?').get(it.user_id);
  return `<article class="note itin-note">
    <div class="byline"><span class="byline-who"><a href="/u/${esc(au.handle)}">${avatar({ handle: au.handle, avatar: au.avatar })}</a>${stackDate(it.created_at)}</span></div>
    <div class="itp itin-shell">
    <div class="itp-head ens-head itin-head">
      <p class="who"><a href="/u/${esc(au.handle)}">${esc(au.handle)}</a> ${it.private ? '<span class="who-private">privately planned</span>' : 'planned'}</p>
      <h1 class="ens-title">${esc(it.title || 'Untitled')}</h1>
      ${when ? `<span class="itin-when">${esc(when)}</span>` : ''}
      ${it.context ? `<span class="itin-ctx itp-ctx">${esc(it.context)}</span>` : ''}
    </div>
    <div class="itp-body ${total > shown ? 'has-more' : ''}">${rendered.html || '<span class="itp-empty">Nothing added yet</span>'}</div>
    <a class="itp-over" href="/t/${it.id}" aria-label="Open ${esc(it.title || 'this itinerary')}"></a>
    ${total > shown ? `<a class="itp-more" href="/t/${it.id}">${total - shown} More</a>` : ''}
  </div></article>`;
}

const pages = {
  home(req, res, me, url) {
    const s = (url.searchParams.get('q') || '').trim();
    const tag = (url.searchParams.get('t') || '').trim().toLowerCase();
    const feed = me && ['following', 'followers'].includes(url.searchParams.get('feed')) ? url.searchParams.get('feed') : 'all';
    // A signed-in member's own entries — private ones included — always belong
    // in their feed. It is their journal as much as the network's: leaving a
    // private note out of your own home page means the thing you just recorded
    // vanishes from the one place you'd look for it. Other members' private
    // entries are excluded by the query and again by canSee below.
    const mineToo = !!me;
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
    // Itineraries are first-class feed objects: the same visibility rule as a
    // note or a mark (canSee), shown as the article shell truncated.
    const itins = feed === 'all'
      ? q('SELECT * FROM itineraries WHERE ' + (me ? '(private=0 OR user_id=?)' : 'private=0') + ' ORDER BY id DESC LIMIT 60').all(...(me ? [me.id] : []))
      : [];
    const entries = [...rows.map((o) => ({ at: o.created_at, key: 'note:' + o.id, html: objectCard(o, me) })),
                     ...marks.map((x) => ({ at: x.created_at, key: 'mark:' + x.id, html: markCard(x, me) })),
                     ...itins.filter((it) => canSee(it, me)).map((it) => ({ at: it.created_at, key: 'itin:' + it.id, html: itineraryPreview(it, me) }))]
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const banner = resurfaceBanner(me, feed, !!(s || tag));
    const shown = banner.skip;
    const page = pageOf(shown ? entries.filter((e) => e.key !== shown) : entries, url);
    const members = q('SELECT handle, name, avatar FROM users ORDER BY created_at LIMIT 12').all();
    const tagCounts = {}; for (const o of q('SELECT tags FROM objects WHERE private=0').all()) for (const t of tagList(o.tags)) tagCounts[t] = (tagCounts[t] || 0) + 1;
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 16);
    const heading = { all: 'Activity from the entire network', following: 'From people you follow', followers: 'From your followers' }[feed]
      + (me && feed === 'all' ? '<span class="strip-sub">Your private items remain visible only to you</span>' : '');

    let rail;
    if (me) {
      const notes = q('SELECT COUNT(*) c FROM objects WHERE user_id=?').get(me.id).c;
      const markTally = q('SELECT COUNT(*) c FROM marks WHERE user_id=?').get(me.id).c;
      const ensTally = q('SELECT COUNT(*) c FROM ensembles WHERE user_id=?').get(me.id).c;
      const warrantTally = warrantedSubjectUids(me.id, 'object').size + warrantedSubjectUids(me.id, 'mark').size;
      const itinTally = q('SELECT COUNT(*) c FROM itineraries WHERE user_id=?').get(me.id).c;
      const fc = followCounts(me.id);   // shown as following:followers
      const fl = (k, label, short) => `<li><a class="${feed === k ? 'on' : ''}" data-short="${short}" href="/${k === 'all' ? '' : `?feed=${k}`}"><span class="fl-label">${label}</span>${feed === k ? '' : ' <span>›</span>'}</a></li>`;
      rail = `<ul class="feednav">${fl('all', 'All Discriminant.ly', 'All')}${fl('following', 'From People You Follow', 'Following')}${fl('followers', 'From Your Followers', 'Followers')}</ul>
      <div class="wtable">
        <div class="wcell wcell-wide"><a href="/u/${esc(me.handle)}">${avatar(me, 'avatar big')}</a><p class="welcome-name">Welcome ${esc(me.handle)}</p></div>
        <div class="wcells">
        <a class="wcell" href="/u/${esc(me.handle)}?tab=notes"><b>${notes}</b><span>Notes</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=marks"><b>${markTally}</b><span>Marks</span></a>
        <a class="wcell" href="/t"><b>${itinTally}</b><span>Itineraries</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=ensembles"><b>${ensTally}</b><span>Ensembles</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=warrants"><b>${warrantTally}</b><span>Warrants</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=following"><b>${fc.following}:${fc.followers}</b><span>Follows</span></a>
        </div>
        <form class="wcell wcell-wide wcell-btn" method="post" action="/logout"><button class="btn3d block">Logout</button></form>
      </div>`;
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
    <p class="about">Discriminantly is a home for your interests and travels—the things you notice, the places you go, the experiences worth remembering, and what you want to explore next.</p>
    <p class="about">Effortlessly add what you encounter, share what you choose, and connect Discriminantly to your AI to enrich what you’ve kept and discover what comes next.</p>
    <p class="about">What you keep is yours—private when you want it, connected on your terms, and with you wherever you go.</p>
`}
  </aside>
  <section class="feed feed-plain is-tiled">
    <h3 class="strip">${s ? `Results for “${esc(s)}”` : tag ? `#${esc(tag)}` : heading}</h3>
    ${banner.html}
    ${s ? (() => {
      // A search is answered by kind: one group per primitive, each paging on
      // its own. The plain feed is unchanged when nothing was searched for.
      const groups = searchGroups(s, me, url);
      return groups.length
        ? groups.map(([k, t, rows, render]) => searchGroupHtml(k, t, rows, render, url)).join('')
        : '<p class="empty pad">Nothing found.</p>';
    })()
      : entries.length ? `<div class="grid" id="feed-grid">${page.slice.map((e) => e.html).join('')}</div>${moreLink(url, page.off, page.more)}`
      : (me ? emptyState(me, feed === 'all' ? (tag ? 'tagged' : 'feed') : feed) : '<p class="empty pad">Nothing here yet.</p>')}
  </section>
</div>`;
    send(res, layout({ title: '', body, me, nav: 'home' }));
  },

  object(req, res, me, url, id) {
    const o = q(OBJ_SQL + ' WHERE o.id=?').get(id); if (!o || !canSee(o, me)) return send(res, layout({ title: 'Not found', body: '<p>No such note.</p>', me }), 404);
    const tags = tagList(o.tags);
    // Who adopted this Note. Their Notes are their own; we show only that the
    // adoption happened, never their content.
    const noters = q(`SELECT DISTINCT u.handle, u.name, u.avatar FROM objects a
      JOIN users u ON u.id=a.user_id
      WHERE a.renoted_from_uid=? AND a.user_id<>? AND a.private=0 ORDER BY a.created_at`).all(o.uid, o.user_id);
    const cmts = q('SELECT c.*, u.handle, u.name, u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.object_id=? ORDER BY c.created_at').all(id);
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: o.name, url: o.url || undefined, image: o.image || undefined, description: o.why, keywords: tags.join(', ') || undefined };
    const author = q('SELECT * FROM users WHERE id=?').get(o.user_id);
    const body = `<div class="cols profile-cols">${profileRail(author, me, 'notes')}
<section class="feed profile-feed${skinOf(me, req) === 'modern' ? ' has-colophon' : ''}">
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
  <ul class="comment-list">${cmts.map((c) => `<li><a href="/u/${esc(c.handle)}">${avatar(c)}</a><div class="comment-body"><p class="comment-meta"><a href="/u/${esc(c.handle)}">${esc(c.handle)}</a> \u00b7 <span class="stamp">${timeAgo(c.created_at)}</span>${me && me.id === c.user_id ? `<label class="card-edit comment-edit" for="cmt-o-${c.id}">Edit</label>` : ''}</p><p class="comment-text">${esc(c.body)}</p>${me && (me.id === c.user_id || me.id === o.user_id || me.is_admin) ? `<input type="checkbox" id="cmt-o-${c.id}" class="cmt-toggle" hidden><form method="post" action="/o/${o.id}/comments/${c.id}" class="nf nf-compact cmt-edit"><div class="nf-box"><div class="nf-stack"><textarea class="nf-field" name="body" rows="3" maxlength="600">${esc(c.body)}</textarea></div><button class="nf-post">Save</button><div class="nf-foot nf-foot-3"><button type="button" class="nf-link-btn nf-del" data-del="/o/${o.id}/comments/${c.id}/delete" data-kind="comment" data-title="${esc(c.body.slice(0, 48))}">Delete</button><span></span><button type="button" class="nf-link-btn" data-cmt-cancel>Cancel</button></div></div></form>` : ''}</div></li>`).join('')}</ul>
</section>
<div class="note-side">${relatedNotes(o, me)}${skinOf(me, req) === 'modern' ? colophon(o) : ''}</div>
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

  // ---- Itinerary ------------------------------------------------------------
  itineraries(req, res, me, url) {
    // `need()` is scoped to the request handler and is not visible here -- the
    // ensembles page has the same latent bug and 500s when signed out.
    // ?u=<handle> shows another member's public itineraries.
    const who = url && url.searchParams.get('u');
    const subject = who ? q('SELECT * FROM users WHERE handle=?').get(who) : me;
    if (!subject) return redirect(res, '/login');
    const own = !!(me && me.id === subject.id);
    const rows = q('SELECT * FROM itineraries WHERE user_id=?' + (own ? '' : ' AND private=0') + ' ORDER BY id DESC').all(subject.id);
    const tf = (row) => temporalFormat(temporalOf(row));

    // Each itinerary is the article page's own rendering -- the day containers,
    // the mark cards, the intention cards -- cut off after a few stops and
    // faded, so what the member sees on the list is exactly what they will see
    // on the page, just less of it.
    const preview = (it) => itineraryPreview(it, me);

    // The mark post card's language, verbatim: nf-box, the private switch in
    // nf-top, nf-field inputs stacked in nf-stack with their tracked-caps
    // placeholders as labels. Timing is behind a button, closed by default.
    const monthOpts = `<option value="">MONTH</option>${T_MONTHS.map((m2, i) => `<option value="${i + 1}">${m2}</option>`).join('')}`;
    const create = own ? `<details class="itin-create">
      <summary class="post-box"><img class="plus" src="/plus.png" alt="" width="68" height="68"><span>Start an itinerary</span></summary>
      <form method="post" action="/t/new" class="nf nf-compact itin-new">
        <div class="nf-box">
          <div class="nf-top"><span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" checked><span></span></label></div>
          <div class="nf-stack">
            <input class="nf-field" name="title" placeholder="WHERE (REQUIRED)" required maxlength="120" autocomplete="off">
            <textarea class="nf-field" name="context" rows="4" maxlength="1000" placeholder="OVERVIEW \u2014 WHAT YOU HAVE IN MIND"></textarea>
          </div>
          <details class="itin-timing"><summary class="btn itin-when-btn">When, if you know</summary>
            <div class="nf-stack itin-timing-fields">
              <input class="nf-field" name="t_year" type="number" min="1" max="9999" placeholder="YEAR">
              <select class="nf-field" name="t_month">${monthOpts}</select>
              <select class="nf-field" name="t_period"><option value="">SEASON</option>${T_PERIODS.map((p2) => `<option>${p2}</option>`).join('')}</select>
              <select class="nf-field" name="t_modifier"><option value="">EARLY / MID / LATE</option>${T_MODS.map((m2) => `<option>${m2}</option>`).join('')}</select>
              <select class="nf-field" name="t_modifier_scope"><option value="">\u2026 OF THE YEAR / SEASON / MONTH</option>${T_SCOPES.map((sc2) => `<option value="${sc2}">of the ${sc2}</option>`).join('')}</select>
            </div></details>
          <button class="nf-post itin-start">Start</button>
          <div class="nf-foot"><span></span><button type="button" class="nf-link-btn" data-itin-new-cancel>Cancel</button></div>
        </div>
      </form></details>` : '';
    const main = `<h3 class="strip"><a class="crumb" href="/u/${esc(subject.handle)}">${esc(subject.handle)}</a> \u203a <span>Itineraries</span></h3>

    ${create}
    ${rows.length ? `<div class="grid" id="feed-grid">${rows.map(preview).join('')}</div>` : ''}
    ${rows.length || own ? '' : emptyState(me, 'itineraries')}`;
    const body = `<div class="cols profile-cols">${profileRail(subject, me, 'itineraries')}
  <section class="feed profile-feed itin-list">${main}</section>
</div>`;
    send(res, layout({ title: 'Itineraries', body, me, req }));
  },

  itinerary(req, res, me, url, id) {
    const it = q('SELECT * FROM itineraries WHERE id=?').get(id);
    if (!it || !canSee(it, me)) return send(res, layout({ title: 'Not found', body: '<p>No such itinerary.</p>', me, req }), 404);
    const owner = !!(me && (me.id === it.user_id || me.is_admin));
    const author = q('SELECT * FROM users WHERE id=?').get(it.user_id);
    const groups = groupOrder(it.id);
    const base = `/t/${it.id}`;
    const tf = (row) => temporalFormat(temporalOf(row));

    const conflicts = owner ? groupConflicts(it.id) : [];
    const rendered = itineraryBody(it, me);
    const dayBlocks = rendered.html, looseBlock = '';

    const addDay = '';   // the day form is a tab inside the add card now

    const when = tf(it);
    // the byline and edit affordance every first-class object carries
    const bylineRow = `<div class="byline"><span class="byline-who"><a href="/u/${esc(author.handle)}">${avatar({ handle: author.handle, avatar: author.avatar })}</a>${stackDate(it.created_at)}</span>${owner ? `<label class="card-edit" for="itin-edit-${it.id}">Edit</label>` : ''}</div>`;
    const titleBlock = `<div class="ens-head itin-head">
        <p class="who"><a href="/u/${esc(author.handle)}">${esc(author.handle)}</a> ${it.private ? '<span class="who-private">privately planned</span>' : 'planned'}</p>
        <h1 class="ens-title">${esc(it.title || 'Untitled')}</h1>
        ${when ? `<p class="itin-when">${esc(when)}</p>` : ''}${it.context ? `<p class="itin-ctx">${esc(it.context)}</p>` : ''}</div>`;
    const head = owner ? `<input type="checkbox" id="itin-edit-${it.id}" class="itin-edit-toggle" hidden><div class="itin-head-read">${titleBlock}</div><div class="itin-head-edit">
      <form method="post" action="${base}" class="nf nf-compact itin-new itin-edit-form"><div class="nf-box">
        <div class="nf-top"><span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${it.private ? 'checked' : ''}><span></span></label></div>
        <div class="nf-stack">
        <input class="nf-field" name="title" value="${esc(it.title)}" placeholder="WHERE (REQUIRED)" maxlength="120">
        <textarea class="nf-field" name="context" rows="4" maxlength="1000" placeholder="OVERVIEW">${esc(it.context)}</textarea>
        <input class="nf-field" name="t_year" type="number" value="${it.t_year ?? ''}" placeholder="YEAR">
        <select class="nf-field" name="t_month"><option value="">MONTH</option>${T_MONTHS.map((m2, i) => `<option value="${i + 1}" ${it.t_month === i + 1 ? 'selected' : ''}>${m2}</option>`).join('')}</select>
        <select class="nf-field" name="t_period"><option value="">SEASON</option>${T_PERIODS.map((p2) => `<option ${it.t_period === p2 ? 'selected' : ''}>${p2}</option>`).join('')}</select>
        <select class="nf-field" name="t_modifier"><option value="">EARLY / MID / LATE</option>${T_MODS.map((m2) => `<option ${it.t_modifier === m2 ? 'selected' : ''}>${m2}</option>`).join('')}</select>
        <select class="nf-field" name="t_modifier_scope"><option value="">\u2026 OF THE YEAR / SEASON / MONTH</option>${T_SCOPES.map((sc2) => `<option value="${sc2}" ${it.t_modifier_scope === sc2 ? 'selected' : ''}>of the ${sc2}</option>`).join('')}</select>
        </div>
        <button class="nf-post itin-start">Save</button>
        <div class="nf-foot nf-foot-3">
          <button type="button" class="nf-link-btn nf-del" data-del="${base}/delete" data-kind="itinerary" data-title="${esc(it.title || 'Untitled')}">Delete</button>
          <span></span>
          <button type="button" class="nf-link-btn" data-itin-cancel>Cancel</button>
        </div></div></form></div>`
      : titleBlock;

    // Publishing is the private switch inside the edit form now, as it is on a
    // note or a mark. The delete form is submitted by the button in the form's
    // foot, following the same convention.
    const foot = '';   // publishing is the switch in the edit form; delete is in its foot

    // One container holds the whole itinerary -- title, overview, days -- so
    // the article page is the fully expanded card and the listing shows the
    // same card truncated.
    const sideMap = itineraryMap(it, me);
    const sideSugg = itinerarySuggestions(it, me);
    const colo = skinOf(me, req) === 'modern' ? itineraryColophon(it, me) : '';
    const main = `<h3 class="strip"><a class="crumb" href="/u/${esc(author.handle)}">${esc(author.handle)}</a> \u203a <a class="crumb" href="/t${me && me.id === it.user_id ? '' : '?u=' + encodeURIComponent(author.handle)}">Itineraries</a> \u203a <span>Itinerary</span></h3>
    <div class="itin-cols">
      <div class="itin-main"><article class="note itin-note">${bylineRow}<div class="itin-shell">${head}
      ${conflicts.length ? `<p class="itin-conflict">${conflicts.map(esc).join('<br>')}</p>` : ''}
      ${dayBlocks}${looseBlock}${addDay}</div></article>${foot}</div>
      ${sideMap || sideSugg || colo ? `<aside class="itin-side">${sideMap}${sideSugg}${colo}</aside>` : ''}
    </div>
    ${owner ? `<script>${ITIN_JS}</script>` : ''}`;
    const body = `<div class="cols profile-cols">${profileRail(author, me, 'itineraries')}
  <section class="feed profile-feed itin-page">${main}</section>
</div>`;
    send(res, layout({ title: it.title || 'Itinerary', body, me, req }));
  },

  ensembles(req, res, me) {
    if (!me) return need();
    const rows = q('SELECT * FROM ensembles WHERE user_id=? ORDER BY id DESC').all(me.id);
    const main = `<h3 class="strip"><a class="crumb" href="/u/${esc(me.handle)}">${esc(me.handle)}</a> \u203a <span>Ensembles</span></h3>

    <div class="ens-grid">${rows.map((e) => {
      const pa = e.primary_artifact_uid ? q('SELECT image_uid FROM ensemble_artifacts WHERE uid=?').get(e.primary_artifact_uid) : null;
      const st = ensStats(e.id);
      return `<a class="ens-tile" href="/e/${e.id}">
        <span class="ens-tile-media">${pa ? imgTag('/i/' + pa.image_uid, e.title) : '<span class="ens-tile-blank"></span>'}</span>
        <span class="ens-tile-meta">
          <span class="ens-tile-t">${esc(e.title)}${e.private ? ' <i>private</i>' : ''}</span>
          ${e.description ? `<span class="ens-tile-d">${esc(e.description)}</span>` : ''}
          ${statChips([['pieces', st.total], ['from notes', st.fromNotes], ['sources', st.sourceImages]])}</span></a>`;
    }).join('')}</div>${rows.length ? '' : emptyState(me, 'ensembles')}`;
    // "profiles > ensembles" — this stands beside every other post page, so
    // it keeps the same rail rather than floating as a bare, chromeless screen.
    const body = `<div class="cols profile-cols">${profileRail(me, me, 'ensembles')}
  <section class="feed profile-feed">${main}</section>
</div>`;
    send(res, layout({ title: 'Ensembles', body, me, nav: 'home' }));
  },

  // The worksurface. Everything an AI did must be legible here: what exists,
  // what it is made of, which pieces are still unidentified, and which of them
  // entered the member's notes along the way.
  ensemble(req, res, me, url, id) {
    const e = q('SELECT * FROM ensembles WHERE id=?').get(id);
    if (!e || !ensCanSee(e, me)) return send(res, layout({ title: 'Not found', body: '<p>No such ensemble.</p>', me }), 404);
    const mine = me && me.id === e.user_id;
    const v = ensembleView(e, me);
    const primary = v.artifacts.find((a) => a.is_primary) || v.artifacts[0];
    const alts = v.artifacts.filter((a) => !primary || a.artifact_uid !== primary.artifact_uid);
    // Every post page keeps the member's rail beside it; the Ensemble is a post.
    const author = q('SELECT * FROM users WHERE id=?').get(e.user_id);
    const body = `<div class="cols profile-cols">${profileRail(author, me, 'ensembles')}
<section class="feed profile-feed ens-feed itin-page">
  <h3 class="strip"><a class="crumb" href="/u/${esc(author.handle)}">${esc(author.handle)}</a> \u203a <a class="crumb" href="/u/${esc(author.handle)}?tab=ensembles">Ensembles</a> \u203a <span>Ensemble</span></h3>
  <section class="ens itin-cols">
  <article class="note itin-note ens-main">
  <div class="byline"><span class="byline-who"><a href="/u/${esc(author.handle)}">${avatar({ handle: author.handle, avatar: author.avatar })}</a>${stackDate(v.created_at)}</span>${mine ? `<label class="card-edit" for="ens-edit-${e.id}">Edit</label>` : ''}</div>
  <div class="itin-shell ens-shell">
  ${mine ? `<input type="checkbox" id="ens-edit-${e.id}" class="itin-edit-toggle" hidden>` : ''}
  <div class="itin-head-read">
  <div class="ens-head itin-head">
    <p class="who"><a href="/u/${esc(author.handle)}">${esc(author.handle)}</a> ${e.private ? '<span class="who-private">privately composed</span>' : 'composed'}</p>
    <h1 class="ens-title">${esc(v.title)}</h1>
    ${v.description ? `<p class="ens-desc itin-ctx">${esc(v.description)}</p>` : ''}
    ${v.status === 'pending_review' ? '<p class="ens-meta"><b class="ens-pending">Pending review</b></p>' : ''}
    ${mine && v.status === 'pending_review' ? `<div class="ens-review">
      <p class="ens-review-q">Keep this on discriminant.ly?</p>
      <form method="post" action="/e/${e.id}/keep"><button class="btn3d">Keep</button></form>
      <form method="post" action="/e/${e.id}/discard"><button class="nf-link-btn ens-danger">Discard</button></form>
    </div>` : ''}
  </div>
  </div>
  ${mine ? `<div class="itin-head-edit"><form class="nf nf-compact itin-new itin-edit-form ens-edit" method="post" action="/e/${e.id}/edit"><div class="nf-box">
    <div class="nf-top"><span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${e.private ? 'checked' : ''}><span></span></label></div>
    <div class="nf-stack">
      <input class="nf-field" name="title" value="${esc(v.title)}" placeholder="TITLE" required maxlength="120">
      <textarea class="nf-field" name="description" rows="4" maxlength="1000" placeholder="DESCRIPTION">${esc(v.description)}</textarea>
    </div>
    <button class="nf-post itin-start">Save</button>
    <div class="nf-foot nf-foot-3">
      <button type="button" class="nf-link-btn nf-del" data-del="/e/${e.id}/delete" data-kind="ensemble" data-title="${esc(v.title)}">Delete</button>
      <span></span>
      <button type="button" class="nf-link-btn" data-ens-cancel>Cancel</button>
    </div>
  </div></form></div>` : ''}
  ${primary ? `<div class="ens-primary">${imgTag(primary.image, v.title, null, true)}</div>` : ''}
  ${alts.length ? `<div class="ens-alts">${alts.map((a) => `<figure class="ens-alt">
      ${imgTag(a.image, v.title + " alternate")}
      ${mine ? `<form method="post" action="/e/${e.id}/primary"><input type="hidden" name="artifact_uid" value="${a.artifact_uid}"><button class="nf-link-btn">Make primary</button></form>
      <form method="post" action="/e/${e.id}/artifact/remove"><input type="hidden" name="artifact_uid" value="${a.artifact_uid}"><button class="nf-link-btn ens-danger">Remove</button></form>` : ''}
    </figure>`).join('')}</div>` : ''}
  </div></article>
  <aside class="ens-side"><div class="ens-parts">
    <h4 class="ens-parts-h">What's in it</h4>
    ${(() => {
      // Grouped by where each piece came from, because "already mine" and
      // "this composition put it in my notes" are different facts about the
      // member's catalogue and reading them interleaved hides that.
      const groups = [
        ['From your notes', v.components.filter((c) => c.note_available && c.note_origin === 'pre_existing')],
        ['Added to your notes by this ensemble', v.components.filter((c) => c.note_available && c.note_origin === 'created_by_ensemble')],
        ['Not identified', v.components.filter((c) => !c.note_available)],
      ].filter(([, list]) => list.length);
      if (!groups.length) return '<ul class="ens-comps"><li class="ens-comp"><span class="ens-comp-body">No components.</span></li></ul>';
      return groups.map(([heading, list]) => `<p class="ens-group">${heading} <i>${list.length}</i></p>
      ${list.some((c) => c.note_available) ? (() => {
        // A resolved component IS one of the member's notes, so show it as
        // one — the same card the feed uses — rather than a row that merely
        // points at it. Unresolved pieces have no note to show and stay rows.
        const cards = list.filter((c) => c.note_available)
          .map((c) => { const o = q(OBJ_SQL + ' WHERE o.id=?').get(c.note_id); return o && canSee(o, me) ? objectCard(o, me) : ''; })
          .filter(Boolean);
        return cards.length ? `<div class="grid ens-note-grid">${cards.join('')}</div>` : '';
      })() : `<ul class="ens-comps">${list.map((c) => {
        const media = c.image ? imgTag(c.image, c.label) : '<span class="ens-comp-blank"></span>';
        const label = esc(c.label || 'Unidentified');
        // The whole row is the link when there is a note behind it — a label
        // that looks like a thing should behave like one.
        const body = c.note_available
          ? `<a class="ens-comp-link" href="/o/${c.note_id}">${media}<span class="ens-comp-body">
               <span class="ens-comp-label">${label}</span>
               <span class="ens-comp-state">${c.note_origin === 'created_by_ensemble' ? 'Added to your notes' : 'In your notes'} ›</span>
             </span></a>`
          : `${media}<span class="ens-comp-body">
               <span class="ens-comp-label">${label}</span>
               <span class="ens-comp-state">${c.state === 'unresolved' ? 'Not identified yet' : 'No longer in your notes'}</span>
             </span>`;
        return `<li class="ens-comp ${c.state}${c.note_available ? ' is-linked' : ''}">${body}
        ${mine ? `<form method="post" action="/e/${e.id}/component/remove"><input type="hidden" name="component_uid" value="${c.component_uid}"><button class="nf-link-btn ens-danger">Remove</button></form>` : ''}
      </li>`;
      }).join('')}</ul>`}`).join('');
    })()}
  </div>
  ${skinOf(me, req) === 'modern' ? ensembleColophon(e, me) : ''}
</aside></section></section></div>`;
    send(res, layout({ title: v.title, body, me, nav: 'home' }));
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
<section class="feed profile-feed mark-page">
<h3 class="strip"><a class="crumb" href="/u/${esc(author.handle)}">${esc(author.handle)}</a> › <a class="crumb" href="/u/${esc(author.handle)}?tab=marks">Travel Marks</a> › <span class="crumb-here">Mark</span></h3>
<div class="mark-layout">
  <div class="mark-main"><div class="grid grid-single">${markCard(m, me, true)}</div></div>
</div>
  ${visits.length ? `<aside class="visit-log">
    <h3 class="lbl">Check-ins</h3>
    <ol class="timeline">${visits.map((v) => {
      // One visit, several day logs: the days nest INSIDE the check-in's
      // card as a subordinate column, never as further timeline entries.
      const days = visitDaysOf(v.id);
      const label = visitLabel(v);
      return `<li>
      <span class="tl-date">${esc(label)}</span>
      ${v.body ? `<span class="tl-body">${esc(v.body)}</span>` : ''}
      ${days.length ? `<ul class="tl-days">${days.map((d) => `<li><span class="tl-date">${esc(prettyDayShort(d.day))}</span><span class="tl-body">${esc(d.body)}</span></li>`).join('')}</ul>` : ''}
      ${owner ? `<span class="tl-actions">
        <button class="tl-edit" data-edit="/m/${m.id}/visits/${v.id}/edit" data-day="${esc(label)}" data-start="${v.date_known === 0 ? '' : v.visited_on}" data-end="${v.ended_on || ''}" data-undated="${v.date_known === 0 ? '1' : ''}" data-body="${esc(v.body || '')}" data-days="${esc(JSON.stringify(days.map((d) => ({ date: d.day, body: d.body }))))}" data-place="${esc(m.name)}" aria-label="Edit this check-in">Edit</button>
        <button class="tl-del" data-del="/m/${m.id}/visits/${v.id}/delete" data-day="${esc(label)}" aria-label="Remove this check-in">×</button>
      </span>` : ''}
    </li>`; }).join('')}</ol>
  </aside>` : ''}
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
  <ul class="comment-list">${cmts.map((c) => `<li><a href="/u/${esc(c.handle)}">${avatar(c)}</a><div class="comment-body"><p class="comment-meta"><a href="/u/${esc(c.handle)}">${esc(c.handle)}</a> \u00b7 <span class="stamp">${timeAgo(c.created_at)}</span>${me && me.id === c.user_id ? `<label class="card-edit comment-edit" for="cmt-m-${c.id}">Edit</label>` : ''}</p><p class="comment-text">${esc(c.body)}</p>${me && (me.id === c.user_id || me.id === m.user_id || me.is_admin) ? `<input type="checkbox" id="cmt-m-${c.id}" class="cmt-toggle" hidden><form method="post" action="/m/${m.id}/comments/${c.id}" class="nf nf-compact cmt-edit"><div class="nf-box"><div class="nf-stack"><textarea class="nf-field" name="body" rows="3" maxlength="600">${esc(c.body)}</textarea></div><button class="nf-post">Save</button><div class="nf-foot nf-foot-3"><button type="button" class="nf-link-btn nf-del" data-del="/m/${m.id}/comments/${c.id}/delete" data-kind="comment" data-title="${esc(c.body.slice(0, 48))}">Delete</button><span></span><button type="button" class="nf-link-btn" data-cmt-cancel>Cancel</button></div></div></form>` : ''}</div></li>`).join('')}</ul>
</section>
${skinOf(me, req) === 'modern' ? markColophon(m, me) : ''}
</section></div>
<script>
// One binding. This block previously bound .tl-edit TWICE (with different CTA
// copy), so every click opened the dialog twice; the later binding was the
// intended one and the check-in dialog now replaces both.
document.querySelectorAll('.tl-edit').forEach(function (b) {
  b.addEventListener('click', function () {
    window.openCheckin({ action: b.dataset.edit, place: b.dataset.place, editing: true,
      start: b.dataset.start, end: b.dataset.end, body: b.dataset.body, undated: b.dataset.undated === '1',
      days: JSON.parse(b.dataset.days || '[]') });
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
    const tab = ['activity', 'notes', 'marks', 'warrants', 'ensembles', 'followers', 'following'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'activity';
    const cid = +url.searchParams.get('c') || 0; const vis = url.searchParams.get('v') || 'all'; const s = (url.searchParams.get('q') || '').trim();
    const visible = q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC').all(u.id).filter((o) => canSee(o, me));
    const fc = followCounts(u.id);
    const colls = q("SELECT id, name FROM collections WHERE user_id=? AND kind='note' ORDER BY name").all(u.id).map((c) => {
      const ids = new Set(q('SELECT note_id FROM note_collections WHERE collection_id=?').all(c.id).map((r) => r.note_id));
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
        // The card itself is the way in — a Follow button here competed with
        // it for the tap. What the member actually wants at a glance is a
        // sense of the person, so the row carries their counts instead.
        const pc = followCounts(p.id);
        const pub = (t) => q(`SELECT COUNT(*) c FROM ${t} WHERE user_id=?` + (me && me.id === p.id ? '' : ' AND private=0')).get(p.id).c;
        // avatar and handle are one lock-up, as in the welcome table; the
        // chips are their own column beside it, both centred in the row.
        return `<li><a class="person" href="/u/${esc(p.handle)}">
          <span class="person-id">${avatar(p)}<span class="person-name">${esc(p.handle)}</span></span>
          <span class="person-body">${statChips([['notes', pub('objects')], ['marks', pub('marks')],
            ['ensembles', q('SELECT COUNT(*) c FROM ensembles WHERE user_id=?' + (me && me.id === p.id ? '' : ' AND private=0')).get(p.id).c],
            ['warrants', warrantedSubjectUids(p.id, 'object').size + warrantedSubjectUids(p.id, 'mark').size],
            ['followers', pc.followers], ['following', pc.following]])}</span></a></li>`;
      }).join('')}</ul>${rows.length ? '' : emptyState(me, tab, u)}`;
    } else if (tab === 'warrants') {
      const objUids = warrantedSubjectUids(u.id, 'object'), markUids = warrantedSubjectUids(u.id, 'mark');
      const acts = [];
      for (const uid of objUids) {
        // OBJ_SQL, not a bare select: the byline needs the author's handle,
        // name and avatar, which only come from the users join. Without it the
        // card renders an avatar-less byline even for your own notes.
        const o = q(OBJ_SQL + ' WHERE o.uid=?').get(uid);
        if (o && canSee(o, me)) acts.push({ at: o.created_at, card: o });
      }
      for (const uid of markUids) {
        const x = q(MARK_SQL + ' WHERE m.uid=?').get(uid);
        if (x && (!x.private || owner)) acts.push({ at: x.created_at, mark: x });
      }
      acts.sort((a, b) => (a.at < b.at ? 1 : -1));
      const wpg = pageOf(acts, url);
      main = `<h3 class="strip">${esc(u.handle)}\u2019s warrants</h3>
      <div class="activity-feed" id="feed-grid">${wpg.slice.map((a) => a.mark
        ? `<div class="act-note">${markCard(a.mark, me)}</div>`
        : `<div class="act-note">${objectCard(a.card, me)}</div>`).join('')}</div>${moreLink(url, wpg.off, wpg.more)}
      ${acts.length ? '' : emptyState(me, tab, u)}`;
    } else if (tab === 'ensembles') {
      // Same privacy rule as every other profile surface: a visitor sees only
      // public ensembles; the owner sees their own private ones too.
      const rows = q('SELECT * FROM ensembles WHERE user_id=? ORDER BY id DESC').all(u.id)
        .filter((e) => ensCanSee(e, me));
      main = `<h3 class="strip">${esc(u.handle)}\u2019s ensembles</h3>
      <div class="ens-grid">${rows.map((e) => {
        const pa = e.primary_artifact_uid ? q('SELECT image_uid FROM ensemble_artifacts WHERE uid=?').get(e.primary_artifact_uid) : null;
        const st = ensStats(e.id);
        return `<a class="ens-tile" href="/e/${e.id}">
          <span class="ens-tile-media">${pa ? imgTag('/i/' + pa.image_uid, e.title) : '<span class="ens-tile-blank"></span>'}</span>
          <span class="ens-tile-meta">
            <span class="ens-tile-t">${esc(e.title)}${e.private ? ' <i>private</i>' : ''}</span>
            ${e.description ? `<span class="ens-tile-d">${esc(e.description)}</span>` : ''}
            ${statChips([['pieces', st.total], ['from notes', st.fromNotes], ['sources', st.sourceImages]])}</span></a>`;
      }).join('')}</div>${rows.length ? '' : emptyState(me, tab, u)}`;
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
      if (cid) { const ids = new Set(q('SELECT note_id FROM note_collections WHERE collection_id=?').all(cid).map((r) => r.note_id)); rows = rows.filter((o) => ids.has(o.id)); }
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
      for (const n of q(`SELECT created_at, id, name, private, user_id FROM objects
        WHERE user_id=? AND renoted_from_uid IS NOT NULL ORDER BY created_at DESC LIMIT 30`).all(u.id))
        if (canSee(n, me)) acts.push({ at: n.created_at, html: `collected <a href="/o/${n.id}">${esc(n.name)}</a>` });
      for (const x of q(MARK_SQL + ' WHERE m.user_id=? ORDER BY m.id DESC LIMIT 30').all(u.id))
        if (!x.private || owner) acts.push({ at: x.created_at, card: null, html: null, mark: x });
      for (const f of q('SELECT f.created_at, u2.* FROM follows f JOIN users u2 ON u2.id=f.followee_id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 20').all(u.id))
        acts.push({ at: f.created_at, follow: f });
      // itineraries: first-class, same visibility rule as marks and notes
      for (const it of q('SELECT * FROM itineraries WHERE user_id=? ORDER BY id DESC LIMIT 20').all(u.id))
        if (canSee(it, me)) acts.push({ at: it.created_at, itin: it });
      acts.sort((a, b) => (a.at < b.at ? 1 : -1));
      const apg = pageOf(acts, url);
      main = `<h3 class="strip">All activity</h3>
      <div class="activity-feed" id="feed-grid">${apg.slice.map((a) => a.itin
        ? `<div class="act-note">${itineraryPreview(a.itin, me)}</div>`
        : a.mark
        ? `<div class="act-note">${markCard(a.mark, me)}</div>`
        : a.follow
        ? `<div class="act-note"><article class="act-follow"><div class="follow-card">
             <a class="follow-who" href="/u/${esc(u.handle)}">${avatar(u)}<span>${esc(u.handle)}</span></a>
             <span class="follow-verb"><span class="follow-line"></span>followed<span class="follow-line"></span></span>
             <a class="follow-who" href="/u/${esc(a.follow.handle)}">${avatar(a.follow)}<span>${esc(a.follow.handle)}</span></a>
             <span class="follow-when">${timeAgo(a.at)}</span></div></article></div>`
        : a.card
        ? `<div class="act-note">${objectCard(a.card, me)}</div>`
        : `<div class="act-line"><span class="act-date">${timeAgo(a.at)}</span><span>${esc(u.handle)} ${a.html}</span></div>`).join('')}</div>${acts.length ? '' : emptyState(me, 'activity', u)}${moreLink(url, apg.off, apg.more)}`;
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
    send(res, layout({ title: 'Sign in', body, me, req, cls: 'is-dark-page' }));
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
    send(res, layout({ title: 'Join', body, me, req, cls: 'is-dark-page' }));
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
    const mine = q('SELECT * FROM invites WHERE from_user=? ORDER BY created_at DESC').all(me.id);
    const unusedInvites = mine.filter((i) => !i.used_by);
    const body = `<h3 class="strip dark-strip">Your Account Settings</h3>
<div class="settings">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <div class="settings-grid">
    <div class="settings-col">
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
        <div class="wcell wcell-wide"><form method="post" action="/logout"><button class="btn3d block">Sign out</button></form></div>
      </div>
    </div>
    <div class="settings-col settings-col-outward">
      <div class="settings-stack">
        <div class="wtable settings-table settings-look">
          <div class="wcell wcell-wide">
            <p class="sbox-title">Look and feel</p>
            <p class="sbox-sub">Classic is the original design. Modern glass is the same discriminant.ly on a new material.</p>
            <form method="post" action="/settings/skin" class="look-form">
              <input type="hidden" name="mode" value="${modeOf(me)}">
              <div class="nf-top look-row"><span class="nf-lbl">Modern glass</span>
                <label class="switch"><input type="checkbox" name="skin" value="modern" ${skinOf(me) === 'modern' ? 'checked' : ''} onchange="this.form.submit()"><span></span></label></div>
            </form>
            ${skinOf(me) === 'modern' ? `<form method="post" action="/settings/skin" class="look-form" id="look-mode-form">
              <input type="hidden" name="skin" value="modern"><input type="hidden" name="mode" value="${modeOf(me)}">
              <span class="nf-lbl">Appearance</span>
              <div class="vis-tabs look-modes">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) =>
                `<a class="${modeOf(me) === v ? 'on' : ''}" href="#" data-mode="${v}" data-short="${l}">${l}</a>`).join('')}
              </div>
              <p class="lookup-note">Auto follows your device.</p>
            </form>
            <script>document.querySelectorAll('#look-mode-form [data-mode]').forEach(function (a) { a.addEventListener('click', function (e) {
              e.preventDefault(); var f = a.closest('form'); f.elements.mode.value = a.dataset.mode; f.submit(); }); });</script>` : ''}
          </div>
        </div>
        <div class="wtable settings-table settings-connector">
          <div class="wcell wcell-wide">
            <p class="sbox-title">Connect to your AI</p>
            <p class="sbox-sub">Connect ChatGPT or Claude to your Discriminantly memory and work with your Notes, Marks, Collections, Ensembles, and more from any conversation.</p>
            ${me.api_token ? `<p class="conn-url"><code>${esc(baseUrl(req))}/mcp/${esc(me.api_token)}</code></p>` : '<p class="empty center">No connector URL yet.</p>'}
            <p class="fine center">Claude: Settings → Connectors → Add custom connector.<br>ChatGPT (paid plans): Settings → Connectors → Advanced → Developer mode, then Create → No authentication.<br>Treat the URL like a password.</p>
            <form method="post" action="/settings/token"><button class="btn3d block">${me.api_token ? 'Replace connector URL' : 'Create connector URL'}</button></form>
            <form method="post" action="/settings/ingest" class="ingest-mode">
              <span class="nf-lbl">How AI sends images</span>
              <select class="nf-field" name="mode" onchange="this.form.submit()">
                <option value="auto"${(me.ingest_mode || 'auto') === 'auto' ? ' selected' : ''}>Automatic (recommended)</option>
                <option value="always_chunk"${me.ingest_mode === 'always_chunk' ? ' selected' : ''}>Always in pieces</option>
                <option value="never_chunk"${me.ingest_mode === 'never_chunk' ? ' selected' : ''}>Always in one go (testing)</option>
              </select>
              <p class="lookup-note">Leave this on Automatic unless you are troubleshooting how images reach discriminant.ly.</p>
            </form>
          </div>
        </div>
        <div class="wtable settings-table settings-invites">
          <div class="wcell wcell-wide">
            <p class="sbox-title">Bring someone in</p>
            <p class="sbox-sub">Each member may hold a few open invites at a time.</p>
            <form method="post" action="/invites"><button class="btn3d block" ${unusedInvites.length >= 5 ? 'disabled' : ''}>Create an invite</button></form>
            <p class="fine center">${unusedInvites.length} of 5 open</p>
            ${mine.length ? mine.map((i) => `<div class="invite-row">
              ${i.used_by
                ? `<p class="fine center">Used by @${esc(q('SELECT handle FROM users WHERE id=?').get(i.used_by).handle)}</p>`
                : `<p class="conn-url"><code>${esc(baseUrl(req))}/join?code=${i.code}</code></p>`}
            </div>`).join('') : ''}
          </div>
        </div>
      </div>
      <div class="wtable settings-table install-box" id="install-box" hidden>
        <div class="wcell wcell-wide">
          <p class="sbox-title">Install Discriminantly</p>
          <p class="sbox-sub">Keep it on your Home Screen and open it like an app.</p>
          <button type="button" class="btn3d block" id="install-btn">Install Discriminantly</button>
        </div>
      </div>
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
  <img class="splash-mark" src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="60" height="80">
  <p class="splash-word">discriminant.ly</p>
  <h1 class="splash-h">Your interests. Your travels. Wherever you go.</h1>
  <p class="splash-sub">Keep the things you notice, the places you go, and the experiences worth remembering. Connects to your AI to help you add, enrich, explore, and discover what comes next.</p>
  <a class="btn splash-enter" href="/">Enter</a>
  <div class="splash-install" id="splash-install" hidden>
    <button type="button" class="nf-post" id="splash-install-btn">Install Discriminantly</button>
  </div>
</section>
<div class="shot-wrap">
  <div class="shot-shadow"></div>
  <div class="shot-frame">
    <div class="shot-chrome"><span></span><span></span><span></span></div>
    ${skinOf(me, req) !== 'modern'
      ? `<img src="/welcome-shot.jpg" alt="Discriminantly on the desktop" width="1800" height="1055">`
      : modeOf(me, req) === 'light' ? `<img src="/welcome-shot-modern-light.jpg" alt="Discriminantly on the desktop" width="2000" height="1174">`
      : modeOf(me, req) === 'dark' ? `<img src="/welcome-shot-modern-dark.jpg" alt="Discriminantly on the desktop" width="2000" height="1174">`
      : `<picture><source srcset="/welcome-shot-modern-light.jpg" media="(prefers-color-scheme: light)"><img src="/welcome-shot-modern-dark.jpg" alt="Discriminantly on the desktop" width="2000" height="1174"></picture>`}
  </div>
</div>
<section class="splash-pair itin-shell">
  <p class="splash-pair-lead">Use your AI to discover new places and plan day trips and itineraries</p>
  <div class="phones">
    <figure class="phone-wrap">
      <span class="phone-body">
      <span class="phone-shadow"></span>
      <span class="phone"><span class="phone-notch"></span>
        ${skinOf(me, req) === 'modern' && modeOf(me, req) === 'light'
          ? `<img src="/welcome-phone-profile-light.jpg" alt="A Discriminantly profile" width="900" height="1845" loading="lazy">`
          : skinOf(me, req) === 'modern' && modeOf(me, req) === 'dark'
          ? `<img src="/welcome-phone-profile-dark.jpg" alt="A Discriminantly profile" width="900" height="1845" loading="lazy">`
          : `<picture><source srcset="/welcome-phone-profile-light.jpg" media="(prefers-color-scheme: light)"><img src="/welcome-phone-profile-dark.jpg" alt="A Discriminantly profile" width="900" height="1845" loading="lazy"></picture>`}
      </span></span>
      <figcaption>Your profile is a record of your interests and taste</figcaption>
    </figure>
    <figure class="phone-wrap">
      <span class="phone-body">
      <span class="phone-shadow"></span>
      <span class="phone"><span class="phone-notch"></span>
        <img src="/welcome-phone-ask.jpg" alt="Asking an AI to plan a trip" width="900" height="1845" loading="lazy">
      </span></span>
      <figcaption>Enhancing your AI\u2019s ability to recommend</figcaption>
    </figure>
  </div>
  <p class="splash-pair-lead splash-pair-lead-2">Make any changes to your plans on AI as you please</p>
  <div class="phones">
    <figure class="phone-wrap">
      <span class="phone-body">
      <span class="phone-shadow"></span>
      <span class="phone"><span class="phone-notch"></span>
        <img src="/welcome-phone-chat.jpg" alt="Planning a trip in a conversation with an AI" width="900" height="1845" loading="lazy">
      </span></span>
      <figcaption>Plan conversationally</figcaption>
    </figure>
    <figure class="phone-wrap">
      <span class="phone-body">
      <span class="phone-shadow"></span>
      <span class="phone"><span class="phone-notch"></span>
        ${skinOf(me, req) === 'modern' && modeOf(me, req) === 'light'
          ? `<img src="/welcome-phone-app-light.jpg" alt="The same day as an itinerary in Discriminantly" width="900" height="1845" loading="lazy">`
          : skinOf(me, req) === 'modern' && modeOf(me, req) === 'dark'
          ? `<img src="/welcome-phone-app-dark.jpg" alt="The same day as an itinerary in Discriminantly" width="900" height="1845" loading="lazy">`
          : `<picture><source srcset="/welcome-phone-app-light.jpg" media="(prefers-color-scheme: light)"><img src="/welcome-phone-app-dark.jpg" alt="The same day as an itinerary in Discriminantly" width="900" height="1845" loading="lazy"></picture>`}
      </span></span>
      <figcaption>We build it in the background</figcaption>
    </figure>
  </div>
  <p class="splash-pair-lead splash-pair-lead-2">Your plans get stored with Discriminantly \u2014 you choose whether to interface primarily with your AI or enjoy both</p>
  <div class="shot-wrap splash-shot-2">
    <div class="shot-shadow"></div>
    <div class="shot-frame">
      <div class="shot-chrome"><span></span><span></span><span></span></div>
      ${skinOf(me, req) === 'modern' && modeOf(me, req) === 'light'
        ? `<img src="/welcome-shot-itin-light.jpg" alt="An itinerary in Discriminantly, with its map and nearby travel marks" width="2000" height="1174" loading="lazy">`
        : skinOf(me, req) === 'modern' && modeOf(me, req) === 'dark'
        ? `<img src="/welcome-shot-itin-dark.jpg" alt="An itinerary in Discriminantly, with its map and nearby travel marks" width="2000" height="1174" loading="lazy">`
        : `<picture><source srcset="/welcome-shot-itin-light.jpg" media="(prefers-color-scheme: light)"><img src="/welcome-shot-itin-dark.jpg" alt="An itinerary in Discriminantly, with its map and nearby travel marks" width="2000" height="1174" loading="lazy"></picture>`}
    </div>
  </div>
</section>
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
    send(res, layout({ title: 'Welcome', body, me, req, cls: 'is-welcome' }));
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
const OS_ADOPTED = { type: 'object', additionalProperties: false, required: ['count', 'note_uids'],
  properties: { count: { type: 'integer' }, note_uids: { type: 'array', items: { type: 'string' } } } };
// basis is required: flattening it would erase the difference between a member
// saying "these are the same thing" and an external identifier implying it.
const OS_EQUIVALENT = { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['note_uid', 'basis', 'relation_uid'],
  properties: { note_uid: { type: 'string' }, basis: { type: 'string', enum: ['user', 'external'] },
    relation_uid: { type: 'string' } } } };
const OS_PROVENANCE = { type: ['object', 'null'], additionalProperties: false,
  required: ['action', 'assertion', 'actor_type', 'agent', 'created_at'],
  properties: { action: { type: 'string' }, assertion: { type: 'string' }, actor_type: { type: 'string' },
    agent: { type: 'string' }, created_at: { type: 'string' } } };
// Every mutating tool returns this same shape, so a caller can chain on the
// result (take `id`, feed it to the next call) instead of parsing prose.
// `action` names the semantic act, matching the provenance vocabulary.
const OS_LINEAGE = { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['component_uid', 'state_at_generation', 'note_uid_at_generation', 'label_at_generation', 'image_uid_at_generation', 'position_at_generation'],
  properties: { component_uid: { type: 'string' },
    state_at_generation: { type: 'string', enum: ['unresolved', 'linked'] },
    note_uid_at_generation: { type: ['string', 'null'] }, label_at_generation: { type: 'string' },
    image_uid_at_generation: { type: ['string', 'null'] }, position_at_generation: { type: 'integer' } } } };
const OS_ARTIFACT = { type: 'object', additionalProperties: false,
  required: ['artifact_uid', 'image', 'is_primary', 'lineage', 'created_at'],
  properties: { artifact_uid: { type: 'string' }, image: { type: 'string' },
    is_primary: { type: 'boolean' }, lineage: OS_LINEAGE, created_at: { type: 'string' } } };
// note_uid is null and note_available false when the viewer may not see the
// linked Note — the private record is absent from the response, not masked.
const OS_COMPONENT = { type: 'object', additionalProperties: false,
  required: ['component_uid', 'position', 'state', 'label', 'image', 'source_url', 'note_uid', 'note_id', 'note_origin', 'note_available', 'history'],
  properties: { component_uid: { type: 'string' }, position: { type: 'integer' },
    state: { type: 'string', enum: ['unresolved', 'linked'] },
    label: { type: 'string' }, image: { type: 'string' }, source_url: { type: 'string' },
    note_uid: { type: ['string', 'null'] }, note_id: { type: ['integer', 'null'] },
    note_origin: { type: ['string', 'null'], enum: ['pre_existing', 'created_by_ensemble', null] },
    note_available: { type: 'boolean' },
    history: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['action', 'basis', 'note_uid', 'actor', 'assertion', 'superseded', 'at'],
      properties: { action: { type: 'string' }, basis: { type: ['string', 'null'] },
        note_uid: { type: ['string', 'null'] }, actor: { type: 'string' },
        assertion: { type: 'string' }, superseded: { type: ['string', 'null'] }, at: { type: 'string' } } } } } };
const OS_ENSEMBLE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'title', 'description', 'private', 'status', 'created_at', 'updated_at', 'primary_artifact_uid', 'artifacts', 'components', 'provenance'],
  properties: { type: { const: 'ensemble' }, uid: { type: 'string' }, id: { type: 'integer' },
    title: { type: 'string' }, description: { type: 'string' }, private: { type: 'boolean' },
    status: { type: 'string', enum: ['pending_review', 'saved'] },
    created_at: { type: 'string' }, updated_at: { type: ['string', 'null'] },
    primary_artifact_uid: { type: ['string', 'null'] },
    artifacts: { type: 'array', items: OS_ARTIFACT },
    components: { type: 'array', items: OS_COMPONENT }, provenance: OS_PROVENANCE } };
const OS_ENSEMBLE_BRIEF = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'title', 'private', 'primary_image', 'component_count', 'unresolved_count', 'created_at'],
  properties: { type: { const: 'ensemble' }, uid: { type: 'string' }, id: { type: 'integer' },
    title: { type: 'string' }, private: { type: 'boolean' }, primary_image: { type: ['string', 'null'] },
    component_count: { type: 'integer' }, unresolved_count: { type: 'integer' }, created_at: { type: 'string' } } };
// The compound result: everything the save actually did, so the model can
// report it without stitching together further calls.
const OS_ENSEMBLE_SAVE = { type: 'object', additionalProperties: false,
  required: ['ok', 'status', 'ensemble_uid', 'ensemble_id', 'private', 'primary_artifact_uid', 'components', 'notes_created', 'notes_reused', 'unresolved_component_uids'],
  properties: { ok: { type: 'boolean' },
    status: { type: 'string', enum: ['pending_review', 'saved'],
      description: 'pending_review means staged and awaiting the member\'s keep/discard decision; saved means committed.' },
    ensemble_uid: { type: 'string' }, ensemble_id: { type: 'integer' },
    private: { type: 'boolean' }, primary_artifact_uid: { type: ['string', 'null'] },
    artifacts: { type: 'array', items: { type: 'string' } },
    artifact_image_uid: { type: ['string', 'null'], description: 'The stored image behind the primary artifact.' },
    components: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['component_uid', 'state', 'note_uid', 'note_origin', 'label', 'image_uid'],
      properties: { component_uid: { type: 'string' }, state: { type: 'string' },
        note_uid: { type: ['string', 'null'] }, note_origin: { type: ['string', 'null'] }, label: { type: 'string' },
        image_uid: { type: ['string', 'null'], description: 'The stored image actually persisted for this component.' } } } },
    notes_created: { type: 'array', items: { type: 'string' } },
    notes_reused: { type: 'array', items: { type: 'string' } },
    unresolved_component_uids: { type: 'array', items: { type: 'string' } } } };
const OS_DISCARD = { type: 'object', additionalProperties: false,
  required: ['ok', 'ensemble_uid', 'notes_deleted', 'notes_kept'],
  properties: { ok: { type: 'boolean' }, ensemble_uid: { type: 'string' },
    notes_deleted: { type: 'array', items: { type: 'string' } },
    notes_kept: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['uid', 'name', 'reasons'],
      properties: { uid: { type: 'string' }, name: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } } } } } } };
const OS_UNRESOLVED = { type: 'object', additionalProperties: false,
  required: ['component_uid', 'ensemble_uid', 'ensemble_id', 'ensemble_title', 'label', 'image'],
  properties: { component_uid: { type: 'string' }, ensemble_uid: { type: 'string' },
    ensemble_id: { type: 'integer' }, ensemble_title: { type: 'string' },
    label: { type: 'string' }, image: { type: 'string' } } };
const wr = (text, action, subject, id, uid, name, detail) => ({ text, structured: { ok: true, action, subject, id: id ?? null, uid: uid ?? null, name: name || '', ...(detail ? { detail } : {}) } });
const OS_WRITE = { type: 'object', additionalProperties: false,
  required: ['ok', 'action', 'subject', 'id', 'uid', 'name'],
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string', enum: ['created', 'edited', 'deleted', 'asserted', 'released', 'revoked', 'corrected', 'unchanged'] },
    subject: { type: 'string', enum: ['note', 'mark', 'visit', 'ownership', 'warrant', 'image'] },
    id: { type: ['integer', 'null'], description: 'Integer id of the affected note, mark or check-in, where one applies.' },
    uid: { type: ['string', 'null'] },
    name: { type: 'string' },
    detail: { type: 'string' } } };
const OS_PLACE_CANDIDATES = { type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['name', 'lat', 'lng'],
    properties: { name: { type: 'string' }, locality: { type: 'string' }, country: { type: 'string' },
      address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } } } };
const OS_ITEMS = (itemSchema) => ({ type: 'object', additionalProperties: false, required: ['items'],
  properties: { items: { type: 'array', items: itemSchema } } });

const OS_RECENT_NOTE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'why', 'tags', 'url', 'handle', 'private', 'has_image', 'image_uid', 'image_url', 'already_adopted', 'provenance'],
  properties: { type: { const: 'object' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, why: { type: 'string' }, tags: { type: 'string' }, url: { type: 'string' },
    handle: { type: 'string' }, private: { type: 'boolean' },
    has_image: { type: 'boolean', description: 'Whether this record already has a picture stored in Discriminantly.' },
    image_uid: { type: ['string', 'null'], description: 'The stored image, when there is one. Pass this straight to create_pending_ensemble as image_uid, or to view_images to look at it. An image the member already has NEVER needs uploading again.' },
    image_url: { type: ['string', 'null'], description: 'Set instead of image_uid on older records whose picture was linked to an outside site rather than stored here. Fetch it yourself to look at the thing, and if you need it in an Ensemble, ingest it once with upload_image and use the uid that returns. Exactly one of image_uid / image_url is set when has_image is true.' },
    already_adopted: OS_ADOPTED, provenance: OS_PROVENANCE } };
// Three-valued on purpose. state:null means NEVER ASSERTED — not 'no', not
// disapproval. Consumers must not collapse null with 'released'/'revoked'.
const OS_OWNED = { type: 'object', additionalProperties: false,
  required: ['state', 'since', 'history_count'],
  properties: { state: { type: ['string', 'null'], enum: ['owned', 'released', null] },
    since: { type: ['string', 'null'] }, history_count: { type: 'integer' } } };
const OS_WARRANT = { type: 'object', additionalProperties: false,
  required: ['state', 'since', 'published', 'history_count'],
  properties: { state: { type: ['string', 'null'], enum: ['active', 'revoked', null] },
    since: { type: ['string', 'null'] }, published: { type: 'boolean' }, history_count: { type: 'integer' } } };
const OS_MY_NOTE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'why', 'tags', 'url', 'private', 'has_image', 'image_uid', 'image_url', 'renoted_from_uid', 'owned', 'warrant', 'equivalent_notes', 'provenance'],
  properties: { type: { const: 'object' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, why: { type: 'string' }, tags: { type: 'string' }, url: { type: 'string' },
    private: { type: 'boolean' },
    has_image: { type: 'boolean', description: 'Whether this record already has a picture stored in Discriminantly.' },
    image_uid: { type: ['string', 'null'], description: 'The stored image, when there is one. Pass this straight to create_pending_ensemble as image_uid, or to view_images to look at it. An image the member already has NEVER needs uploading again.' },
    image_url: { type: ['string', 'null'], description: 'Set instead of image_uid on older records whose picture was linked to an outside site rather than stored here. Fetch it yourself to look at the thing, and if you need it in an Ensemble, ingest it once with upload_image and use the uid that returns. Exactly one of image_uid / image_url is set when has_image is true.' },
    renoted_from_uid: { type: ['string', 'null'] }, owned: OS_OWNED, warrant: OS_WARRANT, equivalent_notes: OS_EQUIVALENT, provenance: OS_PROVENANCE } };
const OS_SEARCH_NOTE = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'why', 'tags', 'private', 'has_image', 'image_uid', 'image_url', 'owned', 'warrant', 'provenance'],
  properties: { type: { const: 'object' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, why: { type: 'string' }, tags: { type: 'string' },
    private: { type: 'boolean' },
    has_image: { type: 'boolean', description: 'Whether this record already has a picture stored in Discriminantly.' },
    image_uid: { type: ['string', 'null'], description: 'The stored image, when there is one. Pass this straight to create_pending_ensemble as image_uid, or to view_images to look at it. An image the member already has NEVER needs uploading again.' },
    image_url: { type: ['string', 'null'], description: 'Set instead of image_uid on older records whose picture was linked to an outside site rather than stored here. Fetch it yourself to look at the thing, and if you need it in an Ensemble, ingest it once with upload_image and use the uid that returns. Exactly one of image_uid / image_url is set when has_image is true.' },
    owned: OS_OWNED, warrant: OS_WARRANT, provenance: OS_PROVENANCE } };
const OS_SEARCH_MARK = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'locality', 'country', 'why', 'tags', 'private', 'remarked_from_uid', 'warrant', 'provenance'],
  properties: { type: { const: 'mark' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, locality: { type: 'string' }, country: { type: 'string' }, why: { type: 'string' },
    tags: { type: 'string' }, private: { type: 'boolean' }, remarked_from_uid: { type: ['string', 'null'] },
    warrant: OS_WARRANT, provenance: OS_PROVENANCE } };
const OS_MARK = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'name', 'locality', 'country', 'why', 'tags', 'private', 'verified', 'remarked_from_uid', 'has_image', 'image_uid', 'image_url', 'visit_count', 'visits', 'warrant', 'provenance'],
  properties: { type: { const: 'mark' }, uid: { type: 'string' }, id: { type: 'integer' },
    name: { type: 'string' }, locality: { type: 'string' }, country: { type: 'string' }, why: { type: 'string' },
    tags: { type: 'string' }, private: { type: 'boolean' }, verified: { type: 'boolean' },
    remarked_from_uid: { type: ['string', 'null'] },
    has_image: { type: 'boolean', description: 'Whether this mark already has a picture stored in Discriminantly.' },
    image_uid: { type: ['string', 'null'], description: 'The stored image, when there is one. Pass straight to create_pending_ensemble as image_uid, or to view_images to look at it. Never re-upload a picture the member already has.' },
    image_url: { type: ['string', 'null'], description: 'Set instead of image_uid when the picture was linked to an outside site rather than stored here. Fetch it to look at the place; ingest it once with upload_image if you need it in an Ensemble.' },
    visit_count: { type: 'integer', description: 'How many times the member went. One continuous multi-day stay counts once, and a visit whose date they cannot recall still counts.' },
    visits: { type: 'array', items: { type: 'string' }, description: 'Each check-in\'s dates as a person would say them, newest first — e.g. "Feb 24 – 29, 2024", "Sep 3, 2023", "Date unknown". Use list_checkins for the ids, day notes and machine dates.' },
    warrant: OS_WARRANT, provenance: OS_PROVENANCE } };
const OS_COLLECTION = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'name', 'kind', 'count', 'provenance'],   // no integer id — collections genuinely have none today
  properties: { type: { const: 'collection' }, uid: { type: 'string' }, name: { type: 'string' },
    kind: { type: 'string' }, count: { type: 'integer' }, provenance: OS_PROVENANCE } };
const OS_VIEW_IMAGES = { type: 'object', additionalProperties: false, required: ['items', 'missing'],
  properties: {
    items: { type: 'array', description: 'One entry per image actually shown, in the same order as the pictures in this reply.',
      items: { type: 'object', additionalProperties: false,
        required: ['image_uid', 'mime', 'byte_count', 'width', 'height'],
        properties: { image_uid: { type: 'string' }, mime: { type: 'string' }, byte_count: { type: 'integer' },
          width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] } } } },
    missing: { type: 'array', items: { type: 'string' },
      description: 'Uids that could not be shown: unknown, not visible to this member, or too large to inline.' } } };
const OS_COMMENT = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'subject_type', 'subject_id', 'subject_name', 'handle', 'name', 'body', 'created_at', 'mine'],
  properties: { type: { const: 'comment' }, uid: { type: 'string' }, id: { type: 'integer' },
    subject_type: { type: 'string', enum: ['note', 'mark'], description: 'What was commented on.' },
    subject_id: { type: 'integer' }, subject_name: { type: 'string' },
    handle: { type: 'string', description: 'Who wrote it.' }, name: { type: 'string' },
    body: { type: 'string' }, created_at: { type: 'string' },
    mine: { type: 'boolean', description: 'True when the connected member wrote it.' } } };
const OS_VISIT_DAY = { type: 'object', additionalProperties: false,
  required: ['uid', 'date', 'body'],
  properties: { uid: { type: 'string' }, date: { type: 'string' }, body: { type: 'string' } } };
const OS_VISIT = { type: 'object', additionalProperties: false,
  required: ['type', 'uid', 'id', 'date_known', 'visited_on', 'ended_on', 'range', 'body', 'days', 'provenance'],
  properties: { type: { const: 'visit' }, uid: { type: 'string' }, id: { type: 'integer' },
    date_known: { type: 'boolean', description: 'false when the member recorded the visit without knowing when it was; visited_on and ended_on are then null.' },
    visited_on: { type: ['string', 'null'], description: 'Start date, YYYY-MM-DD; null when the date is unknown.' },
    ended_on: { type: ['string', 'null'], description: 'Final date of a continuous multi-day visit, inclusive; null for a single day or an undated visit.' },
    range: { type: 'string', description: 'The visit dates as a person would say them, e.g. "Feb 24 – 29, 2024".' },
    body: { type: 'string', description: 'Commentary on the visit as a whole.' },
    days: { type: 'array', items: OS_VISIT_DAY, description: 'Day-level commentary inside this visit — only dates that have any. One check-in, however many days.' },
    provenance: OS_PROVENANCE } };
// One shape for every stage, so a model reads the same field in every reply.
// `status` is the whole contract: 'receiving' means send next_index; 'stored'
// means a verified durable image exists and image_uid is set. There is
// deliberately no boolean like "complete" — a flag meaning "every index
// arrived" reads as "done" and is not.
const OS_UPLOAD = { type: 'object', additionalProperties: false,
  required: ['status', 'upload_id', 'image_uid', 'verified', 'mime', 'byte_count', 'width', 'height',
    'total_bytes', 'received_bytes', 'total_chunks', 'next_index'],
  properties: {
    status: { type: 'string', enum: ['receiving', 'stored'],
      description: "'receiving': more bytes needed — send the slice at next_index. 'stored': the image is saved and verified; image_uid is ready to use and nothing further is needed." },
    upload_id: { type: 'string' },
    image_uid: { type: ['string', 'null'], description: 'Set only when status is "stored". This is the id to pass to create_pending_ensemble, note_object or add_travel_mark.' },
    verified: { type: 'boolean', description: 'True only when stored: bytes read back, count matched, sha256 matched if given, and the file is a complete valid image.' },
    mime: { type: ['string', 'null'] },
    byte_count: { type: ['integer', 'null'], description: 'Stored size, once stored.' },
    width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] },
    total_bytes: { type: 'integer', description: 'The byte count declared for the whole image.' },
    received_bytes: { type: 'integer', description: 'How much has arrived so far.' },
    total_chunks: { type: 'integer' },
    next_index: { type: ['integer', 'null'], description: 'The slice to send next; null once stored.' } } };
const OS_IMAGE = { type: 'object', additionalProperties: false,
  required: ['type', 'stored', 'verified', 'uid', 'image_uid', 'id', 'ref', 'mime', 'bytes', 'byte_count', 'width', 'height', 'provenance'],
  properties: { type: { const: 'image' },
    stored: { type: 'boolean', description: 'The bytes were written to durable storage.' },
    verified: { type: 'boolean', description: 'Read back and checked after writing: row present, owned by this member, non-empty, valid type, and the byte count matches what was sent. A successful result is proof of storage — no HTTP fetch is needed to confirm it.' },
    uid: { type: 'string' },
    image_uid: { type: 'string', description: 'Same value as uid, under the name the Ensemble tools expect.' },
    id: { type: 'integer' }, ref: { type: 'string', description: 'Path where the owner can view it while signed in. Private images are not fetchable by anyone else.' },
    mime: { type: 'string' }, bytes: { type: 'integer' },
    byte_count: { type: 'integer', description: 'Stored byte count; equals the decoded size of what was sent.' },
    width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] },
    provenance: OS_PROVENANCE } };
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
      collections: { type: 'array', items: { type: 'string' }, description: 'Names of the collections to file this note under, created if new; a note may sit in several. Check my_collections first and reuse an existing name exactly — a near-miss makes a SECOND collection rather than adding to the existing one.' },
      private: { type: 'boolean', description: 'True to keep the note visible only to the member' },
      allow_duplicate: { type: 'boolean', description: 'Set true only after the member confirms this is genuinely different from a similarly-named note the tool flagged.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'my_collections', description: 'List the member\'s collections with a count of what is in each. Collections are how the member groups their own notes and travel marks — names they chose, not categories the system assigns. Read this BEFORE filing anything, so you reuse the exact existing name instead of creating a near-duplicate, and whenever the member asks what they have grouped. Note collections and mark collections are separate; `kind` says which.', inputSchema: { type: 'object', properties: {} },
    outputSchema: OS_ITEMS(OS_COLLECTION) },
  { name: 'recent_notes', description: 'List the most recent notes on discriminant.ly (all members). Each entry carries `already_adopted`: Notes this member has ALREADY created by adopting that one. It is informational only — never a reason to refuse, to ask for confirmation, or to treat the action as blocked. If the member wants another, re-note again; repeat adoptions are valid and each becomes its own Note. Optional search query.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional keyword filter across headline, description and tags.' }, limit: { type: 'integer', default: 10, description: 'How many to return. Defaults to 10.' } } },
    outputSchema: OS_ITEMS(OS_RECENT_NOTE) },
  { name: 'my_notes', description: 'List the connected member\'s own notes. `equivalent_notes` lists Notes this member has explicitly said are the same thing, each with its `basis`: \'user\' means they said so themselves, \'external\' means an outside identifier supports it. Both are canonical; neither is a guess. Inferred similarity is never included here. Each note carries the member\'s private `owned` state and their `warrant` state. state:null on either means they have never said anything either way — that is NOT a negative judgement and must not be read as one. \'released\' means they owned it before; \'revoked\' means they warranted it before and withdrew.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 20, description: 'How many to return, newest first. Defaults to 20.' } } },
    outputSchema: OS_ITEMS(OS_MY_NOTE) },
  { name: 'edit_note', description: 'Edit one of the connected member\'s own notes. Only pass the fields being changed — anything omitted is left as is.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The note\'s id, e.g. from note_object\'s "Noted as #7" or from recent_notes/my_notes.' },
      headline: { type: 'string', description: "Replaces the note's headline." },
      description: { type: 'string', description: "Replaces the note's description, in the member's voice." },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replaces the full set of tags, lowercase, e.g. ["kitchen","copper"].' },
      link: { type: 'string', description: 'Replaces the URL where the object can be found.' },
      image: { type: 'string', description: IMAGE_FIELD_DESC },
      collections: { type: 'array', items: { type: 'string' }, description: 'REPLACES the note\'s whole set of collections — what you pass becomes the complete list, so anything omitted is removed. To add one, pass the existing names back along with the new one. An empty array files it under nothing.' },
      private: { type: 'boolean', description: 'True hides the note from everyone but the member; false publishes it.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'create_pending_ensemble', description: "Stage a visual composition of several things as an Ensemble. When the member says something like \"ensemble these\", do the WHOLE sequence without asking them for technical steps — they should never have to mention uploading, encoding or ids. (1) Look at each constituent. IF A CONSTITUENT IS ALREADY ONE OF THEIR NOTES OR MARKS, its picture is already here: read its image_uid from my_notes / my_travel_marks / search_catalogue and call view_images to see it. Do NOT ask the member to attach a picture of something they have already noted, and do NOT upload it again — that uid is ready to use as-is. (2) Generate the composited image yourself with your own image generation; discriminant.ly does not generate it. Show it to them. (3) Only images that are NOT yet in discriminant.ly — a fresh attachment, or the composition you just generated — need ingesting, one at a time, keeping each returned image_uid: for a local or generated file call begin_image_upload with the first slice of its bytes and keep calling upload_image_chunk until the reply comes back with status \"stored\"; for an image already at a public https:// URL, upload_image with that URL is enough. Never pause for the member between slices. (4) Call THIS tool with those uids in `image_uid` / `artifact_uid`: no picture data belongs in this call. (5) Only once this call has returned pending_review, tell the member it is staged and ask whether to keep or discard it — then call keep_ensemble or discard_ensemble with the id returned here. Do not stop after generating the composition, and do not ask keep/discard before this call has actually succeeded: until it does, nothing exists on discriminant.ly and saying otherwise would be untrue. If an upload fails, fix or report THAT step — never proceed to this tool with a missing image. What this creates is PENDING REVIEW: durable and private to the member, not yet in their catalogue, and nothing reaches their notes until they choose keep. IMAGES: prefer `artifact_uid` and `image_uid` — those bytes are already stored, so nothing is fetched, re-encoded or copied again. `artifact` / `image` still accept an https:// URL (or a small data: URL) if you genuinely have not uploaded separately. Every image must resolve; the call fails rather than saving a composition with a missing piece.",
    inputSchema: { type: 'object', required: ['title', 'components'], properties: {
      title: { type: 'string', description: 'Short name for the composition, e.g. "Autumn layering".' },
      description: { type: 'string', description: 'A sentence or two describing the arrangement, in the member\'s voice.' },
      artifact_uid: { type: 'string', description: 'PREFERRED. uid of the composited image, from upload_image. Give this OR `artifact` — one of the two is required, since the composition is the thing being saved.' },
      artifact: { type: 'string', description: 'Alternative to artifact_uid: an https:// URL to the composited image (a data: URL also works for small images). Ignored if artifact_uid is given.' },
      components: { type: 'array', description: 'Every piece that went into the composition, in display order.',
        items: { type: 'object', required: ['label'], properties: {
          label: { type: 'string', description: 'What this piece is, as the member would name it.' },
          image_uid: { type: 'string', description: "PREFERRED. The stored image for this piece. If the piece is already one of the member's notes or marks, use the image_uid that my_notes / my_travel_marks / search_catalogue gave you — it is already here and needs no uploading. Otherwise it is the uid returned by begin_image_upload or upload_image." },
          image: { type: 'string', description: 'Alternative to image_uid: an https:// URL to this piece\'s own image (a data: URL also works for small images). Ignored if image_uid is given. One of image_uid / image is required unless note_uid points to an existing note that already has an image.' },
          note_uid: { type: 'string', description: "uid of one of the member's existing notes, when this piece is already in their catalogue. Giving this alone is enough: that note's own picture is used automatically, so no image needs supplying or uploading for it." },
          source_url: { type: 'string', description: 'Product page for the piece, if there is a trustworthy one.' },
          identity_basis: { type: 'string', enum: ['user_identity', 'maker_model', 'product_page', 'external_id', 'resolved_note', 'unidentified'],
            description: 'How the identity is known. Only the canonical values let a note be created when the member keeps this; use "unidentified" for anything resting on your own visual judgement, however confident.' } } } } } },
    outputSchema: OS_ENSEMBLE_SAVE },
  { name: 'keep_ensemble', description: "Call this when the member says yes to a staged composition — \"keep it\", \"save it\", \"yes\". Use the ensemble id from the create_pending_ensemble result you already have; do not ask them for it. This moves the Ensemble from pending_review to saved, and it is the moment their catalogue changes: clearly identified pieces become notes (PRIVATE by default), pieces already in their notes are reused rather than duplicated, and anything uncertain stays unidentified. Returns a structured result naming exactly which notes were created and which were reused, so you can tell them truthfully what happened. Safe to call twice — an Ensemble already kept is left alone.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The Ensemble's id, from create_pending_ensemble." },
      private: { type: 'boolean', description: 'Whether the composition itself stays private. Defaults to private; pass false only if the member asked to publish it.' } } },
    outputSchema: OS_ENSEMBLE_SAVE },
  { name: 'get_ensemble', description: 'Retrieve one Ensemble in full — its title and description, every generated image with a record of what went into it, and the current state of each constituent. The actual pictures come back with the result: the current composition first, then any alternate versions, then images of individual pieces — show them to the member rather than describing them or linking to them. Enough to understand and continue a composition with no memory of the conversation that made it.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The Ensemble's id, from list_ensembles." } } },
    outputSchema: OS_ENSEMBLE },
  { name: 'list_ensembles', description: "List the member's saved compositions, newest first.",
    inputSchema: { type: 'object', properties: {
      limit: { type: 'integer', description: 'How many to return. Defaults to 20.' } } },
    outputSchema: OS_ITEMS(OS_ENSEMBLE_BRIEF) },
  { name: 'add_ensemble_artifact', description: "Add another generated image to an existing Ensemble — a further version of the same composition. Becomes the primary image unless told otherwise; earlier versions are kept. Upload the new composition with upload_image first and pass the uid it returns as `image_uid` — that is the preferred path and re-sends nothing.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The Ensemble's id." },
      image_uid: { type: 'string', description: 'PREFERRED. uid of the composition image, from upload_image. Give this OR `image`; one of the two is required.' },
      image: { type: 'string', description: 'Alternative to image_uid: an https:// URL, or a data: URL you build in code from local bytes (see upload_image for how). Ignored if image_uid is given.' },
      make_primary: { type: 'boolean', description: 'Make this the image that represents the Ensemble. Defaults to true.' } } },
    outputSchema: OS_WRITE },
  { name: 'set_primary_artifact', description: 'Choose which generated image represents the Ensemble — "keep the second one" / "go back to the first".',
    inputSchema: { type: 'object', required: ['id', 'artifact_uid'], properties: {
      id: { type: 'integer', description: "The Ensemble's id." },
      artifact_uid: { type: 'string', description: 'uid of the artifact, from get_ensemble.' } } },
    outputSchema: OS_WRITE },
  { name: 'remove_ensemble_artifact', description: 'Remove a generated image from an Ensemble. If it was the primary, the newest remaining image takes over. The stored image itself is not destroyed.',
    inputSchema: { type: 'object', required: ['id', 'artifact_uid'], properties: {
      id: { type: 'integer', description: "The Ensemble's id." },
      artifact_uid: { type: 'string', description: 'uid of the artifact to remove.' } } },
    outputSchema: OS_WRITE },
  { name: 'add_ensemble_component', description: 'Add a constituent to an Ensemble that already exists. Upload the piece\'s image with upload_image first and pass the uid as `image_uid`. Same identity rules as create_pending_ensemble: a clearly identified piece can become a note when the member keeps the Ensemble, while an uncertain one stays unidentified.',
    inputSchema: { type: 'object', required: ['id', 'label'], properties: {
      id: { type: 'integer', description: "The Ensemble's id." },
      label: { type: 'string', description: 'What this piece is, as the member would name it.' },
      note_uid: { type: 'string', description: "uid of one of the member's existing notes, if this piece is already in their catalogue." },
      source_url: { type: 'string', description: 'Product page for the piece, if there is a trustworthy one.' },
      image_uid: { type: 'string', description: "PREFERRED. uid of this piece's own image, from upload_image." },
      image: { type: 'string', description: "Alternative to image_uid: an https:// URL, or a data: URL you build in code from local bytes (see upload_image for how). Ignored if image_uid is given. One of image_uid / image is required unless note_uid points to a note that already has an image." },
      identity_basis: { type: 'string', enum: ['user_identity', 'maker_model', 'product_page', 'external_id', 'resolved_note', 'unidentified'],
        description: 'How the identity is known. Only the canonical values create a note; use "unidentified" for anything resting on your own visual judgement.' } } },
    outputSchema: OS_WRITE },
  { name: 'remove_ensemble_component', description: 'Take a constituent out of an Ensemble. This does not delete any note it was linked to.',
    inputSchema: { type: 'object', required: ['component_uid'], properties: {
      component_uid: { type: 'string', description: 'From get_ensemble.' } } },
    outputSchema: OS_WRITE },
  { name: 'resolve_ensemble_component', description: 'Say what an unidentified constituent actually is — "that chair is a Finn Juhl Chieftain". Links it to an existing note or creates one, keeping the SAME component: the piece did not change, only what is known about it. Use again to correct a wrong identification; the earlier one stays in the record rather than being erased. Only call this when the member has told you the identity or confirmed yours — your own guess is not enough.',
    inputSchema: { type: 'object', required: ['component_uid'], properties: {
      component_uid: { type: 'string', description: 'From get_ensemble or list_unresolved_components.' },
      note_uid: { type: 'string', description: "uid of the member's existing note for this thing, if it exists." },
      label: { type: 'string', description: 'What it is, when creating a note for it.' },
      source_url: { type: 'string', description: 'Product page confirming the identity, if there is one.' },
      identity_basis: { type: 'string', enum: ['user_identity', 'maker_model', 'product_page', 'external_id'],
        description: 'How the identity was established. All four are canonical; a visual guess is not among them.' } } },
    outputSchema: OS_WRITE },
  { name: 'list_unresolved_components', description: "List constituents across the member's Ensembles that are still unidentified — answers \"which pieces haven't been identified yet?\". Canonical state only; no guesses.",
    inputSchema: { type: 'object', properties: {
      id: { type: 'integer', description: 'Limit to one Ensemble by id. Omit for all.' } } },
    outputSchema: OS_ITEMS(OS_UNRESOLVED) },
  { name: 'edit_ensemble', description: "Change an Ensemble's title, description or privacy.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The Ensemble's id." },
      title: { type: 'string', description: 'Replaces the title.' },
      description: { type: 'string', description: 'Replaces the description of the arrangement.' },
      private: { type: 'boolean', description: 'True hides the whole Ensemble from everyone but the member.' } } },
    outputSchema: OS_WRITE },
  { name: 'discard_ensemble', description: 'Call this when the member says no to a composition — \'discard\', \'bin it\', \'no thanks\', \'start over\'. Use the ensemble id from the create_pending_ensemble result you already have; do not ask them for it, and do not ask for extra confirmation of something they have just declined. Usually this is a still-pending composition, in which case nothing had reached their catalogue yet and NO notes exist to remove — the Ensemble and its images simply go. If they are discarding one they had already kept, it also removes the notes that this Ensemble put in their catalogue, but never notes they already had, and never one that has since been marked owned, warranted, filed, edited, or used in another Ensemble; the result names anything kept back and why. To remove an Ensemble they have lived with while leaving every note alone, use delete_ensemble instead.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The Ensemble's id — the one returned by create_pending_ensemble, or from list_ensembles / get_ensemble for one that already exists." } } },
    outputSchema: OS_DISCARD },
  { name: 'delete_ensemble', description: 'Permanently delete an Ensemble, its components and its generated images. Notes linked to it are NOT deleted — they are the member\'s own records.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The Ensemble's id." } } },
    outputSchema: OS_WRITE },
  { name: 're_note', description: 'Adopt another member\'s note into this member\'s own catalogue — they saw it and want to record that thing themselves. This creates a NEW independent note owned by this member, copying the current description and image, with lineage back to the source. The source member can never afterwards change or remove it. Adopting the same note more than once is allowed and creates another independent note each time — if the member asks to do it again, just do it.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The source note's id, from recent_notes." } } },
    outputSchema: OS_WRITE },
  { name: 'delete_note', description: 'Permanently delete one of the connected member\'s own notes. Cannot be undone.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', description: "The note's id, from recent_notes/my_notes or search_catalogue." } } } ,
    outputSchema: OS_WRITE },

  { name: 'record_note_ownership', description: 'Record that the member owns the thing recorded in one of their NOTES — "I own this". Ownership applies to notes only; a travel mark is a place and cannot be owned. Owned is private: it is never shown to anyone else, never appears in public results, and never posts to the feed. Only call this when the member has actually said they own it. Never infer ownership from a note existing, from enthusiasm, from a purchase link, or from anything else.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The note\'s id.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'release_note_ownership', description: 'Record that the member USED TO own the thing in one of their NOTES and no longer does — sold, given away, lost, replaced. Notes only; a travel mark is a place and cannot be owned. This preserves the fact that they owned it for a period. If instead the ownership record was simply an error and they never owned it, use correct_note_ownership_mistake — do not use this tool, because it would leave a false record of them having owned it for a while.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The note\'s id.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'correct_note_ownership_mistake', description: 'Withdraw an ownership record on one of the member\'s NOTES that should never have been made — they did not own the thing and the earlier entry was an error. This removes the false ownership period from their record while keeping an honest trace that a correction happened. This is NOT for things sold, given away, or no longer owned: for those use release_note_ownership. If it is unclear which the member means, ask before calling either.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The note\'s id.' } } } ,
    outputSchema: OS_WRITE },

  { name: 'warrant', description: 'Record that the member stands behind something — their personal seal of approval on a note or a travel mark. Only call this when the member has explicitly said they want to warrant, endorse or stand behind it. Never infer a warrant from praise, from ownership, from repeat visits, from a positive description, or from sentiment of any kind. On a public note or mark this is announced to the feed by default; pass announce:false to warrant quietly. Private notes and marks are never announced.',
    inputSchema: { type: 'object', required: ['subject_type', 'id'], properties: {
      subject_type: { type: 'string', enum: ['note', 'mark'], description: 'Whether id refers to a note or a travel mark.' },
      id: { type: 'integer', description: "The note's id, or the travel mark's id — whichever subject_type says." },
      announce: { type: 'boolean', description: 'Announce to the feed. Defaults to true for public subjects; forced off for private ones.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'revoke_warrant', description: 'Withdraw the member\'s warrant from a note or travel mark — they no longer stand behind it. The public endorsement and any feed appearance disappear; no "revoked" announcement is made. Their private history still records that they warranted it and later withdrew.',
    inputSchema: { type: 'object', required: ['subject_type', 'id'], properties: {
      subject_type: { type: 'string', enum: ['note', 'mark'], description: 'Whether id refers to a note or a travel mark.' },
      id: { type: 'integer', description: "The note's id, or the travel mark's id — whichever subject_type says." } } } ,
    outputSchema: OS_WRITE },
  { name: 'edit_travel_mark', description: 'Edit one of the connected member\'s own travel marks. Only pass the fields being changed — anything omitted is left as is. To log a new visit instead of changing the mark itself, use log_visit.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The mark\'s id, e.g. from add_travel_mark\'s "Marked #3" or from my_travel_marks/search_catalogue.' },
      place: { type: 'string', description: "Replaces the place's name." },
      locality: { type: 'string', description: 'Replaces the city or region.' },
      country: { type: 'string', description: 'Replaces the country.' },
      address: { type: 'string', description: 'Replaces the street address.' },
      lat: { type: 'number', description: 'Replaces the latitude; together with lng this positions the map on the card.' }, lng: { type: 'number', description: 'Replaces the longitude; together with lat this positions the map on the card.' },
      why: { type: 'string', description: "Replaces why it is worth returning to, in the member's voice." },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replaces the full set of tags, lowercase, e.g. ["thai","bangkok"].' },
      link: { type: 'string', description: 'Replaces the URL for the place.' }, image: { type: 'string', description: IMAGE_FIELD_DESC },
      collections: { type: 'array', items: { type: 'string' }, description: 'REPLACES the mark\'s whole set of collections — what you pass becomes the complete list, so anything omitted is removed. To add one, pass the existing names back along with the new one.' },
      private: { type: 'boolean', description: 'True hides the mark from everyone but the member; false publishes it.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'delete_travel_mark', description: 'Permanently delete one of the connected member\'s own travel marks, including its visit history. Cannot be undone.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', description: "The mark's id, from my_travel_marks or search_catalogue." } } } ,
    outputSchema: OS_WRITE },
  { name: 'begin_image_upload', description: "Send an image you hold as a local file — an attachment the user gave you, a file under /mnt/data or /workspace, or a picture you generated — into Discriminantly, and get back a stable image_uid. THIS IS THE FIRST AND OFTEN THE ONLY CALL: it carries the first slice of bytes with it, so no call is wasted on setup. Read the file's bytes in your code environment, note its exact byte count, split the bytes into slices of at most 32768 bytes, and send slice 0 here as base64. WHAT COMES BACK TELLS YOU WHAT TO DO NEXT, and there are only two answers. status \"stored\" means the image is saved and image_uid is ready — you are done with this image, call nothing else for it. status \"receiving\" means keep going: call upload_image_chunk with the index given in next_index, and keep going without pausing or asking the user anything until you get \"stored\". An image of 32 KB or less finishes in this single call. Never send a file id or a path — those name something inside YOUR sandbox that this server cannot open. For an image already at a public https:// URL, skip all of this and use upload_image.",
    inputSchema: { type: 'object', required: ['mime', 'total_bytes', 'data'], properties: {
      mime: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        description: 'Content type of the prepared image.' },
      total_bytes: { type: 'integer', description: 'Exact byte count of the WHOLE prepared image file — raw bytes, not the length of any base64 text. The image is stored only once the slices add up to exactly this.' },
      data: { type: 'string', description: 'Base64 of the FIRST slice of raw bytes, up to 32768 bytes. For an image that size or smaller this is the whole file and the call returns image_uid immediately. No "data:" prefix — just base64 of the bytes.' },
      sha256: { type: 'string', description: 'Optional but recommended: sha256 of the complete prepared image, 64 lowercase hex characters. Lets the server prove the stored bytes are exactly what you sent.' },
      source: { type: 'string', enum: ['upload', 'generated'], description: "'generated' if you produced this image yourself; otherwise 'upload'. Defaults to 'upload'." } } },
    outputSchema: OS_UPLOAD },
  { name: 'upload_image_chunk', description: "Send the next slice of an image begun with begin_image_upload. Use the index the previous response gave you in next_index, and base64 only THAT slice's raw bytes — never the whole file, never a \"data:\" prefix. Keep calling this, without pausing or asking the user anything, until a response comes back with status \"stored\": that response carries the image_uid and means the image is saved. A response with status \"receiving\" always names the next index to send. If you are unsure whether a slice arrived, sending it again with identical bytes is harmless.",
    inputSchema: { type: 'object', required: ['upload_id', 'index', 'data'], properties: {
      upload_id: { type: 'string', description: 'From the previous response.' },
      index: { type: 'integer', description: 'The value of next_index from the previous response. Slices are counted from 0 in file order.' },
      data: { type: 'string', description: "Base64 of THIS slice's raw bytes only, up to 32768 bytes." } } },
    outputSchema: OS_UPLOAD },
  { name: 'start_image_upload', description: "Compatibility only — prefer begin_image_upload, which does this AND carries the first slice, so an ordinary image takes one call instead of three. This opens an upload session without moving any bytes. Even here there is no separate finish step: whichever slice completes the image returns the image_uid by itself.",
    inputSchema: { type: 'object', required: ['mime', 'total_bytes'], properties: {
      mime: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], description: 'Content type of the prepared image.' },
      total_bytes: { type: 'integer', description: 'Exact byte count of the prepared image.' },
      sha256: { type: 'string', description: 'Optional sha256 of the complete image, 64 lowercase hex characters.' },
      source: { type: 'string', enum: ['upload', 'generated'], description: "'generated' if you produced it; otherwise 'upload'." } } },
    outputSchema: OS_UPLOAD },
  { name: 'finish_image_upload', description: "Compatibility only — you should not normally need this. The slice that completes an image finalises it automatically and returns the image_uid. Call this only if you opened a session with start_image_upload and want to force assembly. Safe after the image is already stored: it returns the same image_uid rather than storing a second copy.",
    inputSchema: { type: 'object', required: ['upload_id'], properties: {
      upload_id: { type: 'string', description: 'The upload session id.' },
      sha256: { type: 'string', description: 'Optional sha256 of the complete image, if not given earlier.' } } },
    outputSchema: OS_UPLOAD },
  { name: 'view_images', description: "Look at pictures the member already has in Discriminantly. Notes, travel marks and ensembles carry an image_uid; pass those uids here and the actual images come back so you can SEE them. Use this before composing an Ensemble from things the member has already noted — you need to look at a jacket before you can arrange it with a chair — and any time the member refers to how something of theirs looks. An image the member already has NEVER needs to be uploaded again and must never be asked for again: read its image_uid and view it. Up to 8 at a time. Only images the member can see are returned; very large ones are named but not inlined.",
    inputSchema: { type: 'object', required: ['image_uids'], properties: {
      image_uids: { type: 'array', maxItems: 8, items: { type: 'string' },
        description: 'The image_uid values from my_notes, recent_notes, my_travel_marks, search_catalogue or get_ensemble. Not note ids and not /i/ paths — the uid itself.' } } },
    outputSchema: OS_VIEW_IMAGES },
  { name: 'read_comments', description: "Read the comments on a note or a travel mark — the conversation around it, written by the member or by others who can see it. A comment is a REMARK, not a record of taste: it says what someone said about the thing, never that the member owns it, endorses it, or has been there. Use this when the member asks what people said about something, or before replying so you are not repeating what is already there. Only notes and marks the member can actually see can be read; a private record belonging to someone else is reported as not found.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The note's or travel mark's id, from my_notes, my_travel_marks, recent_notes or search_catalogue." },
      subject_type: { type: 'string', enum: ['note', 'mark'], description: "Whether that id is a note or a travel mark. Defaults to 'note'. Get this right — note #3 and mark #3 are different things." } } },
    outputSchema: OS_ITEMS(OS_COMMENT) },
  { name: 'comment', description: "Post a comment on a note or travel mark as the connected member — a remark in the conversation around it. Say something only when the member has actually told you what to say, or clearly asked you to respond on their behalf; never invent an opinion for them, and never use a comment to record that they own, endorse or visited something. Those are different acts with their own tools: record_note_ownership, warrant, and log_visit. Commenting on someone else's note is fine where the member can see it; a private record belonging to another member cannot be commented on.",
    inputSchema: { type: 'object', required: ['id', 'body'], properties: {
      id: { type: 'integer', description: "The note's or travel mark's id." },
      subject_type: { type: 'string', enum: ['note', 'mark'], description: "Whether that id is a note or a travel mark. Defaults to 'note'." },
      body: { type: 'string', description: "What the member wants to say, in their voice. One or two sentences is usual." } } },
    outputSchema: OS_WRITE },
  { name: 'upload_image', description: "Store an image that is ALREADY REACHABLE and get back a stable image_uid: pass an https:// URL and Discriminantly fetches it server-to-server. That is what this tool is best at, and no chunking is needed for it. A small inline data: URL also works. FOR A LOCAL FILE — an attachment the user sent, a file under /mnt/data or /workspace, or a picture you generated — prefer start_image_upload / upload_image_chunk / finish_image_upload instead: sending a whole image as one tool argument has proved unreliable, with runtimes silently truncating arguments at sizes as small as 135 KB, whereas chunking always works. Never pass a file id or a filesystem path to any of these tools; those name something in YOUR sandbox that this server cannot open. Upload one image at a time, keep each returned image_uid, and pass those uids onward (create_pending_ensemble, note_object, add_travel_mark) rather than sending a picture twice. A successful result is itself proof the image is stored; images are private, so do not fetch the returned /i/<uid> path to check.",
    inputSchema: { type: 'object', required: ['image'], properties: {
      image: { type: 'string', description: "Either (a) an https:// URL this server can fetch — the preferred use of this tool, any size — or (b) a data: URL you built in code from real local bytes, which is fine for a genuinely small image. For a local file of any real size, use start_image_upload instead of inlining it here: one large argument can be truncated in transit by your runtime, and chunking is not subject to that. Never a file id or a filesystem path. PNG, JPEG, WEBP or GIF." } } },
    outputSchema: OS_IMAGE },
  { name: 'verify_place', description: 'Check whether a place can be found in mapping data before adding it as a travel mark. Uses the same OpenStreetMap lookup as this app\'s own "search for a place" field — free, no business listings or opening hours, but a real geographic database rather than a guess. Call this before add_travel_mark whenever the member has not given a precise address, or whenever you are not confident the name/city is exactly right. Show the match (or the fact that nothing was found) to the member before writing anything. If several candidates come back, ask which one. If nothing comes back, say so plainly and ask whether to add it anyway without verification, or to try again with more detail — never invent coordinates or an address to fill the gap.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'The place name, ideally with its city, e.g. "Nahm restaurant Bangkok"' },
      limit: { type: 'integer', default: 5, description: 'How many candidate matches to return. Defaults to 5.' } } } ,
    outputSchema: OS_PLACE_CANDIDATES },
  { name: 'add_travel_mark', description: 'Add or create a new travel mark: record a place worth returning to — a restaurant, hotel, shop, view. Use this rather than note_object when the subject is somewhere the member went, not something they might own. Call verify_place first unless the member has given a precise address or you already know the place well; pass its coordinates through as lat/lng so the mark is grounded rather than guessed.',
    inputSchema: { type: 'object', required: ['place'], properties: {
      place: { type: 'string', description: 'Name of the place' },
      locality: { type: 'string', description: 'City or region. Fill this in yourself if you know the place — do not make the member supply it.' },
      country: { type: 'string', description: 'Fill in from your own knowledge of the place where possible.' },
      address: { type: 'string', description: 'Street address if known.' },
      lat: { type: 'number', description: 'Latitude if known; enables the map on the card.' },
      lng: { type: 'number', description: 'Longitude if known; together with lat it enables the map on the card.' },
      why: { type: 'string', description: 'Why it is worth returning to, written in the member\'s voice from what they said. If they were vague, draw on the conversation and on what you know of the place to write two useful sentences — what it is, what to order or do, what makes it worth the return.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase tags, e.g. ["thai","bangkok","dinner"].' },
      link: { type: 'string', description: 'URL for the place, if there is one.' }, image: { type: 'string', description: IMAGE_FIELD_DESC },
      collections: { type: 'array', items: { type: 'string' }, description: "Names of the collections to file this place under, created if new. Check my_collections first and reuse an existing name exactly — Lisbon and lisbon become two separate collections. These can be changed later with edit_travel_mark." },
      visited_on: { type: 'string', description: "YYYY-MM-DD, only when the member has ALREADY been: it records a check-in alongside the mark. Marking a place is not a claim to have been there, so leave this out for somewhere they mean to go, have only heard about, or did not say they visited. They can check in later with log_visit." },
      private: { type: 'boolean', description: 'True to keep the mark visible only to the member.' },
      allow_duplicate: { type: 'boolean', description: 'Set true only after the member confirms this is genuinely different from a similarly-named mark the tool flagged.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'log_visit', description: "Add a check-in to an existing travel mark — one visit. A single day is the common case: a date and, if the member said something, a line about it. If they remember being there but not when, set date_unknown and skip the date entirely — that still counts as having visited. A CONTINUOUS multi-day visit (a hotel stay, a few days somewhere) is still ONE check-in: give ended_on as well, and optionally attach a note to individual days inside the range with `days`. Two separate trips are two separate check-ins, however close together. Never split one stay into several check-ins.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The mark's id, from my_travel_marks or search_catalogue." },
      date_unknown: { type: 'boolean', description: 'true when the member has been here but cannot say when. Records the visit with no date; cannot be combined with visited_on, ended_on or days.' },
      visited_on: { type: 'string', description: 'The date, or the FIRST date of a multi-day visit. YYYY-MM-DD, not in the future. Defaults to today unless date_unknown is set.' },
      ended_on: { type: 'string', description: 'The LAST date of a continuous multi-day visit, inclusive — leave out for a single day. YYYY-MM-DD, on or after visited_on, not in the future.' },
      body: { type: 'string', description: 'A line about the visit as a whole, only if the member said something worth keeping.' },
      days: { type: 'array', description: 'Optional notes on particular days inside the range. Only include days the member actually said something about; every other day in the range is simply part of the visit.',
        items: { type: 'object', required: ['date', 'body'], properties: {
          date: { type: 'string', description: 'YYYY-MM-DD, within visited_on..ended_on inclusive.' },
          body: { type: 'string', description: 'What happened that day.' } } } } } },
    outputSchema: OS_WRITE },
  { name: 'list_checkins', description: "List the check-ins on one of the member's own travel marks — the times they actually went. Most recent first, with undated ones last since they have no place in time. Use this to find a check-in's id before editing or deleting it; no other tool exposes individual check-in ids. Each carries: `range`, the dates as a person would say them (\"Feb 28, 2025\", \"Feb 24 – 29, 2024\", or \"Date unknown\"); `visited_on` and `ended_on`, the machine dates, where ended_on is the LAST day of a continuous multi-day visit and is null for a single day; `date_known`, false when the member recorded the visit without knowing when it was, in which case both dates are null; `body`, their line about the visit as a whole; and `days`, notes tied to particular dates inside it. A multi-day visit is ONE check-in with day notes inside it — never read its days as separate visits, and never count them as extra visits.",
    inputSchema: { type: 'object', required: ['mark_id'], properties: {
      mark_id: { type: 'integer', description: 'The travel mark\'s id.' } } },
    outputSchema: OS_ITEMS(OS_VISIT) },
  { name: 'edit_checkin', description: "Edit one of the member's own check-ins, identified by its own id (from list_checkins). Only pass what changes — dates, the overall line, and/or notes on particular days; everything omitted is left as is, and the check-in keeps its identity. To add or change a day's note, pass it in `days`; to remove one, pass that date with an empty body. Shortening the dates so that an existing day note would fall outside the visit is refused unless you also list that date in `remove_days` — the member must be asked before a note is discarded.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The check-in\'s id, from list_checkins.' },
      date_unknown: { type: 'boolean', description: 'true to record that the date is not known (drops the range; any day notes must be listed in remove_days). false, together with visited_on, gives an undated visit a date.' },
      visited_on: { type: 'string', description: 'New first date, YYYY-MM-DD, not in the future. Required when dating a visit that had no date.' },
      ended_on: { type: ['string', 'null'], description: 'New last date of a multi-day visit (inclusive), or null/empty to make it a single day again.' },
      body: { type: 'string', description: 'Replaces the line about the visit as a whole. Pass an empty string to clear it.' },
      days: { type: 'array', description: 'Notes on particular days to add or change. A day given with an empty body has its note removed. Dates must fall inside the (new) visit range.',
        items: { type: 'object', required: ['date', 'body'], properties: {
          date: { type: 'string', description: 'YYYY-MM-DD.' }, body: { type: 'string', description: 'The note; empty removes it.' } } } },
      remove_days: { type: 'array', items: { type: 'string' }, description: 'Dates whose notes the member has agreed to discard because the new dates no longer include them. Required for any such date, or the edit is refused.' } } } ,
    outputSchema: OS_WRITE },
  { name: 'delete_checkin', description: "Permanently delete one of the member's own check-ins — the record that they went at all. Any notes on individual days inside it go with it, since those describe that visit. The travel mark itself and its other check-ins are untouched. To shorten a visit rather than erase it, or to drop a single day's note, use edit_checkin instead. Cannot be undone.",
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: "The check-in's id, from list_checkins." } } } ,
    outputSchema: OS_WRITE },
  { name: 'my_travel_marks', description: 'List the connected member\'s travel marks with visit counts — a count of CHECK-INS, where one continuous multi-day stay counts once, not once per day, and a visit whose date the member cannot recall still counts. Optional search across place, city, country and tags. Each mark carries the member\'s `warrant` state. There is no ownership on a travel mark — owning applies to things in notes, not to places, so no `owned` field is returned here and none should be inferred. warrant state:null means they have never said either way — that is NOT a negative judgement. \'revoked\' means they warranted it before and withdrew.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional keyword filter across place, city, country and tags.' }, limit: { type: 'integer', default: 20, description: 'How many to return. Defaults to 20.' } } },
    outputSchema: OS_ITEMS(OS_MARK) },
  { name: 'search_catalogue', description: 'Search the connected member\'s own notes and travel marks — the actual catalogue, not just recent entries. Searches title, description, tags, and (for marks) city and country. Use this whenever the member asks what they have noted or marked about something, before adding something new to check whether it already exists, or to find an item to edit when only given a rough description. Results mix the two kinds. Note entries carry the member\'s private `owned` state and their `warrant` state; mark entries carry only `warrant`, because ownership applies to things and not to places. On either, state:null means they have never said anything either way — that is NOT a negative judgement and must not be read as one. \'released\' means they owned it before; \'revoked\' means they warranted it before and withdrew.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'Keywords to search for, e.g. "copper pan" or "bangkok"' },
      kind: { type: 'string', enum: ['note', 'mark', 'both'], default: 'both', description: 'Restrict to notes, travel marks, or search both.' },
      limit: { type: 'integer', default: 15, description: 'How many results to return. Defaults to 15.' } } },
    outputSchema: OS_ITEMS({ oneOf: [OS_SEARCH_NOTE, OS_SEARCH_MARK] }) },
  { name: 'catalogue_stats', description: 'Counts and breakdowns of the connected member\'s catalogue: totals, notes by collection, marks by country, and how many entries have no image. Use this for "how many" or "what is my" questions rather than counting a list yourself.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: OS_STATS },

  // ---- Itineraries ----------------------------------------------------------
  // Nine tools, deliberately composable rather than one per operation: adding
  // three stops is one call, and grouping plus sequencing is one call, because
  // that is how a member says it. Identity is always the uid, never the row id.
  { name: 'create_itinerary', description: "Start an itinerary: somewhere the member means to go. Title is the destination as they say it (\"Singapore\", \"Next time I'm in London\"). Context is their own prose about the trip. Time is optional at every level and nothing should be invented: give only the components they actually said.",
    inputSchema: { type: 'object', required: ['title'], properties: {
      title: { type: 'string', description: 'The destination, in the member\u2019s words.' },
      context: { type: 'string', description: 'Their own remarks about the trip. Optional.' },
      private: { type: 'boolean', description: 'Defaults to private. Only pass false if they said it may be public.' },
      year: { type: 'integer' }, month: { type: 'integer', description: '1-12.' },
      day: { type: 'integer', description: '1-31.' },
      period: { type: 'string', enum: ['spring', 'summer', 'fall', 'winter'] },
      modifier: { type: 'string', enum: ['early', 'mid', 'late'], description: 'Only with modifier_scope.' },
      modifier_scope: { type: 'string', enum: ['year', 'period', 'month'], description: 'WHICH component the modifier describes. "late 2028" is modifier=late, scope=year. "late fall 2028" is scope=period. Never guess: ask, or leave both out.' } } } },

  { name: 'add_itinerary_stops', description: 'Add one or more stops to an itinerary in a single call \u2014 pass every stop the member just listed, not one call each. A stop is a parcel of intended time: it does NOT need to be a known travel mark. Use kind "particular" when they mean a specific place you cannot yet name ("that tapas place Flora recommended"), "experiential" when the words are the whole intention ("some chilli crab"), and "allocation" for deliberately open time ("leave the afternoon free"); all three are complete as they stand and none is a defective mark. A stop records what the member INTENDS, never what happened: if they are telling you they have already been somewhere, that is log_visit against the travel mark, not a stop.',
    inputSchema: { type: 'object', required: ['itinerary_uid', 'stops'], properties: {
      itinerary_uid: { type: 'string', description: 'From create_itinerary or my_itineraries.' },
      stops: { type: 'array', items: { type: 'object', required: ['label'], properties: {
        label: { type: 'string', description: 'What the member said, kept verbatim.' },
        kind: { type: 'string', enum: ['particular', 'experiential', 'allocation'] },
        mark_uid: { type: 'string', description: 'An existing travel mark, from my_travel_marks or search_catalogue, when this stop IS that place. Never invent a uid, and never pass one for a place they have not confirmed.' },
        new_place: { type: 'object', description: 'Use this INSTEAD of mark_uid when the member has just accepted a place you proposed that they have not marked before: it creates the travel mark as part of accepting it, and records that the mark came from this plan. Only for places they have actually confirmed.',
          properties: { name: { type: 'string' }, locality: { type: 'string' }, country: { type: 'string' },
            address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' },
            why: { type: 'string', description: 'Why it is worth going, in the member\u2019s words if they gave any.' } } },
        group_uid: { type: 'string', description: 'A day from arrange_itinerary or my_itineraries, if they placed it on one.' },
        daypart: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'night'] },
        clock: { type: 'string', description: 'HH:MM, 24-hour, only if they gave a time.' } } } } } } },

  { name: 'update_itinerary', description: "Change an itinerary's title, context, or whether it is private. Publishing fails, with the reason, while a visible stop points at a private travel mark \u2014 that is deliberate: the member resolves it by publishing the mark or suspending the stop.",
    inputSchema: { type: 'object', required: ['itinerary_uid'], properties: {
      itinerary_uid: { type: 'string', description: 'From create_itinerary or my_itineraries.' },
      title: { type: 'string' }, context: { type: 'string' },
      private: { type: 'boolean', description: 'false publishes it. Publishing fails, naming the marks, while a visible stop points at a private travel mark.' } } } },

  { name: 'update_itinerary_temporal', description: 'Set or change time on an itinerary, a day, or a stop. Give only the components the member asserted; omitted components stay as they were, and nothing is invented. intent matters for the record: "refine" when the plan simply got more precise (fall 2028 -> October 2028), "correct" when the earlier assertion was wrong ("no, October, not fall"). OMIT intent when you do not actually know which \u2014 an honest plain edit is recorded instead of a guess.',
    inputSchema: { type: 'object', required: ['target', 'uid'], properties: {
      target: { type: 'string', enum: ['itinerary', 'day', 'stop'], description: 'Which thing the time belongs to. A trip may be "late fall 2028" while one of its days is "April 8" and one stop is "7:30 PM" \u2014 set each at its own level rather than repeating it.' },
      uid: { type: 'string', description: 'The uid of that itinerary, day or stop, all of which my_itineraries returns.' },
      intent: { type: 'string', enum: ['refine', 'correct'], description: 'Leave out when unknown.' },
      year: { type: 'integer' }, month: { type: 'integer' }, day: { type: 'integer' },
      period: { type: 'string', enum: ['spring', 'summer', 'fall', 'winter'] },
      modifier: { type: 'string', enum: ['early', 'mid', 'late'] },
      modifier_scope: { type: 'string', enum: ['year', 'period', 'month'] },
      weekday: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
      daypart: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'night'] },
      clock: { type: 'string', description: 'HH:MM, 24-hour.' },
      clear: { type: 'array', items: { type: 'string' }, description: 'Component names to unset.' } } } },

  { name: 'arrange_itinerary', description: 'Create days, put stops on them, and set order \u2014 in one call. Only set order when the member asked for one: an itinerary with no asserted sequence is perfectly normal, and inventing an order would put words in their mouth. If you suggest an arrangement and they have not agreed yet, say so in conversation and do not call this.',
    inputSchema: { type: 'object', required: ['itinerary_uid'], properties: {
      itinerary_uid: { type: 'string', description: 'From create_itinerary or my_itineraries.' },
      create_day: { type: 'object', properties: {
        label: { type: 'string', description: '"Day 1", "Friday", or whatever they called it.' },
        month: { type: 'integer' }, day: { type: 'integer' }, year: { type: 'integer' },
        weekday: { type: 'string' } } },
      assign: { type: 'array', description: 'Move stops onto a day (or off one with day_uid null).',
        items: { type: 'object', required: ['stop_uid'], properties: {
          stop_uid: { type: 'string', description: 'From add_itinerary_stops or my_itineraries.' },
          day_uid: { type: 'string', description: 'A day uid; omit, or pass null, to take the stop off its day and leave it unplaced.' },
          position: { type: 'integer', description: 'Only if they asked for a specific place in the order.' } } } },
      order_stops: { type: 'array', description: 'Stop uids in the order the member asked for.', items: { type: 'string' } },
      order_days: { type: 'array', description: 'Day uids in the order the member asked for.', items: { type: 'string' } } } } },

  { name: 'resolve_itinerary_stop', description: 'Point a stop at a travel mark once the member has confirmed which place it is, or unlink it again. The stop keeps its identity and its original words: resolving answers the intention, it does not replace it. Use intent "refine" for a first resolution, "correct" when fixing a wrong one.',
    inputSchema: { type: 'object', required: ['stop_uid'], properties: {
      stop_uid: { type: 'string', description: 'From add_itinerary_stops or my_itineraries.' },
      mark_uid: { type: 'string', description: 'The travel mark, from my_travel_marks or search_catalogue \u2014 or from add_travel_mark if the place was not marked before. Omit, with unlink:true, to un-resolve.' },
      unlink: { type: 'boolean' },
      kind: { type: 'string', enum: ['particular', 'experiential', 'allocation'], description: 'What it becomes when unlinked.' },
      intent: { type: 'string', enum: ['refine', 'correct'] } } } },

  { name: 'update_itinerary_stop', description: "Change a stop's wording or kind, or withhold it from public view. Suspending is context-local: it hides the stop from this itinerary's public page and changes nothing about the travel mark anywhere else.",
    inputSchema: { type: 'object', required: ['stop_uid'], properties: {
      stop_uid: { type: 'string', description: 'From add_itinerary_stops or my_itineraries.' },
      label: { type: 'string' },
      kind: { type: 'string', enum: ['particular', 'experiential', 'allocation'], description: 'Only for stops with no travel mark; use resolve_itinerary_stop to unlink one first.' },
      visibility: { type: 'string', enum: ['visible', 'suspended'] } } } },

  { name: 'delete_itinerary_entity', description: 'Delete an itinerary, a day, or a stop. Deleting a day does not delete its stops \u2014 they return to the itinerary unplaced, and any order they had within that day is dropped, because it was an order within that day. Nothing here touches travel marks or check-ins: those are the member\u2019s canonical records and outlive any itinerary that referred to them.',
    inputSchema: { type: 'object', required: ['kind', 'uid'], properties: {
      kind: { type: 'string', enum: ['itinerary', 'day', 'stop'] },
      uid: { type: 'string', description: 'The uid of that itinerary, day or stop, from my_itineraries. Deleting a stop never deletes the travel mark it pointed at, and never deletes check-ins.' } } } },

  { name: 'my_itineraries', description: "The member's itineraries \u2014 places they mean to go. With a uid, returns that one in full: its days, its stops, what each stop is, and how time was expressed at every level. Read it as intention only: a stop with a past date does not mean they went, an unsequenced stop is not an unfinished one, and a day with no date is not missing information. Check whether they actually went by looking at the travel mark's check-ins.",
    inputSchema: { type: 'object', properties: {
      uid: { type: 'string', description: 'Omit to list them all. This is where the uids for every other itinerary tool come from.' },
      limit: { type: 'integer' } } } },

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
    // Bring the picture INTO discriminant.ly rather than storing a link to
    // someone else's server. A note pointing at a retailer's URL loses its
    // image the day that page changes, and — because there is no stored image —
    // has no image_uid, so nothing can later look at it or compose with it.
    // ingestImage fetches https:// safely, accepts data: URLs, and reuses an
    // image_uid as-is.
    // Best effort, never fatal. Plenty of retailers refuse an automated fetch,
    // and losing the whole note over a 403 would be worse than the problem this
    // solves — so on failure we keep the link exactly as before, surface it as
    // image_url, and leave it in the backlog to retry later.
    let noteImage = '';
    try {
      const uid = await resolveAssetRef(user.id, { image_uid: a.image_uid, image: a.image },
        mcpActor(user), 'upload', 'The note image');
      if (uid) noteImage = `/i/${uid}`;
    } catch (e) {
      if (/^https?:\/\//i.test(String(a.image || '').trim())) {
        noteImage = String(a.image).trim();
        try { q(`INSERT OR IGNORE INTO linked_image_backlog(kind,row_id,url,state,note)
          VALUES('object',-1,?, 'pending', ?)`).run(noteImage, String(e.message).slice(0, 160)); } catch {}
        console.log(`[note] kept link, could not adopt: ${String(e.message).slice(0, 120)}`);
      } else throw e;                       // a bad data: URL is still a real error
    }
    if (!noteImage) throw new Error('image is required: every note carries an image.');
    const r = q('INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,?,?,?,?,?)').run(user.id, String(a.headline).trim(), String(a.description || '').trim(), tagList(Array.isArray(a.tags) ? a.tags.join(',') : a.tags).join(', '), a.link || '', noteImage, a.private ? 1 : 0);
    if (/^https?:\/\//i.test(noteImage)) {
      try { q(`INSERT OR IGNORE INTO linked_image_backlog(kind,row_id,url) VALUES('object',?,?)`).run(r.lastInsertRowid, noteImage);
            q("DELETE FROM linked_image_backlog WHERE row_id=-1").run(); } catch {}
    }
    q('INSERT OR IGNORE INTO notes(user_id,object_id) VALUES(?,?)').run(user.id, r.lastInsertRowid);
    if (Array.isArray(a.collections)) setCollections(user.id, r.lastInsertRowid, a.collections);
    recordProvenance('object', uidOf('objects', r.lastInsertRowid), 'created', mcpActor(user),
      { source_kind: a.link ? 'unfurl' : 'manual', source_ref: a.link || null });
    return wr(`Noted as #${r.lastInsertRowid}: ${a.headline}${a.private ? ' (private)' : ''}${Array.isArray(a.collections) && a.collections.length ? ' in ' + a.collections.join(', ') : ''}`,
      'created', 'note', r.lastInsertRowid, uidOf('objects', r.lastInsertRowid), a.headline);
  }
  if (name === 'recent_notes') {
    const lim = Math.min(+a.limit || 10, 50); const sq = (a.query || '').trim();
    const rows = sq ? q(OBJ_SQL + ' WHERE o.private=0 AND (o.name LIKE ? OR o.why LIKE ? OR o.tags LIKE ?) ORDER BY o.id DESC LIMIT ?').all(`%${sq}%`, `%${sq}%`, `%${sq}%`, lim) : q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC LIMIT ?').all(lim);
    return { text: rows.map(fmt).join('\n') || 'No notes yet.',
      structured: { items: rows.map((o) => ({ type: 'object', uid: o.uid, id: o.id, name: o.name, why: o.why,
        tags: o.tags, url: o.url, handle: o.handle, private: !!o.private,
        has_image: !!o.image, image_uid: imageUidOf(o), image_url: imageUrlOf(o),
        already_adopted: alreadyAdopted(user.id, o.uid),
        provenance: provenanceOf('object', o.uid) })) } };
  }
  if (name === 'my_collections') {
    const rows = q(`SELECT c.uid, c.name, c.kind,
        (SELECT COUNT(*) FROM note_collections nc WHERE nc.collection_id=c.id) n
      FROM collections c WHERE c.user_id=? ORDER BY c.name`).all(user.id);
    return { text: rows.map((c) => `${c.name} (${c.n})`).join('\n') || 'No collections yet.',
      structured: { items: rows.map((c) => ({ type: 'collection', uid: c.uid, name: c.name, kind: c.kind || 'note',
        count: c.n, provenance: provenanceOf('collection', c.uid) })) } };
  }
  if (name === 'my_notes') {
    const rows = q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC LIMIT ?').all(user.id, Math.min(+a.limit || 20, 50));
    return { text: rows.map(fmt).join('\n') || 'No notes yet.',
      structured: { items: rows.map((o) => ({ type: 'object', uid: o.uid, id: o.id, name: o.name, why: o.why,
        tags: o.tags, url: o.url, private: !!o.private,
        has_image: !!o.image, image_uid: imageUidOf(o), image_url: imageUrlOf(o),
        renoted_from_uid: o.renoted_from_uid || null,
        owned: ownedState(user.id, o.id), warrant: warrantState(user.id, 'object', o.uid),
        equivalent_notes: equivalentNotes(user.id, o.uid),
        provenance: provenanceOf('object', o.uid) })) } };
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
    // Same rule as note_object: a replacement picture is ingested, never linked.
    let image = o.image;
    if (a.image !== undefined || a.image_uid !== undefined) {
      try {
        const uid = await resolveAssetRef(user.id, { image_uid: a.image_uid, image: a.image }, mcpActor(user), 'upload', 'The note image');
        if (uid) image = `/i/${uid}`;
      } catch (e) {
        if (/^https?:\/\//i.test(String(a.image || '').trim())) image = String(a.image).trim();
        else throw e;
      }
    }
    const priv = a.private !== undefined ? (a.private ? 1 : 0) : o.private;
    q('UPDATE objects SET name=?,why=?,tags=?,url=?,image=?,private=? WHERE id=?').run(name_, why, tags, url, image, priv, o.id);
    if (Array.isArray(a.collections)) setCollections(user.id, o.id, a.collections);
    recordProvenance('object', o.uid, 'edited', mcpActor(user), { source_kind: 'manual' });
    return wr(`Updated #${o.id}: ${name_}`, 'edited', 'note', o.id, o.uid, name_);
  }
  // ---- chunked image ingestion ------------------------------------------
  // A model must be told to continue at every step, and each step it has to
  // remember is a step it can drop. So: the first call carries real bytes, and
  // the chunk that completes the image returns the durable image_uid. There is
  // no setup call that moves nothing, and no finalise call to forget.
  //
  // Exactly two outcomes are possible from a chunk:
  //   status 'receiving' — more bytes needed; next_index says which
  //   status 'stored'    — a verified durable image exists; image_uid is set
  // Anything else is an error. Nothing short of 'stored' looks terminal.

  // Assemble, validate, persist. The ONLY path to a durable image — shared by
  // automatic finalisation and the legacy finish_image_upload — so both carry
  // identical guarantees.
  const finalizeUpload = async (up, suppliedSha, ctx) => {
    const totalChunks = Math.ceil(up.total_bytes / UPLOAD_CHUNK_BYTES);
    const rows = q('SELECT idx, bytes FROM image_upload_chunks WHERE upload_id=? ORDER BY idx').all(up.id);
    const have = new Set(rows.map((r) => r.idx));
    const missing = [];
    for (let i = 0; i < totalChunks; i++) if (!have.has(i)) missing.push(i);
    if (missing.length) throw new Error(`Cannot finish: chunk${missing.length === 1 ? '' : 's'} `
      + `${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''} missing. Send them and it will finish itself.`);
    const abandon = () => { try { q('DELETE FROM image_upload_chunks WHERE upload_id=?').run(up.id); } catch {} };
    const buf = Buffer.concat(rows.map((r) => Buffer.from(r.bytes)));
    if (buf.length !== up.total_bytes) {
      abandon();
      throw new Error(`Assembled ${buf.length} bytes but the upload declared ${up.total_bytes}. `
        + `The image was NOT stored. Start a new upload and send the whole file.`);
    }
    const expected = suppliedSha ? String(suppliedSha).toLowerCase().trim() : up.sha256;
    if (expected) {
      const actual = crypto.createHash('sha256').update(buf).digest('hex');
      if (actual !== expected) {
        abandon();
        throw new Error('The assembled image does not match the sha256 you supplied, so it was damaged in '
          + 'transit. Nothing was saved. Start a new upload.');
      }
    }
    let uid;
    try {
      uid = await ingestImage(up.user_id, `data:${up.mime};base64,${buf.toString('base64')}`, ctx, up.source, 'The assembled image');
    } catch (e) { abandon(); throw e; }
    const v = verifyStoredImage(up.user_id, uid, buf.length);
    if (!v.verified) { discardStoredImage(uid); abandon(); throw new Error(`Assembled but not stored durably: ${v.problems.join('; ')}.`); }
    q("UPDATE image_uploads SET status='finished', image_uid=? WHERE id=?").run(uid, up.id);
    q('DELETE FROM image_upload_chunks WHERE upload_id=?').run(up.id);   // staging is not storage
    const img = v.row;
    console.log(`[upload] stored id=${up.uid} bytes=${buf.length} chunks=${totalChunks} image_uid=${uid}`);
    return { text: `Stored and verified${totalChunks > 1 ? ` from ${totalChunks} chunks` : ''}. image_uid: ${uid} `
      + `(${img.mime}, ${img.n} bytes${img.width ? `, ${img.width}x${img.height}` : ''}). `
      + `Use this uid from here on — do not send the image again.`,
      structured: { status: 'stored', upload_id: up.uid, image_uid: uid, verified: true,
        mime: img.mime, byte_count: img.n, width: img.width || null, height: img.height || null,
        total_bytes: up.total_bytes, received_bytes: up.total_bytes,
        total_chunks: totalChunks, next_index: null } };
  };

  // The already-stored result, so an anxious retry of the final chunk returns
  // the same image instead of storing a second copy.
  const storedResult = (up) => {
    const img = q('SELECT mime, length(bytes) n, width, height FROM images WHERE uid=?').get(up.image_uid) || {};
    return { text: `Already stored. image_uid: ${up.image_uid}`,
      structured: { status: 'stored', upload_id: up.uid, image_uid: up.image_uid, verified: true,
        mime: img.mime || up.mime, byte_count: img.n || up.total_bytes,
        width: img.width || null, height: img.height || null,
        total_bytes: up.total_bytes, received_bytes: up.total_bytes,
        total_chunks: Math.ceil(up.total_bytes / UPLOAD_CHUNK_BYTES), next_index: null } };
  };

  const uploadExpired = (up) => new Date(String(up.expires_at).replace(' ', 'T') + 'Z') < new Date();

  // Store one chunk, then either ask for the next or finish the job.
  const receiveChunk = async (up, idx, data, ctx) => {
    if (uploadExpired(up)) throw new Error('That upload has expired. Start a new one.');
    if (!Number.isInteger(idx) || idx < 0) throw new Error('index must be a whole number, starting at 0.');
    let buf;
    try { buf = Buffer.from(String(data || ''), 'base64'); }
    catch { throw new Error(`Chunk ${idx} is not valid base64.`); }
    if (!buf.length) throw new Error(`Chunk ${idx} decoded to zero bytes.`);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const existing = q('SELECT sha256 FROM image_upload_chunks WHERE upload_id=? AND idx=?').get(up.id, idx);
    if (existing) {
      // An identical resend is harmless; the same index with DIFFERENT bytes is
      // a real conflict and must never silently overwrite.
      if (existing.sha256 !== sha) throw new Error(`Chunk ${idx} was already received with different content. `
        + `Do not change a chunk once sent; start a new upload instead.`);
    } else {
      q('INSERT INTO image_upload_chunks(upload_id,idx,bytes,sha256) VALUES(?,?,?,?)').run(up.id, idx, buf, sha);
    }
    const got = q('SELECT COUNT(*) c, COALESCE(SUM(length(bytes)),0) n FROM image_upload_chunks WHERE upload_id=?').get(up.id);
    if (got.n > up.total_bytes) {
      q('DELETE FROM image_upload_chunks WHERE upload_id=?').run(up.id);
      throw new Error(`Received ${got.n} bytes but the upload declared only ${up.total_bytes}. Nothing was stored. `
        + `Start a new upload with the correct total_bytes.`);
    }
    const totalChunks = Math.ceil(up.total_bytes / UPLOAD_CHUNK_BYTES);
    const have = new Set(q('SELECT idx FROM image_upload_chunks WHERE upload_id=?').all(up.id).map((r) => r.idx));
    let next = null;
    for (let i = 0; i < totalChunks; i++) if (!have.has(i)) { next = i; break; }
    // Finish ONLY when every index is present AND the bytes add up exactly.
    // Index presence alone is NOT completeness: a short chunk would otherwise
    // look finished while the image is truncated — which is exactly what the
    // old `complete` flag reported.
    if (next === null && got.n === up.total_bytes) return finalizeUpload(up, null, ctx);
    if (next === null) {
      q('DELETE FROM image_upload_chunks WHERE upload_id=?').run(up.id);
      throw new Error(`Every chunk arrived but the bytes are short: ${got.n} of ${up.total_bytes}. A chunk was `
        + `truncated in transit. Nothing was stored — start a new upload and send the whole file.`);
    }
    console.log(`[upload] receiving id=${up.uid} idx=${idx} bytes=${buf.length} cumulative=${got.n}/${up.total_bytes} next=${next}`);
    return { text: `Chunk ${idx} received — ${got.n} of ${up.total_bytes} bytes. Send chunk ${next} next.`,
      structured: { status: 'receiving', upload_id: up.uid, image_uid: null, verified: false,
        mime: up.mime, byte_count: null, width: null, height: null,
        total_bytes: up.total_bytes, received_bytes: got.n,
        total_chunks: totalChunks, next_index: next } };
  };

  const openUploadSession = (a2, userId) => {
    const mime = String(a2.mime || '').toLowerCase().trim();
    if (!IMAGE_MIME_ALLOW.has(mime)) throw new Error(`mime must be one of: ${[...IMAGE_MIME_ALLOW].join(', ')}.`);
    const total = Number(a2.total_bytes);
    if (!Number.isInteger(total) || total <= 0) throw new Error('total_bytes must be the exact byte count of the prepared image.');
    if (total > MAX_IMAGE_BYTES) throw new Error(`That image is ${Math.round(total / 1048576)} MB; the limit is `
      + `${Math.round(MAX_IMAGE_BYTES / 1048576)} MB. Prepare a smaller version.`);
    const sha = a2.sha256 ? String(a2.sha256).toLowerCase().trim() : null;
    if (sha && !/^[0-9a-f]{64}$/.test(sha)) throw new Error('sha256 must be 64 lowercase hex characters, or omitted.');
    // Cheap sweep on the way in: expired sessions are dead weight. Keeps
    // staging bounded without a scheduler.
    try {
      q(`DELETE FROM image_upload_chunks WHERE upload_id IN
         (SELECT id FROM image_uploads WHERE expires_at < datetime('now'))`).run();
      q("DELETE FROM image_uploads WHERE expires_at < datetime('now') AND status<>'finished'").run();
    } catch {}
    const r = q(`INSERT INTO image_uploads(user_id,mime,total_bytes,sha256,source,expires_at)
      VALUES(?,?,?,?,?,datetime('now','+30 minutes'))`)
      .run(userId, mime, total, sha, a2.source === 'generated' ? 'generated' : 'upload');
    return q('SELECT * FROM image_uploads WHERE id=?').get(r.lastInsertRowid);
  };

  if (name === 'begin_image_upload') {
    if (!a.data) throw new Error('data is required: the first call carries chunk 0, so bytes move immediately.');
    const up = openUploadSession(a, user.id);
    console.log(`[upload] begin id=${up.uid} mode=${ingestDirective(user).mode} mime=${up.mime} total=${up.total_bytes} chunks=${Math.ceil(up.total_bytes / UPLOAD_CHUNK_BYTES)}`);
    return receiveChunk(up, 0, a.data, mcpActor(user));
  }
  if (name === 'upload_image_chunk') {
    const up = q('SELECT * FROM image_uploads WHERE uid=?').get(String(a.upload_id || '').trim());
    if (!up) throw new Error('No such upload_id. Call begin_image_upload first.');
    if (up.user_id !== user.id) throw new Error('That upload belongs to a different member.');
    if (up.status === 'finished' && up.image_uid) return storedResult(up);   // anxious retry
    return receiveChunk(up, Number(a.index), a.data, mcpActor(user));
  }
  if (name === 'start_image_upload') {
    // Compatibility only: opens a session without moving any bytes.
    const up = openUploadSession(a, user.id);
    const chunks = Math.ceil(up.total_bytes / UPLOAD_CHUNK_BYTES);
    return { text: `Upload started. Send ${chunks} chunk${chunks === 1 ? '' : 's'} of up to ${UPLOAD_CHUNK_BYTES} `
      + `bytes each, indexes 0..${chunks - 1}. The chunk that completes the image returns the image_uid.`,
      structured: { status: 'receiving', upload_id: up.uid, image_uid: null, verified: false,
        mime: up.mime, byte_count: null, width: null, height: null,
        total_bytes: up.total_bytes, received_bytes: 0, total_chunks: chunks, next_index: 0 } };
  }
  if (name === 'finish_image_upload') {
    // Compatibility only: the chunk that completes the image finalises itself.
    const up = q('SELECT * FROM image_uploads WHERE uid=?').get(String(a.upload_id || '').trim());
    if (!up) throw new Error('No such upload_id.');
    if (up.user_id !== user.id) throw new Error('That upload belongs to a different member.');
    if (up.status === 'finished' && up.image_uid) return storedResult(up);
    if (uploadExpired(up)) throw new Error('That upload has expired. Start a new one.');
    return finalizeUpload(up, a.sha256, mcpActor(user));
  }
  // Hand back the ACTUAL PICTURES for images the member can see. Without this
  // an AI knows a note has an image and can pass its uid along, but has never
  // seen it — so it cannot judge whether the thing suits a composition, and
  // ends up asking the member to re-attach a picture Discriminantly already
  // holds. Reads only; visibility is checked per image exactly as /i/<uid> does.
  if (name === 'view_images') {
    const uids = (Array.isArray(a.image_uids) ? a.image_uids : [a.image_uids])
      .filter(Boolean).map((x) => String(x).trim()).slice(0, 8);
    if (!uids.length) throw new Error('image_uids is required — pass the image_uid values from my_notes, my_travel_marks, search_catalogue or get_ensemble.');
    const images = [], seen = [], missing = [];
    for (const uid of uids) {
      const img = q('SELECT * FROM images WHERE uid=?').get(uid);
      if (!img || !imageVisibleTo(img, user)) { missing.push(uid); continue; }
      const block = imageBlock(`/i/${uid}`);
      if (!block) { missing.push(uid); continue; }      // too large to inline
      images.push(block);
      seen.push({ image_uid: uid, mime: img.mime, byte_count: img.bytes.length,
        width: img.width || null, height: img.height || null });
    }
    const lines = [];
    if (seen.length) lines.push(`Showing ${seen.length} image${seen.length === 1 ? '' : 's'}, in order: `
      + seen.map((x) => `${x.image_uid.slice(0, 8)} (${x.width || '?'}x${x.height || '?'})`).join('; ') + '.');
    if (missing.length) lines.push(`Could not show: ${missing.join(', ')} — not found, not visible to this member, or too large to inline.`);
    return { text: lines.join(' ') || 'Nothing to show.', images,
      structured: { items: seen, missing } };
  }
  // ---- comments -----------------------------------------------------------
  // A comment is a remark in conversation on someone's note or mark — it is
  // NOT a record of taste. Only what the member can already see may be read or
  // commented on, which the web enforces by simply not showing the form; here
  // it has to be checked explicitly.
  if (name === 'read_comments' || name === 'comment') {
    const kind = String(a.subject_type || 'note').toLowerCase();
    if (kind !== 'note' && kind !== 'mark') throw new Error("subject_type must be 'note' or 'mark'.");
    const isNote = kind === 'note';
    const subj = isNote
      ? q(OBJ_SQL + ' WHERE o.id=?').get(a.id)
      : q(MARK_SQL + ' WHERE m.id=?').get(a.id);
    if (!subj) throw new Error(`No ${kind} #${a.id}`);
    const visible = isNote ? canSee(subj, user) : (!subj.private || subj.user_id === user.id);
    if (!visible) throw new Error(`No ${kind} #${a.id}`);   // never confirm a private record exists
    const table = isNote ? 'comments' : 'mark_comments';
    const fk = isNote ? 'object_id' : 'mark_id';
    if (name === 'comment') {
      const body = String(a.body || '').trim();
      if (!body) throw new Error('body is required — a comment with nothing in it is not worth posting.');
      const r = q(`INSERT INTO ${table}(${fk},user_id,body) VALUES(?,?,?)`).run(subj.id, user.id, body);
      const uid = uidOf(table, r.lastInsertRowid);
      recordProvenance('comment', uid, 'created', mcpActor(user), { source_kind: 'manual' });
      return wr(`Commented on ${subj.name}.`, 'created', 'comment', r.lastInsertRowid, uid, subj.name);
    }
    const rows = q(`SELECT c.*, u.handle, u.name AS uname FROM ${table} c JOIN users u ON u.id=c.user_id
      WHERE c.${fk}=? ORDER BY c.created_at`).all(subj.id);
    return { text: rows.length
        ? `${rows.length} comment${rows.length === 1 ? '' : 's'} on ${subj.name}:\n`
          + rows.map((c) => `  @${c.handle}: ${c.body}`).join('\n')
        : `No comments on ${subj.name} yet.`,
      structured: { items: rows.map((c) => ({ type: 'comment', uid: c.uid, id: c.id,
        subject_type: kind, subject_id: subj.id, subject_name: subj.name,
        handle: c.handle, name: c.uname, body: c.body, created_at: c.created_at,
        mine: c.user_id === user.id })) } };
  }
  if (name === 'upload_image') {
    if (!a.image) throw new Error('image is required');
    // Accepts a data: URL or an https:// URL, and returns the stored uid —
    // which is the reference every other tool wants.
    // NOTE: this used to parse `/i/<integer>` out of storeImage()'s return.
    // Since image references became uid-based, that parse produced NaN and the
    // lookup failed, so this tool threw on every call. Resolve by uid instead.
    // What the caller SENT, so the result can confirm the bytes survived the
    // journey rather than merely that something was stored.
    const sentBytes = /^data:image\//i.test(String(a.image).trim())
      ? Buffer.from(String(a.image).split(',')[1] || '', 'base64').length : null;
    console.log(`[upload] inline mode=${ingestDirective(user).mode} bytes=${sentBytes == null ? 'url' : sentBytes}`);
    const uid = await ingestImage(user.id, a.image, mcpActor(user), 'upload', 'The image');
    const v = verifyStoredImage(user.id, uid, sentBytes);
    if (!v.verified) {
      discardStoredImage(uid);   // so "nothing was saved" is literally true
      throw new Error(`The image was not stored durably: ${v.problems.join('; ')}. Nothing was saved.`);
    }
    const img = v.row;
    const ref = `/i/${img.uid}`;
    const kb = Math.round(img.n / 1024);
    return { text: `Stored and verified. image_uid: ${img.uid} (${img.mime}, ${img.n} bytes / ~${kb} KB`
      + `${img.width && img.height ? `, ${img.width}x${img.height}` : ''}). `
      + `Pass this uid onward as image_uid / artifact_uid to create_pending_ensemble, or as the image argument to `
      + `note_object or add_travel_mark. This image is private to the member: ${ref} is only fetchable by them while `
      + `signed in, so do not try to GET it to confirm the upload — this result is the confirmation.`,
      structured: { type: 'image', stored: true, verified: true, uid: img.uid, image_uid: img.uid, id: img.id, ref,
        mime: img.mime, bytes: img.n, byte_count: img.n,
        width: img.width || null, height: img.height || null,
        provenance: provenanceOf('image', img.uid) } };
  }
  if (name === 'verify_place') {
    const q_ = String(a.query || '').trim();
    if (!q_) throw new Error('query is required');
    const lim = Math.min(+a.limit || 5, 10);
    try {
      const r = await fetch(`https://photon.komoot.io/api/?limit=${lim}&q=${encodeURIComponent(q_)}`,
        { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return { text: `Could not reach the mapping service (status ${r.status}). Tell the member verification failed and ask whether to add the mark anyway.`, structured: { items: [] } };
      const data = await r.json();
      const feats = Array.isArray(data.features) ? data.features : [];
      if (!feats.length) return { text: `No match found for "${q_}" in mapping data. This does not mean the place is wrong — small or new places are often missing from OpenStreetMap. Tell the member plainly and ask whether to add it anyway without verification, or to try again with a more precise name or city.`, structured: { items: [] } };
      const text = feats.map((f, i) => {
        const p = f.properties || {};
        const where = [p.street, p.housenumber, p.city || p.town || p.village, p.state, p.country].filter(Boolean).join(', ');
        const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
        return `${i + 1}. ${p.name || q_}${where ? ' — ' + where : ''}${lat != null ? ` (${lat.toFixed(5)}, ${lng.toFixed(5)})` : ''}`;
      }).join('\n') + '\n\nShow these to the member and confirm which one (if any) is correct before calling add_travel_mark with its address and coordinates.';
      const cands = feats.map((f) => {
        const p = f.properties || {};
        const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
        return { name: p.name || q_,
          locality: p.city || p.town || p.village || '', country: p.country || '',
          address: [p.housenumber, p.street].filter(Boolean).join(' '),
          lat: lat == null ? null : +lat, lng: lng == null ? null : +lng };
      }).filter((c) => c.lat != null && c.lng != null);
      return { text, structured: { items: cands } };
    } catch (e) {
      return { text: `Could not reach the mapping service (${e.name === 'TimeoutError' ? 'timed out' : 'network error'}). Tell the member verification failed and ask whether to add the mark anyway.`, structured: { items: [] } };
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
    // Intention is not experience: marking a place asserts that it is worth
    // knowing about, not that the member has been. A check-in is written only
    // where one was actually claimed, and it carries its own provenance like
    // any other assertion.
    if (a.visited_on) {
      const v = q('INSERT INTO visits(mark_id,user_id,visited_on,body) VALUES(?,?,?,?)')
        .run(r.lastInsertRowid, user.id, a.visited_on, '');
      recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', mcpActor(user),
        { source_kind: 'manual' });
    }
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
    const verifiedNote = a.lat != null && a.lng != null ? '' : ' — not verified against mapping data; mention this to the member';
    return wr(`Marked #${r.lastInsertRowid}: ${a.place}${a.locality ? ', ' + a.locality : ''} ${a.visited_on ? ` (checked in ${a.visited_on})` : ''}${verifiedNote}`,
      'created', 'mark', r.lastInsertRowid, uidOf('marks', r.lastInsertRowid), a.place);
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
    // Upward privacy propagation. A mark turning private takes every public
    // itinerary that shows it private too, so linking can never disclose it.
    // Called from both mark-privacy write sites so web and MCP cannot diverge.
    if (priv && !mk.private) markPrivacyChanged(mk.uid, true, mcpActor(user));
    return wr(`Updated #${mk.id}: ${name_}`, 'edited', 'mark', mk.id, mk.uid, name_);
  }
  if (name === 'delete_travel_mark') {
    if (!a.id) throw new Error('id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.id);
    if (!mk) throw new Error(`No travel mark #${a.id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.id} does not belong to this member`);
    recordProvenance('mark', mk.uid, 'deleted', mcpActor(user));
    dropWarrantsFor('mark', mk.uid);
    q('DELETE FROM marks WHERE id=?').run(mk.id);
    return wr(`Deleted #${mk.id}: ${mk.name}`, 'deleted', 'mark', mk.id, mk.uid, mk.name);
  }
  if (name === 'log_visit') {
    if (!a.id) throw new Error('id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.id);
    if (!mk) throw new Error(`No travel mark #${a.id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.id} does not belong to this member`);
    const ctx = mcpActor(user);
    if (a.date_unknown) {
      // The member was there but cannot say when. Refuse dates rather than
      // quietly ignoring them — a caller giving both is contradicting itself.
      if (a.visited_on || a.ended_on || (a.days && a.days.length)) throw new Error('date_unknown cannot be combined with visited_on, ended_on or days.');
      const v = q('INSERT INTO visits(mark_id,user_id,visited_on,ended_on,body,date_known) VALUES(?,?,?,NULL,?,0)')
        .run(mk.id, user.id, todayYMD(), String(a.body || '').trim());
      recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', ctx, { source_kind: 'manual', fields: 'date_known:0' });
      const n = q('SELECT COUNT(*) c FROM visits WHERE mark_id=?').get(mk.id).c;
      return wr(`Logged a visit to ${mk.name} with the date unknown — ${n} ${n === 1 ? 'visit' : 'visits'} total`,
        'created', 'visit', v.lastInsertRowid, uidOf('visits', v.lastInsertRowid), mk.name, `${n} total`);
    }
    const { start, end } = normaliseVisitRange(a.visited_on, a.ended_on);
    db.exec('BEGIN');
    let vid;
    try {
      const v = q('INSERT INTO visits(mark_id,user_id,visited_on,ended_on,body) VALUES(?,?,?,?,?)')
        .run(mk.id, user.id, start, end, String(a.body || '').trim());
      vid = v.lastInsertRowid;
      recordProvenance('visit', uidOf('visits', vid), 'created', ctx, { source_kind: 'manual' });
      applyVisitDays(vid, start, end, a.days, ctx);       // validates every day against the range
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const n = q('SELECT COUNT(*) c FROM visits WHERE mark_id=?').get(mk.id).c;
    const dn = visitDaysOf(vid).length;
    return wr(`Logged a visit to ${mk.name}: ${prettyRange(start, end)}${dn ? ` with notes on ${dn} day${dn === 1 ? '' : 's'}` : ''} — ${n} ${n === 1 ? 'visit' : 'visits'} total`,
      'created', 'visit', vid, uidOf('visits', vid), mk.name, `${n} total`);
  }
  if (name === 'list_checkins') {
    if (!a.mark_id) throw new Error('mark_id is required');
    const mk = q('SELECT * FROM marks WHERE id=?').get(a.mark_id);
    if (!mk) throw new Error(`No travel mark #${a.mark_id}`);
    if (mk.user_id !== user.id) throw new Error(`Travel mark #${a.mark_id} does not belong to this member`);
    const vs = markVisits(mk.id);   // already ordered visited_on DESC, id DESC — reused as-is
    const shape = (v) => { const days = visitDaysOf(v.id); const undated = v.date_known === 0; return { type: 'visit', uid: v.uid, id: v.id,
      date_known: !undated, visited_on: undated ? null : v.visited_on, ended_on: undated ? null : (v.ended_on || null),
      range: visitLabel(v),
      body: v.body, days: days.map((d) => ({ uid: d.uid, date: d.day, body: d.body })),
      provenance: provenanceOf('visit', v.uid) }; };
    return { text: vs.map((v) => { const dn = visitDaysOf(v.id).length;
        return `#${v.id} ${visitLabel(v)}${v.body ? ` — ${v.body}` : ''}${dn ? ` [notes on ${dn} day${dn === 1 ? '' : 's'}]` : ''}`; }).join('\n')
        || 'No check-ins yet.',
      structured: { items: vs.map(shape) } };
  }
  if (name === 'edit_checkin') {
    if (!a.id) throw new Error('id is required');
    // Ownership runs through the parent mark, not visits.user_id, so a
    // check-in can never be edited by anyone but the mark's owner.
    const v = q(`SELECT v.*, m.user_id AS mark_owner FROM visits v
      JOIN marks m ON m.id = v.mark_id WHERE v.id = ?`).get(a.id);
    if (!v) throw new Error(`No such check-in #${a.id}`);
    if (v.mark_owner !== user.id) throw new Error(`Check-in #${a.id} does not belong to this member`);
    const ctx0 = mcpActor(user);
    if (a.date_unknown === true) {
      if (a.visited_on || a.ended_on || (a.days && a.days.length)) throw new Error('date_unknown cannot be combined with visited_on, ended_on or days.');
      const stranded = q('SELECT day FROM visit_days WHERE visit_id=? AND body<>?').all(v.id, '').map((r) => r.day);
      const ok = new Set((a.remove_days || []).map(String));
      const left = stranded.filter((d) => !ok.has(d));
      if (left.length) throw new Error(`Marking this visit undated would leave notes on ${left.join(', ')} with no day to belong to. `
        + `Pass those dates in remove_days to confirm removing them.`);
      db.exec('BEGIN');
      try {
        applyVisitDays(v.id, v.visited_on, v.ended_on, stranded.map((d) => ({ date: d, body: '' })), ctx0);
        const body = a.body !== undefined ? String(a.body).trim() : v.body;
        q('UPDATE visits SET date_known=0, ended_on=NULL, body=? WHERE id=?').run(body, v.id);
        recordProvenance('visit', v.uid, 'edited', ctx0, { source_kind: 'manual', fields: 'date_known' });
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return wr(`Updated check-in #${v.id}: date now unknown`, 'edited', 'visit', v.id, v.uid, UNDATED_LABEL);
    }
    // Going from undated back to dated needs a real date; there is no old one to fall back to.
    if (v.date_known === 0 && a.date_unknown !== false && a.visited_on === undefined) {
      if (a.body === undefined) throw new Error('This check-in has no date. Pass visited_on to give it one, or date_unknown:false with visited_on.');
      q('UPDATE visits SET body=? WHERE id=?').run(String(a.body).trim(), v.id);
      recordProvenance('visit', v.uid, 'edited', ctx0, { source_kind: 'manual', fields: 'body' });
      return wr(`Updated check-in #${v.id}`, 'edited', 'visit', v.id, v.uid, UNDATED_LABEL);
    }
    if (v.date_known === 0 && a.visited_on === undefined) throw new Error('Pass visited_on to give this check-in a date.');
    // Only what is passed changes; the check-in keeps its uid throughout, and
    // so does every day row that is merely edited.
    const { start, end } = normaliseVisitRange(
      a.visited_on !== undefined ? a.visited_on : v.visited_on,
      a.ended_on !== undefined ? a.ended_on : v.ended_on);
    const body = a.body !== undefined ? String(a.body).trim() : v.body;
    const ctx = mcpActor(user);
    // The guard: a range change must never silently discard day notes. The
    // caller must name the days it is willing to lose in remove_days.
    const excluded = daysExcludedBy(v.id, start, end);
    const willRemove = new Set((a.remove_days || []).map(String));
    const stranded = excluded.filter((d) => !willRemove.has(d));
    if (stranded.length) {
      throw new Error(`Changing the dates to ${prettyRange(start, end)} would leave notes on `
        + `${stranded.join(', ')} outside the visit. Either keep the dates, or pass those dates in remove_days `
        + `to confirm removing their notes.`);
    }
    db.exec('BEGIN');
    try {
      // removals first, while the old (wider) range still contains them
      const wideStart = v.visited_on < start ? v.visited_on : start;
      const wideEnd = (v.ended_on || v.visited_on) > (end || start) ? (v.ended_on || v.visited_on) : (end || start);
      applyVisitDays(v.id, wideStart, wideEnd, [...willRemove].map((d) => ({ date: d, body: '' })), ctx);
      const changed = [];
      if (start !== v.visited_on || v.date_known === 0) changed.push('visited_on');
      if ((end || null) !== (v.ended_on || null)) changed.push('ended_on');
      if (body !== v.body) changed.push('body');
      if (changed.length) {
        q('UPDATE visits SET visited_on=?, ended_on=?, body=?, date_known=1 WHERE id=?').run(start, end, body, v.id);
        recordProvenance('visit', v.uid, 'edited', ctx, { source_kind: 'manual', fields: changed.join(',') });
      }
      applyVisitDays(v.id, start, end, a.days, ctx);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const dn = visitDaysOf(v.id).length;
    return wr(`Updated check-in #${v.id}: ${prettyRange(start, end)}${body ? ` — ${body}` : ''}${dn ? ` (notes on ${dn} day${dn === 1 ? '' : 's'})` : ''}`,
      'edited', 'visit', v.id, v.uid, prettyRange(start, end));
  }
  if (name === 'delete_checkin') {
    if (!a.id) throw new Error('id is required');
    const v = q(`SELECT v.*, m.user_id AS mark_owner FROM visits v
      JOIN marks m ON m.id = v.mark_id WHERE v.id = ?`).get(a.id);
    if (!v) throw new Error(`No such check-in #${a.id}`);
    if (v.mark_owner !== user.id) throw new Error(`Check-in #${a.id} does not belong to this member`);
    recordProvenance('visit', v.uid, 'deleted', mcpActor(user));
    q('DELETE FROM visits WHERE id=?').run(v.id);
    return wr(`Deleted check-in #${v.id}`, 'deleted', 'visit', v.id, v.uid, String(v.visited_on || ''));
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
        remarked_from_uid: x.remarked_from_uid || null,
        has_image: !!x.image, image_uid: imageUidOf(x), image_url: imageUrlOf(x),
        visit_count: markVisits(x.id).length,
        visits: markVisits(x.id).map((v) => visitLabel(v)),
        warrant: warrantState(user.id, 'mark', x.uid),
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
          item: { type: 'object', uid: o.uid, id: o.id, name: o.name, why: o.why, tags: o.tags, private: !!o.private,
            has_image: !!o.image, image_uid: imageUidOf(o), image_url: imageUrlOf(o),
                  owned: ownedState(user.id, o.id), warrant: warrantState(user.id, 'object', o.uid) } }));
    }
    if (kind !== 'note') {
      q(MARK_SQL + ' WHERE m.user_id=?').all(user.id)
        .filter((x) => (x.name + ' ' + x.why + ' ' + x.tags + ' ' + x.locality + ' ' + x.country).toLowerCase().includes(kl))
        .forEach((x) => hits.push({ at: x.created_at,
          line: `MARK #${x.id} ${x.name}${placeLine(x) ? ' — ' + placeLine(x) : ''}${x.why ? ` — ${x.why}` : ''}`,
          item: { type: 'mark', uid: x.uid, id: x.id, name: x.name, locality: x.locality, country: x.country,
                  why: x.why, tags: x.tags, private: !!x.private, remarked_from_uid: x.remarked_from_uid || null,
                  warrant: warrantState(user.id, 'mark', x.uid) } }));
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
    const byColl = q(`SELECT c.name, COUNT(*) n FROM note_collections nc
      JOIN collections c ON c.id=nc.collection_id JOIN objects o ON o.id=nc.note_id
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
  if (name === 'record_note_ownership' || name === 'release_note_ownership' || name === 'correct_note_ownership_mistake') {
    if (!a.id) throw new Error('id is required');
    // Note and mark ids are independent sequences, so note #1 and mark #1 both
    // exist. A caller that thinks it is addressing a mark would otherwise
    // silently assert ownership over an unrelated note. Ownership applies to
    // things in notes and never to places, so treat any mark-shaped argument
    // as the confusion it is rather than guessing.
    if (a.subject_type || a.mark_id || a.place) {
      throw new Error('Ownership applies to notes only — there is no ownership on a travel mark. '
        + 'Pass just the note\'s id. If you meant a place, no ownership tool applies to it.');
    }
    const o = q('SELECT * FROM objects WHERE id=?').get(a.id);
    if (!o) throw new Error(`No note #${a.id}`);
    // Ownership is asserted against the member's own relationship to the
    // object. Objects are shared, so anyone who has noted it may assert.
    if (o.user_id !== user.id) throw new Error(`Note #${a.id} does not belong to this member`);
    if (name === 'record_note_ownership') {
      assertOwned(user.id, o.id, mcpActor(user));
      return wr(`Marked as owned: ${o.name}. This is private — only the member and their own AI can see it.`,
        'asserted', 'ownership', o.id, o.uid, o.name);
    }
    if (name === 'release_note_ownership') {
      const cur = ownedState(user.id, o.id);
      if (cur.state !== 'owned') throw new Error(`${o.name} is not currently marked as owned, so there is nothing to release.`);
      releaseOwned(user.id, o.id, mcpActor(user));
      return wr(`Recorded as no longer owned: ${o.name}. The earlier period of ownership is preserved.`,
        'released', 'ownership', o.id, o.uid, o.name);
    }
    const corrected = correctOwned(user.id, o.id, mcpActor(user));
    if (!corrected) throw new Error(`${o.name} has no current ownership mark to correct.`);
    return wr(`Corrected: the ownership record on ${o.name} has been withdrawn as an error, leaving no record of it having been owned.`,
      'corrected', 'ownership', o.id, o.uid, o.name);
  }
  if (name === 'warrant' || name === 'revoke_warrant') {
    if (!a.id) throw new Error('id is required');
    if (a.subject_type !== 'note' && a.subject_type !== 'mark') throw new Error("subject_type must be 'note' or 'mark'");
    const isNote = a.subject_type === 'note';
    const row = isNote ? q('SELECT * FROM objects WHERE id=?').get(a.id) : q('SELECT * FROM marks WHERE id=?').get(a.id);
    if (!row) throw new Error(`No ${isNote ? 'note' : 'travel mark'} #${a.id}`);
    if (row.user_id !== user.id) throw new Error(`That ${isNote ? 'note' : 'travel mark'} does not belong to this member`);
    const stype = isNote ? 'object' : 'mark';
    if (name === 'warrant') {
      const cur = warrantState(user.id, stype, row.uid);
      if (cur.state === 'active') return wr(`${row.name} is already warranted.`, 'unchanged', 'warrant', row.id, row.uid, row.name);
      // A private subject can never publish. Not a filter at read time —
      // the publication flag is never set in the first place.
      const publish = row.private ? false : (a.announce === undefined ? true : !!a.announce);
      assertWarrant(user.id, stype, row.uid, publish, mcpActor(user));
      return wr(`Warranted: ${row.name}.` + (row.private ? ' The note is private, so nothing was announced.'
        : publish ? ' Shared to the feed.' : ' Warranted quietly — no feed announcement.'),
        'asserted', 'warrant', row.id, row.uid, row.name, publish ? 'published' : 'quiet');
    }
    const cur = warrantState(user.id, stype, row.uid);
    if (cur.state !== 'active') throw new Error(`${row.name} is not currently warranted.`);
    revokeWarrant(user.id, stype, row.uid, mcpActor(user));
    return wr(`Warrant withdrawn from ${row.name}. The history of having warranted it is preserved privately.`,
      'revoked', 'warrant', row.id, row.uid, row.name);
  }
  if (name === 'create_pending_ensemble' || name === 'save_ensemble') {
    if (!a.title) throw new Error('title is required');
    const hasArtifact = (a.artifact_uid && String(a.artifact_uid).trim())
      || (a.artifact && String(a.artifact).trim());
    if (!hasArtifact) {
      throw new Error('The composition image is required: an Ensemble is the composition itself. Upload it with '
        + 'upload_image and pass the uid as `artifact_uid`, or pass `artifact` as an https:// URL. Nothing was saved.');
    }
    const ctx = mcpActor(user);
    const comps = Array.isArray(a.components) ? a.components : [];

    // ---- stage 1: ingest every asset FIRST, outside any transaction.
    // Fetching a URL can take seconds; holding a write transaction open across
    // that would lock the database for every other request. Nothing semantic is
    // written until all of these have succeeded and been verified.
    const artifactUid = await resolveAssetRef(user.id,
      { image_uid: a.artifact_uid, image: a.artifact }, ctx, 'generated', 'The composition image');
    for (const c of comps) {
      const resolved = await resolveAssetRef(user.id, c, ctx, 'upload', `The image for "${c.label || 'a component'}"`);
      if (resolved) c.__uid = resolved;
      else if ((c.note_uid || '').trim()) {
        const n = q('SELECT image FROM objects WHERE uid=? AND user_id=?').get(c.note_uid.trim(), user.id);
        if (n && n.image && n.image.startsWith('/i/')) c.__uid = n.image.slice(3);
      }
    }

    // ---- stage 2: one transaction for the semantic records
    db.exec('BEGIN');
    try {
      const r = q("INSERT INTO ensembles(user_id,title,description,private,status) VALUES(?,?,?,1,'pending_review')")
        .run(user.id, a.title, a.description || '');
      const ens = q('SELECT * FROM ensembles WHERE id=?').get(r.lastInsertRowid);
      recordProvenance('ensemble', ens.uid, 'created', ctx, { source_kind: 'manual', fields: 'pending_review' });
      // Staging is not the commitment moment, so no Notes are materialised yet.
      const saved = saveEnsembleComponents(ens, user, comps, ctx, false);
      const ar = q('INSERT INTO ensemble_artifacts(ensemble_id,image_uid,lineage) VALUES(?,?,?)')
        .run(ens.id, artifactUid, lineageOf(ens.id));
      const primary = uidOf('ensemble_artifacts', ar.lastInsertRowid);
      q('UPDATE ensembles SET primary_artifact_uid=? WHERE id=?').run(primary, ens.id);
      recordProvenance('ensemble_artifact', primary, 'created', ctx, { source_kind: 'generated', source_ref: ens.uid });
      verifyEnsembleAssets(ens, saved);
      const result = { text: `Staged for review: ${a.title}. ${saved.components.length} piece`
        + `${saved.components.length === 1 ? '' : 's'} and the composition are saved to discriminant.ly and visible to `
        + `${esc(user.handle)} only. Show the member the composition and ask whether to keep it. `
        + `If yes call keep_ensemble with id ${ens.id}; if no call discard_ensemble with id ${ens.id}.`,
        structured: { ok: true, status: 'pending_review', ensemble_uid: ens.uid, ensemble_id: ens.id,
          private: true, primary_artifact_uid: primary, artifacts: [primary], artifact_image_uid: artifactUid,
          components: saved.components, notes_created: [], notes_reused: [],
          unresolved_component_uids: saved.unresolved } };
      db.exec('COMMIT');
      return result;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (name === 'keep_ensemble') {
    const e = q('SELECT * FROM ensembles WHERE id=?').get(a.id);
    if (!e) throw new Error(`No ensemble #${a.id}`);
    if (e.user_id !== user.id) throw new Error('That ensemble does not belong to this member');
    // Retrying Keep must not materialise a second set of Notes.
    if (e.status === 'saved') {
      return { text: `${e.title} is already kept.`, structured: { ok: true, status: 'saved',
        ensemble_uid: e.uid, ensemble_id: e.id, private: !!e.private,
        primary_artifact_uid: e.primary_artifact_uid || null,
        artifact_image_uid: (q('SELECT image_uid FROM ensemble_artifacts WHERE uid=?').get(e.primary_artifact_uid || '') || {}).image_uid || null,
        notes_created: [], notes_reused: [], unresolved_component_uids: [], components: [] } };
    }
    const ctx = mcpActor(user);
    db.exec('BEGIN');
    try {
      // Keep IS the commitment boundary: now the qualifying constituents are
      // worth recording, so existing Notes are reused and missing ones made.
      const out = { notes_created: [], notes_reused: [], components: [], unresolved: [] };
      for (const c of ensComponents(e.id)) {
        if (c.note_uid) {
          out.notes_reused.push(c.note_uid);
          out.components.push({ component_uid: c.uid, state: 'linked', note_uid: c.note_uid, note_origin: 'pre_existing', label: c.label , image_uid: c.image_uid || null });
          continue;
        }
        const basis = componentIdentityBasis(c.uid);
        if (QUALIFYING_BASIS.has(basis) && c.label) {
          const existing = findExistingNote(user.id, { note_uid: null, source_url: c.source_url, label: c.label });
          if (existing) {
            q('UPDATE ensemble_components SET note_uid=?, state=\'linked\', updated_at=CURRENT_TIMESTAMP WHERE id=?').run(existing.uid, c.id);
            out.notes_reused.push(existing.uid);
            out.components.push({ component_uid: c.uid, state: 'linked', note_uid: existing.uid, note_origin: 'pre_existing', label: c.label , image_uid: c.image_uid || null });
            continue;
          }
          // Auto-created Notes are private by default, and share the component's
          // already-stored image rather than re-ingesting the same bytes.
          const nr = q("INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,'','',?,?,1)")
            .run(user.id, c.label, c.source_url || '', c.image_uid ? `/i/${c.image_uid}` : '');
          const nUid = uidOf('objects', nr.lastInsertRowid);
          recordProvenance('object', nUid, 'created', ctx, { source_kind: 'ensemble', source_ref: e.uid, fields: basis });
          q('UPDATE ensemble_components SET note_uid=?, state=\'linked\', updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nUid, c.id);
          out.notes_created.push(nUid);
          out.components.push({ component_uid: c.uid, state: 'linked', note_uid: nUid, note_origin: 'created_by_ensemble', label: c.label , image_uid: c.image_uid || null });
          continue;
        }
        out.unresolved.push(c.uid);
        out.components.push({ component_uid: c.uid, state: 'unresolved', note_uid: null, note_origin: null, label: c.label , image_uid: c.image_uid || null });
      }
      const priv = a.private === undefined ? 1 : (a.private ? 1 : 0);
      q("UPDATE ensembles SET status='saved', private=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(priv, e.id);
      recordProvenance('ensemble', e.uid, 'edited', ctx, { fields: 'status:saved' });
      verifyEnsembleAssets(e, out);
      const nc = out.notes_created.length, nr2 = out.notes_reused.length, un = out.unresolved.length;
      const parts = [`Kept: ${e.title}.`];
      if (nc) parts.push(`${nc} new ${nc === 1 ? 'note' : 'notes'} added (private).`);
      if (nr2) parts.push(`${nr2} existing ${nr2 === 1 ? 'note' : 'notes'} reused.`);
      if (un) parts.push(`${un} ${un === 1 ? 'piece remains' : 'pieces remain'} unidentified.`);
      const result = { text: parts.join(' '), structured: { ok: true, status: 'saved',
        ensemble_uid: e.uid, ensemble_id: e.id, private: !!priv,
        primary_artifact_uid: e.primary_artifact_uid || null,
        artifact_image_uid: (q('SELECT image_uid FROM ensemble_artifacts WHERE uid=?').get(e.primary_artifact_uid || '') || {}).image_uid || null,
        components: out.components, notes_created: out.notes_created,
        notes_reused: out.notes_reused, unresolved_component_uids: out.unresolved } };
      db.exec('COMMIT');
      return result;
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  if (name === 'get_ensemble') {
    const e = q('SELECT * FROM ensembles WHERE id=?').get(a.id);
    if (!e || !ensCanSee(e, user)) throw new Error(`No ensemble #${a.id}`);
    const v = ensembleView(e, user);
    const lines = [`${v.title}${v.private ? ' (private)' : ''} — ${v.components.length} components, ${v.artifacts.length} generated image(s)`];
    if (v.description) lines.push(v.description);
    v.components.forEach((c) => lines.push(`  ${c.state === 'linked' ? '·' : '?'} ${c.label || '(unlabelled)'}${c.state === 'unresolved' ? ' — unidentified' : ''}`));

    // Return the pictures themselves, in a deliberate order: the primary
    // rendering first, then the other renderings, then any component images.
    // The text names each one in the same order so the member can be told
    // which picture is which rather than being handed an unlabelled pile.
    const images = [];
    const caption = [];
    const primary = v.artifacts.find((x) => x.is_primary) || v.artifacts[0];
    const pushImg = (ref, label) => {
      const b = imageBlock(ref);
      if (b) { images.push(b); caption.push(label); }
      else if (ref) caption.push(`${label} (too large to show here — open it on discriminant.ly)`);
    };
    if (primary) pushImg(primary.image, 'the current composition');
    v.artifacts.filter((x) => primary && x.artifact_uid !== primary.artifact_uid)
      .forEach((x, i) => pushImg(x.image, `alternate version ${i + 1}`));
    v.components.filter((c) => c.image).forEach((c) => pushImg(c.image, `component: ${c.label || 'unidentified'}`));
    if (caption.length) lines.push('', 'Images below, in order: ' + caption.join('; ') + '.');
    return { text: lines.join('\n'), structured: v, images };
  }
  if (name === 'list_ensembles') {
    const rows = q('SELECT * FROM ensembles WHERE user_id=? ORDER BY id DESC LIMIT ?')
      .all(user.id, Math.min(+a.limit || 20, 50));
    return { text: rows.map((e) => `#${e.id} ${e.title}${e.private ? ' (private)' : ''}`).join('\n') || 'No ensembles yet.',
      structured: { items: rows.map((e) => {
        const cs = ensComponents(e.id);
        const pa = e.primary_artifact_uid ? q('SELECT image_uid FROM ensemble_artifacts WHERE uid=?').get(e.primary_artifact_uid) : null;
        return { type: 'ensemble', uid: e.uid, id: e.id, title: e.title, private: !!e.private,
          primary_image: pa ? `/i/${pa.image_uid}` : null, component_count: cs.length,
          unresolved_count: cs.filter((c) => c.state === 'unresolved').length, created_at: e.created_at }; }) } };
  }
  if (name === 'discard_ensemble') {
    const e = q('SELECT * FROM ensembles WHERE id=?').get(a.id);
    if (!e) throw new Error(`No ensemble #${a.id}`);
    if (e.user_id !== user.id) throw new Error('That ensemble does not belong to this member');
    const ctx = mcpActor(user);
    const { keep, drop } = notesSafeToDiscard(e);
    db.exec('BEGIN');
    try {
      for (const n of drop) {
        recordProvenance('object', n.uid, 'deleted', ctx, { source_kind: 'ensemble_discarded', source_ref: e.uid });
        dropWarrantsFor('object', n.uid);
        q('DELETE FROM objects WHERE id=?').run(n.id);
      }
      recordProvenance('ensemble', e.uid, 'deleted', ctx, { source_kind: 'discarded' });
      q('DELETE FROM ensembles WHERE id=?').run(e.id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    const parts = [`Discarded: ${e.title}.`];
    if (drop.length) parts.push(`Removed ${drop.length} note${drop.length === 1 ? '' : 's'} it had added.`);
    if (keep.length) parts.push(`Kept ${keep.length}: ${keep.map((k) => `${k.name} (${k.reasons.join(', ')})`).join('; ')}.`);
    if (!drop.length && !keep.length) parts.push('It had not added any notes.');
    return { text: parts.join(' '), structured: { ok: true, ensemble_uid: e.uid,
      notes_deleted: drop.map((n) => n.uid),
      notes_kept: keep.map((k) => ({ uid: k.uid, name: k.name, reasons: k.reasons })) } };
  }
  if (name === 'add_ensemble_artifact' || name === 'set_primary_artifact' || name === 'remove_ensemble_artifact'
      || name === 'add_ensemble_component' || name === 'edit_ensemble' || name === 'delete_ensemble') {
    const e = q('SELECT * FROM ensembles WHERE id=?').get(a.id);
    if (!e) throw new Error(`No ensemble #${a.id}`);
    if (e.user_id !== user.id) throw new Error('That ensemble does not belong to this member');
    const ctx = mcpActor(user);
    if (name === 'add_ensemble_artifact') {
      // Same resolution path as create_pending_ensemble: an already-uploaded
      // uid is preferred and reused as-is; a URL or data: URL is ingested.
      const iu = await resolveAssetRef(user.id, { image_uid: a.image_uid, image: a.image },
        ctx, 'generated', 'The composition image');
      if (!iu) throw new Error('An image is required: pass `image_uid` from upload_image, or `image` as an '
        + 'https:// URL or data: URL. Nothing was saved.');
      const ar = q('INSERT INTO ensemble_artifacts(ensemble_id,image_uid,lineage) VALUES(?,?,?)')
        .run(e.id, iu, lineageOf(e.id));
      const uid = uidOf('ensemble_artifacts', ar.lastInsertRowid);
      recordProvenance('ensemble_artifact', uid, 'created', ctx, { source_kind: 'generated', source_ref: e.uid });
      if (a.make_primary !== false) {
        q('UPDATE ensembles SET primary_artifact_uid=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(uid, e.id);
        recordProvenance('ensemble', e.uid, 'edited', ctx, { fields: 'primary_artifact_uid' });
      }
      return wr(`Added a generated image to ${e.title}.`, 'created', 'ensemble_artifact', e.id, uid, e.title);
    }
    if (name === 'set_primary_artifact') {
      const art = q('SELECT * FROM ensemble_artifacts WHERE uid=? AND ensemble_id=?').get(a.artifact_uid, e.id);
      if (!art) throw new Error('No such artifact on this ensemble');
      q('UPDATE ensembles SET primary_artifact_uid=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(art.uid, e.id);
      recordProvenance('ensemble', e.uid, 'edited', ctx, { fields: 'primary_artifact_uid' });
      return wr(`Primary image set for ${e.title}.`, 'edited', 'ensemble', e.id, e.uid, e.title);
    }
    if (name === 'remove_ensemble_artifact') {
      const art = q('SELECT * FROM ensemble_artifacts WHERE uid=? AND ensemble_id=?').get(a.artifact_uid, e.id);
      if (!art) throw new Error('No such artifact on this ensemble');
      recordProvenance('ensemble_artifact', art.uid, 'deleted', ctx, { source_ref: e.uid });
      q('DELETE FROM ensemble_artifacts WHERE id=?').run(art.id);
      // the image bytes are deliberately kept — removing the artifact record
      // is not the same act as destroying an immutable original
      if (e.primary_artifact_uid === art.uid) {
        const next = q('SELECT uid FROM ensemble_artifacts WHERE ensemble_id=? ORDER BY id DESC LIMIT 1').get(e.id);
        q('UPDATE ensembles SET primary_artifact_uid=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next ? next.uid : null, e.id);
      }
      return wr(`Removed a generated image from ${e.title}.`, 'deleted', 'ensemble_artifact', e.id, art.uid, e.title);
    }
    if (name === 'add_ensemble_component') {
      const pos = (q('SELECT COALESCE(MAX(position),-1) p FROM ensemble_components WHERE ensemble_id=?').get(e.id).p) + 1;
      // saveEnsembleComponents consumes a pre-resolved uid (network fetches must
      // not run inside its write path), so resolve here first — without this the
      // advertised `image` argument was silently ignored and the call refused
      // itself for having no image.
      const one = { label: a.label, note_uid: a.note_uid, source_url: a.source_url,
        image: a.image, image_uid: a.image_uid, identity_basis: a.identity_basis };
      one.__uid = await resolveAssetRef(user.id, one, ctx, 'upload', `The image for "${a.label || 'a component'}"`);
      if (!one.__uid && (a.note_uid || '').trim()) {
        const n = q('SELECT image FROM objects WHERE uid=? AND user_id=?').get(a.note_uid.trim(), user.id);
        if (n && n.image && n.image.startsWith('/i/')) one.__uid = n.image.slice(3);
      }
      const saved = saveEnsembleComponents(e, user, [one], ctx);
      q('UPDATE ensemble_components SET position=? WHERE uid=?').run(pos, saved.components[0].component_uid);
      const c = saved.components[0];
      return wr(`Added ${c.label} to ${e.title}${c.note_origin === 'created_by_ensemble' ? ' and to notes (private)' : ''}.`,
        'created', 'ensemble_component', e.id, c.component_uid, c.label);
    }
    if (name === 'edit_ensemble') {
      const f = [];
      if (a.title !== undefined) { q('UPDATE ensembles SET title=? WHERE id=?').run(a.title, e.id); f.push('title'); }
      if (a.description !== undefined) { q('UPDATE ensembles SET description=? WHERE id=?').run(a.description, e.id); f.push('description'); }
      if (a.private !== undefined) { q('UPDATE ensembles SET private=? WHERE id=?').run(a.private ? 1 : 0, e.id); f.push('private'); }
      if (!f.length) return wr(`Nothing to change on ${e.title}.`, 'unchanged', 'ensemble', e.id, e.uid, e.title);
      q('UPDATE ensembles SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(e.id);
      recordProvenance('ensemble', e.uid, 'edited', ctx, { fields: f.join(',') });
      return wr(`Updated ${a.title || e.title}.`, 'edited', 'ensemble', e.id, e.uid, a.title || e.title);
    }
    recordProvenance('ensemble', e.uid, 'deleted', ctx, {});
    q('DELETE FROM ensembles WHERE id=?').run(e.id);
    return wr(`Deleted ensemble: ${e.title}. Linked notes were kept.`, 'deleted', 'ensemble', e.id, e.uid, e.title);
  }
  if (name === 'remove_ensemble_component') {
    const c = q('SELECT c.*, e.user_id, e.title, e.uid AS euid FROM ensemble_components c JOIN ensembles e ON e.id=c.ensemble_id WHERE c.uid=?').get(a.component_uid);
    if (!c) throw new Error('No such component');
    if (c.user_id !== user.id) throw new Error('That component does not belong to this member');
    recordProvenance('ensemble_component', c.uid, 'deleted', mcpActor(user), { source_ref: c.euid });
    q('DELETE FROM ensemble_components WHERE id=?').run(c.id);
    return wr(`Removed ${c.label || 'a component'} from ${c.title}. Any linked note was kept.`,
      'deleted', 'ensemble_component', c.id, c.uid, c.label || '');
  }
  if (name === 'resolve_ensemble_component') {
    const c = q('SELECT c.*, e.user_id, e.uid AS euid, e.title FROM ensemble_components c JOIN ensembles e ON e.id=c.ensemble_id WHERE c.uid=?').get(a.component_uid);
    if (!c) throw new Error('No such component');
    if (c.user_id !== user.id) throw new Error('That component does not belong to this member');
    if (!a.note_uid && !a.label) throw new Error('Give either note_uid (an existing note) or label (to create one)');
    const ctx = mcpActor(user);
    const prior = c.note_uid || null;
    let noteUid = null;
    if (a.note_uid) {
      const n = q('SELECT * FROM objects WHERE uid=? AND user_id=?').get(a.note_uid, user.id);
      if (!n) throw new Error('No such note belonging to this member');
      noteUid = n.uid;
    } else {
      const basis = a.identity_basis || 'user_identity';
      if (!QUALIFYING_BASIS.has(basis)) throw new Error('identity_basis must be canonical evidence, not a guess');
      const r = q(`INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,'','',?,?,1)`)
        .run(user.id, a.label, a.source_url || '', c.image_uid ? `/i/${c.image_uid}` : '');
      noteUid = uidOf('objects', r.lastInsertRowid);
      recordProvenance('object', noteUid, 'created', ctx, { source_kind: 'ensemble', source_ref: c.euid, fields: basis });
    }
    // The SAME component: the constituent did not change, only what is known
    // about it. A correction records what it supersedes rather than erasing it.
    q("UPDATE ensemble_components SET state='linked', note_uid=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(noteUid, c.id);
    recordProvenance('ensemble_component', c.uid, prior ? 'corrected' : 'resolved', ctx,
      { source_kind: a.identity_basis || 'user_identity', source_ref: noteUid, fields: prior ? `superseded:${prior}` : null });
    return wr(prior ? `Corrected: now identified as ${a.label || noteUid}.` : `Identified as ${a.label || noteUid}.`,
      prior ? 'corrected' : 'resolved', 'ensemble_component', c.id, c.uid, a.label || '');
  }
  if (name === 'list_unresolved_components') {
    const rows = a.id
      ? q(`SELECT c.*, e.uid euid, e.id eid, e.title FROM ensemble_components c JOIN ensembles e ON e.id=c.ensemble_id
           WHERE e.user_id=? AND e.id=? AND c.state='unresolved' ORDER BY e.id DESC, c.position`).all(user.id, a.id)
      : q(`SELECT c.*, e.uid euid, e.id eid, e.title FROM ensemble_components c JOIN ensembles e ON e.id=c.ensemble_id
           WHERE e.user_id=? AND c.state='unresolved' ORDER BY e.id DESC, c.position`).all(user.id);
    return { text: rows.map((r) => `${r.label || '(unlabelled)'} — in ${r.title}`).join('\n') || 'Nothing unidentified.',
      structured: { items: rows.map((r) => ({ component_uid: r.uid, ensemble_uid: r.euid, ensemble_id: r.eid,
        ensemble_title: r.title, label: r.label || '', image: r.image_uid ? `/i/${r.image_uid}` : '' })) } };
  }
  if (name === 're_note') {
    if (!a.id) throw new Error('id is required');
    const src = q('SELECT * FROM objects WHERE id=?').get(a.id);
    if (!src) throw new Error(`No note #${a.id}`);
    if (!canSee(src, user)) throw new Error(`No note #${a.id}`);
    if (src.user_id === user.id) throw new Error('That note already belongs to this member — there is nothing to adopt.');
    const note = renoteFrom(src, user, mcpActor(user));
    const prior = alreadyAdopted(user.id, src.uid).count;
    return wr(`Adopted as #${note.id}: ${note.name}`, 'created', 'note', note.id, note.uid, note.name,
      prior > 1 ? `${prior} adoptions of this source` : undefined);
  }
  if (name === 'delete_note') {
    if (!a.id) throw new Error('id is required');
    const o = q('SELECT * FROM objects WHERE id=?').get(a.id);
    if (!o) throw new Error(`No note #${a.id}`);
    if (o.user_id !== user.id) throw new Error(`Note #${a.id} does not belong to this member`);
    recordProvenance('object', o.uid, 'deleted', mcpActor(user));
    dropWarrantsFor('object', o.uid);
    q('DELETE FROM objects WHERE id=?').run(o.id);
    return wr(`Deleted #${a.id}: ${o.name}`, 'deleted', 'note', o.id, o.uid, o.name);
  }
  // ---- Itineraries ----------------------------------------------------------
  // Every branch is a thin wrapper over the same core function the web routes
  // call. Nothing here writes the itinerary tables directly, so the two surfaces
  // cannot drift. ctx is mcpActor(user): ai_on_behalf + explicit, because the
  // member asked for the operation even though the AI performed it.
  {
    const T_IN = (a) => {
      const t = {};
      if (a.year !== undefined) t.t_year = a.year;
      if (a.month !== undefined) t.t_month = a.month;
      if (a.day !== undefined) t.t_day = a.day;
      if (a.period !== undefined) t.t_period = a.period;
      if (a.modifier !== undefined) t.t_modifier = a.modifier;
      if (a.modifier_scope !== undefined) t.t_modifier_scope = a.modifier_scope;
      if (a.weekday !== undefined) t.t_weekday = a.weekday;
      if (a.daypart !== undefined) t.t_daypart = a.daypart;
      if (a.clock !== undefined) t.t_clock = a.clock;
      for (const c of a.clear || []) { const k = 't_' + c.replace(/^t_/, ''); if (T_COLS.includes(k)) t[k] = null; }
      return t;
    };
    const stopView = (st) => ({
      uid: st.uid, label: st.label, kind: st.resolution, mark_uid: st.mark_uid,
      position: st.position, visibility: st.visibility, when: temporalFormat(temporalOf(st)) || null,
    });

    if (name === 'create_itinerary') {
      const ctx = mcpActor(user);
      const it = itineraryCreate(user, { title: a.title, context: a.context || '',
        temporal: T_IN(a), private: a.private === false ? 0 : 1 }, ctx);
      const when = temporalFormat(temporalOf(it));
      return wr(`Started "${it.title}"${when ? ' \u00b7 ' + when : ''}.`, 'created', 'itinerary', it.id, it.uid, it.title);
    }

    if (name === 'add_itinerary_stops') {
      const ctx = mcpActor(user);
      const added = [];
      for (const sp of a.stops || []) {
        const st = stopAdd(user, a.itinerary_uid, {
          label: sp.label, resolution: sp.kind || null, mark_uid: sp.mark_uid || null,
          new_place: sp.new_place || null,
          group_uid: sp.group_uid || null,
          temporal: T_IN({ daypart: sp.daypart, clock: sp.clock }),
        }, ctx);
        added.push(stopView(st));
      }
      const it = itinOwned(user, a.itinerary_uid);
      return { text: `Added ${added.length} stop${added.length === 1 ? '' : 's'} to "${it.title}".`,
        structured: { ok: true, action: 'created', subject: 'itinerary_stop', stops: added,
          itinerary_private: !!it.private } };
    }

    if (name === 'update_itinerary') {
      const ctx = mcpActor(user);
      let it = itinOwned(user, a.itinerary_uid);
      if (a.title !== undefined || a.context !== undefined) it = itineraryEdit(user, it.uid, a, ctx);
      if (a.private === true) it = itineraryUnpublish(user, it.uid, ctx);
      if (a.private === false) it = itineraryPublish(user, it.uid, ctx);   // throws, with the conflicting marks named
      return wr(`Updated "${it.title}".`, 'edited', 'itinerary', it.id, it.uid, it.title);
    }

    if (name === 'update_itinerary_temporal') {
      const ctx = mcpActor(user);
      const intent = a.intent || null;
      const t = T_IN(a);
      let row;
      if (a.target === 'itinerary') row = itineraryUpdateTemporal(user, a.uid, t, intent, ctx);
      else if (a.target === 'day') row = groupUpdateTemporal(user, a.uid, t, intent, ctx);
      else row = stopUpdateTemporal(user, a.uid, t, intent, ctx);
      const conflicts = temporalConflicts(temporalOf(row));
      return { text: `Now ${temporalFormat(temporalOf(row)) || 'undated'}.` +
                     (conflicts.length ? ' Note: ' + conflicts.join(' ') : ''),
        structured: { ok: true, action: intent === 'refine' ? 'enriched' : intent === 'correct' ? 'corrected' : 'edited',
          subject: a.target, uid: row.uid, when: temporalFormat(temporalOf(row)) || null, conflicts } };
    }

    if (name === 'arrange_itinerary') {
      const ctx = mcpActor(user);
      const it = itinOwned(user, a.itinerary_uid);
      let day = null;
      if (a.create_day) {
        day = groupCreate(user, it.uid, { label: a.create_day.label || '',
          temporal: T_IN(a.create_day) }, ctx);
      }
      for (const as of a.assign || []) {
        stopSetGroup(user, as.stop_uid, as.day_uid !== undefined ? as.day_uid : (day ? day.uid : null),
          as.position, ctx);
      }
      // An explicit order is an assertion; without one, stops stay unsequenced.
      (a.order_stops || []).forEach((uid, i) => stopSetPosition(user, uid, i + 1, ctx));
      (a.order_days || []).forEach((uid, i) => groupSetPosition(user, uid, i + 1, ctx));
      const days = groupOrder(it.id).map((g) => ({ uid: g.uid, label: g.label,
        when: temporalFormat(temporalOf(g)) || null,
        stops: itineraryStops(it.id, g.id).map(stopView) }));
      return { text: `Arranged "${it.title}".`,
        structured: { ok: true, action: 'edited', subject: 'itinerary', uid: it.uid,
          days, unplaced: itineraryStops(it.id, null).map(stopView),
          conflicts: groupConflicts(it.id) } };
    }

    if (name === 'resolve_itinerary_stop') {
      const ctx = mcpActor(user);
      const st = a.unlink
        ? stopUnresolve(user, a.stop_uid, a.kind || 'particular', ctx)
        : stopResolveToMark(user, a.stop_uid, a.mark_uid, a.intent || null, ctx);
      const itin = itinById(st.itinerary_id);
      return { text: a.unlink ? `Unlinked "${st.label}".` : `"${st.label}" now points at that mark.` +
                 (itin.private ? ' The itinerary is private, because that mark is.' : ''),
        structured: { ok: true, action: a.unlink ? 'corrected' : (a.intent === 'correct' ? 'corrected' : a.intent === 'refine' ? 'enriched' : 'edited'),
          subject: 'itinerary_stop', uid: st.uid, stop: stopView(st), itinerary_private: !!itin.private } };
    }

    if (name === 'update_itinerary_stop') {
      const ctx = mcpActor(user);
      let st = stopOwned(user, a.stop_uid).stop;
      if (a.label !== undefined) st = stopEdit(user, st.uid, a, ctx);
      if (a.kind !== undefined) st = stopSetResolution(user, st.uid, a.kind, ctx);
      if (a.visibility === 'suspended') st = stopSuspend(user, st.uid, ctx);
      if (a.visibility === 'visible') st = stopRestore(user, st.uid, ctx);
      return wr(`Updated "${st.label}".`, 'edited', 'itinerary_stop', st.id, st.uid, st.label);
    }

    if (name === 'delete_itinerary_entity') {
      const ctx = mcpActor(user);
      if (a.kind === 'itinerary') { itineraryDelete(user, a.uid, ctx); return wr('Itinerary deleted.', 'deleted', 'itinerary', null, a.uid, null); }
      if (a.kind === 'day') { groupDelete(user, a.uid, ctx); return wr('Day deleted; its stops remain, unplaced.', 'deleted', 'itinerary_group', null, a.uid, null); }
      stopDelete(user, a.uid, ctx);
      return wr('Stop deleted.', 'deleted', 'itinerary_stop', null, a.uid, null);
    }

    if (name === 'my_itineraries') {
      if (a.uid) {
        const it = itinOwned(user, a.uid);
        const days = groupOrder(it.id).map((g) => ({ uid: g.uid, label: g.label,
          when: temporalFormat(temporalOf(g)) || null, position: g.position,
          stops: itineraryStops(it.id, g.id).map(stopView) }));
        return { text: `"${it.title}"${temporalFormat(temporalOf(it)) ? ' \u00b7 ' + temporalFormat(temporalOf(it)) : ''}`,
          structured: { ok: true, subject: 'itinerary', uid: it.uid, title: it.title,
            context: it.context, private: !!it.private,
            when: temporalFormat(temporalOf(it)) || null, days,
            unplaced: itineraryStops(it.id, null).map(stopView),
            conflicts: groupConflicts(it.id) } };
      }
      const rows = q('SELECT * FROM itineraries WHERE user_id=? ORDER BY id DESC LIMIT ?')
        .all(user.id, Math.min(a.limit || 20, 50));
      return { text: rows.length ? rows.map((r) => `${r.title}${temporalFormat(temporalOf(r)) ? ' \u00b7 ' + temporalFormat(temporalOf(r)) : ''}`).join('\n') : 'No itineraries yet.',
        structured: { ok: true, items: rows.map((r) => ({ uid: r.uid, title: r.title,
          when: temporalFormat(temporalOf(r)) || null, private: !!r.private,
          stops: q('SELECT COUNT(*) c FROM itinerary_stops WHERE itinerary_id=?').get(r.id).c })) } };
    }
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
  if (method === 'initialize') return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'discriminant.ly', version: '1.3' }, instructions: `You are connected to discriminant.ly as ${user.name} (@${user.handle}) [ensemble_contract: chunked-upload-v4-autofinal; catalogue-images-v5].

HOW TO WORK HERE. Never say something was saved before the tool call that saves it has returned successfully. If a call fails you will get a reference code — tell the member it failed, quote the reason and the code, and never quietly carry on as if it worked. Do not retry an identical failing call more than once. When a tool result tells you what to do next, do it without pausing to ask the member: internal plumbing is not their decision. Confirm before deleting anything.

WHAT LIVES HERE. Notes are objects the member recorded. Travel marks are places they went, with check-ins recording when. Collections group either. A note or mark means they thought it worth recording — never that they own or endorse it; ownership is record_note_ownership and endorsement is warrant, each its own deliberate act. Comments are remarks in conversation, not records of taste.

BEFORE ANSWERING ABOUT THEIR CATALOGUE. For anything like \"have I noted…\", \"what's in my…\", \"how many…\", call search_catalogue or catalogue_stats. Do not answer from memory of this conversation, and do not settle for recent_notes.

WRITING. For a note, write a crisp headline and a short description in the member's voice, propose tags, then note_object. For a place use add_travel_mark, and call verify_place first unless you already have a precise address — show the member the match, or the fact that nothing matched, and never invent coordinates. Both tools refuse near-duplicates: if that happens, say what already exists and ask before retrying with allow_duplicate. Use edit_note / edit_travel_mark to change things, passing only the fields that change.

IMAGES THE MEMBER ALREADY HAS. Every note and mark reports has_image and image_uid. If a thing is already in their catalogue, its picture is already here: look at it with view_images, and pass its image_uid straight on. Never ask the member to attach a picture of something they have already noted, and never upload it again.

${ingestDirective(user).line}\n\nIMAGES FROM YOUR OWN SANDBOX. An attachment or a picture you generated is a local file — that file is the SOURCE of the bytes, not the argument. A file id or a path means nothing to this server and is never a reason to stop. Read the bytes in your code environment, keep good visual quality, then call begin_image_upload with the first slice. Every reply says what to do next and there are only two answers: 'receiving' means call upload_image_chunk with the index in next_index; 'stored' means the image is saved and image_uid is ready. Keep going until 'stored' without pausing. Never put a whole image in one tool argument: runtimes truncate long arguments unpredictably, which is exactly why the bytes go in slices. An image already at a public https:// URL needs none of this — upload_image with the URL is enough.

ENSEMBLES. When the member asks to combine or compose things visually: look at each constituent (view_images for anything already in their catalogue), generate the composition yourself — discriminant.ly does not generate it — ingest only what is genuinely new, then call create_pending_ensemble with the uids. Only after it succeeds, ask whether to keep or discard, and call keep_ensemble or discard_ensemble with the id you already have.` });
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
      // Some results are pictures. A path like /i/<uid> is useless to a model —
      // it is relative, and a private image needs this member's session — so
      // when a tool returns images we hand back the bytes as MCP image blocks,
      // which is the only way the composition can actually be shown.
      if (out && typeof out === 'object' && Array.isArray(out.images)) {
        for (const im of out.images) payload.content.push({ type: 'image', data: im.data, mimeType: im.mimeType });
      }
      if (out && typeof out === 'object' && out.structured) payload.structuredContent = out.structured;
      return reply(id, payload);
    } catch (e) {
      // Every failure gets a short reference, is logged server-side, and comes
      // back in a shape the model is told to show the member verbatim. A
      // failure the member never sees is a failure we cannot troubleshoot.
      const ref = 'DL-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      // Deliberate refusals carry a message written for the member. An
      // unexpected fault does not, and must not leak internals — but it is the
      // one we most want in the log.
      const deliberate = e instanceof Error && !!e.message && !/^(Cannot read|Cannot access|undefined is not|.* is not a function)/.test(e.message);
      const argKeys = Object.keys(params.arguments || {}).join(',');   // names only, never values
      console.log(`[tool-error] ref=${ref} tool=${params.name} member=@${user.handle} args=[${argKeys}] `
        + `kind=${deliberate ? 'refused' : 'fault'} msg=${JSON.stringify(String(e.message || '').slice(0, 300))}`);
      if (!deliberate && e && e.stack) console.log(`[tool-error] ref=${ref} stack=${e.stack.split('\n').slice(0, 3).join(' | ')}`);
      const detail = deliberate ? e.message
        : 'Something went wrong inside discriminant.ly while running this. Nothing was saved.';
      return reply(id, {
        content: [{ type: 'text', text: `${detail}\n\n[${params.name} failed — reference ${ref}] `
          + `TELL THE MEMBER THIS FAILED, quote the reason and this reference, and say what you were attempting. `
          + `Do not describe the action as done, do not work around it silently, and do not retry the identical call `
          + `more than once.` }],
        structuredContent: { ok: false, error: { reference: ref, tool: params.name,
          kind: deliberate ? 'refused' : 'fault', message: detail, retryable: !deliberate } },
        isError: true });
    }
  }
  return reply(id, null, { code: -32601, message: 'Method not found' });
}

// ---------- router ----------
const STATIC = { '/style.css': 'text/css', '/style.modern.css': 'text/css', '/style.shared.css': 'text/css', '/welcome-shot-itin-dark.jpg': 'image/jpeg', '/welcome-shot-itin-light.jpg': 'image/jpeg', '/welcome-phone-ask.jpg': 'image/jpeg', '/welcome-phone-profile-light.jpg': 'image/jpeg', '/welcome-phone-profile-dark.jpg': 'image/jpeg', '/welcome-phone-chat.jpg': 'image/jpeg', '/welcome-phone-app-light.jpg': 'image/jpeg', '/welcome-phone-app-dark.jpg': 'image/jpeg', '/mark.png': 'image/png', '/mark@4x.png': 'image/png', '/nub.png': 'image/png', '/favicon.png': 'image/png', '/apple-touch-icon.png': 'image/png', '/icon-192.png': 'image/png', '/icon-256.png': 'image/png', '/icon-512.png': 'image/png', '/icon-512-maskable.png': 'image/png', '/icon-mcp.png': 'image/png', '/plus.png': 'image/png', '/plus-sm.png': 'image/png', '/minus.png': 'image/png', '/chev.png': 'image/png', '/close.png': 'image/png', '/sw.js': 'application/javascript', '/manifest.webmanifest': 'application/manifest+json', '/welcome-shot.jpg': 'image/jpeg', '/welcome-shot-modern-dark.jpg': 'image/jpeg', '/welcome-shot-modern-light.jpg': 'image/jpeg' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  // HEAD is routed as GET, with the body suppressed — uptime checks and link
  // checkers use it, and it should answer like the GET it mirrors.
  const isHead = req.method === 'HEAD';
  const m = isHead ? 'GET' : req.method;
  if (isHead) { const end = res.end.bind(res); res.end = () => end(); }
  CURRENT_REQ = req;
  const me = currentUser(req);
  // Keep the look cookies in step with the member's stored setting on every
  // request, so signing out (or opening /welcome in another tab) never lands
  // on a different theme than the one they were just using.
  if (me) {
    const ck = cookies(req);
    if (ck.skin !== skinOf(me) || ck.mode !== modeOf(me)) {
      res.setHeader('Set-Cookie', [
        `skin=${skinOf(me)}; Path=/; Max-Age=31536000; SameSite=Lax`,
        `mode=${modeOf(me)}; Path=/; Max-Age=31536000; SameSite=Lax`]);
    }
  }
  const need = () => { redirect(res, '/login'); return true; };
  let mt;

  // Images are served by uid. The old /i/<integer> form still resolves so that
  // anything already linking to it keeps working, but BOTH forms now go
  // through the same visibility check — the integer path was previously
  // unauthenticated and sequential, so a private note's bytes could be
  // fetched by anyone counting upwards.
  if ((mt = p.match(/^\/i\/([0-9a-f-]{8,}|\d+)$/i))) {
    const key = mt[1];
    const img = /^\d+$/.test(key)
      ? q('SELECT * FROM images WHERE id=?').get(+key)
      : q('SELECT * FROM images WHERE uid=?').get(key);
    if (!img) return send(res, 'Not found', 404);
    if (!imageVisibleTo(img, me)) return send(res, 'Not found', 404);
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': img.bytes.length,
      // private images must not be cached by shared proxies
      'Cache-Control': imageIsPublic(img) ? 'public, max-age=31536000, immutable'
                                          : 'private, max-age=86400' });
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
  if (p === '/settings/skin' && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req);
    const skin = b.skin === 'modern' ? 'modern' : 'classic';     // the switch sends no value when off
    const mode = MODES.has(b.mode) ? b.mode : modeOf(me);
    q('UPDATE users SET ui_skin=?, ui_mode=? WHERE id=?').run(skin, mode, me.id);
    res.setHeader('Set-Cookie', [`skin=${skin}; Path=/; Max-Age=31536000; SameSite=Lax`, `mode=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`]);
    return redirect(res, '/settings');
  }
  if (p === '/settings/ingest' && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req);
    const mode = INGEST_MODES.has(b.mode) ? b.mode : 'auto';
    q('UPDATE users SET ingest_mode=? WHERE id=?').run(mode, me.id);
    return redirect(res, '/settings');
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
    // carry the member's look into the cookies too, so the signed-out pages
    // they meet next (logout, a second tab) do not snap to a different theme
    const lookCookies = [`skin=${skinOf(u)}; Path=/; Max-Age=31536000; SameSite=Lax`, `mode=${modeOf(u)}; Path=/; Max-Age=31536000; SameSite=Lax`];
    return redirect(res, '/', { 'Set-Cookie': [`sid=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${SECURE ? '; Secure' : ''}`, ...lookCookies] });
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
    const r = q("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,?,'modern')").run(handle, (b.name || '').trim() || handle, email, hashPass(b.password));
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
    applyFormIntents(b, 'mark', q('SELECT * FROM marks WHERE id=?').get(r.lastInsertRowid), me);
    return redirect(res, `/m/${r.lastInsertRowid}?ask=1`);   // offer a check-in rather than assuming one
  }
  // Native authorship controls. Everything here is also MCP-operable; the
  // point is that the member never needs an AI to control their own record.
  if ((mt = p.match(/^\/e\/(\d+)\/(edit|delete|primary|keep|discard|artifact\/remove|component\/remove)$/)) && m === 'POST') {
    if (!me) return need();
    const e = q('SELECT * FROM ensembles WHERE id=?').get(+mt[1]);
    if (!e) return send(res, 'Not found', 404);
    if (e.user_id !== me.id) return send(res, 'Not yours', 403);
    const b = await readBody(req), ctx = webActor(me), act = mt[2];
    if (act === 'edit') {
      q('UPDATE ensembles SET title=?, description=?, private=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run((b.title || '').trim() || e.title, (b.description || '').trim(), b.private ? 1 : 0, e.id);
      recordProvenance('ensemble', e.uid, 'edited', ctx, { fields: 'title,description,private' });
      // Auto-save posts in the background; answer 204 so the page stays put.
      // A plain form post (no JS) still redirects.
      if (req.headers['x-quiet'] === '1') { res.writeHead(204); return res.end(); }
      return redirect(res, `/e/${e.id}`);
    }
    // Keep / Discard from the worksurface run the same semantics as the MCP
    // tools — the member must never need an AI to commit or reject their own
    // composition.
    if (act === 'keep' || act === 'discard') {
      const out = await mcpCall(me, act === 'keep' ? 'keep_ensemble' : 'discard_ensemble', { id: e.id })
        .catch((err) => ({ text: err.message }));
      return redirect(res, act === 'keep' ? `/e/${e.id}` : '/e');
    }
    if (act === 'delete') {
      recordProvenance('ensemble', e.uid, 'deleted', ctx, {});
      q('DELETE FROM ensembles WHERE id=?').run(e.id);   // components + artifacts cascade; Notes are untouched
      return redirect(res, '/e');
    }
    if (act === 'primary') {
      const art = q('SELECT * FROM ensemble_artifacts WHERE uid=? AND ensemble_id=?').get(b.artifact_uid, e.id);
      if (art) {
        q('UPDATE ensembles SET primary_artifact_uid=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(art.uid, e.id);
        recordProvenance('ensemble', e.uid, 'edited', ctx, { fields: 'primary_artifact_uid' });
      }
      return redirect(res, `/e/${e.id}`);
    }
    if (act === 'artifact/remove') {
      const art = q('SELECT * FROM ensemble_artifacts WHERE uid=? AND ensemble_id=?').get(b.artifact_uid, e.id);
      if (art) {
        recordProvenance('ensemble_artifact', art.uid, 'deleted', ctx, { source_ref: e.uid });
        q('DELETE FROM ensemble_artifacts WHERE id=?').run(art.id);
        if (e.primary_artifact_uid === art.uid) {
          const next = q('SELECT uid FROM ensemble_artifacts WHERE ensemble_id=? ORDER BY id DESC LIMIT 1').get(e.id);
          q('UPDATE ensembles SET primary_artifact_uid=? WHERE id=?').run(next ? next.uid : null, e.id);
        }
      }
      return redirect(res, `/e/${e.id}`);
    }
    const c = q('SELECT * FROM ensemble_components WHERE uid=? AND ensemble_id=?').get(b.component_uid, e.id);
    if (c) {
      recordProvenance('ensemble_component', c.uid, 'deleted', ctx, { source_ref: e.uid });
      q('DELETE FROM ensemble_components WHERE id=?').run(c.id);   // the linked Note is the member's own record and is kept
    }
    return redirect(res, `/e/${e.id}`);
  }
  // ---- Itinerary --------------------------------------------------------------
  // Every handler calls a core function; none writes the tables directly.
  if (p === '/t') return pages.itineraries(req, res, me, url);
  // Look up the member's own travel marks while writing a stop. Own marks
  // only, and only for the itinerary's owner, so this can never become a way
  // to read someone else's catalogue.
  if ((mt = p.match(/^\/t\/(\d+)\/marks$/)) && m === 'GET') {
    if (!me) return send(res, '[]', 200, { 'Content-Type': 'application/json' });
    const it = q('SELECT * FROM itineraries WHERE id=?').get(+mt[1]);
    if (!it || it.user_id !== me.id) return send(res, '[]', 200, { 'Content-Type': 'application/json' });
    const term = String(url.searchParams.get('q') || '').trim().toLowerCase();
    if (term.length < 2) return send(res, '[]', 200, { 'Content-Type': 'application/json' });
    const inPlan = new Set(q('SELECT mark_uid FROM itinerary_stops WHERE itinerary_id=? AND mark_uid IS NOT NULL').all(it.id).map((r) => r.mark_uid));
    const rows = q(MARK_SQL + ' WHERE m.user_id=? ORDER BY m.id DESC').all(me.id)
      .filter((mk) => !inPlan.has(mk.uid))
      .filter((mk) => `${mk.name} ${mk.locality || ''} ${mk.country || ''}`.toLowerCase().includes(term))
      .slice(0, 8)
      .map((mk) => ({ uid: mk.uid, name: mk.name, where: [mk.locality, mk.country].filter(Boolean).join(', ') }));
    return send(res, JSON.stringify(rows), 200, { 'Content-Type': 'application/json' });
  }
  if ((mt = p.match(/^\/t\/(\d+)$/)) && m === 'GET') return pages.itinerary(req, res, me, url, +mt[1]);

  if (p === '/t/new' && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req);
    const it = itineraryCreate(me, { title: b.title, context: b.context,
      temporal: temporalFromForm(b), private: b.private ? 1 : 0 }, webActor(me));
    return redirect(res, `/t/${it.id}`);
  }
  if ((mt = p.match(/^\/t\/(\d+)$/)) && m === 'POST') {
    if (!me) return need();
    const it = q('SELECT * FROM itineraries WHERE id=?').get(+mt[1]);
    if (!it) return send(res, 'Not found', 404);
    const b = await readBody(req);
    try {
      if (b.title !== undefined || b.context !== undefined) itineraryEdit(me, it.uid, b, webActor(me));
      if (hasTemporalForm(b)) itineraryUpdateTemporal(me, it.uid, temporalFromForm(b), b.intent || null, webActor(me));
    } catch (e) { return send(res, esc(e.message), 400); }
    return redirect(res, `/t/${it.id}`);
  }
  if ((mt = p.match(/^\/t\/(\d+)\/(publish|unpublish)$/)) && m === 'POST') {
    if (!me) return need();
    const it = q('SELECT * FROM itineraries WHERE id=?').get(+mt[1]);
    if (!it) return send(res, 'Not found', 404);
    try {
      if (mt[2] === 'publish') itineraryPublish(me, it.uid, webActor(me));
      else itineraryUnpublish(me, it.uid, webActor(me));
    } catch (e) {
      return send(res, layout({ title: 'Publish', me, req,
        body: `<section class="feed"><h3 class="strip">Not published</h3><p class="about">${esc(e.message)}</p>
        <p class="about"><a class="link" href="/t/${it.id}">Back to the itinerary</a></p></section>` }), 409);
    }
    return redirect(res, `/t/${it.id}`);
  }
  if ((mt = p.match(/^\/t\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const it = q('SELECT * FROM itineraries WHERE id=?').get(+mt[1]);
    if (!it) return send(res, 'Not found', 404);
    try { itineraryDelete(me, it.uid, webActor(me)); } catch (e) { return send(res, esc(e.message), 400); }
    return redirect(res, '/t');
  }

  if ((mt = p.match(/^\/t\/(\d+)\/groups$/)) && m === 'POST') {
    if (!me) return need();
    const it = q('SELECT * FROM itineraries WHERE id=?').get(+mt[1]);
    if (!it) return send(res, 'Not found', 404);
    const b = await readBody(req);
    try { groupCreate(me, it.uid, { label: b.label, temporal: temporalFromForm(b) }, webActor(me)); }
    catch (e) { return send(res, esc(e.message), 400); }
    return redirect(res, `/t/${it.id}`);
  }
  if ((mt = p.match(/^\/t\/(\d+)\/groups\/([a-f0-9-]+)(\/delete)?$/)) && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req);
    try {
      if (mt[3]) groupDelete(me, mt[2], webActor(me));
      else {
        if (b.label !== undefined) groupEdit(me, mt[2], b, webActor(me));
        if (hasTemporalForm(b)) groupUpdateTemporal(me, mt[2], temporalFromForm(b), b.intent || null, webActor(me));
        if (b.position !== undefined) groupSetPosition(me, mt[2], b.position === '' ? null : +b.position, webActor(me));
      }
    } catch (e) { return send(res, esc(e.message), 400); }
    return redirect(res, `/t/${mt[1]}`);
  }

  if ((mt = p.match(/^\/t\/(\d+)\/stops$/)) && m === 'POST') {
    if (!me) return need();
    const it = q('SELECT * FROM itineraries WHERE id=?').get(+mt[1]);
    if (!it) return send(res, 'Not found', 404);
    const b = await readBody(req);
    try {
      stopAdd(me, it.uid, { label: b.label, resolution: b.resolution || null,
        mark_uid: b.mark_uid || null, group_uid: b.group_uid || null,
        temporal: temporalFromForm(b) }, webActor(me));
    } catch (e) { return send(res, esc(e.message), 400); }
    return redirect(res, `/t/${it.id}`);
  }
  if ((mt = p.match(/^\/t\/(\d+)\/stops\/([a-f0-9-]+)(\/suspend|\/restore|\/delete)?$/)) && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req);
    const ctx = webActor(me);
    try {
      if (mt[3] === '/suspend') stopSuspend(me, mt[2], ctx);
      else if (mt[3] === '/restore') stopRestore(me, mt[2], ctx);
      else if (mt[3] === '/delete') stopDelete(me, mt[2], ctx);
      else {
        if (b.label !== undefined) stopEdit(me, mt[2], b, ctx);
        if (hasTemporalForm(b)) stopUpdateTemporal(me, mt[2], temporalFromForm(b), b.intent || null, ctx);
        if (b.mark_uid) stopResolveToMark(me, mt[2], b.mark_uid, b.intent || null, ctx);
        if (b.unlink) stopUnresolve(me, mt[2], b.resolution || 'particular', ctx);
        else if (b.resolution && !b.mark_uid) stopSetResolution(me, mt[2], b.resolution, ctx);
        if (b.group_uid !== undefined) stopSetGroup(me, mt[2], b.group_uid || null,
          b.position !== undefined && b.position !== '' ? +b.position : undefined, ctx);
        else if (b.swap_with) stopSwap(me, mt[2], b.swap_with, ctx);
        else if (b.position !== undefined) stopSetPosition(me, mt[2], b.position === '' ? null : +b.position, ctx);
      }
    } catch (e) { return send(res, esc(e.message), 400); }
    return redirect(res, `/t/${mt[1]}`);
  }

  if (p === '/e') return pages.ensembles(req, res, me);
  if ((mt = p.match(/^\/e\/(\d+)$/))) return pages.ensemble(req, res, me, url, +mt[1]);
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
    // See the MCP path: the same guard, the same function.
    if (b.private && !mk.private) markPrivacyChanged(mk.uid, true, webActor(me));
    applyFormIntents(b, 'mark', q('SELECT * FROM marks WHERE id=?').get(mk.id), me);
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
    dropWarrantsFor('mark', mk.uid);
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
  // Check-in create (both routes) and edit share one write path so the web
  // form and the MCP tools apply identical invariants. The form posts
  // visited_on, ended_on (optional), body, and day_YYYY-MM-DD fields for any
  // date the member wrote about; drop_days=1 is the explicit consent to
  // discard day notes that a shortened range would exclude.
  const writeVisitFromForm = (mk, existing, b) => {
    // "I don't recall the exact date": the visit is recorded, the date is not.
    // No range and no day notes can attach to a date that does not exist.
    const undated = b.date_unknown === '1';
    if (undated) {
      const body = (b.body || '').trim();
      if (existing) {
        const stranded = q('SELECT day FROM visit_days WHERE visit_id=? AND body<>? ORDER BY day').all(existing.id, '').map((r) => r.day);
        if (stranded.length && b.drop_days !== '1') {
          const e = new Error(`Marking this visit as undated leaves notes on ${stranded.map(prettyDay).join(' and ')} without a day to belong to.`);
          e.excluded = stranded; throw e;
        }
        for (const d of stranded) applyVisitDays(existing.id, existing.visited_on, existing.ended_on, [{ date: d, body: '' }], webActor(me));
        q('UPDATE visits SET date_known=0, ended_on=NULL, body=? WHERE id=?').run(body, existing.id);
        recordProvenance('visit', uidOf('visits', existing.id), 'edited', webActor(me), { source_kind: 'manual', fields: 'date_known,body' });
        return existing.id;
      }
      const v = q('INSERT INTO visits(mark_id,user_id,visited_on,ended_on,body,date_known) VALUES(?,?,?,NULL,?,0)')
        .run(mk.id, me.id, todayYMD(), body);
      recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual', fields: 'date_known:0' });
      return v.lastInsertRowid;
    }
    const { start, end } = normaliseVisitRange(b.visited_on, b.ended_on);
    const days = Object.keys(b).filter((k) => /^day_\d{4}-\d{2}-\d{2}$/.test(k))
      .map((k) => ({ date: k.slice(4), body: b[k] }));
    if (existing) {
      const excluded = daysExcludedBy(existing.id, start, end);
      if (excluded.length && b.drop_days !== '1') {
        const e = new Error(`Changing the dates to ${prettyRange(start, end)} leaves notes on `
          + `${excluded.map(prettyDay).join(' and ')} outside the visit.`);
        e.excluded = excluded; throw e;
      }
      for (const d of excluded) days.push({ date: d, body: '' });   // consented removal
      // the exclusion rows must be removed BEFORE the range shrinks, or the
      // in-range check inside applyVisitDays would refuse them
      const dropFirst = days.filter((d) => excluded.includes(d.date));
      const rest = days.filter((d) => !excluded.includes(d.date));
      const oldEnd = existing.ended_on, oldStart = existing.visited_on;
      applyVisitDays(existing.id, oldStart < start ? oldStart : start, (oldEnd || oldStart) > (end || start) ? (oldEnd || oldStart) : (end || start), dropFirst, webActor(me));
      q('UPDATE visits SET visited_on=?, ended_on=?, body=?, date_known=1 WHERE id=?').run(start, end, (b.body || '').trim(), existing.id);
      recordProvenance('visit', uidOf('visits', existing.id), 'edited', webActor(me), { source_kind: 'manual', fields: 'visited_on,ended_on,body' });
      applyVisitDays(existing.id, start, end, rest, webActor(me));
      return existing.id;
    }
    const v = q('INSERT INTO visits(mark_id,user_id,visited_on,ended_on,body) VALUES(?,?,?,?,?)')
      .run(mk.id, me.id, start, end, (b.body || '').trim());
    recordProvenance('visit', uidOf('visits', v.lastInsertRowid), 'created', webActor(me), { source_kind: 'manual' });
    applyVisitDays(v.lastInsertRowid, start, end, days, webActor(me));
    return v.lastInsertRowid;
  };
  if ((mt = p.match(/^\/m\/(\d+)\/(checkin|visits)$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (!mk) return send(res, 'Not yours', 403);
    const b = await readBody(req);
    try { writeVisitFromForm(mk, null, b); }
    catch (e) { return send(res, e.message, 400); }
    return redirect(res, `/m/${mk.id}`);
  }
  if ((mt = p.match(/^\/m\/(\d+)\/visits\/(\d+)\/edit$/)) && m === 'POST') {
    if (!me) return need();
    const mk = q('SELECT * FROM marks WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (!mk) return send(res, 'Not yours', 403);
    const existing = q('SELECT * FROM visits WHERE id=? AND mark_id=?').get(+mt[2], mk.id);
    if (!existing) return send(res, 'Not found', 404);
    const b = await readBody(req);
    try { writeVisitFromForm(mk, existing, b); }
    catch (e) {
      // the guard: answer with the excluded dates so the client can ask once
      if (e.excluded) return send(res, JSON.stringify({ guard: true, message: e.message, excluded: e.excluded }), 409, { 'Content-Type': 'application/json' });
      return send(res, e.message, 400);
    }
    if (req.headers['x-quiet'] === '1') { res.writeHead(204); return res.end(); }
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
    applyFormIntents(b, 'object', q('SELECT * FROM objects WHERE id=?').get(r.lastInsertRowid), me);
    return redirect(res, `/o/${r.lastInsertRowid}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/owned$/)) && m === 'POST') {
    if (!me) return need();
    const o = q('SELECT * FROM objects WHERE id=?').get(+mt[1]);
    if (!o) return send(res, 'Not found', 404);
    if (o.user_id !== me.id) return send(res, 'Not yours', 403);
    const b = await readBody(req);
    // The web UI resolves release-vs-correction BEFORE posting, so the server
    // only ever receives an unambiguous intent. No confirmation state machine.
    const intent = b.intent;
    if (intent === 'own') assertOwned(me.id, o.id, webActor(me));
    else if (intent === 'release') { if (ownedState(me.id, o.id).state === 'owned') releaseOwned(me.id, o.id, webActor(me)); }
    else if (intent === 'correct') correctOwned(me.id, o.id, webActor(me));
    // Toggling from a card is a background request: answer 204 so the page
    // stays exactly where it is. A plain form post (no JS) still redirects.
    if (req.headers['x-quiet'] === '1') { res.writeHead(204); return res.end(); }
    return redirect(res, req.headers.referer || `/o/${o.id}`);
  }
  if ((mt = p.match(/^\/(o|m)\/(\d+)\/warrant$/)) && m === 'POST') {
    if (!me) return need();
    const isNote = mt[1] === 'o';
    const row = isNote ? q('SELECT * FROM objects WHERE id=?').get(+mt[2]) : q('SELECT * FROM marks WHERE id=?').get(+mt[2]);
    if (!row) return send(res, 'Not found', 404);
    if (row.user_id !== me.id) return send(res, 'Not yours', 403);
    const stype = isNote ? 'object' : 'mark';
    const b = await readBody(req);
    if (b.intent === 'revoke') {
      if (warrantState(me.id, stype, row.uid).state === 'active') revokeWarrant(me.id, stype, row.uid, webActor(me));
    } else if (warrantState(me.id, stype, row.uid).state !== 'active') {
      // A private subject can never publish: the flag is never set, rather
      // than being set and filtered out downstream.
      const publish = row.private ? false : b.quiet ? false : true;
      assertWarrant(me.id, stype, row.uid, publish, webActor(me));
    }
    return redirect(res, req.headers.referer || `/${mt[1]}/${row.id}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)$/))) return pages.object(req, res, me, url, +mt[1]);
  // Re-note: adoption with provenance, not subscription. The adopter gets their
  // own first-class Note that the source can never afterwards rewrite,
  // privatise or delete. Repeating it is allowed — each adoption is a real act
  // and the resulting Notes may diverge — so there is no dedup and no
  // INSERT OR IGNORE to silently swallow the second one.
  if ((mt = p.match(/^\/o\/(\d+)\/note$/)) && m === 'POST') {
    if (!me) return need();
    const src = q('SELECT * FROM objects WHERE id=?').get(+mt[1]);
    if (!src) return send(res, 'No such note', 404);
    if (!canSee(src, me)) return send(res, 'Not found', 404);
    if (src.user_id === me.id) return send(res, 'You cannot re-note your own note', 400);
    const note = renoteFrom(src, me, webActor(me));
    return redirect(res, req.headers.referer || `/o/${note.id}`);
  }
  // A comment may be removed by whoever wrote it, or by the owner of the
  // record it sits on -- the same two people who can act on it anywhere else.
  // Editing a comment. Same ownership rule as deleting it, except that the
  // subject's owner may remove a comment from their record but may not put
  // words in its author's mouth -- only the author edits.
  if ((mt = p.match(/^\/(o|m)\/(\d+)\/comments\/(\d+)$/)) && m === 'POST') {
    if (!me) return need();
    const isNote = mt[1] === 'o';
    const table = isNote ? 'comments' : 'mark_comments';
    const fk = isNote ? 'object_id' : 'mark_id';
    const c = q(`SELECT * FROM ${table} WHERE id=? AND ${fk}=?`).get(+mt[3], +mt[2]);
    if (!c) return send(res, 'No such comment.', 404);
    if (c.user_id !== me.id) return send(res, 'Only the author can edit a comment.', 403);
    const b = await readBody(req);
    const body = String(b.body || '').trim();
    if (!body) return send(res, 'A comment cannot be empty.', 400);
    if (body !== c.body) {
      q(`UPDATE ${table} SET body=? WHERE id=?`).run(body, c.id);
      recordProvenance('comment', c.uid, 'edited', webActor(me), { fields: 'body' });
    }
    return redirect(res, isNote ? `/o/${mt[2]}` : `/m/${mt[2]}`);
  }

  if ((mt = p.match(/^\/(o|m)\/(\d+)\/comments\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const me2 = me;
    const isNote = mt[1] === 'o';
    const table = isNote ? 'comments' : 'mark_comments';
    const fk = isNote ? 'object_id' : 'mark_id';
    const subj = isNote ? q('SELECT * FROM objects WHERE id=?').get(+mt[2])
                        : q('SELECT * FROM marks WHERE id=?').get(+mt[2]);
    const c = q(`SELECT * FROM ${table} WHERE id=? AND ${fk}=?`).get(+mt[3], +mt[2]);
    if (!subj || !c) return send(res, 'No such comment.', 404);
    if (c.user_id !== me2.id && subj.user_id !== me2.id && !me2.is_admin) return send(res, 'Not yours to remove.', 403);
    recordProvenance('comment', c.uid, 'deleted', webActor(me2), {});
    q(`DELETE FROM ${table} WHERE id=?`).run(c.id);
    return redirect(res, isNote ? `/o/${mt[2]}` : `/m/${mt[2]}`);
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
    applyFormIntents(b, 'object', q('SELECT * FROM objects WHERE id=?').get(o.id), me);
    return redirect(res, `/o/${o.id}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const o = q('SELECT * FROM objects WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin); if (!o) return send(res, 'Not yours', 403);
    recordProvenance('object', o.uid, 'deleted', webActor(me));
    dropWarrantsFor('object', o.uid);
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
  q("INSERT INTO users(handle,name,email,pass,is_admin,avatar,ui_skin) VALUES(?,?,?,?,1,?,'modern')").run(process.env.ADMIN_HANDLE || 'elicierto', process.env.ADMIN_NAME || 'Brian Elicierto', email, hashPass(pass), '/avatars/elicierto.png');
  const code = token(6); q('INSERT INTO invites(code,from_user) VALUES(?,1)').run(code);
  console.log(`First run: admin ${email} / ${pass}. One invite code: ${code}`);
  if (process.env.SEED) require('./seed')(db);
}

const counts = ['users', 'objects', 'marks', 'visits', 'comments']
  .map((t) => `${t} ${q(`SELECT COUNT(*) c FROM ${t}`).get().c}`).join(', ');
console.log(`Database: ${DB_PATH} (${(fs.statSync(DB_PATH).size / 1024).toFixed(0)} KB) — ${counts}`);

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e); send(res, 'Something went wrong.', 500); })).listen(PORT, () => {
  console.log(`discriminant.ly on http://localhost:${PORT}`);
  // Adopt linked pictures once the server is answering, never during boot.
  if (!process.env.NO_ADOPT) setTimeout(() => { adoptLinkedImages().catch(() => {}); }, 4000);
});
