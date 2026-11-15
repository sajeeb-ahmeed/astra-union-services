-- Phase 5c: citizen payments through SSLCommerz (cards and mobile wallets) beside bKash, with merchant
-- credentials per office instead of one deployment-wide binding. The store password is stored encrypted
-- (AES-256-GCM under MERCHANT_SECRET_KEY, bound to the office and environment); the database never sees it in
-- plain text. Payment intents and confirmations may now name either provider.
-- Effect on existing data: none; existing bKash rows keep provider 'BKASH'.

ALTER TABLE gateway_payment_intents DROP CONSTRAINT gateway_payment_intents_provider_check;
ALTER TABLE gateway_payment_intents ADD CONSTRAINT gateway_payment_intents_provider_check CHECK (provider IN ('BKASH', 'SSLCOMMERZ'));
ALTER TABLE gateway_payment_confirmations DROP CONSTRAINT gateway_payment_confirmations_provider_check;
ALTER TABLE gateway_payment_confirmations ADD CONSTRAINT gateway_payment_confirmations_provider_check CHECK (provider IN ('BKASH', 'SSLCOMMERZ'));

CREATE TABLE office_payment_merchants (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 provider text NOT NULL CHECK (provider = 'SSLCOMMERZ'),
 environment text NOT NULL CHECK (environment IN ('SANDBOX', 'LIVE')),
 store_id text NOT NULL CHECK (store_id ~ '^[A-Za-z0-9_.-]{3,100}$'),
 secret_cipher text NOT NULL CHECK (secret_cipher ~ '^v1\.[a-f0-9]{24}\.[a-f0-9]{32}\.[a-f0-9]+$'),
 enabled boolean NOT NULL DEFAULT true,
 updated_by uuid NOT NULL REFERENCES platform_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, provider)
);
ALTER TABLE office_payment_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_payment_merchants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON office_payment_merchants USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid) WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON office_payment_merchants FROM PUBLIC, astra_app;
GRANT SELECT, INSERT, UPDATE ON office_payment_merchants TO astra_app;

-- A receipt must name the verification its provider performed.
CREATE OR REPLACE FUNCTION enforce_gateway_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p gateway_payment_confirmations%ROWTYPE;
BEGIN
 SELECT * INTO p FROM gateway_payment_confirmations WHERE tenant_id=NEW.tenant_id AND intent_id=NEW.intent_id;
 IF p.application_id IS DISTINCT FROM NEW.application_id OR NEW.pdf_sha256<>encode(digest(NEW.pdf_bytes,'sha256'),'hex')
 OR NEW.snapshot->>'verification' IS DISTINCT FROM (CASE p.provider WHEN 'SSLCOMMERZ' THEN 'SSLCOMMERZ_SESSION_QUERY_AND_VALIDATION' ELSE 'BKASH_QUERY_AND_SEARCH' END)
 OR NEW.snapshot->>'provider' IS DISTINCT FROM p.provider
 OR NEW.snapshot->>'environment' IS DISTINCT FROM p.environment OR NEW.snapshot->>'transactionId' IS DISTINCT FROM p.transaction_id
 OR NEW.snapshot->>'amountMinor' IS DISTINCT FROM p.amount_minor::text THEN
  RAISE EXCEPTION 'Receipt must match immutable gateway confirmation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
