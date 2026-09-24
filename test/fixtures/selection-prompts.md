# Selection prompts

Context for every prompt: you are an AI assistant connected to Discriminantly (the MCP server described in the catalogue) on behalf of the member. The member already has in Discriminantly: a travel mark "Hatchards" (London, mark id 41, uid mk-hatch), a note "Rimowa Classic Cabin" (note id 7, uid nt-rimowa) that they have marked owned, a kept itinerary "London in October" (uid it-london) with a stop "Coffee farm" (stop uid st-farm) in a different kept plan "Big Island" (uid it-bigisland), an earlier recommendation "medium-roast Kaʻu coffee" (recommendation uid rc-kau, resolved, target note uid nt-kau, not kept), a recommendation "manta night snorkel" (uid rc-manta, context Big Island), and an ensemble #3 with an unidentified piece "the chair" (component uid cp-chair). Assume uids above are already known to you from earlier results in this conversation.

For each prompt, decide what you would call FIRST and any immediately following calls needed to complete the member's request (at most 3), or "none" if you should just answer in conversation without calling any Discriminantly tool.

P1. "Add Hatchards in Mayfair to my marks." (assume it is NOT already marked; ignore the fixture above for this one)
P2. "Recommend some bookshops I should consider in London for my October trip."
P3. "I went to Hatchards yesterday."
P4. "I bought that Kaʻu coffee you recommended."
P5. "Keep the Kaʻu coffee recommendation."
P6. "Save this to my notes: Greenwell Farms Kona Peaberry — here's the photo URL https://example.com/peaberry.jpg"
P7. "Not this trip for the manta snorkel."
P8. "What have you recommended to me for the Big Island?"
P9. "What have I noted about coffee?"
P10. "I stand behind Hatchards. Warrant it."
P11. "I'm going to Kyoto in March — start a plan for it."
P12. "Suggest a three-day Kyoto itinerary I might like."
P13. "Put the Kaʻu coffee under the coffee farm stop."
P14. "Which notes are attached to the stops of my Big Island plan?"
P15. "That chair in ensemble 3 is a Finn Juhl Chieftain."
P16. "The coffee you recommended is from Kaʻu Coffee Mill — the Medium Roast, 7 oz bag."
P17. "Add 'some chilli crab' to my London plan."
P18. "I sold the Rimowa."
P19. "What makes a good espresso grinder?"
P20. "Yes, keep the London bookshop plan you suggested earlier." (assume a recommended itinerary exists with recommendation uid rc-londonplan)
P21. "I own the Kaʻu coffee and I want to keep it in my notes."
P22. "How many notes and marks do I have?"

Output ONLY a JSON object: {"P1": {"calls": ["tool_a", "tool_b"], "why": "one short clause"}, ...}. Use exact tool names from the catalogue, or [] for none.

Additional prompts (same context and output format):
P23. "Skip the manta snorkel — I just don't like being in the water at night."
P24. "Not the rooftop bar this time, we're travelling with the kids." (a recommendation "rooftop bar" exists, uid rc-bar, context London)

Workflow scenarios (same context and output format; for these, also put in "why" the workflow value and how many items you would record, if any):
W1. The member: "I'm new here — help me get my catalogue started. I care about Japanese kitchen knives and good coffee." You research and present five specific suggestions to the member.
W2. The member has a kept itinerary "Kyoto in March" (uid it-kyoto). The member: "What specific things should I look for in Kyoto?" You research about twelve candidates and present four of them.
W3. While doing W2 you found an excellent knife shop in Osaka that doesn't fit this Kyoto trip, and you tell the member: "Not for this trip, but worth remembering for another time: Jikko in Sakai."
W4. The member: "Recommend a good restaurant in Toronto." (No trip or plan of theirs is involved.)
W5. The member: "Keep Daunt Books in Marylebone for me."
W6. The member: "Add that Sakai knife shop you suggested to my marks." (the recommendation from W3 exists, uid rc-jikko, resolved to a place)
W7. The member: "Save the Aesop Resurrection hand balm to my notes, here's the photo URL https://example.com/aesop.jpg"
W8. The member: "What did you suggest for Kyoto that I haven't answered yet?"
W9. The member: "What should I pack for a weekend in London in November?"
W10. You considered recommending a café in Kyoto but decided against it and never mentioned it to the member.

Adoption-boundary prompts (final semantic pass; same context and output format). Also in the context: a recommendation "Jikko" (uid rc-jikko, resolved, target travel mark uid mk-jikko, mark id 55, not kept).
E1. "I went to that Sakai knife shop you suggested — Jikko — last spring."
E2. "That Kaʻu coffee you recommended — I stand behind it, best I've had."
E3. "The manta night snorkel sounds fun."
E4. "If I delete my Hatchards mark, what happens to the stop in my London plan?"
E5. "Delete my Hatchards mark." (the member has already confirmed)

Expected under the adoption boundary (for the scorer, not shown to the model): P4 and P21 -> keep_recommendation then record_note_ownership; E1 -> keep_recommendation then log_visit (add_travel_mark with visited_on is also correct: it keeps the recommended mark and records the visit); E2 -> keep_recommendation then warrant; E3 -> none; E4 -> none (answer from delete_travel_mark's description: the stop stays, as a place still to identify); E5 -> delete_travel_mark.

