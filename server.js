// discriminant.ly — zero-dependency Node 22 server (node:sqlite + http + crypto)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
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
try { db.exec("ALTER TABLE objects ADD COLUMN tags TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN api_token TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN site TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE objects ADD COLUMN private INTEGER DEFAULT 0"); } catch {}
const q = (sql) => db.prepare(sql);
const avatar = (u, cls = 'avatar') => u.avatar ? `<img class="${cls}" src="${esc(u.avatar)}" alt="">` : `<span class="${cls} avatar-initial">${esc((u.name || u.handle || '?')[0].toUpperCase())}</span>`;
const stackDate = (t) => { const d = new Date(t + 'Z'); return `<time class="stackdate" datetime="${t}"><span class="mon">${d.toLocaleDateString('en-CA', { month: 'short' })}</span><span class="day">${d.getDate()}</span><span class="yr">${d.getFullYear()}</span></time>`; };
function setCollections(userId, objectId, names) {
  q('DELETE FROM object_collections WHERE object_id=?').run(objectId);
  for (const n of [...new Set(names.map((x) => String(x).trim()).filter(Boolean))]) {
    q('INSERT OR IGNORE INTO collections(user_id,name) VALUES(?,?)').run(userId, n);
    const c = q('SELECT id FROM collections WHERE user_id=? AND name=?').get(userId, n);
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
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => res(Object.fromEntries(new URLSearchParams(b)))); });
}
function readBodyMulti(req) {
  return new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { const p = new URLSearchParams(b); const o = Object.fromEntries(p); o.coll = p.getAll('coll'); res(o); }); });
}
function send(res, html, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(html);
}
function redirect(res, to, extra = {}) { res.writeHead(303, { Location: to, ...extra }); res.end(); }
function json(res, data) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data, null, 2)); }
const timeAgo = (t) => { const d = (Date.now() - new Date(t + 'Z')) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 30 ? `${Math.floor(d)} days ago` : new Date(t + 'Z').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }); };

// ---------- templates ----------
const ICONS = {
  home: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3 1.8 11.4h3.1V21h5.2v-5.9h3.8V21h5.2v-9.6h3.1z"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="20" height="21" aria-hidden="true"><circle cx="12" cy="6.6" r="4.6" fill="currentColor"/><path fill="currentColor" d="M12 12.4c-4.6 0-8.2 2.9-8.2 6.6V22h16.4v-3c0-3.7-3.6-6.6-8.2-6.6z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="16" height="17" aria-hidden="true"><path fill="currentColor" d="M21 13.6v-3.2l-2.6-.4a6.9 6.9 0 0 0-.9-2.1l1.6-2.1-2.3-2.3-2.1 1.6a6.9 6.9 0 0 0-2.1-.9L12.2 2H9l-.4 2.2a6.9 6.9 0 0 0-2.1.9L4.4 3.5 2.1 5.8l1.6 2.1a6.9 6.9 0 0 0-.9 2.1L.2 10.4v3.2l2.6.4c.2.8.5 1.5.9 2.1l-1.6 2.1 2.3 2.3 2.1-1.6c.7.4 1.4.7 2.1.9l.4 2.6h3.2l.4-2.6c.8-.2 1.5-.5 2.1-.9l2.1 1.6 2.3-2.3-1.6-2.1c.4-.7.7-1.4.9-2.1zM11 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="10" height="23" aria-hidden="true"><circle cx="12" cy="5.4" r="4.4" fill="currentColor"/><path fill="currentColor" d="M10.6 9.2h2.8v13.4l-1.4 1.4-1.4-1.4z"/><path fill="currentColor" d="M13.4 13.4h4v2.2h-4zM13.4 17.4h3v2.2h-3z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M9 4.5 16.5 12 9 19.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="17" height="19" aria-hidden="true"><rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 17.5V21M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lens: '<svg viewBox="0 0 44 48" width="44" height="48" aria-hidden="true"><defs><linearGradient id="glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><circle cx="18" cy="17" r="12.6" fill="url(%23glare)"/><circle cx="18" cy="17" r="12.6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M26.9 26.2 29.4 28.7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="31.4" cy="31" r="2.3" fill="currentColor"/><circle cx="31.8" cy="36.4" r="1.7" fill="currentColor"/><circle cx="32" cy="41.4" r="1.3" fill="currentColor"/></svg>',
};

function layout({ title, body, me, flash, cls = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title ? title + ' — discriminant.ly' : 'discriminant.ly')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://use.typekit.net/fbk5zyg.css">
<link href="https://fonts.googleapis.com/css2?family=Rokkitt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" type="image/png" href="/favicon.png"><link rel="stylesheet" href="/style.css"></head><body class="${cls}${me ? ' is-in' : ''}">
${me ? `<nav class="iconrail" aria-label="Main">
  <a href="/" title="Home">${ICONS.home}</a>
  <a href="/u/${esc(me.handle)}" title="Your profile">${ICONS.person}</a>
  <a href="/settings" title="Account settings">${ICONS.gear}</a>
  <button type="button" class="iconrail-btn" id="dictate-btn" title="Dictate a note">${ICONS.mic}</button>
</nav>
<div class="searchbar" id="searchbar"><div class="wrap"><form method="get" action="/"><input type="search" name="q" placeholder="Search discriminant.ly" aria-label="Search discriminant.ly" id="searchinput"></form></div></div>
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
  <div class="curtain-frame"><div class="curtain-body">${noteForm(me, {}, { idp: 'ct', compact: true })}</div></div>
  <div class="curtain-tail" aria-hidden="true"><span class="tail-band"></span><span class="tail-bridge"></span><span class="tail-edge"></span></div>
  <button class="curtain-nub" id="curtain-nub" aria-expanded="false" aria-controls="curtain">
    <span class="nub-label">Create a<br>new note</span>
    <span class="nub-icon">${ICONS.lens}</span>
  </button>
</div>
<script>
(function () {
  var c = document.getElementById('curtain'), nub = document.getElementById('curtain-nub');
  if (!c) return;
  function open() { c.classList.add('is-open'); nub.setAttribute('aria-expanded', 'true'); }
  function close() { c.classList.remove('is-open'); nub.setAttribute('aria-expanded', 'false'); }
  nub.addEventListener('click', function () { c.classList.contains('is-open') ? close() : open(); });
  c.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', close); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // voice dictation into the note form (browser speech recognition; no data leaves the browser except to the speech service)
  var dictate = document.getElementById('dictate-btn');
  if (!dictate) return;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  dictate.addEventListener('click', function () {
    open();
    var title = c.querySelector('input[name=name]'), why = c.querySelector('textarea[name=why]');
    if (!SR) { why.setAttribute('placeholder', 'DICTATION NEEDS A BROWSER WITH SPEECH RECOGNITION (CHROME OR SAFARI) — OR SPEAK TO CLAUDE VIA THE CONNECTOR'); why.focus(); return; }
    var rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    var target = document.activeElement === title ? title : why;
    target.focus(); dictate.classList.add('is-listening');
    var base = target.value ? target.value + ' ' : '';
    rec.onresult = function (e) {
      var txt = '';
      for (var i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      target.value = base + txt;
      if (target.value && e.results[e.results.length - 1].isFinal) base = target.value + ' ';
    };
    rec.onend = function () { dictate.classList.remove('is-listening'); };
    rec.onerror = function () { dictate.classList.remove('is-listening'); };
    rec.start();
    dictate.addEventListener('click', function stop() { rec.stop(); dictate.removeEventListener('click', stop); }, { once: true });
  });
})();
</script>`
  : `<header class="masthead"><div class="wrap">
  <a class="mark" href="/welcome"><img src="/mark.png" alt="" width="17" height="23"><span>discriminant.ly</span></a>
  <form class="signin" method="post" action="/login"><input name="email" type="email" placeholder="email" required><input name="password" type="password" placeholder="password" required><button class="link caps">Sign in</button></form>
</div></header>`}
${me ? `<div class="curtain dialog" id="confirm-dialog">
  <div class="curtain-frame"><div class="curtain-body">
    <form method="post" action="">
      <div class="nf-box">
        <p class="dlg-title">Delete collection</p>
        <p class="dlg-copy">Delete “<span class="dlg-name"></span>”? The notes inside stay put — only the collection is removed.</p>
        <button class="nf-post">Delete collection</button>
        <div class="nf-foot"><span></span><button type="button" class="nf-link-btn" data-dismiss>Cancel</button></div>
      </div>
    </form>
  </div></div>
  <div class="curtain-tail"><span class="tail-band"></span></div>
</div>` : ''}
${flash ? `<div class="flash"><div class="wrap">${esc(flash)}</div></div>` : ''}
<main class="wrap">${body}</main>
<footer class="wrap"><p>A lightweight social platform for a small community of discerning individuals capturing, sharing and discovering fine goods. <a href="/about">About</a> · <a href="/objects.json">Data</a></p></footer>
</body></html>`;
}


// The note form card. Rendered on /new and /o/:id/edit, and inside the drop-down curtain.
// `idp` namespaces element ids so two copies can coexist on one page.
function noteForm(me, o = {}, { err = '', picked = null, idp = 'pg', compact = false } = {}) {
  const editing = !!o.id;
  const mine = q('SELECT id, name FROM collections WHERE user_id=? ORDER BY name').all(me.id);
  const sel = new Set(picked ? picked : editing ? objCollections(o.id).map((c) => c.name) : []);
  const dropId = `img-drop-${idp}`, inputId = `img-input-${idp}`, prevId = `img-prev-${idp}`;
  return `
<form method="post" action="${editing ? `/o/${o.id}/edit` : '/new'}" class="nf${compact ? ' nf-compact' : ''}">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <div class="nf-box">
    <div class="nf-top"><span class="nf-lbl">Private?</span><label class="switch"><input type="checkbox" name="private" value="1" ${o.private ? 'checked' : ''}><span></span></label></div>
    <details class="nf-drop" id="drop-${idp}">
      <summary><span class="nf-drop-label">${sel.size ? esc([...sel].join(', ')) : 'Select a collection'}</span></summary>
      <div class="nf-drop-menu">
        ${mine.map((c) => `<label class="nf-opt"><input type="checkbox" name="coll" value="${esc(c.name)}" ${sel.has(c.name) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}
        <label class="nf-opt nf-opt-new"><span>+ New collection</span>
          <input class="nf-field" name="newcoll" placeholder="Name it" value=""></label>
      </div>
    </details>
    <div class="nf-image" id="${dropId}">
      <img class="nf-image-preview" id="${prevId}" src="${esc(o.image)}" alt="" ${o.image ? '' : 'hidden'}>
      <input class="nf-field" id="${inputId}" name="image" type="text" placeholder="DRAG IMAGE INTO HERE" value="${esc(o.image)}" required>
    </div>
    <div class="nf-stack">
      <input class="nf-field" name="name" placeholder="TITLE (REQUIRED)" required maxlength="120" value="${esc(o.name)}">
      <textarea class="nf-field" name="why" rows="${compact ? 5 : 7}" maxlength="1000" placeholder="COMMENTS">${esc(o.why)}</textarea>
      <input class="nf-field" name="tags" placeholder="#HASHTAGS" value="${esc(o.tags)}">
    </div>
    <input class="nf-field nf-link" name="url" type="url" placeholder="LINK" value="${esc(o.url)}">
    <button class="nf-post">${editing ? 'Save note' : 'Post note'}</button>
    <div class="nf-foot">
      ${editing ? `<button type="button" class="nf-link-btn nf-danger" data-delete="/o/${o.id}/delete">Delete</button>` : '<span></span>'}
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
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('dragover'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('dragover'); }); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    var dt = e.dataTransfer, file = dt.files && dt.files[0];
    if (file && file.type.indexOf('image/') === 0) { var r = new FileReader(); r.onload = function () { input.value = r.result; refresh(); }; r.readAsDataURL(file); return; }
    var uri = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (uri) { input.value = uri.trim(); refresh(); }
  });
  var del = drop.closest('form').querySelector('[data-delete]');
  if (del) del.addEventListener('click', function () {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    var f = document.createElement('form'); f.method = 'post'; f.action = del.getAttribute('data-delete');
    document.body.appendChild(f); f.submit();
  });
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

function profileRail(u, me, tab) {
  const owner = me && me.id === u.id;
  const visible = q(OBJ_SQL + ' WHERE o.user_id=?').all(u.id).filter((o) => canSee(o, me));
  const fc = followCounts(u.id);
  const following = me && me.id !== u.id && isFollowing(me.id, u.id);
  const link = (t) => `/u/${esc(u.handle)}?tab=${t}`;
  return `<aside class="rail profile-rail">
    <a href="/u/${esc(u.handle)}">${avatar(u, 'avatar big')}</a><p class="prail-handle">${esc(u.handle)}</p>
    ${u.bio ? `<p class="prail-bio">${esc(u.bio)}</p>` : ''}${u.site ? `<p class="prail-site"><a href="${esc(u.site)}" rel="noopener">${esc(u.site.replace(/^https?:\/\//, ''))}</a></p>` : ''}
    ${me && me.id !== u.id ? `<form method="post" action="/u/${esc(u.handle)}/${following ? 'unfollow' : 'follow'}" class="prail-follow"><button class="btn ${following ? 'btn-on' : ''} block">${following ? 'Following' : 'Follow'}</button></form>` : ''}
    <ul class="prail-nav">
      <li><a class="${tab === 'activity' ? 'on' : ''}" href="${link('activity')}">All Activity <span>›</span></a></li>
      <li><a class="${tab === 'notes' ? 'on' : ''}" href="${link('notes')}">Notes: ${visible.length} <span>›</span></a></li>
      <li><a class="${tab === 'followers' ? 'on' : ''}" href="${link('followers')}">Followers: ${fc.followers} ${fc.followers === 1 ? 'person' : 'people'} <span>›</span></a></li>
      <li><a class="${tab === 'following' ? 'on' : ''}" href="${link('following')}">Following: ${fc.following} ${fc.following === 1 ? 'person' : 'people'} <span>›</span></a></li>
    </ul>

  </aside>`;
}

const OBJ_SQL = 'SELECT o.*, u.handle, u.name uname, u.avatar FROM objects o JOIN users u ON u.id=o.user_id';

function objectCard(o, me, full = false) {
  const noted = me ? q('SELECT 1 FROM notes WHERE user_id=? AND object_id=?').get(me.id, o.id) : null;
  const tags = tagList(o.tags);
  const shortUrl = o.url ? (o.url.length > 34 ? o.url.slice(0, 34) + '…' : o.url) : '';
  return `<article class="note ${full ? 'note-full' : ''} ${o.image ? 'has-image' : ''}">
  <div class="byline"><a href="/u/${esc(o.handle)}">${avatar({ name: o.uname, handle: o.handle, avatar: o.avatar })}</a>${stackDate(o.created_at)}</div>
  <div class="card">
    <div class="text">
      <p class="who"><a href="/u/${esc(o.handle)}">${esc(o.handle)}</a> noted${o.private ? ' <span class="badge">Private</span>' : ''}</p>
      ${(() => { const cs = objCollections(o.id); return cs.length ? `<p class="colls">${cs.map((c) => `<a href="/u/${esc(o.handle)}?tab=notes&c=${c.id}">${esc(c.name)}</a>`).join(' · ')}</p>` : ''; })()}
      <h2><a href="/o/${o.id}">${esc(o.name)}</a></h2>
      ${o.why ? `<p class="body">${esc(o.why)}</p>` : ''}
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
    let rows = q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC LIMIT 200').all();
    if (feed === 'following') { const ids = new Set(q('SELECT followee_id id FROM follows WHERE follower_id=?').all(me.id).map((r) => r.id)); rows = rows.filter((o) => ids.has(o.user_id)); }
    if (feed === 'followers') { const ids = new Set(q('SELECT follower_id id FROM follows WHERE followee_id=?').all(me.id).map((r) => r.id)); rows = rows.filter((o) => ids.has(o.user_id)); }
    if (tag) rows = rows.filter((o) => tagList(o.tags).includes(tag));
    if (s) { const k = s.toLowerCase(); rows = rows.filter((o) => (o.name + ' ' + o.why + ' ' + o.tags).toLowerCase().includes(k)); }
    rows = rows.slice(0, 60);
    const members = q('SELECT handle, name, avatar FROM users ORDER BY created_at LIMIT 12').all();
    const tagCounts = {}; for (const o of q('SELECT tags FROM objects WHERE private=0').all()) for (const t of tagList(o.tags)) tagCounts[t] = (tagCounts[t] || 0) + 1;
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 16);
    const heading = { all: 'Activity from the entire network', following: 'From people you follow', followers: 'From your followers' }[feed];

    let rail;
    if (me) {
      const notes = q('SELECT COUNT(*) c FROM objects WHERE user_id=?').get(me.id).c;
      const colls = q('SELECT COUNT(*) c FROM collections WHERE user_id=?').get(me.id).c;
      const fc = followCounts(me.id);
      const fl = (k, label) => `<li><a class="${feed === k ? 'on' : ''}" href="/${k === 'all' ? '' : `?feed=${k}`}">${label}${feed === k ? '' : ' <span>›</span>'}</a></li>`;
      rail = `<ul class="feednav">${fl('all', 'All Discriminant.ly')}${fl('following', 'From People You Follow')}${fl('followers', 'From Your Followers')}</ul>
      <div class="wtable">
        <div class="wcell wcell-wide"><a href="/u/${esc(me.handle)}">${avatar(me, 'avatar big')}</a><p class="welcome-name">Welcome ${esc(me.name.split(' ')[0])}</p></div>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=notes"><b>${notes}</b><span>Notes</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=notes"><b>${colls}</b><span>Collections</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=followers"><b>${fc.followers}</b><span>Followers</span></a>
        <a class="wcell" href="/u/${esc(me.handle)}?tab=following"><b>${fc.following}</b><span>Following</span></a>
        <form class="wcell wcell-wide wcell-btn" method="post" action="/logout"><button class="btn3d block">Logout</button></form>
      </div>
      <p class="rail-post"><a class="btn3d block" href="/new">Post a new note</a></p>`;
    } else {
      rail = `<p class="rail-title">Start your profile to:</p>
      <ol class="steps"><li><span>1</span>Post + Collect <i>Notes</i></li><li><span>2</span>Follow People</li></ol>
      <form class="signup" method="get" action="/join"><label class="lbl">Invite code</label><input name="code" placeholder=""><button class="btn3d block">Sign me up</button></form>
      <form class="search" method="get" action="/"><input type="search" name="q" placeholder="Search discriminant.ly" value="${esc(s)}"></form>`;
    }
    const body = `
<div class="cols">
  <aside class="rail">
    ${rail}
    <h3 class="lbl ruled">Tags</h3><p class="tags rail-tags">${topTags.map(([t]) => `<a href="/?t=${encodeURIComponent(t)}" class="${t === tag ? 'on' : ''}">#${esc(t)}</a>`).join(', ') || '<span class="empty">None yet.</span>'}</p>
    ${me ? '' : `<h3 class="lbl ruled">About us</h3>
    <p class="about">We're a lightweight social platform for a small community of discerning individuals capturing, sharing and discovering fine goods from all over the web and all over the world.</p>
    <p class="about">We're serious about maintaining the integrity of this as an open and honest place to discover genuinely cool, interesting and rare things. For this reason, we don't allow any form of advertising or affiliate programs here.</p>
    <ul class="members">${members.map((u) => `<li><a href="/u/${esc(u.handle)}">${avatar(u)}<span>${esc(u.handle)}</span></a></li>`).join('')}</ul>`}
  </aside>
  <section class="feed feed-plain">
    <h3 class="strip">${s ? `Results for “${esc(s)}”` : tag ? `#${esc(tag)}` : heading}</h3>
    <div class="grid">${rows.length ? rows.map((o) => objectCard(o, me)).join('') : '<p class="empty pad">Nothing here yet.</p>'}</div>
  </section>
</div>`;
    send(res, layout({ title: '', body, me }));
  },

  object(req, res, me, url, id) {
    const o = q(OBJ_SQL + ' WHERE o.id=?').get(id); if (!o || !canSee(o, me)) return send(res, layout({ title: 'Not found', body: '<p>No such note.</p>', me }), 404);
    const tags = tagList(o.tags);
    const noters = q('SELECT u.handle, u.name, u.avatar FROM notes n JOIN users u ON u.id=n.user_id WHERE n.object_id=? ORDER BY n.created_at').all(id);
    const cmts = q('SELECT c.*, u.handle, u.name, u.avatar FROM comments c JOIN users u ON u.id=c.user_id WHERE c.object_id=? ORDER BY c.created_at').all(id);
    const ld = { '@context': 'https://schema.org', '@type': 'Product', name: o.name, url: o.url || undefined, image: o.image || undefined, description: o.why, keywords: tags.join(', ') || undefined };
    const author = q('SELECT * FROM users WHERE id=?').get(o.user_id);
    const body = `<div class="cols profile-cols">${profileRail(author, me, 'notes')}
<section class="feed profile-feed">
<h3 class="strip"><a class="crumb" href="/u/${esc(author.handle)}?tab=notes">${esc(author.name)}'s Notes</a> › ${esc(o.name)}</h3>
<div class="grid grid-single">${objectCard(o, me, true)}</div>
<section class="noters"><h3 class="lbl">Noted by</h3><ul class="people">${noters.map((n) => `<li><a class="person" href="/u/${esc(n.handle)}">${avatar(n)}<span class="person-name">${esc(n.name)}<em>${esc(n.handle)}</em></span></a></li>`).join('') || '<li class="empty pad">No one yet.</li>'}</ul></section>
<section class="comments">
  <h3 class="lbl">Comments</h3>
  ${me ? `<form method="post" action="/o/${o.id}/comments" class="comment-form">${avatar(me)}<textarea name="body" rows="2" maxlength="600" placeholder="Add a comment" required></textarea><button class="btn">Post</button></form>` : `<p class="empty pad">Sign in to leave a comment.</p>`}
  <ul class="comment-list">${cmts.map((c) => `<li><a href="/u/${esc(c.handle)}">${avatar(c)}</a><div class="comment-body"><p class="comment-meta"><a href="/u/${esc(c.handle)}">${esc(c.name)}</a> · ${timeAgo(c.created_at)}</p><p>${esc(c.body)}</p></div></li>`).join('') || '<li class="empty pad">No comments yet.</li>'}</ul>
</section>
</section></div>
<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    send(res, layout({ title: o.name, body, me, cls: 'is-article' }));
  },

  form(req, res, me, o = {}, err = '', picked = null) {
    const editing = !!o.id;
    const body = `<div class="notecard-page">${noteForm(me, o, { err, picked, idp: 'pg' })}</div>`;
    send(res, layout({ title: editing ? 'Edit note' : 'Post a new note', body, me }));
  },

  user(req, res, me, handle, url) {
    const u = q('SELECT * FROM users WHERE handle=?').get(handle); if (!u) return send(res, layout({ title: 'Not found', body: '<p>No such member.</p>', me }), 404);
    const owner = me && me.id === u.id;
    const tab = ['activity', 'notes', 'followers', 'following'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'activity';
    const cid = +url.searchParams.get('c') || 0; const vis = url.searchParams.get('v') || 'all'; const s = (url.searchParams.get('q') || '').trim();
    const visible = q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC').all(u.id).filter((o) => canSee(o, me));
    const fc = followCounts(u.id);
    const colls = q('SELECT id, name FROM collections WHERE user_id=? ORDER BY name').all(u.id).map((c) => {
      const ids = new Set(q('SELECT object_id FROM object_collections WHERE collection_id=?').all(c.id).map((r) => r.object_id));
      const items = visible.filter((o) => ids.has(o.id)); return { ...c, count: items.length, image: (items.find((o) => o.image) || {}).image || '' };
    });
    const link = (t, extra = '') => `/u/${esc(u.handle)}?tab=${t}${extra}`;

    let main = '';
    if (tab === 'followers' || tab === 'following') {
      const rows = tab === 'followers'
        ? q('SELECT u.* FROM follows f JOIN users u ON u.id=f.follower_id WHERE f.followee_id=? ORDER BY f.created_at DESC').all(u.id)
        : q('SELECT u.* FROM follows f JOIN users u ON u.id=f.followee_id WHERE f.follower_id=? ORDER BY f.created_at DESC').all(u.id);
      main = `<h3 class="strip">${tab === 'followers' ? `${fc.followers} ${fc.followers === 1 ? 'person follows' : 'people follow'} ${esc(u.name.split(' ')[0])}` : `${esc(u.name.split(' ')[0])} follows ${fc.following} ${fc.following === 1 ? 'person' : 'people'}`}</h3>
      <ul class="people">${rows.map((p) => {
        const pc = followCounts(p.id); const following = me && isFollowing(me.id, p.id);
        return `<li><a class="person" href="/u/${esc(p.handle)}">${avatar(p)}<span class="person-name">${esc(p.name)}<em>${esc(p.handle)} · ${q('SELECT COUNT(*) c FROM objects WHERE user_id=? AND private=0').get(p.id).c} notes · ${pc.followers} followers</em></span></a>
        ${me && me.id !== p.id ? `<form method="post" action="/u/${esc(p.handle)}/${following ? 'unfollow' : 'follow'}"><input type="hidden" name="back" value="${esc(url.pathname + url.search)}"><button class="btn ${following ? 'btn-on' : ''}">${following ? 'Following' : 'Follow'}</button></form>` : ''}</li>`;
      }).join('') || '<li class="empty pad">No one yet.</li>'}</ul>`;
    } else if (tab === 'notes') {
      let rows = visible;
      if (owner && vis === 'public') rows = rows.filter((o) => !o.private);
      if (owner && vis === 'private') rows = rows.filter((o) => o.private);
      if (cid) { const ids = new Set(q('SELECT object_id FROM object_collections WHERE collection_id=?').all(cid).map((r) => r.object_id)); rows = rows.filter((o) => ids.has(o.id)); }
      if (s) rows = rows.filter((o) => (o.name + ' ' + o.why + ' ' + o.tags).toLowerCase().includes(s.toLowerCase()));
      const tile = (id, name, count, image, on) => `<div class="tile-slot"><a class="tile ${on ? 'on' : ''}" href="${link('notes', `&c=${id}${vis !== 'all' ? '&v=' + vis : ''}`)}"><span class="tile-img" ${image ? `style="background-image:url('${esc(image)}')"` : ''}>${image ? '' : `<span class="tile-glyph">${ICONS.lens}</span>`}</span><span class="tile-name">${esc(name)}</span><span class="tile-count">${count}</span></a>${owner && id && on ? `<button type="button" class="tile-del" data-del-id="${id}" data-del-name="${esc(name)}" aria-label="Delete collection"><img src="/minus.png" alt="" width="28" height="28"></button>` : ''}</div>`;
      main = `<h3 class="strip">${esc(u.name)}'s Notes</h3>
      <div class="tiles-wrap">
        <div class="tiles-nav"><button type="button" class="tiles-arrow" data-scroll="-1" aria-label="Scroll collections left"><img src="/chev.png" alt="" width="26" height="26"></button><button type="button" class="tiles-arrow" data-scroll="1" aria-label="Scroll collections right"><img src="/chev.png" alt="" width="26" height="26"></button></div>
        <div class="tiles" id="tiles">${tile(0, 'All notes', visible.length, '', !cid)}${colls.map((c) => tile(c.id, c.name, c.count, c.image, c.id === cid)).join('')}${owner ? `
          <form class="tile tile-new" method="post" action="/collections/new">
            <span class="tile-img"><img src="/plus-sm.png" alt="" width="40" height="40"></span>
            <span class="tile-name">New collection</span>
            <span class="tile-count"><input name="name" placeholder="NAME IT" maxlength="40" required><button class="tile-save">Save</button></span>
          </form>` : ''}</div>
      </div>
      <form class="within" method="get" action="/u/${esc(u.handle)}"><input type="hidden" name="tab" value="notes">${cid ? `<input type="hidden" name="c" value="${cid}">` : ''}${vis !== 'all' ? `<input type="hidden" name="v" value="${esc(vis)}">` : ''}<input type="search" name="q" placeholder="Search within below" value="${esc(s)}"></form>
      ${owner ? `<div class="vis-tabs">${[['all', 'Public & Private Notes'], ['public', 'Public Notes'], ['private', 'Private Notes']].map(([k, l]) => `<a class="${vis === k ? 'on' : ''}" href="${link('notes', `&v=${k}${cid ? '&c=' + cid : ''}`)}">${l}</a>`).join('')}</div>
      <a class="post-box" href="/new"><img class="plus" src="/plus.png" alt="" width="68" height="68"><span>Post a new Note</span></a>` : ''}
      <div class="grid">${rows.length ? rows.map((o) => objectCard(o, me)).join('') : '<p class="empty pad">Nothing here yet.</p>'}</div>
    <script>
    (function () {
      var t = document.getElementById('tiles');
      if (t) document.querySelectorAll('.tiles-arrow').forEach(function (b) {
        b.addEventListener('click', function () { t.scrollBy({ left: (+b.dataset.scroll) * Math.max(240, t.clientWidth * 0.6), behavior: 'smooth' }); });
      });
      var nw = document.querySelector('.tile-new');
      if (nw) nw.addEventListener('click', function () { nw.classList.add('is-open'); nw.querySelector('input').focus(); });
      var dlg = document.getElementById('confirm-dialog');
      if (dlg) {
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
      for (const f of q('SELECT f.created_at, u2.handle FROM follows f JOIN users u2 ON u2.id=f.followee_id WHERE f.follower_id=? ORDER BY f.created_at DESC LIMIT 20').all(u.id))
        acts.push({ at: f.created_at, html: `followed <a href="/u/${esc(f.handle)}">${esc(f.handle)}</a>` });
      acts.sort((a, b) => (a.at < b.at ? 1 : -1));
      main = `<h3 class="strip">All activity</h3>
      <div class="activity-feed">${acts.slice(0, 60).map((a) => a.card
        ? `<div class="act-note">${objectCard(a.card, me)}</div>`
        : `<div class="act-line"><span class="act-date">${timeAgo(a.at)}</span><span>${esc(u.handle)} ${a.html}</span></div>`).join('') || '<p class="empty pad">Nothing yet.</p>'}</div>`;
    } 
    const body = `<div class="cols profile-cols">${profileRail(u, me, tab)}
  <section class="feed profile-feed">${main}</section>
</div>`;
    send(res, layout({ title: u.name, body, me }));
  },

  login(req, res, me, err = '') {
    send(res, layout({ title: 'Sign in', me, body: `<h1>Sign in</h1>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/login" class="form narrow">${field('email', 'Email', '', 'email', 'required autofocus')}${field('password', 'Password', '', 'password', 'required')}<p><button class="btn btn-primary">Sign in</button></p></form>
<p class="fine">Have an invite? <a href="/join">Join</a></p>` }));
  },

  join(req, res, me, code = '', err = '') {
    send(res, layout({ title: 'Join', me, body: `<h1>Join discriminant.ly</h1><p>Membership is by invitation. Enter the code a member sent you.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/join" class="form narrow">${field('code', 'Invite code', code, 'text', 'required')}${field('name', 'Your name', '', 'text', 'required')}${field('handle', 'Handle', '', 'text', 'required pattern="[a-z0-9]{2,24}" title="lowercase letters and numbers"')}${field('email', 'Email', '', 'email', 'required')}${field('password', 'Password', '', 'password', 'required minlength="8"')}<p><button class="btn btn-primary">Create account</button></p></form>` }));
  },

  invites(req, res, me) {
    const mine = q('SELECT * FROM invites WHERE from_user=? ORDER BY created_at DESC').all(me.id);
    const unused = mine.filter((i) => !i.used_by);
    const body = `<h1>Invites</h1><p>Each member may bring in a few people they trust. Send a code, or the link directly.</p>
<form method="post" action="/invites"><p><button class="btn btn-primary" ${unused.length >= 5 ? 'disabled' : ''}>Create an invite</button> <span class="fine">${unused.length} of 5 open</span></p></form>
<table class="invites">${mine.map((i) => `<tr><td><code>${i.code}</code></td><td>${i.used_by ? 'Used by ' + esc(q('SELECT name FROM users WHERE id=?').get(i.used_by).name) : `<a href="/join?code=${i.code}">/join?code=${i.code}</a>`}</td></tr>`).join('')}</table>`;
    send(res, layout({ title: 'Invites', body, me }));
  },

  settings(req, res, me, err = '') {
    const body = `<h3 class="strip dark-strip">Your Account Settings</h3>
<div class="settings">
  ${err ? `<p class="err">${esc(err)}</p>` : ''}
  <form method="post" action="/settings" class="wtable settings-table">
    <div class="wcell wcell-wide">${avatar(me, 'avatar big')}<p class="lbl set-cap">Change profile image</p>
      <label class="slabel">Image URL<input name="avatar" type="url" value="${esc(me.avatar)}" placeholder="https://"></label></div>
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
    <div class="wcell wcell-wide"><form method="post" action="/logout"><button class="btn3d block">Sign out</button></form></div>
  </div>
</div>`;
    send(res, layout({ title: 'Settings', body, me, cls: 'is-dark-page' }));
  },

  welcome(req, res, me) {
    const rows = q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC LIMIT 4').all();
    const body = `
<section class="splash">
  <img class="splash-mark" src="/mark.png" alt="" width="60" height="80">
  <p class="splash-word">discriminant.ly</p>
  <h1 class="splash-h">Capture. Discover. Share.</h1>
  <p class="splash-sub">the world's fine and beautiful things</p>
  ${me ? `<a class="btn btn-dark" href="/">Enter</a>` : `<form class="splash-form" method="get" action="/join"><input name="code" placeholder="Your invite code" required><button class="btn">Sign me up</button></form>`}
</section>
<section class="preview"><div class="preview-chrome"><span></span><span></span><span></span></div>
  <div class="feed preview-feed"><h3 class="strip">Activity from the entire network</h3><div class="grid">${rows.map((o) => objectCard(o, me)).join('')}</div></div>
</section>`;
    send(res, layout({ title: 'Welcome', body, me, cls: 'is-welcome' }));
  },

  about(req, res, me) {
    send(res, layout({ title: 'About', me, body: `<h1>About</h1><p>discriminant.ly was designed with a single focus: to serve as an elegant social sharing platform for its members to collect, share and discover the most interesting fine goods from around the world.</p><p>Every entry is one object, one maker, and one honest reason from the member who noted it. Nothing is sponsored. Membership is by invitation.</p>` }));
  },
};

const baseUrl = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

// ---------- MCP endpoint (Streamable HTTP, JSON-RPC) ----------
const TOOLS = [
  { name: 'note_object', description: 'Post a new note to discriminant.ly as the connected member. Use when the user wants to note, log, bookmark or post a fine object.',
    inputSchema: { type: 'object', required: ['headline', 'image'], properties: {
      headline: { type: 'string', description: 'Short headline: the object and maker, e.g. "Mauviel M\'250 copper saucepan"' },
      description: { type: 'string', description: 'One to three sentences: what it is and why it is worth noting, in the member\'s voice' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase tags, e.g. ["kitchen","copper","france"]' },
      link: { type: 'string', description: 'URL where the object can be found' },
      image: { type: 'string', description: 'Image URL for the object. Required — every note carries an image.' },
      collections: { type: 'array', items: { type: 'string' }, description: 'Names of the member\'s collections to file this under (created if new). A note may sit in several.' },
      private: { type: 'boolean', description: 'True to keep the note visible only to the member' } } } },
  { name: 'my_collections', description: 'List the connected member\'s collections with counts.', inputSchema: { type: 'object', properties: {} } },
  { name: 'recent_notes', description: 'List the most recent notes on discriminant.ly (all members). Optional search query.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 10 } } } },
  { name: 'my_notes', description: 'List the connected member\'s own notes.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 20 } } } },
  { name: 'edit_note', description: 'Edit a note the connected member owns. Only pass the fields being changed — anything omitted is left as is.',
    inputSchema: { type: 'object', required: ['id'], properties: {
      id: { type: 'integer', description: 'The note\'s id, e.g. from note_object\'s "Noted as #7" or from recent_notes/my_notes.' },
      headline: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      link: { type: 'string' },
      image: { type: 'string' },
      collections: { type: 'array', items: { type: 'string' }, description: 'Replaces the note\'s full set of collections.' },
      private: { type: 'boolean' } } } },
  { name: 'delete_note', description: 'Permanently delete a note the connected member owns. Cannot be undone.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
];
function mcpCall(user, name, a = {}) {
  const fmt = (o) => `#${o.id} ${o.name} — ${o.why}${o.tags ? ` [${o.tags}]` : ''}${o.url ? ` ${o.url}` : ''} (by ${o.handle}, ${o.created_at})`;
  if (name === 'note_object') {
    if (!a.headline) throw new Error('headline is required');
    if (!a.image) throw new Error('image is required: every note carries an image');
    const r = q('INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,?,?,?,?,?)').run(user.id, String(a.headline).trim(), String(a.description || '').trim(), tagList(Array.isArray(a.tags) ? a.tags.join(',') : a.tags).join(', '), a.link || '', a.image || '', a.private ? 1 : 0);
    q('INSERT OR IGNORE INTO notes(user_id,object_id) VALUES(?,?)').run(user.id, r.lastInsertRowid);
    if (Array.isArray(a.collections)) setCollections(user.id, r.lastInsertRowid, a.collections);
    return `Noted as #${r.lastInsertRowid}: ${a.headline}${a.private ? ' (private)' : ''}${Array.isArray(a.collections) && a.collections.length ? ' in ' + a.collections.join(', ') : ''}`;
  }
  if (name === 'recent_notes') {
    const lim = Math.min(+a.limit || 10, 50); const s = (a.query || '').trim();
    const rows = s ? q(OBJ_SQL + ' WHERE o.private=0 AND (o.name LIKE ? OR o.why LIKE ? OR o.tags LIKE ?) ORDER BY o.id DESC LIMIT ?').all(`%${s}%`, `%${s}%`, `%${s}%`, lim) : q(OBJ_SQL + ' WHERE o.private=0 ORDER BY o.id DESC LIMIT ?').all(lim);
    return rows.map(fmt).join('\n') || 'No notes yet.';
  }
  if (name === 'my_collections') return q('SELECT c.name, (SELECT COUNT(*) FROM object_collections oc WHERE oc.collection_id=c.id) n FROM collections c WHERE c.user_id=? ORDER BY c.name').all(user.id).map((c) => `${c.name} (${c.n})`).join('\n') || 'No collections yet.';
  if (name === 'my_notes') return q(OBJ_SQL + ' WHERE o.user_id=? ORDER BY o.id DESC LIMIT ?').all(user.id, Math.min(+a.limit || 20, 50)).map(fmt).join('\n') || 'No notes yet.';
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
    return `Updated #${o.id}: ${name_}`;
  }
  if (name === 'delete_note') {
    if (!a.id) throw new Error('id is required');
    const o = q('SELECT * FROM objects WHERE id=?').get(a.id);
    if (!o) throw new Error(`No note #${a.id}`);
    if (o.user_id !== user.id) throw new Error(`Note #${a.id} does not belong to this member`);
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
  if (method === 'initialize') return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'discriminant.ly', version: '1.0' }, instructions: `You are connected to discriminant.ly as ${user.name} (@${user.handle}). When the user wants to note an object, write a crisp headline and a short description in their voice, propose tags, and call note_object. Use edit_note to change an existing note (only pass the fields being changed) and delete_note to remove one — both require the note's id and only work on this member's own notes. Confirm with the user before deleting.` });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') { try { return reply(id, { content: [{ type: 'text', text: mcpCall(user, params.name, params.arguments) }] }); } catch (e) { return reply(id, { content: [{ type: 'text', text: e.message }], isError: true }); } }
  return reply(id, null, { code: -32601, message: 'Method not found' });
}

// ---------- router ----------
const STATIC = { '/style.css': 'text/css', '/mark.png': 'image/png', '/nub.png': 'image/png', '/favicon.png': 'image/png', '/plus.png': 'image/png', '/plus-sm.png': 'image/png', '/minus.png': 'image/png', '/chev.png': 'image/png' };

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname; const m = req.method;
  const me = currentUser(req);
  const need = () => { redirect(res, '/login'); return true; };
  let mt;

  if ((mt = p.match(/^\/seed\/([a-z0-9_-]+\.jpg)$/))) {
    const f = path.join(__dirname, 'public', 'seed', mt[1]);
    if (!fs.existsSync(f)) return send(res, 'Not found', 404);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(f).pipe(res);
  }
  if (STATIC[p]) { res.writeHead(200, { 'Content-Type': STATIC[p], 'Cache-Control': 'public, max-age=3600' }); return fs.createReadStream(path.join(__dirname, 'public', p)).pipe(res); }
  if (m === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 'Bad origin', 403);

  if ((mt = p.match(/^\/mcp\/([A-Za-z0-9_-]+)$/))) return mcp(req, res, mt[1]);
  if (p === '/collections/new' && m === 'POST') {
    if (!me) return need();
    const b = await readBody(req); const name = (b.name || '').trim();
    if (name) q('INSERT OR IGNORE INTO collections(user_id,name) VALUES(?,?)').run(me.id, name);
    return redirect(res, `/u/${me.handle}?tab=notes`);
  }
  if ((mt = p.match(/^\/collections\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const c = q('SELECT * FROM collections WHERE id=? AND user_id=?').get(+mt[1], me.id);
    if (c) q('DELETE FROM collections WHERE id=?').run(c.id);
    return redirect(res, `/u/${me.handle}?tab=notes`);
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

  if (p === '/new') {
    if (!me) return need();
    if (m === 'GET') return pages.form(req, res, me);
    const b = await readBodyMulti(req); const colls = [...b.coll, ...(b.newcoll || '').split(',')];
    if (!(b.name || '').trim()) return pages.form(req, res, me, b, 'A note needs a title.', colls);
    if (!(b.image || '').trim()) return pages.form(req, res, me, b, 'Every note needs an image.', colls);
    const r = q('INSERT INTO objects(user_id,name,why,tags,url,image,private) VALUES(?,?,?,?,?,?,?)')
      .run(me.id, b.name.trim(), (b.why || '').trim(), tagList(b.tags).join(', '), b.url || '', b.image || '', b.private ? 1 : 0);
    q('INSERT OR IGNORE INTO notes(user_id,object_id,why) VALUES(?,?,?)').run(me.id, r.lastInsertRowid, '');
    setCollections(me.id, r.lastInsertRowid, colls);
    return redirect(res, `/o/${r.lastInsertRowid}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)$/))) return pages.object(req, res, me, url, +mt[1]);
  if ((mt = p.match(/^\/o\/(\d+)\/(note|unnote)$/)) && m === 'POST') {
    if (!me) return need();
    if (mt[2] === 'note') q('INSERT OR IGNORE INTO notes(user_id,object_id) VALUES(?,?)').run(me.id, +mt[1]);
    else if (!q('SELECT 1 FROM objects WHERE id=? AND user_id=?').get(+mt[1], me.id)) q('DELETE FROM notes WHERE user_id=? AND object_id=?').run(me.id, +mt[1]);
    return redirect(res, req.headers.referer || `/o/${mt[1]}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/comments$/)) && m === 'POST') {
    if (!me) return need();
    const o = q('SELECT id FROM objects WHERE id=?').get(+mt[1]); if (!o) return send(res, 'Not found', 404);
    const b = await readBody(req); const body = (b.body || '').trim();
    if (body) q('INSERT INTO comments(object_id,user_id,body) VALUES(?,?,?)').run(o.id, me.id, body);
    return redirect(res, `/o/${o.id}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/edit$/))) {
    if (!me) return need();
    const o = q('SELECT * FROM objects WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin); if (!o) return send(res, 'Not yours', 403);
    if (m === 'GET') return pages.form(req, res, me, o);
    const b = await readBodyMulti(req);
    q('UPDATE objects SET name=?,why=?,tags=?,url=?,image=?,private=? WHERE id=?')
      .run((b.name || o.name).trim(), (b.why || '').trim(), tagList(b.tags).join(', '), b.url || '', b.image || '', b.private ? 1 : 0, o.id);
    setCollections(o.user_id, o.id, [...b.coll, ...(b.newcoll || '').split(',')]);
    return redirect(res, `/o/${o.id}`);
  }
  if ((mt = p.match(/^\/o\/(\d+)\/delete$/)) && m === 'POST') {
    if (!me) return need();
    const o = q('SELECT * FROM objects WHERE id=? AND (user_id=? OR ?=1)').get(+mt[1], me.id, me.is_admin); if (!o) return send(res, 'Not yours', 403);
    q('DELETE FROM objects WHERE id=?').run(o.id);
    return redirect(res, `/u/${me.handle}?tab=notes`);
  }
  if ((mt = p.match(/^\/u\/([a-z0-9]+)\/(follow|unfollow)$/)) && m === 'POST') {
    if (!me) return need();
    const t = q('SELECT id FROM users WHERE handle=?').get(mt[1]); if (!t || t.id === me.id) return redirect(res, '/');
    const b = await readBody(req);
    if (mt[2] === 'follow') q('INSERT OR IGNORE INTO follows(follower_id,followee_id) VALUES(?,?)').run(me.id, t.id);
    else q('DELETE FROM follows WHERE follower_id=? AND followee_id=?').run(me.id, t.id);
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
if (q('SELECT COUNT(*) c FROM users').get().c === 0) {
  const email = process.env.ADMIN_EMAIL || 'admin@discriminant.ly', pass = process.env.ADMIN_PASSWORD || 'changeme1';
  q('INSERT INTO users(handle,name,email,pass,is_admin) VALUES(?,?,?,?,1)').run(process.env.ADMIN_HANDLE || 'elicierto', process.env.ADMIN_NAME || 'Brian Elicierto', email, hashPass(pass));
  const code = token(6); q('INSERT INTO invites(code,from_user) VALUES(?,1)').run(code);
  console.log(`First run: admin ${email} / ${pass}. One invite code: ${code}`);
  if (process.env.SEED) require('./seed')(db);
}

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e); send(res, 'Something went wrong.', 500); })).listen(PORT, () => console.log(`discriminant.ly on http://localhost:${PORT}`));
