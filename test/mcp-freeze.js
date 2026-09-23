// Submitted-contract compatibility: the regions that must not move at all.
//
// Until 23 September 2026 the whole MCP surface was frozen while the OpenAI
// plugin submission (v2.52.7, submission file fd09297) is under review. The
// rule is now narrower (docs/plugin-submission.md, "Submitted-contract
// compatibility"): preserve the submitted contract and its observable
// behaviour, and allow additive MCP capability around it. So:
//   - the tool table and the dispatcher may change; the submitted tools'
//     definitions are held by the MC tests (test/itinerary.js), their
//     results by the live guard (test/mcp-contract.js) and the behaviour
//     tests (test/adoption.js, test/plugin-audit.js);
//   - OAuth, the MCP routes, discovery and the submitted plugin/ files have no
//     reason to change for additive work, so they stay fingerprinted here.
//
// Changing one of these is a deliberate act: make the change, run
//   node test/mcp-freeze.js --record
// and commit the new test/fixtures/mcp-freeze.json with a message saying why.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const between = (src, start, end, { inclusiveEnd = false } = {}) => {
  const i = src.indexOf(start); if (i < 0) throw new Error('freeze marker missing: ' + start);
  const j = src.indexOf(end, i + start.length); if (j < 0) throw new Error('freeze marker missing: ' + end);
  return src.slice(i, inclusiveEnd ? j + end.length : j);
};
function regions() {
  const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const R = {
    'OAuth core (tokens, codes, CIMD, resource binding)': between(SRC, 'const OAUTH_SCOPE = ', 'function clientInfoFrom(params)'),
    'MCP routes (legacy /mcp/<token> and /mcp)': between(SRC, 'if ((mt = p.match(/^\\/mcp\\/([A-Za-z0-9_-]+)$/)))', "if (p === '/mcp') return mcp(req, res, null);", { inclusiveEnd: true }),
    'Discovery, domain verification and OAuth routes': between(SRC, '// ---- OAuth discovery', "if (p === '/settings/connections' && m === 'POST')"),
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'plugin'), { recursive: true }).sort()) {
    const full = path.join(ROOT, 'plugin', f);
    if (fs.statSync(full).isFile()) R['plugin/' + f.split(path.sep).join('/')] = fs.readFileSync(full);
  }
  return R;
}
const fingerprint = () => Object.fromEntries(Object.entries(regions()).map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex')]));
const FILE = path.join(__dirname, 'fixtures', 'mcp-freeze.json');
if (require.main === module && process.argv.includes('--record')) {
  fs.writeFileSync(FILE, JSON.stringify(fingerprint(), null, 2) + '\n');
  console.log('recorded', Object.keys(fingerprint()).length, 'frozen regions');
}
module.exports = { fingerprint, FILE };
