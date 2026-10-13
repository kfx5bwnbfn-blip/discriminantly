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
    'Note objects and interests, mark places in the real world, and build travel plans with others. Recall, organize and refine your taste corpus in Discriminantly—or connect it to AI to add to it conversationally and receive recommendations shaped by what you have kept and experienced.',
  ],
  stance: 'Discriminantly is a complete application. The application is the durable home of your record. Authorized AI clients are additional ways to work with that record; they do not own its meaning.',
  description: 'A durable personal record of your interests, travels and plans. Keep objects, places, visits and itineraries in one place, and connect it to the AI you already use.',
};

// Global menu, in order. `children` are crawlable links too.
const nav = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Use with AI', href: '/ai', children: [
    { label: 'ChatGPT', href: '/ai/chatgpt' },
    { label: 'Claude', href: '/ai/claude' },
    { label: 'Muse', href: '/ai/muse' },
    { label: 'Other AI assistants', href: '/ai/other' },
  ] },
  { label: 'Guides', href: '/guides' },
  { label: 'About Discriminantly', href: '/about' },
  { label: 'Support', href: '/support' },
];
const utility = [
  { label: 'Sign in', href: '/login' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
];

// What you keep: ordinary language first, then the product's name.
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
    what: 'Itineraries preserve plans: places and ideas arranged into days and stops. A plan can start from places you have already kept, and it can be shared or built with others.',
    not: 'An itinerary is an intention. It is not a record of having gone.' },
  { key: 'warrant', plain: 'Things you stand behind', name: 'Warrants', one: 'Warrant', href: '/warrants',
    what: 'Warrants are explicit endorsements: a deliberate seal on a note or mark saying you stand behind it. On a public record a warrant is announced; on a private one it stays with you.',
    not: 'A warrant is never inferred from praise, ownership or repeat visits. You give it on purpose.' },
];

// AI clients. Four separate facts per platform. `verified` says how the
// status was established; nothing below is marketed beyond it.
const platforms = [
  { key: 'chatgpt', name: 'ChatGPT', by: 'OpenAI',
    availability: 'Live', method: 'Discriminantly plugin', auth: 'Sign in to Discriminantly when ChatGPT asks',
    directory: 'Listed in ChatGPT’s plugin directory',
    summary: 'Install the Discriminantly plugin from ChatGPT’s plugin directory, connect it by signing in, and ask.',
    steps: ['In ChatGPT, open Plugins (in the sidebar, or at chatgpt.com/plugins).', 'Search for Discriminantly and choose Install plugin.', 'Choose Connect when asked, and sign in to Discriminantly.', 'In a chat, mention @Discriminantly and say what you’d like.'],
    guide: '/ai/chatgpt',
    verified: 'Plugin approved by OpenAI and published by Discriminantly, 9 October 2026.' },
  { key: 'claude', name: 'Claude', by: 'Anthropic',
    availability: 'Verified custom connector', method: 'Custom connector (remote MCP)', auth: 'Sign in to Discriminantly when Claude asks',
    directory: 'Not listed in a directory; you add the connector yourself',
    basis: 'Verified by Discriminantly: the connection and sign-in were validated with MCP Inspector and Claude, and are in daily use. Not reviewed or listed by Anthropic.',
    summary: 'Add Discriminantly as a custom connector in Claude’s settings, sign in when asked, and turn it on in a chat.',
    steps: ['In Claude, go to Customize › Connectors, choose +, then Add custom connector.', 'Name it Discriminantly and paste the address https://www.discriminantly.com/mcp.', 'Choose Add, then Connect, and sign in to Discriminantly.', 'In a chat, turn it on under + › Connectors.'],
    note: 'On Claude’s free plan you can add one custom connector. On Team and Enterprise plans an owner adds it first.',
    guide: '/ai/claude',
    verified: 'Validated with MCP Inspector and Claude (v2.51) and in daily use. No directory listing exists or is claimed.' },
  { key: 'muse', name: 'Muse', by: 'Meta',
    availability: 'Available as a custom connector', method: 'Custom connector (remote MCP)', auth: 'API key, sent as Authorization: Bearer',
    directory: 'Not yet approved or directory-listed',
    review: 'Submitted · In review',
    reviewDetail: 'Submitted to the Muse platform on 13 October 2026. Business verification, the data-processing questionnaire and the integration credentials are all in review. The pipeline is In review → Testing → Approved.',
    summary: 'Make a connection key in Discriminantly’s Settings and give it to Muse as a custom connector.',
    endpoint: 'https://muse.discriminantly.com/mcp',
    badge: 'Custom connector · API key',
    steps: ['In Discriminantly, open Settings › Connect to your AI. Name the connection Muse and choose Create a connection. Copy the key it shows: it appears once.', 'In a Muse chat, ask Muse to add a custom connector for your Discriminantly MCP server at https://muse.discriminantly.com/mcp, using an API key sent as Authorization: Bearer.', 'When Muse asks for the key, paste it into the Secure credentials store.', 'In a conversation, ask Muse to use Discriminantly.'],
    verify: 'List my saved Travel Marks in Discriminantly. Don’t add or change anything.',
    note: 'OAuth sign-in is not supported on this route. The key stands in for a sign-in, so treat it like a password; you can make it read-only, and revoke it any time in Settings.',
    guide: '/ai/muse',
    verified: 'Connection, reading and writing through a key were verified live on 12 October 2026. Submitted to the Muse platform 13 October 2026; in review; not yet approved or listed.' },
  { key: 'other', name: 'Other AI assistants', by: '',
    availability: 'Varies by client; verify before relying on it', method: 'Remote MCP server', auth: 'Sign in to Discriminantly (OAuth) where the client supports it',
    directory: 'None',
    summary: 'Any client that can add a remote MCP server with sign-in can try Discriminantly. Installation, approval behaviour, available features and model decisions differ by client.',
    steps: ['In your AI’s settings, add a remote MCP server (often called a connector or integration) at https://www.discriminantly.com/mcp.', 'When asked, sign in to Discriminantly.', 'Turn it on in a chat, then ask.'],
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
  { n: 5, verb: 'Compose', title: 'Use saved and newly considered places in an Itinerary.',
    body: 'Arrange places into days and stops. A plan can start from places you already keep, and bring in new ones you are considering. Adding a place to a plan keeps it as a mark; it does not make it a visit.' },
  { n: 6, verb: 'Plan together', title: 'Share for viewing and adoption, or collaborate on the same plan.',
    body: 'A share link lets someone see a plan’s days, stops and places, and make their own independent copy. An invitation lets someone work on the same plan with you, as an editor or a viewer. Either way, your own notes, visits and private records stay yours.' },
  { n: 7, verb: 'Work with AI', title: 'Let an authorized assistant retrieve relevant evidence and act for you.',
    body: 'Connect the AI you already use. It can find what you have kept, add to it when you ask, and plan from it. Every change it makes is recorded as that assistant acting for you.' },
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
  disclosure: 'If a private travel mark is added as a stop, the place details in the shared plan (its name and address) may become visible to collaborators, after you confirm. The originating mark, your private commentary and the rest of your record remain private.',
};

// Guides index: real workflows. Individual guide pages are out of scope for
// this tranche, so each entry points at the page that currently covers the work.
const guides = [
  { title: 'Keep a place', body: 'Remember a restaurant, shop or view as a Travel Mark, with its address looked up, before or without a visit.', href: '/travel-marks', via: 'Travel Marks' },
  { title: 'Keep an object', body: 'Remember a thing, a maker or an idea as a Note, with a line on why it matters to you.', href: '/how-it-works#step-1', via: 'How it works, step 1' },
  { title: 'Plan with what you have kept', body: 'Start an itinerary from the places already in your record, and let a connected AI fill the gaps.', href: '/how-it-works#step-5', via: 'How it works, step 5' },
  { title: 'Find and refine what you have kept', body: 'Recall records by place, kind or your own words; adjust a line, move something into a collection, change its privacy.', href: '/how-it-works#step-4', via: 'How it works, step 4' },
  { title: 'Build and share an itinerary', body: 'Arrange days and stops, then share a plan for viewing and adoption, or invite someone to work on it with you.', href: '/how-it-works#step-6', via: 'How it works, step 6' },
];

module.exports = { site, nav, utility, objects, platforms, steps, boundaries, demo, together, guides };
