# Muse Connector submission: final technical verification (Oct 13, 2026)

Inspected the production source at `476cb90` (v2.87, deployed). Inspection only: no code, tool metadata or behaviour was changed.

## 1. Rate limiting

**No numeric request-rate limiter exists on the Muse MCP/API-key path, or on any MCP path.** There is no quota, throttle, concurrency limit or per-key/per-user cap in `server.js`, `muse-wrapper.js`, `muse-capture.js` or configuration. No MCP response is ever a 429 or carries `Retry-After`.

Limits that do exist, none of them a request rate on MCP:

| Limit | Numbers | Scope | Applies to Muse key calls? |
|---|---|---|---|
| Sign-in throttle (`loginBlocked`) | 8 failed passwords per email, or 20 per network, in 15 minutes; in memory | Password sign-in on the web and on the OAuth consent page | **No.** Key calls never take a password. A wrong key gets a plain 401 every time, uncounted. |
| Sign-up limit (`signupAllowed`) | 5 new accounts per network per hour; in memory | Account creation | No |
| Request body size | 4 MiB on the Muse address (truncated past that, then refused with 400); **no cap** on www `/mcp` | Per request | Yes. This is the one Muse-specific difference. |
| Image size | 20 MB stored, 24 MB generated, 4 MB inline | Per image | Same as www |
| Duplicate-write window | Identical check-in or comment within 120 s is treated as a retry, not a new record | Per member | Same as www |
| Plan sharing caps | 20 open invitations, 10 share links per plan | Web only | No (not MCP) |

**Retry behaviour.** Every tool error is a protocol-native `isError` result:
- `_meta["discriminantly/error"]` carries `kind` (`refused` or `fault`) and `retryable` (true only for faults).
- The text tells the client not to retry the identical call more than once.
- The server instructions say the same.

There are no backoff hints or `Retry-After` headers.

**Muse vs www/other clients.** The tools, the permissions and the error shapes are identical. The differences:
- the 4 MiB body cap;
- read-only key enforcement;
- the "Muse" naming of unnamed keys.

**Proposed statement: mostly accurate, but "abuse protections" overstates what exists at the application level.** Use instead:

> Discriminantly does not currently publish or enforce a fixed per-member request quota or rate limit for the Muse connector. Each connection uses its own revocable key, requests over 4 MB are refused, and access that is misused may be restricted or revoked under our Terms. Tool errors say whether they are retryable; clients should not repeat a failed call more than once and should back off rather than retry repeatedly.

## 2. Sensitive-write classification

**Caveats:**
- Meta's verbatim Read / Write / Sensitive-write text isn't in the project docs, the uploads or our conversation history, so this uses the definition as stated: *sensitive writes include irreversible or consequential actions*.
- The 26-tool / 18-write submitted list isn't in the repo. The Muse address serves all 67 tools, so every write tool is classified below.

**Rule used:** a tool is Sensitive if any of these is true:
- our own published annotations already mark it `destructiveHint: true` (it deletes, or overwrites with no copy kept);
- by default it publishes or communicates to other people in the member's name.

Using the published annotations keeps the Muse packet consistent with what OpenAI reviewed.

**Sensitive write (19)**

*Deletes and removals, irreversible:*
`delete_note`, `delete_travel_mark`, `delete_checkin`, `delete_itinerary_entity`, `delete_ensemble`, `discard_ensemble`, `remove_ensemble_artifact`, `remove_ensemble_component`, `clear_prospective_leftovers`

*Overwrites with no copy kept:*
`edit_note`, `edit_travel_mark`, `edit_checkin`, `edit_ensemble`, `update_itinerary` (also publishes a plan with `private:false`), `update_itinerary_temporal`, `update_itinerary_stop`, `arrange_itinerary`

*Communicates or publishes to others by default:*
- `comment`: posted under the member's name on someone else's note, and can't be deleted through MCP.
- `warrant`: a public endorsement, announced to the feed by default on public records. It is reversible with `revoke_warrant`, so Write is arguable if Meta weighs reversibility over publication.

**Write: defensible, but disclose that they publish by default (5)**

- `note_object`, `add_travel_mark`, `re_note`: public unless `private:true`. Reversible (make private or delete).
- `log_visit`: the check-in is public when the mark is, so it discloses a dated location publicly. Reversible with `delete_checkin`.
- `keep_ensemble`: publishes only with `private:false`.

**Write (25)**

*Ownership:*
- `record_note_ownership`, `release_note_ownership`, `correct_note_ownership_mistake`: private, never shown to others, append-only, reversible.
- `revoke_warrant`: reduces exposure; the history is kept.

*Recommendations:*
- `keep_recommendation`: the record stays private. There is no "un-keep" through MCP, but there is no external effect either.
- `record_recommendations`, `resolve_recommendation`, `dismiss_recommendation`, `keep_record`, `resolve_travel_mark`

*Itineraries:*
- `create_itinerary` and `build_itinerary`: private by default.
- `add_itinerary_stops`: visible to others only on a plan that is shared or published, and new marks inherit the plan's privacy.
- `resolve_itinerary_stop`
- `set_stop_note`: visible to others only on a public plan.

*Ensembles:*
`create_pending_ensemble` (private staging), `add_ensemble_artifact`, `add_ensemble_component`, `resolve_ensemble_component`, `set_primary_artifact`

*Image transport:*
`upload_image`, `begin_image_upload`, `upload_image_chunk`, `start_image_upload`, `finish_image_upload`. These are private until used.

**The named tools:**

| Tool | Verdict |
|---|---|
| `record_note_ownership` | Write |
| `release_note_ownership` | Write |
| `warrant` | Sensitive, conservatively (Write is arguable) |
| `revoke_warrant` | Write |
| `log_visit` | Write, with disclosure |
| `keep_recommendation` | Write |
| `create_itinerary`, `build_itinerary`, `add_itinerary_stops`, `resolve_itinerary_stop` | Write |
| `update_itinerary`, `update_itinerary_temporal`, `update_itinerary_stop`, `arrange_itinerary` | Sensitive |
| `delete_itinerary_entity` | Sensitive |

**"No sensitive writes in the 26-tool surface": change it, unless the 18 submitted writes include none of the 19 Sensitive tools above.** Any edit or delete tool in the list makes the claim inaccurate, because we already annotate those as destructive. If edits and deletes are in the list, name them as Sensitive writes.

## 3. Brand assets

| File | Format | Size | Role |
|---|---|---|---|
| `public/icon-512.png` | PNG, full-bleed square (dark gradient, white master-D) | 512×512 | PWA icon in `manifest.webmanifest`. Production app icon. Named in the ChatGPT submission notes as the logo source. |
| `public/icon-512-maskable.png` | PNG, same art with a smaller mark | 512×512 | PWA maskable icon |
| `public/icon-mcp.png` | PNG, rounded square, transparent corners | 512×512 | Served at `/icon-mcp.png`, not referenced by any page |
| `public/icon-256.png`, `icon-192.png`, `apple-touch-icon.png` (180), `favicon.png` (32) | PNG | as named | Smaller app icons |
| `public/mark@4x.png` (`mark.png` at 1×, 60×80) | PNG, transparent, dark-brown master-D | 240×320 | The header mark and colophon mark |

- **Wordmark:** there is no wordmark file. The header renders "discriminant•ly" as live text beside `mark.png`, and the welcome arc does the same. Making a wordmark PNG would mean producing new art, so I didn't.
- **Vector originals:** none. There is no SVG, AI, EPS or PDF of the mark anywhere in the repo. The largest originals are 512×512 (icon) and 240×320 (mark). Nothing was upscaled.

**Upload-ready copies** are byte-identical to production (SHA-256 prefixes match), in `discriminantly-brand-assets/`:

| Copy | Source |
|---|---|
| `discriminantly-icon-512.png` | `icon-512.png` (8d9eb2b64b4c) |
| `discriminantly-icon-512-rounded-transparent.png` | `icon-mcp.png` (496b3b16e4eb) |
| `discriminantly-mark-240x320-transparent.png` | `mark@4x.png` (c8064b0a0d63) |

## 4. Brian's decisions

1. **The 18 submitted write tools:** confirm or share Muse's 26-tool list, so the sensitive-write line can be finalised.
2. **Warrant:** Sensitive (conservative) or Write (it's reversible).
3. **Rate-limit text:** approve the revised statement in §1.
4. **Larger or vector brand art:** if Meta wants an icon above 512 px or a vector, it has to come from your original design files. The repo has none.
5. **Pending from earlier:** whether full-access Muse keys should be refused at www (item 7.5).
