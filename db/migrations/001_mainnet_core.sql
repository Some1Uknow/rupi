-- Rupi Mainnet baseline. This migration is intentionally separate from the
-- former Testnet MVP schema: no Testnet wallet, beneficiary, or simulated
-- order data is ever copied into a Mainnet database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session" ("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("providerId", "accountId")
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" ("identifier");

CREATE TABLE IF NOT EXISTS account_profiles (
  user_id TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  account_state TEXT NOT NULL DEFAULT 'PENDING_PASSKEY'
    CHECK (account_state IN ('PENDING_PASSKEY', 'PENDING_KYC', 'ACTIVE', 'RECOVERY_REVIEW', 'SUSPENDED')),
  onramp_customer_id TEXT UNIQUE,
  kyc_state TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (kyc_state IN ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVIEW')),
  kyc_updated_at TIMESTAMPTZ,
  recovery_locked_until TIMESTAMPTZ,
  cashout_rollout_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSONB NOT NULL DEFAULT '[]'::jsonb,
  device_type TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT NOT NULL DEFAULT 'Passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS passkeys_user_id_idx ON passkeys (user_id);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('ENROLLMENT', 'STEP_UP')),
  action TEXT,
  amount NUMERIC(20,7),
  idempotency_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS passkey_challenges_user_idx ON passkey_challenges (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS step_up_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  action TEXT NOT NULL,
  amount NUMERIC(20,7),
  idempotency_key TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  subject_email TEXT,
  consent_type TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS consent_records_user_idx ON consent_records (user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'USER',
  actor_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_user_created_idx ON audit_events (user_id, created_at DESC);

-- This replaces the legacy encrypted seed column. Fireblocks is the sole
-- signing authority; this table contains only non-secret custody mappings.
CREATE TABLE IF NOT EXISTS stellar_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  network TEXT NOT NULL DEFAULT 'STELLAR_MAINNET' CHECK (network = 'STELLAR_MAINNET'),
  public_key TEXT NOT NULL UNIQUE,
  fireblocks_vault_account_id TEXT NOT NULL UNIQUE,
  fireblocks_vault_account_name TEXT NOT NULL UNIQUE,
  xlm_asset_id TEXT NOT NULL,
  usdc_asset_id TEXT NOT NULL,
  activation_state TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (activation_state IN ('CREATED', 'ASSETS_PENDING', 'TRUSTLINE_PENDING', 'RESERVE_PENDING', 'READY', 'FAILED', 'HELD')),
  policy_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (policy_state IN ('PENDING', 'ENFORCED', 'HELD', 'REJECTED')),
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES stellar_wallets(id) ON DELETE CASCADE,
  rail TEXT NOT NULL DEFAULT 'STELLAR',
  network TEXT NOT NULL DEFAULT 'STELLAR_MAINNET',
  asset_code TEXT NOT NULL DEFAULT 'USDC',
  asset_issuer TEXT NOT NULL,
  public_address TEXT NOT NULL,
  memo_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, rail, public_address)
);

CREATE TABLE IF NOT EXISTS purpose_codes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO purpose_codes (code, label, category, description) VALUES
  ('P0802', 'Software consultancy / implementation', 'Software services', 'Software consulting, implementation, and related IT services'),
  ('P0806', 'IT enabled services', 'Software services', 'IT-enabled and back-office services'),
  ('P1006', 'Business and management consultancy', 'Professional services', 'Business, management, and consulting services')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS invoice_sequences (
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_year)
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_country TEXT,
  amount NUMERIC(20,7) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  description TEXT NOT NULL,
  due_date TIMESTAMPTZ,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  purpose_code TEXT NOT NULL REFERENCES purpose_codes(code),
  status TEXT NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('DRAFT', 'SENT', 'VIEWED', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'AMOUNT_MISMATCH', 'EXPIRED', 'CANCELED')),
  idempotency_key TEXT NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, invoice_number),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  invoice_id UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES stellar_wallets(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) >= 32),
  rail TEXT NOT NULL DEFAULT 'STELLAR',
  network TEXT NOT NULL DEFAULT 'STELLAR_MAINNET' CHECK (network = 'STELLAR_MAINNET'),
  asset_code TEXT NOT NULL DEFAULT 'USDC',
  asset_issuer TEXT NOT NULL,
  expected_amount NUMERIC(20,7) NOT NULL CHECK (expected_amount > 0),
  received_amount NUMERIC(20,7) NOT NULL DEFAULT 0,
  payment_address TEXT NOT NULL,
  payment_reference TEXT NOT NULL,
  payment_uri TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payment_intents_wallet_status_idx ON payment_intents (wallet_id, status, created_at);

CREATE TABLE IF NOT EXISTS stellar_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id TEXT NOT NULL UNIQUE,
  transaction_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES stellar_wallets(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  payment_intent_id UUID REFERENCES payment_intents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  asset_code TEXT NOT NULL,
  asset_issuer TEXT,
  amount NUMERIC(20,7) NOT NULL CHECK (amount > 0),
  memo TEXT,
  source_address TEXT,
  destination_address TEXT,
  ledger_sequence BIGINT,
  ledger_closed_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stellar_operations_wallet_cursor_idx ON stellar_operations (wallet_id, occurred_at, operation_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id UUID NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  amount NUMERIC(20,7) NOT NULL CHECK (amount > 0),
  tx_hash TEXT NOT NULL,
  memo TEXT,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stellar_reconciliation_cursors (
  wallet_id UUID PRIMARY KEY REFERENCES stellar_wallets(id) ON DELETE CASCADE,
  horizon_cursor TEXT,
  last_ledger_closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS onramp_configuration_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_hash TEXT NOT NULL UNIQUE,
  stellar_usdc_available BOOLEAN NOT NULL,
  memo_supported BOOLEAN NOT NULL,
  max_inr_per_order NUMERIC(20,2),
  raw_configuration JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS onramp_beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  provider_beneficiary_token TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  account_last4 TEXT NOT NULL CHECK (length(account_last4) = 4),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider_beneficiary_token)
);
CREATE UNIQUE INDEX IF NOT EXISTS onramp_beneficiaries_active_user_idx
  ON onramp_beneficiaries (user_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS cashout_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  provider_quote_id TEXT NOT NULL UNIQUE,
  configuration_hash TEXT NOT NULL,
  asset_code TEXT NOT NULL DEFAULT 'USDC',
  network TEXT NOT NULL DEFAULT 'STELLAR_MAINNET',
  usdc_amount NUMERIC(20,7) NOT NULL CHECK (usdc_amount > 0),
  gross_inr NUMERIC(20,2) NOT NULL CHECK (gross_inr >= 0),
  onramp_fee_inr NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (onramp_fee_inr >= 0),
  gateway_fee_inr NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (gateway_fee_inr >= 0),
  tds_inr NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (tds_inr >= 0),
  rupi_fee_inr NUMERIC(20,2) NOT NULL CHECK (rupi_fee_inr >= 0),
  net_inr NUMERIC(20,2) NOT NULL CHECK (net_inr >= 0),
  quote_payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cashout_quotes_user_expiry_idx ON cashout_quotes (user_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS offramp_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES stellar_wallets(id) ON DELETE RESTRICT,
  beneficiary_id UUID NOT NULL REFERENCES onramp_beneficiaries(id) ON DELETE RESTRICT,
  quote_id UUID NOT NULL REFERENCES cashout_quotes(id) ON DELETE RESTRICT,
  provider_order_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'QUOTE_CREATED',
  deposit_address TEXT,
  deposit_memo TEXT,
  fireblocks_transaction_id TEXT UNIQUE,
  transaction_hash TEXT,
  idempotency_key TEXT NOT NULL,
  submission_attempted_at TIMESTAMPTZ,
  provider_status TEXT,
  hold_reason TEXT,
  refund_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS offramp_orders_user_state_idx ON offramp_orders (user_id, state, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS offramp_orders_active_user_idx
  ON offramp_orders (user_id)
  WHERE state NOT IN ('PAID', 'EXPIRED', 'REJECTED', 'AMOUNT_MISMATCH', 'REFUNDED');

CREATE TABLE IF NOT EXISTS custody_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES stellar_wallets(id) ON DELETE RESTRICT,
  offramp_order_id UUID REFERENCES offramp_orders(id) ON DELETE SET NULL,
  fireblocks_transaction_id TEXT NOT NULL UNIQUE,
  transaction_kind TEXT NOT NULL DEFAULT 'CASHOUT' CHECK (transaction_kind IN ('WALLET_RESERVE', 'CASHOUT', 'REFUND')),
  asset_id TEXT NOT NULL,
  amount NUMERIC(20,7) NOT NULL CHECK (amount > 0),
  destination_address TEXT NOT NULL,
  destination_memo TEXT,
  state TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offramp_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES offramp_orders(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS offramp_order_events_order_idx ON offramp_order_events (order_id, created_at);

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('FIREBLOCKS', 'ONRAMP')),
  provider_event_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_timestamp TIMESTAMPTZ,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS provider_webhook_events_pending_idx ON provider_webhook_events (processed_at, received_at);

CREATE TABLE IF NOT EXISTS operator_controls (
  control_key TEXT PRIMARY KEY,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO operator_controls (control_key) VALUES ('SIGNUP'), ('INVOICES'), ('SIGNING'), ('CASHOUT')
ON CONFLICT (control_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'landing_page',
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  deletion_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS waitlist_metrics (
  metric_key TEXT PRIMARY KEY,
  metric_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO waitlist_metrics (metric_key, metric_value) VALUES ('active_count', 0)
ON CONFLICT (metric_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'HELD_FOR_COMPLIANCE', 'COMPLETED', 'REJECTED')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  notes TEXT
);
