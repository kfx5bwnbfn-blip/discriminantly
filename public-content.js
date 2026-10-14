// Public pages: the one content and capability model (review build).
//
// Everything the public pages say about what Discriminantly is, what it
// keeps, and which AI clients connect and how, lives here, so the pages,
// the menu, and later llms.txt, agent guidance and structured metadata all
// read the same facts. Status words are deliberately plain and separate:
// availability, connection method, authentication and directory listing are
// four different facts and are never collapsed into one badge.
//
// Nothing here is rendered as live that has not been verified against the
// running product (see each platform's `verified` note).

'use strict';

const site = {
  name: 'Discriminantly',
  wordmark: 'DISCRIMINANT•LY',
  brandLine: 'Your interests. Your travels. Wherever you go.',
  // Approved, verbatim.
  proposition: [
    'Discriminantly is a durable personal record of your interests, travels and plans.',
    'Note objects and interests, mark places in the real world, and build travel plans with others. Recall, organize and refine your taste corpus in Discriminantly—or connect it to AI to add to it conversationally, ask for recommendations and make plans from a direct request. What you have kept and experienced gives them sharper direction over time.',
  ],
  plain: 'Keep the places, objects and interests that catch your attention by talking naturally to your AI. They remain in Discriminantly as a record you control—ready to recall, explore and turn into plans.',
  // Identity. Visible once, on /about; the formal version is for machine-readable summaries.
  identity: 'Discriminantly is an independent AI startup building a personal record controlled by the person—not the model they happen to use.',
  identityFormal: 'Discriminantly is an independent AI startup and an AI-connected personal record for interests, places, travels and plans.',
  architecture: 'The record is held by Discriminantly. AI platforms are authorized clients of it rather than owners of its semantics.',
  capture: 'No separate filing routine: tell your AI what is worth keeping, in your own words, while it is already part of the conversation. The record holds what you asked to keep, as you put it.',
  trust: 'Private or public, record by record. Choose which AI assistants may access your account, revoke them at any time, and see what each one changed.',
  stance: 'Discriminantly is a complete application, and the durable home of your record. ChatGPT, Claude, Muse and other compatible assistants are authorized ways of working with it—not owners of the record or its meaning.',
  description: 'A durable personal record of your interests, travels and plans. Keep objects, places, visits and itineraries in one place, and connect it to the AI you already use.',
};

// Global menu, in order. `children` are crawlable links too.
const nav = [
  { label: 'Home', href: '/' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Use with AI', href: '/ai', children: [
    { label: 'ChatGPT', href: '/ai/chatgpt' },
    { label: 'Claude', href: '/ai/claude' },
    { label: 'Muse', href: '/ai/muse' },
    { label: 'Other AI assistants', href: '/ai/other' },
  ] },
  { label: 'Guides', href: '/guides' },
  { label: 'Public activity', href: '/activity' },
  { label: 'About Discriminantly', href: '/about' },
  { label: 'Support', href: '/support' },
];
const utility = [
  { label: 'Sign in', href: '/login' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
];

// What you keep: ordinary language first, then the product's name.
// First-class pages for each record type (Travel Marks has its own renderer).

// Phone captures from the application (iPhone, modern skin, dark). Alt text
// describes what is on screen; the caption states what the record is and what
// it does not imply, in the same terms the pages use. Member handles shown are
// members' own public records, as anyone signed out would see them.
const shots = {
  'note-owned': { file: 'phone-note-owned', w: 720, h: 1247,
    alt: 'A public note in Discriminantly on a phone: a coffee grinder, the member’s reason for keeping it, a link, and the Owned switch turned on',
    caption: 'A public note, with its ownership record. The note says the grinder was worth remembering; the separate Owned switch records that the member owns it. Neither implies a recommendation.' },
  'note-private-warranted': { file: 'phone-note-private-warranted', w: 720, h: 1247,
    alt: 'A privately noted shaving soap in Discriminantly on a phone, with a warrant seal in the corner and the Owned switch turned on',
    caption: 'A private note that is both owned and warranted. The seal is the warrant, a deliberate endorsement; the switch is the ownership record; the note itself is only the record that it was worth keeping. Private, so visible to the member and the AI they have connected.' },
  'new-note': { file: 'phone-new-note', w: 720, h: 1247,
    alt: 'The form for a new note in Discriminantly: collection, a link to paste, an image, title, comments, hashtags, and the Private and Owned switches',
    caption: 'Keeping a note. A pasted link fills the title, text and picture; privacy, ownership and a warrant are separate switches, each off unless the member sets it.' },
  'new-travel-mark': { file: 'phone-new-travel-mark', w: 720, h: 1247,
    alt: 'The form for a new travel mark in Discriminantly: search for a place, then place, city, country, address, why it is worth returning to, hashtags, coordinates and a link',
    caption: 'Keeping a travel mark. A place search fills the address and map position, recorded as looked up; the reason for keeping it is the member’s own. Keeping it does not say the member has been.' },
  'travel-mark-private': { file: 'phone-travel-mark-private', w: 720, h: 1247,
    alt: 'A privately marked seafood restaurant in Lisbon in Discriminantly on a phone: photo, city, address, a description, hashtags and a link',
    caption: 'A private travel mark: a Lisbon restaurant worth remembering, with its address, the member’s note on why, and tags. A mark records that a place was worth keeping, not that the member went or recommends it.' },
  'travel-mark-map-checkin': { file: 'phone-travel-mark-map-checkin', w: 720, h: 1247,
    alt: 'A public travel mark for a botanical garden in Phoenix in Discriminantly on a phone, with its map, and Directions and Check in buttons',
    caption: 'A public travel mark with its map. Check in is the separate act that records a visit, on the day the member says they were there; Directions opens the place in a maps app. Until a check-in exists, the mark proves no visit.' },
  'itinerary-private-stop': { file: 'phone-itinerary-private-stop', w: 720, h: 1247,
    alt: 'A privately planned itinerary in Discriminantly on a phone: a day plan in an Italian city, its first morning stop a privately marked pasticceria, shown as a card with photo and address',
    caption: 'A private itinerary with a private travel mark as its first stop. The plan is kept; it is not a record of going. If this plan were shared, collaborators would see the stop’s name and address after the member confirms, and nothing else of the member’s record.' },
  'itinerary-phoenix': { file: 'phone-itinerary-phoenix', w: 720, h: 1247,
    alt: 'A privately planned two-day Phoenix itinerary in Discriminantly on a phone, with a day heading, the first stop Taliesin West, and Directions, Check in and Share buttons',
    caption: 'An itinerary arranged into days and stops, with a Share button for a link or an invitation. Each stop is a travel mark; checking in at one records the visit against the mark, not the plan.' },
  'profile-collections': { file: 'phone-profile-collections', w: 720, h: 1247,
    alt: 'A member profile in Discriminantly on a phone: counts of marks, itineraries, notes and ensembles, then the member’s collections as tiles with a cover image and a count',
    caption: 'Collections on a profile, each a named group of notes with a cover and a count. A collection organizes records; membership in one says nothing about owning, liking or recommending.' },
};

const objectPages = {
  note: { desc: 'A note keeps an object, maker or idea worth remembering, with your reason. It does not mean you own, like or recommend it; those are separate records.', shots: ['note-owned', 'new-note', 'note-private-warranted'], path: '/notes', lede: 'A thing worth remembering, in your own words. Not a claim to own, like or endorse it.',
    asserts: 'Keeping a note asserts one thing: you thought it worth remembering. The headline and the line beneath are yours; tags, a link and a picture go with it.',
    not: 'It does not assert that you own it, bought it, like it, use it or recommend it. Owning is a separate record you make deliberately. Recommending is a warrant. Neither is ever inferred from a note’s existence or its wording.',
    relates: 'A note can sit in any number of collections, and can be attached to a stop in an itinerary (a coffee to buy at a roaster, say). It is never a place: places are travel marks.',
    appears: 'On your profile under Notes, in your collections, in search, and in the All feed when public. A note page shows the note, its picture, who noted it, and the comments on it.',
    ai: 'A connected assistant can find your notes by words, tag or collection, keep a new one when you ask, and adjust an existing one. It is told to write in your voice and never to record ownership or endorsement unless you say so.',
    privacy: 'Public by default, visible to other members and anyone with the link; private when you say so, then visible only to you and assistants you have connected. Every change records who made it.',
    example: { kind: 'Note', title: 'Hagi teabowl, Yamane kiln', meta: 'Kept 4 March · in “Ceramics” · public', why: 'Soft glaze, a lip that pours well. From a small kiln we found by chance.' },
    proves: ['A note does not prove you own the thing. An ownership record does.', 'A note does not prove you recommend it. A warrant does.', 'A note in a plan does not prove you bought it on the trip.'] },
  checkin: { desc: 'A check-in records that you actually visited a place, on a date or for a stay. It belongs to a travel mark and is added only when you say you went.', shots: ['travel-mark-map-checkin'], path: '/check-ins', lede: 'The record that you were actually there. Added only by you, only when you went.',
    asserts: 'A check-in asserts a visit: a date, or a stay with a first and last day, on a travel mark, with anything you want to say about it. A visit whose date you cannot recall is recorded as a visit with an unknown date.',
    not: 'It asserts nothing about liking the place, recommending it or planning to return. It is never created from a plan, a mark, a photo, a mention or an assistant’s guess.',
    relates: 'A check-in belongs to one travel mark. Several visits to the same place are several check-ins. A plan’s stop never becomes a check-in on its own.',
    appears: 'On the mark’s page, in your activity, and in the “On this day” resurfacing when a dated visit comes round. Check-ins follow the privacy of their mark.',
    ai: 'A connected assistant records a check-in only when you say you went. It is told that mentioning a place, or planning to go, is not a visit, and to ask rather than guess a date.',
    privacy: 'A check-in is as public as its mark. Deleting a check-in removes it; the history of changes keeps that it existed.',
    example: { kind: 'Check-in', title: 'Kissa Hoshikawa', meta: 'Visited 6 March 2026 · one morning', why: 'Went in the morning. Quiet. Would return.' },
    proves: ['A check-in proves a visit, as you recorded it. Nothing proves a visit otherwise.', 'A check-in does not prove endorsement.', 'A stay of several days is one check-in with a range, not several visits.'] },
  collection: { desc: 'A collection groups notes or travel marks under a name you choose, such as a city, a theme or a trip. It organizes records and implies nothing else.', shots: ['profile-collections'], path: '/collections', lede: 'Records, grouped under a name you choose. Organization, with no claim attached.',
    asserts: 'A collection asserts only that you chose to group these notes or marks together: a city, a theme, a trip, a kind of thing.',
    not: 'Being in a collection adds no claim about any record in it: not owned, not visited, not endorsed, not even liked. A collection named “Favourites” is a name, not a warrant.',
    relates: 'Collections hold notes, or marks. A record can sit in several collections. Collections are not plans: a trip you intend to take is an itinerary.',
    appears: 'On your profile, as a row of collections with counts, each opening to its records. Someone else sees a collection only when they can see at least one record in it.',
    ai: 'A connected assistant can list your collections, find records by collection, and place a note or mark in a collection when it keeps one for you.',
    privacy: 'A collection’s name is visible to others only through the public records it contains. Private records stay private inside any collection.',
    example: { kind: 'Collection', title: 'Kyoto', meta: '2 travel marks · 1 note', why: 'Kissa Hoshikawa · Gojozaka pottery walk · Hagi teabowl, Yamane kiln' },
    proves: ['A collection proves nothing about its members except that you grouped them.'] },
  itinerary: { desc: 'An itinerary arranges places and ideas into days and stops. It is a plan, private until shared, and never a record that the trip happened.', shots: ['itinerary-phoenix', 'itinerary-private-stop'], path: '/itineraries', lede: 'Places and ideas arranged into days and stops. A plan, kept; never a record of going.',
    asserts: 'An itinerary asserts an intention: these places, in this order, on these days or without days yet. Stops can be your existing marks, new places, or labels to resolve later.',
    not: 'It does not assert that you went, that you will go, or that you recommend any stop. A completed trip is recorded by check-ins on the places you visited, not by the plan.',
    relates: 'Adding a place to a plan keeps it as a travel mark if it was not one already; adding an existing mark reuses it. A stop can carry an attached note. Recommendations an assistant makes for the plan stay recommendations until kept.',
    appears: 'Under Itineraries on your profile, on its own page with a map of its stops, and, when published, in the All feed. Shared plans show who did what.',
    ai: 'A connected assistant can build a plan from a destination and what you ask for, even with an empty record, or draw on places you have kept, or combine both; it can add and arrange stops, attach notes and recommendations, and check the plan is complete. It is told to reuse places you already keep rather than duplicate them.',
    privacy: 'Plans start private. A plan can be shared by link for viewing and copying, or by invitation for working on together; neither shares the rest of your record. Publishing makes a plan visible to everyone.',
    example: { kind: 'Itinerary', title: 'Kyoto, two slow days', meta: 'Day 1 · 3 stops · shared with one friend', why: 'Kissa Hoshikawa → Gojozaka pottery walk → an evening counter' },
    proves: ['An itinerary does not prove the trip happened.', 'A stop does not prove a visit; a check-in does.', 'A stop does not prove a recommendation; a warrant does.'] },
  warrant: { desc: 'A warrant is a deliberate endorsement of a note or travel mark. It is never inferred from praise, ownership or visits, and you can withdraw it.', shots: ['note-private-warranted'], path: '/warrants', lede: 'A deliberate seal: you stand behind this. Given on purpose, never inferred.',
    asserts: 'A warrant asserts your endorsement of a note or a travel mark: you stand behind it. On a public record it is announced to the feed by default; you can give it quietly.',
    not: 'A warrant is never inferred from praise in a description, from owning something, from repeat visits or from any other record. Withdrawing a warrant removes the endorsement; the history keeps that you gave and withdrew it.',
    relates: 'A warrant sits on a note or a mark. It is independent of owning (a thing) and of visiting (a place): you can warrant something you do not own, or a place you have not checked in to, if you choose.',
    appears: 'As a seal on the record, under Warrants on your profile, and, when announced, in the All feed.',
    ai: 'A connected assistant records a warrant only when you explicitly say to endorse or stand behind something, and can withdraw one when you ask. It is told never to infer one from sentiment.',
    privacy: 'A warrant on a private record is never announced and stays with you. Withdrawing one leaves no public trace.',
    example: { kind: 'Warrant', title: 'Hagi teabowl, Yamane kiln', meta: 'Warranted 9 March · announced', why: '“I stand behind this.”' },
    proves: ['A warrant proves endorsement, as you gave it. Nothing proves endorsement otherwise.', 'A warrant does not prove ownership or a visit.'] },
};

const objects = [
  { key: 'note', plain: 'Objects and interests', name: 'Notes', one: 'Note', href: '/notes',
    what: 'Notes remember objects and interests: a thing, a maker, an idea. A note records that you thought it worth keeping, with a line on why.',
    not: 'A note does not mean you own it, like it, bought it or endorse it. Owning and endorsing are their own records.' },
  { key: 'mark', plain: 'Places', name: 'Travel Marks', one: 'Travel Mark', href: '/travel-marks',
    what: 'Travel Marks remember or consider places: a restaurant, a shop, a view, a hotel. A mark carries the place’s name and, where a lookup finds it, its address and position on a map.',
    not: 'A mark does not mean you have been, or that you recommend it. Going is a check-in; recommending is a warrant.' },
  { key: 'checkin', plain: 'Visits and experiences', name: 'Check-ins', one: 'Check-in', href: '/check-ins',
    what: 'Check-ins record actual visits: a date, or a stay, and anything you want to say about it. A check-in belongs to a travel mark.',
    not: 'Only you say when you went. Nothing is inferred from a plan, a note or a mention.' },
  { key: 'collection', plain: 'Groups of related records', name: 'Collections', one: 'Collection', href: '/collections',
    what: 'Collections organize records: notes and marks brought together under a name of your choosing, such as a city, a theme, a trip or a kind of thing.',
    not: 'A collection organizes. It adds no claim about any record in it.' },
  { key: 'itinerary', plain: 'Plans', name: 'Itineraries', one: 'Itinerary', href: '/itineraries',
    what: 'Itineraries preserve plans: places and ideas arranged into days and stops. A plan can start from a direct request, from places you have already kept, or both, and it can be shared or built with others.',
    not: 'An itinerary is an intention. It is not a record of having gone.' },
  { key: 'warrant', plain: 'Things you stand behind', name: 'Warrants', one: 'Warrant', href: '/warrants',
    what: 'Warrants are explicit endorsements: a deliberate seal on a note or mark saying you stand behind it. On a public record a warrant is announced; on a private one it stays with you.',
    not: 'A warrant is never inferred from praise, ownership or repeat visits. You give it on purpose.' },
];

// AI clients. Four separate facts per platform. `verified` says how the
// status was established; nothing below is marketed beyond it.
const platforms = [
  { key: 'chatgpt', chip: 'Plugin · Live', name: 'ChatGPT', by: 'OpenAI',
    availability: 'Live', method: 'Discriminantly plugin', auth: 'Sign in to Discriminantly when ChatGPT asks',
    directory: 'Listed in ChatGPT’s plugin directory',
    summary: 'Install the Discriminantly plugin from ChatGPT’s plugin directory, connect it by signing in, and ask.',
    steps: ['Open the Discriminantly plugin\u2019s page in ChatGPT and choose Install plugin.', 'Choose Connect when asked, and sign in to Discriminantly.', 'In a chat, mention @Discriminantly and say what you\u2019d like.'],
    guide: '/ai/chatgpt',
    asks: [['Start from a request', '@Discriminantly Plan two days in Naples around classic cafés, pizza and tailoring.'], ['Use what you have kept', '@Discriminantly Plan a weekend in London using places I’ve kept, and recommend a few complementary additions.'], ['Keep something', '@Discriminantly Keep Hatchards in London for me.']],
    verify: '@Discriminantly List my saved Travel Marks. Don’t add or change anything.',
    verifyExpect: 'ChatGPT uses Discriminantly and lists the travel marks you have kept, private ones included, because the connection is yours. Nothing in your account changes. ChatGPT may ask you to confirm before it uses the plugin.',
    trouble: ['If ChatGPT asks you to connect, or says it cannot reach Discriminantly, choose Connect and sign in again. The connection may have been revoked in Settings.', 'If it answers without using Discriminantly, start the request with @Discriminantly.', 'If it returns no records, check that you signed in with the account that holds them. A new account has none until you keep something.', 'If it still fails, write to the address on the Support page.'],
    revoke: 'In Discriminantly, open Settings › Connect to your AI and choose Revoke beside ChatGPT. Access ends immediately and nothing is deleted. Removing the plugin in ChatGPT does not by itself revoke the connection on Discriminantly’s side.',
    lastTested: '8 October 2026', lastTestedBy: 'OpenAI, during its plugin review', lastTestedBasis: 'its review account connected through the plugin, read its records and updated them, turning a kept place into a stop in a plan and recording a visit',
    reviewNote: 'The plugin’s approval and directory listing are OpenAI’s. Discriminantly has not yet recorded a dated test of its own on ChatGPT.',
    verified: 'Plugin approved by OpenAI and published by Discriminantly, 9 October 2026.' },
  { key: 'claude', chip: 'Custom connector · Tested', name: 'Claude', by: 'Anthropic',
    availability: 'Available as a custom connector, tested by Discriminantly', method: 'Custom connector (remote MCP)', auth: 'Sign in to Discriminantly when Claude asks',
    directory: 'Not reviewed or listed by Anthropic; you add the connector yourself',
    basis: 'Tested by Discriminantly: the connection and sign-in were exercised with MCP Inspector and with Claude, and are in daily use. This is Discriminantly’s own testing, not an Anthropic review.',
    summary: 'Add Discriminantly as a custom connector in Claude’s settings, sign in when asked, and turn it on in a chat.',
    steps: ['In Claude, go to Customize › Connectors, choose +, then Add custom connector.', 'Name it Discriminantly and paste the address https://www.discriminantly.com/mcp.', 'Choose Add, then Connect, and sign in to Discriminantly.', 'In a chat, turn it on under + › Connectors.'],
    note: 'Custom connectors are available on Claude’s Free, Pro, Max, Team and Enterprise plans. Free allows one custom connector. On Team and Enterprise an owner or admin adds it for the organization. Claude’s menus change; if a label differs, look for Connectors in Claude’s settings.',
    guide: '/ai/claude',
    asks: [['Start from a request', 'Using Discriminantly, plan two days in Naples around classic cafés, pizza and tailoring.'], ['Use what you have kept', 'Plan a weekend in London using places I’ve kept in Discriminantly, and recommend a few complementary additions.'], ['Keep something', 'Keep Hatchards in London in Discriminantly for me.']],
    verify: 'List my saved Travel Marks in Discriminantly. Don’t add or change anything.',
    verifyExpect: 'Claude uses the connector and lists the travel marks you have kept, private ones included, because the connection is yours. Nothing in your account changes.',
    trouble: ['Check that the connector is turned on for this chat, under + › Connectors.', 'If Claude shows the connector as disconnected, or access is refused, choose Connect in its connector settings and sign in again. The connection may have been revoked in Settings.', 'If it returns no records, check that you signed in with the account that holds them. A new account has none until you keep something.', 'If it still fails, write to the address on the Support page.'],
    revoke: 'In Discriminantly, open Settings › Connect to your AI and choose Revoke beside Claude. Access ends immediately and nothing is deleted. Removing the connector in Claude does not by itself revoke the connection on Discriminantly’s side.',
    lastTested: '13 October 2026', lastTestedBasis: 'the read-only prompt above, run through a Claude custom connector, returned the member’s travel marks and changed nothing',
    reviewNote: 'This is Discriminantly’s own testing. Anthropic has not reviewed or listed the connector.',
    verified: 'Exercised with MCP Inspector and Claude (v2.51) and in daily use. Discriminantly’s own testing; no Anthropic review or listing exists or is claimed.' },
  { key: 'muse', chip: 'Custom connector · In review', name: 'Muse', by: 'Meta',
    availability: 'Available as a custom connector', method: 'Custom connector (remote MCP)', auth: 'API key, sent as Authorization: Bearer',
    directory: 'Not yet approved or directory-listed',
    review: 'Submitted · In review',
    reviewDetail: 'Submitted to the Muse platform on 13 October 2026. Business verification, the data-processing questionnaire and the integration credentials are all in review. The pipeline is In review → Testing → Approved.',
    summary: 'Make a connection key in Discriminantly’s Settings and give it to Muse as a custom connector.',
    endpoint: 'https://muse.discriminantly.com/mcp',
    badge: 'Custom connector · API key',
    steps: ['In Discriminantly, open Settings › Connect to your AI. Name the connection Muse and choose Create a connection. Copy the key it shows: it appears once.', 'In a Muse chat, ask Muse to add a custom connector for your Discriminantly MCP server at https://muse.discriminantly.com/mcp, using an API key sent as Authorization: Bearer.', 'When Muse asks for the key, paste it into the Secure credentials store.', 'In a conversation, ask Muse to use Discriminantly.'],
    asks: [['Start from a request', 'Using Discriminantly, plan two days in Naples around classic cafés, pizza and tailoring.'], ['Use what you have kept', 'Plan a weekend in London using places I’ve kept in Discriminantly, and recommend a few complementary additions.'], ['Keep something', 'Keep Hatchards in London in Discriminantly for me.']],
    verify: 'List my saved Travel Marks in Discriminantly. Don’t add or change anything.',
    note: 'OAuth sign-in is not supported on this route. The key stands in for a sign-in, so treat it like a password; you can make it read-only, and revoke it any time in Settings.',
    guide: '/ai/muse',
    lastTested: '12 October 2026', lastTestedBasis: 'connection, reading and writing through a key were verified live',
    reviewNote: 'This is Discriminantly’s own testing. Submitted to the Muse platform 13 October 2026; in review; not yet approved or directory-listed.',
    verified: 'Connection, reading and writing through a key were verified live on 12 October 2026. Submitted to the Muse platform 13 October 2026; in review; not yet approved or listed.' },
  { key: 'other', chip: 'Remote MCP · Varies by client', name: 'Other AI assistants', by: '',
    availability: 'Varies by client; verify before relying on it', method: 'Remote MCP server', auth: 'Sign in to Discriminantly (OAuth) where the client supports it',
    directory: 'None',
    summary: 'Any client that can add a remote MCP server with sign-in can try Discriminantly. Installation, approval behaviour, available features and model decisions differ by client.',
    provenance: 'Changes are recorded under the connection the client authorized. If the client declares its name when it connects (the MCP initialize handshake), that name is recorded; if it declares none, the record says the change came through your AI, without naming which.',
    steps: ['In your AI’s settings, add a remote MCP server (often called a connector or integration) at https://www.discriminantly.com/mcp.', 'When asked, sign in to Discriminantly.', 'Turn it on in a chat, then ask.'],
    asks: [['Start from a request', 'Using Discriminantly, plan two days in Naples around classic cafés, pizza and tailoring.'], ['Use what you have kept', 'Plan a weekend in London using places I’ve kept in Discriminantly, and recommend a few complementary additions.'], ['Keep something', 'Keep Hatchards in London in Discriminantly for me.']],
    asksNote: 'Whether a given client uses Discriminantly for a request, and how, varies by client and model. Test with your own.',
    guide: '/ai/other',
    verified: 'Not verified per client. Treat compatibility as something to test.' },
];

// How it works: the eight-step progression. Text carries the meaning.
const steps = [
  { n: 1, verb: 'Notice', title: 'Keep an object, maker, idea or interest as a Note.',
    body: 'Something catches your attention: a tool, a maker, a book, a way of doing something. Keep it, with a line on why it matters to you. That line is yours; nothing about owning or recommending is assumed from it.' },
  { n: 2, verb: 'Locate', title: 'Keep a place as a Travel Mark.',
    body: 'A restaurant, a shop, a hotel, a view. The mark holds the place’s name and, when a lookup finds it, its address and map position. You can keep a place long before you go, or never go at all.' },
  { n: 3, verb: 'Experience', title: 'Add a Check-in when a visit actually happened.',
    body: 'A check-in records that you were there: a date, or a stay of several days, and anything you want to say about it. A check-in is never inferred. A plan, a note or a mention does not become a visit.' },
  { n: 4, verb: 'Organize', title: 'Bring related records together in Collections.',
    body: 'Group notes and marks under a name that means something to you. A record can sit in several collections. Collections organize; they claim nothing.' },
  { n: 5, verb: 'Compose', title: 'Build an Itinerary from a direct request, places you already keep, or both.',
    body: 'Start with a destination, interests and constraints, even if your record is empty. A connected AI can recommend places and arrange them into days and stops. When relevant records already exist, they help shape the plan’s direction. Adding a place to a plan keeps it as a mark; it does not make it a visit or an endorsement.' },
  { n: 6, verb: 'Plan together', title: 'Share for viewing and adoption, or collaborate on the same plan.',
    body: 'A share link lets someone see a plan’s days, stops and places, and make their own independent copy. An invitation lets someone work on the same plan with you, as an editor or a viewer. Either way, your own notes, visits and private records stay yours.' },
  { n: 7, verb: 'Work with AI', title: 'Let an authorized assistant recommend, plan and act for you.',
    body: 'Connect the AI you already use. It can recommend new places and build plans from what you ask. When you have relevant records, it can retrieve them, with your authorization, to sharpen the recommendations and connect new possibilities to what already matters to you. Every change it makes is recorded as that assistant acting for you.' },
  { n: 8, verb: 'Verify', title: 'See what was used, what changed, and what is still only a recommendation or a plan.',
    body: 'Discriminantly keeps a history of changes and shows where a record came from. Recommendations stay marked as recommendations until you keep them. The application is where you review and manage all of it.' },
];

const boundaries = [
  'Saving something does not purchase or book it.',
  'A recommendation is not evidence that you own or visited something.',
  'An itinerary is a plan, not a completed trip.',
  'Discriminantly does not know you by assumption. It knows what you have truthfully recorded.',
  'AI-client behaviour and availability vary by platform.',
];

// The illustrative sequence on the home page. Editorial demonstration
// content: no real member, no real corpus. Place and maker names are invented.
const demo = {
  label: 'Illustrative example',
  member: 'a member',
  beats: [
    { step: 'Keep a maker’s object', app: { kind: 'Note', title: 'Hagi teabowl, Yamane kiln', meta: 'Kept 4 March', why: 'Soft glaze, a lip that pours well. From a small kiln we found by chance.' },
      caption: 'A note records that the member thought this worth keeping, and why.' },
    { step: 'Mark a place', app: { kind: 'Travel Mark', title: 'Kissa Hoshikawa', meta: 'Kyoto · kept 5 March', why: 'A kissaten with a long counter. Siphon coffee.' },
      caption: 'A travel mark records a place. It does not yet record a visit.' },
    { step: 'Record a visit', app: { kind: 'Check-in', title: 'Kissa Hoshikawa', meta: 'Visited 6 March', why: 'Went in the morning. Quiet. Would return.' },
      caption: 'A check-in is added only because the member says they went.' },
    { step: 'Later, ask for a trip', chat: { ask: 'Plan two slow days in Kyoto in November, starting from what I’ve kept.', reply: 'You kept a Hagi teabowl from Yamane kiln and visited Kissa Hoshikawa in March. I’ll start the first morning there, then a pottery district walk, since you keep ceramics. Here is a plan…' },
      caption: 'The assistant retrieves the member’s records, and they shape the recommendations.' },
    { step: 'The plan is kept, shared and refined', app: { kind: 'Itinerary', title: 'Kyoto, two slow days', meta: 'Day 1 · 3 stops · shared with one friend', why: 'Kissa Hoshikawa → Gojozaka pottery walk → an evening counter' },
      caption: 'The itinerary is saved in Discriminantly, where it can be shared for adoption or worked on with others. Later check-ins enrich the record for next time.' },
  ],
};

// Plan together: the product's actual behaviour, stated plainly.
const together = {
  view: { title: 'View and adopt', body: 'A share link shows a plan’s days, stops and places, by name and city, to anyone who has it. They can make an independent copy in their own account. The original does not change, and nothing of yours comes with it except the places’ identities.' },
  collaborate: { title: 'Collaborate', body: 'An invitation adds someone to the same plan, as an editor who can add and arrange stops, or a viewer. Everyone’s changes are recorded under the person who made them. You can remove people and revoke invitations and links at any time.' },
  stays: 'Sharing a plan does not share or transfer your notes, your travel marks, your check-ins, your warrants, what you own, your comments or anything else in your record. Each person’s records stay their own.',
  // The same meaning for machine-readable surfaces, in the third person.
  // The distinction from generic AI memory, for /about.
  memory: 'Unlike generic AI memory, Discriminantly is an inspectable record you control, in its own application. It is independent of any one AI client, uses named record types with visible provenance, and lets you connect or revoke each assistant separately.',
  disclosureAgent: 'A private Travel Mark remains private. If it is added as a Stop in a shared itinerary, its place name and address may become visible to collaborators after the member confirms. The originating mark, private commentary and unrelated records remain private.',
  disclosure: 'If a private travel mark is added as a stop, the place details in the shared plan (its name and address) may become visible to collaborators, after you confirm. The originating mark, your private commentary and the rest of your record remain private.',
};

// Guides: real task pages, each answering one unbranded question with the
// product's actual mechanics. `q` is the question the page answers directly.
const guides = [
  { slug: 'keep-objects-and-interests', desc: 'Keep things as notes and places as travel marks, each with your reason, and group them into collections. Owning and endorsing are separate records.', shots: ['new-note', 'note-owned'], title: 'Keep and organize objects and interests', q: 'How can I keep a personal record of objects and places?',
    answer: 'Keep each thing as a Note: a headline, a line on why it matters to you, tags, a link and a picture. Keep each place as a Travel Mark. Group either into Collections. The record is yours, private or public per item, and nothing about owning, liking or endorsing is assumed from keeping.',
    sections: [
      ['What a note is for', 'A note is for a thing you want to remember: an object, a maker, an idea, an interest. It carries a headline, a short description in your own words, tags, a link if there is one, and a picture. Every note has a picture; a link’s own image is fetched for you when you give one.'],
      ['What keeping asserts, and does not', 'Keeping a note says one thing: you thought it worth remembering. It does not say you own it, bought it, like it or recommend it. Owning is recorded separately, by you, with its own history. Recommending is a warrant, which you give on purpose. Nothing is inferred from enthusiasm in your description.'],
      ['Organizing', 'Collections group notes under a name you choose: a city, a theme, a kind of thing, a trip. A note can sit in several collections. Collections organize; they make no claim about what is in them. Tags are the lighter version: words you can search by.'],
      ['Refining', 'Adjust a note any time: the headline, the line, the tags, the link, the picture, or whether it is private. Edits overwrite the previous text, and the history of changes records that an edit happened and who made it, you or an assistant acting for you.'],
      ['Finding it again', 'Search by the words you used, by tag, or by collection. Your own private notes appear in your search and nowhere else. A connected AI can find the same things by asking Discriminantly, so a note kept in March is there when you plan in November.'],
      ['With an AI', 'A connected assistant can keep a note for you when you ask (“keep this kettle in my notes”), find your notes, and adjust them. It is told to write in your voice, propose tags, and never to record ownership or endorsement unless you say so. Everything it keeps is recorded as that assistant acting for you.'],
    ], example: { kind: 'Note', title: 'Hagi teabowl, Yamane kiln', meta: 'Kept 4 March · in “Ceramics” · private', why: 'Soft glaze, a lip that pours well. From a small kiln we found by chance.' },
    links: [['/notes', 'Notes'], ['/collections', 'Collections'], ['/warrants', 'Warrants']] },
  { slug: 'remember-places', desc: 'Save a place as a travel mark, worth remembering or considering, with its address looked up. Going is a separate check-in, so saving never claims a visit.', shots: ['new-travel-mark', 'travel-mark-map-checkin'], title: 'Remember places without claiming a visit', q: 'How can I save places I want to visit without pretending I have been?',
    answer: 'Keep a place as a Travel Mark. A mark records that the place is worth remembering or considering, with its name and, when a lookup finds it, its address and map position. It never records a visit. A visit is a Check-in, which only you add, and only when you went.',
    sections: [
      ['The mark', 'A travel mark is a place: a restaurant, a shop, a hotel, a view. Give it a name and a city; Discriminantly looks the place up and records the address and coordinates as looked-up facts, marked as such, apart from anything you wrote. You can keep a place years before any visit, or never go at all.'],
      ['The visit', 'A check-in is the record that you were there: a date, or a stay of several days, with anything you want to say about it. Check-ins are never inferred from a mark, a plan, a mention or a photo. Several visits are several check-ins. A visit whose date you cannot remember is recorded as a visit with an unknown date, never with a made-up one.'],
      ['Privacy', 'A mark is visible to other members unless you make it private. Check-ins follow the privacy of their mark. If you add a private mark to a plan you share, the place’s name and address appear in that plan to the people you invite, after you confirm; the mark itself and your notes about it stay private.'],
      ['Recommendations are not marks', 'When an assistant suggests a place, it stays a recommendation, listed as such, until you keep it. Keeping turns it into a mark in your record. A place you have dismissed does not become a dislike; it is just not kept.'],
      ['With an AI', 'A connected assistant can keep a mark when you ask, after looking the place up so the address is real rather than guessed; find your marks by city or by the words you used; and record a check-in only when you tell it you went.'],
    ], example: { kind: 'Travel Mark', title: 'Kissa Hoshikawa', meta: 'Kyoto, Japan · kept 5 March · address looked up · no check-ins', why: 'A kissaten with a long counter. Siphon coffee.' },
    links: [['/travel-marks', 'Travel Marks'], ['/check-ins', 'Check-ins']] },
  { slug: 'plan-from-what-you-keep', desc: 'Plan a trip from scratch, from places and interests you have already kept, or by combining both.', shots: ['itinerary-phoenix'], title: 'Plan a trip from places and interests already kept', q: 'How can I plan trips from places I have already saved?',
    answer: 'Start an itinerary and add stops from the travel marks you already keep, then bring in new places you are considering. You do not need any saved places to begin: a connected AI can plan from a destination and what you ask for alone. When you do have a record, it can build the first draft from it: it reuses places you kept, suggests others as recommendations, and the plan is saved in Discriminantly where you refine it.',
    sections: [
      ['No saved places yet', 'An empty record is not a barrier. Ask a connected assistant for a plan from a destination, your interests and any constraints; it recommends places and arranges them into days. Those places stay recommendations until you keep them. As your record grows, later plans have more of your own evidence to draw on.'],
      ['Start from the record', 'An itinerary is days and stops. A stop can be one of your existing marks, a new place, or a label to resolve later (“somewhere for lunch”). Adding a new place to a plan keeps it as a mark; adding an existing mark reuses it, so one place is never kept twice.'],
      ['Let the AI draft it', 'Ask a connected assistant to plan a trip from what you have kept. It reads your marks and notes for the destination, builds the days, reuses the places you already have, and marks anything it adds beyond your record as a recommendation. It is told to say what it reused and what it suggested.'],
      ['Recommendations stay recommendations', 'A suggested place is listed as a recommendation until you keep it. Ideas for another time are kept apart from the plan. Nothing an assistant proposes enters your record as a kept place without your say-so.'],
      ['Refine in the application', 'Reorder days and stops, change dates and times, attach a note to a stop (a coffee to buy at a roaster, say), make the plan public or keep it private. Every change is recorded with who made it.'],
      ['A plan is not a trip', 'An itinerary is an intention. It never becomes a record of having gone. When you do go, add check-ins to the places you visited; those enrich the record the next plan starts from.'],
    ], example: { kind: 'Itinerary', title: 'Kyoto, two slow days', meta: 'Day 1 · 3 stops · 2 reused from your marks, 1 recommended', why: 'Kissa Hoshikawa → Gojozaka pottery walk → an evening counter (recommended, not kept)' },
    links: [['/itineraries', 'Itineraries'], ['/travel-marks', 'Travel Marks'], ['/ai', 'Use with AI']] },
  { slug: 'share-or-build-an-itinerary-together', desc: 'Share a view-only link that others can copy, or invite people to build the same plan with you. They see the plan’s places, not the rest of your record.', shots: ['itinerary-private-stop'], title: 'Share or collaboratively build an itinerary', q: 'How can friends build an itinerary together without sharing all their private data?',
    answer: 'Two ways. A share link lets anyone with it view a plan’s days, stops and places, and copy it into their own account. An invitation adds someone to the same plan, as an editor or a viewer. Neither shares your notes, check-ins, warrants or anything else in your record.',
    sections: [
      ['Share for viewing and adoption', 'Make a link for a plan. Anyone who has it sees the plan’s structure: days, stops, places by name and city. They can make it theirs: an independent copy in their own account, with places resolved against their own marks. The original does not change, and nothing of yours comes with the copy except the places’ identities. You can revoke a link at any time; a copy already made stays with the person who made it.'],
      ['Collaborate on one plan', 'Invite someone by link, as an editor or a viewer. Editors can add, arrange and remove stops and days; viewers can look. Everyone’s changes are recorded under the person who made them. The owner can change roles, remove people, revoke invitations and publish or delete the plan.'],
      ['What stays private', 'A shared plan carries places, not your record. Your notes, your check-ins, your warrants, what you own, your comments and your private marks stay yours. One thing is disclosed: if a private mark of yours is a stop, its name and address appear in the shared plan to participants, after you confirm.'],
      ['Each person keeps their own', 'A participant who wants a place from the plan in their own record keeps it themselves, as their own mark. Shared-plan edits are attributed but are not evidence of anyone’s taste: nothing in a shared plan becomes a kept, visited or endorsed record for anyone until that person acts.'],
    ], example: { kind: 'Itinerary', title: 'Osaka & Kyoto — June', meta: 'Shared with 2 people · 1 editor, 1 viewer · 1 link, copied once', why: 'Day 1, Osaka: fishing design and watches. Day 2, Kyoto: craft.' },
    links: [['/itineraries', 'Itineraries'], ['/how-it-works#step-6', 'How it works, step 6']] },
  { slug: 'connect-an-ai-assistant', desc: 'Connect ChatGPT, Claude or Muse to your Discriminantly record, see what a connected assistant can access, how its changes are recorded, and how to revoke it.', title: 'Connect Discriminantly to an AI assistant, and what it can access', q: 'How can I connect a personal taste or travel corpus to ChatGPT, Claude or Muse?',
    answer: 'Connect the assistant from its own settings: ChatGPT installs the Discriminantly plugin from its page; Claude adds a custom connector with sign-in; Muse adds a custom connector with a key you make in Discriminantly’s Settings. Once connected, the assistant can recommend and plan from what you ask, even before you have kept anything; read your record, including private items, to sharpen the result; and keep what you choose. You can revoke it any time.',
    sections: [
      ['What access means', 'A connected assistant can retrieve everything in your record, private items included, and can add, change and remove things on your behalf when you ask. It reaches Discriminantly only while you use it. A read-only key (Muse) lets an assistant look things up but refuses any change.'],
      ['What it remembers across conversations', 'The assistant itself remembers only what its own provider keeps. Discriminantly is what persists: a plan started in one chat is in Discriminantly, so the next conversation, on any connected assistant, can pick it up by asking.'],
      ['How this differs from an assistant’s own memory', 'Unlike an assistant’s built-in memory, Discriminantly is a record you can inspect and control, in its own application. It does not belong to any one assistant: it uses named kinds of record with visible provenance, and you connect or revoke each assistant separately.'],
      ['How changes are recorded', 'Every change an assistant makes is recorded as that assistant acting for you: ChatGPT, Claude, Muse, or the name a client declares when it connects. The record shows up in Discriminantly like anything else, where you can review, adjust or remove it.'],
      ['Revoking', 'Settings › Connect to your AI lists every connection. Revoke one and it stops working immediately; the others keep working; nothing is deleted. What the assistant already received is governed by its provider’s own policies.'],
      ['Platforms differ', 'Installation, sign-in, approval prompts, available features and what each model does with the tools vary by platform. Each has its own page with the current steps.'],
    ], example: null,
    links: [['/ai/chatgpt', 'ChatGPT'], ['/ai/claude', 'Claude'], ['/ai/muse', 'Muse'], ['/ai/other', 'Other AI assistants']] },
];

// Pages that answer the unbranded questions directly (one page per question).
// Shown on /ai, and the source of that page's FAQPage data, so the two match.
const faq = [
  ['Do I need saved places before Discriminantly can recommend or plan?', 'No. With a connected AI, you can ask for recommendations or build an itinerary from a destination, interests and constraints even when your record is empty. Existing Notes, Travel Marks, Check-ins and Warrants can give the result more specific and personal direction.'],
  ['Does Discriminantly only recommend places I have already saved?', 'No. A plan can use places you already keep, introduce new recommendations, or combine both. A recommendation remains distinct from something you have deliberately kept.'],
];

const questions = [
  ['Do I need saved places before Discriminantly can recommend or plan?', '/ai#faq'],
  ['How can an AI remember my tastes across conversations?', '/guides/connect-an-ai-assistant'],
  ['How can I plan trips from places I have already saved?', '/guides/plan-from-what-you-keep'],
  ['How can I keep a personal record of objects and places?', '/guides/keep-objects-and-interests'],
  ['How can friends collaboratively build an itinerary without sharing all their private data?', '/guides/share-or-build-an-itinerary-together'],
  ['How can I connect a personal taste or travel corpus to ChatGPT, Claude or Muse?', '/guides/connect-an-ai-assistant'],
];

// When each editorial page last changed in substance (sitemap lastmod).
const updated = { '/': '2026-10-13', '/activity': '2026-10-13', '/how-it-works': '2026-10-13', '/notes': '2026-10-13', '/travel-marks': '2026-10-13', '/check-ins': '2026-10-13', '/collections': '2026-10-13', '/itineraries': '2026-10-13', '/warrants': '2026-10-13',
  '/ai': '2026-10-13', '/ai/chatgpt': '2026-10-13', '/ai/claude': '2026-10-13', '/ai/muse': '2026-10-13', '/ai/other': '2026-10-13', '/guides': '2026-10-13', '/about': '2026-10-13', '/agent-guidance': '2026-10-13', '/privacy': '2026-10-13', '/terms': '2026-10-13', '/support': '2026-10-13' };

module.exports = { faq, shots, site, nav, utility, objects, objectPages, platforms, steps, boundaries, demo, together, guides, questions, updated };
