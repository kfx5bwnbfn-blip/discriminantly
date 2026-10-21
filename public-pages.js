// Public pages (review build): Home, How it works, Travel Marks, Use with AI,
// Muse guide, Guides index. One header, one page template, one content
// model (public-content.js). Rendered through the app's own layout(), so the
// skins, tokens and typography are the application's.
//
// Everything is server-rendered and readable without JavaScript. The only
// script is the menu's Escape-to-close and focus restore; the menu itself is
// a <details> element, so it opens, closes and announces its state natively.

'use strict';
const C = require('./public-content');

function create(d) {
  const { layout, send, sendZ, esc, PUBLIC_ORIGIN, skinOf, modeOf, aiLogo, WL_ICON, pluginUrl } = d;
  const avatarSrc = d.avatarSrc || ((u) => (u && u.avatar) || '');
  const PLUGIN = () => (pluginUrl && pluginUrl()) || '';
  // Structured data shared by every public page. Only facts the pages state.
  const ORG = { '@type': 'Organization', '@id': PUBLIC_ORIGIN + '/#org', name: C.site.name, url: PUBLIC_ORIGIN + '/', logo: { '@type': 'ImageObject', url: PUBLIC_ORIGIN + '/icon-512.png', width: 512, height: 512 } };
  const SITE = { '@type': 'WebSite', '@id': PUBLIC_ORIGIN + '/#site', name: C.site.name, url: PUBLIC_ORIGIN + '/', description: C.site.description, publisher: { '@id': PUBLIC_ORIGIN + '/#org' } };
  const ldScript = (graph) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
  const crumbsHtml = (crumbs) => crumbs && crumbs.length ? `<nav class="pub-crumbs" aria-label="Breadcrumb"><ol>${crumbs.map((c, i) => `<li>${i < crumbs.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : `<span aria-current="page">${esc(c.name)}</span>`}</li>`).join('')}</ol></nav>` : '';
  const crumbsLd = (crumbs) => crumbs && crumbs.length ? { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: PUBLIC_ORIGIN + c.href })) } : null;
  const HOME_CRUMB = { name: 'Discriminantly', href: '/' };
  const canonical = (p) => PUBLIC_ORIGIN + p;
  const OG_IMAGE = PUBLIC_ORIGIN + '/icon-512.png';

  // ---- header ---------------------------------------------------------------
  // One menu (v2.106): the same <details> panel, button, dim and script serve
  // the public header and, signed in, the application's search bar. Only the
  // contents differ: `menuPanel` builds them by state.
  const MENU_BTN = `<summary class="pub-menu-btn" aria-controls="pub-menu-panel" aria-label="Menu"><svg class="pub-menu-ico" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><svg class="pub-menu-x" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary>`;
  const MENU_SCRIPT = `<script>
  (function () {
    var d = document.getElementById('pub-menu'); if (!d) return;
    var s = d.querySelector('summary');
    function sync() { s.setAttribute('aria-expanded', d.open ? 'true' : 'false'); }
    sync(); d.addEventListener('toggle', sync);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && d.open) { d.open = false; s.focus(); } });
    document.addEventListener('click', function (e) { if (d.open && (!d.contains(e.target) || e.target.classList.contains('pub-menu-dim'))) d.open = false; });
    d.addEventListener('toggle', function () { document.body.classList.toggle('pub-menu-open', d.open); });
    var h = d.closest('.pub-head'); if (h && h.classList.contains('pub-head-home')) {
      var stuck = function () { h.classList.toggle('is-stuck', window.scrollY > 8); };
      stuck(); window.addEventListener('scroll', stuck, { passive: true });
    }
  })();
  </script>`;
  const item = (path) => { const cur = (href) => href === path ? ' aria-current="page"' : ''; return (n) => `<li><a href="${esc(n.href)}"${cur(n.href)}>${esc(n.label)}</a>${n.children ? `<ul class="pub-menu-chips">${n.children.map((c) => { const p = C.platforms.find((x) => x.guide === c.href); return `<li><a class="pub-menu-chip" href="${esc(c.href)}"${cur(c.href)}>${p ? aiLogo(p.key) : ''}<span>${esc(p ? p.name : c.label)}</span></a></li>`; }).join('')}</ul>` : ''}</li>`; };
  const meRow = (me, sub = 'Open your feed', href = null) => me ? `<a class="pub-menu-me" href="${esc(href || '/u/' + me.handle)}">${me.avatar && avatarSrc(me) ? `<img class="pub-menu-avatar" src="${esc(avatarSrc(me))}" alt="" width="36" height="36">` : `<span class="pub-menu-avatar pub-menu-initial">${esc((me.handle || '?')[0].toUpperCase())}</span>`}<span class="pub-menu-who"><b>@${esc(me.handle)}</b><span>${esc(sub)}</span></span></a>` : '';
  const menuShell = (inner, cls = '') => `<details class="pub-menu${cls}" id="pub-menu">
        ${MENU_BTN}
        <div class="pub-menu-dim" aria-hidden="true"></div>
        <nav class="pub-menu-panel" id="pub-menu-panel" aria-label="Site">
{inner}
        </nav>
      </details>`.replace('{inner}', inner);
  // The public menu's contents: site navigation, then (signed out) the sign-in form.
  function publicPanel(me, path) {
    const it = item(path);
    const first = C.nav.filter((n) => ['/', '/activity'].includes(n.href)), learn = C.nav.filter((n) => ['/how-it-works', '/ai', '/guides'].includes(n.href)), rest = C.nav.filter((n) => !first.includes(n) && !learn.includes(n));
    // Signed out (20 Oct, Brian): the account first -- Get started, then the
    // sign-in fields in the same group -- and the navigation under it.
    const account = me ? meRow(me) : `<div class="pub-menu-account">
            <p class="pub-menu-label">Your account</p>
            <p class="pub-menu-start"><a class="btn3d btn-solid" href="/join">Get started</a></p>
            <form class="pub-menu-signin" method="post" action="/login">
            <p class="pub-menu-or"><span>or sign in</span></p>
            <label class="pub-menu-field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required></label>
            <label class="pub-menu-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
            ${path && path !== '/' ? `<input type="hidden" name="next" value="${esc(path)}">` : ''}
            <button class="btn3d block">Sign in</button>
          </form></div>`;
    return `          ${account}
          <ul class="pub-menu-list">${first.map(it).join('')}</ul>
          <p class="pub-menu-label">Learn</p>
          <ul class="pub-menu-list">${learn.map(it).join('')}</ul>
          <p class="pub-menu-label">About</p>
          <ul class="pub-menu-list">${rest.map(it).join('')}</ul>
          <div class="pub-menu-util">${(me ? [{ label: 'Settings', href: '/settings' }] : []).concat(C.utility.slice(1)).map((u) => `<a href="${esc(u.href)}">${esc(u.label)}</a>`).join('')}</div>`;
  }
  // The application's menu (v2.106, Brian): the member first (avatar row to
  // their profile, then their profile's tabs), their AI by state (an
  // unconnected assistant links to its connect guide in Settings; with nothing
  // connected the group leads with Connect your AI), Learn, Help, then
  // Settings and Sign out. The icon rail keeps Home, Profile, Settings and
  // Search; this is everything else.
  function appPanel(me, path, st, counts) {
    const it = item(path);
    const u = '/u/' + encodeURIComponent(me.handle);
    // the profile rail's own groups, names and chips (Brian, 15 Oct), in the
    // rail's real components (.wtable/.wcell, .pgrp-*), scaled to the panel
    const n = (k) => counts && counts[k] != null ? counts[k] : '';
    const cur = (href) => href === path ? ' on' : '';
    const cell = (href, count, name) => `<a class="wcell${cur(href)}" href="${esc(href)}"><b>${count}</b><span>${esc(name)}</span></a>`;
    const group = (label, items) => `<div class="wtable pgrp-group"><p class="pgrp-label">${esc(label)}</p>${items.map(([h, c, nm]) => cell(h, c, nm)).join('')}</div>`;
    const solo = (href, count, name, lead = '') => `<div class="wtable pgrp-solo"><a class="wcell wcell-wide${cur(href)}" href="${esc(href)}">${lead}${count === null ? '' : `<b>${count}</b>`}<span>${esc(name)}</span></a></div>`;
    const face = me.avatar && avatarSrc(me) ? `<img class="pub-menu-avatar app-pgrp-face" src="${esc(avatarSrc(me))}" alt="" width="36" height="36">` : `<span class="pub-menu-avatar pub-menu-initial app-pgrp-face">${esc((me.handle || '?')[0].toUpperCase())}</span>`;
    // Logout as the menu's footer (20 Oct): who is signed in on the left, the
    // action on the right, in the utility row's small capitals -- a utility,
    // not a destination, so it does not dress as one.
    const logout = `<form method="post" action="/logout" class="pub-menu-util app-menu-foot"><span class="app-menu-who" title="Signed in as @${esc(me.handle)}">@${esc(me.handle)}</span><button type="submit">Log out</button></form>`;
    // the rail's order: All activity, Places, Things, People, Warrants; every card the same height
    const youNav = `<div class="pgrp-nav app-pgrp">
            ${solo(u, null, 'All activity', face)}
            ${group('Places', [[u + '?tab=marks', n('marks'), 'Marks'], ['/t', n('itineraries'), 'Itineraries']])}
            ${group('Things', [[u + '?tab=notes', n('notes'), 'Notes'], [u + '?tab=ensembles', n('ensembles'), 'Ensembles']])}
            ${group('People', [[u + '?tab=followers', n('followers'), 'Followers'], [u + '?tab=following', n('following'), 'Following']])}
            ${solo(u + '?tab=warrants', n('warrants'), 'Warrants')}
          </div>`;
    const connected = (p) => !!(st && st[p.key]);
    const anyAi = C.platforms.some(connected);
    const ai = `<ul class="pub-menu-chips pub-menu-ai">${C.platforms.map((p) => `<li><a class="pub-menu-chip${connected(p) ? ' is-connected' : ''}" href="${connected(p) ? '/settings/connections' : '/settings#connect-guide'}">${aiLogo(p.key)}<span>${esc(p.name)}</span>${connected(p) ? '<i class="pub-menu-ok" aria-label="Connected">\u2713</i>' : ''}</a></li>`).join('')}</ul>`;
    const aiGroup = `<p class="pub-menu-label">Your AI</p>${anyAi ? '' : `<ul class="pub-menu-list"><li><a class="pub-menu-lead" href="/settings#connect-guide">Connect your AI</a></li></ul>`}${ai}`;
    const learn = C.nav.filter((n) => ['/how-it-works', '/ai', '/guides'].includes(n.href)).map((n) => ({ label: n.label, href: n.href }));
    const help = [{ label: 'Support', href: '/support' }, { label: 'Privacy', href: '/privacy' }, { label: 'Terms', href: '/terms' }];
    return `          <ul class="pub-menu-list">${[{ label: 'Home', href: '/' }, { label: 'Settings', href: '/settings' }].map(it).join('')}</ul>
          ${youNav}
          ${anyAi ? '' : aiGroup}
          <p class="pub-menu-label">Learn</p>
          <ul class="pub-menu-list">${learn.map(it).join('')}</ul>
          ${anyAi ? aiGroup : ''}
          <p class="pub-menu-label">Help</p>
          <ul class="pub-menu-list">${help.map(it).join('')}</ul>
          ${logout}
`;
  }
  // The application's search bar carries the mark, the search field and the menu (v2.106).
  function appMenu(me, { path = '', st = null, counts = null } = {}) {
    return menuShell(appPanel(me, path, st, counts), ' app-menu') + MENU_SCRIPT;
  }
  function header(me, { home = false, path = '' } = {}) {
    // Signed in (v2.106.3), the search bar already carries the mark and the
    // menu, so a public page gets no second masthead.
    if (me) return '';
    // Signed out (v2.107): the centred mark-and-wordmark lockup the activity
    // page's masthead uses, the menu at the right; Get started lives in the menu.
    return `<header class="pub-head${home ? ' pub-head-home' : ''} pub-head-lockup">
  <div class="wrap pub-head-in">
    <a class="pub-brand" href="/" aria-label="Discriminantly home"><img src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="17" height="23"><span class="pub-word">${C.site.wordmark}</span></a>
    <div class="pub-acts">
      ${menuShell(publicPanel(me, path))}
    </div>
  </div>
${me ? '' : `  <script>
  (function () {
    var d = document.getElementById('pub-menu'); if (!d) return;
    var s = d.querySelector('summary');
    function sync() { s.setAttribute('aria-expanded', d.open ? 'true' : 'false'); }
    sync(); d.addEventListener('toggle', sync);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && d.open) { d.open = false; s.focus(); } });
    document.addEventListener('click', function (e) { if (d.open && (!d.contains(e.target) || e.target.classList.contains('pub-menu-dim'))) d.open = false; });
    d.addEventListener('toggle', function () { document.body.classList.toggle('pub-menu-open', d.open); });
    var h = d.closest('.pub-head'); if (h && h.classList.contains('pub-head-home')) {
      var stuck = function () { h.classList.toggle('is-stuck', window.scrollY > 8); };
      stuck(); window.addEventListener('scroll', stuck, { passive: true });
    }
  })();
  </script>
`}</header>`;
  }
  const foot = `<footer class="welcome-foot fine"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></footer>`;

  // ---- shared pieces --------------------------------------------------------
  const cta = (me) => me ? `<a class="btn3d btn-solid pub-cta-big" href="/">Open Discriminantly</a>` : `<a class="btn3d btn-solid pub-cta-big" href="/join">Get started</a>`;
  const eyebrow = (t) => `<p class="lbl pub-eyebrow">${t}</p>`;
  // Plain copy with blank-line paragraphs and **bold**; escaped first.
  const paras = (t, cls = 'pub-p') => String(t).split(/\n\n+/).map((x) => `<p class="${cls}">${esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`).join('');
  const sec = (id, eye, h2, inner, cls = '') => `<section class="pub-sec ${cls}" id="${id}" aria-labelledby="${id}-h">${eye ? eyebrow(eye) : ''}<h2 class="pub-h2" id="${id}-h">${h2}</h2>${inner}</section>`;

  // Phone captures from the application, with captions that state the record and its non-implications.
  const phoneShot = (key, { lazy = true } = {}) => { const s = C.shots[key]; if (!s) return '';
    return `<figure class="pub-shot pub-shot-phone pub-shot-app"><span class="phone-body"><span class="phone-shadow"></span><span class="phone"><span class="phone-notch"></span><picture><source type="image/webp" srcset="/how/${s.file}.webp"><img src="/how/${s.file}.jpg" alt="${esc(s.alt)}" width="${s.w}" height="${s.h}"${lazy ? ' loading="lazy" decoding="async"' : ''}></picture></span></span><figcaption class="welcome-caption pub-shot-cap">${esc(s.caption)}</figcaption></figure>`; };
  // Proves / does-not-prove statements as a pair of card columns.
  const proofCards = (items) => { const yes = items.filter((x) => /\bproves\b/.test(x) && !/does not prove|proves nothing|never|not prove/.test(x)), no = items.filter((x) => !yes.includes(x));
    return `<div class="pub-proof">${yes.length ? `<div class="pub-proof-col pub-proof-yes"><p class="lbl pub-proof-lbl">Proves</p><ul>${yes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}<div class="pub-proof-col pub-proof-no"><p class="lbl pub-proof-lbl">Does not prove</p><ul>${no.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`; };
  const phoneRow = (keys) => keys && keys.length ? `<div class="pub-phone-row pub-phone-row-${keys.length}">${keys.map((k) => phoneShot(k)).join('')}</div>` : '';
  const shotsLd = (keys) => (keys || []).map((k) => C.shots[k]).filter(Boolean).map((s) => ({ '@type': 'ImageObject', contentUrl: PUBLIC_ORIGIN + '/how/' + s.file + '.jpg', url: PUBLIC_ORIGIN + '/how/' + s.file + '.jpg', width: s.w, height: s.h, caption: s.caption, description: s.alt, representativeOfPage: false }));
  const illus = `<p class="pub-illus-label"><span class="lbl">${C.demo.label}</span> <span class="fine">Invented records, shown to explain the product. Not a real member.</span></p>`;
  const platformRow = (p) => `<article class="pub-plat" id="${p.key}" aria-labelledby="plat-${p.key}">
    <div class="pub-plat-head">${aiLogo(p.key)}<h3 class="pub-h3" id="plat-${p.key}">${esc(p.name)}${p.by ? ` <span class="pub-by">by ${esc(p.by)}</span>` : ''}</h3></div>
    <dl class="pub-facts">
      <div><dt>Availability</dt><dd>${esc(p.availability)}</dd></div>
      <div><dt>Connection</dt><dd>${esc(p.method)}</dd></div>
      <div><dt>Authentication</dt><dd>${esc(p.auth)}</dd></div>
      <div><dt>Directory</dt><dd>${esc(p.directory)}</dd></div>
      ${p.review ? `<div><dt>Review</dt><dd>${esc(p.review)}</dd></div>` : ''}
      ${p.basis ? `<div><dt>Verification</dt><dd>${esc(p.basis)}</dd></div>` : ''}
    </dl>
    <p class="pub-plat-act"><a class="link caps" href="${esc(p.guide)}">Guide →</a>${p.key === 'chatgpt' && PLUGIN() ? ` <a class="link caps" href="${esc(PLUGIN())}" rel="noopener">Open in ChatGPT ↗</a>` : ''}</p>
  </article>`;
  const stepsList = (items) => `<ol class="steps wl-how pub-steps">${items.map((t, n) => `<li><span>${n + 1}</span><div>${t}</div></li>`).join('')}</ol>`;
  // Instant navigation between public pages (v2.104): Chrome and Edge start
  // loading a public page when the pointer rests on its link or a finger presses
  // it, so the page is usually ready on release. Signed-out only, an explicit
  // list of editorial pages, nothing with an account, a share, or a database
  // feed behind it. Browsers without speculation rules ignore the block.
  const SPECULATE = `<script type="speculationrules">${JSON.stringify({ prerender: [{ where: { href_matches: ['/', '/how-it-works', '/travel-marks', '/ai', '/ai/*', '/guides', '/guides/*', '/notes', '/check-ins', '/collections', '/itineraries', '/warrants', '/about', '/support', '/privacy', '/terms'] }, eagerness: 'moderate' }] })}</script>`;
  // Public editorial HTML may be cached by shared caches only for signed-out
  // visitors; a signed-in render (its header says Open Discriminantly) never is.
  const cacheHeaders = (me) => me ? { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Accept-Encoding' } : { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600', Vary: 'Cookie, Accept-Encoding' };
  // A phone capture above a page's headline (v2.101): the page's first image,
  // loaded eagerly, with its caption and an ImageObject of its own.
  const heroShot = (key) => { const s = C.shots[key]; if (!s) return '';
    return `<figure class="pub-shot pub-shot-phone pub-shot-app pub-hero-shot"><span class="phone-body"><span class="phone-shadow"></span><span class="phone"><span class="phone-notch"></span><picture><source type="image/webp" srcset="/how/${s.file}.webp"><img src="/how/${s.file}.jpg" alt="${esc(s.alt)}" width="${s.w}" height="${s.h}" fetchpriority="high" decoding="async"></picture></span></span><figcaption class="welcome-caption pub-shot-cap">${esc(s.caption)}</figcaption></figure>`; };
  const page = (res, me, req, { path, title, fullTitle = null, description, h1, lede, body, home = false, cls = '', crumbs = null, ld = [], card = null, hero = null, glyph = null }) => {
    if (hero) ld = [...ld, ...shotsLd([hero])];
    const graph = [ORG, SITE, { '@type': 'WebPage', '@id': canonical(path), url: canonical(path), name: fullTitle || title, description, isPartOf: { '@id': PUBLIC_ORIGIN + '/#site' }, inLanguage: 'en', ...(crumbsLd(crumbs) ? { breadcrumb: crumbsLd(crumbs) } : {}) }, ...ld];
    return (sendZ ? sendZ.bind(null, req) : send)(res, layout({ title, me, req, cls: `is-welcome is-public ${cls}`,
      body: `${crumbsHtml(crumbs)}${h1 ? `<section class="pub-hero${hero ? ' pub-hero-with-shot' : ''}">${glyph ? `<span class="wl-ico pub-keep-ico pub-hero-ico" aria-hidden="true">${glyph}</span>` : ''}<h1 class="pub-h1">${h1}</h1>${lede ? `<p class="pub-lede">${lede}</p>` : ''}${hero ? heroShot(hero) : ''}</section>` : ''}${body}${foot}${ldScript(graph)}${me ? '' : SPECULATE}`,
      pub: { title: fullTitle || `${title} — Discriminantly`, description, canonical: canonical(path), og: { title: fullTitle ? fullTitle.replace(/ — Discriminantly$/, '') : title, description, image: PUBLIC_ORIGIN + (card || '/card/site.png'), imageWidth: 1200, imageHeight: 630, card: 'summary_large_image' }, header: header(me, { home, path }) } }), 200, cacheHeaders(me));
  };

  // ---- 1. Home ----------------------------------------------------------------
  // Glyphs for the two record types the welcome card has none for, in its frame.
  const GLYPH = {
    note: WL_ICON.note, mark: WL_ICON.mark, warrant: WL_ICON.warrant,
    // a plan: the spine, three stops, a line for each (the welcome card keeps the fuller version)
    itinerary: `<svg viewBox="0 0 44 48" aria-hidden="true"><path d="M13 8v32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="13" cy="12" r="3.4" fill="currentColor"/><circle cx="13" cy="24" r="3.4" fill="currentColor"/><circle cx="13" cy="36" r="3.4" fill="currentColor"/><path d="M22 12h12M22 24h12M22 36h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    // the travel mark's pin, the visit ticked inside it: a place you went
    checkin: `<svg viewBox="0 0 44 48" aria-hidden="true"><defs><linearGradient id="wl-g-ck" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><circle cx="22" cy="15" r="11.4" fill="url(#wl-g-ck)"/><circle cx="22" cy="15" r="11.4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16.6 15.4l3.6 3.6 7.4-7.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 26.4 22 30.6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="22" cy="34.6" r="2.3" fill="currentColor"/><circle cx="22" cy="40" r="1.7" fill="currentColor"/><circle cx="22" cy="45" r="1.3" fill="currentColor"/></svg>`,

    // a shelf: the kept thing in the middle, dividers either side
    collection: `<svg viewBox="0 0 44 48" aria-hidden="true"><defs><linearGradient id="wl-g-co" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="15" y="13" width="14" height="22" rx="3.5" fill="url(#wl-g-co)"/><rect x="15" y="13" width="14" height="22" rx="3.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 16v16M35 16v16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M3 20v8M41 20v8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".8"/></svg>`,

  };
  function home(req, res, me) {
    // The two desktop frames: webp at two widths beside the jpeg, light and
    // dark chosen by the member's setting or the system; the first is the
    // page's largest image and loads eagerly, the second lazily.
    const SIZES = '(max-width: 52rem) 100vw, 60rem';
    const webp = (base, w) => `${base}-1000.webp 1000w, ${base}.webp ${w}w`;
    const shot = (light, dark, alt, w, h, { lazy = false } = {}) => {
      const sk = skinOf(me, req), md = modeOf(me, req), L = lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high" decoding="async"';
      const img = (src) => `<img src="${src}" alt="${alt}" width="${w}" height="${h}"${L}>`;
      const b = (src) => src.replace(/\.jpg$/, '');
      if (sk !== 'modern') return `<picture><source type="image/webp" srcset="${webp(b(dark), w)}" sizes="${SIZES}">${img(dark)}</picture>`;
      if (md === 'light') return `<picture><source type="image/webp" srcset="${webp(b(light), w)}" sizes="${SIZES}">${img(light)}</picture>`;
      if (md === 'dark') return `<picture><source type="image/webp" srcset="${webp(b(dark), w)}" sizes="${SIZES}">${img(dark)}</picture>`;
      return `<picture><source type="image/webp" srcset="${webp(b(light), w)}" sizes="${SIZES}" media="(prefers-color-scheme: light)"><source srcset="${light}" media="(prefers-color-scheme: light)"><source type="image/webp" srcset="${webp(b(dark), w)}" sizes="${SIZES}">${img(dark)}</picture>`;
    };
    const frame = (img, cls = '') => `<div class="shot-wrap ${cls}"><div class="shot-shadow"></div><div class="shot-frame"><div class="shot-chrome"><span></span><span></span><span></span></div>${img}</div></div>`;
    // The example as a timeline of the product's own cards: each record type
    // with its glyph and date block, a conversation as a conversation, and the
    // plan as a plan (stops on a rail).
    const KIND = { 'Note': 'note', 'Travel Mark': 'mark', 'Check-in': 'checkin', 'Itinerary': 'itinerary' };
    const dateBlock = (meta) => { const m = /(\d{1,2}) (March|April|May|June|July|August|September|October|November|December|January|February)/.exec(meta || ''); return m ? `<span class="pub-story-date" aria-hidden="true"><b>${m[2].slice(0, 3)}</b><i>${m[1]}</i></span>` : ''; };
    const tile = (a) => { const k = KIND[a.kind] || 'note'; const stops = k === 'itinerary' ? a.why.split(' → ') : null;
      return `<div class="pub-story-card pub-story-${k}"><span class="pub-story-kind"><span class="pub-story-glyph">${GLYPH[k]}</span><span class="lbl">${esc(a.kind)}</span></span>${dateBlock(a.meta)}<span class="pub-story-title">${esc(a.title)}</span><span class="pub-story-meta">${esc(a.meta)}</span>${stops ? `<ol class="pub-story-stops">${stops.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : `<span class="pub-story-why">${esc(a.why)}</span>`}</div>`; };
    const chat = (c) => `<div class="pub-story-card pub-story-chat"><span class="pub-story-kind"><span class="pub-story-glyph">${aiLogo('other')}</span><span class="lbl">In a conversation</span></span><span class="pub-story-ask">${esc(c.ask)}</span><span class="pub-story-reply">${aiLogo('other')}<span>${esc(c.reply)}</span></span></div>`;
    const short = { note: 'Things worth remembering.', mark: 'Places worth remembering or considering.', checkin: 'The visits you actually made.', collection: 'Records, grouped your way.', itinerary: 'Plans, by day and stop.', warrant: 'What you stand behind.' };
    const body = `
<section class="splash pub-splash pub-splash-plain pub-splash-glass" id="promise" aria-label="Discriminantly">
  <h1 class="splash-h">${esc(C.site.home.h1)}</h1>
  <p class="splash-sub pub-prop-1">${esc(C.site.home.opening)}</p>
  <p class="splash-sub pub-prop-plain">${esc(C.site.home.plain)}</p>
  <p class="pub-splash-acts">${me ? '<a class="btn splash-enter" href="/">Open Discriminantly</a>' : '<a class="btn splash-enter" href="/join">Get started</a>'}<a class="link caps pub-see" href="/how-it-works">See how it works</a></p>
</section>
${frame(shot('/welcome-shot-modern-light.jpg', '/welcome-shot-modern-dark.jpg', 'Discriminantly on the desktop: the All feed, with notes, travel marks and a plan', 2000, 1174))}

<section class="pub-sec pub-keep" id="keep" aria-labelledby="keep-h">
  ${eyebrow('What you save')}
  <h2 class="pub-h2" id="keep-h">${esc(C.site.save.h2)}</h2>
  ${C.site.save.body.map((t) => `<p class="pub-p pub-keep-intro">${esc(t)}</p>`).join('')}
  <p class="pub-p pub-keep-intro pub-keep-capture">${esc(C.site.save.line)}</p>
  <ul class="pub-keep-grid">${C.objects.map((o) => { const pv = C.shots[(C.objectPages[o.key] || {}).shots ? C.objectPages[o.key].shots[0] : '']; return `<li class="pub-keep-item" id="keep-${o.key}"><a class="pub-keep-link" href="${o.href}"><span class="wl-ico pub-keep-ico">${GLYPH[o.key]}</span><span class="pub-keep-name">${esc(o.name)}</span></a><span class="pub-keep-short">${short[o.key]}</span>${pv ? `<span class="pub-keep-preview" aria-hidden="true"><img src="/how/${pv.file}.webp" alt="" width="${pv.w}" height="${pv.h}" loading="lazy" decoding="async"></span>` : ''}</li>`; }).join('')}</ul>
</section>

${sec('useful', 'What you keep becomes useful', 'Save now. Plan later.', `
  <p class="pub-p pub-useful-frame">Capture a place or idea the moment you encounter it. When you are ready to travel, your saves are already there—ready to become an itinerary you can refine, share, and build with others.</p>
  <p class="pub-p pub-useful-frame">You can also start with a destination and a request. Your saved places and notes simply make the plan more personal.</p>
  <p class="pub-illus-label"><span class="lbl">Example: from a few saved things to a Kyoto plan</span> <span class="fine">These records are invented to show how it works.</span></p>
  <ol class="pub-story">${C.demo.beats.map((b, i) => `<li class="pub-story-beat"><div class="pub-story-step"><span class="pub-demo-n">${i + 1}</span><h3 class="pub-h3">${esc(b.step)}</h3></div>${b.app ? tile(b.app) : chat(b.chat)}</li>`).join('')}</ol>`, 'itin-shell pub-shell')}

<section class="pub-sec" id="possible" aria-labelledby="possible-h">
  ${eyebrow('What becomes possible')}
  <h2 class="pub-h2" id="possible-h">Your record gets more useful every time you use it.</h2>
  <ul class="pub-cols2">
    <li><b>Find it again.</b> Search by place, type of thing, or the words you used when you saved it.</li>
    <li><b>See what you have actually done.</b> Check-ins separate the places you considered from the places you visited.</li>
    <li><b>Get recommendations that know you.</b> Ask an AI assistant for ideas grounded in your own saves and experiences.</li>
    <li><b>Turn intentions into plans.</b> Start from scratch, from saved places, or both—and keep the plan in Discriminantly, not buried in a chat.</li>
    <li><b>Make the next trip better.</b> Your past visits give future plans useful context.</li>
  </ul>
</section>

${sec('together', 'Plan together', 'Plan alone. Share when ready. Build together when useful.', `
  <p class="pub-p">Share an itinerary by link, or invite friends to add places, arrange stops, and build the plan with you. Every change is attributed to the person who made it.</p>
  <p class="pub-p">Your notes, visits, and private records stay yours. If a private place enters a shared plan, Discriminantly asks before revealing its details.</p>
  ${frame(shot('/welcome-shot-itin-light.jpg', '/welcome-shot-itin-dark.jpg', 'An itinerary in Discriminantly, with its map and the travel marks near it', 1920, 1000, { lazy: true }), 'splash-shot-2 pub-frame-2')}`, 'itin-shell pub-shell')}

${sec('ai', 'Use it with AI', 'Use the AI assistant you already have.', `
  <p class="pub-p">Connect ChatGPT, Claude, or another compatible assistant to save, recommend, and plan without starting from a blank chat. Your Discriminantly record gives the assistant context; you decide what it can access.</p>
  <p class="pub-p">Revoke access at any time, and see exactly what each assistant changed.</p>
  <div class="pub-plats pub-plats-compact">${C.platforms.map((p) => `<a class="pub-plat-row" href="${esc(p.guide)}">${aiLogo(p.key)}<span class="pub-plat-row-name">${esc(p.name)}</span><span class="pub-plat-row-status">${esc(p.availability)}${p.review ? ' · ' + esc(p.review) : ''}</span><span class="pub-plat-row-how">${esc(p.method)} · ${esc(p.auth)}</span></a>`).join('')}</div>`)}


<section class="pub-sec pub-final" id="start" aria-label="Get started">
  ${eyebrow('Ready when you are.')}
  <p class="pub-trust pub-final-lead">Save what catches your eye today. When you are ready to go, turn it into a plan you can share, refine, and build with others.</p>
  <p class="pub-trust" id="trust">Private or public, record by record. You choose which AI assistants have access—and can revoke them at any time.</p>
  <p class="pub-final-acts">${cta(me)}</p>
  <p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a><span aria-hidden="true"> · </span><a class="link caps" href="/ai">Use with AI</a></p>
</section>`;
    return page(res, me, req, { path: '/', title: 'Welcome', fullTitle: 'Discriminantly — Your interests, travels and plans', description: C.site.description, body, home: true, cls: 'is-pub-home', card: '/card/site.png',
      ld: [{ '@type': 'SoftwareApplication', name: C.site.name, url: PUBLIC_ORIGIN + '/', applicationCategory: 'LifestyleApplication', operatingSystem: 'Web', description: C.site.opening, publisher: { '@id': PUBLIC_ORIGIN + '/#org' }, featureList: C.objects.map((o) => o.name).join(', ') }] });
  }

  // ---- 2. How it works --------------------------------------------------------
  // Each step carries a visual: a view cropped from the application's own
  // screenshots where one exists, otherwise an illustrative tile.
  function howItWorks(req, res, me) {
    const sk = skinOf(me, req), md = modeOf(me, req);
    const cap = (n) => esc((C.steps.find((s) => s.n === n) || {}).caption || 'From the application');
    const shot = (name, alt, w, h, n) => {
      const L = `/how/${name}-light.jpg`, D = `/how/${name}-dark.jpg`;
      const img = sk !== 'modern' ? `<img src="${D}" alt="${alt}" width="${w}" height="${h}" loading="lazy">` : md === 'light' ? `<img src="${L}" alt="${alt}" width="${w}" height="${h}" loading="lazy">` : md === 'dark' ? `<img src="${D}" alt="${alt}" width="${w}" height="${h}" loading="lazy">` : `<picture><source srcset="${L}" media="(prefers-color-scheme: light)"><img src="${D}" alt="${alt}" width="${w}" height="${h}" loading="lazy"></picture>`;
      return `<figure class="pub-shot"><div class="pub-shot-frame">${img}</div><figcaption class="welcome-caption pub-step-cap">${n ? cap(n) : 'From the application'}</figcaption></figure>`;
    };
    const tile = (kind, title, meta, lines) => `<figure class="pub-shot pub-shot-tile"><div class="pub-demo-tile pub-demo-app"><span class="lbl">${kind}</span><span class="pub-demo-title">${title}</span><span class="pub-demo-meta">${meta}</span>${lines.map((l) => `<span class="pub-demo-why">${l}</span>`).join('')}</div><figcaption class="welcome-caption">Illustrative example</figcaption></figure>`;
    const visuals = {
      1: shot('notice', 'A note: a pour-over kettle, with the member’s reason for saving it, its tags and a link', 630, 615, 1),
      2: `<figure class="pub-shot pub-shot-phone pub-shot-app"><span class="phone-body"><span class="phone-shadow"></span><span class="phone"><span class="phone-notch"></span><picture><source type="image/webp" srcset="/how/phone-travel-mark-private.webp"><img src="/how/phone-travel-mark-private.jpg" alt="${esc(C.shots['travel-mark-private'].alt)}" width="720" height="1247" loading="lazy" decoding="async"></picture></span></span><figcaption class="welcome-caption pub-step-cap">${cap(2)}</figcaption></figure>`,
      3: shot('experience', 'A check-in on that mark: the date, and what the member said about the visit', 465, 280, 3),
      4: shot('organize', 'A row of collections, each with its count: bass fishing, coffee, culinary, fly fishing, fragrance, golf', 1450, 190, 4),
      5: shot('compose', 'An itinerary, Osaka and Kyoto in June: Day 1 and its first stop', 620, 610, 5),
      6: shot('together', 'The same plan’s map, every stop pinned', 710, 700, 6),
      7: `<figure class="pub-shot pub-shot-phone"><span class="phone-body"><span class="phone-shadow"></span><span class="phone"><span class="phone-notch"></span><img src="/how/ai.jpg" alt="A trip planned in a conversation with an AI, from places saved in Discriminantly" width="900" height="1150" loading="lazy"></span></span><figcaption class="welcome-caption pub-step-cap">${cap(7)}</figcaption></figure>`,
    };
    const body = `
<section class="pub-sec pub-shell-plain" id="progression" aria-label="The progression">
  <ol class="pub-prog pub-prog-visual">${C.steps.map((s) => `<li class="pub-prog-step itin-shell pub-shell" id="step-${s.n}"><div class="pub-prog-text"><div class="pub-prog-head"><span class="pub-demo-n">${s.n}</span><span class="pub-prog-verb">${esc(s.verb)}</span></div><h2 class="pub-h3 pub-prog-title">${esc(s.title)}</h2>${paras(s.body)}</div><div class="pub-prog-visual-col">${visuals[s.n]}</div></li>`).join('')}</ol>
</section>
${sec('names', 'The names', 'The six kinds of records.', `<dl class="pub-objects pub-objects-brief">${C.objects.map((o) => { const r = C.records.find((x) => x.key === o.key); return `<div class="pub-object"><dt><a href="${o.href}">${esc(o.key === 'mark' ? 'Places' : o.name)}</a></dt><dd>${esc(r.what)} <span class="pub-object-not">${esc(r.not)}</span>${r.rule ? `<span class="pub-object-rule">${esc(r.rule)}</span>` : ''}</dd></div>`; }).join('')}</dl>`)}
<section class="pub-sec" id="evidence" aria-labelledby="evidence-h">
  ${eyebrow('Evidence and control')}
  <h2 class="pub-h2" id="evidence-h">You stay in control.</h2>
  <ul class="pub-cols2 pub-ctrl">${C.control.items.map(([h, t], i) => `<li${i === C.control.items.length - 1 ? ' class="pub-ctrl-wide"' : ''}><b>${esc(h)}</b>${t ? ' ' + esc(t) : ''}</li>`).join('')}</ul>
</section>
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/ai">Use with AI</a></p></section>`;
    return page(res, me, req, { path: '/how-it-works', title: 'How Discriminantly works',
      description: 'Save the places and things you notice, remember where you’ve been, and turn it all into trips you can share or plan with friends. Seven steps, the six kinds of records, and how you stay in control.',
      h1: 'How Discriminantly works', lede: `${C.howItWorks.lede} ${C.howItWorks.start}`, body, hero: 'itinerary-phoenix',
      card: '/card/page/how-it-works.png', crumbs: [HOME_CRUMB, { name: 'How it works', href: '/how-it-works' }],
      ld: [{ '@type': 'HowTo', name: 'How Discriminantly works', description: `${C.howItWorks.lede} ${C.howItWorks.start}`, step: C.steps.map((st) => ({ '@type': 'HowToStep', position: st.n, name: `${st.verb}: ${st.title}`, text: st.body.replace(/\*\*/g, '').replace(/\n\n+/g, ' '), url: PUBLIC_ORIGIN + '/how-it-works#step-' + st.n })) }] });
  }

  // ---- 3. Travel Marks (the object-page template) -----------------------------
  function travelMarks(req, res, me) {
    const o = C.objects.find((x) => x.key === 'mark');
    const body = `
${sec('what', 'What it is', 'A place you want to remember.', `<p class="pub-p">${esc(o.what)}</p><p class="pub-p">People save marks for places they mean to go, places they went, places someone mentioned, and places they would send a friend. A mark can be saved long before any visit, or with no visit at all.</p>`)}
${sec('checkin', 'Mark and Check-in', 'The mark is the place. The check-in is the visit.', `<p class="pub-p">A travel mark says a place is worth remembering. A check-in says you were there, on a date or for a stay, with anything you want to say about it. Discriminantly never turns a mark into a visit on its own, and never infers a visit from a plan or a mention. ${esc(o.not)}</p>`)}
${sec('belongs', 'Where a mark can sit', 'Collections and itineraries.', `<p class="pub-p">A mark can belong to any number of collections, and can be a stop in any number of itineraries. Adding a place to a plan keeps it as a mark if it was not one already. Removing a stop from a plan leaves the mark where it is.</p>`)}
${sec('ai', 'With an authorized AI', 'Retrieved, and added, when you ask.', `<p class="pub-p">A connected assistant can find your marks, by place, city or the words you used, and can save a new one when you ask it to. It is asked to look the place up first, so a mark carries a real address and map position rather than a guess. Every mark an assistant adds is recorded as that assistant acting for you.</p>`)}
${sec('privacy', 'Private or public', 'Your choice, per mark.', `<p class="pub-p">A mark is visible to other members unless you mark it private. A private mark is seen only by you and by assistants you have connected. Check-ins follow the privacy of the mark they belong to. If a private mark is added as a stop in a plan you share, the place details in that plan (its name and address) may become visible to collaborators, after you confirm. The mark itself, your reason for saving it, your check-ins and the rest of your record stay private.</p>`)}
${sec('shots', 'In the application', 'From members’ own records, on a phone.', phoneRow(['new-travel-mark', 'travel-mark-map-checkin']), 'itin-shell pub-shell')}
${sec('enrich', 'Enrichment and experience', 'What was looked up, and what you said.', `<p class="pub-p">A mark’s address and map position may be looked up for you, and are recorded as looked up. Your reason for saving it, and your check-ins, are yours and are recorded as yours. The two are held apart, so a researched fact is never presented as your experience.</p>`)}
${sec('example', 'An example', 'What a travel mark looks like.', `${illus}
  <div class="pub-demo-tile pub-demo-app pub-example"><span class="lbl">Travel Mark</span><span class="pub-demo-title">Kissa Hoshikawa</span><span class="pub-demo-meta">Kyoto, Japan · kept 5 March · address and map position looked up</span><span class="pub-demo-why">A kissaten with a long counter. Siphon coffee.</span><span class="pub-demo-meta">1 check-in: visited 6 March. In the collection “Kyoto”. A stop in “Kyoto, two slow days”.</span></div>`, 'itin-shell pub-shell')}
${sec('not', 'What a mark proves, and does not', 'Saving is not going.', proofCards(['A mark proves a place was worth saving, as you put it.', 'A mark does not prove you visited. A check-in does.', 'A mark does not prove you recommend the place. A warrant does.', 'A mark in a plan does not prove the plan happened.', 'A looked-up address is a fact about the place, not a statement by you.']))}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a></p></section>`;
    return page(res, me, req, { path: '/travel-marks', title: 'Travel Marks',
      description: 'A travel mark is a place worth remembering in Discriminantly: what it is, how it differs from a check-in, how it sits in collections and itineraries, and what it does not prove.',
      h1: 'Travel Marks', glyph: GLYPH.mark, lede: 'A place worth remembering, saved with its name and where it is. Not yet a visit.', body, hero: 'travel-mark-private',
      card: '/card/page/travel-marks.png', crumbs: [HOME_CRUMB, { name: 'What you save', href: '/how-it-works#names' }, { name: 'Travel Marks', href: '/travel-marks' }],
      ld: [{ '@type': 'DefinedTerm', name: 'Travel Mark', description: o.what, url: PUBLIC_ORIGIN + '/travel-marks', inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'Discriminantly records', url: PUBLIC_ORIGIN + '/how-it-works#names' } }, ...shotsLd(['new-travel-mark', 'travel-mark-map-checkin'])] });
  }

  // ---- 4. Use with AI hub -----------------------------------------------------
  // The hub routes; it does not repeat the steps. Each platform has its own page.
  function aiHub(req, res, me) {
    const sk = skinOf(me, req), md = modeOf(me, req);
    const pick = (light, dark, alt) => sk !== 'modern' ? `<img src="${dark}" alt="${alt}" width="1920" height="1000" loading="lazy">`
      : md === 'light' ? `<img src="${light}" alt="${alt}" width="1920" height="1000" loading="lazy">`
      : md === 'dark' ? `<img src="${dark}" alt="${alt}" width="1920" height="1000" loading="lazy">`
      : `<picture><source srcset="${light}" media="(prefers-color-scheme: light)"><img src="${dark}" alt="${alt}" width="1920" height="1000" loading="lazy"></picture>`;
    const phone = (img, cap) => `<figure class="phone-wrap"><span class="phone-body"><span class="phone-shadow"></span><span class="phone"><span class="phone-notch"></span>${img}</span></span><figcaption class="welcome-caption">${cap}</figcaption></figure>`;
    const pick9 = (light, dark, alt) => sk !== 'modern' ? `<img src="${dark}" alt="${alt}" width="900" height="1845" loading="lazy">`
      : md === 'light' ? `<img src="${light}" alt="${alt}" width="900" height="1845" loading="lazy">`
      : md === 'dark' ? `<img src="${dark}" alt="${alt}" width="900" height="1845" loading="lazy">`
      : `<picture><source srcset="${light}" media="(prefers-color-scheme: light)"><img src="${dark}" alt="${alt}" width="900" height="1845" loading="lazy"></picture>`;
    const pair1 = `<div class="phones">${phone(pick9('/welcome-phone-profile-light.jpg', '/welcome-phone-profile-dark.jpg', 'A Discriminantly profile: the member’s notes, travel marks and plans'), 'Your record, in Discriminantly')}${phone(`<img src="/welcome-phone-ask.jpg" alt="Asking an AI to plan a trip from what is saved in Discriminantly" width="900" height="1845" loading="lazy">`, 'Asked for, in a conversation')}</div>`;
    const pair2 = `<div class="phones">${phone(`<img src="/welcome-phone-chat.jpg" alt="A trip planned in a conversation with an AI" width="900" height="1845" loading="lazy">`, 'Planned in conversation')}${phone(pick9('/welcome-phone-app-light.jpg', '/welcome-phone-app-dark.jpg', 'The same day as an itinerary in Discriminantly'), 'Saved in Discriminantly')}</div>`;
    const body = `
<section class="pub-sec pub-start-note" id="no-record-needed" aria-labelledby="no-record-needed-h">
  ${eyebrow('Starting out')}
  <h2 class="pub-h2" id="no-record-needed-h">Start with a question.</h2>
  <p class="pub-p">You don’t need anything saved to begin.</p>
  <p class="pub-p">Ask your connected assistant for restaurant ideas in Kyoto, a weekend plan in Montreal, or a trip built around a few things you like. It can recommend places and arrange them into a plan—even before you’ve saved anything.</p>
</section>
${sec('personal', 'Over time', 'Your record makes plans more personal.', `
  <p class="pub-p">As you save places, things, and check-ins, Discriminantly builds a record of what you’ve noticed and where you’ve been.</p>
  <p class="pub-p">When you ask for help, your assistant can use that record to make suggestions that fit you better. A plan can use places you’ve already saved, introduce new ideas, or combine both.</p>
  <p class="pub-p">A recommendation is still just a recommendation until you decide to save it.</p>`)}
<section class="pub-sec itin-shell pub-shell splash-pair" id="useful" aria-labelledby="useful-h">
  <p class="splash-pair-lead" id="useful-h">What you save becomes useful.</p>
  ${pair1}
  <p class="splash-pair-lead splash-pair-lead-2">Plan naturally.</p>
  ${pair2}
</section>
${sec('stays', 'Not tied to one AI', 'Your record stays in Discriminantly.', `
  <p class="pub-p">Conversations and planning can happen in the assistant you connect. Discriminantly holds the things you save, the trips you build, and where each came from.</p>
  <p class="pub-p">Because your record isn’t tied to one AI assistant, you can connect compatible assistants to the same Discriminantly account. ChatGPT, Claude, Muse, and other compatible assistants can work with your record—but none of them owns it.</p>`)}
${sec('can-do', 'Once connected', 'What the assistant can do.', `
  <p class="pub-p">Once you authorize an assistant, it can:</p>
  <ul class="pub-list pub-list-left">
    <li>Recommend places and things based on what you ask for.</li>
    <li>Build a trip from a destination, interests, and constraints.</li>
    <li>Use your saved places and notes to make suggestions more personal.</li>
    <li>Add places, notes, or plans to Discriminantly when you ask it to.</li>
  </ul>
  <p class="pub-p">Anything an assistant adds shows up in Discriminantly as a change made by that assistant on your behalf.</p>`)}
${sec('control', 'Your say', 'You stay in control.', `
  <ul class="pub-list pub-list-left">
    <li>Connect or disconnect an assistant whenever you want.</li>
    <li>Choose which assistants can access your account.</li>
    <li>See what it added or changed.</li>
    <li>Keep your private notes, check-ins, and records private.</li>
    <li>Decide whether a private place becomes visible in a shared trip.</li>
  </ul>
  <p class="fine pub-fine">Installation, sign-in, approvals, and what each model can do vary by platform. Each assistant has its own page with instructions and expectations.</p>`)}
<section class="pub-sec" id="faq" aria-labelledby="faq-h">${eyebrow('Questions')}<h2 class="pub-h2" id="faq-h">Questions.</h2>
  <dl class="pub-faq">${C.faq.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${paras(a)}</dd></div>`).join('')}</dl>
</section>
<section class="pub-sec itin-shell pub-shell" id="platforms" aria-labelledby="platforms-h">${eyebrow('Platforms')}<h2 class="pub-h2" id="platforms-h">Choose your assistant.</h2>
  <p class="pub-p pub-p-center">Each assistant has its own page: how to connect it, what to expect, and where it stands.</p>
  <div class="pub-ai-chips">${C.platforms.map((p) => `<a class="pub-ai-chip" id="${p.key}" href="${esc(p.guide)}">${aiLogo(p.key)}<span class="pub-ai-chip-name">${esc(p.name)}</span><span class="pub-ai-chip-status">${esc(p.chip || p.availability)}</span><span class="pub-ai-chip-go caps">Guide →</span></a>`).join('')}</div>
</section>
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a></p></section>`;
    return page(res, me, req, { path: '/ai', title: 'Use with AI',
      description: 'Connect the AI assistant you already use—ChatGPT, Claude, Muse or another compatible one—and it can help you find places, make recommendations, and build trips. You can start with an empty account.',
      h1: 'Use Discriminantly with AI', lede: 'Your saved places and things stay in Discriminantly. Connect the AI assistant you already use, and it can help you find places, make recommendations, and build trips. You can start with an empty account. Ask for a plan for a destination, a type of trip, or a set of interests. As you save more, your own places and notes help future suggestions feel more personal.', body,
      card: '/card/page/ai.png', crumbs: [HOME_CRUMB, { name: 'Use with AI', href: '/ai' }], hero: 'settings-connect',
      ld: [{ '@type': 'FAQPage', '@id': PUBLIC_ORIGIN + '/ai#faq', mainEntity: C.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/\n\n+/g, ' ') } })) }, { '@type': 'ItemList', name: 'AI clients', itemListElement: C.platforms.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: PUBLIC_ORIGIN + p.guide, description: `${p.availability}. ${p.method}. ${p.auth}. ${p.directory}.` })) }] });
  }

  // ---- 5. Platform pages (one template; Muse carries the extra facts) ---------
  const PLATFORM_PATH = { chatgpt: '/ai/chatgpt', claude: '/ai/claude', muse: '/ai/muse', other: '/ai/other' };
  function platformPage(key) {
    return (req, res, me) => {
      const p = C.platforms.find((x) => x.key === key);
      const facts = [
        `<div><dt>Connection</dt><dd>${esc(p.method)}</dd></div>`,
        `<div><dt>Authentication</dt><dd>${esc(p.auth)}</dd></div>`,
        key === 'muse' ? `<div><dt>Key creation</dt><dd>Discriminantly \u2192 Settings \u203a Connect to your AI \u2192 name the connection <b>Muse</b> \u2192 Create a connection</dd></div><div><dt>OAuth</dt><dd>Not supported for this route</dd></div>` : '',
        p.reviewDetail ? `<div><dt>Status on the Muse platform</dt><dd>${esc(p.reviewDetail)}</dd></div>` : '',
        p.basis ? `<div><dt>Verification</dt><dd>${esc(p.basis)}</dd></div>` : '',
        `<div><dt>Availability</dt><dd><span class="pub-status${/^live/i.test(p.availability) ? ' is-live' : ''}">${esc(p.availability)}</span></dd></div>`,
        `<div><dt>Directory</dt><dd>${esc(p.directory)}</dd></div>`,
        p.endpoint ? `<div><dt>Endpoint</dt><dd><code class="pub-code">${esc(p.endpoint)}</code> <span class="fine">(no trailing slash)</span></dd></div>` : key === 'chatgpt' ? (PLUGIN() ? `<div><dt>Plugin page</dt><dd><a class="link caps" href="${esc(PLUGIN())}" rel="noopener">Open in ChatGPT ↗</a></dd></div>` : '') : (key !== 'muse' ? `<div><dt>Address</dt><dd><code class="pub-code">https://www.discriminantly.com/mcp</code></dd></div>` : ''),
      ].join('');
      const body = `
<section class="pub-sec itin-shell pub-shell pub-guide-head" id="facts" aria-labelledby="facts-h">
  <div class="pub-plate">
    <div class="pub-plate-head">
      <div class="pub-guide-mark">${aiLogo(key)}</div>
      <div class="pub-plate-id"><p class="pub-plate-eyebrow"><span class="lbl">${esc(p.badge || p.method)}</span>${p.review ? `<span class="lbl pub-plate-review">${esc(p.review)}</span>` : ''}</p><h2 class="pub-h2 pub-plate-name" id="facts-h">${esc(p.name)}</h2></div>
    </div>
    <dl class="pub-facts pub-facts-wide pub-ledger">${facts}</dl>
  </div>
</section>
${sec('setup', 'Setup', `${p.steps.length} steps.`, `${stepsList(p.steps.map((t, i) => key === 'chatgpt' && i === 0 && PLUGIN() ? `Open the <a href="${esc(PLUGIN())}" rel="noopener">Discriminantly plugin’s page in ChatGPT</a> and choose Install plugin.` : esc(t)))}${key === 'chatgpt' && PLUGIN() ? `<p class="center"><a class="btn3d" href="${esc(PLUGIN())}" rel="noopener">Open in ChatGPT</a></p>` : ''}${p.note ? `<p class="fine pub-fine">${esc(p.note)}</p>` : ''}${key === 'muse' ? settingsShot(req, me) : ''}`)}
${p.asks ? sec('ask', 'What you can ask', 'Start from a request, use your record, save what matters.', `<p class="pub-p">An empty account can begin with recommendations and planning; it simply has no records of yours to contribute yet. As you save things, requests can draw on them.</p><dl class="pub-asks">${p.asks.map(([h, t]) => `<div><dt>${esc(h)}</dt><dd><blockquote class="pub-quote pub-quote-ask"><span class="pub-quote-mark">${aiLogo(p.key)}</span><p>${esc(t)}</p></blockquote></dd></div>`).join('')}</dl><p class="fine pub-fine">Suggested places stay recommendations until you keep them. A plan is not a record of going.${p.asksNote ? ' ' + esc(p.asksNote) : ''}</p>`) : ''}
${p.verify ? sec('verify', 'Verify it', 'Ask for something that changes nothing.', `<p class="pub-p">Once ${key === 'chatgpt' ? 'the plugin is connected' : 'the connector is in place'}, send ${esc(p.name)} this:</p><blockquote class="pub-quote"><p>${esc(p.verify)}</p></blockquote>${p.verifyExpect ? `<h3 class="pub-h3">What you should see</h3><p class="pub-p">${esc(p.verifyExpect)}</p><h3 class="pub-h3">If access is refused or nothing comes back</h3><ul class="pub-list">${p.trouble.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><h3 class="pub-h3">Disconnecting</h3><p class="pub-p">${esc(p.revoke)}</p>` : `<p class="pub-p">${esc(p.name)} should list the travel marks you have saved, and nothing in your account should change. If it is refused, the key is missing, mistyped or revoked: make a new one in Settings.</p>`}${p.lastTested ? `<p class="pub-tested"><span class="lbl">Last tested</span> <time>${esc(p.lastTested)}</time>, by ${esc(p.lastTestedBy || 'Discriminantly')}: ${esc(p.lastTestedBasis)}.</p>` : ''}${p.reviewNote ? `<p class="fine pub-fine">${esc(p.reviewNote)}</p>` : ''}`) : ''}
${key === 'muse' ? sec('keys', 'About the key', 'A credential you control.', `<ul class="pub-list"><li>The key is shown once when it is made and stored only in hashed form.</li><li>Each connection has its own key. Revoking one in Settings takes effect immediately and leaves the others working.</li><li>A <b>read-only</b> key lets Muse look things up but refuses anything that would change your record.</li><li>Everything Muse adds is recorded as Muse acting for you, and shows up in Discriminantly like anything else.</li></ul>`) : sec('after', 'Once connected', 'The same record, from either side.', `<ul class="pub-list"><li>${p.provenance ? esc(p.provenance) : `What ${esc(p.name)} adds appears in Discriminantly, recorded as ${esc(p.name)} acting for you.`}</li><li>You can disconnect at any time in Settings \u203a Connect to your AI. Access ends immediately; nothing is deleted.</li><li>Private records stay private: only you and the assistants you have connected can see them. The one disclosed exception is a private travel mark used as a stop in a plan you share, whose name and address may appear to collaborators after you confirm.</li></ul>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/ai">All platforms</a></p></section>`;
      const titles = { chatgpt: 'Use Discriminantly with ChatGPT', claude: 'Use Discriminantly with Claude', muse: 'Use Discriminantly with Muse', other: 'Use Discriminantly with another AI assistant' };
      const descs = {
        chatgpt: 'Install the Discriminantly plugin in ChatGPT, connect it by signing in, and ask. The facts, the steps and what happens once connected.',
        claude: 'Add Discriminantly to Claude as a custom connector with sign-in: the address, the steps and what happens once connected.',
        muse: 'Connect Meta\u2019s Muse to Discriminantly as a custom connector with an API key: the endpoint, how to make a key in Settings, the setup steps and a prompt to verify the connection.',
        other: 'Add Discriminantly to any AI client that supports a remote MCP server with sign-in. Compatibility varies and must be verified.' };
      const ledes = { chatgpt: 'A plugin in ChatGPT\u2019s directory, connected by signing in to Discriminantly.', claude: 'A custom connector, connected by signing in to Discriminantly.', muse: 'A custom connector, authenticated with a key you make in Discriminantly\u2019s Settings.', other: 'A remote MCP server with sign-in. Whether a given client works is something to test.' };
      return page(res, me, req, { path: PLATFORM_PATH[key], title: titles[key], description: descs[key], h1: titles[key], lede: ledes[key], body, hero: key === 'chatgpt' ? 'chat-plan' : 'settings-connect',
        card: `/card/page/${key}.png`, crumbs: [HOME_CRUMB, { name: 'Use with AI', href: '/ai' }, { name: p.name, href: PLATFORM_PATH[key] }],
        ld: [{ '@type': 'HowTo', name: titles[key], description: descs[key], step: p.steps.map((t, i) => ({ '@type': 'HowToStep', position: i + 1, text: t })) }] });
    };
  }
  const muse = platformPage('muse'), chatgpt = platformPage('chatgpt'), claude = platformPage('claude'), other = platformPage('other');

  // ---- 6. Guides: an index, and one page per task ------------------------------
  function guides(req, res, me) {
    const body = `${sec('list', 'Guides', 'Things you do in Discriminantly.', `<ul class="pub-list pub-guides">${C.guides.map((g) => `<li><a href="/guides/${g.slug}">${esc(g.title)}</a> — ${esc(g.q)}</li>`).join('')}</ul>`)}
${sec('records', 'The records', 'What each kind of record means.', `<ul class="pub-list pub-guides">${C.objects.map((o) => `<li><a href="${o.href}">${esc(o.name)}</a> — ${esc(o.what)}</li>`).join('')}</ul>`)}`;
    return page(res, me, req, { path: '/guides', title: 'Guides', description: 'Guides to working in Discriminantly: save objects and interests, remember places without claiming a visit, plan a trip from what you have saved, share or build an itinerary together, connect an AI assistant.', h1: 'Guides', lede: 'Short, plain guides to the things you do here, each answering one question.', body,
      card: '/card/page/guides.png', crumbs: [HOME_CRUMB, { name: 'Guides', href: '/guides' }], hero: 'new-note',
      ld: [{ '@type': 'ItemList', name: 'Guides', itemListElement: C.guides.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, url: PUBLIC_ORIGIN + '/guides/' + g.slug })) }] });
  }
  function guide(slug) {
    const g = C.guides.find((x) => x.slug === slug); if (!g) return null;
    return (req, res, me) => {
      const body = `
${sec('answer', 'The short answer', esc(g.q), `<p class="pub-p pub-answer">${esc(g.answer)}</p>`, 'itin-shell pub-shell')}
<nav class="pub-guide-rail" aria-label="On this page"><p class="lbl">On this page</p><ol>${[['answer', 'The short answer'], ...g.sections.map(([h], i) => ['s' + (i + 1), h]), ...(g.shots && g.shots.length > 1 ? [['shots', 'In the application']] : []), ...(g.example ? [['example', 'An example']] : []), ['more', 'Related']].map(([id, h]) => `<li><a href="#${id}">${esc(h)}</a></li>`).join('')}</ol></nav>
${g.slug === 'connect-an-ai-assistant' ? settingsShot(req, me) : ''}
${g.sections.map(([h, t], i) => sec('s' + (i + 1), '', esc(h), `<p class="pub-p">${esc(t)}</p>`)).join('')}
${g.shots && g.shots.length > 1 ? sec('shots', 'In the application', 'What it looks like on a phone.', phoneRow(g.shots.slice(1)), 'itin-shell pub-shell') : ''}
${g.example ? sec('example', 'An example', 'What it looks like.', `${illus}<div class="pub-demo-tile pub-demo-app pub-example"><span class="lbl">${esc(g.example.kind)}</span><span class="pub-demo-title">${esc(g.example.title)}</span><span class="pub-demo-meta">${esc(g.example.meta)}</span><span class="pub-demo-why">${esc(g.example.why)}</span></div>`, 'itin-shell pub-shell') : ''}
${sec('more', 'Related', 'Where to read on.', `<ul class="pub-list pub-guides">${g.links.map(([h, l]) => `<li><a href="${esc(h)}">${esc(l)}</a></li>`).join('')}</ul>`)}
<p class="fine pub-fine pub-updated">Last updated <time datetime="${esc(updatedOn('/guides/' + g.slug))}">${esc(longDate(updatedOn('/guides/' + g.slug)))}</time>.</p>
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/guides">All guides</a></p></section>`;
      return page(res, me, req, { path: '/guides/' + g.slug, title: g.title, description: g.desc || metaDesc(g.answer), h1: g.title, lede: g.q, body, hero: g.shots && g.shots[0],
        card: `/card/page/guide-${g.slug}.png`, crumbs: [HOME_CRUMB, { name: 'Guides', href: '/guides' }, { name: g.title, href: '/guides/' + g.slug }],
        ld: [{ '@type': 'Article', '@id': PUBLIC_ORIGIN + '/guides/' + g.slug + '#article', headline: g.title, description: g.desc || metaDesc(g.answer), author: { '@id': PUBLIC_ORIGIN + '/#org' }, publisher: { '@id': PUBLIC_ORIGIN + '/#org' }, mainEntityOfPage: PUBLIC_ORIGIN + '/guides/' + g.slug },
             { '@type': 'Question', name: g.q, acceptedAnswer: { '@type': 'Answer', text: g.answer }, url: PUBLIC_ORIGIN + '/guides/' + g.slug + '#answer' }, ...shotsLd((g.shots || []).slice(1))] });
    };
  }
  const metaDesc = (t) => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length <= 158 ? x : x.slice(0, 157).replace(/\s+\S*$/, '') + '\u2026'; };

  // ---- 6b. First-class record pages (Travel Marks keeps its own) --------------
  function objectPage(key) {
    const o = C.objects.find((x) => x.key === key), d = C.objectPages[key]; if (!o || !d) return null;
    return (req, res, me) => {
      const body = `
${sec('what', 'What it is', esc(o.plain) + '.', `<p class="pub-p">${esc(o.what)}</p>`)}
${sec('asserts', 'What keeping one asserts', 'Exactly this.', `<p class="pub-p">${esc(d.asserts)}</p>`)}
${sec('not', 'What it does not assert', 'And never implies.', `<p class="pub-p">${esc(d.not)}</p>`)}
${sec('relates', 'How it relates to the others', 'Separate records, separate meanings.', `<p class="pub-p">${esc(d.relates)}</p>`)}
${sec('appears', 'Where it appears', 'In the application.', `<p class="pub-p">${esc(d.appears)}</p>`)}
${d.shots && d.shots.length > 1 ? sec('shots', 'In the application', 'From the member’s own record, on a phone.', phoneRow(d.shots.slice(1)), 'itin-shell pub-shell') : ''}
${sec('ai', 'With an authorized AI', 'Retrieved, and added, when you ask.', `<p class="pub-p">${esc(d.ai)}</p>`)}
${sec('privacy', 'Privacy and provenance', 'Per record.', `<p class="pub-p">${esc(d.privacy)}</p>`)}
${sec('example', 'An example', `What a ${esc(o.one.toLowerCase())} looks like.`, `${illus}<div class="pub-demo-tile pub-demo-app pub-example"><span class="lbl">${esc(d.example.kind)}</span><span class="pub-demo-title">${esc(d.example.title)}</span><span class="pub-demo-meta">${esc(d.example.meta)}</span><span class="pub-demo-why">${esc(d.example.why)}</span></div>`, 'itin-shell pub-shell')}
${sec('proves', `What a ${esc(o.one.toLowerCase())} proves, and does not`, 'Plainly.', proofCards(d.proves))}
${sec('others', 'The other records', 'Each with its own page.', `<ul class="pub-list pub-guides">${C.objects.filter((x) => x.key !== key).map((x) => `<li><a href="${x.href}">${esc(x.name)}</a> — ${esc(x.plain)}</li>`).join('')}</ul>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a></p></section>`;
      return page(res, me, req, { path: d.path, title: o.name, description: d.desc || metaDesc(`${o.what} ${o.not}`), h1: o.name, glyph: GLYPH[key], lede: d.lede, body, hero: d.shots && d.shots[0],
        card: `/card/page/${d.path.slice(1)}.png`, crumbs: [HOME_CRUMB, { name: 'What you save', href: '/how-it-works#names' }, { name: o.name, href: d.path }],
        ld: [{ '@type': 'DefinedTerm', name: o.one, description: o.what, url: PUBLIC_ORIGIN + d.path, inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'Discriminantly records', url: PUBLIC_ORIGIN + '/how-it-works#names' } }, ...shotsLd((d.shots || []).slice(1))] });
    };
  }

  // ---- 6c. Agent guidance --------------------------------------------------------
  const GUIDANCE = () => [
    ['About Discriminantly', `${C.site.identityFormal} ${C.site.architecture}`],
    ['Reading grants nothing', 'Reading this site, llms.txt or this page grants no access to any member’s record. Every record described here is the member’s, and reaching it requires that member’s own authorized connection.'],
    ['Authorized access', `Clients reach a member’s record only through a connection the member made: by signing in and approving (ChatGPT, Claude and other MCP clients, at ${PUBLIC_ORIGIN}/mcp) or by a key the member created in Settings (Muse, at https://muse.discriminantly.com/mcp). Which method applies, and how to set it up, is on each platform’s page under ${PUBLIC_ORIGIN}/ai. The member can revoke any connection at any time; a revoked connection stops working immediately.`],
    ['The six records and their non-implications', C.objects.map((o) => `${o.name}: ${o.what} ${o.not}`).join(' ')],
    ['Starting with an empty record', 'A member does not need any saved records to receive recommendations or a plan. An authorized client can recommend places and build an itinerary from a destination, interests and constraints. Where relevant records exist, retrieve them to sharpen the result; do not claim the member has kept, visited or endorsed anything they have not recorded.'],
    ['Recommendation versus adoption', 'A recommendation an assistant makes is recorded as a recommendation and stays one until the member keeps it. Keeping is the member’s act. A dismissed recommendation is not a dislike. Nothing a client proposes becomes a kept, visited, owned or endorsed record without the member’s say-so.'],
    ['Provenance and actor identity', 'Every change records who made it: the member on the web, or a connected client acting for the member. The client’s identity comes from the connection and, where the client declares a name when it connects, from that declaration; a client that declares none is recorded as the member’s AI without a name. Looked-up facts (a place’s address and map position) are recorded as looked up, apart from anything the member wrote.'],
    ['Privacy, visibility and revocation', `Notes and travel marks are public unless the member makes them private; check-ins follow their mark; itineraries start private. A private record is visible to the member and to clients the member has connected, with one disclosed exception: ${C.together.disclosureAgent} Revoking a connection ends access and deletes nothing.`],
    ['Collaboration', 'Shared itineraries are the only place members work on the same record. Shared-plan edits are attributed to the person who made them and are not evidence of anyone’s taste.'],
    ['Boundaries', C.boundaries.join(' ')],
    ['Policies', `Privacy: ${PUBLIC_ORIGIN}/privacy. Terms: ${PUBLIC_ORIGIN}/terms. Support: ${PUBLIC_ORIGIN}/support.`],
  ];
  function agentGuidance(req, res, me) {
    const body = `${GUIDANCE().map(([h, t], i) => sec('g' + (i + 1), '', esc(h), `<p class="pub-p">${esc(t)}</p>`)).join('')}
${sec('text', 'Plain text', 'The same guidance, as text.', `<p class="pub-p">This page is also at <a href="/agent-guidance.md">/agent-guidance.md</a>, and the site summary at <a href="/llms.txt">/llms.txt</a>.</p>`)}`;
    return page(res, me, req, { path: '/agent-guidance', title: 'Guidance for AI agents', description: 'How AI agents should treat Discriminantly: reading grants no access, authorized access requires a member’s connection, the six record types and what they do not imply, recommendation versus adoption, provenance, privacy and revocation.', h1: 'Guidance for AI agents', lede: 'What an agent should know before working with a member’s record. Reading this grants no access.', body,
      card: '/card/page/agent-guidance.png', crumbs: [HOME_CRUMB, { name: 'Guidance for AI agents', href: '/agent-guidance' }] });
  }
  function agentGuidanceText(req, res) {
    return text(req, res, `# Discriminantly: guidance for AI agents\n\n${GUIDANCE().map(([h, t]) => `## ${h}\n\n${t}\n`).join('\n')}`, 'text/markdown; charset=utf-8');
  }

  // ---- 7. About ----------------------------------------------------------------
  // A framed desktop capture (light and dark variants, chosen like the
  // homepage's), with a caption. `base` names /how/<base>-(light|dark).(jpg|webp)
  // or an absolute pair.
  function desktopShot(req, me, { light, dark, webp = null, alt, caption, w = 2000, h = 1174 }) {
    const sk = skinOf(me, req), md = modeOf(me, req);
    const img = (src) => `<img src="${src}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async">`;
    const one = (src) => webp ? `<picture><source type="image/webp" srcset="${src.replace(/\.jpg$/, '.webp')}">${img(src)}</picture>` : img(src);
    const pic = sk !== 'modern' ? one(dark) : md === 'light' ? one(light) : md === 'dark' ? one(dark) : `<picture>${webp ? `<source type="image/webp" srcset="${light.replace(/\.jpg$/, '.webp')}" media="(prefers-color-scheme: light)">` : ''}<source srcset="${light}" media="(prefers-color-scheme: light)">${webp ? `<source type="image/webp" srcset="${dark.replace(/\.jpg$/, '.webp')}">` : ''}${img(dark)}</picture>`;
    return `<figure class="pub-about-shot pub-desktop-shot"><div class="shot-wrap"><div class="shot-shadow"></div><div class="shot-frame"><div class="shot-chrome"><span></span><span></span><span></span></div>${pic}</div></div><figcaption class="welcome-caption pub-shot-cap">${esc(caption)}</figcaption></figure>`;
  }
  const aboutShot = (req, me) => desktopShot(req, me, { light: '/welcome-shot-modern-light.jpg', dark: '/welcome-shot-modern-dark.jpg', alt: 'Discriminantly on the desktop: the All feed, with notes, travel marks and a plan', caption: 'The All feed on the desktop: members’ public notes, travel marks and plans, with your own private ones visible only to you.' });
  const settingsShot = (req, me) => desktopShot(req, me, { light: '/how/settings-light.jpg', dark: '/how/settings-dark.jpg', webp: true, h: 1175, alt: 'Settings in Discriminantly on the desktop: profile, Look and feel, and Connect to your AI with ChatGPT and Muse connected and the steps for Claude open', caption: 'Settings on the desktop. Connect to your AI lists ChatGPT, Claude, Muse and other clients, each with its own steps, and shows which are connected.' });
  // About (v2.105): no second splash (the home page already opens with the
  // mark and wordmark); the standard page head, a strip of facts, the desktop
  // capture, then identity and intent. Ends with what it is not (Brian, 15 Oct).
  const ABOUT_NOT = [
    'Discriminantly is not a social feed built to keep you scrolling.',
    'It is not an AI company reselling model access or attaching you to one provider.',
    'It is not a booking site, travel agency, or marketplace.',
  ];
  const ABOUT_NOT_IS = 'It is a quiet place to save what you notice, remember where you’ve been, and turn it into plans with the people you choose.';
  function about(req, res, me) {
    const facts = [['What', 'An independent AI startup'], ['Keeps', 'A personal record of interests, places, travels and plans'], ['Works with', 'ChatGPT, Claude, Muse and other compatible assistants'], ['Closed', '2016'], ['Returned', '2026'], ['Your record', 'Held by Discriminantly; AI access yours to grant and revoke']]
      .map(([t, d]) => `<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('');
    // The 2016 site, from Brian's captures: the welcome page and a note. No member names on either.
    const shot = (name, alt, ext = 'jpg', w = 1055, h = 829) => `<picture><source type="image/webp" srcset="/about/${name}.webp"><img src="/about/${name}.${ext}" alt="${esc(alt)}" loading="lazy" decoding="async" width="${w}" height="${h}"></picture>`;
    const original = `<div class="pub-about-originals">
      <figure class="pub-about-original">${shot('original-welcome', 'The original discriminant.ly welcome page, 2016: “Capture. Discover. Share. the world’s fine and beautiful things”, above the activity feed')}<figcaption>The welcome page, 2016.</figcaption></figure>
      <figure class="pub-about-original">${shot('original-note', 'A note on the original discriminant.ly, 2016: an article on collecting vintage watches, with its photograph and link')}<figcaption>A note, 2016.</figcaption></figure>
      <figure class="pub-about-original pub-about-original-tall">${shot('original-post', 'Posting a note on the original discriminant.ly, 2016: a collection, a dropped image, title, comments, hashtags and link, and the Post note button, with the Create a new note tab below', 'png', 740, 1429)}<figcaption>Posting a note, 2016.</figcaption></figure>
    </div>`;
    const body = `
<section class="pub-sec itin-shell pub-shell pub-guide-head pub-about-facts" id="facts" aria-labelledby="facts-h">
  <h2 class="pub-h2 pub-sr" id="facts-h">Facts</h2>
  <dl class="pub-facts pub-facts-wide">${facts}</dl>
  <p class="pub-final-acts pub-about-acts">${cta(me)}<a class="link caps" href="/how-it-works">See how it works</a></p>
</section>
${aboutShot(req, me)}
${sec('what', 'What it is', 'A record, not a feed.', `<p class="pub-p">${esc(C.site.proposition[1])}</p><p class="pub-p">${esc(C.site.stance)}</p>`, 'itin-shell pub-shell')}
${sec('why', 'Why it exists', 'You notice things all the time. Most of them get lost.', `<p class="pub-p">A restaurant someone mentions, a shop passed on the way somewhere, a product, a link, an experience worth repeating: people notice useful things continuously, and the ideas end up scattered across chats, screenshots, browser tabs, notes and map pins, where none of them is there the next time they would help. Discriminantly lets you save those things naturally, without another filing system to maintain: tell the AI you already use what is worth saving, in your own words, and it is recorded here with each meaning held exactly. A note is a thing worth remembering, a mark is a place, a check-in is a visit, a warrant is an endorsement. Nothing is assumed from anything else.</p><p class="pub-p">${esc(C.together.memory)}</p><p class="pub-p">Later, those things turn into recommendations and plans. Because the record is durable and exact, an AI you authorize can draw on it. It can bring back what you saved at different times, combine it with new recommendations, and shape a plan you can share, copy or build with friends. Recommendations shaped by what you have actually saved and experienced are different from recommendations shaped by a guess about you. The record does not belong to any one assistant: connect the compatible one you choose, revoke it when you choose, and see what each one changed. What is private or public is yours to set, record by record.</p>`)}
${sec('history', 'Where it came from', 'Closed in 2016. Back in 2026.', `<p class="pub-p">Discriminantly began as a small community for noting fine things and the people who made them. It closed in 2016. It returned in 2026, rebuilt around the member’s own record and the AI they already use, with the original design preserved as a skin for anyone who wants it.</p>${original}`)}
${sec('who', 'Who makes it', 'Made independently.', `<p class="pub-p">${esc(C.site.identity)} It is deliberately built and operated, and is not owned by or tied to any one AI platform. That is what lets the record live in Discriminantly while ChatGPT, Claude, Muse and other compatible assistants work with it as authorized clients, each connected and revoked by the member. It carries no advertising and sells no data. Questions, requests and problems go to the address on the <a href="/support">Support</a> page.</p>`)}
${sec('not', 'What Discriminantly is not', 'Not a feed. Not a model. Not a marketplace.', `<ul class="pub-list pub-bounds">${ABOUT_NOT.map((b) => `<li>${esc(b)}</li>`).join('')}</ul><p class="pub-rule-line pub-about-is">${esc(ABOUT_NOT_IS)}</p>`, 'itin-shell pub-shell')}`;
    return page(res, me, req, { path: '/about', title: 'About Discriminantly', h1: 'About Discriminantly', lede: C.site.proposition[0], body, description: 'Discriminantly is an independent AI startup that turns the places and things you notice into plans: a personal record you control, used through the compatible AI assistants you choose.',
      card: '/card/page/about.png', crumbs: [HOME_CRUMB, { name: 'About', href: '/about' }],
      ld: [{ '@type': 'AboutPage', '@id': PUBLIC_ORIGIN + '/about#about', url: PUBLIC_ORIGIN + '/about', name: 'About Discriminantly', about: { '@id': PUBLIC_ORIGIN + '/#org' } },
           { '@id': PUBLIC_ORIGIN + '/#org', description: `${C.site.identityFormal} ${C.site.architecture}` }] });
  }

  // Support (v2.105): the same approved copy as the policy template carried,
  // laid out as a contact card, three topic cards and the assistants it
  // connects to. The server passes the operator's contact and the MCP address.
  function support(req, res, me, { email, mcpUrl }) {
    const mail = `<a href="mailto:${esc(email)}">${esc(email)}</a>`;
    const chips = C.platforms.map((p) => `<a class="pub-ai-chip" href="${esc(p.guide)}">${aiLogo(p.key)}<span class="pub-ai-chip-name">${esc(p.name)}</span></a>`).join('');
    const topic = (id, icon, h, inner, cls = '') => `<article class="pub-support-card itin-shell pub-shell${cls}" id="${id}" aria-labelledby="${id}-h"><div class="pub-support-ico">${icon}</div><h2 class="pub-h3" id="${id}-h">${h}</h2>${inner}</article>`;
    const body = `
<section class="pub-sec pub-support-contact itin-shell pub-shell" id="contact" aria-labelledby="contact-h">
  ${eyebrow('Contact')}
  <h2 class="pub-h2" id="contact-h">Write to us.</h2>
  <p class="pub-p">For help with Discriminantly, write to ${mail}.</p>
  <p class="pub-final-acts"><a class="btn3d btn-solid pub-cta-big" href="mailto:${esc(email)}">Email support</a></p>
</section>
<div class="pub-support-grid">
${topic('connect', WL_ICON.plan, 'Connecting an AI assistant', `<p class="pub-p">In your AI assistant, add Discriminantly from its apps, plugins or connectors (the name varies by assistant), sign in with your Discriminantly account, and approve access. If it asks for a server address, use <code class="pub-code">${esc(mcpUrl)}</code>. Some services, such as Muse, use a connection key instead: create one in Settings, choosing read-only if you only want the service to read, and give it to that service. The key is shown once.</p><div class="pub-ai-chips pub-support-chips">${chips}</div><p class="pub-fine"><a class="link caps" href="/guides/connect-an-ai-assistant">Step-by-step guide →</a></p>`, ' pub-support-wide')}
${topic('disconnect', WL_ICON.warrant, 'Disconnecting', `<p class="pub-p">Open Settings, find the service under Connected AI, and choose Revoke. It loses access immediately, and your other connections keep working. If you use a personal connector address, choose Replace connector URL to stop the old address working.</p><p class="pub-fine"><a class="link caps" href="/settings/connections">Open Settings →</a></p>`)}
${topic('account', WL_ICON.note, 'Your account and data', `<p class="pub-p">You can delete individual notes, marks, check-ins, itineraries and ensembles yourself. To delete your whole account, open Settings, go to Your data, choose Delete my account, and confirm with your handle and password. It happens immediately and cannot be undone. To get a copy of your data, write to ${mail}.</p><p class="pub-fine"><a class="link caps" href="/privacy">Privacy →</a><span aria-hidden="true"> · </span><a class="link caps" href="/terms">Terms →</a></p>`)}
</div>`;
    return page(res, me, req, { path: '/support', title: 'Support', fullTitle: 'Support — Discriminantly', h1: 'Help with Discriminantly', lede: 'Connecting an AI, disconnecting, your account and data.', body,
      description: 'Help with Discriminantly: connecting an AI, disconnecting, your account and data.', card: '/card/page/support.png', crumbs: [HOME_CRUMB, { name: 'Support', href: '/support' }],
      ld: [{ '@type': 'ContactPage', '@id': PUBLIC_ORIGIN + '/support#contact', url: PUBLIC_ORIGIN + '/support', name: 'Support' }] });
  }

  // ---- 8. Machine-readable files, from the same model ---------------------------
  // Editorial pages only. Member profiles and records (notes, marks, check-ins,
  // collections, itineraries, ensembles) and the activity feed built from them
  // never enter the sitemap or llms.txt (Brian, 14 Oct 2026).
  const PUBLIC_PATHS = ['/', '/how-it-works', '/notes', '/travel-marks', '/check-ins', '/collections', '/itineraries', '/warrants', '/ai', '/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other', '/guides', ...C.guides.map((g) => '/guides/' + g.slug), '/about', '/agent-guidance', '/privacy', '/terms', '/support'];
  const updatedOn = (p) => C.updated[p] || C.updated[p.replace(/\/guides\/.*/, '/guides')] || '2026-10-13';
  const longDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const text = (req, res, body, type = 'text/plain; charset=utf-8') => (sendZ ? sendZ.bind(null, req) : send)(res, body, 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', Vary: 'Accept-Encoding' });
  // Card specs for the editorial pages, by key.
  const cardPages = Object.assign({
    'how-it-works': { eyebrow: 'How it works', title: 'Notice. Locate. Experience. Organize. Compose. Plan together. Work with AI.', line: 'Save what you notice, remember where you’ve been, turn it into trips. Start anywhere.' },
    ai: { eyebrow: 'Use with AI', title: 'The same record, from the AI you already use.', line: 'ChatGPT, Claude, Muse and other MCP clients. Your record stays in Discriminantly.' },
    chatgpt: { eyebrow: 'Use with ChatGPT', title: 'The Discriminantly plugin for ChatGPT', line: 'Install it from its page in ChatGPT, connect by signing in, and ask.' },
    claude: { eyebrow: 'Use with Claude', title: 'Discriminantly as a custom connector in Claude', line: 'Add the connector, sign in to Discriminantly, turn it on in a chat.' },
    muse: { eyebrow: 'Use with Muse', title: 'Discriminantly as a custom connector in Muse', line: 'An API key you make in Settings. Submitted to the Muse platform; in review.' },
    other: { eyebrow: 'Other AI assistants', title: 'Any client with a remote MCP server and sign-in', line: 'Compatibility varies by client and is something to test.' },
    guides: { eyebrow: 'Guides', title: 'Things you do in Discriminantly', line: C.guides.map((g) => g.title).join(' · ') },
    about: { eyebrow: 'About', title: 'About Discriminantly', line: C.site.opening },
    'agent-guidance': { eyebrow: 'For AI agents', title: 'Guidance for AI agents', line: 'Reading grants no access. The six records and what they do not imply. Provenance, privacy, revocation.' },
    activity: { eyebrow: 'Activity', title: 'Activity across Discriminantly', line: 'Public notes, travel marks and plans members have saved recently.' },
    privacy: { eyebrow: 'Privacy', title: 'What Discriminantly keeps, and who can see it', line: 'Private or public by record. AI access is yours to grant and revoke.' },
    terms: { eyebrow: 'Terms', title: 'The terms for using Discriminantly', line: 'Your account, what you add, public things, AI assistants.' },
    support: { eyebrow: 'Support', title: 'Help with Discriminantly', line: 'Connecting an AI, disconnecting, your account and data.' },
  }, Object.fromEntries(C.objects.map((o) => [o.href.slice(1), { eyebrow: 'What you save', title: o.name, line: o.what }])),
     Object.fromEntries(C.guides.map((g) => ['guide-' + g.slug, { eyebrow: 'Guide', title: g.title, line: g.q }])));
  function llms(req, res) {
    const L = [];
    L.push(`# ${C.site.name}`, '', `> ${C.site.opening}`, '', C.site.proposition[0], '', `${C.site.identityFormal} ${C.site.architecture}`, '', C.site.proposition[1], '', C.site.stance, '');
    L.push('## What it records', '', ...C.objects.map((o) => `- **${o.name}**: ${o.what} ${o.not}`), '');
    L.push('## How it works', '', ...C.steps.map((s) => `${s.n}. **${s.verb}.** ${s.title}. ${s.body.replace(/\*\*/g, '').replace(/\n\n+/g, ' ')}`), '');
    L.push('## Using it with an AI client', '', 'No existing record is required: through a connected AI client a member can ask for recommendations or a plan from a destination, interests and constraints, and existing records sharpen the result over time. Recommendations remain recommendations until the member keeps them. Your record stays in Discriminantly. An AI client reaches it only after the member authorizes a connection, which the member can revoke in Settings. Every change an AI makes is recorded as that client acting for the member. Four facts are stated separately per client: availability, connection method, authentication, directory status.', '');
    for (const p of C.platforms) L.push(`- **${p.name}** (${PUBLIC_ORIGIN}${p.guide}): ${p.availability}. ${p.method}. ${p.auth}. ${p.directory}.${p.review ? ' ' + p.review + '.' : ''}${p.endpoint ? ' Endpoint ' + p.endpoint + ' (no trailing slash).' : ''}${p.key === 'chatgpt' && PLUGIN() ? ' Plugin page: ' + PLUGIN() + '.' : ''}`);
    L.push('', '## Boundaries', '', ...C.boundaries.map((b) => `- ${b}`), '');
    L.push('## Evidence and control', '', '- Kept, visited, owned and endorsed are separate acts; none implies another.', '- Looked-up facts (a place’s address and map position) are recorded as looked up, apart from member-authored evidence.', '- Recommendations stay recommendations until the member keeps them.', '- Itineraries are plans, not evidence of completed travel.', `- ${C.together.disclosureAgent}`, '- Privacy is per record; AI access is granted by the member and revocable; the application is where records are reviewed, adjusted and removed; provenance identifies who, or which assistant, changed what.', '');
    L.push('## Frequently asked', '', ...C.faq.map(([q, a]) => `- **${q}** ${a.replace(/\n\n+/g, ' ')}`), '');
    L.push('## Questions these pages answer', '', ...C.questions.map(([qq, href]) => `- ${qq} ${PUBLIC_ORIGIN}${href}`), '');
    L.push('## Record types', '', ...C.objects.map((o) => `- ${o.name}: ${PUBLIC_ORIGIN}${o.href}`), '');
    L.push('## Guides', '', ...C.guides.map((g) => `- ${g.title}: ${PUBLIC_ORIGIN}/guides/${g.slug}`), '');
    L.push('## Pages', '', ...PUBLIC_PATHS.map((p) => `- ${PUBLIC_ORIGIN}${p}`), '');
    L.push('## For agents', '', `- Guidance for AI agents: ${PUBLIC_ORIGIN}/agent-guidance (also ${PUBLIC_ORIGIN}/agent-guidance.md).`, `- The MCP server for authorized clients is ${PUBLIC_ORIGIN}/mcp (sign-in) and https://muse.discriminantly.com/mcp (API key). Reading this file grants no access.`, `- Privacy: ${PUBLIC_ORIGIN}/privacy. Terms: ${PUBLIC_ORIGIN}/terms. Support: ${PUBLIC_ORIGIN}/support.`, '');
    return text(req, res, L.join('\n'));
  }
  function sitemap(req, res) {
    // lastmod comes from the content model's per-page dates, not from the deploy.
    const lastmod = (p) => C.updated[p] || C.updated[p.replace(/\/guides\/.*/, '/guides')] || '2026-10-13';
    return text(req, res, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PATHS.map((p) => `  <url><loc>${PUBLIC_ORIGIN}${p}</loc><lastmod>${lastmod(p)}</lastmod></url>`).join('\n')}\n</urlset>\n`, 'application/xml; charset=utf-8');
  }
  function robots(req, res) {
    return text(req, res, ['User-agent: *', 'Allow: /', 'Disallow: /settings', 'Disallow: /admin', 'Disallow: /oauth/', 'Disallow: /mcp', 'Disallow: /logout', 'Disallow: /login', 'Disallow: /join', 'Disallow: /j/', 'Disallow: /s/', 'Disallow: /new', '', `Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`, ''].join('\n'));
  }

  return { home, howItWorks, travelMarks, aiHub, muse, chatgpt, claude, other, guides, guide, objectPage, agentGuidance, agentGuidanceText, about, support, appMenu, llms, sitemap, robots, header, canonical, OG_IMAGE, cardPages, content: C, cacheHeaders, crumbs: crumbsHtml };
}

module.exports = { create };
