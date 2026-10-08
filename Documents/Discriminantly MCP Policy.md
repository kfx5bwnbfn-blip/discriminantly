Discriminantly MCP Policy — Reconciled Recommendation & Adoption Model

Version: 0.3-shared-itineraries
Date: 2026-10-07
Status: Machine-facing operational policy aligned to the reconciled Constitution.

1. Purpose

This policy tells AI clients how to operate Discriminantly without collapsing Recommendation, Adoption, experience, ownership, endorsement, observation or inference.

It applies to ChatGPT, Claude, Meta/Muse and future MCP/API clients.

The server remains authoritative for permissions, identity, privacy, provenance and invariants.

2. Core operating rules

1. A member-scoped record may exist without Adoption.
2. Recommendation and Adoption are independent assertions.
3. A recommendation-only target may be fully materialized.
4. A direct request to build a primary artifact may authorize its creation/adoption without a second generic confirmation.
5. Optional editorial expansion remains recommendation-only unless adopted.
6. Research candidates do not persist merely because they were considered.
7. Resolution never implies Adoption.
8. Adoption never implies experience, Ownership or Warrant.
9. Every durable write preserves provenance.
10. Private evidence never becomes public implicitly.
11. A shared itinerary’s Stops belong to the itinerary; presence on one is never anyone’s Mark, Adoption or preference.
12. Shared-itinerary edits are attributed actions, never taste evidence — the acting member’s own included.

3. Assertion classes

Explicit / member-authorized

Use for member actions and clearly delegated execution.

Examples: Adoption, Check-in, Ownership, Warrant, explicit comments, direct edits, construction of a primary itinerary explicitly requested by the member.

Proposed / AI-generated

Use for AI-selected content deliberately presented to the member.

Examples: Recommendation, recommendation-only Note, recommendation-only Travel Mark, recommendation-only Itinerary, unresolved prospective proposition.

Observed

Use only for behavior actually observed by the system. Never relabel as explicit preference.

Derived / inferred

Use for system-computed interpretations. Never overwrite or impersonate explicit evidence.

4. Research candidate vs Recommendation vs Adoption

Research candidate

Internal only. Do not persist merely because the model considered or researched it.

Recommendation

Persist only when a workflow deliberately selects and presents the thing/place/plan as a recommendation.

A Recommendation may point to an existing adopted record, a recommendation-only record, a partially resolved record, or an unresolved proposition where supported.

Adoption

Add only when the member explicitly Keeps something or has already delegated creation of the primary artifact under a workflow whose semantics include Adoption.

Never infer Adoption from Recommendation.

5. Primary itinerary authorization

When the member asks to plan, build, make, organize, organise, fill or sequence an itinerary, treat that as authorization to construct the primary requested itinerary unless the member limits persistence.

Within that scope the AI may create the itinerary, create groups/days, create/reuse grounded Marks for selected Stops, attach Stops, arrange the sequence, adopt the primary itinerary and primary-plan Marks under current itinerary semantics, and record Recommendation provenance for AI-selected places.

These Marks and Adoptions are the requesting member’s own. On a shared itinerary, adding places creates no Mark for anyone (§21).

Do not require a second “keep it” or “save it” turn.

Do not infer Check-in, booking, purchase, Ownership or Warrant.

6. Optional recommendations

Optional adjacent ideas are not automatically part of the primary authorization.

Examples: For Another Time, optional destination objects, future trip directions and recommendation-orbit expansion.

Persist these as Recommendation-only. Do not Adopt unless the member later Keeps them.

7. Recommendation target mechanics

A Recommendation is an assertion record and may have a target_uid.

For itinerary recommendations:

• the Recommendation UID identifies the recommendation assertion
• the target_uid identifies the target Itinerary
• use the target Itinerary UID for itinerary-structure operations
• never pass the Recommendation UID where an Itinerary UID is required

A recommended Itinerary may have Stops, recommendation-only Marks, unresolved Stops/propositions and prospective object context where supported.

8. Keeping a recommendation

When the member keeps a recommendation:

• add Adoption to the existing target
• preserve the Recommendation assertion/history
• do not create a duplicate target merely to represent Keep
• adopt resolved child records only according to current domain semantics, and only the keeping member’s own (a recommended itinerary cannot be shared until kept)
• preserve unresolved Stops as unresolved
• do not create Check-ins, Ownership, Warrants, bookings or purchases

9. Existing adopted targets may be recommended

Do not duplicate a kept record solely because it is recommended in a new context.

Use the existing target where identity is exact and record the new Recommendation assertion/context.

The same target may therefore be both adopted and recommended.

10. Resolution policy

Resolution and Adoption are independent.

Allowed combinations include unresolved+recommended, partial+recommended, resolved+recommended, unresolved+adopted and resolved+adopted.

> **Resolve aggressively. Preserve uncertainty. Never manufacture precision.**

Only exact identity matches may be silently reused where the current matcher permits.

11. Read projections

“My Notes,” “My Marks,” and equivalent canonical corpus reads represent adopted projections.

Do not assume every recommendation-only member record appears there.

Use recommendation-specific reads to inspect prospective records.

An adopted record may also appear in recommendation reads if it has a Recommendation assertion.

12. Reaction semantics

Treat not_this_trip, not_for_me and dismissed distinctly.

Do not infer durable negative preference from not_this_trip or dismissed.

Silence is not rejection.

13. Evidence boundary table

|From                   |Forbidden automatic inference                    |
|-----------------------|-------------------------------------------------|
|Recommendation         |Adoption, preference, visit, ownership, warrant  |
|Adoption               |visit, ownership, warrant                        |
|Ownership              |Adoption, preference, warrant                    |
|Check-in               |Adoption, preference, warrant                    |
|Warrant                |Adoption, visit, ownership                       |
|Itinerary Stop         |Check-in, booking, visit                         |
|Shared itinerary Stop  |any participant’s Mark, Adoption, preference     |
|Shared itinerary edit  |taste evidence for anyone, the editor included   |
|Search/view            |preference, Adoption                             |
|Recommendation reaction|broader taste inference unless explicitly modeled|

Compound explicit acts are allowed only when the user’s wording truthfully supports them.

14. Authorization phases

Retrieve → Interpret → Propose → Execute are distinct semantic phases.

They are not necessarily separate conversational turns.

Ask:

> Has the member already authorized this execution through the initiating request?

If yes, execute within scope. If no, remain in retrieval/interpretation/proposal state.

Ask only when identity or authorization is materially ambiguous.

15. Provenance

For every durable write preserve the acting user, direct user vs AI-on-behalf vs system/migration, AI client where applicable, assertion/evidence class where supported and recommendation context where applicable.

On a shared itinerary the acting participant is whoever the authenticated connection or session belongs to. No tool takes an actor or participant argument, and none should be invented. Each Stop and day change also names its itinerary.

Do not attribute AI research or rationale to the member.

16. Privacy

Never expose private member evidence because the member collaborates on an itinerary, another participant plans a shared itinerary, the AI recommended a record, or a public/shareable artifact references the same entity.

Access to a shared artifact does not confer access to unrelated private corpus content.

17. Failure behavior

If a write cannot be completed:

• do not claim persistence
• preserve successful prior steps
• retry only when idempotent/safe
• surface ambiguity when required
• never fabricate completion

If a recommendation target exists but is unadopted, do not “fix” the state by Keeping it unless authorized.

18. No-orphan rule

A non-adopted member-scoped record must be explained by a modeled relationship such as Recommendation, pending composition, prospective itinerary relationship or another explicit legitimate domain relationship.

Do not retain unexplained records merely because they were edited or researched.

A shared itinerary referencing a place never justifies creating or retaining any participant’s record. Removing one’s own record ends only one’s own relationship to a shared Stop.

19. Tool-selection guidance

Prefer the tool that directly expresses the semantic act.

Examples:

• simple “keep this place” → direct Mark creation/keep capability
• grounded place for a primary delegated plan → canonical plan/Mark workflow
• optional suggested place → Recommendation workflow
• future recommended itinerary → Recommendation with target Itinerary
• member keeps recommendation → recommendation keep / Adoption capability
• explicit visit → Check-in
• explicit ownership → Ownership
• explicit endorsement → Warrant

Do not route through another tool merely to force a desired state.

20. Cross-client rule

All clients must preserve these semantics even if their native connector/platform vocabulary differs.

Platform permissions and host approvals remain authoritative.

Client-specific prompting may not override this policy.

21. Shared itineraries

A member’s itineraries may include ones others shared with them (my_itineraries says so in its text, with the caller’s role). The existing tools work on them unchanged:

• `mark_uid` on any stop is always the caller’s own Mark for that stop, or null. A stop with no Mark of the caller’s is shown as a particular place. It is not unfinished and needs no repair.
• Editors may add, change, arrange and remove stops and days. Viewers read; a write is refused with a plain message.
• Adding a place (`new_place`) puts it on the plan for everyone and keeps it for nobody, the caller included. Do not create or link the member’s Mark for it unless the member asks to keep it.
• Keeping a place for the member is the explicit personal path: `resolve_travel_mark` (their own Mark), then `resolve_itinerary_stop` (links it as theirs only). Viewers may do this too; it is not an edit of the plan.
• `audit_itinerary` counts a shared stop with a full place identity as resolved. Never “complete” a shared plan by creating Marks.
• Removing a stop or a day on a shared plan is recoverable on the website. Nobody’s Marks are touched.
• A shared plan cannot be deleted or made public through MCP. Inviting, removing participants and changing roles happen only on the website.
• Recommendations about a shared plan remain the caller’s own.
