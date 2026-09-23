-- Registre des cartes cadeaux (base Cloudflare D1)
-- Appliquer : npx wrangler d1 execute lucile-cartes-cadeaux --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS cards (
  code              TEXT PRIMARY KEY,          -- LD-XXXX-XXXX
  kind              TEXT NOT NULL,             -- 'prestation' | 'montant'
  offer             TEXT,                      -- clé de l'offre (prestation) sinon NULL
  label             TEXT NOT NULL,             -- ex. « Drainage lymphatique corps entier »
  detail            TEXT,                      -- ex. « Séance d'environ 1h »
  amount_cents      INTEGER NOT NULL,          -- prix payé
  balance_cents     INTEGER,                   -- solde restant (cartes montant)
  sessions_total    INTEGER,                   -- nb de séances (cartes prestation)
  sessions_left     INTEGER,
  buyer_name        TEXT NOT NULL,
  buyer_email       TEXT,
  recipient_name    TEXT NOT NULL,
  message           TEXT,
  created_at        TEXT NOT NULL,             -- ISO 8601 UTC
  expires_at        TEXT NOT NULL,             -- AAAA-MM-JJ, dernier jour de validité inclus
  blocked           INTEGER NOT NULL DEFAULT 0,
  blocked_reason    TEXT,
  replaced_by       TEXT,                      -- code de la carte réémise
  source            TEXT NOT NULL,             -- 'stripe' | 'manuel'
  payment_ref       TEXT,                      -- id paiement Stripe ou 'especes' / 'virement' / 'cb-cabinet'
  stripe_session_id TEXT UNIQUE,
  email_sent_at     TEXT
);

CREATE TABLE IF NOT EXISTS movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL REFERENCES cards(code),
  created_at     TEXT NOT NULL,
  label          TEXT NOT NULL,               -- soin réalisé
  amount_cents   INTEGER NOT NULL DEFAULT 0,  -- montant déduit du solde (cartes montant)
  sessions       INTEGER NOT NULL DEFAULT 0,  -- séances consommées (cartes prestation)
  due_cents      INTEGER NOT NULL DEFAULT 0,  -- reste à payer par un autre moyen
  cancelled_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_movements_code ON movements(code);
CREATE INDEX IF NOT EXISTS idx_cards_created ON cards(created_at);
