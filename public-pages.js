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
    ${p.reviewDetail ? `<p class="pub-p">${esc(p.reviewDetail)}</p>` : ''}
    <p class="pub-p">${esc(p.summary)}</p>
    <p class="pub-plat-act"><a class="link caps" href="${esc(p.guide)}">${p.guide.includes('#') ? 'How to connect' : 'Guide'} →</a></p>
  </article>`;
  const stepsList = (items) => `<ol class="steps wl-how pub-steps">${items.map((t, n) => `<li><span>${n + 1}</span><div>${t}</div></li>`).join('')}</ol>`;
  const page = (res, me, req, { path, title, description, h1, lede, body, home = false, cls = '' }) =>
    send(res, layout({ title, me, req, cls: `is-welcome is-public ${cls}`, body: `${h1 ? `<section class="pub-hero"><h1 class="pub-h1">${h1}</h1>${lede ? `<p class="pub-lede">${lede}</p>` : ''}</section>` : ''}${body}${foot}`,
      pub: { description, canonical: canonical(path), og: { title, description, image: OG_IMAGE }, header: header(me, { home }) } }));

  // ---- 1. Home ----------------------------------------------------------------
  function home(req, res, me) {
    const shot = (light, dark, alt, w, h, lazy = false) => {
      const sk = skinOf(me, req), md = modeOf(me, req), L = lazy ? ' loading="lazy"' : '';
      if (sk !== 'modern') return `<img src="${dark}" alt="${alt}" width="${w}" height="${h}"${L}>`;
      if (md === 'light') return `<img src="${light}" alt="${alt}" width="${w}" height="${h}"${L}>`;
      if (md === 'dark') return `<img src="${dark}" alt="${alt}" width="${w}" height="${h}"${L}>`;
      return `<picture><source srcset="${light}" media="(prefers-color-scheme: light)"><img src="${dark}" alt="${alt}" width="${w}" height="${h}"${L}></picture>`;
    };
    const frame = (img, cls = '') => `<div class="shot-wrap ${cls}"><div class="shot-shadow"></div><div class="shot-frame"><div class="shot-chrome"><span></span><span></span><span></span></div>${img}</div></div>`;
    const tile = (a) => `<div class="pub-demo-tile pub-demo-app"><span class="lbl">${esc(a.kind)}</span><span class="pub-demo-title">${esc(a.title)}</span><span class="pub-demo-meta">${esc(a.meta)}</span><span class="pub-demo-why">${esc(a.why)}</span></div>`;
    const chat = (c) => `<div class="pub-demo-tile pub-demo-chat"><span class="lbl">In a conversation</span><span class="pub-demo-ask">${esc(c.ask)}</span><span class="pub-demo-reply">${esc(c.reply)}</span></div>`;
    const body = `
<section class="splash pub-splash" id="promise" aria-label="Discriminantly">
  <img class="splash-mark" src="/mark.png" srcset="/mark.png 1x, /mark@4x.png 4x" alt="" width="60" height="80">
  <p class="splash-word">${C.site.wordmark}</p>
  <h1 class="splash-h">${esc(C.site.brandLine)}</h1>
  <p class="splash-sub pub-prop-1">${esc(C.site.proposition[0])}</p>
  <p class="splash-sub pub-prop-2">${esc(C.site.proposition[1])}</p>
  <p class="pub-splash-acts">${me ? '<a class="btn splash-enter" href="/">Open Discriminantly</a>' : '<a class="btn splash-enter" href="/join">Get started</a>'}<a class="link caps pub-see" href="/how-it-works">See how it works</a></p>
</section>
${frame(shot('/welcome-shot-modern-light.jpg', '/welcome-shot-modern-dark.jpg', 'Discriminantly on the desktop: the All feed, with notes, travel marks and a plan', 2000, 1174))}
<p class="welcome-caption pub-frame-caption">The application. Your record lives here, whether you add to it directly or through an AI you have connected.</p>

${sec('useful', 'What you keep becomes useful', 'One record, kept over time, then used.', `
  ${illus}
  <ol class="pub-demo">${C.demo.beats.map((b, i) => `<li class="pub-demo-beat"><div class="pub-demo-step"><span class="pub-demo-n">${i + 1}</span><h3 class="pub-h3">${esc(b.step)}</h3></div>${b.app ? tile(b.app) : chat(b.chat)}<p class="pub-demo-cap">${esc(b.caption)}</p></li>`).join('')}</ol>
  <p class="pub-p pub-stance">${esc(C.site.stance)}</p>`, 'itin-shell pub-shell')}

${sec('keep', 'What you keep', 'Ordinary things, given their proper names.', `
  <dl class="pub-objects">${C.objects.map((o) => `<div class="pub-object" id="keep-${o.key}"><dt><span class="pub-object-plain">${esc(o.plain)}</span> <span class="pub-object-arrow" aria-hidden="true">→</span> <span class="pub-object-name">${o.key === 'mark' ? `<a href="${o.href}">${esc(o.name)}</a>` : esc(o.name)}</span></dt><dd>${esc(o.what)} <span class="pub-object-not">${esc(o.not)}</span></dd></div>`).join('')}</dl>
  <p class="pub-p pub-rule">A saved object does not prove ownership. A saved place does not prove a visit. A plan does not prove an experience.</p>`)}

${sec('possible', 'What becomes possible', 'Recall, organize, plan, return.', `
  <ul class="pub-list">
    <li><b>Find what you kept</b> before you need it: by place, by kind, by the words you used.</li>
    <li><b>Organize and refine</b> the record: adjust a line, move something into a collection, make it private or public.</li>
    <li><b>Recommendations grounded in evidence</b>: when you ask a connected AI, it starts from what you have actually kept and recorded, not from a guess about you.</li>
    <li><b>Build itineraries</b> from places you already keep, and bring in new ones you are considering.</li>
    <li><b>Continuity across conversations</b>: a plan started in one chat is in Discriminantly, so the next conversation can pick it up.</li>
    <li><b>Return and add</b>: check-ins from a trip enrich the record, and the next plan starts from more.</li>
  </ul>`)}

${sec('together', 'Plan together', 'Share a plan, or build one with others.', `
  <div class="pub-two">
    <div><h3 class="pub-h3">${esc(C.together.view.title)}</h3><p class="pub-p">${esc(C.together.view.body)}</p></div>
    <div><h3 class="pub-h3">${esc(C.together.collaborate.title)}</h3><p class="pub-p">${esc(C.together.collaborate.body)}</p></div>
  </div>
  <p class="pub-p pub-rule">${esc(C.together.stays)}</p>
  <p class="fine pub-fine">${esc(C.together.disclosure)}</p>
  ${frame(shot('/welcome-shot-itin-light.jpg', '/welcome-shot-itin-dark.jpg', 'An itinerary in Discriminantly, with its map and the travel marks near it', 2000, 1174), 'splash-shot-2 pub-frame-2')}
  <p class="welcome-caption pub-frame-caption">A plan in the application: its days and stops, on a map, beside the places the member already keeps nearby.</p>`, 'itin-shell pub-shell')}

${sec('ai', 'Use it with AI', 'The same record, reached from the AI you already use.', `
  <p class="pub-p">An authorized assistant can retrieve from and add to the same durable record. You connect it; you can revoke it. What it adds shows up in Discriminantly, recorded as that assistant acting for you.</p>
  <div class="pub-plats pub-plats-compact">${C.platforms.map((p) => `<a class="pub-plat-row" href="${esc(p.guide)}">${aiLogo(p.key)}<span class="pub-plat-row-name">${esc(p.name)}</span><span class="pub-plat-row-status">${esc(p.availability)}${p.review ? ' · ' + esc(p.review) : ''}</span><span class="pub-plat-row-how">${esc(p.method)} · ${esc(p.auth)}</span></a>`).join('')}</div>
  <p class="pub-plat-act"><a class="link caps" href="/ai">All platforms and how to connect →</a></p>`)}

${sec('evidence', 'Evidence and control', 'What is yours, what is suggested, and who can see it.', `
  <dl class="pub-defs">
    <div><dt>Your record</dt><dd>What you have kept, each kind with its own meaning. A note says a thing was worth remembering. A travel mark says a place was worth remembering or considering. A check-in says you were there. An ownership record says you own it. A warrant says you stand behind it. None of these implies another: nothing saved is thereby liked, owned, visited or endorsed.</dd></div>
    <div><dt>Researched facts</dt><dd>A place’s address and map position, looked up and marked as such.</dd></div>
    <div><dt>Recommendations</dt><dd>Suggestions an assistant made. They stay recommendations until you keep them.</dd></div>
    <div><dt>Plans</dt><dd>Intentions, arranged. Not a record of having gone.</dd></div>
    <div><dt>Experiences</dt><dd>Check-ins: the record that you were actually there.</dd></div>
  </dl>
  <ul class="pub-list">
    <li><b>Private or public, per record.</b> Notes and marks are visible to other members unless you mark them private. Plans start private.</li>
    <li><b>AI access is authorized.</b> An assistant reaches your record only after you connect it, and only until you revoke it.</li>
    <li><b>The application is the durable place</b> to review, adjust and remove what is kept.</li>
    <li><b>Provenance stays visible.</b> Each record shows where it came from and who, or which assistant, changed it.</li>
  </ul>`)}

${sec('boundaries', 'Boundaries', 'What Discriminantly does not claim.', `<ul class="pub-list pub-bounds">${C.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`)}

<section class="pub-sec pub-final" id="start" aria-label="Get started">
  <p class="pub-final-acts">${cta(me)}</p>
  <p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a><span aria-hidden="true"> · </span><a class="link caps" href="/ai">Use with AI</a></p>
</section>`;
    return page(res, me, req, { path: '/welcome', title: 'Welcome', description: C.site.description, body, home: true, cls: 'is-pub-home' });
  }

  // ---- 2. How it works --------------------------------------------------------
  function howItWorks(req, res, me) {
    const body = `
<section class="pub-sec itin-shell pub-shell" id="progression" aria-label="The progression">
  <ol class="pub-prog">${C.steps.map((s) => `<li class="pub-prog-step" id="step-${s.n}"><div class="pub-prog-head"><span class="pub-demo-n">${s.n}</span><span class="pub-prog-verb">${esc(s.verb)}</span></div><h2 class="pub-h3 pub-prog-title">${esc(s.title)}</h2><p class="pub-p">${esc(s.body)}</p></li>`).join('')}</ol>
</section>
${sec('names', 'The names', 'Each step leaves a record with a name.', `<dl class="pub-objects pub-objects-brief">${C.objects.map((o) => `<div class="pub-object"><dt>${o.key === 'mark' ? `<a href="${o.href}">${esc(o.name)}</a>` : esc(o.name)}</dt><dd>${esc(o.what)}</dd></div>`).join('')}</dl>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/ai">Use with AI</a></p></section>`;
    return page(res, me, req, { path: '/how-it-works', title: 'How Discriminantly works',
      description: 'From noticing something to planning with it: how Discriminantly keeps notes, travel marks, check-ins, collections and itineraries, and how an authorized AI works with them.',
      h1: 'How Discriminantly works', lede: 'Eight steps, from noticing something to returning from a trip. Each one leaves a record you can see, adjust and use.', body });
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
      h1: 'Travel Marks', lede: 'A place worth remembering, kept with its name and where it is. Not yet a visit.', body });
  }

  // ---- 4. Use with AI hub -----------------------------------------------------
  function aiHub(req, res, me) {
    const body = `
${sec('how', 'How it works', 'Your record stays in Discriminantly. Assistants ask to reach it.', `
  <ul class="pub-list">
    <li><b>Your corpus remains in Discriminantly.</b> Connecting an assistant does not move or copy it; the assistant reaches it when you use it.</li>
    <li><b>AI clients request authorized access.</b> You approve the connection, and you can revoke it in Settings at any time.</li>
    <li><b>Platforms differ.</b> Installation, authentication, approval behaviour, the features available and the decisions the model makes vary from one client to another. Each has its own guide.</li>
    <li><b>Four separate facts.</b> Whether a platform is available, how it connects, how it authenticates and whether it is listed in a directory are different things, and are stated separately below.</li>
  </ul>`)}
<section class="pub-sec itin-shell pub-shell" id="platforms" aria-labelledby="platforms-h">${eyebrow('Platforms')}<h2 class="pub-h2" id="platforms-h">Status, by client.</h2>
  <div class="pub-plats">${C.platforms.map(platformRow).join('')}</div>
</section>
${sec('connect', 'Connecting', 'The steps, by client.', C.platforms.filter((p) => p.key !== 'muse').map((p) => `<h3 class="pub-h3" id="connect-${p.key}">${esc(p.name)}</h3>${stepsList(p.steps.map(esc))}${p.note ? `<p class="fine pub-fine">${esc(p.note)}</p>` : ''}`).join('') + `<h3 class="pub-h3" id="connect-muse">Muse</h3><p class="pub-p">Muse connects with an API key rather than a sign-in. <a href="/ai/muse">Use Discriminantly with Muse</a> has the full guide.</p>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/how-it-works">See how it works</a></p></section>`;
    return page(res, me, req, { path: '/ai', title: 'Use with AI',
      description: 'Connect Discriminantly to ChatGPT, Claude, Muse or another AI assistant. Availability, connection method, authentication and directory status for each, with the steps to connect.',
      h1: 'Use Discriminantly with AI', lede: 'Your record stays here. The assistant you already use can retrieve from it and add to it, once you authorize it.', body });
  }

  // ---- 5. Muse guide ----------------------------------------------------------
  function muse(req, res, me) {
    const p = C.platforms.find((x) => x.key === 'muse');
    const body = `
<section class="pub-sec itin-shell pub-shell pub-guide-head" id="facts" aria-labelledby="facts-h">
  <div class="pub-guide-mark">${aiLogo('muse')}</div>
  <p class="pub-badge"><span class="lbl">${esc(p.badge)}</span> <span class="lbl">${esc(p.review)}</span></p>
  <h2 class="pub-h2" id="facts-h">The facts.</h2>
  <dl class="pub-facts pub-facts-wide">
    <div><dt>Endpoint</dt><dd><code class="pub-code">${esc(p.endpoint)}</code> <span class="fine">(no trailing slash)</span></dd></div>
    <div><dt>Authentication</dt><dd>${esc(p.auth)}</dd></div>
    <div><dt>Key creation</dt><dd>Discriminantly → Settings › Connect to your AI → name the connection <b>Muse</b> → Create a connection</dd></div>
    <div><dt>OAuth</dt><dd>Not supported for this route</dd></div>
    <div><dt>Status on the Muse platform</dt><dd>${esc(p.reviewDetail)}</dd></div>
    <div><dt>Directory</dt><dd>${esc(p.directory)}</dd></div>
  </dl>
</section>
${sec('setup', 'Setup', 'Four steps.', `${stepsList(p.steps.map(esc))}<p class="fine pub-fine">${esc(p.note)}</p>`)}
${sec('verify', 'Verify it', 'Ask for something that changes nothing.', `<p class="pub-p">Once the connector is in place, send Muse this:</p><blockquote class="pub-quote"><p>${esc(p.verify)}</p></blockquote><p class="pub-p">Muse should list the travel marks you have kept, and nothing in your account should change. If it is refused, the key is missing, mistyped or revoked: make a new one in Settings.</p>`)}
${sec('keys', 'About the key', 'A credential you control.', `<ul class="pub-list"><li>The key is shown once when it is made and stored only in hashed form.</li><li>Each connection has its own key. Revoking one in Settings takes effect immediately and leaves the others working.</li><li>A <b>read-only</b> key lets Muse look things up but refuses anything that would change your record.</li><li>Everything Muse adds is recorded as Muse acting for you, and shows up in Discriminantly like anything else.</li></ul>`)}
<section class="pub-sec pub-final" id="start" aria-label="Get started"><p class="pub-final-acts">${cta(me)}</p><p class="pub-final-sub"><a class="link caps" href="/ai">All platforms</a></p></section>`;
    return page(res, me, req, { path: '/ai/muse', title: 'Use Discriminantly with Muse',
      description: 'Connect Meta’s Muse to Discriminantly as a custom connector with an API key: the endpoint, how to make a key in Settings, the setup steps and a prompt to verify the connection.',
      h1: 'Use Discriminantly with Muse', lede: 'A custom connector, authenticated with a key you make in Discriminantly’s Settings.', body });
  }

  // ---- 6. Guides index ---------------------------------------------------------
  function guides(req, res, me) {
    const body = `${sec('list', 'Guides', 'Things you do in Discriminantly.', `<ul class="pub-list pub-guides">${C.guides.map((g) => `<li><b>${esc(g.title)}.</b> ${esc(g.body)} <a href="${esc(g.href)}">${esc(g.via)} \u2192</a></li>`).join('')}</ul><p class="fine pub-fine">Each of these gets its own page next. Until then the links go to the page that covers the work. Connecting an AI is under <a href="/ai">Use with AI</a>.</p>`)}`;
    return page(res, me, req, { path: '/guides', title: 'Guides', description: 'Guides to working in Discriminantly: keep a place, keep an object, plan with what you have kept, find and refine your record, build and share an itinerary.', h1: 'Guides', lede: 'Short, plain guides to the things you do here.', body });
  }

  return { home, howItWorks, travelMarks, aiHub, muse, guides, header, canonical, OG_IMAGE };
}

module.exports = { create };
