// A note's several pictures over MCP (v2.114, additive): results list them as
// `images` (cover first); note_object and edit_note take `images` for the
// further pictures. Ownership and privacy as for the single picture.
// Usage: node test/note-images-mcp.js
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nimcp-')), DB = path.join(DIR, 'n.db');
const PORT = 3000 + Math.floor(Math.random() * 900) + 50, BASE = `http://localhost:${PORT}`;
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SEED: '1', ADMIN_PASSWORD: 'prototype1', GEOCODE: 'off' }, stdio: 'ignore' });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (x && !c ? '  -> ' + String(x).slice(0, 300) : '')); };
const raw = async (T, name, args) => (await (await fetch(`${BASE}/mcp/${T}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
const call = async (T, name, args) => { const r = await raw(T, name, args); if (r.isError) throw new Error(name + ': ' + r.content[0].text); return r.structuredContent; };
const fails = async (T, name, args) => { const r = await raw(T, name, args); return r.isError ? r.content[0].text : null; };
(async () => {
  for (let i = 0; i < 100; i++) { try { await fetch(BASE + '/robots.txt'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const sharp = require('sharp');
  const photo = async (seed) => 'data:image/png;base64,' + (await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: (seed * 37) % 255, g: (seed * 91) % 255, b: (seed * 53) % 255 } } }).png().toBuffer()).toString('base64');
  const db = new DatabaseSync(DB); db.exec('PRAGMA busy_timeout=5000');
  const mk = (h) => { const id = db.prepare("INSERT INTO users(handle,name,email,pass,ui_skin) VALUES(?,?,?,'x','modern')").run(h, h, h + '@t.test').lastInsertRowid; const t = crypto.randomBytes(16).toString('hex'); db.prepare('UPDATE users SET api_token=? WHERE id=?').run(t, id); return { id, t }; };
  const A = mk('aiana'), B = mk('bento');
  const up = async (T, seed) => (await call(T, 'upload_image', { image: await photo(seed) })).image_uid || (await call(T, 'upload_image', { image: await photo(seed) })).uid;
  // tools/list declares the additions
  const tools = (await (await fetch(`${BASE}/mcp/${A.t}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })).json()).result.tools;
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  ok('note_object and edit_note declare an optional `images` array; the single `image` is unchanged', by.note_object.inputSchema.properties.images && by.edit_note.inputSchema.properties.images && by.note_object.inputSchema.required.join() === 'headline,image' && !by.edit_note.inputSchema.required.includes('images'));
  ok('my_notes, recent_notes and search_catalogue results declare `images` (cover first)', ['my_notes', 'recent_notes'].every((n) => by[n].outputSchema.properties.items.items.properties.images) && JSON.stringify(by.search_catalogue.outputSchema).includes('"images"'));

  // 1. create with extras
  const u1 = await up(A.t, 1), u2 = await up(A.t, 2), u3 = await up(A.t, 3);
  ok('upload_image returns uids to pass on', [u1, u2, u3].every((u) => /^[0-9a-f-]{36}$/.test(u || '')), JSON.stringify([u1, u2, u3]));
  const made = await call(A.t, 'note_object', { headline: 'Raku chawan, three views', description: 'Front, foot, and the inside glaze.', image: await photo(0), images: [`/i/${u1}`, u2, `${u3}`] });
  ok('note_object with `images` creates the note', made.action === 'created' && made.id > 0, JSON.stringify(made));
  const mine = (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id);
  ok('my_notes lists four pictures, the cover first, matching image_uid; three extras in the order given', mine.images.length === 4 && mine.images[0].image_uid === mine.image_uid && mine.images.slice(1).map((x) => x.image_uid).join() === [u1, u2, u3].join(), JSON.stringify(mine.images));
  const found = (await call(A.t, 'search_catalogue', { query: 'Raku' })).items.find((x) => x.type === 'object' && x.id === made.id);
  ok('search_catalogue carries the same list', found && found.images.length === 4 && found.images[3].image_uid === u3);
  const recent = (await call(B.t, 'recent_notes', { query: 'Raku' })).items.find((x) => x.id === made.id);
  ok('recent_notes (another member looking) carries the list for a public note', recent && recent.images.length === 4);

  // 2. ownership: another member's upload cannot be attached
  const uB = await up(B.t, 9);
  const err = await fails(A.t, 'edit_note', { id: made.id, images: [uB] });
  ok('a picture another member uploaded cannot be attached (ownership check, as for the cover)', !!err, err);
  ok('…and the note is left as it was', (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id).images.length === 4);

  // 3. edit: replace the list, in a new order, dropping one
  await call(A.t, 'edit_note', { id: made.id, images: [u3, u1] });
  let now = (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id);
  ok('edit_note with `images` replaces the further pictures in the order given', now.images.slice(1).map((x) => x.image_uid).join() === [u3, u1].join(), JSON.stringify(now.images));
  // 4. edit: a new cover that was among the extras leaves the extras
  await call(A.t, 'edit_note', { id: made.id, image_uid: u3 });
  now = (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id);
  ok('edit_note with a new cover taken from the extras: it leads, and is no longer repeated', now.image_uid === u3 && now.images.map((x) => x.image_uid).join() === [u3, u1].join(), JSON.stringify(now.images));
  // 5. edit without `images` leaves them alone; empty list clears them
  await call(A.t, 'edit_note', { id: made.id, description: 'Changed the words only.' });
  ok('edit_note without `images` leaves the pictures as they are', (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id).images.length === 2);
  await call(A.t, 'edit_note', { id: made.id, images: [] });
  ok('edit_note with an empty list removes the further pictures; the cover stays', (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id).images.length === 1);
  // 6. cap
  const many = []; for (let i = 20; i < 30; i++) many.push(await up(A.t, i));
  await call(A.t, 'edit_note', { id: made.id, images: many });
  ok('a note holds at most 8 pictures', (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id).images.length === 8);
  // 7. privacy: a private note's extras are not served to others
  await call(A.t, 'edit_note', { id: made.id, private: true });
  const ex = (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === made.id).images[1].image_uid;
  ok('a private note’s further picture is not served to a stranger', (await fetch(`${BASE}/i/${ex}`)).status === 404);
  ok('…and recent_notes no longer lists the note at all', !(await call(B.t, 'recent_notes', { query: 'Raku' })).items.find((x) => x.id === made.id));
  // 8. a note without extras still reports a one-item list, so clients can rely on the field
  const plain = await call(A.t, 'note_object', { headline: 'Plain note', image: await photo(5) });
  ok('a note with only a cover reports images: [cover]', (await call(A.t, 'my_notes', { limit: 5 })).items.find((x) => x.id === plain.id).images.length === 1);
  console.log(`\n${pass} passed, ${fail} failed`);
  srv.kill(); fs.rmSync(DIR, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(2); });
