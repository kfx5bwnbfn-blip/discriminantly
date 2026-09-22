// MCP freeze (since the OpenAI plugin submission, v2.52.7 + submission file
// fd09297). Fingerprints every part of server.js that the plugin surface is
// made of, plus the submitted plugin/ files. test/itinerary.js fails if any of
// them changes, so web/app work cannot alter the MCP surface by accident.
//
// Lifting the freeze is a deliberate act: change the MCP code, then run
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
  const schemaStart = SRC.slice(SRC.search(/\nconst OS_[A-Z_]+ = /) + 1);
  const R = {
    'OAuth core (tokens, codes, CIMD, resource binding)': between(SRC, 'const OAUTH_SCOPE = ', 'function clientInfoFrom(params)'),
    'Tool contract (output schemas, tool table, annotations)': between(schemaStart, 'const OS_', 'which is not a tool`);', { inclusiveEnd: true }),
    'Tool dispatcher and /mcp endpoint (incl. server instructions, error replies)': between(SRC, 'async function mcpCall(', 'const STATIC = {'),
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
