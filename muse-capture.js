// Muse OAuth capture origin (Phase 0, v2.69.0-capture).
//
// A deliberately inert surface on its own origin (MUSE_ORIGIN, e.g.
// https://muse.discriminantly.com) whose only job is to make Meta Muse's
// Custom Connector reveal how it discovers, registers and authorizes, so the
// real compatibility work (Phase 1) is built against observed behaviour.
//
// What it can NOT do, by construction:
//   - it receives no database handle and requires nothing from server.js, so
//     it cannot read or change any member, record, connection or token;
//   - it never reads cookies or the Authorization header's value;
//   - it never issues an authorization code, access token or refresh token;
//   - the client_id it returns from /oauth/register is a fixed placeholder
//     that is not stored and that nothing on either origin accepts.
//
// What it records (one JSON line per request, prefixed "muse-capture"):
// method, path, user agent, and the non-secret shape of registration and
// authorization requests. Never: state, authorization codes, PKCE challenge or
// verifier values, tokens, passwords, cookies, Authorization header values,
// client secrets, e-mail contacts, or full client IP addresses.
//
// Rollback: unset MUSE_ORIGIN. The dispatch in server.js is then never taken
// and this file is not called at all.
'use strict';

const ORIGIN = (process.env.MUSE_ORIGIN || '').trim().replace(/\/+$/, '');
let HOST = '';
try { if (/^https?:\/\//i.test(ORIGIN)) HOST = new URL(ORIGIN).host.toLowerCase(); } catch { HOST = ''; }

const SCOPES = ['discriminantly.read', 'discriminantly.write'];
const PLACEHOLDER_CLIENT_ID = 'muse-capture-test-only';

// Exact host match only; any port in the Host header must match the origin's.
const matches = (req) => !!HOST && String(req.headers.host || '').toLowerCase() === HOST;

// ---- sanitising ---------------------------------------------------------------
const MAX = 300;
const str = (v) => (v === undefined || v === null ? null : String(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, MAX));
const strList = (v) => (Array.isArray(v) ? v.slice(0, 10).map(str) : v === undefined ? null : str(v));
const ipPrefix = (req) => {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  return v4 ? `${v4[1]}.${v4[2]}.x.x` : ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + ':…' : '';
};
// Registration metadata (RFC 7591): values only for fields that are never secret;
// presence only for everything else.
const DCR_VALUES = ['client_name', 'redirect_uris', 'application_type', 'token_endpoint_auth_method', 'grant_types',
  'response_types', 'scope', 'client_uri', 'logo_uri', 'tos_uri', 'policy_uri', 'software_id', 'software_version'];
function dcrShape(body) {
  const out = { keys: Object.keys(body || {}).slice(0, 40).map(str) };
  for (const k of DCR_VALUES) if (body && body[k] !== undefined) out[k] = Array.isArray(body[k]) ? strList(body[k]) : str(body[k]);
  for (const k of ['jwks', 'jwks_uri', 'software_statement', 'contacts', 'client_secret']) if (body && body[k] !== undefined) out[k + '_present'] = true;
  return out;
}
// Authorization request: values only for the parameters the brief names; the
// names of every other parameter; never state, code_challenge or any code.
const AUTH_VALUES = ['client_id', 'redirect_uri', 'scope', 'resource', 'code_challenge_method', 'response_type', 'prompt', 'response_mode'];
function authShape(params) {
  const out = { param_names: [...new Set([...params.keys()])].slice(0, 40).map(str) };
  for (const k of AUTH_VALUES) if (params.has(k)) out[k] = params.getAll(k).length > 1 ? params.getAll(k).map(str) : str(params.get(k));
  out.state_present = params.has('state');
  out.code_challenge_present = params.has('code_challenge');
  return out;
}

// A path can carry a secret (a personal connector address is /mcp/<token>), so
// any long token-like segment is recorded only by its length.
const safePath = (p) => String(p || '').split('/').map((seg) => (/^[A-Za-z0-9_.~%-]{16,}$/.test(seg) ? `<redacted:${seg.length}>` : seg)).join('/');
function record(req, path, extra = {}) {
  const line = {
    at: new Date().toISOString(), method: req.method, path: str(safePath(path)), ua: str(req.headers['user-agent']),
    content_type: str(req.headers['content-type']), accept: str(req.headers.accept), origin: str(req.headers.origin),
    authorization_present: !!req.headers.authorization, ip: ipPrefix(req), ...extra,
  };
  console.log('muse-capture ' + JSON.stringify(line));
}

// ---- responses ----------------------------------------------------------------
function json(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function page(res, status, title, text) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.55 Georgia,serif;background:#f6f4ef;color:#222}main{max-width:34rem;margin:12vh auto;padding:0 1.25rem}h1{font-size:1.35rem;font-weight:600}p{opacity:.85}</style></head>
<body><main><h1>${esc(title)}</h1>${text.map((t) => `<p>${esc(t)}</p>`).join('')}</main></body></html>`);
}
async function readBody(req, limit = 32768) {
  return await new Promise((resolve) => {
    let b = '', over = false;
    req.on('data', (c) => { if (over) return; b += c; if (b.length > limit) { over = true; b = b.slice(0, limit); } });
    req.on('end', () => resolve({ text: b, over }));
    req.on('error', () => resolve({ text: '', over: false }));
  });
}
const prm = () => ({
  resource: ORIGIN + '/mcp',
  authorization_servers: [ORIGIN],
  scopes_supported: SCOPES,
  bearer_methods_supported: ['header'],
  resource_documentation: 'https://www.discriminantly.com/support',
});
const asMeta = () => ({
  issuer: ORIGIN,
  authorization_endpoint: ORIGIN + '/oauth/authorize',
  token_endpoint: ORIGIN + '/oauth/token',
  registration_endpoint: ORIGIN + '/oauth/register',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  // Advertised so the capture shows which registration path Muse prefers when
  // both are on offer (MCP clients SHOULD prefer CIMD when it is advertised).
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  scopes_supported: SCOPES,
});

// ---- the capture origin -------------------------------------------------------
async function handle(req, res, url) {
  const p = url.pathname, m = req.method === 'HEAD' ? 'GET' : req.method;

  if (m === 'GET' && (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')) {
    record(req, p); return json(res, 200, prm());
  }
  if (m === 'GET' && (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration'
    || p === '/.well-known/oauth-authorization-server/mcp' || p === '/.well-known/openid-configuration/mcp')) {
    record(req, p); return json(res, 200, asMeta());
  }

  if (p === '/oauth/register') {
    if (m !== 'POST') { record(req, p); return json(res, 405, { error: 'invalid_request', error_description: 'POST a client registration.' }); }
    const { text, over } = await readBody(req);
    let body = null, parse_error = false;
    try { body = JSON.parse(text); } catch { parse_error = true; }
    record(req, p, { body_bytes: text.length, body_truncated: over, parse_error, registration: body && typeof body === 'object' ? dcrShape(body) : null });
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'invalid_client_metadata', error_description: 'Expected a JSON client registration.' });
    // A fixed placeholder, not a registration: nothing is stored, no secret is
    // issued, and no endpoint on either origin will accept this client_id for a
    // code or a token. It exists only so the client proceeds to /oauth/authorize,
    // where the rest of its handshake can be observed.
    return json(res, 201, {
      client_id: PLACEHOLDER_CLIENT_ID,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : undefined,
      redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris.slice(0, 10).map(String) : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  }

  if (p === '/oauth/authorize') {
    let params = url.searchParams;
    if (m === 'POST') { const { text } = await readBody(req); params = new URLSearchParams(text); }
    record(req, p, { authorize: authShape(params) });
    return page(res, 200, 'Discriminantly is in test mode for Muse', [
      'Thank you. This is a temporary test of how Meta Muse connects to Discriminantly.',
      'Nothing was connected and no access was granted. You can close this page; Discriminantly will be connectable from Muse shortly.',
    ]);
  }

  if (p === '/oauth/token') {
    let grant = null;
    if (m === 'POST') { const { text } = await readBody(req, 8192); grant = new URLSearchParams(text).get('grant_type'); }
    record(req, p, { grant_type: str(grant) });
    return json(res, 400, { error: 'invalid_grant', error_description: 'Test mode: no tokens are issued.' });
  }

  if (p === '/mcp' || p === '/mcp/') {
    // The JSON-RPC method name only, never params; then the standard challenge
    // that starts OAuth discovery. Nothing behind it can be reached.
    let rpc = null;
    if (m === 'POST') { const { text } = await readBody(req, 65536); try { const j = JSON.parse(text); rpc = Array.isArray(j) ? j.map((x) => str(x && x.method)) : str(j && j.method); } catch { rpc = null; } }
    record(req, p, { rpc_method: rpc });
    return json(res, 401, { error: 'invalid_token', error_description: 'Connect your Discriminantly account to continue.' }, {
      'WWW-Authenticate': `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Connect your Discriminantly account to continue."`,
    });
  }

  if (m === 'GET' && p === '/') {
    record(req, p);
    return page(res, 200, 'Discriminantly · Muse connection test', ['This address is a temporary test endpoint. Discriminantly lives at www.discriminantly.com.']);
  }
  record(req, p);
  return json(res, 404, { error: 'not_found' });
}

module.exports = { matches, handle, ORIGIN, HOST, PLACEHOLDER_CLIENT_ID };
