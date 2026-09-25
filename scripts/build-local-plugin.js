// Builds the local test package (Skills + registered MCP connection) from the
// authoritative sources. Output is a generated artifact in dist/, never edited.
//   APP_ID=asdk_app_... node scripts/build-local-plugin.js
// APP_ID is the registered developer-mode connection's app id: a ChatGPT URL
// containing plugin_asdk_app_X means app id asdk_app_X. Documented route:
// developers.openai.com/plugins/build/plugins ("Create and test a plugin
// locally with an MCP server"); .app.json format: learn.chatgpt.com
// enterprise/plugin-management ("Reference an existing app with .app.json").
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..'), VER = process.env.VER || '2.61.0';
let APP = String(process.env.APP_ID || '').trim().replace(/^plugin_(asdk_app_)/, '$1');
if (!/^(asdk_app_|connector_|templated_apps_)[A-Za-z0-9_]+$/.test(APP)) { console.error('APP_ID is required: the registered connection\'s app id (asdk_app_...). No placeholder package is built.'); process.exit(2); }
const OUT = path.join(ROOT, 'dist', 'local-plugin'), PLUG = path.join(OUT, 'plugins', 'discriminantly');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, '.agents', 'plugins'), { recursive: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const walk = (d) => fs.readdirSync(d).flatMap((f) => fs.statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)).map((x) => path.join(f, x)) : [f]);
// manifest: the authoritative plugin/plugin.json, plus the registered app mapping and this release's version
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', 'plugin.json'), 'utf8'));
manifest.version = VER;
manifest.extensions = manifest.extensions || {}; manifest.extensions['com.openai'] = { ...(manifest.extensions['com.openai'] || {}), apps: './.app.json' };
fs.mkdirSync(PLUG, { recursive: true });
fs.writeFileSync(path.join(PLUG, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(PLUG, '.app.json'), JSON.stringify({ apps: { discriminantly: { id: APP, required: true } } }, null, 2) + '\n');
for (const f of walk(path.join(ROOT, 'plugin', 'assets'))) copy(path.join(ROOT, 'plugin', 'assets', f), path.join(PLUG, 'assets', f));
for (const f of walk(path.join(ROOT, 'skills'))) copy(path.join(ROOT, 'skills', f), path.join(PLUG, 'skills', f));
// no mcp.json: the package references the registered connection (a bundled server would make it desktop-only and a second connection)
fs.writeFileSync(path.join(OUT, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: 'discriminantly-local', interface: { displayName: 'Discriminantly (local test)' },
  plugins: [{ name: 'discriminantly', source: { source: 'local', path: './plugins/discriminantly' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Travel' }] }, null, 2) + '\n');
// every packaged SKILL.md must be byte-identical to the release manifest
const rel = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'release', `v${VER}`, 'release-manifest.json'), 'utf8'));
let bad = 0;
for (const s of rel.skills) for (const r of s.resources) {
  const rp = r.uri.replace(/^skill:\/\/[^/]+\//, '');
  const d = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(PLUG, 'skills', rp))).digest('hex');
  if (d !== r.digest) { bad++; console.error(`MISMATCH ${rp}: ${d} != ${r.digest}`); }
}
if (bad || rel.skills.length !== 5) { console.error('package does not match the release manifest; not usable'); process.exit(1); }
console.log(`built ${OUT} for ${APP}: 5 skills match release v${VER}; no bundled mcp.json`);
