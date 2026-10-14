// Sign in with Apple (v2.101). The web flow: authorize at Apple, Apple posts
// the code back (response_mode=form_post), we exchange it with a client
// secret we sign ourselves (ES256, with the .p8 key from the Apple Developer
// site), then verify the returned id_token against Apple's published keys.
// No dependencies: node:crypto and fetch.
//
// Inert unless all four settings are present:
//   APPLE_CLIENT_ID    the Services ID (e.g. com.discriminantly.web)
//   APPLE_TEAM_ID      the 10-character Team ID
//   APPLE_KEY_ID       the Key ID of the Sign in with Apple key
//   APPLE_PRIVATE_KEY  the .p8 file's contents (newlines may be written as \n)
// APPLE_AUTH_ORIGIN overrides https://appleid.apple.com (tests only).
//
// Never logged: codes, tokens, the client secret, state, nonces.
const crypto = require('crypto');

const env = () => ({
  clientId: (process.env.APPLE_CLIENT_ID || '').trim(),
  teamId: (process.env.APPLE_TEAM_ID || '').trim(),
  keyId: (process.env.APPLE_KEY_ID || '').trim(),
  key: (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim(),
  origin: (process.env.APPLE_AUTH_ORIGIN || 'https://appleid.apple.com').replace(/\/+$/, ''),
});
const enabled = () => { const e = env(); return !!(e.clientId && e.teamId && e.keyId && e.key); };
const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

// The client secret: a short-lived JWT signed with the Apple key.
function clientSecret(now = Math.floor(Date.now() / 1000)) {
  const e = env();
  const head = b64u({ alg: 'ES256', kid: e.keyId, typ: 'JWT' });
  const body = b64u({ iss: e.teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: e.clientId });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: e.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}

function authorizeUrl({ redirectUri, state, nonce }) {
  const e = env();
  const p = new URLSearchParams({ response_type: 'code', response_mode: 'form_post', client_id: e.clientId, redirect_uri: redirectUri, scope: 'name email', state, nonce });
  return `${e.origin}/auth/authorize?${p.toString().replace(/\+/g, '%20')}`;   // Apple documents %20 in scope
}

let jwksCache = { at: 0, keys: [] };
async function appleKeys(force = false) {
  if (!force && jwksCache.keys.length && Date.now() - jwksCache.at < 6 * 3600e3) return jwksCache.keys;
  const r = await fetch(`${env().origin}/auth/keys`);
  if (!r.ok) throw new Error('Apple keys unavailable');
  jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}

// Verify an id_token: signature (RS256, Apple's key by kid), issuer,
// audience, expiry and nonce. Returns its claims.
async function verifyIdToken(idToken, nonce) {
  const e = env();
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (head.alg !== 'RS256') throw new Error('Unexpected algorithm');
  let jwk = (await appleKeys()).find((k) => k.kid === head.kid);
  if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === head.kid);   // keys rotate
  if (!jwk) throw new Error('Unknown signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('Bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== 'https://appleid.apple.com') throw new Error('Wrong issuer');
  if (claims.aud !== e.clientId) throw new Error('Wrong audience');
  if (!(claims.exp > now - 60)) throw new Error('Expired');
  if (nonce && claims.nonce !== nonce) throw new Error('Nonce mismatch');
  if (!claims.sub) throw new Error('No subject');
  return claims;
}

// Exchange the authorization code; returns the verified id_token claims.
async function exchange({ code, redirectUri, nonce }) {
  const e = env();
  const r = await fetch(`${e.origin}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: e.clientId, client_secret: clientSecret() }) });
  if (!r.ok) throw new Error(`Apple token exchange failed (${r.status})`);
  const j = await r.json();
  return verifyIdToken(j.id_token, nonce);
}

// Small signed cookies: the flow's state, and a pending sign-up.
function seal(secret, obj) { const v = b64u(obj); return `${v}.${crypto.createHmac('sha256', secret).update(v).digest('base64url').slice(0, 32)}`; }
function unseal(secret, s, maxAgeMs) {
  const [v, mac] = String(s || '').split('.');
  if (!v || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(v).digest('base64url').slice(0, 32);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let o; try { o = JSON.parse(Buffer.from(v, 'base64url').toString()); } catch { return null; }
  return o && typeof o.t === 'number' && Date.now() - o.t <= maxAgeMs ? o : null;
}

module.exports = { enabled, clientSecret, authorizeUrl, exchange, verifyIdToken, seal, unseal };
