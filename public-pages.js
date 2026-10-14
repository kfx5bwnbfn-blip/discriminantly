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
  const { layout, send, esc, PUBLIC_ORIGIN, skinOf, modeOf, aiLogo, WL_ICON } = d;
  // Structured data shared by every public page. Only facts the pages state.
  const ORG = { '@type': 'Organization', '@id': PUBLIC_ORIGIN + '/#org', name: C.site.name, url: PUBLIC_ORIGIN + '/', logo: { '@type': 'ImageObject', url: PUBLIC_ORIGIN + '/icon-512.png', width: 512, height: 512 } };
  const SITE = { '@type': 'WebSite', '@id': PUBLIC_ORIGIN + '/#site', name: C.site.name, url: PUBLIC_ORIGIN + '/', description: C.site.description, publisher: { '@id': PUBLIC_ORIGIN + '/#org' } };
  const ldScript = (graph) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
  const crumbsHtml = (crumbs) => crumbs && crumbs.length ? `<nav class="pub-crumbs" aria-label="Breadcrumb"><ol>${crumbs.map((c, i) => `<li>${i < crumbs.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : `<span aria-current="page">${esc(c.name)}</span>`}</li>`).join('')}</ol></nav>` : '';
  const crumbsLd = (crumbs) => crumbs && crumbs.length ? { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: PUBLIC_ORIGIN + c.href })) } : null;
  const HOME_CRUMB = { name: 'Discriminantly', href: '/welcome' };
  const canonical = (p) => PUBLIC_ORIGIN + p;
  const OG_IMAGE = PUBLIC_ORIGIN + '/icon-512.png';

  // ---- header ---------------------------------------------------------------
  function header(me, { home = false } = {}) {
    const item = (n) => `<li><a href="${esc(n.href)}">${esc(n.label)}</a>${n.children ? `<ul>${n.children.map((c) => `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`).join('')}</ul>` : ''}</li>`;
    return `<header class="pub-head${home ? ' pub-head-home' : ''}">
  <div class="wrap pub-head-in">
    <a class="pub-brand" href="/welcome" aria-label="Discriminantly home"><img src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="17" height="23">${home ? '' : `<span class="pub-word">${C.site.wordmark}</span>`}</a>
    <div class="pub-acts">
      ${me ? '<a class="btn3d pub-cta" href="/">Open Discriminantly</a>' : '<a class="btn3d pub-cta" href="/join">Get started</a>'}
      <details class="pub-menu" id="pub-menu">
        <summary class="pub-menu-btn" aria-controls="pub-menu-panel" aria-label="Menu"><svg class="pub-menu-ico" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><svg class="pub-menu-x" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></summary>
        <nav class="pub-menu-panel" id="pub-menu-panel" aria-label="Site">
          <ul class="pub-menu-list">${C.nav.map(item).join('')}</ul>
          <div class="pub-menu-util">${(me ? [{ label: 'Settings', href: '/settings' }] : [C.utility[0]]).concat(C.utility.slice(1)).map((u) => `<a href="${esc(u.href)}">${esc(u.label)}</a>`).join('')}</div>
        </nav>
      </details>
    </div>
  </div>
  <script>
  (function () {
    var d = document.getElementById('pub-menu'); if (!d) return;
    var s = d.querySelector('summary');
    function sync() { s.setAttribute('aria-expanded', d.open ? 'true' : 'false'); }
    sync(); d.addEventListener('toggle', sync);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && d.open) { d.open = false; s.focus(); } });
    document.addEventListener('click', function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
    var h = d.closest('.pub-head'); if (h && h.classList.contains('pub-head-home')) {
      var stuck = function () { h.classList.toggle('is-stuck', window.scrollY > 8); };
      stuck(); window.addEventListener('scroll', stuck, { passive: true });
    }
  })();
  </script>
</header>`;
  }
  const foot = `<footer class="welcome-foot fine"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></footer>`;

  // ---- shared pieces --------------------------------------------------------
  const cta = (me) => me ? `<a class="btn3d btn-solid pub-cta-big" href="/">Open Discriminantly</a>` : `<a class="btn3d btn-solid pub-cta-big" href="/join">Get started</a>`;
  const eyebrow = (t) => `<p class="lbl pub-eyebrow">${t}</p>`;
  const sec = (id, eye, h2, inner, cls = '') => `<section class="pub-sec ${cls}" id="${id}" aria-labelledby="${id}-h">${eye ? eyebrow(eye) : ''}<h2 class="pub-h2" id="${id}-h">${h2}</h2>${inner}</section>`;
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
    <p class="pub-plat-act"><a class="link caps" href="${esc(p.guide)}">Guide →</a></p>
  </article>`;
  const stepsList = (items) => `<ol class="steps wl-how pub-steps">${items.map((t, n) => `<li><span>${n + 1}</span><div>${t}</div></li>`).join('')}</ol>`;
  const page = (res, me, req, { path, title, description, h1, lede, body, home = false, cls = '', crumbs = null, ld = [] }) => {
    const graph = [ORG, SITE, { '@type': 'WebPage', '@id': canonical(path), url: canonical(path), name: title, description, isPartOf: { '@id': PUBLIC_ORIGIN + '/#site' }, inLanguage: 'en', ...(crumbsLd(crumbs) ? { breadcrumb: crumbsLd(crumbs) } : {}) }, ...ld];
    return send(res, layout({ title, me, req, cls: `is-welcome is-public ${cls}`,
      body: `${crumbsHtml(crumbs)}${h1 ? `<section class="pub-hero"><h1 class="pub-h1">${h1}</h1>${lede ? `<p class="pub-lede">${lede}</p>` : ''}</section>` : ''}${body}${foot}${ldScript(graph)}`,
      pub: { description, canonical: canonical(path), og: { title, description, image: OG_IMAGE }, header: header(me, { home }) } }));
  };

  // ---- 1. Home ----------------------------------------------------------------
  // Glyphs for the two record types the welcome card has none for, in its frame.
  const GLYPH = {
    note: WL_ICON.note, mark: WL_ICON.mark, itinerary: WL_ICON.plan, warrant: WL_ICON.warrant,
    checkin: `<svg viewBox="0 0 44 48" aria-hidden="true"><rect x="7" y="10" width="30" height="30" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M7 19h30M15 6v8M29 6v8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M15 29l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    collection: `<svg viewBox="0 0 44 48" aria-hidden="true"><rect x="8" y="22" width="28" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12 16h20M16 10h12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  };
  function home(req, res, me) {
    const shot = (light, dark, alt, w, h) => {
      const sk = skinOf(me, req), md = modeOf(me, req);
      if (sk !== 'modern') return `<img src="${dark}" alt="${alt}" width="${w}" height="${h}">`;
      if (md === 'light') return `<img src="${light}" alt="${alt}" width="${w}" height="${h}">`;
      if (md === 'dark') return `<img src="${dark}" alt="${alt}" width="${w}" height="${h}">`;
      return `<picture><source srcset="${light}" media="(prefers-color-scheme: light)"><img src="${dark}" alt="${alt}" width="${w}" height="${h}"></picture>`;
    };
    const frame = (img, cls = '') => `<div class="shot-wrap ${cls}"><div class="shot-shadow"></div><div class="shot-frame"><div class="shot-chrome"><span></span><span></span><span></span></div>${img}</div></div>`;
    const tile = (a) => `<div class="pub-demo-tile pub-demo-app"><span class="lbl">${esc(a.kind)}</span><span class="pub-demo-title">${esc(a.title)}</span><span class="pub-demo-meta">${esc(a.meta)}</span><span class="pub-demo-why">${esc(a.why)}</span></div>`;
    const chat = (c) => `<div class="pub-demo-tile pub-demo-chat"><span class="lbl">In a conversation</span><span class="pub-demo-ask">${esc(c.ask)}</span><span class="pub-demo-reply">${esc(c.reply)}</span></div>`;
    const short = { note: 'Things worth remembering.', mark: 'Places worth returning to.', checkin: 'The visits you actually made.', collection: 'Records, grouped your way.', itinerary: 'Plans, by day and stop.', warrant: 'What you stand behind.' };
    const body = `
<section class="splash pub-splash" id="promise" aria-label="Discriminantly">
  <img class="splash-mark" src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="60" height="80">
  <p class="splash-word">${C.site.wordmark}</p>
  <h1 class="splash-h">${esc(C.site.brandLine)}</h1>
  <p class="splash-sub pub-prop-1">${esc(C.site.proposition[0])}</p>
  <p class="pub-splash-acts">${me ? '<a class="btn splash-enter" href="/">Open Discriminantly</a>' : '<a class="btn splash-enter" href="/join">Get started</a>'}<a class="link caps pub-see" href="/how-it-works">See how it works</a></p>
</section>
${frame(shot('/welcome-shot-modern-light.jpg', '/welcome-shot-modern-dark.jpg', 'Discriminantly on the desktop: the All feed, with notes, travel marks and what an AI just added', 1920, 1000))}

<section class="pub-sec pub-keep" id="keep" aria-labelledby="keep-h">
  ${eyebrow('What you keep')}
  <h2 class="pub-h2" id="keep-h">Six kinds of record. Each means one thing.</h2>
  <p class="pub-p pub-keep-intro">${esc(C.site.proposition[1])}</p>
  <ul class="pub-keep-grid">${C.objects.map((o) => `<li class="pub-keep-item" id="keep-${o.key}"><span class="wl-ico pub-keep-ico">${GLYPH[o.key]}</span><span class="pub-keep-name">${o.key === 'mark' ? `<a href="${o.href}">${esc(o.name)}</a>` : esc(o.name)}</span><span class="pub-keep-short">${short[o.key]}</span></li>`).join('')}</ul>
  <p class="pub-rule-line">A saved object is not owned. A saved place is not visited. A plan is not a trip.</p>
</section>

${sec('useful', 'What you keep becomes useful', 'Kept over time. Then used.', `
  ${illus}
  <ol class="pub-demo pub-demo-grid">${C.demo.beats.map((b, i) => `<li class="pub-demo-beat"><div class="pub-demo-step"><span class="pub-demo-n">${i + 1}</span><h3 class="pub-h3">${esc(b.step)}</h3></div>${b.app ? tile(b.app) : chat(b.chat)}</li>`).join('')}</ol>
  <p class="pub-demo-sum">The assistant starts from what was kept and recorded. The plan is saved in Discriminantly, shared or built with others, and the next trip starts from more.</p>`, 'itin-shell pub-shell')}

<section class="pub-sec" id="possible" aria-labelledby="possible-h">
  ${eyebrow('What becomes possible')}
  <h2 class="pub-h2" id="possible-h">Recall. Refine. Plan. Return.</h2>
  <ul class="pub-cols2">
    <li><b>Find what you kept</b> by place, kind or your own words.</li>
    <li><b>Adjust and organize</b> a line, a collection, a privacy setting.</li>
    <li><b>Recommendations from evidence</b>, not a guess about you.</li>
    <li><b>Plans from places you already keep</b>, with new ones added.</li>
    <li><b>Continuity</b> across conversations: the plan is here, not in a chat.</li>
    <li><b>Return</b> with check-ins that make the next plan better.</li>
  </ul>
</section>

${sec('together', 'Plan together', 'Share a plan, or build one with others.', `
  <div class="pub-two">
    <div><h3 class="pub-h3">${esc(C.together.view.title)}</h3><p class="pub-p">A link shows the plan’s days, stops and places. Anyone with it can make their own copy. Yours doesn’t change.</p></div>
    <div><h3 class="pub-h3">${esc(C.together.collaborate.title)}</h3><p class="pub-p">An invitation adds someone to the same plan, as editor or viewer. Every change is recorded under who made it.</p></div>
  </div>
  <p class="pub-rule-line">Your notes, visits, warrants and private records stay yours. ${esc(C.together.disclosure)}</p>
  ${frame(shot('/welcome-shot-itin-light.jpg', '/welcome-shot-itin-dark.jpg', 'An itinerary in Discriminantly, with its map and the travel marks near it', 1920, 1000), 'splash-shot-2 pub-frame-2')}`, 'itin-shell pub-shell')}

${sec('ai', 'Use it with AI', 'The same record, from the AI you already use.', `
  <p class="pub-p">Connect it; revoke it any time. What it adds appears here, recorded as that assistant acting for you.</p>
  <div class="pub-plats pub-plats-compact">${C.platforms.map((p) => `<a class="pub-plat-row" href="${esc(p.guide)}">${aiLogo(p.key)}<span class="pub-plat-row-name">${esc(p.name)}</span><span class="pub-plat-row-status">${esc(p.availability)}${p.review ? ' · ' + esc(p.review) : ''}</span><span class="pub-plat-row-how">${esc(p.method)} · ${esc(p.auth)}</span></a>`).join('')}</div>`)}

<section class="pub-sec" id="evidence" aria-labelledby="evidence-h">
  ${eyebrow('Evidence and control')}
  <h2 class="pub-h2" id="evidence-h">Yours, looked up, suggested, planned, done.</h2>
  <dl class="pub-defs pub-defs-grid">
    <div><dt>Your record</dt><dd>Kept, visited, owned, endorsed: each its own act. None implies another.</dd></div>
    <div><dt>Looked up</dt><dd>A place’s address and map position, marked as such.</dd></div>
    <div><dt>Suggested</dt><dd>An assistant’s recommendation, until you keep it.</dd></div>
    <div><dt>Planned</dt><dd>An itinerary. Not a record of having gone.</dd></div>
  </dl>
  <ul class="pub-cols2 pub-ctrl">
    <li><b>Private or public</b>, per record. Plans start private.</li>
    <li><b>AI access is authorized</b>, by you, until you revoke it.</li>
    <li><b>The application</b> is where you review, adjust and remove.</li>
    <li><b>Provenance stays visible</b>: who, or which assistant, changed what.</li>
  </ul>
</section>

<section class="pub-sec pub-final" id="start" aria-label="Get started">
  <p class="pub-bounds-line" id="boundaries">${C.boundaries.map((b) => esc(b)).join(' <span aria-hidden="true">·</span> ')}</p>
  <p class="pub-final-acts">${cta(me)}</p>
  <p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a><span aria-hidden="true"> · </span><a class="link caps" href="/ai">Use with AI</a></p>
</section>`;
    return page(res, me, req, { path: '/welcome', title: 'Welcome', description: C.site.description, body, home: true, cls: 'is-pub-home',
      ld: [{ '@type': 'SoftwareApplication', name: C.site.name, url: PUBLIC_ORIGIN + '/', applicationCategory: 'LifestyleApplication', operatingSystem: 'Web', description: C.site.proposition[0], publisher: { '@id': PUBLIC_ORIGIN + '/#org' }, featureList: C.objects.map((o) => o.name).join(', ') }] });
  }

  // ---- 2. How it works --------------------------------------------------------
  // Each step carries a visual: a view cropped from the application's own
  // screenshots where one exists, otherwise an illustrative tile.
  function howItWorks(req, res, me) {
    const sk = skinOf(me, req), md = modeOf(me, req);
    const shot = (name, alt, w, h) => {
      const L = `/how/${name}-light.jpg`, D = `/how/${name}-dark.jpg`;
      const img = sk !== 'modern' ? `<img src="${D}" alt="${alt}" width="${w}" height="${h}" loading="lazy">` : md === 'light' ? `<img src="${L}" alt="${alt}" width="${w}" height="${h}" loading="lazy">` : md === 'dark' ? `<img src="${D}" alt="${alt}" width="${w}" height="${h}" loading="lazy">` : `<picture><source srcset="${L}" media="(prefers-color-scheme: light)"><img src="${D}" alt="${alt}" width="${w}" height="${h}" loading="lazy"></picture>`;
      return `<figure class="pub-shot"><div class="pub-shot-frame">${img}</div><figcaption class="welcome-caption">From the application</figcaption></figure>`;
    };
    const tile = (kind, title, meta, lines) => `<figure class="pub-shot pub-shot-tile"><div class="pub-demo-tile pub-demo-app"><span class="lbl">${kind}</span><span class="pub-demo-title">${title}</span><span class="pub-demo-meta">${meta}</span>${lines.map((l) => `<span class="pub-demo-why">${l}</span>`).join('')}</div><figcaption class="welcome-caption">Illustrative example</figcaption></figure>`;
    const visuals = {
      1: shot('notice', 'A note: a pour-over kettle, with the member’s reason for keeping it, its tags and a link', 630, 615),
      2: shot('locate', 'A travel mark: HEX Bar in Bangkok, with its photo, address, tags, and Directions and Check in buttons', 630, 720),
      3: shot('experience', 'A check-in on that mark: the date, and what the member said about the visit', 465, 280),
      4: shot('organize', 'A row of collections, each with its count: bass fishing, coffee, culinary, fly fishing, fragrance, golf', 1450, 190),
      5: shot('compose', 'An itinerary, Osaka and Kyoto in June: Day 1 and its first stop', 620, 610),
      6: shot('together', 'The same plan’s map, every stop pinned', 710, 700),
      7: `<figure class="pub-shot pub-shot-phone"><span class="phone-body"><span class="phone-shadow"></span><span class="phone"><span class="phone-notch"></span><img src="/how/ai.jpg" alt="A trip planned in a conversation with an AI, from places kept in Discriminantly" width="900" height="1150" loading="lazy"></span></span><figcaption class="welcome-caption">From a conversation</figcaption></figure>`,
      8: shot('verify', 'The feed’s receipt after an AI session: added through ChatGPT, one thing kept, with a link to view it', 1050, 340),
    };
    const body = `
<section class="pub-sec pub-shell-plain" id="progression" aria-label="The progression">
  <ol class="pub-prog pub-prog-visual">${C.steps.map((s) => `<li class="pub-prog-step itin-shell pub-shell" id="step-${s.n}"><div class="pub-prog-text"><div class="pub-prog-head"><span class="pub-demo-n">${s.n}</span><span class="pub-prog-verb">${esc(s.verb)}</span></div><h2 class="pub-h3 pub-prog-title">${esc(s.title)}</h2><p class="pub-p">${esc(s.body)}</p></div><div class="pub-prog-visual-col">${visuals[s.n]}</div></li>`).join('')}</ol>
</section>
${sec('names', 'The names', 'Each step leaves a record with a name.', `<dl class="pub-objects pub-objects-brief">${C.objects.map((o) => `<div class="pub-object"><dt>${o.key === 'mark' ? `<a href="${o.href}">${esc(o.name)}</a>` : esc(o.name)}</dt><dd>${esc(o.what)}</dd></div>`).join('')}</dl>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/ai">Use with AI</a></p></section>`;
    return page(res, me, req, { path: '/how-it-works', title: 'How Discriminantly works',
      description: 'From noticing something to planning with it: how Discriminantly keeps notes, travel marks, check-ins, collections and itineraries, and how an authorized AI works with them.',
      h1: 'How Discriminantly works', lede: 'Eight steps, from noticing something to returning from a trip. Each one leaves a record you can see, adjust and use.', body,
      crumbs: [HOME_CRUMB, { name: 'How it works', href: '/how-it-works' }],
      ld: [{ '@type': 'HowTo', name: 'How Discriminantly works', description: 'Eight steps, from noticing something to returning from a trip.', step: C.steps.map((st) => ({ '@type': 'HowToStep', position: st.n, name: `${st.verb}: ${st.title}`, text: st.body, url: PUBLIC_ORIGIN + '/how-it-works#step-' + st.n })) }] });
  }

  // ---- 3. Travel Marks (the object-page template) -----------------------------
  function travelMarks(req, res, me) {
    const o = C.objects.find((x) => x.key === 'mark');
    const body = `
${sec('what', 'What it is', 'A place you want to remember.', `<p class="pub-p">${esc(o.what)}</p><p class="pub-p">People keep marks for places they mean to go, places they went, places someone mentioned, and places they would send a friend. A mark can be kept long before any visit, or with no visit at all.</p>`)}
${sec('checkin', 'Mark and Check-in', 'The mark is the place. The check-in is the visit.', `<p class="pub-p">A travel mark says a place is worth remembering. A check-in says you were there, on a date or for a stay, with anything you want to say about it. Discriminantly never turns a mark into a visit on its own, and never infers a visit from a plan or a mention. ${esc(o.not)}</p>`)}
${sec('belongs', 'Where a mark can sit', 'Collections and itineraries.', `<p class="pub-p">A mark can belong to any number of collections, and can be a stop in any number of itineraries. Adding a place to a plan keeps it as a mark if it was not one already. Removing a stop from a plan leaves the mark where it is.</p>`)}
${sec('ai', 'With an authorized AI', 'Retrieved, and added, when you ask.', `<p class="pub-p">A connected assistant can find your marks, by place, city or the words you used, and can keep a new one when you ask it to. It is asked to look the place up first, so a mark carries a real address and map position rather than a guess. Every mark an assistant keeps is recorded as that assistant acting for you.</p>`)}
${sec('privacy', 'Private or public', 'Your choice, per mark.', `<p class="pub-p">A mark is visible to other members unless you mark it private. A private mark is seen only by you and by assistants you have connected. Check-ins follow the privacy of the mark they belong to. If a private mark is added as a stop in a plan you share, the place details in that plan (its name and address) may become visible to collaborators, after you confirm. The mark itself, your reason for keeping it, your check-ins and the rest of your record stay private.</p>`)}
${sec('enrich', 'Enrichment and experience', 'What was looked up, and what you said.', `<p class="pub-p">A mark’s address and map position may be looked up for you, and are recorded as looked up. Your reason for keeping it, and your check-ins, are yours and are recorded as yours. The two are kept apart, so a researched fact is never presented as your experience.</p>`)}
${sec('example', 'An example', 'What a travel mark looks like.', `${illus}
  <div class="pub-demo-tile pub-demo-app pub-example"><span class="lbl">Travel Mark</span><span class="pub-demo-title">Kissa Hoshikawa</span><span class="pub-demo-meta">Kyoto, Japan · kept 5 March · address and map position looked up</span><span class="pub-demo-why">A kissaten with a long counter. Siphon coffee.</span><span class="pub-demo-meta">1 check-in: visited 6 March. In the collection “Kyoto”. A stop in “Kyoto, two slow days”.</span></div>`, 'itin-shell pub-shell')}
${sec('not', 'What a mark does not prove', 'Keeping is not going.', `<ul class="pub-list pub-bounds"><li>A mark does not prove you visited. A check-in does.</li><li>A mark does not prove you recommend the place. A warrant does.</li><li>A mark in a plan does not prove the plan happened.</li><li>A looked-up address is a fact about the place, not a statement by you.</li></ul>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a></p></section>`;
    return page(res, me, req, { path: '/travel-marks', title: 'Travel Marks',
      description: 'A travel mark is a place worth remembering in Discriminantly: what it is, how it differs from a check-in, how it sits in collections and itineraries, and what it does not prove.',
      h1: 'Travel Marks', lede: 'A place worth remembering, kept with its name and where it is. Not yet a visit.', body,
      crumbs: [HOME_CRUMB, { name: 'What you keep', href: '/how-it-works#names' }, { name: 'Travel Marks', href: '/travel-marks' }],
      ld: [{ '@type': 'DefinedTerm', name: 'Travel Mark', description: o.what, url: PUBLIC_ORIGIN + '/travel-marks', inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'Discriminantly records', url: PUBLIC_ORIGIN + '/how-it-works#names' } }] });
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
    const pair1 = `<div class="phones">${phone(`<img src="/welcome-phone-ask.jpg" alt="Asking an AI to plan a trip from what is kept in Discriminantly" width="900" height="1845" loading="lazy">`, 'Asked for, in a conversation')}${phone(`<img src="/welcome-phone-chat.jpg" alt="A trip planned in a conversation with an AI" width="900" height="1845" loading="lazy">`, 'Planned in conversation')}</div>`;
    const pair2 = `<div class="shot-wrap splash-shot-2"><div class="shot-shadow"></div><div class="shot-frame"><div class="shot-chrome"><span></span><span></span><span></span></div>${pick('/welcome-shot-itin-light.jpg', '/welcome-shot-itin-dark.jpg', 'The same plan saved in Discriminantly, with its map')}</div></div><p class="welcome-caption">Saved in Discriminantly</p>`;
    const body = `
<section class="pub-sec itin-shell pub-shell splash-pair" id="useful" aria-labelledby="useful-h">
  <p class="splash-pair-lead" id="useful-h">What you keep becomes useful.</p>
  ${pair1}
  <p class="splash-pair-lead splash-pair-lead-2">Plan naturally.</p>
  ${pair2}
  <p class="welcome-caption welcome-caption-close">Your record stays in Discriminantly. An assistant you have authorized can retrieve from it and add to it; what it adds shows up here, recorded as that assistant acting for you. Installation, sign-in, approval behaviour and what each model does with the tools vary by platform, so each has its own page.</p>
</section>
<section class="pub-sec itin-shell pub-shell" id="platforms" aria-labelledby="platforms-h">${eyebrow('Platforms')}<h2 class="pub-h2" id="platforms-h">Status, by client.</h2>
  <div class="pub-plats">${C.platforms.map(platformRow).join('')}</div>
</section>
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a></p></section>`;
    return page(res, me, req, { path: '/ai', title: 'Use with AI',
      description: 'Connect Discriminantly to ChatGPT, Claude, Muse or another AI assistant. Availability, connection method, authentication and directory status for each, with a guide per platform.',
      h1: 'Use Discriminantly with AI', lede: 'Your record stays here. The assistant you already use can retrieve from it and add to it, once you authorize it.', body,
      crumbs: [HOME_CRUMB, { name: 'Use with AI', href: '/ai' }],
      ld: [{ '@type': 'ItemList', name: 'AI clients', itemListElement: C.platforms.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, url: PUBLIC_ORIGIN + p.guide, description: `${p.availability}. ${p.method}. ${p.auth}. ${p.directory}.` })) }] });
  }

  // ---- 5. Platform pages (one template; Muse carries the extra facts) ---------
  const PLATFORM_PATH = { chatgpt: '/ai/chatgpt', claude: '/ai/claude', muse: '/ai/muse', other: '/ai/other' };
  function platformPage(key) {
    return (req, res, me) => {
      const p = C.platforms.find((x) => x.key === key);
      const facts = [
        p.endpoint ? `<div><dt>Endpoint</dt><dd><code class="pub-code">${esc(p.endpoint)}</code> <span class="fine">(no trailing slash)</span></dd></div>` : (key !== 'muse' ? `<div><dt>Address</dt><dd><code class="pub-code">https://www.discriminantly.com/mcp</code></dd></div>` : ''),
        `<div><dt>Connection</dt><dd>${esc(p.method)}</dd></div>`,
        `<div><dt>Authentication</dt><dd>${esc(p.auth)}</dd></div>`,
        key === 'muse' ? `<div><dt>Key creation</dt><dd>Discriminantly \u2192 Settings \u203a Connect to your AI \u2192 name the connection <b>Muse</b> \u2192 Create a connection</dd></div><div><dt>OAuth</dt><dd>Not supported for this route</dd></div>` : '',
        p.reviewDetail ? `<div><dt>Status on the Muse platform</dt><dd>${esc(p.reviewDetail)}</dd></div>` : '',
        p.basis ? `<div><dt>Verification</dt><dd>${esc(p.basis)}</dd></div>` : '',
        `<div><dt>Availability</dt><dd>${esc(p.availability)}</dd></div>`,
        `<div><dt>Directory</dt><dd>${esc(p.directory)}</dd></div>`,
      ].join('');
      const body = `
<section class="pub-sec itin-shell pub-shell pub-guide-head" id="facts" aria-labelledby="facts-h">
  <div class="pub-guide-mark">${aiLogo(key)}</div>
  <p class="pub-badge"><span class="lbl">${esc(p.badge || p.method)}</span>${p.review ? ` <span class="lbl">${esc(p.review)}</span>` : ''}</p>
  <h2 class="pub-h2" id="facts-h">The facts.</h2>
  <dl class="pub-facts pub-facts-wide">${facts}</dl>
</section>
${sec('setup', 'Setup', `${p.steps.length} steps.`, `${stepsList(p.steps.map(esc))}${p.note ? `<p class="fine pub-fine">${esc(p.note)}</p>` : ''}`)}
${p.verify ? sec('verify', 'Verify it', 'Ask for something that changes nothing.', `<p class="pub-p">Once the connector is in place, send ${esc(p.name)} this:</p><blockquote class="pub-quote"><p>${esc(p.verify)}</p></blockquote><p class="pub-p">${esc(p.name)} should list the travel marks you have kept, and nothing in your account should change. If it is refused, the key is missing, mistyped or revoked: make a new one in Settings.</p>`) : ''}
${key === 'muse' ? sec('keys', 'About the key', 'A credential you control.', `<ul class="pub-list"><li>The key is shown once when it is made and stored only in hashed form.</li><li>Each connection has its own key. Revoking one in Settings takes effect immediately and leaves the others working.</li><li>A <b>read-only</b> key lets Muse look things up but refuses anything that would change your record.</li><li>Everything Muse adds is recorded as Muse acting for you, and shows up in Discriminantly like anything else.</li></ul>`) : sec('after', 'Once connected', 'The same record, from either side.', `<ul class="pub-list"><li>What ${esc(p.name)} adds appears in Discriminantly, recorded as ${esc(p.name)} acting for you.</li><li>You can disconnect at any time in Settings \u203a Connect to your AI. Access ends immediately; nothing is deleted.</li><li>Private records stay private: only you and the assistants you have connected can see them.</li></ul>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/ai">All platforms</a></p></section>`;
      const titles = { chatgpt: 'Use Discriminantly with ChatGPT', claude: 'Use Discriminantly with Claude', muse: 'Use Discriminantly with Muse', other: 'Use Discriminantly with another AI assistant' };
      const descs = {
        chatgpt: 'Install the Discriminantly plugin in ChatGPT, connect it by signing in, and ask. The facts, the steps and what happens once connected.',
        claude: 'Add Discriminantly to Claude as a custom connector with sign-in: the address, the steps and what happens once connected.',
        muse: 'Connect Meta\u2019s Muse to Discriminantly as a custom connector with an API key: the endpoint, how to make a key in Settings, the setup steps and a prompt to verify the connection.',
        other: 'Add Discriminantly to any AI client that supports a remote MCP server with sign-in. Compatibility varies and must be verified.' };
      const ledes = { chatgpt: 'A plugin in ChatGPT\u2019s directory, connected by signing in to Discriminantly.', claude: 'A custom connector, connected by signing in to Discriminantly.', muse: 'A custom connector, authenticated with a key you make in Discriminantly\u2019s Settings.', other: 'A remote MCP server with sign-in. Whether a given client works is something to test.' };
      return page(res, me, req, { path: PLATFORM_PATH[key], title: titles[key], description: descs[key], h1: titles[key], lede: ledes[key], body,
        crumbs: [HOME_CRUMB, { name: 'Use with AI', href: '/ai' }, { name: p.name, href: PLATFORM_PATH[key] }],
        ld: [{ '@type': 'HowTo', name: titles[key], description: descs[key], step: p.steps.map((t, i) => ({ '@type': 'HowToStep', position: i + 1, text: t })) }] });
    };
  }
  const muse = platformPage('muse'), chatgpt = platformPage('chatgpt'), claude = platformPage('claude'), other = platformPage('other');

  // ---- 6. Guides index ---------------------------------------------------------
  function guides(req, res, me) {
    const body = `${sec('list', 'Guides', 'Things you do in Discriminantly.', `<ul class="pub-list pub-guides">${C.guides.map((g) => `<li><b>${esc(g.title)}.</b> ${esc(g.body)} <a href="${esc(g.href)}">${esc(g.via)} \u2192</a></li>`).join('')}</ul><p class="fine pub-fine">Each of these gets its own page next. Until then the links go to the page that covers the work. Connecting an AI is under <a href="/ai">Use with AI</a>.</p>`)}`;
    return page(res, me, req, { path: '/guides', title: 'Guides', description: 'Guides to working in Discriminantly: keep a place, keep an object, plan with what you have kept, find and refine your record, build and share an itinerary.', h1: 'Guides', lede: 'Short, plain guides to the things you do here.', body,
      crumbs: [HOME_CRUMB, { name: 'Guides', href: '/guides' }],
      ld: [{ '@type': 'ItemList', name: 'Guides', itemListElement: C.guides.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, description: g.body, url: PUBLIC_ORIGIN + g.href })) }] });
  }

  // ---- 7. About ----------------------------------------------------------------
  function about(req, res, me) {
    const body = `
<section class="splash pub-splash pub-about-splash" aria-label="Discriminantly">
  <img class="splash-mark" src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="60" height="80">
  <p class="splash-word">${C.site.wordmark}</p>
  <h1 class="splash-h pub-about-h">About Discriminantly</h1>
  <p class="splash-sub pub-prop-1">${esc(C.site.proposition[0])}</p>
</section>
${sec('what', 'What it is', 'A record, not a feed.', `<p class="pub-p">${esc(C.site.proposition[1])}</p><p class="pub-p">${esc(C.site.stance)}</p>`, 'itin-shell pub-shell')}
${sec('why', 'Why it exists', 'Taste accumulates. Most of it is lost.', `<p class="pub-p">The things you notice, the places you mean to return to, the trips you half-plan in a conversation: most of it is scattered across notes, screenshots and chats, and none of it is there the next time you need it. Discriminantly gives those things one durable home, with the meaning of each kept straight: a note is a thing worth remembering, a mark is a place, a check-in is a visit, a warrant is an endorsement. Nothing is assumed from anything else.</p><p class="pub-p">Because the record is durable and exact, an AI you authorize can start from it. Recommendations shaped by what you have actually kept and experienced are different from recommendations shaped by a guess about you.</p>`)}
${sec('history', 'Where it came from', 'Twice made.', `<p class="pub-p">Discriminantly began as a small community for noting fine things and the people who made them. It closed in 2016. It returned in 2026, rebuilt around the member’s own record and the AI they already use, with the original design kept intact as a skin for anyone who wants it.</p>`)}
${sec('who', 'Who makes it', 'Made independently.', `<p class="pub-p">Discriminantly is designed, built and operated independently, by one person, as a personal project that others are welcome to use. It carries no advertising and sells no data. Questions, requests and problems go to the address on the <a href="/support">Support</a> page.</p>`)}
${sec('not', 'What it is not', 'Plainly.', `<ul class="pub-list pub-bounds">${C.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a><span aria-hidden="true"> · </span><a class="link caps" href="/privacy">Privacy</a></p></section>`;
    return page(res, me, req, { path: '/about', title: 'About Discriminantly', description: 'What Discriminantly is, why it exists, where it came from and who makes it.', body, cls: 'is-pub-about',
      crumbs: [HOME_CRUMB, { name: 'About', href: '/about' }],
      ld: [{ '@type': 'AboutPage', '@id': PUBLIC_ORIGIN + '/about#about', url: PUBLIC_ORIGIN + '/about', name: 'About Discriminantly', about: { '@id': PUBLIC_ORIGIN + '/#org' } }] });
  }

  // ---- 8. Machine-readable files, from the same model ---------------------------
  const PUBLIC_PATHS = ['/welcome', '/how-it-works', '/travel-marks', '/ai', '/ai/chatgpt', '/ai/claude', '/ai/muse', '/ai/other', '/guides', '/about', '/privacy', '/terms', '/support'];
  const text = (res, body, type = 'text/plain; charset=utf-8') => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' }); res.end(body); };
  function llms(req, res) {
    const L = [];
    L.push(`# ${C.site.name}`, '', `> ${C.site.proposition[0]}`, '', C.site.proposition[1], '', C.site.stance, '');
    L.push('## What it keeps', '', ...C.objects.map((o) => `- **${o.name}**: ${o.what} ${o.not}`), '');
    L.push('## How it works', '', ...C.steps.map((s) => `${s.n}. **${s.verb}.** ${s.title} ${s.body}`), '');
    L.push('## Using it with an AI client', '', 'Your record stays in Discriminantly. An AI client reaches it only after the member authorizes a connection, which the member can revoke in Settings. Every change an AI makes is recorded as that client acting for the member. Four facts are stated separately per client: availability, connection method, authentication, directory status.', '');
    for (const p of C.platforms) L.push(`- **${p.name}** (${PUBLIC_ORIGIN}${p.guide}): ${p.availability}. ${p.method}. ${p.auth}. ${p.directory}.${p.review ? ' ' + p.review + '.' : ''}${p.endpoint ? ' Endpoint ' + p.endpoint + ' (no trailing slash).' : ''}`);
    L.push('', '## Boundaries', '', ...C.boundaries.map((b) => `- ${b}`), '');
    L.push('## Pages', '', ...PUBLIC_PATHS.map((p) => `- ${PUBLIC_ORIGIN}${p}`), '');
    L.push('## For agents', '', `- The MCP server for authorized clients is ${PUBLIC_ORIGIN}/mcp (sign-in) and https://muse.discriminantly.com/mcp (API key). Reading this file grants no access.`, `- Privacy: ${PUBLIC_ORIGIN}/privacy. Terms: ${PUBLIC_ORIGIN}/terms. Support: ${PUBLIC_ORIGIN}/support.`, '');
    return text(res, L.join('\n'));
  }
  function sitemap(req, res) {
    const today = new Date().toISOString().slice(0, 10);
    return text(res, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PATHS.map((p) => `  <url><loc>${PUBLIC_ORIGIN}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`, 'application/xml; charset=utf-8');
  }
  function robots(req, res) {
    return text(res, ['User-agent: *', 'Allow: /', 'Disallow: /settings', 'Disallow: /admin', 'Disallow: /oauth/', 'Disallow: /mcp', 'Disallow: /logout', 'Disallow: /i/', '', `Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`, ''].join('\n'));
  }

  return { home, howItWorks, travelMarks, aiHub, muse, chatgpt, claude, other, guides, about, llms, sitemap, robots, header, canonical, OG_IMAGE };
}

module.exports = { create };
