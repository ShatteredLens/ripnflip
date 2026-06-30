const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// This is the proprietary prompt logic — kept entirely server-side.
// Users never see this. They only see the structured result.
function buildPrompt({ isMint, isGraded, seriesName, seriesPricingNotes }) {
  return `You are RipNFlip's card identification engine. You are given the front and back images of a single trading card.

Series context: ${seriesName || 'Unknown — identify from the card itself'}
${seriesPricingNotes ? `Pricing guidance for this series: ${seriesPricingNotes}` : ''}

Your job:
1. Identify the card fully: character name, the source anime/game/IP, card number (read from the back), set name, rarity code, and finish (holo/foil/standard).
2. If the card is in a graded slab, extract: grading company name, grade score, certificate number, and every visible sub-score (centering, surface, corners, edges).
3. Research-grade pricing estimate: based on the rarity, character popularity, and condition, give a realistic eBay price range. If you are not confident direct sold comps exist for this exact card (especially for graded slabs from niche graders), say so plainly in pricingNotes and widen the range accordingly rather than guessing narrowly.
4. Write a complete, accurate eBay listing title (under 80 characters) and a description.

Condition supplied by seller: ${isMint ? 'Mint / Unplayed / Sleeved' : 'Not specified — infer from images'}
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
