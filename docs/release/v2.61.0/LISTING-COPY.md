# Listing copy (plugin directory) — status

**Non-blocking.** This reconciliation does not block deployment or behavioural testing.

The approved public listing was curated by Brian **directly in the OpenAI submission portal**. On 2026-09-22 02:06 UTC he asked that the import file not carry it: *"We have already manually completed and curated the public listing information in the OpenAI submission portal and do not want the import artifact to populate or overwrite those fields."* (commit `fcf4953`, "drop app_info").

## Sources, kept distinct

| Source | What it is | Status |
|---|---|---|
| **OpenAI submission portal** | The approved, curated listing | **Authoritative. Exact values not recorded in the repository or any conversation.** |
| `plugin/chatgpt-app-submission.json`, `docs/submission/*.json` | Portal import files | No listing fields since `fcf4953`, by design: an import cannot overwrite the portal. Enforced by test LB1. |
| `plugin/plugin.json` › `extensions.com.openai.interface` | The package manifest's `displayName`, `shortDescription`, `longDescription`, `category` | **Unverified draft display copy**, not the authoritative public listing: Claude's original draft (commit `9185b69`, 2026-09-22), written before the portal curation. Left unchanged pending verification. Used only as the local test package's display copy. |
| `plugin/plugin.json` › root `description` | The portable package's own one-line description | Not a portal listing field. |
| Website hero ("YOUR INTERESTS. YOUR TRAVELS. WHEREVER YOU GO." and its paragraph) | Marketing site copy | Not listing copy. Not used. |
| MCP tool descriptions, server instructions | Technical, for the model | Separate; governed by the contract review. |
| Skill `description` front matter | Technical, for Skill selection | Separate; governed by the Skill review. |

## Comparison

| Field | Approved wording (portal) | Generated wording (`plugin/plugin.json`) | Match |
|---|---|---|---|
| Display name | awaiting verification | Discriminantly | unresolved |
| Subtitle / short description | awaiting verification | Keep things, places and plans | unresolved |
| Description / long description | awaiting verification | Discriminantly is an app and plugin that connects to your AI, giving you a place to keep the things you notice, the places you go, and the experiences worth remembering.<br><br>Add to it through ordinary conversation. Tell ChatGPT about a bookshop you want to remember, a watch you bought, or a restaurant you went to last night, and it is kept in your Discriminantly catalogue as a note, a travel mark or a check-in. Ask what you have saved from a city, group things into collections, and plan a trip with an itinerary built from the places you already know.<br><br>You stay in control. Notes and places can be private or shared with other members. Everything ChatGPT adds or changes is recorded as ChatGPT acting for you, and you can see and edit all of it in the Discriminantly app. You can disconnect ChatGPT at any time in Settings. | unresolved |
| Category | awaiting verification (the dropped `app_info` used `TRAVEL`) | Travel | unresolved |
| Import file listing (`app_info`) | none, by Brian's instruction | none | **match** |

## To resolve

1. In the portal, copy each listing field exactly: display name, subtitle, description, category.
2. Send them to Claude. Claude compares character by character (after JSON decoding) and reports any difference.
3. On Brian's confirmation, synchronize those four fields in `plugin/plugin.json` to the exact portal wording and pin them with a test. The local package already reads the manifest rather than keeping its own copy. The import files stay listing-free (LB1). Neither the portal nor the import files change.

No field limit conflict is known. If one appears, the exact field and limit will be reported, with a proposed minimal adjustment, for approval.
