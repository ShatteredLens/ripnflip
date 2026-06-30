-- RipNFlip Database Schema
-- Postgres - designed for Railway's managed Postgres add-on

-- ─────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    -- Subscription state
    plan            VARCHAR(20) NOT NULL DEFAULT 'free',  -- free | basic | pro | business
    stripe_customer_id      VARCHAR(255) UNIQUE,
    stripe_subscription_id  VARCHAR(255) UNIQUE,
    subscription_status     VARCHAR(20) DEFAULT 'active', -- active | past_due | canceled
    subscription_renews_at  TIMESTAMPTZ,

    -- Usage tracking
    listings_used_this_period  INTEGER NOT NULL DEFAULT 0,
    period_started_at          TIMESTAMPTZ DEFAULT now(),

    -- Pay-as-you-go credits (separate from subscription allowance)
    credit_balance  INTEGER NOT NULL DEFAULT 0,

    -- Owner/admin bypass — true only for the founder's own account.
    -- Skips all usage limits and billing checks entirely. Never exposed via signup;
    -- only ever set manually via a direct database update.
    is_owner        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);

-- ─────────────────────────────────────────────
-- PLAN LIMITS (reference table, not user data)
-- ─────────────────────────────────────────────
CREATE TABLE plan_limits (
    plan                VARCHAR(20) PRIMARY KEY,
    monthly_listings    INTEGER,        -- NULL = unlimited
    allows_batch        BOOLEAN DEFAULT FALSE,
    batch_max           INTEGER,
    allows_pdf_export   BOOLEAN DEFAULT FALSE,
    allows_csv_export   BOOLEAN DEFAULT FALSE,
    priority_processing BOOLEAN DEFAULT FALSE,
    price_cents         INTEGER NOT NULL,
    stripe_price_id     VARCHAR(255)
);

INSERT INTO plan_limits (plan, monthly_listings, allows_batch, batch_max, allows_pdf_export, allows_csv_export, priority_processing, price_cents, stripe_price_id) VALUES
    ('free',      15,   FALSE, 0,   FALSE, FALSE, FALSE, 0,    NULL),
    ('basic',     100,  FALSE, 0,   TRUE,  FALSE, FALSE, 999,  'price_1TnrtlJ6XdOSnurZMbKYNvtp'),
    ('pro',       NULL, TRUE,  50,  TRUE,  FALSE, FALSE, 1999, 'price_1TnsCtJ6XdOSnurZVguH7ziM'),
    ('business',  NULL, TRUE,  500, TRUE,  TRUE,  TRUE,  4999, 'price_1TnsE7J6XdOSnurZxbXoVlrJ');

-- ─────────────────────────────────────────────
-- CARD SERIES (supports multi-TCG expansion)
-- ─────────────────────────────────────────────
CREATE TABLE card_series (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,   -- e.g. "Goddess Story TCG", "Pokemon", "One Piece"
    slug            VARCHAR(100) NOT NULL UNIQUE,
    rarity_tiers    JSONB,            -- ordered list of rarity codes for this series, e.g. ["C","R","SR","SP","TGR","MR"]
    pricing_notes   TEXT,             -- series-specific pricing guidance for the AI prompt
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

INSERT INTO card_series (name, slug, rarity_tiers, pricing_notes) VALUES
    ('Goddess Story TCG', 'goddess-story',
     '["C","R","SR","SP","ZR","XR","TGR","INS","HR","MR","SSR","UR"]',
     'Niche waifu TCG market. Graded slabs from boutique graders (Rate Grading, Mana Grading) carry a modest premium over raw, not PSA/BGS-level premiums. Character popularity in source anime matters more than rarity tier alone.');

-- ─────────────────────────────────────────────
-- LISTINGS (every card processed)
-- ─────────────────────────────────────────────
CREATE TABLE listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id       INTEGER REFERENCES card_series(id),

    -- Card identification
    character_name  VARCHAR(255),
    series_name     VARCHAR(255),       -- the anime/IP, e.g. "Final Fantasy VII"
    card_number     VARCHAR(100),
    set_name        VARCHAR(100),
    rarity          VARCHAR(50),
    finish          VARCHAR(50),

    -- Condition / grading
    is_graded       BOOLEAN DEFAULT FALSE,
    grading_company VARCHAR(100),
    grade           VARCHAR(20),
    cert_number     VARCHAR(100),
    sub_scores      JSONB,
    condition       VARCHAR(100) DEFAULT 'Mint / Unplayed / Sleeved',

    -- Pricing
    price_min_cents     INTEGER,
    price_max_cents     INTEGER,
    pricing_notes        TEXT,
    pricing_confidence   VARCHAR(20),    -- high | medium | low (low = no direct comps found)

    -- Generated listing content
    ebay_title          VARCHAR(255),
    ebay_description    TEXT,

    -- Images (stored as URLs pointing to object storage, e.g. S3 or Railway volumes)
    front_image_url     TEXT,
    back_image_url      TEXT,

    -- Catalog
    added_to_catalog    BOOLEAN DEFAULT FALSE,
    catalog_id          UUID,

    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_listings_user ON listings(user_id);
CREATE INDEX idx_listings_created ON listings(created_at);

-- ─────────────────────────────────────────────
-- CATALOGS (PDF export groupings)
-- ─────────────────────────────────────────────
CREATE TABLE catalogs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(255) DEFAULT 'My Card Inventory',
    pdf_url         TEXT,               -- last generated PDF location
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────
-- CREDIT TRANSACTIONS (pay-as-you-go audit trail)
-- ─────────────────────────────────────────────
CREATE TABLE credit_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount          INTEGER NOT NULL,        -- positive = purchase, negative = spend
    reason          VARCHAR(50) NOT NULL,    -- 'purchase' | 'listing_spend' | 'refund' | 'bonus'
    stripe_payment_intent_id  VARCHAR(255),
    listing_id      UUID REFERENCES listings(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_credit_tx_user ON credit_transactions(user_id);

-- ─────────────────────────────────────────────
-- CREDIT PACKS (reference table for Stripe one-time purchases)
-- ─────────────────────────────────────────────
CREATE TABLE credit_packs (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL,
    credits         INTEGER NOT NULL,
    price_cents     INTEGER NOT NULL,
    stripe_price_id VARCHAR(255)
);

INSERT INTO credit_packs (name, credits, price_cents, stripe_price_id) VALUES
    ('Starter Pack',  25,   500,  'price_1TnsGNJ6XdOSnurZ1ij13iNR'),
    ('Seller Pack',   100,  1500, 'price_1TnsHDJ6XdOSnurZdPTlD1dU'),
    ('Power Pack',    300,  3500, 'price_1TnsI0J6XdOSnurZKaqeZ9US'),
    ('Bulk Pack',     1000, 8900, 'price_1TnsIrJ6XdOSnurZCYnPFw9S');

-- ─────────────────────────────────────────────
-- STRIPE WEBHOOK EVENTS (idempotency log)
-- ─────────────────────────────────────────────
CREATE TABLE stripe_events (
    id              VARCHAR(255) PRIMARY KEY,   -- Stripe event id, used to prevent double-processing
    type            VARCHAR(100) NOT NULL,
    processed_at    TIMESTAMPTZ DEFAULT now()
);
