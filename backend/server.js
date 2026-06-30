require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const listingsRoutes = require('./routes/listings');
const billingRoutes = require('./routes/billing');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Stripe webhook route handles its own raw-body parsing internally (see routes/billing.js),
// so it must be reachable before the global express.json() below.
app.use('/api/billing', billingRoutes);

// Everything else uses normal JSON parsing
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/listings', listingsRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ripnflip-backend' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RipNFlip backend running on port ${PORT}`);
});
