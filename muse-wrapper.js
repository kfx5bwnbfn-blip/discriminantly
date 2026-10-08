// Muse OAuth wrapper (Phase 1, v2.73): a real authorization server on the Muse
// origin only (MUSE_ORIGIN, e.g. https://muse.discriminantly.com).
//
// Why it exists. Through www's unchanged OAuth flow, Meta's iOS callback never
// exchanges the code it is given (four reproductions, Oct 7-8 2026). www's
// OAuth and MCP code are frozen while the OpenAI plugin is in review, so the
// experiments live here instead, where the redirect can be shaped freely:
//   - dynamic client registration (untested with Muse so far);
//   - the `iss` parameter on the redirect, on or off (MUSE_SEND_ISS).
//
// What it does, and nothing more:
//   - /oauth/register   DCR. Accepts only Meta's callback as a redirect URI and
//                       returns a client_id of the form muse-dcr-<16 hex>. Stateless:
//                       nothing is stored, and any such id is accepted later
//                       together with that one redirect URI.
//   - /oauth/authorize  the member signs in on this origin (email and password,
//                       www's own checkPass and login throttle) and approves.
//   - /oauth/token      authorization_code with PKCE S256, single-use codes held
//                       in memory for ten minutes. The access token is an ordinary
//                       Discriminantly connection named "Muse": hashed at rest,
//                       listed in Settings, revocable there like any other.
//   - /mcp              a bearer from that connection is handed to www's own,
//                       unchanged mcp() as a connection token. Same tools, same
//                       provenance as the personal connector.
//
// It never logs: state, codes, PKCE values, tokens, passwords, cookies or
// Authorization header values. It logs one "muse-capture" line per request (the
// capture module's format) plus a "stage" for each step of the flow.
//
// Off unless MUSE_WRAPPER=1. Rollback: unset MUSE_WRAPPER (Phase 0 capture
// returns) or unset MUSE_ORIGIN (the origin goes inert). Revoke any "Muse"
// connection it made in Settings.
'use strict';
const crypto = require('crypto');

const ENABLED = () => process.env.MUSE_WRAPPER === '1';
const SEND_ISS = () => process.env.MUSE_SEND_ISS !== '0';
const CODE_TTL = 10 * 60e3, PENDING_TTL = 30 * 60e3, MAX_ITEMS = 500;
const DCR_ID = /^muse-dcr-[0-9a-f]{16}$/;

function create(depsFn) {
  const codes = new Map(), pending = new Map();
  const sweep = (m, ttl) => { const now = Date.now(); for (const [k, v] of m) if (now - v.at > ttl) m.delete(k); while (m.size > MAX_ITEMS) m.delete(m.keys().next().value); };
  const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function clientOk(ctx, clientId) {
    return clientId === ctx.ORIGIN + ctx.MUSE_CLIENT_PATH || DCR_ID.test(String(clientId || ''));
  }

  function consentPage(ctx, res, { pid, err = '', email = '' }) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Connect Muse to Discriminantly</title>
<style>body{margin:0;font:16px/1.55 Georgia,serif;background:#f6f4ef;color:#222}main{max-width:26rem;margin:9vh auto;padding:0 1.25rem}h1{font-size:1.4rem;font-weight:600;margin:0 0 .4rem}p{opacity:.85;margin:.4rem 0 1rem}
label{display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;margin:.9rem 0 .3rem}input{width:100%;box-sizing:border-box;font:inherit;padding:.75rem .9rem;border:1px solid #ccc;border-radius:12px;background:#fff}
.row{display:flex;gap:.6rem;margin-top:1.3rem}button{flex:1;font:600 .74rem Georgia,serif;letter-spacing:.16em;text-transform:uppercase;padding:.95rem;border-radius:999px;border:0;cursor:pointer}
.go{background:#222;color:#f6f4ef}.no{background:#e7e3da;color:#222}.err{color:#a33;opacity:1}.fine{font-size:.85rem;opacity:.7}</style></head>
<body><main><h1>Connect Muse to Discriminantly</h1>
<p>Muse, Meta's AI, is asking to read and change what you keep in Discriminantly on your behalf: your notes, places, plans and check-ins, private ones included.</p>
${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/oauth/authorize"><input type="hidden" name="pid" value="${esc(pid)}">
<label for="em">Email</label><input id="em" name="email" type="email" autocomplete="username" value="${esc(email)}" required>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password">
<div class="row"><button class="no" name="action" value="deny" formnovalidate>Cancel</button><button class="go" name="action" value="allow">Allow</button></div></form>
<p class="fine">You can disconnect Muse at any time in Settings on www.discriminantly.com.</p></main></body></html>`);
  }

  // Back to Meta's callback. Only ever the one registered redirect URI.
  function toClient(ctx, res, redirectUri, params) {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    if (SEND_ISS()) u.searchParams.set('iss', ctx.ORIGIN);
    res.writeHead(303, { Location: u.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  }

  // Returns true when it handled the request.
  async function handle(req, res, url, ctx) {
    if (!ENABLED()) return false;
    const p = url.pathname, m = req.method === 'HEAD' ? 'GET' : req.method;
    const d = depsFn();
    const stage = (name, extra = {}) => ctx.record(req, p, { wrapper: true, stage: name, iss_sent: SEND_ISS(), ...extra });

    if (p === '/oauth/register') {
      if (m !== 'POST') { stage('register_wrong_method'); ctx.json(res, 405, { error: 'invalid_request' }); return true; }
      const { text, over } = await ctx.readBody(req);
      let body = null; try { body = JSON.parse(text); } catch {}
      const shape = body && typeof body === 'object' ? ctx.dcrShape(body) : null;
      const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
      if (!uris.length || uris.some((u) => u !== ctx.MUSE_REDIRECT)) {
        stage('register_refused', { body_truncated: over, registration: shape });
        ctx.json(res, 400, { error: 'invalid_redirect_uri', error_description: 'This server registers Meta Muse only.' }); return true;
      }
      const clientId = 'muse-dcr-' + crypto.randomBytes(8).toString('hex');
      stage('register_ok', { registration: shape, client_id: clientId });
      ctx.json(res, 201, {
        client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : 'Muse',
        redirect_uris: [ctx.MUSE_REDIRECT], grant_types: ['authorization_code'], response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
      return true;
    }

    if (p === '/oauth/authorize' && m === 'GET') {
      const q = url.searchParams, shape = ctx.authShape(q);
      const clientId = q.get('client_id'), redirectUri = q.get('redirect_uri');
      // A bad client or redirect is shown here, never sent anywhere.
      if (!clientOk(ctx, clientId) || redirectUri !== ctx.MUSE_REDIRECT) {
        stage('authorize_refused_client', { authorize: shape });
        ctx.page(res, 400, 'This connection request isn’t recognised', ['It did not come from Muse with the expected details. Nothing was connected.']); return true;
      }
      const fail = (error, desc) => { stage('authorize_error_to_client', { authorize: shape, error }); toClient(ctx, res, redirectUri, { error, error_description: desc, state: q.get('state') }); return true; };
      if (q.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only the authorization code flow is supported.');
      if (!q.get('code_challenge') || (q.get('code_challenge_method') || 'plain') !== 'S256') return fail('invalid_request', 'PKCE with S256 is required.');
      sweep(pending, PENDING_TTL);
      const pid = crypto.randomBytes(18).toString('hex');
      pending.set(pid, { at: Date.now(), clientId, redirectUri, state: q.get('state') || '', challenge: q.get('code_challenge'), scope: q.get('scope') || '' });
      stage('authorize_shown', { authorize: shape });
      consentPage(ctx, res, { pid });
      return true;
    }

    if (p === '/oauth/authorize' && m === 'POST') {
      const { text } = await ctx.readBody(req, 8192);
      const f = new URLSearchParams(text);
      const pr = pending.get(f.get('pid') || '');
      if (!pr || Date.now() - pr.at > PENDING_TTL) {
        stage('authorize_expired');
        ctx.page(res, 400, 'This request has expired', ['Start connecting again from Muse.']); return true;
      }
      if (f.get('action') !== 'allow') {
        pending.delete(f.get('pid'));
        stage('authorize_denied');
        toClient(ctx, res, pr.redirectUri, { error: 'access_denied', error_description: 'The member declined.', state: pr.state }); return true;
      }
      const em = String(f.get('email') || '').toLowerCase().trim();
      if (d.loginBlocked(req, em)) { stage('authorize_throttled'); consentPage(ctx, res, { pid: f.get('pid'), email: em, err: 'Too many sign-in attempts. Please wait a few minutes and try again.' }); return true; }
      const u = d.q('SELECT * FROM users WHERE email=?').get(em);
      if (!u || !d.checkPass(String(f.get('password') || ''), u.pass)) {
        d.loginFailed(req, em); stage('authorize_bad_password');
        consentPage(ctx, res, { pid: f.get('pid'), email: em, err: 'That email and password do not match.' }); return true;
      }
      d.loginSucceeded(req, em);
      pending.delete(f.get('pid'));
      sweep(codes, CODE_TTL);
      const code = b64url(crypto.randomBytes(32));
      codes.set(code, { at: Date.now(), userId: u.id, clientId: pr.clientId, redirectUri: pr.redirectUri, challenge: pr.challenge, scope: pr.scope });
      stage('authorize_approved', { dcr_client: DCR_ID.test(pr.clientId) });
      toClient(ctx, res, pr.redirectUri, { code, state: pr.state });
      return true;
    }

    if (p === '/oauth/token') {
      if (m !== 'POST') { stage('token_wrong_method'); ctx.json(res, 405, { error: 'invalid_request' }); return true; }
      const started = Date.now();
      const { text } = await ctx.readBody(req, 8192);
      let f;
      if (/json/i.test(String(req.headers['content-type'] || ''))) { let j = {}; try { j = JSON.parse(text) || {}; } catch {} f = new URLSearchParams(Object.entries(j).map(([k, v]) => [k, String(v)])); }
      else f = new URLSearchParams(text);
      // Public clients may also present client_id via HTTP Basic; read the id only.
      let basicId = null;
      const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
      if (basic) { try { basicId = decodeURIComponent(Buffer.from(basic[1], 'base64').toString().split(':')[0]); } catch {} }
      const shape = { grant_type: ctx.str(f.get('grant_type')), param_names: [...new Set([...f.keys()])].slice(0, 20), client_auth: basic ? 'basic' : f.has('client_secret') ? 'post' : 'none', content_type: ctx.str(req.headers['content-type']) };
      const err = (status, error, why) => { stage('token_error', { token: shape, error, why, ms: Date.now() - started }); ctx.json(res, status, { error, error_description: why }); return true; };
      if (f.get('grant_type') !== 'authorization_code') return err(400, 'unsupported_grant_type', 'Only authorization_code is supported.');
      const c = codes.get(f.get('code') || '');
      codes.delete(f.get('code') || '');                      // single use, whatever happens next
      if (!c) return err(400, 'invalid_grant', 'Unknown or already used code.');
      if (Date.now() - c.at > CODE_TTL) return err(400, 'invalid_grant', 'The code has expired.');
      const cid = f.get('client_id') || basicId;
      if (cid && cid !== c.clientId) return err(400, 'invalid_grant', 'client_id does not match the code.');
      if (f.get('redirect_uri') && f.get('redirect_uri') !== c.redirectUri) return err(400, 'invalid_grant', 'redirect_uri does not match the code.');
      const verifier = f.get('code_verifier') || '';
      if (!verifier) return err(400, 'invalid_request', 'code_verifier is required.');
      if (b64url(crypto.createHash('sha256').update(verifier).digest()) !== c.challenge) return err(400, 'invalid_grant', 'PKCE verification failed.');
      const made = d.connectionCreate(c.userId, 'Muse');
      d.q('UPDATE connections SET client_name=? WHERE uid=?').run('Muse (muse.discriminantly.com OAuth)', made.uid);
      stage('token_issued', { token: shape, ms: Date.now() - started });
      ctx.json(res, 200, { access_token: made.token, token_type: 'Bearer', scope: c.scope || 'discriminantly.read discriminantly.write' });
      return true;
    }

    if (p === '/mcp' || p === '/mcp/') {
      const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
      const tok = bearer ? bearer[1].trim() : '';
      if (!tok || !d.connectionFor(tok)) {
        stage(tok ? 'mcp_bad_token' : 'mcp_no_token');
        ctx.json(res, 401, { error: 'invalid_token', error_description: 'Connect your Discriminantly account to continue.' }, {
          'WWW-Authenticate': `Bearer resource_metadata="${ctx.ORIGIN}/.well-known/oauth-protected-resource", error="invalid_token"`,
        });
        return true;
      }
      stage('mcp_forwarded');
      // www's own mcp(), untouched: the connection token goes in as the path
      // credential, and the header is removed so it is not read as www OAuth.
      delete req.headers.authorization;
      await d.mcp(req, res, tok);
      return true;
    }
    return false;
  }

  return { handle, enabled: ENABLED };
}

module.exports = { create, DCR_ID };
