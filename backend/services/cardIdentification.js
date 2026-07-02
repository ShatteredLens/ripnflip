const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// This is the proprietary prompt logic — kept entirely server-side.
// Users never see this. They only see the structured result.
function buildPrompt({ condition, isGraded, seriesName, seriesPricingNotes }) {
  return `You are RipNFlip's card identification engine. You are given the front and back images of a single trading card.

Series context: ${seriesName || 'Unknown — identify from the card itself'}
${seriesPricingNotes ? `Pricing guidance for this series: ${seriesPricingNotes}` : ''}

Your job:
1. Identify the card fully: character name, the source anime/game/IP, card number (read from the back), set name, rarity code, and finish (holo/foil/standard).
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
