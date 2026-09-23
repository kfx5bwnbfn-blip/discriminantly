# Recommendations — design (v2, relationship-first)

Written against `f3a69cf`. **This supersedes v1**, which proposed a proposition-first Recommendation materialised at adoption ("Path A"). The brief of 23 September 2026 chose the relationship-first model, and inspection confirms it's compatible, subject to one decision (§1).

**Status: Increment 1 (Adoption) built, migration 052; see `docs/recommendations-increment1-report.md`, which has four decisions for Brian.** Increments 2 and 3 are designed, not built.

## 1. Verdict on the brief's hypothesis

**The hypothesis holds.** A Note is already defined as *a member's relationship to a thing* (v1.17, migration 021), and a Mark as a relationship to a place. Until now, a record existing and the member adopting it happened at the same moment, so adoption never needed its own evidence. Recommendations add a second way in, which makes the distinction explicit without changing what a Note or Mark *is*.

**Decision (Brian, 23 September 2026): approved, refining, not reversing, migration 031.** The no-draft-state principle stands. Refined as:

> A Note or Mark may exist without Adoption evidence when another truthful member relationship establishes why that member-scoped record exists, initially Recommendation. Absence of Adoption means the member has not explicitly Kept the record; it does not mean the record is a draft or incomplete. A non-adopted Note or Mark must never be a neutral orphan with no relationship explaining its existence.

**The Mark boundary** (*"added to the itinerary IS marked"*) is refined in the same spirit. A new place added to an *adopted* itinerary creates an adopted Mark, and one added to a *recommended* itinerary creates a Mark whose existence is explained by the Recommendation.

**Independence (binding).** Adoption, Ownership, Check-in and Warrant are independent evidence. A UI or Skill may perform a *compound explicit* action (Keep + Own, Keep + Check-in) when the member's instruction supports both. The domain must never infer `Owned ⇒ Kept`, `Check-in ⇒ Kept` or `Warrant ⇒ Kept`.

**The freeze isn't in the way.** The server calls no AI provider, so recommendations can enter only through AI Skills via MCP. That means no recommendation-only record can exist until MCP vNext adds a way to create one. The frozen tools read the tables directly (20 raw note and 8 raw mark reads between them); until then those reads are identical, and they move to the Adopted projection *in* vNext (§5).

## 2. Answers to the brief's questions, briefly

- **Q1–3. What existence asserts:**
  - **Note:** the member's relationship to a thing.
  - **Mark:** the member's relationship to a place.
  - **Itinerary:** the member's intention to travel.
  - Today, adoption comes with each of these implicitly.
- **Q4–7. Where existence is treated as adoption:**
  - **Every corpus read:** 56 note and 46 mark read sites in the web app, and 18 itinerary ones.
  - **Counts and search:** profile counts and `search_catalogue` (frozen).
  - **Public surfaces:** `/objects.json`, resurfacing, `recent_notes` and the feeds.
  - **Duplicate detection:** it matches on every row.
- **Q8. Collections:** organisation, not evidence of adoption. The AI can currently add collections when creating a note (2 sites). **Rule: only an adopted record can join a collection.** This stops a recommendation being slipped into the corpus.
- **Q9. Re-note and re-mark:** a deliberate member act, so they create an adopted record, as today.
- **Q10. Stop→Note:** context, not adoption. **Rule: attaching to a stop in an adopted itinerary requires an adopted Note.** In a recommended itinerary, the attachment is part of the recommendation.
- **Q11. Ensembles:** keeping an ensemble is the commitment boundary, and the Notes it materialises are adopted. Pending ensembles stay as they are.
- **Q12. Owned, Check-in and Warrant:** separate evidence, as today, and each is independent of adoption. Owning a recommended Note records ownership without implying adoption. If that should adopt it too, it's a UI prompt, not an inference.
- **Q13–14. Representing adoption:** nothing exists today. The smallest coherent answer is an append-only **Adoption** relationship (§3), built the same way as Owned and Warrant.
- **Q15–17. Can recommendation-only records exist safely?** Yes, provided every adopted-corpus surface reads the Adopted projection, and recommendation-only records are **private and owner-only**, whatever the table's default says.
- **Q18. Already-adopted records later recommended:** they gain Recommendation evidence. There's no duplicate, and existing matches are found first (`findExistingNote`, and the member's own marks).
- **Q19–21. Unresolved propositions:** reuse the pattern of ensemble components and itinerary stops:
  - a stable uid;
  - the original words, never cleared;
  - known attributes gained in place;
  - an optional non-foreign-key target once resolved;
  - every step appended to provenance.

  Resolution adds knowledge; it doesn't rewrite history.
- **Q22. Privacy:** see §3. Rationale and supporting evidence are owner-only, and never appear on a public artifact.
- **Q23. Deletion:** see §3.
- **Q24. MCP:** see §5.
- **Q25. Contradictions with the semantic hygiene work:** only the migration-031 revision, and it's flagged above.

## 3. The two new relationships

### Adoption (the term shown to members: **Keep** / **Kept**)
- **Asserts:** the member deliberately brought this Note, Mark or Itinerary into their corpus.
- **Does not assert:** ownership, a visit, an experience, a purchase or a Warrant.
- **Identity:** an append-only `adoptions` table (subject type, subject uid, `adopted` or `withdrawn`). It's modelled on Owned and Warrant, with provenance rows for `adopted` and `withdrawn`.
- **Time and authorship:** each row has its own time. Created by the member or by AI on their explicit instruction, and never by a recommendation workflow itself.
- **Backfill:** every existing Note, Mark and Itinerary gets one `adopted` row, dated from the record's creation. Its provenance says `derived`, from a schema migration, because adoption was implicit at that time. That's truthful rather than invented.
- **Adoption of an itinerary:**
  - the same rows and the same Stops;
  - resolved recommended Marks and Notes in it become adopted too;
  - their recommended Stop→Note attachments stand;
  - unresolved Stops and propositions stay unresolved.

  Nothing else is inferred.
- **Retrieval:** "My Notes", "My Marks" and itinerary lists become the **Adopted projection**: records with an active adoption.
- **Deletion:** withdrawing appends a row, and deleting the record removes its rows through the parent-deletion triggers, as in migration 049.
- **Implementation choice:** a SQL view for the Adopted projection, with `OBJ_SQL` and `MARK_SQL` reading from it. That makes 38 read sites correct through two constants; the remaining raw reads are converted one by one, each with a test.

### Recommendation
- **Asserts:** an AI (or the system), in a named workflow, deliberately proposed this proposition to this member, in this context, for this stated reason.
- **Does not assert:**
  - that the member saw it, likes it, kept it, owns it, visited it or endorses it;
  - that it's taste evidence. **It is never taste evidence.** Nothing may cite it as evidence about the member, and derived relations must ignore it.
- **Identity:** a stable `uid`; one member (the recipient).
- **Fields:**
  - **Proposition:** `kind` (object, place, experience or itinerary), and `label`, the original words, never cleared.
  - **Resolution:** `resolution` (unresolved, partial or resolved), and the known attributes only: maker, producer or operator; product or offering; variant; canonical URL; image; place fields.
  - **Target:** `target_type` and `target_uid` (a Note, Mark or Itinerary), a non-foreign-key reference.
  - **Context:** `context_itinerary_uid` and `context_stop_uid`.
  - **Reasoning:** `workflow` (for example `for_another_time`, `destination_objects` or `cold_start`); `rationale`, short text, the AI's interpretation; and `evidence_uids`, the member's own canonical records only, never other recommendations.
- **The research-space boundary:** a Recommendation is created only for a proposition the workflow deliberately **selects and presents**. Candidates the AI considered and dropped never become records.
- **Resolution:** gains precision in place, each step recorded as `enriched` with the fields named. When resolved, the target is the member's record, found or created as recommendation-only.
- **Privacy:** private to the member, always, including its rationale and evidence. A recommendation-only target is private too, and hidden from public pages, `/objects.json`, `recent_notes`, re-noting, search and resurfacing.
- **Adoption:** the recommendation survives, and its target gains Adoption evidence.
- **Reactions:** kept minimal. `dismissed`, with an optional *not this trip* or *not for me*, recorded as provenance. Silence records nothing, and there's no score. "Presented" is left for later; the schema doesn't preclude it.
- **Deletion:** deleting a recommendation never touches its target or any later evidence, and deleting the target leaves the recommendation's reference as history.
- **Retrieval:** the **Recommended** surface, which is bounded and grouped by context (a trip, or *For another time*).

## 4. Recommended itineraries
These are **ordinary Itineraries without Adoption evidence**, plus a Recommendation of kind *itinerary* and its item recommendations.
- **Stops keep stable identity,** so accepting one adds evidence and copies nothing.
- **Built with the existing operations:** `stopAdd`'s new places create recommendation-only Marks (the refined Mark boundary).
- **They never appear in adopted itinerary lists,** or in `my_itineraries` once vNext moves it to the projection.

## 5. MCP vNext (to add to `docs/mcp-vnext.md`)
- **Before any recommendation can be created,** every frozen corpus read (`my_notes`, `my_travel_marks`, `my_itineraries`, `search_catalogue`, `catalogue_stats`, `recent_notes`, and duplicate detection) moves to the Adopted projection. This is a **prerequisite**, not an option.
- **Then new capabilities:**
  - record deliberately selected recommendations;
  - resolve them progressively;
  - list what's recommended;
  - adopt a record, or a whole itinerary;
  - dismiss one, with a reason.

## 6. Implementation increments (fresh session)
1. **Adoption:**
   - the `adoptions` table and backfill (migration 052);
   - the Adopted projection view, and `OBJ_SQL` and `MARK_SQL` reading from it;
   - converting the remaining raw reads, each with a test;
   - public-surface privacy for non-adopted records;
   - the collection rule.

   The MCP contract guard must show no change.
2. **Recommendation:** the `recommendations` table (migration 053); the domain operations (create, resolve, adopt, dismiss) with provenance; and the privacy rules.
3. **Web:** a bounded **Recommended** surface with Keep, "Not now" and "Not for me"; and itinerary acceptance as one transaction.

**Approved; Increment 1 runs in a fresh session.** Its acceptance criteria, from Brian:
- **A semantics-preserving migration:** externally observable member behaviour is unchanged.
- **A truthful backfill.** Before backfilling, verify that each existing Note, Mark and Itinerary represented corpus membership under the semantics in force when it was created. Don't blindly treat supporting records as adopted. **Known case to check:** Notes created by an ensemble still `pending_review` (created at staging, removed on discard) were **not** corpus membership. They get no Adoption, and their existence stays explained by the pending ensemble. Also check:
  - seed data;
  - itinerary-created Marks, which were corpus membership under the Mark boundary;
  - legacy rows from migration 025;
  - anything else found.
- **Reads:** application corpus reads move to the Adopted projection.
- **Privacy and collections:** public-surface privacy for non-adopted records; only Kept records join Collections.
- **Invariant:** no orphans. Every non-adopted Note or Mark must have an explaining relationship. Add a test that asserts it.
- **MCP:** the production surface stays frozen, and the MCP contract guard (`MC` and `MF` tests, and `test/mcp-contract.js`) passes unchanged.
- **The report, before Recommendation work starts:** the migration; the changed read semantics; the regressions tested; any remaining places where row existence still means Adoption; and the MCP freeze status.
