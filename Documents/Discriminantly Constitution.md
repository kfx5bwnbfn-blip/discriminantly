Discriminantly Constitution — Reconciled Semantic Model

Version: 0.3-shared-itineraries
Date: 2026-10-07
Status: Proposed authoritative replacement for stale recommendation/adoption language in earlier Constitution drafts. 0.3 adds shared itineraries (§22) and scopes the sections they touch; nothing in 0.2 is reversed.

1. Purpose

Discriminantly preserves a member-owned, portable semantic record of things, places, experiences, plans, judgments and prospective ideas.

Its central duty is to preserve what kind of truth each record represents, who asserted it, and why it exists.

The system must never quietly replace:

> **the member said or did this**

with:

> **the system thinks or proposed this**

The same durable target may accumulate multiple truthful assertions over time. Those assertions must remain distinguishable.

2. The relationship is the record

A Note is a member-scoped relationship to a thing.
A Travel Mark is a member-scoped relationship to a place.
An Itinerary is a durable arrangement of travel intentions.

A Stop belongs to its Itinerary, not to any member’s Travel Mark. In a shared Itinerary, each participant’s relationship to a Stop’s place is that participant’s own Travel Mark, which the Stop does not depend on (§22).

Record existence does not necessarily imply member Adoption.

Historically, creation and Adoption often happened together, so the distinction was invisible. Recommendations introduce a second legitimate entry path.

> **relationship existence ≠ member adoption**

A Note, Travel Mark or Itinerary may exist without being part of the adopted corpus when another truthful relationship explains its existence, including a Recommendation.

A record must not exist as a neutral orphan. If it is not adopted, another explicit or system-valid relationship must explain why it is retained.

3. Assertion classes

Discriminantly distinguishes assertion classes. These classes describe the relationship/evidence attached to a record, not necessarily mutually exclusive entity types.

3.1 Explicit / member-authorized

Examples include:

• Adoption / Keep
• Check-in
• Ownership
• Warrant
• explicit comments
• direct edits
• explicit artifact construction delegated by the member

These assertions record something the member explicitly said, did, or authorized.

A direct edit to a shared Itinerary is an attributed action on a shared artifact. It is not a taste assertion by the editor or by anyone else (§22).

3.2 Proposed / AI-generated

Examples include:

• Recommendation
• recommendation-only Notes
• recommendation-only Travel Marks
• recommendation-only Itineraries
• unresolved or partially resolved prospective propositions

A Recommendation means:

> **The AI deliberately selected and presented this to the member as a recommendation.**

It does not mean:

• the member likes it
• the member intends it
• the member adopted it
• the member visited it
• the member owns it
• the member warrants it

Recommendation targets may be durable, fully resolved records.

3.3 Observed

Observed assertions record behavior the system actually observed, such as views or other captured actions.

Observed behavior must not be silently converted into explicit preference.

3.4 Derived / inferred

Derived or inferred assertions are machine interpretations computed from other evidence.

They must retain provenance, evidence references where applicable, uncertainty/confidence where applicable, and a clear distinction from member-explicit evidence.

Derived meaning must never overwrite its source evidence.

4. A record may carry multiple assertion classes

A single Note, Travel Mark or Itinerary may accumulate multiple independent assertions.

For example:

1. AI recommends a place.
2. A recommendation-only Travel Mark is created.
3. The member later Keeps it.
4. The member later Checks in.
5. The member later Warrants it.

The correct model is not a destructive lifecycle that replaces one state with another. It is an accumulating history:

> Recommendation + Adoption + Check-in + Warrant

Each assertion remains independently meaningful and attributable.

Existing adopted records may also later be recommended in a new context. Recommendation history remains valid.

5. Recommendation is not Adoption

Recommendation and Adoption are independent assertions.

A recommendation-only record is a real member-scoped relationship because the AI deliberately brought it into the member’s prospective semantic space.

It is not merely a transient research candidate.

> **research candidate ≠ Recommendation ≠ Adoption**

5.1 Research candidate

A thing/place/plan merely considered internally during research.

It does not enter the member’s durable record.

5.2 Recommendation

A thing/place/plan deliberately selected and presented to the member.

It may be persisted durably, with a Recommendation assertion.

5.3 Adoption

A member-authorized assertion that the target belongs in their adopted corpus.

Adoption may happen:

• directly, when the member explicitly keeps something
• through an explicitly delegated artifact-construction request whose semantics include Adoption of the primary artifact and its grounded constituents
• later, when the member keeps a prior recommendation

Adoption does not erase Recommendation history.

6. Delegated artifact construction

User authorization is evaluated from the semantic trajectory of the conversation, not from a requirement for repetitive confirmation phrases.

A direct request such as:

> “Plan me a day in Taipei.”

authorizes the assistant to construct the primary requested itinerary.

Within that authorized scope, the assistant may:

• create the itinerary
• create its groups/days
• select grounded Stops
• persist the proposed sequence
• create or reuse the corresponding primary-plan Travel Marks of the requesting member
• adopt the primary itinerary and those grounded primary-plan records as required by the current itinerary model
• record Recommendation provenance for AI-selected elements

These cascades apply only to the requesting member’s own records. Delegated construction on a shared itinerary never creates, adopts or changes another participant’s records, and adding a place to a shared itinerary creates no Travel Mark for anyone, the requesting member included (§22).

The assistant does not need a second generic “Shall I save this?” when the user’s original request already delegated construction.

Authorization is bounded. It does not authorize:

• Check-ins
• Ownership
• Warrants
• bookings
• purchases
• publication
• unrelated corpus changes

Material ambiguity about identity or intent still requires resolution.

7. Optional editorial expansion remains prospective

Optional adjacent ideas are not part of the member-authorized primary artifact merely because they are generated in the same conversation.

Examples include:

• For Another Time itineraries
• optional destination objects
• future-city extensions
• additional recommendation-orbit content

These remain Recommendation-only unless separately adopted.

The system may materialize these recommendations durably. Materialization does not mean Keep.

A recommended itinerary may therefore exist as:

> Recommendation → target Itinerary → Stops → recommendation-only Marks / unresolved propositions

This is valid prospective structure.

8. Recommended itineraries are real structural artifacts

A Recommendation record is an assertion/provenance record.

An itinerary Recommendation points to a target Itinerary.

The Recommendation UID is not the Itinerary UID.

Therefore:

• recommendation metadata lives on the Recommendation assertion
• itinerary structure lives on the target Itinerary
• Stops belong to the target Itinerary
• recommendation-only Marks or unresolved propositions may support those Stops

When the member later keeps the recommendation:

• Adoption is added to the existing target
• the target is not copied merely to become kept
• Recommendation history remains
• resolved recommendation-only Marks / attached Notes may be adopted according to itinerary keep semantics — the keeping member’s own records only. A recommended itinerary cannot be shared until it is kept, so this cascade never reaches a shared itinerary (§22).
• unresolved Stops remain unresolved
• no Check-in, Ownership, Warrant, reservation or purchase is inferred

9. My corpus is an adopted projection

“My Notes,” “My Marks,” and equivalent corpus views refer to the adopted corpus.

They must not silently include every member-scoped prospective record.

Recommendation views may include recommendation-only targets and already-adopted records recommended again in a context.

> **Recommended ≠ Kept**

10. Resolution is orthogonal to Adoption

Resolution answers:

> How confidently do we know what this thing/place is?

Adoption answers:

> Does this belong in the member’s adopted corpus?

These are independent.

A record may be:

• unresolved + recommended
• partially resolved + recommended
• fully resolved + recommended
• unresolved + adopted
• fully resolved + adopted

> **Resolve aggressively. Preserve uncertainty. Never manufacture precision.**

Resolution enriches identity. It does not rewrite history or imply Adoption.

11. Evidence boundaries

The following implications are forbidden unless the member explicitly performs or authorizes the corresponding act:

• Recommended ⇒ Kept
• Kept ⇒ Owned
• Owned ⇒ Kept
• Kept Mark ⇒ Visited
• Check-in ⇒ Kept
• Check-in ⇒ Warrant
• Warrant ⇒ Kept
• itinerary inclusion ⇒ Check-in
• itinerary inclusion ⇒ booking
• shared itinerary presence ⇒ any participant’s Travel Mark, Adoption, endorsement or preference
• shared itinerary edit ⇒ taste evidence for anyone, the editor included
• recommendation reaction ⇒ permanent preference unless explicitly represented as such

Compound explicit actions are allowed when the member’s wording truthfully supports more than one assertion.

12. Recommendation reactions remain distinct

At minimum:

• not_this_trip = contextual deferral
• not_for_me = explicit negative relation appropriate for durable interpretation if policy supports it
• dismissed = removal from the current open recommendation surface without stronger taste meaning

Silence is not rejection.

No automatic taste derivation should be created merely from recommendation presentation or non-response.

13. Private evidence remains private

A Recommendation, shared artifact, itinerary, collaboration, or AI operating session must not expose unrelated private corpus evidence.

Privacy must be preserved independently from Adoption, Recommendation, sharing, collaboration, provenance and AI access.

Private content may be read by an authorized AI only under the member’s permissions.

14. Provenance is mandatory for durable writes

Every durable mutation must preserve enough provenance to distinguish:

• member acting directly
• AI acting on behalf of the member
• system/migration
• Recommendation provenance
• derived/inferred processing where applicable

AI-generated assertions must remain legible as AI-generated. Member-explicit assertions must remain legible as member-explicit.

15. Confirmation resolves ambiguity; it does not duplicate intent

> **Confirmation should resolve semantic ambiguity, not duplicate authorization already clearly expressed.**

Examples:

• “Plan me a day in Florence.” → execute the primary itinerary.
• “Give me ideas only; don’t save anything.” → do not persist.
• “Keep this.” → adopt the identified target.
• “I bought this.” → record Ownership; do not infer Keep unless the compound operation is explicitly authorized.
• “Not this trip.” → contextual reaction; do not convert to permanent dislike.

16. Retrieve → Interpret → Propose → Execute

These are distinct semantic phases. They must not be silently collapsed.

They do not necessarily require separate user turns.

Retrieve

Read existing evidence and context.

Interpret

Reason about what the evidence may mean. Interpretation is not itself new member evidence.

Propose

Select and present recommendations or candidate actions. Only deliberately presented recommendations enter the durable prospective corpus.

Execute

Perform authorized writes. Execution may already be authorized by the member’s initiating request.

The assistant must evaluate authorization from the whole request trajectory.

> **distinct phases ≠ mandatory repeated confirmation**

17. No inference laundering

Discriminantly must never present:

• AI proposal as member adoption
• machine inference as member assertion
• observed behavior as explicit preference
• another member’s evidence as this member’s evidence
• shared artifact membership as personal experience
• collaboration activity as any participant’s taste evidence, the acting participant’s own included

The provenance and assertion class must remain visible to the system even where the UI simplifies the presentation.

18. No orphan member records

A member-scoped Note, Mark or Itinerary outside the adopted corpus must have another truthful relationship explaining its existence.

Valid examples may include:

• Recommendation
• pending Ensemble membership
• itinerary-scoped prospective relationship
• explicit Ownership or Warrant where current domain semantics allow such independent existence
• other explicitly modeled relationships

Editing alone is not a relationship. System convenience is not a relationship.

A shared itinerary referencing a place never justifies creating or retaining any participant’s personal record. When a participant removes their own record, only that participant’s relationship ends; the shared Stop, its place and other participants’ relationships remain (§22).

19. Cross-client portability

OpenAI, Anthropic, Meta/Muse and future AI systems are clients of Discriminantly.

No AI platform owns Discriminantly’s semantics.

All clients must operate against the same constitutional distinctions:

• Recommendation
• Adoption
• Ownership
• Check-in
• Warrant
• Observed behavior
• Derived inference

Client-specific UX may differ. Semantic truth may not.

20. Precedence

When instructions conflict, apply this precedence:

1. This Constitution
2. Current domain invariants enforced by the Discriminantly server
3. Current MCP Policy
4. Current tool descriptions and schemas
5. Current workflow Skills
6. Client-specific prompting or editorial behavior

A lower layer must never instruct an AI to violate a higher semantic invariant.

If an older Constitution, MCP Policy, Skill or client note conflicts with this reconciled model, the stale text must be updated rather than followed.

21. Core doctrine

> **The relationship is the record.**
> **Relationship existence is not Adoption.**
> **Recommendation is durable possibility, not member preference.**
> **Adoption is a separate member-authorized assertion.**
> **Resolution is orthogonal to Adoption.**
> **Delegated creation may authorize execution without redundant confirmation.**
> **The system preserves who asserted what, why it exists, and what it does not imply.**
> **A shared Stop belongs to the itinerary; each participant’s relationship to its place is their own.**

22. Shared itineraries

A member may invite others into one of their own kept itineraries. The creator remains its owner; each invited participant is an editor or a viewer. Participants edit the one canonical itinerary directly. There are no proposals, votes, approvals or consensus states; people agree among themselves.

22.1 The Stop belongs to the itinerary

A Stop on a shared itinerary carries the identity of its place — name, locality, country, address, position, link, stable external id and how that identity was established. It carries nothing personal: no reasons, tags, images, visits or judgments.

Each participant may separately hold a relationship to that place: their own Travel Mark, linked to the Stop as theirs. That link is visible only to them. Another participant’s Mark, private or public, is never exposed through the shared itinerary.

22.2 Personal adoption is independent

Adding a place to a shared itinerary creates no Travel Mark and no Adoption for anyone, the adder included. A participant who wants the place as their own keeps it explicitly, which creates or reuses only their own Mark.

Removing their own Mark ends only their own relationship. The Stop, its place identity and other participants’ relationships remain. Removing the Stop never removes anyone’s Mark.

22.3 Edits are attributed, not evidence

Every change to a shared itinerary records who made it, through which surface and on whose behalf (the member directly, or an AI acting for that member), when, and which itinerary it belongs to. Attribution comes from how the request authenticated, never from what a caller supplies.

Shared-itinerary activity is never taste evidence. It feeds no Adoption, preference inference, reuse or yield measure, or recommendation evidence for anyone, the acting participant included. Only a separate, explicit personal act — keeping, checking in, owning, warranting — creates personal evidence.

22.4 Removal is recoverable

A participant who can edit may remove Stops and days. Removal is recoverable and attributed; restoring brings back the same element. Removal never touches any participant’s personal records.

22.5 Governance and privacy

Only the owner invites, removes participants, changes roles or deletes the itinerary. A shared itinerary is never public. Before inviting, the owner is told which places come from their private Marks: participants will see those places’ identity, never the owner’s notes about them.

Each participant’s recommendations around a shared itinerary remain their own.
