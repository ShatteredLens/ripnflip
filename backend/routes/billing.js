const express = require('express');
const Stripe = require('stripe');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

const PLAN_PRICE_IDS = {
  basic: process.env.STRIPE_PRICE_BASIC,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

const CREDIT_PRICE_IDS = {
  25: process.env.STRIPE_PRICE_CREDITS_25,
  100: process.env.STRIPE_PRICE_CREDITS_100,
  300: process.env.STRIPE_PRICE_CREDITS_300,
  1000: process.env.STRIPE_PRICE_CREDITS_1000,
};

// ── START A SUBSCRIPTION CHECKOUT ──
router.post('/checkout/subscription', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const priceId = PLAN_PRICE_IDS[plan];

  if (!priceId) {
    return res.status(400).json({ error: 'Invalid plan selected.' });
  }

  try {
    const { rows } = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.userId]);
    const user = rows[0];

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: req.userId } });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.userId]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/account?checkout=success`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?checkout=canceled`,
      metadata: { userId: req.userId, plan },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Subscription checkout error:', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// ── BUY A CREDIT PACK ──
router.post('/checkout/credits', requireAuth, async (req, res) => {
  const { credits } = req.body;
  const priceId = CREDIT_PRICE_IDS[credits];

  if (!priceId) {
    return res.status(400).json({ error: 'Invalid credit pack selected.' });
  }

  try {
    const { rows } = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.userId]);
    const user = rows[0];

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: req.userId } });
      customerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.userId]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/account?purchase=success`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?purchase=canceled`,
      metadata: { userId: req.userId, credits: String(credits) },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Credit checkout error:', err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// ── CUSTOMER PORTAL (manage / cancel subscription) ──
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]?.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: rows[0].stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/account`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// ── WEBHOOK (raw body required — mounted before express.json() in server.js) ──
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency check — Stripe can deliver the same event more than once
  const alreadyProcessed = await pool.query('SELECT id FROM stripe_events WHERE id = $1', [event.id]);
  if (alreadyProcessed.rows.length > 0) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata.userId;

        if (session.mode === 'subscription') {
          const plan = session.metadata.plan;
          await pool.query(
            `UPDATE users SET plan = $1, stripe_subscription_id = $2, subscription_status = 'active',
             listings_used_this_period = 0, period_started_at = now()
             WHERE id = $3`,
            [plan, session.subscription, userId]
          );
        } else if (session.mode === 'payment') {
          const credits = parseInt(session.metadata.credits, 10);
          await pool.query('UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2', [credits, userId]);
          await pool.query(
            `INSERT INTO credit_transactions (user_id, amount, reason, stripe_payment_intent_id)
             VALUES ($1, $2, 'purchase', $3)`,
            [userId, credits, session.payment_intent]
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await pool.query(
          `UPDATE users SET plan = 'free', subscription_status = 'canceled' WHERE stripe_subscription_id = $1`,
          [subscription.id]
        );
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const status = subscription.status === 'active' ? 'active' : 'past_due';
        await pool.query(
          `UPDATE users SET subscription_status = $1, subscription_renews_at = to_timestamp($2) WHERE stripe_subscription_id = $3`,
          [status, subscription.current_period_end, subscription.id]
        );
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await pool.query(
          `UPDATE users SET subscription_status = 'past_due' WHERE stripe_customer_id = $1`,
          [invoice.customer]
        );
        break;
      }
    }

    await pool.query('INSERT INTO stripe_events (id, type) VALUES ($1, $2)', [event.id, event.type]);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed.' });
  }
});

module.exports = router;
