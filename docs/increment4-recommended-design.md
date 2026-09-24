# Increment 4: Recommended, design direction

For review before engineering. Companion to the canvas *Increment 4: Recommended* (seven boards: three, two and one column; Keep before and after; a proposed composition; delete and review; the grammar sheet). Nothing here is implemented, and nothing in the semantic model is changed.

## A. Interaction model

**One sentence:** a recommendation is *proposed material resting beside the member's world*, made of a thinner glass, authored by Discriminantly rather than by the member, and it becomes theirs, in place, when they keep it.

Three things carry the whole distinction, and no badge does:

1. **Material.** The member's records are the existing Modern Glass sheet: `--m-glass` with the 1px light edge and the shadow. A proposal is the same recipe at roughly half the opacity, with **no light edge**, held by a hairline instead. It sits slightly behind the plane. Keep is the moment the sheet gains its edge and its weight, animated in place.
2. **Byline.** Every first-class record already opens with an authorship eyebrow: *elicierto marked*, *elicierto privately planned*. A proposal uses the same slot and grammar, but it isn't the member's act: **Proposed for elicierto**, or for plans, a contextual kind (*Next time in London*). The byline says who did the choosing, so it never has to say "recommended" in ontology language.
3. **The dot on the spine.** A kept stop is a filled dot; a proposed stop is a hollow ring; a de-resolved stop is a grey dot. Anything nested beneath a stop has no dot at all, so it can never read as a destination.

Placement does the rest: proposals live inside the itinerary experience, after the plan and the member's own nearby catalogue, never in a feed.

**What the member can do to a proposal** is exactly what the semantics allow: Keep, *Not this trip*, *Not for me*, explore. Edit, Check in, Own, Warrant and Comment don't appear until it's kept. A single line on the record's page, *Keep it to edit, own, comment or warrant*, replaces any wall of disabled controls.

## B. Responsive architecture

The same objects, three placements; density and width change, hierarchy and semantics don't.

| Layout | Columns | Where proposals go | Density |
|---|---|---|---|
| Wide desktop (≥ ~90rem) | plan · map + Nearby · **proposals** | Third column, 400–420px, under the same top offset as the map | One proposal explored (compact stops), others collapsed (kind, title, rationale, count) |
| Two columns (52–90rem) | plan · map + Nearby, then **proposals below the map** | Same column as the map, after Nearby | All collapsed; explore expands in place |
| One column (≤ 52rem) | plan → map → **Nearby → proposals** | In the reading flow, after Nearby | Collapsed; the stop list is the compact list, the nested rows lose their thumbnails |

Rules that survive every breakpoint:

- Proposals are always **after** the plan, and after the member's own nearby catalogue.
- The heading is *For another time* with a small italic count (*proposed after this plan · 3*). No "Recommended for you".
- The third column is not a sidebar: it has no chrome of its own, its sheets are the same width as a mark card, and it inherits the itinerary's top offset and gutters.
- With nothing proposed, the column doesn't exist and the map column takes its place. On two columns and one column there's no heading. No empty state.

Implementation: `.itin-cols` already flex-wraps two 41.5rem tiles. The third tile is a third flex child with the same basis; at the widest breakpoint it wraps into a third column, in the middle range it wraps under, and on a phone everything stacks. The proposal sheets render once; only their container moves.

## C. The recommended itinerary

**Hierarchy, top to bottom:**

1. **Kind**, in the eyebrow slot. Three phrasings, one per bounded type, distinguished by wording rather than by a taxonomy: *Next time in London* (same city), *Like London, in Stockholm* (similar dimensions), *Another direction · Berlin* (a different thread). The city is the bold word.
2. **Title**: the organising idea, one line, sentence case (*Another side of your interest in craft, books and specialist shops*).
3. **Rationale**: two sentences at most, in the second person, naming the member's own evidence (*the bindery, the paper shop and the knife counter you have noted before*). This is the `rationale` field, rendered as the sheet's body, never truncated to a teaser.
4. **Meta**, italic: duration, stop count, *proposed 20 Sep, from this plan*.
5. **Compact stops** (explored state): one small **tile** per stop, of the proposed material, on its own thin spine with a hollow dot: the rhythm of discrete items without the full card. Each tile is a name, a small-caps locality and time, and one italic line of why. A stop that is already the member's is a glass tile with the light edge. Days are small-caps labels on the spine between tiles. A nested proposed object sits *inside* its stop's tile, on a short branch below the why line, as one text line with the ↳ eyebrow, so the containment reads before the words do.
6. **Actions**: *Explore* and *Keep this plan* collapsed; *Not this trip*, *Not for me* and *Keep this plan* explored. Individual stops carry a text *Keep*.

**Already-kept children.** A stop whose place is already the member's gets the filled dot and an *In your marks* tag; its text Keep disappears. Keeping the plan later reuses it.

**Exploring.** Explore expands the sheet in place and previews its stops on the map as **hollow rings** with their own numbering, with a legend line in the map caption: *This plan · Proposed, previewing*. Collapsing removes them. Nested objects never go on the map. Rings are the only new map state; there's no mode.

**Keep.** One tap, no confirmation. The sheet solidifies in place (light edge, full glass, the byline becomes *elicierto privately planned*), the hollow dots fill for the places that became or reused marks, unresolved stops stay unresolved, and a nested proposed object stays proposed. The meta line keeps the proposal as history: *kept today · proposed 20 Sep, from "London"*. A line under the actions says what did **not** happen: *No visits, ownership or warrants were recorded*. The kept plan then behaves like any plan: the sheet offers *Open the itinerary*.

## D. Timeline nesting grammar

Stops are places in the journey; nested things are what's associated with those places. The geometry says so:

- The main spine carries only stops. Every stop has a dot.
- Nested rows sit inside a `.kids` block: indented under the card, on a **branch** (a short hairline down from under the card, with a 12px stub into each row), so they visibly hang off the stop rather than continuing the sequence. No dot, no time, no number.
- Each row is a compact horizontal unit: 40px thumbnail (a hatch when unresolved), an eyebrow beginning with **↳**, the name, an optional italic why, and one action.

Three eyebrows, three materials:

| Eyebrow | Material | Action |
|---|---|---|
| ↳ Worth noticing here | glass with light edge (it's the member's note) | *In your notes* tag |
| ↳ **Proposed** · worth seeking here / worth bringing home | proposed material | *Keep*, and *Not for me* on hover |
| ↳ Still to identify | outline only, hatched thumbnail | *Identify* |

*Worth noticing here* is the production wording already used for stop notes, so kept rows don't change.

Inside a recommended itinerary the same rows collapse to one text line (`.ckid`): eyebrow plus name, hanging off the compact stop on a shorter branch. Nothing is dropped; only the thumbnail and the why.

On a phone the branch narrows (8px indent, 12px padding), thumbnails go to 34px, the why line is dropped, and rows keep their action.

An unresolved nested object keeps its exact position and its intention text, in outline. It never reads as an error.

## E. The grammar for other entities

**The primary itinerary's stops are untouched:** the production mark card as it appears in the feed, arced title on its SVG path, byline, category, place, address, Directions and Check in, Share. The arc is the kept mark card's signature; a proposed mark card sets its title straight, and gains the arc only when it's kept.

Board 07 shows the three states of one place as three sheets: proposed (thin, *Proposed for elicierto*, Keep and Not this trip), yours (glass, *elicierto marked*, Directions and Check in), and still to identify (outline, underlined name, *Link a travel mark*). Everything else derives:

- **Recommended travel mark**: the proposed mark card, or the ↳ row when it belongs to a stop.
- **Recommended note / destination object**: the ↳ row under its stop when it has a `context_stop_uid`; otherwise a proposed note card in the trip's *For another time* group.
- **Recommended ensemble** (board 05): one proposed sheet with the composition image, a *Pieces* list reusing the nested rows (yours / proposed / still to identify), *Keep this composition* and *Not for me*. Keeping a piece alone keeps only that piece. After Keep the sheet is the member's and gains Edit, Add a piece and Share.
- **Declined**: the row or sheet stays where it was at 60% opacity, eyebrow *Not this trip* or *Not for me*, with *Reconsider*. Declining is a reaction the member can see, not a deletion.
- **Kept by itself**: the row turns to glass, eyebrow *↳ Kept · proposed 20 Sep*, and it stays in the timeline while also appearing in the member's notes.

## F. Lifecycle interactions

- **Keep a nested object from within a stop**: tap Keep on the row. The row solidifies in place and gains the tag; the parent stop and plan are untouched.
- **Keep an individual proposed stop**: text Keep on the compact stop; dot fills; tag *In your marks*; the plan stays proposed.
- **Keep the whole plan**: board 04. Places are kept or reused; notes under stops are kept; unresolved stays unresolved; nested proposals stay proposed.
- **Delete a kept plan** (board 06): one confirmation that names what goes (the plan, its days, its stops) and what stays (the places and things kept with it). Then, on the result page, an optional review sheet: *Places and things kept with this itinerary*, one row per child with the relationships that make removal consequential (checked in once, owned, warranted, in "London", in a composition, no other use), unchecked by default, *Keep them all* and *Delete selected*. Each removal is a separate act with its own history.
- **Unresolved after a deletion elsewhere**: the stop stays, in proposed material, eyebrow *Once marked* (production wording), one plain sentence, *Link a travel mark*. A component becomes *Unidentified piece* with *Identify*. A nested note whose record was removed keeps its ↳ position and offers *Reconnect*.

## G. Modern Glass integration

The boards use the real tokens from `style.modern.css` (dark reference, light re-derived), the existing mark card, the existing spine, `.stop-eb` eyebrows, the *Once marked* stop, `.ens-comp` rows and the `.sugg` list. The additions are two: a **proposed material** token pair (`--m-prop`, `--m-prop-line`: glass at ~half opacity, no light edge) and the **branch** geometry for nested rows. Both are shown in light and dark.

Chaparral Pro is the identity face; the boards render in Source Serif 4 as a stand-in, and production keeps Chaparral.

## H. Engineering handoff

**Reusable components**

- `ProposedSheet`: the material and byline wrapper; used by plans, marks, notes and ensembles.
- `RecommendedItinerary`: collapsed / explored / kept; owns the compact stop list and map preview.
- `CompactStop` (a tile: proposed or kept material) and `CompactKid` (the nested line inside it): the recommended-plan rows.
- `StopKids` (extends the existing `noteKids`): the branch container with three row states.
- `ReviewChildren`: the post-deletion sheet.
- Map: a `ring` pin style (the existing `ring-sm.png` asset) and a caption legend.

**Data the web needs, all of it already there:** `list_recommendations` grouped by context, `recommendationView` (kind, label, rationale, resolution, target with `kept`, context stop), stop attachments, `unadoptedExplanation` for the proposed state, the provenance `de_resolved` rows for *Once marked*, and the reaction states.

**States**: collapsed, explored, kept, declined (two reasons), for plans; proposed, yours, kept-from-proposal, declined, unresolved, de-resolved, for records and rows; map: none, previewing.

**Transitions**: Keep solidifies in place (opacity and edge, ~320ms, the existing `--m-ease`); explore expands height; rings appear and disappear with the sheet. Reduced motion: no animation, the same end states.

**Responsive rules**: §B. One markup, one stylesheet block, container moves at 52rem and ~90rem.

**Nesting rules**: §D. Nested rows never get a dot, a time or a number; the main spine carries stops only.

**Interaction requirements**: Keep never confirms; delete always confirms once; review is separate; a proposed record page shows only Keep and the two reactions plus one line.

## I. Gaps to decide before build (not designed around)

1. **The three "for another time" kinds aren't stored.** `workflow` is `for_another_time` for all three; nothing says *same city* vs *similar* vs *different direction*, and no field links a for-another-time plan to the itinerary it emerged from. *Same city* can be inferred from the context, the other two can't. Two options: derive the eyebrow from the rationale by convention (fragile), or add an origin reference and a small `relation` attribute to the recommendation. **A schema decision.**
2. **A place inside a recommended plan has no Keep of its own.** New places added to a recommended plan are marks explained by the plan, with no recommendation row, so *Keep* on a single compact stop has no server operation. It needs either a per-child recommendation created alongside the plan, or the general Keep capability already deferred. **The design shows the affordance; it can't ship without one of those.**
3. **Nested proposed objects under a stop in an active (kept) plan** can only be expressed by `context_stop_uid`; a kept plan refuses an un-kept note as an attachment, by design. On Keep of such an object, should it also be attached to the stop it was proposed for? The boards assume yes. **A product decision.**
4. **Reconsidering a declined proposal** has no server operation (reactions only move forward). Either add one or drop *Reconsider*.
5. **Web Keep and Discard on ensembles** are broken today (`mcpCall` arguments); the proposed-composition sheet depends on that fix, and on the actor being the member rather than an AI connection.
6. **Delete-and-review** needs a new web route that lists a deleted parent's children with their relationships. No schema change.
7. **Map preview** of proposed stops needs their coordinates in the page; stops without a resolved place don't appear, which is correct.

Everything else in the boards is expressible with the current model and surface.
