// Post-deployment verification, by content: proves the deployed server IS
// release v2.61 (tool definitions equal the recorded snapshot; Skill digests
// equal the release manifest, every resource read back and re-hashed).
//   BASE=https://www.discriminantly.com TOKEN=<test account api token> node scripts/verify-production.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const BASE = (process.env.BASE || 'https://www.discriminantly.com').replace(/\/$/, ''), VER = process.env.VER || '2.61.0';
let TOKEN = process.env.TOKEN || '';
// The credential is read from a hidden prompt when not supplied by the environment:
// never echoed, never written anywhere, never printed. A connector URL is accepted too.
const askHidden = (q) => new Promise((resolve) => {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (str) => { if (str.includes(q)) rl.output.write(q); };
  rl.question(q, (v) => { rl.close(); process.stdout.write('\n'); resolve(v.trim()); });
});
const ROOT = path.join(__dirname, '..'), rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'release', `v${VER}`, 'release-manifest.json'), 'utf8'));
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, rel.mcp.contract_snapshot), 'utf8'));
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + n + (c || !x ? '' : '  -> ' + x)); };
const sha = (s) => 'sha256:' + crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const rpc = async (method, params = {}) => (await (await fetch(`${BASE}/mcp/${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
const norm = (v) => JSON.parse(JSON.stringify(v).split(BASE.replace('://www.', '://')).join('{ORIGIN}').split(BASE).join('{ORIGIN}'));
(async () => {
  if (!TOKEN) TOKEN = await askHidden('Test-account token or connector URL (hidden): ');
  TOKEN = TOKEN.replace(/^.*\/mcp\//, '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!TOKEN) { console.error('No token given.'); process.exit(2); }
  const un = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
  ok('P1 unauthenticated /mcp answers 401 with an OAuth challenge', un.status === 401 && /resource_metadata/.test(un.headers.get('www-authenticate') || ''));
  ok('P2 OAuth protected-resource metadata is served', (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).status === 200);
  const init = (await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify-production', version: '1' } })).result;
  ok('P3 capabilities declare the Skills extension exactly as released', JSON.stringify(init.capabilities) === JSON.stringify(rel.mcp.capabilities), JSON.stringify(init.capabilities));
  const instr = String(init.instructions).replace(/connected to discriminant\.ly as .*? \(@[a-z0-9]+\)/, 'connected to discriminant.ly as {MEMBER_NAME} (@{MEMBER_HANDLE})');
  ok('P4 server instructions hash matches the release', sha(instr) === rel.mcp.instructions_sha256);
  const tools = []; let c; do { const r = (await rpc('tools/list', c ? { cursor: c } : {})).result; tools.push(...r.tools); c = r.nextCursor; } while (c);
  const byName = (l) => Object.fromEntries(l.map((t) => [t.name, t]));
  const want = byName(snap.tools), got = byName(norm(tools));
  const diff = Object.keys({ ...want, ...got }).filter((n) => JSON.stringify(want[n]) !== JSON.stringify(got[n]));
  ok(`P5 all ${rel.mcp.tools} tool definitions equal the v${VER} snapshot`, tools.length === rel.mcp.tools && !diff.length, `${tools.length} tools; differ: ${diff.join(', ')}`);
  const skills = (await rpc('skills/list', {})).result.skills;
  ok('P6 five skills listed, exactly the released names and digests', JSON.stringify(skills.map((s) => [s.frontmatter.name, s.resources])) === JSON.stringify(rel.skills.map((s) => [s.name, s.resources])));
  let reads = true;
  for (const s of skills) for (const r of s.resources) { const rr = (await rpc('resources/read', { uri: r.uri })).result; if (!rr || rr.contents.length !== 1 || sha(rr.contents[0].text) !== r.digest) reads = false; }
  ok('P7 every skill resource reads back with its released sha256', reads);
  console.log(`\n${pass} passed, ${fail} failed${fail ? '' : ` — production is release v${VER}`}`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('error:', e.message); process.exit(2); });
