// Social-card images (pass 2): 1200x630 previews rendered from public fields
// only, as SVG rasterised by sharp. The atmosphere (the site's glow), the
// D mark and a slab serif. Chaparral Pro is a licensed web font and is not
// available server-side, so the cards set in Rokkitt (OFL), the classic
// skin's stand-in; the font and a fontconfig are bundled so the result is
// the same on every host.
'use strict';
const fs = require('fs'), path = require('path');
const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
// fontconfig must learn the bundled directory before sharp/librsvg loads.
try {
  const conf = path.join(require('os').tmpdir(), 'discriminantly-fonts.conf');
  fs.writeFileSync(conf, fs.readFileSync(path.join(FONT_DIR, 'fonts.conf'), 'utf8').replace('FONT_DIR', FONT_DIR));
  if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = conf;
} catch {}
let sharp = null; try { sharp = require('sharp'); } catch {}

const W = 1200, H = 630;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let MARK = null; // the D mark, white, as a data URI (negated from mark@4x.png once)
async function mark() {
  if (MARK || !sharp) return MARK;
  const png = await sharp(path.join(__dirname, 'public', 'mark@4x.png')).ensureAlpha().negate({ alpha: false }).png().toBuffer();
  MARK = 'data:image/png;base64,' + png.toString('base64'); return MARK;
}
// Greedy line wrap by an average glyph width; good enough for a card.
function wrap(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); if (lines.length === maxLines) break; }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…';
  return lines;
}
const bg = `<defs>
  <radialGradient id="a" cx="18%" cy="30%" r="70%"><stop offset="0" stop-color="#4a5a8c" stop-opacity=".55"/><stop offset="1" stop-color="#0d0f14" stop-opacity="0"/></radialGradient>
  <radialGradient id="b" cx="85%" cy="80%" r="70%"><stop offset="0" stop-color="#8c5a4a" stop-opacity=".45"/><stop offset="1" stop-color="#0d0f14" stop-opacity="0"/></radialGradient>
  <radialGradient id="c" cx="60%" cy="20%" r="50%"><stop offset="0" stop-color="#5a3a6c" stop-opacity=".35"/><stop offset="1" stop-color="#0d0f14" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="#0d0f14"/><rect width="${W}" height="${H}" fill="url(#a)"/><rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#c)"/>`;
const F = 'Rokkitt, serif';
// A card: eyebrow (small caps), title (1-3 lines), a line beneath, the wordmark at the foot.
async function card({ eyebrow = '', title = '', line = '', image = null }) {
  if (!sharp) return null;
  const hasImg = !!image;
  const textW = hasImg ? 620 : 1040;
  const tSize = title.length > 48 ? 52 : title.length > 28 ? 62 : 72;
  const tLines = wrap(title, Math.floor(textW / (tSize * 0.46)), 3);
  const lLines = wrap(line, Math.floor(textW / (26 * 0.5)), hasImg ? 3 : 2);
  const top = 150;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}
  <image href="${await mark()}" x="80" y="64" width="33" height="44" opacity=".95"/>
  <text x="128" y="98" font-family="${F}" font-weight="600" font-size="20" letter-spacing="5" fill="rgba(255,255,255,.82)">DISCRIMINANT•LY</text>
  ${eyebrow ? `<text x="80" y="${top}" font-family="${F}" font-weight="600" font-size="19" letter-spacing="4" fill="rgba(255,255,255,.66)">${esc(eyebrow.toUpperCase())}</text>` : ''}
  ${tLines.map((l, i) => `<text x="80" y="${top + 44 + (i + 1) * (tSize * 1.08)}" font-family="${F}" font-weight="400" font-size="${tSize}" fill="#ffffff">${esc(l)}</text>`).join('')}
  ${lLines.map((l, i) => `<text x="80" y="${top + 44 + tLines.length * (tSize * 1.08) + 36 + i * 36}" font-family="${F}" font-weight="300" font-size="26" fill="rgba(255,255,255,.82)">${esc(l)}</text>`).join('')}
  ${hasImg ? `<rect x="740" y="80" width="380" height="470" rx="22" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.18)"/>` : ''}
</svg>`;
  let out = sharp(Buffer.from(svg));
  if (hasImg) {
    const im = await sharp(image).resize(360, 450, { fit: 'cover', position: 'attention' }).png().toBuffer();
    const rounded = await sharp(im).composite([{ input: Buffer.from(`<svg><rect x="0" y="0" width="360" height="450" rx="16"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
    out = out.composite([{ input: rounded, left: 750, top: 90 }]);
  }
  return out.png({ compressionLevel: 9 }).toBuffer();
}
module.exports = { card, available: () => !!sharp };
