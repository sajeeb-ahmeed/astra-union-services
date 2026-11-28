-- CERT-FEE: self-service union offices and per-certificate platform fees
-- (owner order, 28 Nov 2026).
--
-- 1. Self-service offices. A union office may open itself on the platform
--    and set itself up at once (staff, services, signature, settings).
--    Until the platform owner verifies it, the office is hidden from the
--    public directory and cannot issue a certificate, so nobody can open a
--    fake union office and hand out official documents. Every existing
--    office was onboarded by the owner and is therefore VERIFIED.
ALTER TABLE tenants
  ADD COLUMN verification_status text NOT NULL DEFAULT 'VERIFIED'
    CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_by uuid REFERENCES platform_users(id),
  ADD COLUMN verification_note text CHECK (verification_note IS NULL OR length(btrim(verification_note)) BETWEEN 3 AND 500),
  ADD COLUMN self_registered boolean NOT NULL DEFAULT false,
  -- 2. Billing mode, per office. SUBMIT_CREDIT is the existing model (credit
  --    charged at submit, subscriptions). PER_CERTIFICATE charges the office
  --    the owner's fixed fee per certificate language, only when the Chairman
  --    approves, and issues only the paid language versions. Both coexist;
  --    the owner switches an office between them.
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'SUBMIT_CREDIT'
    CHECK (billing_mode IN ('SUBMIT_CREDIT', 'PER_CERTIFICATE'));

-- 3. A certificate may carry one language version or both. Rows issued
--    before this migration keep languages NULL ("as stored": pdf is Bangla,
--    pdf_en English when present); nothing existing is rewritten.
ALTER TABLE certificates
  ADD COLUMN languages text CHECK (languages IS NULL OR languages IN ('bn', 'en', 'bilingual'));
ALTER TABLE certificates ALTER COLUMN pdf DROP NOT NULL;
ALTER TABLE certificates
  ADD CONSTRAINT certificates_has_render CHECK (pdf IS NOT NULL OR pdf_en IS NOT NULL),
  ADD CONSTRAINT certificates_languages_match_renders CHECK (
    languages IS NULL
    OR (languages = 'bn' AND pdf IS NOT NULL AND pdf_en IS NULL)
    OR (languages = 'en' AND pdf IS NULL AND pdf_en IS NOT NULL)
    OR (languages = 'bilingual' AND pdf IS NOT NULL AND pdf_en IS NOT NULL)
  );

-- 4. Online certificate fees ride the existing platform order checkout
--    (order-payments.ts: bKash / SSLCommerz to the platform merchant). A
--    certificate_fee order grants no credits.
ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_kind_check;
ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_kind_check CHECK (kind IN ('topup', 'subscription', 'certificate_fee'));
ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_credits_check;
ALTER TABLE payment_orders
  ADD CONSTRAINT payment_orders_credits_check CHECK (
    (kind = 'certificate_fee' AND credits = 0) OR (kind <> 'certificate_fee' AND credits > 0)
  );

-- 5. One row per certificate fee. WALLET fees are written CONSUMED inside the
--    issuance transaction together with their point_ledger ISSUANCE debit.
--    GATEWAY fees go PENDING (order created) -> PAID (order settled) ->
--    CONSUMED (certificate issued), or CANCELLED when the Chairman changes
--    the languages before paying. The amount and both unit prices are
--    snapshotted, so a later price change never alters a fee already quoted.
CREATE TABLE certificate_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  application_id uuid NOT NULL,
  languages text NOT NULL CHECK (languages IN ('bn', 'en', 'bilingual')),
  fee_bn_minor bigint NOT NULL CHECK (fee_bn_minor >= 0),
  fee_en_minor bigint NOT NULL CHECK (fee_en_minor >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 100000000),
  method text NOT NULL CHECK (method IN ('WALLET', 'GATEWAY')),
  status text NOT NULL CHECK (status IN ('PENDING', 'PAID', 'CONSUMED', 'CANCELLED')),
  order_id uuid,
  certificate_id uuid,
  created_by uuid NOT NULL REFERENCES platform_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  consumed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES payment_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, certificate_id) REFERENCES certificates(tenant_id, id),
  CHECK (amount_minor = CASE languages
    WHEN 'bn' THEN fee_bn_minor
    WHEN 'en' THEN fee_en_minor
    ELSE fee_bn_minor + fee_en_minor END),
  CHECK ((method = 'GATEWAY') = (order_id IS NOT NULL)),
  CHECK ((status = 'CONSUMED') = (certificate_id IS NOT NULL)),
  CHECK (method = 'GATEWAY' OR status = 'CONSUMED')
);
-- At most one live fee per application: a certificate is paid for once.
CREATE UNIQUE INDEX certificate_fees_one_live
  ON certificate_fees(tenant_id, application_id) WHERE status <> 'CANCELLED';
CREATE UNIQUE INDEX certificate_fees_order ON certificate_fees(tenant_id, order_id) WHERE order_id IS NOT NULL;

ALTER TABLE certificate_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificate_fees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON certificate_fees
  USING (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('astra.tenant_id', true), '')::uuid);
REVOKE ALL ON certificate_fees FROM PUBLIC, astra_app;
GRANT SELECT, INSERT, UPDATE ON certificate_fees TO astra_app;

-- 6. Submit charges nothing for a PER_CERTIFICATE office: the application's
--    fee is marked settled at submit with method PER_CERTIFICATE (0 credits),
--    so a later switch of the office back to SUBMIT_CREDIT never charges an
--    application that was submitted under the per-certificate model.
ALTER TABLE applications DROP CONSTRAINT applications_fee_method_check;
ALTER TABLE applications
  ADD CONSTRAINT applications_fee_method_check CHECK (fee_method IN ('CREDIT', 'ALLOWANCE', 'FREE', 'PER_CERTIFICATE'));

-- 7. The durable platform audit stream (S-014) records the new owner and
--    self-service actions.
ALTER TABLE platform_security_events DROP CONSTRAINT platform_security_events_action_check;
ALTER TABLE platform_security_events ADD CONSTRAINT platform_security_events_action_check CHECK (action IN (
  'OWNER_PASSWORD_CHANGED','OWNER_SESSIONS_REVOKED','OWNER_SESSION_REVOKED',
  'TENANT_CREATED','TENANT_STATUS_UPDATED',
  'LOGIN_FAILED','LOGIN_LOCKED_OUT',
  'PUBLIC_DATA_PURGED',
  'TENANT_SELF_REGISTERED','TENANT_VERIFIED','TENANT_VERIFICATION_REFUSED',
  'TENANT_BILLING_MODE_CHANGED','CERTIFICATE_FEES_CHANGED'));
