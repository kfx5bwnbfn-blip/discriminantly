# Discriminantly MCP Policy

## Purpose

This policy defines how AI systems and MCP-compatible clients should interact with a user's Discriminantly taste record.

It translates the principles of the Discriminantly Constitution into machine-consumable rules.

The central principle is:

> **Discriminantly stores and stewards a user's taste. The user remains the authority over that taste.**

An AI may read, interpret, and potentially modify the record only within the permissions and constraints established by the user and this policy.

---

# 1. Identity and Ownership

### 1.1 User sovereignty

The user's Discriminantly record belongs to the user.

AI systems must treat the record as user-owned data.

Discriminantly is a steward and service provider, not the owner of the user's taste.

### 1.2 No implied ownership

Access to a user's record does not confer ownership of the record or its contents.

AI systems must not represent the user's taste as belonging to the AI, application, model provider, or third party.

---

# 2. Privacy and Authorization

### 2.1 Explicit authorization

An AI may access a user's private Discriminantly content only when the user has authorized that access.

Authorization should be treated as a permission boundary.

### 2.2 Private does not mean inaccessible to authorized AI

A Note or Travel Mark marked private is shielded from public visibility.

If the user has explicitly authorized an AI to access their private Discriminantly record, the AI may use that information within the authorized scope.

### 2.3 No secondary disclosure

An AI must not disclose private Discriminantly information to another person or service unless the user has authorized that disclosure.

---

# 3. Evidence Types

AI systems should preserve distinctions between different types of information.

At minimum, the following categories should remain distinguishable:

### Explicit

Information directly provided or actioned by the user.

Examples:

- a Note created by the user;
- a Travel Mark created by the user;
- a Check-in;
- a Warrant;
- a Collection created by the user.

### Observed

Behavior recorded by the system.

Examples:

- viewing;
- re-noting;
- following;
- repeated interaction.

### Derived

Relationships calculated from observed or explicit information.

Examples:

- semantic similarity;
- recurring topical affinity;
- user-to-user taste overlap.

### Inferred

An interpretation produced by an AI or system.

Examples:

- "The user appears to have a strong affinity for contemporary Japanese architecture."

### AI-generated

A statement, object, or action created by an AI rather than directly by the user.

These categories must not be silently collapsed.

---

# 4. Provenance

### 4.1 Preserve origin

Where practical, meaningful taste signals should retain provenance.

The system should be able to identify whether information originated from:

- the user;
- system observation;
- algorithmic derivation;
- or AI inference.

### 4.2 No inference laundering

An inferred preference must not be written back into the record in a way that makes it appear to have been explicitly expressed by the user.

For example, an AI must not convert:

> "The user appears to like minimalist Japanese design."

into an apparently user-authored preference without preserving its inferred status.

---

# 5. Read Access

### 5.1 Authorized retrieval

An AI may retrieve authorized portions of a user's Discriminantly record.

### 5.2 Contextual retrieval

AI systems should retrieve information relevant to the user's current task rather than indiscriminately exposing the entire record.

### 5.3 Semantic retrieval

Where available, AI systems may use semantic retrieval to identify relevant objects and relationships.

Semantic relevance does not establish user endorsement.

---

# 6. Write Access

### 6.1 Read and write are separate permissions

Authorization to read a taste record does not automatically authorize modification.

Write operations should require appropriate authorization.

### 6.2 Preserve user agency

Where an operation materially changes the user's explicit taste record, the system should prefer explicit user confirmation unless the user has granted appropriate standing authorization.

### 6.3 Provenance of AI actions

Actions performed by an AI on behalf of a user must be distinguishable from actions performed directly by the user.

---

# 7. Warrant

## 7.1 Status

Warrant is a future Discriminantly capability.

It is not currently implemented.

MCP implementations must not assume that a Warrant resource or operation exists in the current application.

### 7.2 Meaning

A Warrant represents an explicit act of endorsement:

> **"I stand behind this."**

A future Warrant may apply to:

- Notes;
- Travel Marks;
- and other appropriate objects as defined by the product.

### 7.3 Warrant is not equivalent to inference

An AI inference that a user probably likes something must never automatically be represented as an explicit Warrant.

### 7.4 Potential AI Warranting

A future MCP implementation may permit an AI to Warrant on behalf of a user if:

1. the user has granted the appropriate authority;
2. the evidence supporting the action is sufficiently strong;
3. the action satisfies the applicable policy;
4. provenance identifies the action as AI-executed on the user's behalf;
5. and any required confirmation or guardrail has been satisfied.

The exact threshold remains a product decision.

---

# 8. Evidence Weight

AI systems should not treat all signals as equivalent.

Illustratively:

**Explicit Warrant**

> Strong explicit endorsement.

**Explicit user statement**

> Strong direct evidence.

**Check-in**

> Evidence of experience, not necessarily endorsement.

**Repeated re-noting**

> Evidence of recurring interest or affinity.

**Note**

> Evidence that something was worth recording.

**Single view or interaction**

> Weak behavioral evidence.

These are examples of an evidence hierarchy, not a universal numerical scoring system.

Implementations should preserve the distinction rather than reducing every signal to a single opaque preference score.

---

# 9. Network Signals

### 9.1 User relationships

Following and follower relationships should not automatically be interpreted as taste similarity.

### 9.2 Repeated overlap

Repeated re-noting or similar behavior may provide evidence of taste affinity between users.

### 9.3 No popularity substitution

Popularity must not automatically be treated as personal relevance.

The objective is to identify:

> **whose judgment repeatedly appears useful to whom**

rather than:

> **who is most popular.**

### 9.4 Relationship inference

A derived relationship such as:

> User A → has recurring taste overlap with → User B

must remain distinguishable from an explicit statement by either user.

---

# 10. Semantic Relationships

The system may eventually represent relationships including:

- Note → belongs to → Collection
- Travel Mark → checked-in by → User
- User → re-noted → Note
- User → follows → User
- Note → semantically resembles → Note
- Note → relates to → concept
- User → demonstrates affinity for → concept
- User A → demonstrates recurring overlap with → User B
- Discriminantly object → potentially matches → external catalogue object

These relationships may be:

- explicit;
- observed;
- derived;
- or inferred.

Their provenance and confidence should be preserved where meaningful.

---

# 11. External Catalogue Interpretation

Discriminantly may eventually act as a portable taste layer that an authorized AI can use to interpret external catalogues.

The conceptual model is:

> **Discriminantly provides the user's taste record.**
>
> **An external service provides its catalogue.**
>
> **AI interprets the intersection.**

External services remain responsible for the accuracy, availability, and governance of their own catalogues.

Discriminantly should not unnecessarily recreate those catalogues.

The objective is interoperability.

---

# 12. Portability

### 12.1 Portable by design

The user's taste record should be representable in portable, machine-readable forms.

### 12.2 No proprietary captivity

AI systems and external services should not intentionally make the user's taste dependent upon an opaque representation that prevents reasonable extraction or reuse.

### 12.3 AI portability

A user should be able to authorize another compatible AI system to access their taste record without having to reconstruct years of preferences from scratch.

The principle is:

> **The AI changes. The taste record remains.**

---

# 13. Semantic Search and Retrieval

Semantic search may use:

- embeddings;
- vector retrieval;
- metadata;
- graph relationships;
- entity resolution;
- natural-language interpretation;
- or combinations of these.

However:

> **semantic similarity is not endorsement.**

A semantically similar object may be relevant to a user's taste without being something the user has expressed interest in.

AI systems should preserve this distinction.

---

# 14. AI Context and Interpretation

When an AI uses Discriminantly information to personalize a response, it should prefer the strongest relevant evidence available.

Where meaningful uncertainty exists, the AI should not present inference as fact.

For example:

**Preferred:**

> "You've Warranted several restaurants with similar characteristics, so these may be relevant to you."

**Not preferred:**

> "You like this type of restaurant."

unless the available evidence genuinely supports that level of certainty.

---

# 15. Security

AI systems must treat authorized Discriminantly data as sensitive user data.

Access should be scoped to the minimum necessary context.

Credentials, authorization tokens, private content, and other sensitive information must not be exposed unnecessarily.

---

# 16. Agency and Guardrails

The system should distinguish between:

### Retrieve

Read information.

### Interpret

Generate an inference or recommendation.

### Propose

Suggest a change to the user's record.

### Execute

Modify the user's record.

Increasing levels of agency should require increasingly appropriate authorization.

---

# 17. Core Machine Principle

An MCP implementation should always be able to answer, where relevant:

> **What do we know?**
>
> **How do we know it?**
>
> **Who asserted it?**
>
> **Is it explicit or inferred?**
>
> **What permission allows us to access it?**
>
> **What permission allows us to act upon it?**

---

# 18. The Constitutional Test

When an implementation decision is ambiguous, prefer the interpretation that best preserves:

1. user sovereignty;
2. provenance;
3. privacy;
4. portability;
5. reversibility;
6. and earned trust.

The goal is not to make AI powerless.

The goal is to make AI **useful without allowing it to silently rewrite the user's relationship with their own taste.**

---

# 19. North Star

Discriminantly should provide an authorized AI with a durable, portable representation of a person's evolving taste.

The AI should be able to:

> **read it, understand it, reason over it, and—when properly authorized—help maintain it.**

But the underlying principle remains:

> **The taste belongs to the user.**
>
> **Discriminantly stewards it.**
>
> **AI may understand it.**
>
> **The user decides who gets to use it.**