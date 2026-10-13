# Muse OAuth: wrapper experiments (Oct 8, 2026)

**Result:** Meta's iOS callback receives a valid code and state and never requests a token, whatever we send. Nothing left to change on our side; waiting on Meta. The wrapper is built, tested and switched off (`MUSE_WRAPPER=0`).

## The wrapper (v2.73, v2.73.1)
- `muse-wrapper.js`: a real OAuth authorization server on `muse.discriminantly.com` only, off unless `MUSE_WRAPPER=1`.
- DCR (accepts only Meta's callback; stateless `muse-dcr-<16 hex>` ids), sign-in and consent on the Muse origin (www's password check and login throttle), PKCE S256 code exchange to an ordinary revocable "Muse" connection, `/mcp` handed to www's unchanged `mcp()`.
- Switches: `MUSE_SEND_ISS=0` drops `iss`; `MUSE_ADVERTISE_CIMD=0` stops advertising client-card support.
- www OAuth/MCP untouched: freeze identical, MCP contract matches, live probes identical. `test/muse-wrapper.js`: 26 checks.
- v2.73.1: Allow is the consent form's first button (iOS autofill and Go were submitting Cancel).

## Attempts (UTC, Oct 8). Every Allow redirected to `https://agent.meta.ai/api/hatch/oauth/callback` with a valid code and the original state
| Test | Server | Client ID | `iss` | Client auth | Approved | Token request |
|---|---|---|---|---|---|---|
| retry on www | www | client card URL | on | none | 11:42:33 | none |
| A | wrapper | client card URL | on | none | 11:57:08, 11:57:21 | none |
| B | wrapper | client card URL | off | none | 12:03:00, 12:03:08 | none |
| C | wrapper | `muse-dcr-…` (plain) | on | none | 12:08:26, 12:08:39 | none |
| D | wrapper | `muse-dcr-…` | on | secret requested of Muse | 12:14:15 | none |

- Pattern: ~6 s after each redirect the app reopens the authorize page (the callback fails fast, then restarts the flow). No request from Meta's servers reaches either origin.
- DCR could not be exercised: Muse's form requires a Client ID, so it never calls `/oauth/register`.

## Line for the Meta bug report
> Also reproduced against a second, independently implemented authorization server (muse.discriminantly.com) on Oct 8, 11:57–12:14 UTC: with and without the RFC 9207 `iss` parameter, with a URL (CIMD) and an opaque client_id, and with a confidential-client configuration requested. Each redirect to the callback carried a valid `code` and the original `state`; the app reopened authorization ~6 s later; no token request was ever made.

## Next
- Wait for Meta. If they name a requirement, test it by flipping the wrapper back on (`MUSE_WRAPPER=1`); www stays untouched.
- Meanwhile: the personal connection address (Settings → Connect to your AI → name it Muse).
- Housekeeping: revoke any stray "Muse" connections in Settings (none were issued by the wrapper; www's earlier consent rows remain).

## Update, Oct 12, 2026: OAuth closed; Muse connects with a key

- **Test E, 302 instead of 303** (`iss` on, CIMD client): approvals at 13:12:47.99, 13:12:58.34 and 13:13:24.83 UTC were each answered with a 302 carrying code, state and iss. No token request followed. Ruled out.
- **Test F, DCR from chat:** this Muse build errors before it attempts registration. `/oauth/register` was never called. Closed.
- **Totals:** twelve approvals across two authorization servers, with `iss` on/off, 303/302, a CIMD URL and an opaque client_id, and public and confidential configurations. None produced a token request.
- **Decision:** ship the Muse connector on API keys (v2.82, `MUSE_KEYS=1`, OAuth wrapper off).
  - `https://muse.discriminantly.com/mcp` accepts a Settings connection key as `Authorization: Bearer` or `X-API-Key`.
  - The key is hashed and revocable per connection.
  - In key mode no OAuth discovery is advertised.
- **Verified live, 13:36 UTC:** Muse called `tools/list` (13:36:11) and then `tools/call` (13:36:17) with the key as a bearer header, and got real data back. Muse first registered the connector under a fresh name; its earlier registration under the old name had failed.
- **Submission:** connection type Existing MCP, URL `https://muse.discriminantly.com/mcp`, auth API keys. OAuth stays parked until Meta fixes its callback; `MUSE_WRAPPER=1` turns the wrapper back on for a retest.

## Integration test (ChatGPT's plan, run by Muse), Oct 12, 2026: ready for dogfooding

- **Phases 1–10 run against `https://muse.discriminantly.com/mcp`** with a full-access key; read-only checks used a read-only key (v2.83).
- **Result:** Connection, Read, Write, Planning and Semantic boundaries pass. Muse made 25 tool decisions and none was wrong.
- **One material finding:** writes recorded `agent: "unknown"`, because Muse calls tools without the MCP `initialize` handshake. Fixed in v2.84: an unnamed key on the Muse address is named "Muse". Live-verified (`agent: "muse"`).
- **Privacy / revocation: partial.**
  - 7.1–7.3 pass.
  - 7.4 is covered by automated tests; for the live check, revoke the read-only key and confirm the refusal.
  - 7.5: read-only keys are refused at www; full-access keys are not. Binding Muse keys to the Muse address is a pending decision.
  - 7.6 is covered by tests (a non-connection bearer gets 401 on the Muse address).
- **Backlog (affects tools the ChatGPT plugin also uses, so it goes in the held batch):**
  - `my_travel_marks` keyword search also matches description text.
  - "Visited recently" takes two steps, because `list_checkins` needs a mark_id.
- **Cleanup:** the test records were deleted; checked from a separate client.

## Submitted, Oct 13, 2026

- **Submitted to Meta's connector platform** (muse.ai/platform). Business verification, the data-processing questionnaire and the integration credentials are all "In review". Pipeline: In review → Testing → Approved.
- **Facts filed:** endpoint `https://muse.discriminantly.com/mcp` (Existing MCP), API key as `Authorization: Bearer`; reviewer account `musereview@meta.com` with a dedicated, revocable key labelled "Muse test" and a synthetic corpus (6 marks, 2 check-ins, 4 notes, 1 Naples itinerary, 3 recommendations); operator Brian Gerard Elicierto, individual; support and security contact brianelicierto@mac.com; privacy, terms and support live.
- **Data-processing answers as filed:** categories account identifiers, user-generated content, content returned to the user, precise location the only sensitive category; purpose ordinary read/write; retention until the member deletes; deletion excludes logs, backups and subprocessors; international transfers on a contract-performance basis; subprocessors Railway and Photon (Komoot, place details only); no documented process for government requests.
- **Two precisions for the packet**, so nothing said in review contradicts the code:
  1. **"Provenance traces survive"** is true of deleting a record (the history keeps that it existed and was removed) but not of deleting an account: since v2.86 account deletion removes the history of everything the account owned and did. Logs and backups are the only traces that outlast an account.
  2. **"Precise location"** means the coordinates of the places a member keeps and visits, which together record where they have been. The member's live location is never collected.
- **Production unchanged:** v2.87 (`476cb90`). Nothing in the submission required code.
- **Form quirk:** the API-key field rejects non-ASCII; iOS Live Text turned the key's hyphens into em dashes.
- **Still open:** 7.4 live revocation check; 7.5 (full-access Muse keys also work at www's personal-address route; a decision, not a defect); 7.6 is covered by automated tests (a www OAuth token is refused at the Muse resource with 401); cross-client reads.
- **After approval:** revoke the "Muse test" key.
- **Undecided:** self-serve data export vs the current email request.
