// Skills over MCP: the checks OpenAI's plugin importer documents, run against
// a live server (developers.openai.com/plugins/build/mcp-server, "Import skills
// from the MCP server"). Passing this is necessary, not sufficient: only a real
// Scan Tools run proves the import. Usage: BASE=... TOKEN=... node test/skills-import.js
const crypto = require('crypto');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''), TOKEN = process.env.TOKEN;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const rpc = async (method, params = {}) => (await (await fetch(`${BASE}/mcp/${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
const fm = (t) => { const m = /^---\n([\s\S]*?)\n---\n/.exec(t); const o = {}; for (const l of m[1].split('\n')) { if (!l.trim()) continue; const k = l.indexOf(': '); o[l.slice(0, k).trim()] = l.slice(k + 2).trim(); } return o; };
(async () => {
  const init = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'skills-check', version: '1' } })).result;
  ok('SI1 io.modelcontextprotocol/skills is declared under capabilities.extensions', !!(init.capabilities.extensions && init.capabilities.extensions['io.modelcontextprotocol/skills']));
  const all = []; let cursor, pages = 0;
  do { const r = (await rpc('skills/list', cursor ? { cursor } : {})).result; all.push(...r.skills); cursor = r.nextCursor; pages++; } while (cursor && pages < 10);
  ok('SI2 skills/list returns at most five uniquely named skills within 10 pages', all.length === 5 && new Set(all.map((s) => s.frontmatter.name)).size === 5 && pages <= 10, `${all.length} skills, ${pages} page(s)`);
  let total = 0;
  for (const sk of all) {
    const name = sk.frontmatter.name;
    ok(`SI3 ${name}: uri is skill://<server>/<name>/SKILL.md and lists SKILL.md among its resources`, sk.uri.endsWith(`/${name}/SKILL.md`) && sk.resources.some((r) => r.uri === sk.uri));
    let size = 0, good = true, main = null;
    for (const r of sk.resources) {
      const rr = (await rpc('resources/read', { uri: r.uri })).result;
      const one = rr && rr.contents && rr.contents.length === 1 && rr.contents[0].uri === r.uri;
      const text = one ? rr.contents[0].text : '';
      const digest = 'sha256:' + crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
      if (!one || digest !== r.digest || !/^sha256:[0-9a-f]{64}$/.test(r.digest) || /\.\.|\/\/|\\/.test(r.uri.replace('skill://', ''))) good = false;
      size += Buffer.byteLength(text, 'utf8'); if (r.uri === sk.uri) main = text;
    }
    total += size;
    ok(`SI4 ${name}: every resource reads back as exactly one item whose sha256 matches the catalogue`, good);
    ok(`SI5 ${name}: the fetched SKILL.md front matter exactly matches the catalogue entry`, main && JSON.stringify(fm(main)) === JSON.stringify(sk.frontmatter));
    ok(`SI6 ${name}: within limits (SKILL.md <= 256 KiB, all files <= 5 MiB, <= 100 files)`, Buffer.byteLength(main, 'utf8') <= 256 * 1024 && size <= 5 * 1024 * 1024 && sk.resources.length <= 100);
    const got = (await rpc('skills/get', { uri: sk.uri })).result;
    ok(`SI7 ${name}: skills/get returns the same entry`, got && JSON.stringify(got.skill) === JSON.stringify(sk));
  }
  ok('SI8 all skills together are far below the 8 MiB scan archive limit', total < 1024 * 1024, `${total} bytes`);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('error:', e.message); process.exit(2); });
