const express = require('express');
const multer = require('multer');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { checkUsageLimit } = require('../middleware/usageLimit');
const { identifyCard } = require('../services/cardIdentification');
const { uploadCardImage } = require('../services/imageStorage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── PROCESS A SINGLE CARD ──
router.post(
  '/process',
  requireAuth,
  checkUsageLimit,
  upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]),
  async (req, res) => {
    const front = req.files?.front?.[0];
    const back = req.files?.back?.[0];

    if (!front || !back) {
      return res.status(400).json({ error: 'Both front and back images are required.' });
    }

    const { seriesId, condition, isGraded } = req.body;

    try {
      let seriesName = null;
      let seriesPricingNotes = null;

      if (seriesId) {
        const { rows } = await pool.query('SELECT name, pricing_notes FROM card_series WHERE id = $1', [seriesId]);
        if (rows.length) {
          seriesName = rows[0].name;
          seriesPricingNotes = rows[0].pricing_notes;
        }
      }

      const [card, frontUrl, backUrl] = await Promise.all([
        identifyCard({
          frontBase64: front.buffer.toString('base64'),
          frontMediaType: front.mimetype,
          backBase64: back.buffer.toString('base64'),
          backMediaType: back.mimetype,
          options: {
            condition: condition || 'Mint / Unplayed / Sleeved',
            isGraded: isGraded === 'true',
            seriesName,
            seriesPricingNotes,
          },
        }),
        uploadCardImage(front.buffer, front.mimetype, 'front', req.userId),
        uploadCardImage(back.buffer, back.mimetype, 'back', req.userId),
      ]);

      // rarityConfirmed defaults to true if AI doesn't explicitly say false
      const rarityConfirmed = card.rarityConfirmed !== false;

      const { rows: listingRows } = await pool.query(
        `INSERT INTO listings (
          user_id, series_id, character_name, series_name, card_number, set_name,
          rarity, finish, is_graded, grading_company, grade, cert_number, sub_scores,
          condition, price_min_cents, price_max_cents, pricing_notes, pricing_confidence,
          ebay_title, ebay_description, front_image_url, back_image_url, rarity_confirmed
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING id, created_at`,
        [
          req.userId, seriesId || null, card.character, card.series, card.cardNumber, card.set,
          card.rarity, card.finish, card.isGraded, card.gradingCompany, card.grade, card.certNumber,
          JSON.stringify(card.subScores || {}), card.condition, card.priceMinCents, card.priceMaxCents,
          card.pricingNotes, card.pricingConfidence, card.ebayTitle, card.ebayDescription,
          frontUrl, backUrl, rarityConfirmed,
        ]
      );

      if (req.billingMethod === 'subscription') {
        await pool.query('UPDATE users SET listings_used_this_period = listings_used_this_period + 1 WHERE id = $1', [req.userId]);
      } else if (req.billingMethod === 'credit') {
        await pool.query('UPDATE users SET credit_balance = credit_balance - 1 WHERE id = $1', [req.userId]);
        await pool.query(
          `INSERT INTO credit_transactions (user_id, amount, reason, listing_id) VALUES ($1, -1, 'listing_spend', $2)`,
          [req.userId, listingRows[0].id]
        );
      }

      res.status(201).json({
        listingId: listingRows[0].id,
        createdAt: listingRows[0].created_at,
        billingMethod: req.billingMethod,
        card,
        rarityConfirmed,
        frontUrl,
        backUrl,
      });
    } catch (err) {
      console.error('Card processing error:', err);
      res.status(500).json({ error: 'Could not process this card. Please try again.' });
    }
  }
);

// ── RE-PRICE A LISTING WITH CORRECTED RARITY ──
router.post('/:id/reprice', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { correctedRarity } = req.body;

  if (!correctedRarity) {
    return res.status(400).json({ error: 'Corrected rarity is required.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM listings WHERE id = $1 AND user_id = $2`,
      [id, req.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Card not found in your collection.' });
    }

    const listing = rows[0];

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const repricePrompt = `You are RipNFlip's pricing engine. A collector has corrected the rarity of a previously scanned card.

Card details:
- Character: ${listing.character_name}
- Series: ${listing.series_name}
- Set: ${listing.set_name}
- Card Number: ${listing.card_number}
- Confirmed Rarity: ${correctedRarity}
- Finish: ${listing.finish}
- Condition: ${listing.condition}
- Graded: ${listing.is_graded ? `Yes - ${listing.grading_company} ${listing.grade}` : 'No'}

The collector has confirmed the rarity is: ${correctedRarity}

Provide updated pricing and listing content based on this confirmed rarity.

Rules:
- No disclaimers, no unofficial/unlicensed language
- No packaging claims beyond sleeve and top-loader for raw cards
- Listing copy must be positive and factual

Respond ONLY with valid JSON, no markdown:
{
  "priceMinCents": 0,
  "priceMaxCents": 0,
  "pricingConfidence": "high|medium|low",
  "pricingNotes": "",
  "ebayTitle": "",
  "ebayDescription": ""
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: repricePrompt }],
    });

    const raw = response.content.map(b => b.text || '').join('');
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const repriced = JSON.parse(cleaned);

    await pool.query(
      `UPDATE listings SET
        rarity = $1,
        price_min_cents = $2,
        price_max_cents = $3,
        pricing_notes = $4,
        pricing_confidence = $5,
        ebay_title = $6,
        ebay_description = $7,
        rarity_confirmed = TRUE
       WHERE id = $8 AND user_id = $9`,
      [
        correctedRarity,
        repriced.priceMinCents,
        repriced.priceMaxCents,
        repriced.pricingNotes,
        'confirmed',
        repriced.ebayTitle,
        repriced.ebayDescription,
        id,
        req.userId,
      ]
    );

    res.json({
      updated: true,
      rarity: correctedRarity,
      priceMinCents: repriced.priceMinCents,
      priceMaxCents: repriced.priceMaxCents,
      pricingNotes: repriced.pricingNotes,
      pricingConfidence: 'confirmed',
      ebayTitle: repriced.ebayTitle,
      ebayDescription: repriced.ebayDescription,
    });
  } catch (err) {
    console.error('Re-price error:', err);
    res.status(500).json({ error: 'Could not update pricing. Please try again.' });
  }
});

// ── GET LISTING HISTORY ──
router.get('/history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const { series, character, sort } = req.query;

  const sortMap = {
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    character_az: 'character_name ASC',
    character_za: 'character_name DESC',
    series_az: 'series_name ASC',
    price_high: 'price_max_cents DESC NULLS LAST',
    price_low: 'price_min_cents ASC NULLS LAST',
  };
  const orderBy = sortMap[sort] || sortMap.newest;

  const conditions = ['user_id = $1'];
  const params = [req.userId];
  let paramIndex = 2;

  if (series) {
    conditions.push(`series_name ILIKE $${paramIndex}`);
    params.push(`%${series}%`);
    paramIndex++;
  }
  if (character) {
    conditions.push(`character_name ILIKE $${paramIndex}`);
    params.push(`%${character}%`);
    paramIndex++;
  }

  params.push(limit, offset);

  try {
    const { rows } = await pool.query(
      `SELECT id, character_name, series_name, card_number, set_name, rarity, finish,
              is_graded, grading_company, grade, cert_number, sub_scores, condition,
              price_min_cents, price_max_cents, pricing_notes, pricing_confidence,
              ebay_title, ebay_description, front_image_url, back_image_url,
              rarity_confirmed, created_at
       FROM listings
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    const { rows: seriesRows } = await pool.query(
      `SELECT DISTINCT series_name FROM listings WHERE user_id = $1 AND series_name IS NOT NULL ORDER BY series_name ASC`,
      [req.userId]
    );
    const { rows: characterRows } = await pool.query(
      `SELECT DISTINCT character_name FROM listings WHERE user_id = $1 AND character_name IS NOT NULL ORDER BY character_name ASC`,
      [req.userId]
    );

    res.json({
      listings: rows,
      availableSeries: seriesRows.map(r => r.series_name),
      availableCharacters: characterRows.map(r => r.character_name),
    });
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Could not load listing history.' });
  }
});

// ── GET CURRENT USAGE / PLAN STATUS ──
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.plan, u.listings_used_this_period, u.credit_balance, pl.monthly_listings
       FROM users u JOIN plan_limits pl ON pl.plan = u.plan
       WHERE u.id = $1`,
      [req.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Could not load usage info.' });
  }
});

// ── DELETE A LISTING ──
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `DELETE FROM listings WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Card not found in your collection.' });
    }

    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    console.error('Delete listing error:', err);
    res.status(500).json({ error: 'Could not delete this card. Please try again.' });
  }
});

module.exports = router;
