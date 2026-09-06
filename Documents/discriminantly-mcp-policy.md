# discriminantly MCP Constitution
## Machine-Readable Policy v0.2

**Status:** Draft  
**Version:** 0.2

---

# 1. Purpose

This specification defines how an AI agent connected to discriminantly MAY access, interpret, and modify a user's taste record.

The AI MUST treat discriminantly as a persistent record of user-owned taste and MUST preserve distinctions between:

1. attention;
2. experience;
3. curation;
4. endorsement;
5. relational behavior;
6. inference.

The AI MUST NOT represent an inference as an explicit user preference.

---

# 2. Core Objects

## 2.1 Note

A `note` represents a physical object the user wishes to remember.

A Note MUST NOT, by itself, be interpreted as an endorsement.

### Evidence

`note_created` → evidence of attention or interest.

It MAY be used as contextual evidence for personalization.

It MUST NOT be treated as equivalent to a Warrant.

---

## 2.2 Travel Mark

A `travel_mark` represents a place the user wishes to remember.

A Travel Mark MUST NOT, by itself, establish that the user has visited or endorsed the place.

A Travel Mark MAY represent:

- intended travel;
- remembered travel;
- curiosity;
- recommendation;
- personal significance;
- or other interest.

---

## 2.3 Check-in

A `check_in` represents an explicit record that the user visited a Travel Mark.

A Check-in MUST be treated as evidence of experience.

A Check-in MUST NOT automatically be treated as evidence of positive preference.

Valid inference:

> User visited X.

Invalid automatic inference:

> User likes X.

---

## 2.4 Collection

A `collection` represents an intentional grouping of Notes and/or Travel Marks.

Collection membership MAY be used as contextual evidence.

Collection membership MUST NOT automatically establish equal preference for every contained object.

An AI MAY use collection names, descriptions, and membership to understand context where authorized.

---

## 2.5 Warrant

A `warrant` represents an explicit endorsement.

A Warrant MUST be treated as stronger evidence of positive preference than:

- a Note;
- a Travel Mark;
- a Collection membership;
- a search;
- a view;
- or a recommendation request.

A Warrant means, semantically:

> The user stands behind this.

A Warrant MUST NOT be interpreted as a permanent or unconditional preference.

---

# 3. Evidence Model

AI agents MUST distinguish observed facts from inferred conclusions.

## 3.1 Evidence classes

Evidence SHOULD be classified as:

`explicit_user_statement`

The user directly states a preference.

`explicit_user_action`

The user deliberately performs an action such as creating a Note, Check-in, Collection, or Warrant.

`conversational_signal`

The user's language strongly communicates a preference during an AI conversation.

`behavioral_signal`

Repeated user behavior suggests a pattern.

`relational_signal`

The user's behavior overlaps meaningfully with the records or actions of other users.

`ai_inference`

The AI derives a conclusion that was not explicitly stated.

---

## 3.2 Evidence hierarchy

When evidence conflicts, the AI SHOULD prioritize:

1. explicit user statement;
2. explicit user action;
3. strong conversational signal;
4. meaningful relational/behavioral signal;
5. AI inference.

AI inference MUST NOT overwrite explicit contradictory evidence without user authorization.

---

# 4. Relational and Network Signals

## 4.1 Re-noting

When a user creates a Note or other record corresponding to an object previously recorded by another user, the system SHOULD preserve the source relationship.

Conceptually:

```text
user: Brian
action: note
object: X
source_user: Alice
```

The system SHOULD distinguish this from an independently created Note where no source relationship exists.

---

## 4.2 Repeated overlap

Repeated overlap between users MAY constitute a `relational_signal`.

A single overlapping object MUST NOT, by itself, establish meaningful taste affinity.

Repeated overlap MAY increase the inferred likelihood of affinity.

The system SHOULD consider:

- number of overlapping objects;
- frequency of overlap;
- recency;
- object category;
- strength of the underlying signals;
- whether overlap is concentrated in a particular domain;
- and whether the overlapping objects were merely noted or also warranted/experienced.

---

## 4.3 Domain-specific affinity

Taste affinity SHOULD be represented with domain specificity where possible.

Valid:

```text
affinity:
  user_a: Brian
  user_b: Alice
  domain: hotels
  status: inferred
```

Preferable to:

```text
Brian and Alice have the same taste.
```

The system MUST NOT assume that affinity in one domain implies affinity across all domains.

---

## 4.4 Affinity is inference

Taste affinity MUST remain distinguishable from an explicit user statement.

The system MUST NOT transform:

```text
relational_signal
```

into:

```text
explicit_preference
```

without supporting evidence from the user.

---

# 5. Privacy

## 5.1 Public and Private

Each Note and Travel Mark MAY have a visibility state:

`public`

or

`private`

Visibility controls human/social access.

Private status MUST NOT automatically prohibit access by an AI that has been explicitly authorized by the user.

---

## 5.2 Private-data authorization

An AI MUST NOT access private Notes or Travel Marks unless the user has granted the required permission.

Authorization SHOULD be granted at the account or connection level where practical.

The user SHOULD be able to revoke authorization.

---

## 5.3 Network visibility

An AI MUST NOT expose another user's private content merely because that content contributed to an inferred affinity relationship.

Derived network signals MUST respect the source user's visibility and authorization rules.

A system MAY communicate an appropriate high-level affinity without exposing unauthorized underlying private content.

---

# 6. Authorization Scope

AI permissions SHOULD be separable into at least:

```text
read_public
read_private
write_notes
write_marks
create_collections
create_check_ins
create_warrants
```

Where technically practical, additional granular permissions MAY be supported.

---

# 7. AI Capability Levels

## 7.1 Observe

The AI MAY read authorized information.

The AI MUST NOT modify the user's record.

---

## 7.2 Infer

The AI MAY derive preferences, relationships, or patterns from authorized information.

Inferences MUST remain distinguishable from explicit user data.

---

## 7.3 Suggest

The AI MAY propose a modification to the user's record.

The user MAY accept or reject the proposed action.

---

## 7.4 Act

The AI MAY modify the user's record when the required authorization has been granted.

The AI MUST respect the authorization scope.

---

# 8. Warranting

## 8.1 Default rule

An AI MUST NOT create a Warrant merely because an object has been:

- viewed;
- searched;
- discussed;
- recommended;
- Marked;
- placed in a Collection;
- or otherwise encountered.

These actions establish interest or context, not endorsement.

---

## 8.2 Conversational warranting

An AI MAY identify a conversational signal as warrant-worthy when the user's language clearly expresses strong positive judgment.

Examples include:

- strong praise;
- explicit recommendation;
- explicit statement of exceptional approval;
- explicit statement that the user would recommend the object;
- repeated enthusiastic endorsement.

---

## 8.3 Confirmation mode

When `create_warrants` authorization is confirmation-based, the AI MUST request confirmation before creating a Warrant.

The Warrant MUST NOT be created until confirmation is received.

---

## 8.4 Automatic mode

When the user has explicitly authorized automatic warranting, the AI MAY create Warrants without requesting confirmation for each individual action.

The AI MUST still:

1. apply the defined evidence threshold;
2. preserve provenance;
3. avoid warranting based solely on weak signals;
4. remain within the user's authorization;
5. permit subsequent correction or revocation.

---

# 9. Provenance

Every AI-created Warrant SHOULD retain provenance sufficient to distinguish it from a Warrant created directly by the user.

Minimum conceptual provenance:

```text
origin:
  user | ai

agent:
  identifier of originating AI, where available

authorization:
  confirmation | automatic

evidence_type:
  explicit_user_statement
  explicit_user_action
  conversational_signal
  behavioral_signal
  relational_signal
  ai_inference

created_at:
  timestamp

confidence:
  low | medium | high
```

An AI MUST NOT represent an AI-generated Warrant as though the user directly created it.

---

# 10. Corrections and Reversibility

Users MUST be able to revoke a Warrant.

When a user rejects an AI-created Warrant, the AI MUST NOT subsequently use that rejected Warrant as evidence of user preference.

Where supported, the system SHOULD preserve the correction as provenance rather than silently deleting the history of the error.

---

# 11. Network Discovery

An AI MAY use authorized relational signals to improve discovery and recommendation.

For example, it MAY determine:

> User A repeatedly selects objects previously recorded by User B.

This MAY be used to recommend:

- people;
- Notes;
- Travel Marks;
- Collections;
- or other relevant content.

The system SHOULD prefer meaningful taste overlap over raw engagement metrics.

---

# 12. Popularity versus Taste Affinity

Popularity MUST NOT be treated as equivalent to taste affinity.

A highly popular object is not necessarily more relevant to a particular user than an obscure object recorded by someone whose taste repeatedly overlaps with theirs.

Where sufficient evidence exists, recommendations SHOULD favor demonstrated personal relevance.

---

# 13. Interpreting Network Signals

An AI SHOULD be able to distinguish:

```text
Brian follows Alice.
```

from:

```text
Brian repeatedly re-notes Alice's objects.
```

and from:

```text
Brian repeatedly warrants objects previously recorded by Alice.
```

These represent increasingly meaningful forms of potential taste affinity.

However, none MUST be represented as an explicit declaration of shared taste unless the user has made such a declaration.

---

# 14. Reading the Taste Record

When responding to a user, an AI SHOULD prefer the most relevant and strongest available evidence.

For example:

```text
Warranted + Checked-in
```

is stronger evidence of positive experiential preference than:

```text
Marked
```

Likewise:

```text
Explicit user statement
```

is stronger than:

```text
AI inference
```

And:

```text
Repeated relational overlap
```

may provide useful contextual evidence about whose taste may be relevant to the user, without becoming an explicit preference.

---

# 15. Writing to the Taste Record

Before modifying discriminantly, the AI MUST determine:

1. what object is being modified;
2. what action is being performed;
3. what evidence supports the action;
4. whether the user has granted authority for that action;
5. whether confirmation is required;
6. what provenance must be recorded.

If any required authorization is absent, the AI MUST NOT perform the action.

---

# 16. Autonomous Custodianship

A user MAY authorize an AI to maintain their discriminantly record on their behalf.

Such authorization does not transfer ownership of the record.

The AI remains a custodian acting under delegated authority.

The AI SHOULD favor conservative interpretation when evidence is ambiguous.

The AI MUST NOT manufacture preferences merely to make the taste record appear complete.

---

# 17. Portability

The discriminantly taste record SHOULD be usable by multiple authorized AI agents.

An AI MUST NOT assume that it is the sole or permanent interpreter of the user's taste.

The underlying record SHOULD remain independent of any particular AI provider.

A user's taste SHOULD therefore be portable between authorized AI systems.

---

# 18. Fundamental Machine Rule

For every interaction with discriminantly, the AI SHOULD be able to distinguish:

```text
OBSERVED:
What the user explicitly did or said.

EXPERIENCED:
What the user demonstrably experienced.

ENDORSED:
What the user explicitly stood behind.

RELATIONAL:
What the user's behavior repeatedly reveals about
their overlap with other people's records.

INFERRED:
What the AI believes follows from the evidence.
```

These categories MUST NOT be collapsed.

---

# 19. Canonical Principle

```text
OBSERVE what the user records.
DISTINGUISH what the user experiences.
RESPECT what the user explicitly endorses.
NOTICE what the user repeatedly chooses from others.
USE the network to reveal potential affinities.
INFER only where inference is useful.
ASK before acting when authority is insufficient.
ACT only within granted authority.
PRESERVE provenance.
KEEP the user's taste portable.
```

The AI is not the author of the user's taste.

The AI is its interpreter and, when authorized, its custodian.
