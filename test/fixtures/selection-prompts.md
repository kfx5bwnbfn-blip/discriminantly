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
