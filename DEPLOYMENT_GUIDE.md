# RipNFlip — Deployment Guide

This is the real, working backend for RipNFlip. Here's exactly how to get it live on Railway.

## What's in this codebase

```
ripnflip/
├── backend/
│   ├── server.js              ← main entry point
│   ├── package.json
│   ├── railway.json           ← tells Railway how to run this
│   ├── .env.example           ← copy to .env and fill in real values
│   ├── config/
│   │   ├── db.js              ← Postgres connection
│   │   └── migrate.js         ← run once to create all tables
│   ├── middleware/
│   │   ├── auth.js            ← JWT login verification
│   │   └── usageLimit.js      ← enforces plan limits / credits
│   ├── routes/
│   │   ├── auth.js            ← signup / login
│   │   ├── listings.js        ← the core card processing endpoint
│   │   └── billing.js         ← Stripe checkout + webhooks
│   └── services/
│       └── cardIdentification.js   ← your proprietary AI prompt logic
└── database/
    └── schema.sql              ← full Postgres schema
```

Your prompts and pricing logic live in `services/cardIdentification.js` — that file never gets sent to the browser. Users only ever see the JSON result.

---

## Step 1 — Push this code to GitHub

Railway deploys from a GitHub repo. If you don't already have one:

1. Create a new repo on GitHub called `ripnflip`
2. Upload the `backend/` folder contents to it (or I can help you set up git commands if you want to do this from command line)

## Step 2 — Create the Railway project

1. In your Railway dashboard, click **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your `ripnflip` repo
4. Railway will detect it's a Node app automatically (thanks to `railway.json`)

## Step 3 — Add a Postgres database

1. In your Railway project, click **+ New**
2. Choose **Database → PostgreSQL**
3. Railway automatically creates a `DATABASE_URL` variable and makes it available to your backend service — you don't need to copy/paste anything

## Step 4 — Set your environment variables

In your Railway service settings, go to **Variables** and add everything from `.env.example` EXCEPT `DATABASE_URL` (Railway already provides that). You'll need:

- `JWT_SECRET` — any long random string (I can generate one for you)
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `STRIPE_SECRET_KEY` — from your Stripe dashboard (Developers → API keys)
- `STRIPE_WEBHOOK_SECRET` — created in Step 6 below
- `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` — created in Step 5
- `STRIPE_PRICE_CREDITS_25/100/300/1000` — created in Step 5
- `FRONTEND_URL` — your domain, e.g. `https://ripnflip.ca`

## Step 5 — Create your Stripe products

In your Stripe Dashboard → Products, create:

**Subscriptions (recurring):**
- Basic — $9.99/month
- Pro — $19.99/month
- Business — $49.99/month

**One-time purchases:**
- 25 Credits — $5.00
- 100 Credits — $15.00
- 300 Credits — $35.00
- 1000 Credits — $89.00

Each product gives you a Price ID (starts with `price_`) — copy these into your Railway environment variables from Step 4.

## Step 6 — Set up the Stripe webhook

1. In Stripe Dashboard → Developers → Webhooks, click **Add endpoint**
2. Endpoint URL: `https://your-railway-url.up.railway.app/api/billing/webhook`
3. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Stripe gives you a signing secret (starts with `whsec_`) — put that in `STRIPE_WEBHOOK_SECRET`

## Step 7 — Run the database migration

Once your service is deployed and `DATABASE_URL` is connected, run the migration once. In Railway, you can do this via their built-in terminal/shell on the service, running:

```
npm run migrate
```

This creates every table from `database/schema.sql`.

## Step 7.5 — Make your own account free forever

Sign up for a normal RipNFlip account through the live site like any other user. Then, in Railway's Postgres dashboard, open the **Query** tab and run:

```sql
UPDATE users SET is_owner = TRUE WHERE email = 'your-email@example.com';
```

Replace the email with whatever you signed up with. This flips your account into owner mode — unlimited card processing, no subscription, no credits ever deducted. This is a one-time manual step and isn't exposed anywhere in the app itself, so no one else can grant themselves this status.

## Step 8 — Point your domain

In Railway, go to your service → Settings → Networking → Custom Domain, and add `ripnflip.ca`. Railway gives you a CNAME record to add at your domain registrar.

## Step 9 — Connect the frontend

The HTML prototype I built needs its API calls pointed at your live Railway backend URL instead of being a standalone file. That's the next piece to wire up once your backend is live and you've confirmed `/health` returns `{"status":"ok"}`.

---

## Testing it works

Once deployed, visit `https://your-railway-url.up.railway.app/health` — you should see:
```json
{"status": "ok", "service": "ripnflip-backend"}
```

If that loads, your backend is live and ready to connect to the frontend.
