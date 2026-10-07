# Muse OAuth compatibility: discovery

**Status:** discovery only; nothing is implemented. The OpenAI-reviewed surface (`www.discriminantly.com`: `/mcp`, `/.well-known/*`, `/oauth/*`, tools, schemas, descriptions, annotations, server instructions, Skills) is untouched.

| Baseline | |
|---|---|
| Repo | `master` at `3854d07` (v2.68.1) |
| Production | Railway service `discriminantly`, source `github.com/kfx5bwnbfn-blip/discriminantly@main`, live deployment `fbbcf21d` = commit `c22b69d` (corrected 7 Oct: an earlier draft cited `cb5e2ff` from Railway's service config; that commit does not exist on GitHub). `/mcp/` answered 404 at 13:16 UTC and 401 at 14:38 UTC on 7 Oct, so v2.68.1 went live between those times. |
| Evidence window | Railway HTTP logs 12:26–19:54 UTC and app logs 13:12–13:40 UTC, 7 Oct 2026 (09:12–09:40 Toronto) |

Evidence is labelled throughout:

- **[observed]** in our own logs or code;
- **[Muse]** stated by the Muse agent or the Muse team;
- **[public]** third-party public sources, cited;
- **[unknown]** not yet established.

---

## 1. Current authorization architecture

Discriminantly is its own OAuth 2.1 authorization server, for exactly one resource and one scope (`server.js`, "OAuth 2.1 authorization", around line 2443).

| Element | Value |
|---|---|
| Issuer / origin | `PUBLIC_ORIGIN` = `https://www.discriminantly.com`. **A process-wide constant, not derived from the request's `Host`.** |
| Resource | `MCP_RESOURCE()` = `https://www.discriminantly.com/mcp` |
| Scope | one: `discriminantly` (full read and write) |
| Protected-resource metadata | `GET /.well-known/oauth-protected-resource` → `{resource, authorization_servers:[origin], scopes_supported:['discriminantly'], bearer_methods_supported:['header'], resource_documentation}`. Root only; no path-suffixed variant. |
| AS metadata | `GET /.well-known/oauth-authorization-server` → `issuer`, `authorization_endpoint`, `token_endpoint`, `response_types ['code']`, `grant_types ['authorization_code','refresh_token']`, `code_challenge_methods ['S256']`, `token_endpoint_auth_methods ['none']`, **`client_id_metadata_document_supported: true`**, `authorization_response_iss_parameter_supported: true`, `scopes_supported`. **No `registration_endpoint`.** |
| Client identification | **CIMD only.** `cimdValidate`: `client_id` must match `^https://`; the document is fetched without following redirects (5 s timeout) and cached for 1 hour; `doc.client_id` must equal the URL; `redirect_uri` must be listed in `doc.redirect_uris`. |
| `/oauth/authorize` | Checked in order, each failure a **400 HTML page** (never redirected): missing `client_id`/`redirect_uri` → `code_challenge_method !== 'S256'` → missing challenge → `resource !== MCP_RESOURCE()` (exact match, so `…/mcp/` fails) → any scope other than `discriminantly` → `cimdValidate`. Then login if needed, a consent page, a `connections` row (`auth_kind 'oauth'`), and a code (60 s, single use, bound to client, redirect, challenge, resource, scope). The redirect carries `code`, `state` and `iss`. |
| `/oauth/token` | `authorization_code` (exact `client_id` and `redirect_uri`, optional `resource` must match, PKCE S256) and `refresh_token` (rotation; reuse revokes the family). Access token 1 h, refresh 60 days, opaque, stored as hashes. |
| `/mcp` (bearer) | `oauthResolveAccess(token, MCP_RESOURCE())`: kind, revocation, expiry, **audience = resource**, scope includes `discriminantly`, connection active. Failure → 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`. |
| `/mcp/<token>` | Personal connector address: a per-client bearer `connections` row first, otherwise the member's legacy `users.api_token`. **The secret is in the URL path.** |
| Freeze guard | `test/mcp-freeze.js` fingerprints the source of three regions: OAuth core (`OAUTH_SCOPE` … `clientInfoFrom`), the MCP route lines, and discovery plus OAuth routes, plus `plugin/`. The live guard `test/mcp-contract.js` checks the tool and result contract; `test/plugin-audit.js` checks OAuth privacy end to end. |

---

## 2. The captured Muse handshake

All times UTC, 7 Oct 2026. Source addresses `104.28.*` are a Cloudflare egress range shared by every non-browser request from Muse's agent sandbox in this window: curl, Python, and a headless Linux Chrome. `142.188.35.78` is the address Brian's iPhone used.

| Time | Request | Status | User agent | Reading |
|---|---|---|---|---|
| 13:13:20 | `GET /mcp/` | 404 | `facebookexternalhit/1.1` | Link preview of the pasted address (the slash form, pre-fix) |
| 13:13:30 | `GET /mcp/` | 404 | `meta-webindexer/1.1` | Meta indexer preview |
| 13:14:08 | `GET /mcp/` | 404 | Linux Chrome (sandbox) | Muse probing the address it was given |
| 13:14:48 | `GET /.well-known/oauth-protected-resource` | 200 | Linux Chrome (sandbox) | **Root** protected-resource metadata read |
| 13:14:51 | `GET /.well-known/oauth-authorization-server` | 200 | Linux Chrome (sandbox) | AS metadata read |
| 13:15:31, 13:15:56, 13:16:58 | `GET /oauth/authorize` | **400** | iPhone Safari | Three authorization attempts in Brian's browser, each refused by a request-validation check |
| 13:16:28–30 | `GET`/`POST /mcp` → 401; `GET`/`POST /mcp/` → 404 | | curl (sandbox) | Muse diagnosing |
| 13:17:30 | both `/.well-known` documents | 200 | curl (sandbox) | Re-read while diagnosing |
| 13:20:51 → | `POST /mcp/<personal token>` | 200 | curl, then `Python-urllib/3.12` | **The working path:** the personal connector address. The app log shows `initialize protocol=2024-11-05 client=muse/1.0 caps=-`, then `tools/list` and `tools/call`. |
| 14:56–18:08 | ~110 `POST /mcp/<personal token>` | 200 | `Python-urllib/3.12` | Ongoing dogfooding through the same path, from two egress ranges |

**Findings:**

- **[observed] No dynamic-registration attempt reached us.** No request in the window was a `POST` to any path other than `/mcp`, `/mcp/<token>` and `/oauth/token` (the last from `openai-connectors-oauth/1.0`, ChatGPT's normal refresh). That's expected: our AS metadata has no `registration_endpoint`, so a client that needs DCR has nowhere to register.
- **[observed] An authorization request was made anyway, and failed in validation.** Three `GET /oauth/authorize` → 400. Railway's HTTP log omits query strings and our app doesn't log OAuth requests, so **which check failed is [unknown]**. Candidates, in our check order:
  1. a missing `client_id`/`redirect_uri`;
  2. PKCE not S256;
  3. `resource` not exactly `…/mcp` (likely if Muse sent the address it was given, `…/mcp/`);
  4. a scope other than `discriminantly`;
  5. `client_id must be an https URL` (what Muse's own report describes);
  6. an unregistered redirect.
- **[observed] It's [unknown] whether those three requests came from Muse's connector or from Muse's agent improvising.** The agent read our metadata 40 seconds earlier and later says it "diagnosed the OAuth issue in one shot". Either way, the client that made them wasn't using CIMD.
- **[Muse]** Their report: "their platform not sending https-URL client IDs", "the vault card erroring", and a recommendation to add RFC 7591 DCR.
- **[public]** Independent integrators report the same pattern for Muse custom connectors:
  - Muse performs discovery, then **Dynamic Client Registration** at the server's registration endpoint, then sign-in;
  - its callback is **`https://agent.meta.ai/api/hatch/oauth/callback`**;
  - a server whose `/register` refuses that host makes Muse show "The provider rejected the automatic app registration".

  Muse's code SDK tracks CIMD as a follow-up, which implies it isn't supported yet. See [unsubject/2nd-brain#78](https://github.com/unsubject/2nd-brain/pull/78), [pensados/sentinelx-cloud-core#49](https://github.com/pensados/sentinelx-cloud-core/issues/49), [harvouscom/harvous#221](https://github.com/harvouscom/harvous/pull/221) and [meta-models/muse-code-sdk#15](https://github.com/meta-models/muse-code-sdk/issues/15).
- **[observed] Protocol detail.** The sandbox's hand-written client used protocol `2024-11-05` and sent `notifications/initialized` *with an id*, which our dispatcher answers with `-32601`. It was harmless (the session continued), but a Muse-facing endpoint should accept it.

### The ten questions

| # | Question | Answer | Basis |
|---|---|---|---|
| 1 | Discovery documents requested | Root `/.well-known/oauth-protected-resource`, then `/.well-known/oauth-authorization-server`, after `/mcp/` returned 404. No path-suffixed (RFC 9728 §3.1) or OpenID configuration requests. | observed |
| 2 | Authorization metadata read | Ours, which advertises CIMD and no `registration_endpoint` | observed |
| 3 | Looks for or attempts DCR? | Attempted: none against us (nothing to attempt). Requires it: very likely. | observed / Muse / public |
| 4 | Registration request | Not captured. Publicly reported to include `redirect_uris` and `client_name`; another report says `scope` may be omitted. | unknown / public |
| 5 | Redirect URI | `https://agent.meta.ai/api/hatch/oauth/callback` (to verify in capture) | public |
| 6 | PKCE | Not captured. Muse's connector form lists "OAuth with PKCE". | unknown / public |
| 7 | Scopes requested | Not captured | unknown |
| 8 | Refresh tokens | Not captured. Our token endpoint already supports rotation. | unknown |
| 9 | Exact failure point | `/oauth/authorize` request validation (400), before login or consent. The specific check is unknown; the most likely are `client_id must be an https URL` and resource `…/mcp/` ≠ `…/mcp`. Upstream, the connector couldn't register, because no registration endpoint exists. | observed + inference |
| 10 | Supports CIMD at all? | Not today, on the evidence: the request that reached us wasn't CIMD, and Muse's SDK lists CIMD as future work. Treat as **DCR-only** until shown otherwise. | Muse / public |

**Before any build, close the unknowns with Phase 0 (§9).** Brian re-adds the connector in Muse against the isolated origin, which logs the registration body and the authorization parameters without issuing anything. Fallback: open the connector in Muse once more, copy the error text on the 400 page (it names the failed check), and copy the authorize address from the phone's address bar (it shows `client_id`, `redirect_uri`, `scope`, `resource` and `code_challenge_method`).

---

## 3. The incompatibility

Our AS implements one registration model, CIMD. Muse implements, as far as the evidence shows, only RFC 7591 DCR, with an opaque `client_id`. The MCP specification's client priority order is:

1. pre-registered credentials;
2. CIMD, if the AS advertises `client_id_metadata_document_supported`;
3. DCR, if the AS advertises `registration_endpoint`;
4. ask the user.

A DCR-only client facing a CIMD-only AS therefore has no automatic path, which matches "the vault card erroring". A secondary hazard independent of DCR: our `resource` check is an exact string match against `…/mcp`, so a client that reuses the address it was given (`…/mcp/`) is refused at authorize, even though v2.68.1 now serves `/mcp/`.

## 4. CIMD versus DCR

- **Current MCP specification (2026-07-28 revision, client registration):**
  - Client ID Metadata Documents are the recommended default ("authorization servers SHOULD support").
  - **"Dynamic Client Registration is deprecated. New implementations should use Client ID Metadata Documents instead. This option remains available for backwards compatibility."**
  - DCR clients MUST send `application_type`.
  - Credentials obtained by DCR must be keyed to the issuer.
- **Implication:** keep CIMD as our primary model; don't replace it globally to suit Muse. Adding DCR to the *reviewed* AS would change its metadata, the very document OpenAI's scanner reads. It would also open an unauthenticated write endpoint on the production issuer, for a capability OpenAI's client doesn't use.
- **DCR in isolation is reasonable:** a bounded compatibility shim for one client family, on an issuer of its own.
- **Pre-registration is the alternative:** a static `client_id` we issue to Muse. Muse's custom-connector UI doesn't appear to offer it (it registers automatically), so it doesn't solve the custom-connector path.

## 5. Proposed isolation architecture

### 5.1 Same origin, separate path: rejected as weaker isolation

A second issuer can technically live under the current origin with path-suffixed documents: `/.well-known/oauth-protected-resource/muse/mcp`, and an issuer `https://www.discriminantly.com/muse` with `/.well-known/oauth-authorization-server/muse`. The root documents would stay byte-identical. It's still the weaker option:

- **Discovery bleeds into the reviewed documents.** Muse fetched the **root** protected-resource document (§2), and many clients fall back to root documents. A Muse client could read the OpenAI issuer's metadata (CIMD only, resource `…/mcp`) and fail in the same way, or bind to the wrong issuer.
- **The reviewed region gets busy neighbours.** OAuth routes on the same host sit next to the fingerprinted ones; a routing mistake affects `www` directly.
- **Shared host:** shared cookies and shared Origin handling. A `/muse/oauth/authorize` page under `www` also looks, to OpenAI's scanner or a reviewer, like a second OAuth surface on the reviewed host.

### 5.2 Separate origin: recommended

```
                ┌──────────── www.discriminantly.com  (OpenAI-reviewed; unchanged) ────────────┐
ChatGPT ──────► │ /.well-known/oauth-*  (CIMD, scope "discriminantly", resource …/mcp)         │
                │ /oauth/authorize · /oauth/token · /mcp · /mcp/<token>                        │
                └───────────────────────────────┬──────────────────────────────────────────────┘
                                                │ same process, same database, same domain code
                ┌───────────────────────────────┴──────────────────────────────────────────────┐
Muse ─────────► │ muse.discriminantly.com   (new; inert unless MUSE_ORIGIN is set)             │
                │ /.well-known/oauth-protected-resource  → resource https://muse…/mcp          │
                │ /.well-known/oauth-authorization-server → issuer https://muse…,              │
                │      registration_endpoint, CIMD also supported, scopes read/write           │
                │ /oauth/register (RFC 7591, locked down) · /oauth/authorize · /oauth/token    │
                │ /mcp  → same tool implementations, permissions, provenance                   │
                │ /login · /join · static assets  (the ordinary pages, host-scoped session)    │
                │ everything else → redirect to www                                            │
                └──────────────────────────────────────────────────────────────────────────────┘
```

**Mechanics:**

- **Host dispatch.** The first statement of `handle()`:

  ```js
  if (MUSE_HOST && host === MUSE_HOST) return museHandle(…)
  ```

  It sits outside every fingerprinted region. When `MUSE_ORIGIN` is unset, the branch can't be taken. A `www` request never enters it.
- **Own metadata and issuer:**
  - built from `MUSE_ORIGIN`, never `PUBLIC_ORIGIN`;
  - `resource = https://muse.discriminantly.com/mcp`, accepted with or without a trailing slash, on this origin only;
  - path-suffixed variants served too.
- **Same accounts:**
  - members sign in with the ordinary `/login` and `/join` pages served on the Muse host;
  - the session cookie is host-only, so a member signs in once on `muse.`;
  - **no change to the `www` cookie** (no `Domain=.discriminantly.com`).

  `oauthNext` already accepts `/oauth/authorize?…`, the same path on the Muse host.
- **Own consent page.** "Meta Muse wants to connect…", with the requested access (read only, or read and change). The label is derived from the **registered redirect origin** (`agent.meta.ai` → "Meta Muse"), never from a self-asserted `client_name`, mirroring `cimdLabel`.
- **Shared storage, separated by audience:**
  - codes and tokens go into the existing `oauth_codes` and `oauth_tokens` with `resource = https://muse…/mcp`;
  - `www`'s `oauthResolveAccess` requires `resource === https://www…/mcp`, so **Muse tokens are useless at `www/mcp`**;
  - the Muse resolver requires the Muse resource, so ChatGPT tokens are useless at `muse/mcp`;
  - connections remain one table, and Settings lists "Meta Muse" beside ChatGPT, with the same Revoke.
- **Same domain behaviour:**
  - the Muse `/mcp` authenticates its own tokens, then hands `{user, conn, authMethod: 'oauth'}` to the **same dispatcher**;
  - provenance records `ai_on_behalf`, `agent` from the connection (`meta-muse`) and `connection_uid`, exactly as for other clients;
  - no separate data and no forked semantics.
- **The one code movement on the shared path.** Today `mcp(req, res, tok)` authenticates and then dispatches in one function. It is split into `mcpAuthenticate` (unchanged logic) and `mcpServe(req, res, {user, conn, authMethod})` (the existing body, unchanged). `mcp()` becomes a two-line composition of the two. Nothing is fingerprinted there, and §8 proves the observable behaviour byte for byte.
- **Muse-path protocol tolerance:** `notifications/initialized` sent with an id is acknowledged rather than answered `-32601`. This lives in the Muse wrapper only; the shared dispatcher keeps its current reply.

### 5.3 DCR on the Muse issuer (only if Phase 0 confirms Muse needs it)

`POST /oauth/register` (RFC 7591), public clients only:

| Rule | Reason |
|---|---|
| `redirect_uris` must exactly equal an allow-listed callback, initially `https://agent.meta.ai/api/hatch/oauth/callback` (confirmed in Phase 0). Refused: other hosts, sub-paths, queries, `http`, look-alikes. | Without this, DCR is an open door: anyone could register a client that redirects codes to themselves under a "Meta Muse" label |
| `token_endpoint_auth_method` must be `none`; no client secret is issued; PKCE S256 is mandatory at authorize | Public client; possession of the code needs the verifier |
| `grant_types` ⊆ `authorization_code`, `refresh_token`; `response_types` = `code`; `application_type` recorded | Spec conformance |
| `client_id` = 32 random bytes; stored in a new `oauth_clients` table (`client_id`, `redirect_uris`, `client_name` as sent, `registered_label`, `scope`, `created_at`, `last_used_at`, `created_ip_hash`) | Opaque IDs are what Muse sends |
| Rate limit per network (as `signupAllowed`), cap total registrations, refusals logged in a bounded and rate-limited way | The public reports note log flooding through refused registrations |
| Unused registrations expire (30 days); re-registration is cheap | Muse may register on every connect |
| CIMD stays accepted on this issuer too (`client_id_metadata_document_supported: true`) | When Muse adds CIMD, no change is needed |

## 6. Security

- **Blast radius.** Everything new is reachable only through `muse.discriminantly.com`. With `MUSE_ORIGIN` unset, nothing new is reachable at all.
- **Token audience** prevents cross-use between the two issuers (§5.2). A stolen Muse token works only at `muse/mcp`, with its scope.
- **Same member protections:**
  - login throttle;
  - consent before any code;
  - per-connection revocation (which kills that connection's tokens immediately);
  - refresh rotation with family revocation on reuse.
- **Phishing risk of DCR:** contained by the exact redirect allow-list and by deriving the consent label from the redirect origin.
- **Session isolation.** A host-only cookie on `muse.` means that page can't read or ride the `www` session, and vice versa. Both hosts keep the existing cross-origin POST refusal, `SameSite=Lax`.
- **Personal connector address.** It is a long-lived bearer secret in a URL. It's in Railway's HTTP logs from this session and in Muse's sandbox history. Once OAuth works, Brian should **replace it** (Settings → Replace connector URL), and the docs should present it as a fallback, not the recommended route.
- **Host header.** Railway routes by host; a forged `Host: muse…` against `www`'s address just gets the public Muse surface.

## 7. Scope model

On the Muse issuer only. The `www` issuer keeps its single `discriminantly` scope and its current checks.

| Scope | Grants | Tools |
|---|---|---|
| `discriminantly.read` | Read everything the member has kept, including private items (as today) | The 18 tools annotated `readOnlyHint: true`: `my_notes`, `my_travel_marks`, `my_collections`, `my_itineraries`, `search_catalogue`, `catalogue_stats`, `recent_notes`, `list_ensembles`, `get_ensemble`, `list_unresolved_components`, `list_checkins`, `read_comments`, `view_images`, `verify_place`, `list_recommendations`, `list_stop_notes`, `audit_itinerary`, `audit_recommendation_expansion` |
| `discriminantly.write` (implies read) | Read, plus add, change and remove on the member's behalf | All 67 |

**How the scopes behave:**

- **Enforcement** uses the submitted, reviewed annotations, so the definitions themselves are untouched.
  - A read-only connection's `tools/list` shows only the 18.
  - A `tools/call` of any other tool is refused ("This connection is read-only. Reconnect with change access to do that."). The tool body never runs.
- **The member chooses** read only or read and change on the consent page. Muse's "offer Read Only" guidance maps here directly.
- **A missing scope** (reported Muse behaviour) defaults to **read**, the safer default. Change access is granted only when it's requested or the member chooses it.
- **Unsupported scopes** are refused at authorize with `invalid_scope`.
- **The legacy scope** `discriminantly` is accepted on the Muse issuer as a synonym for write, so a client copying `www`'s metadata still works.
- **`www` is unaffected:** its metadata, scope checks, `oauthResolveAccess` and every existing token stay exactly as they are.

## 8. What changes, and proof that `www` is untouched

**Files and routes (all additive except the `mcp()` split):**

| Change | Where | Reviewed surface? |
|---|---|---|
| `MUSE_ORIGIN`/`MUSE_HOST` configuration, `museHandle()` | new block in `server.js`, and one dispatch line at the top of `handle()` | No: outside the fingerprints; inert when unset |
| Muse metadata, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/mcp` (Muse host only) | inside `museHandle()` | No |
| `oauth_clients` table (migration 062, additive) | migrations | No (a new table; existing ones unchanged) |
| Reuse of `oauthIssueCode`, `oauthIssueTokens`, `oauthRevokeFamily`, `pkceMatches`, `tokenHash` | called, not edited | No (fingerprints identical) |
| `mcp()` split into `mcpAuthenticate` + `mcpServe` | around line 12755 | Same behaviour; proven below |
| Settings: the connection shows as "Meta Muse" | existing rendering (label from the connection) | No |
| Docs: the support page says DCR clients use `muse.discriminantly.com/mcp` | web copy | No |
| Tests: `test/muse-oauth.js` (new), static isolation checks in `test/itinerary.js` | tests | — |

**Proof obligations (each automated):**

1. **Fingerprints:** `node test/mcp-freeze.js` passes with **no re-record**. OAuth core, the MCP routes, discovery plus OAuth routes, and `plugin/` are byte-identical.
2. **Byte-identical `www` responses, before and after, Muse enabled:**
   - `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`;
   - 401 bodies and `WWW-Authenticate` for `/mcp` and `/mcp/`;
   - `/oauth/authorize` responses for each validation failure;
   - `/oauth/token` error bodies;
   - a full CIMD round trip (`test/oauth-signup.js`, 40/40).
3. **MCP contract:**
   - `test/mcp-contract.js` (founder and another member) matches the v2.61 snapshot;
   - historical guard unchanged;
   - `test/skills-import.js` and the Skill hashes unchanged;
   - `tools/list` over `www` hashes identically before and after.
4. **Privacy audit:** `test/plugin-audit.js` 20/20 through `www` OAuth.
5. **Isolation:**
   - with `MUSE_ORIGIN` unset, `Host: muse…` gets nothing new;
   - with it set, `www` requests never enter `museHandle` (static check that the dispatch is an exact host comparison and the first statement);
   - a Muse token is refused at `www/mcp` (401) and a `www` token at `muse/mcp`.

## 9. Test plan

- **Phase 0, capture (before the full build).**
  - Deploy only the Muse host with both metadata documents (advertising `registration_endpoint`), a `/oauth/register` and an `/oauth/authorize` that **log the request** and then show "Test mode: nothing was connected".
    - Logged: method, path, user agent, registration JSON, and the authorize parameters `client_id`, `redirect_uri`, `scope`, `resource`, `code_challenge_method`, `response_type`.
    - Never logged: code, state, verifier or token values.
  - No codes or tokens are issued.
  - Brian adds the connector in Muse once, which answers §2's unknowns (4–8 and 10) from evidence.
- **Unit and integration (`test/muse-oauth.js`, its own server with `MUSE_ORIGIN` set):**
  - discovery documents on the Muse host;
  - DCR accept and refuse (exact callback, sub-path, query, `http`, look-alike, unknown host, secret requested, bad grant types, rate limit);
  - authorize: opaque `client_id` accepted only if registered, redirect must match, S256 required, resource with or without slash, `invalid_scope`, consent shows "Meta Muse" plus the access level;
  - token: code exchange, refresh rotation, reuse revokes the family;
  - read-only `tools/list` = 18, a write call refused, a write token = 67 tools;
  - provenance records `agent meta-muse`, `connection_uid`, `ai_on_behalf`;
  - Settings revoke kills the Muse tokens;
  - `notifications/initialized` with an id is acknowledged.
- **Isolation suite:** §8 obligations 1–5, run with `MUSE_ORIGIN` set and unset.
- **Regression:** static suite, activation, the v2.67 parity run, adoption, recommendations, tool audit, lifecycle, Increment 4, place identity, Skills import, live contract guards.
- **Host test:** in Muse, add `https://muse.discriminantly.com/mcp`, sign in, choose read only, list tools and search the catalogue; reconnect with change access and keep a test note; then revoke in Settings and confirm Muse loses access.

## 10. Deployment and rollback

**Deploy (click-through):**

1. **DNS.** At the domain registrar, add a CNAME for `muse` pointing to the target Railway shows when the custom domain is added.
2. **Railway.** In the `discriminantly` service → Settings → Networking, add the custom domain `muse.discriminantly.com` and wait for its certificate.
3. **Variable.** Set `MUSE_ORIGIN=https://muse.discriminantly.com`. Phase 0 also sets `MUSE_CAPTURE=1` and later removes it.
4. **Upload** the change package as usual. The migration adds the `oauth_clients` table only.
5. **Verify** with the three host checks in §9.

**Rollback, in increasing order of effort:**

1. Unset `MUSE_ORIGIN`. The code goes inert; Muse tokens stop working because no endpoint accepts their audience. `www` is unaffected.
2. Remove the custom domain.
3. Revert the package. The `oauth_clients` table can stay; nothing else reads it.

None of these touches `www`, the plugin submission or member data.

---

## Recommendation: **A. Safe to implement while the OpenAI review remains active**

- **Isolation is by origin, not by path.** The OpenAI-reviewed issuer, its metadata, the OAuth routes, the MCP routes, the tools and the Skills are byte-identical. The fingerprint guard proves it without re-recording.
- **Inert unless switched on.** The new surface is reachable only on a host OpenAI never sees, behind a variable whose removal is a complete rollback.
- **Audience-bound tokens.** The two issuers can't use each other's tokens, and read and write scopes exist only on the Muse issuer.
- **The one shared-code change is behaviour-preserving.** It splits `mcp()` into authenticate and serve, and is guarded by the live contract tests, the privacy audit and byte comparisons of every `www` response.

**Two conditions are part of the recommendation:**

1. **Phase 0 runs first.** We have observed the failure but not Muse's registration request. The capture origin must confirm that Muse performs DCR, its exact callback, its PKCE method and its scope behaviour before `/oauth/register` accepts anything.
2. **Every proof obligation in §8 passes** with `MUSE_ORIGIN` set and unset before the package ships.

If either condition fails, for example if isolation needed changes inside a fingerprinted region, the answer becomes **B** for that part.

*Sources for public Muse behaviour:*

- [unsubject/2nd-brain#78](https://github.com/unsubject/2nd-brain/pull/78)
- [pensados/sentinelx-cloud-core#49](https://github.com/pensados/sentinelx-cloud-core/issues/49)
- [harvouscom/harvous#221](https://github.com/harvouscom/harvous/pull/221)
- [meta-models/muse-code-sdk#15](https://github.com/meta-models/muse-code-sdk/issues/15)
- [AnythingMCP: Muse custom connectors](https://anythingmcp.com/guides/clients/muse)
- [MCP specification 2026-07-28: client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration.md)
