const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt({ condition, isGraded, seriesName, seriesPricingNotes }) {
  return `You are RipNFlip's card identification engine. You are given the front and back images of a single trading card.

Series context: ${seriesName || 'Unknown — identify from the card itself'}
${seriesPricingNotes ? `Pricing guidance for this series: ${seriesPricingNotes}` : ''}

Your job:
1. Identify the card fully: character name, the source anime/game/IP, card number (read from the back), set name, rarity code, and finish (holo/foil/standard).
2. If the card is in a graded slab, extract: grading company name, grade score, certificate number, and every visible sub-score (centering, surface, corners, edges).
3. Research-grade pricing estimate: based on the rarity, character popularity, and the seller-supplied condition below, give a realistic eBay price range. This is always an estimate, not a guaranteed sale figure — in pricingNotes, briefly note one or two factors specific to this card that could shift its real-world price (e.g. limited direct comps for this rarity, character's popularity trend, condition grade, niche grader recognition, or seasonal demand for this series). If you are not confident direct sold comps exist for this exact card (especially for graded slabs from niche graders), say so plainly and widen the range accordingly rather than guessing narrowly.
4. Write a complete, accurate eBay listing title (under 80 characters) and a description.

Shipping/packaging language rule — this is critical and easy to get wrong. Only ever describe packaging that matches the card's actual physical format. Never invent storage accessories the seller has not mentioned.
- If isGraded is true (a graded slab): you may mention the hard plastic slab itself since that IS the card's physical format. Example: "ships securely in its protective grading slab."
- If isGraded is false (a raw, ungraded card): NEVER mention a hard plastic slab, acrylic case, screw-down case, graded slab, or any rigid display case. You have no knowledge of how the seller stores their cards. For raw cards, only reference packaging appropriate for shipping an ungraded card: a soft sleeve, a rigid top-loader, and a bubble mailer. Nothing else. Do not invent or assume any storage method beyond these standard shipping materials.

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
