-- ============================================================
-- Kitchen234 — Voice Agent Database Schema
-- Import via Supabase SQL Editor (choose "Run and enable RLS")
-- Use a SEPARATE Supabase project from BluePeak, or a separate
-- schema, so the two businesses' data never mix.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- Menu items Nike can search and quote from
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'main'
                    CHECK (category IN ('best_seller', 'main', 'classic', 'side', 'drink')),
    price_small     NUMERIC(8,2),
    price_large     NUMERIC(8,2),
    description     TEXT,                -- one spoken-friendly sentence
    tags            TEXT,                -- searchable: 'fish, spicy, soup'
    available       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Orders placed by Nike on calls
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number    TEXT UNIQUE NOT NULL DEFAULT ('KIT-' || upper(substr(md5(random()::text), 1, 6))),
    customer_name   TEXT NOT NULL,
    customer_phone  TEXT NOT NULL,
    items           JSONB NOT NULL,      -- [{dish, portion, spice_level, quantity}]
    fulfillment     TEXT NOT NULL CHECK (fulfillment IN ('pickup', 'delivery')),
    delivery_address TEXT,
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
    estimated_minutes INTEGER NOT NULL DEFAULT 40,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ------------------------------------------------------------
-- Complaints
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS complaints (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_number   TEXT UNIQUE NOT NULL DEFAULT ('K234-' || to_char(now(), 'YYMMDD') || '-' || substr(md5(random()::text), 1, 6)),
    caller_name     TEXT,
    caller_phone    TEXT,
    order_number    TEXT,
    category        TEXT NOT NULL DEFAULT 'general'
                    CHECK (category IN ('food_quality', 'wrong_order', 'late_delivery',
                                        'missing_items', 'service', 'billing', 'general')),
    severity        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
    description     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_k234_complaints_status ON complaints(status);

-- ------------------------------------------------------------
-- Callbacks (allergen questions, catering quotes, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS callbacks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    caller_phone    TEXT NOT NULL,
    reason          TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Call log (transcripts, summaries, recordings)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vapi_call_id    TEXT UNIQUE,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    caller_phone    TEXT,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_secs   INTEGER,
    ended_reason    TEXT,
    was_transferred BOOLEAN NOT NULL DEFAULT false,
    transcript      TEXT,
    summary         TEXT,
    recording_url   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_touch ON orders;
CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ------------------------------------------------------------
-- Menu seed data (from the Kitchen234 menu — edit prices freely)
-- ------------------------------------------------------------
INSERT INTO menu_items (name, category, price_small, price_large, description, tags) VALUES
('Buka Stew',          'best_seller', 140, 290, 'Rich Nigerian stew with assorted meats and traditional spices.', 'stew, meat, assorted, traditional'),
('Yam Porridge',       'best_seller', 100, 200, 'Creamy comfort food cooked with Nigerian herbs and vegetables — asaro just like home.', 'yam, asaro, porridge, comfort'),
('Chicken Skewers',    'best_seller', 25,  NULL, 'Grilled skewers with our signature Nigerian spice blend — the perfect starter.', 'chicken, grilled, skewers, appetizer'),
('Fried Chicken',      'best_seller', 80,  160, 'Golden crispy chicken swimming in rich Nigerian stew.', 'chicken, fried, stew'),
('Fried Hake',         'main',        100, 200, 'Fresh hake fish with authentic Nigerian preparation.', 'fish, hake, fried'),
('Fried Turkey',       'main',        110, 220, 'Tender turkey pieces in traditional stew.', 'turkey, fried, stew'),
('Fried Croaker Fish', 'main',        120, 240, 'Premium croaker fish with Nigerian spices.', 'fish, croaker, fried, premium'),
('Fried Beef',         'main',        150, 300, 'Premium beef cuts in our special sauce.', 'beef, fried, premium'),
('Jollof Rice',        'classic',     60,  120, 'Authentic smoky jollof — the flavor every Nigerian craves, made just like back home.', 'rice, jollof, smoky, party'),
('Egusi Soup',         'classic',     70,  140, 'Traditional melon seed soup with leafy vegetables and palm oil.', 'soup, egusi, melon, vegetables'),
('Suya',               'classic',     30,  60,  'Spiced grilled meat with our Nigerian suya blend — proper street-style.', 'suya, grilled, spicy, meat')
ON CONFLICT DO NOTHING;
