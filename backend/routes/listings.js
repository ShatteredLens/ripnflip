const express = require('express');
const multer = require('multer');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { checkUsageLimit } = require('../middleware/usageLimit');
const { identifyCard } = require('../services/cardIdentification');

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

    const { seriesId, isMint, isGraded } = req.body;

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

      const card = await identifyCard({
        frontBase64: front.buffer.toString('base64'),
        frontMediaType: front.mimetype,
        backBase64: back.buffer.toString('base64'),
        backMediaType: back.mimetype,
        options: {
          isMint: isMint === 'true',
          isGraded: isGraded === 'true',
          seriesName,
          seriesPricingNotes,
        },
      });

      // Save the listing
      const { rows: listingRows } = await pool.query(
        `INSERT INTO listings (
          user_id, series_id, character_name, series_name, card_number, set_name,
          rarity, finish, is_graded, grading_company, grade, cert_number, sub_scores,
          condition, price_min_cents, price_max_cents, pricing_notes, pricing_confidence,
          ebay_title, ebay_description
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING id, created_at`,
        [
          req.userId, seriesId || null, card.character, card.series, card.cardNumber, card.set,
          card.rarity, card.finish, card.isGraded, card.gradingCompany, card.grade, card.certNumber,
          JSON.stringify(card.subScores || {}), card.condition, card.priceMinCents, card.priceMaxCents,
          card.pricingNotes, card.pricingConfidence, card.ebayTitle, card.ebayDescription,
        ]
      );

      // Deduct usage — subscription allowance or credit, per what the middleware decided.
      // Owner accounts skip this entirely.
      if (req.billingMethod === 'subscription') {
        await pool.query('UPDATE users SET listings_used_this_period = listings_used_this_period + 1 WHERE id = $1', [req.userId]);
      } else if (req.billingMethod === 'credit') {
        await pool.query('UPDATE users SET credit_balance = credit_balance - 1 WHERE id = $1', [req.userId]);
        await pool.query(
          `INSERT INTO credit_transactions (user_id, amount, reason, listing_id) VALUES ($1, -1, 'listing_spend', $2)`,
          [req.userId, listingRows[0].id]
        );
      }
      // billingMethod === 'owner' → no deduction, no usage tracking

      res.status(201).json({
        listingId: listingRows[0].id,
        createdAt: listingRows[0].created_at,
        billingMethod: req.billingMethod,
        card,
      });
    } catch (err) {
      console.error('Card processing error:', err);
      res.status(500).json({ error: 'Could not process this card. Please try again.' });
    }
  }
);

// ── GET LISTING HISTORY ──
router.get('/history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const { rows } = await pool.query(
      `SELECT id, character_name, series_name, card_number, rarity, is_graded, grade,
              price_min_cents, price_max_cents, ebay_title, created_at
       FROM listings
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );
    res.json({ listings: rows });
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

module.exports = router;
