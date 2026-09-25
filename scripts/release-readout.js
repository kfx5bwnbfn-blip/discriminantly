// Generates the release readout from a live server and the repository:
// docs/release/<ver>/mcp-manifest.json, mcp-inventory.md, release-manifest.json.
// Usage: BASE=http://localhost:3000 TOKEN=<api token> VER=2.61.0 node scripts/release-readout.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, ''), TOKEN = process.env.TOKEN, VER = process.env.VER || 'dev';
const OUT = path.join(__dirname, '..', 'docs', 'release', `v${VER}`); fs.mkdirSync(OUT, { recursive: true });
const rpc = async (method, params = {}) => (await (await fetch(`${BASE}/mcp/${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const sha = (b) => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
// the domain functions each tool's handler calls (read from source, not asserted by hand)
const i = SRC.indexOf('async function mcpCall('), j = SRC.indexOf("throw new Error('Unknown tool ' + name)", i), body = SRC.slice(i, j);
const hits = [...body.matchAll(/name === '([a-z_]+)'/g)].map((m) => ({ n: m[1], i: m.index }));
const handler = {}; hits.forEach((h, k) => { handler[h.n] = (handler[h.n] || '') + body.slice(h.i, k + 1 < hits.length ? hits[k + 1].i : body.length); });
const declared = new Set([...SRC.matchAll(/\n(?:async )?function ([a-zA-Z]+)\(/g)].map((m) => m[1]));
const calls = (n) => [...new Set([...(handler[n] || '').matchAll(/\b([a-z][A-Za-z]+)\(/g)].map((m) => m[1]).filter((f) => declared.has(f) && !['q', 'wr', 'esc', 'uidOf'].includes(f)))].sort();
(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'release-readout', version: '1' } });
  init.instructions = String(init.instructions).replace(/connected to discriminant\.ly as .*? \(@[a-z0-9]+\)/, 'connected to discriminant.ly as {MEMBER_NAME} (@{MEMBER_HANDLE})');
  const tools = []; let cursor; do { const r = await rpc('tools/list', cursor ? { cursor } : {}); tools.push(...r.tools); cursor = r.nextCursor; } while (cursor);
  const skills = []; cursor = undefined; do { const r = await rpc('skills/list', cursor ? { cursor } : {}); skills.push(...r.skills); cursor = r.nextCursor; } while (cursor);
  const manifest = { generated_for: `v${VER}`, initialize: { serverInfo: init.serverInfo, capabilities: init.capabilities, instructions: init.instructions },
    tools: tools.map((t) => ({ ...t, domain_functions: calls(t.name) })), skills };
  fs.writeFileSync(path.join(OUT, 'mcp-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const md = [`# MCP inventory — v${VER}`, '', `${tools.length} tools; ${skills.length} skills over the Skills extension. Generated from the live server by scripts/release-readout.js; the complete schemas are in mcp-manifest.json.`, '',
    '| Tool | Title | read-only | destructive | open-world | Required inputs | Domain functions |', '|---|---|---|---|---|---|---|',
    ...tools.map((t) => `| \`${t.name}\` | ${t.annotations.title || t.title || ''} | ${t.annotations.readOnlyHint} | ${t.annotations.destructiveHint} | ${t.annotations.openWorldHint} | ${(t.inputSchema.required || []).join(', ') || '—'} | ${calls(t.name).join(', ') || '—'} |`),
    '', '## Descriptions', '', ...tools.flatMap((t) => [`### \`${t.name}\``, '', t.description, '', `Inputs: ${Object.entries(t.inputSchema.properties || {}).map(([k, v]) => `\`${k}\`${(t.inputSchema.required || []).includes(k) ? ' (required)' : ''}`).join(', ') || 'none'}. Output schema: ${t.outputSchema ? 'declared' : 'none'}.`, '']),
    '## Server instructions', '', '```', init.instructions, '```', ''].join('\n');
  fs.writeFileSync(path.join(OUT, 'mcp-inventory.md'), md);
  const contract = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', `mcp-contract-v${VER.split('.').slice(0, 2).join('.')}.json`));
  const rel = { release: `v${VER}`, kind: 'reconciled release', mcp: { tools: tools.length, contract_snapshot: `test/fixtures/mcp-contract-v${VER.split('.').slice(0, 2).join('.')}.json`, contract_sha256: sha(contract),
    instructions_sha256: sha(Buffer.from(init.instructions, 'utf8')), capabilities: init.capabilities },
    skills: skills.map((s) => ({ name: s.frontmatter.name, uri: s.uri, resources: s.resources })),
    dependencies: { 'discriminantly-trip-planning': ['discriminantly-travel-mark-enhancement', 'discriminantly-destination-objects', 'discriminantly-for-another-time'], 'discriminantly-destination-objects': ['discriminantly-note-enhancement'] } };
  fs.writeFileSync(path.join(OUT, 'release-manifest.json'), JSON.stringify(rel, null, 2) + '\n');
  console.log(`wrote ${OUT}: ${tools.length} tools, ${skills.length} skills`);
})().catch((e) => { console.error(e); process.exit(1); });
