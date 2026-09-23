# Recommendations — design report (Phase 1 and 2)

Written against v2.54.1 (`f3a69cf`). **Nothing is implemented.** The brief says to stop after the design if a major existing ontology assumption would need to change, and one does. §3 sets out that decision.

Every claim here comes from the code; counts are of read sites in `server.js`.

---

## 1. What row existence means today (questions 1–4)

**Q1. Does a Note row imply the member kept it? Yes, everywhere.**
- **Read sites:** 56 outside MCP, and **14 frozen MCP tools** (`my_notes`, `search_catalogue`, `catalogue_stats`, `recent_notes`, `re_note`, `edit_note`, `delete_note`, `comment`, and the ensemble and ownership tools). Every one treats a row as part of the member's corpus.
- **Visibility:** Notes are **public by default**, and appear in the public `/objects.json`, the home and profile feeds, resurfacing ("You recorded this") and profile counts.
- **The rules on record:**
  - *"A Note becomes a first-class, user-owned record of one member's relationship to a thing"* (v1.17, migration 021).
  - *"Deliberately scoped to Ensemble; **Notes and Marks get no draft state**"* (migration 031).
  - Ensembles materialise Notes only at the "saved" commitment boundary.

**Q2. Does a Mark row imply it? Yes.**
- **Read sites:** 46 outside MCP, and **9 frozen tools** (`my_travel_marks`, `search_catalogue`, `list_checkins`, `log_visit` and others).
- **Duplicate detection:** it treats any existing Mark as "you already marked this".
- **Visibility:** public by default.
- **The rule on record:** the Mark boundary in `stopAdd`, *"added to the itinerary IS marked"*: accepting a place into a plan creates its Mark.

**Q3. Does an Itinerary row imply it? Yes.** An itinerary is the member's own intention (*"An Itinerary captures intention"*). There are 18 read sites, plus the frozen `my_itineraries`, which lists every itinerary as the member's plan.

**Q4. Is there an existing "kept" relationship? No, not as a separate relationship.** "Kept" *is* the row's existence. The language is already in use: the tool test prompt "Keep Daunt Books…", `keep_ensemble`, and the ontology audit ("the member deliberately kept a thing worth remembering"). **If a term is needed, it should be *Kept*.** It's not *Owned*, which means something else for Notes and nothing for places.

## 2. The rest of the questions, briefly (5–21)

- **Q5–7, can ordinary rows exist as recommendation-only records?** Only by making *Kept* an explicit relationship and changing every read site to use it. Otherwise a recommendation-only Note would appear, publicly by default, as something the member kept, and so would a Mark. It would also show up in frozen AI results: ChatGPT would report "your notes" as including things the member never chose. That is evidence laundering, exactly what the brief forbids.
- **Q8, itineraries:** the same problem. It's also compounded by the Mark boundary: adding a newly identified place to an itinerary creates a Mark, so a recommended itinerary built with the ordinary operations would create "kept" Marks the member never chose.
- **Q9–11, unresolved targets:** yes, by reusing the pattern of ensemble components and itinerary stops. The proposition keeps a stable uid and its original words. It holds what's known, gains precision in place, and gets an optional non-foreign-key reference to a canonical record once one exists. **The label is never cleared; every resolution step is appended to provenance.** This is the proven pattern here, so reuse it rather than invent one.
- **Q12–13, the Recommendation record:** see §4. The context points at stable records by uid, and the rationale is short text marked as the AI's interpretation. Supporting evidence is the uids of the member's own **canonical** records only, and never other recommendations, which is the guard against a self-reinforcing loop.
- **Q14, feeds:** under the recommended path (§3), no existing feed changes at all. Recommended items live only in a new, bounded **Recommended** surface.
- **Q15–16, adoption and deletion:** see §4.
- **Q17, privacy:** recommendations are always private to the member. The rationale and supporting evidence are shown only to them, and never on a public artifact.
- **Q18, provenance:** the existing actions cover it: `created` for the recommendation; `enriched` for each resolution step; `adopted` and `dismissed`. The AI actor is recorded with `ai_on_behalf` and the connection. The Skill workflow goes in `source_kind`, for example `for_another_time`.
- **Q19, migrations:** one additive table under the recommended path. Under the alternative, a backfill across every existing Note, Mark and Itinerary (§3).
- **Q20, MCP:** see §5.
- **Q21, conflicts with the semantic hygiene decisions:** yes, three, under the alternative path (§3).

## 3. The decision this needs

The brief's target model is that ordinary Notes, Marks and Itineraries exist structurally, and a new relationship says whether the member kept them. That's coherent, but it **reverses recorded decisions** and **can't be done under the freeze**.

### Path A — keep the recorded decisions (recommended)
A record exists only once the member has kept it. A Recommendation carries its own progressively resolved **proposition** until then.

When the member adopts it, the proposition becomes the member's ordinary record through the existing canonical operations (`noteCreate`, `markCreate`, `itineraryCreate`, `stopAdd`). That's the same boundary ensembles already use, where keeping materialises Notes. The Recommendation keeps its history and gains a reference to the record it became.

- **No existing feed, query or frozen AI tool changes.** A recommendation can't leak into "your notes", because it isn't one.
- **No duplicates:** adoption reuses an existing matching record first (`findExistingNote`, and the member's own marks), and a second adoption of the same recommendation is idempotent.
- **History survives:** the Recommendation is never rewritten or removed by adoption.
- **The cost:** adopting a recommended *itinerary* builds the member's itinerary from the proposed one. It's a single transaction, and the Stops are created once, as the member's own. But Stop uids differ from the proposal's items. The proposal keeps its own item identities, each linked to what it became.

### Path B — the brief's relationship-first model
Make **Kept** an explicit, append-only relationship for Notes, Marks and Itineraries. Backfill it for every existing row; that's truthful, since each came from a deliberate act by the member or by AI on their instruction. Then every "the member's corpus" query reads Kept.

- **Consequences:**
  - **Every read site changes:** 120 web read sites and the public `/objects.json` must filter on Kept.
  - **Privacy flips:** recommendation-only rows must be forced private and excluded from public pages, `recent_notes`, re-noting, search and resurfacing.
  - **Duplicate detection** must ignore recommendation-only Marks.
  - **The Mark boundary** needs an exception for recommended itineraries.
  - **Three recorded decisions are reversed:** v1.17's definition of a Note, "no draft state for Notes and Marks", and the Mark boundary.
- **Blocked by the freeze:** 24 frozen tools read these tables. They'd have to filter on Kept to keep their meaning, which means editing frozen code, so it needs your explicit authorisation, or has to wait for the freeze to lift.
- **The payoff:** a recommended itinerary *becomes* the adopted one. The same rows and the same Stop uids gain a relationship, with no materialisation step.

**My recommendation: Path A now.** It's truthful, contained, needs no frozen change, and matches how Ensemble already works. Path B remains available later as a deliberate ontology change, once the freeze lifts. Nothing in Path A blocks moving to it.

## 4. Proposed architecture (Path A)

### Recommendation
- **Existence asserts:** an actor (normally AI on the member's behalf) proposed this proposition *to this member*, in this context, for this stated reason.
- **Existence does not assert:** that the member likes, keeps, owns, visited, intends, bought or endorses it. It's **never taste evidence**, and nothing may cite a recommendation as evidence about the member.
- **Identity:** a stable `uid`, and one member (the recipient). **The recipient field is the only ownership.**
- **Fields:**
  - **What it is:** `kind` (object, place, itinerary or experience); `label`, the original words, never cleared.
  - **Resolution:** `resolution` (unresolved, partial or resolved), plus whatever resolved attributes are known — maker, producer or operator; product or offering; variant; canonical URL; image; place fields. Only known values; nothing is manufactured.
  - **Context:** `context_itinerary_uid`, `context_stop_uid`, and `parent_uid` for an item inside a recommended itinerary. All are non-foreign-key uids, so history survives deletion.
  - **Reasoning:** `rationale`, short text, the AI's interpretation; `evidence_uids`, the member's canonical records cited.
  - **Outcome:** `target_type` and `target_uid`, the member's record, set when the member already has one or on adoption; `state` (open, adopted or dismissed); and `reaction` (not this trip, or not for me), optional and never a score.
- **Resolution:** gains precision in place. Each step is an `enriched` provenance row naming the fields, and ambiguity stays unresolved. Silence records nothing.
- **Authorship:** AI on the member's behalf, or the system. On the web, the member acts only by adopting or dismissing.
- **Privacy:** private to the member, always. It never renders on a public page or through another member.
- **Adoption:**
  - **A resolved recommendation** becomes the member's ordinary record, reusing an existing match first. The new record's provenance cites the recommendation (`source_kind 'recommendation'`), and the recommendation records `adopted` plus its target.
  - **An unresolved place** in a recommended itinerary becomes an ordinary unresolved Stop (particular or experiential).
  - **An adopted object whose context stop is also adopted** is attached to that Stop, using the v2.54 Stop→Note relationship.
  - **Never:** a Check-in, Owned, Warrant, reservation or purchase.
- **Deletion:**
  - **Deleting a recommendation** never touches the member's record it became.
  - **Deleting that record** leaves the recommendation's reference as history ("no longer in your catalogue").
  - **Deleting the context itinerary** leaves the recommendation, hidden from the surface.
  - All removals are recorded in provenance.

### Recommended surface (web)
A **Recommended** section: a bounded list, grouped by context (a trip, or "for another time"), never an infinite feed.
- **Fully resolved:** the card is as rich as a Note or Mark.
- **Partially resolved:** e.g. "Manta Ray Night Snorkel · Operator X · specific excursion not yet identified".
- **Unresolved:** e.g. "Locally produced Kaʻū medium roast · worth seeking during the coffee stop".

Each has **Keep** and **Not now / Not for me** actions. No ontology terms appear in the interface.

### Deliberately open: an unresolved *object* the member adopts
A Note needs an identity, so an adopted-but-unresolved object ("some Kaʻū medium roast") has no home today.
- **The smallest truthful option:** it stays a Recommendation in state *adopted* with no target, shown under its Stop. It becomes a Note, attached to the Stop, only when identity arrives.
- This is the "unresolved destination objects" item parked in `mcp-vnext.md`. **Decide it together with Path A.**

## 5. MCP (for `docs/mcp-vnext.md`, not now)
AI clients would eventually need five operations:
- record recommendations (for the For Another Time and Destination Objects Skills);
- resolve one progressively;
- list them;
- adopt one, including a whole itinerary as one transaction;
- dismiss one with a reason.

No frozen tool changes under Path A. Path B would change 24.

## 6. Migrations (Path A)
One additive migration: a `recommendations` table with a uid trigger and indexes. No backfill. No existing table, feed or tool changes, and the MCP contract guard is unaffected. Deleting a Note, Mark or Itinerary needs no cascade, because references are non-foreign-key uids kept as history, as with stops and components.

## 7. Decisions needed
1. **Path A or Path B** for Notes and Marks. A is recommended.
2. **Recommended itineraries:** under Path A, a proposed itinerary is a Recommendation of kind *itinerary* whose items are child Recommendations. Adoption builds the member's itinerary in one transaction. Accept that, or wait for Path B?
3. **Adopted but unresolved objects:** Recommendation in state *adopted*, shown under its Stop, until identity arrives. Accept?
4. **Terminology:** *Kept* for deliberate membership, if Path B is ever taken. The interface label for the action would be **Keep**.
