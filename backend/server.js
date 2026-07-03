require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const billingRoutes = require('./routes/billing');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Parse JSON for all routes. The Stripe webhook endpoint overrides this with
// express.raw() inside billing.js using a router-level middleware, which takes
// precedence over this global parser for that specific path.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.use('/api/billing', billingRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ripnflip-backend' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RipNFlip backend running on port ${PORT}`);
});
