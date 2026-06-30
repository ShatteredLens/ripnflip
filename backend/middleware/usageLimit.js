const pool = require('../config/db');

// Checks whether a user can process another card based on their plan
// and current usage, OR falls back to spending a credit if available.
// Attaches req.billingMethod = 'subscription' | 'credit' so the route
// handler knows what to deduct after a successful listing.
async function checkUsageLimit(req, res, next) {
  const { rows } = await pool.query(
    `SELECT u.plan, u.listings_used_this_period, u.credit_balance, u.period_started_at, u.is_owner,
            pl.monthly_listings
     FROM users u
     JOIN plan_limits pl ON pl.plan = u.plan
     WHERE u.id = $1`,
    [req.userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const user = rows[0];

  // Owner bypass — the founder's own account never hits limits or spends credits.
  if (user.is_owner) {
    req.billingMethod = 'owner';
    return next();
  }

  // Reset usage counter if a new billing period has started (simple 30-day rolling window)
  const periodAge = Date.now() - new Date(user.period_started_at).getTime();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  if (periodAge > THIRTY_DAYS) {
    await pool.query(
      `UPDATE users SET listings_used_this_period = 0, period_started_at = now() WHERE id = $1`,
      [req.userId]
    );
    user.listings_used_this_period = 0;
  }

  const unlimited = user.monthly_listings === null;
  const withinPlanLimit = unlimited || user.listings_used_this_period < user.monthly_listings;

  if (withinPlanLimit) {
    req.billingMethod = 'subscription';
    return next();
  }

  // Plan limit hit — fall back to credits if available
  if (user.credit_balance > 0) {
    req.billingMethod = 'credit';
    return next();
  }

  return res.status(403).json({
    error: 'You have reached your monthly listing limit.',
    code: 'LIMIT_REACHED',
    suggestion: 'Upgrade your plan or buy a credit pack to keep processing cards.',
  });
}

module.exports = { checkUsageLimit };
