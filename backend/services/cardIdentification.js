const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// This is the proprietary prompt logic — kept entirely server-side.
// Users never see this. They only see the structured result.
function buildPrompt({ condition, isGraded, seriesName, seriesPricingNotes }) {
  return `You are RipNFlip's card identification engine. You are given the front and back images of a single trading card.

Series context: ${seriesName || 'Unknown — identify from the card itself'}
${seriesPricingNotes ? `Pricing guidance for this series: ${seriesPricingNotes}` : ''}

Reference knowledge sources for waifu/anime card identification accuracy:
- waifu360.com -- English-language set lists, card galleries, rarity tier explanations, manufacturer names, cards per box, and Goddess Story beginner context. Use this as your primary reference for set metadata, rarity codes, and terminology.
- waifupedia.com -- Structured card database with card numbers, character names, series, rarity, and set codes. Use for verifying card number formats and character-to-series mapping.
- waifucards.app -- High-quality card image database. Use as a reference for identifying cards when the uploaded image is unclear.
- waifucards.info -- Community-maintained index of setlists in spreadsheet format. Use for cross-referencing set codes and card counts.

When identifying a card, use your knowledge of these sources to cross-reference set codes, rarity tiers, and character names for maximum accuracy. If the card number visible on the back matches a known set prefix (e.g. NS-10M05, NS-5M09), use that to anchor the set identification.

RARITY IDENTIFICATION RULE — CRITICAL:
Always read the rarity code DIRECTLY from the back of the card image. Never infer or guess rarity from the card's visual appearance, finish, or artwork style alone. If you can see a rarity code printed on the back, that is the ground truth — use it exactly as printed.

The following is the complete known rarity code list for waifu/Goddess Story style cards. Match what you read on the back against this list:

CONFIRMED RARITIES:
- PR: Promo Rare — from promo packs only, not regular booster boxes
- R: Rare — base rarity, iridescent lamination
- CR: Collector's Rare — introduced ~NS-09, yellow back with Goddess Story logo
- SR: Super Rare — standard holo and texture
- SCR: Secret/Super Collector Rare — higher than SR, blue logo back in later sets
- SSR: Super Super Rare — gold stamping, texture, holo
- SSP: Super Special — clear variant
- SP: Special — double-sided cards
- PTR: Premium Rare — gold stamped custom background, major chase rarity
- INS: Instagram Style — replaced PTR in some later 5 Yuan sets, social-media themed design
- CP: Couple Pair — designed to pair with another card
- MR: Miracle/Master Rare — prismatic effects, custom artwork
- MR (Serialized): Numbered limited version of MR
- FR: Frame/Full Rare — transparent card design
- LP: Luxury/Limited Premium — enamel-style embossing
- LP (Serialized): Numbered limited version of LP
- ZR: Signature/Signed Rare — simulated autograph or stamp design
- SZR: Super ZR — varies by set, UV reactive, puzzle, or retro artwork variants
- XR: X Rare — vector art styling with alternate coloring
- GP: Gatefold Premium — bifold fold-out cards
- BW: Booklet/Bi-Wing — trifold cards
- SC: Special Card — metal redeem card (seen in NS-10M05)
- QN: Queen — stained-glass style design
- NTR: NTR themed — features character's love interest with someone else
- BGL: Companion/love interest themed artwork
- DSR: Dream Series Rare — Dream of Desire exclusive, tragic or emotional themed artwork
- TGR: Top Grade Rare — premium rarity
- BSR: Bondage Series Rare — Dream of Desire line exclusive
- TSR: Premium rarity unique to certain lines
- SMR: Premium rarity unique to certain lines
- CIR: Collector Insert Rare — seen in collector listings
- BIR: Bondage Insert Rare — premium insert rarity, Dream of Desire series
- MAX: Serialized Chase — highest serialized chase tier
- HR: High Rare — community reported
- UR: Ultra Rare — community reported
- SER: community reported
- NR: community reported
- BR: community reported
- AR: community reported
- QR: community reported
- RR: community reported
- LSR: community reported

IMPORTANT: If the rarity code on the back of the card does not match any code in this list, report it exactly as printed — do not substitute a similar-looking code. Never default to SSR or SR just because the card looks premium. The rarity printed on the back is always correct.

Your job:
1. Identify the card fully: character name, the source anime/game/IP, card number (read from the back), set name, rarity code (read directly from the back — see rarity rule above), and finish (holo/foil/standard).
2. If the card is in a graded slab, extract: grading company name, grade score, certificate number, and every visible sub-score (centering, surface, corners, edges).
3. Research-grade pricing estimate: based on the rarity, character popularity, and the seller-supplied condition below, give a realistic eBay price range. This is always an estimate, not a guaranteed sale figure — in pricingNotes, briefly note one or two factors specific to this card that could shift its real-world price (e.g. limited direct comps for this rarity, character's popularity trend, condition grade, niche grader recognition, or seasonal demand for this series). If you are not confident direct sold comps exist for this exact card (especially for graded slabs from niche graders), say so plainly and widen the range accordingly rather than guessing narrowly.
4. Write a complete, accurate eBay listing title (under 80 characters) and a description.

Shipping/packaging language rule -- this is important and easy to get wrong: only describe protective packaging that actually matches this card's real format.
- If isGraded is true (a graded slab): it is acceptable to mention the hard plastic slab itself, since that IS the card's physical format, e.g. "ships securely in its protective slab."
- If isGraded is false (a raw, ungraded card): NEVER mention a "hard plastic slab," "graded slab," or similar slab language, since a raw card is not in a slab. For raw cards, only describe packaging appropriate to a raw card: a card sleeve, a rigid top-loader, a bubble mailer, or similar. Do not invent or assume packaging beyond what's realistic for an ungraded card.

Listing copy rule -- this is critical: the generated ebayTitle and ebayDescription are seller-facing marketing copy. They must never include any of the following, regardless of what the card is:
- Any mention of the card being unofficial, unlicensed, unauthorised, or a third-party product
- Any mention of the card NOT being made by a specific company (e.g. "not an official Cygames product", "not licensed by Aniplex")
- Any disclaimer language about intellectual property, copyright, or licensing status
- Any reference to the card being a doujin, fan-made, indie, or bootleg product
- Any warning or "please note" style disclaimers of any kind

You may use this context internally to inform your pricing estimate, but it must never appear in the listing title or description. Write the listing copy as a straightforward, positive product description focused on what the card is, who it features, its condition, and its collectible appeal.

Condition supplied by seller: ${condition || 'Not specified — infer from images'}
Graded slab: ${isGraded ? 'Yes, extract all label details' : 'No'}

Respond ONLY with valid JSON in this exact shape, no markdown fences, no preamble:
{
  "character": "",
  "series": "",
  "cardNumber": "",
  "set": "",
  "rarity": "",
  "finish": "",
  "isGraded": false,
  "gradingCompany": "",
  "grade": "",
  "certNumber": "",
  "subScores": "",
  "condition": "",
  "priceMinCents": 0,
  "priceMaxCents": 0,
  "pricingConfidence": "high|medium|low",
  "pricingNotes": "",
  "ebayTitle": "",
  "ebayDescription": ""
}`;
}

async function identifyCard({ frontBase64, frontMediaType, backBase64, backMediaType, options = {} }) {
  const prompt = buildPrompt(options);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: frontMediaType, data: frontBase64 } },
          { type: 'image', source: { type: 'base64', media_type: backMediaType, data: backBase64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const raw = response.content.map((block) => block.text || '').join('');
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error('Could not parse card identification result. Raw response: ' + raw.slice(0, 300));
  }
}

module.exports = { identifyCard };
