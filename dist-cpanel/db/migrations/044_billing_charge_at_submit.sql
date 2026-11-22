-- Phase 3B: per-service credit pricing + the charge at final submit (billing model, owner decisions
-- 18 Nov 2026). Until now the platform took its money at issuance: the credit wallet was debited per
-- certificate and the owner-set point price was deducted beside it. The model now has ONE currency
-- (credit) and ONE chargeable moment (the citizen's final submit):
--   * service_credit_prices: the owner-published price of one application per service, in credits,
--     versioned with a mandatory reason — the point-price pattern (migration 029) carried onto credits.
--     No row yet = the default price of 1 credit.
--   * applications.fee_*: the settlement recorded once, at the application's first successful submit.
--     fee_method CREDIT = the office wallet was debited; ALLOWANCE = an active subscription covered it
--     and one monthly allowance unit was consumed; FREE = the price in force was 0.
--   * credit_ledger learns the APPLICATION_FEE kind, linked to the application it paid for.
--   * subscription_allowance_consumptions: one row per application whose submit an active subscription
--     covered; the monthly count is the allowance usage. Plans carry no limit yet (that is Phase 3C) —
--     until then every active subscription is treated as unlimited and this table is the counter 3C
--     will read. The row's UNIQUE(tenant_id, application_id) makes consumption once-per-application
--     a database fact, not a code hope.
--   * platform_settings: owner-switchable platform settings; the first key is
--     application_fee_payer = 'office' | 'citizen' (default 'office').
-- Effect on existing data: every existing application keeps fee_* NULL (it was submitted under the old
-- issuance-charge model and is never retro-charged); wallets, ledgers and point balances are untouched.
-- The points wallet stays readable; its issuance spend path is retired in code by this phase.

CREATE TABLE service_credit_prices (
 service_no integer NOT NULL REFERENCES service_catalog(service_no),
 version integer NOT NULL CHECK (version > 0),
 price_credits integer NOT NULL CHECK (price_credits BETWEEN 0 AND 10000),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
 created_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (service_no, version)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON service_credit_prices FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON service_credit_prices FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON service_credit_prices TO astra_app;

CREATE TABLE platform_settings (
 key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{3,80}$'),
 value text NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
 updated_by uuid NOT NULL REFERENCES platform_users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON platform_settings FROM PUBLIC, astra_app;
GRANT SELECT, INSERT, UPDATE ON platform_settings TO astra_app;

-- Every settings change, with its mandatory reason (audit_events is tenant-scoped by RLS,
-- so platform-level changes keep their own append-only history here).
CREATE TABLE platform_setting_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key text NOT NULL,
 value text NOT NULL,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
 changed_by uuid NOT NULL REFERENCES platform_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON platform_setting_changes FOR EACH ROW EXECUTE FUNCTION immutable_record();
REVOKE ALL ON platform_setting_changes FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON platform_setting_changes TO astra_app;

ALTER TABLE applications
 ADD COLUMN fee_settled_at timestamptz,
 ADD COLUMN fee_method text CHECK (fee_method IN ('CREDIT','ALLOWANCE','FREE')),
 ADD COLUMN fee_credits integer CHECK (fee_credits >= 0),
 ADD COLUMN fee_price_version integer CHECK (fee_price_version >= 0),
 ADD CONSTRAINT applications_fee_settlement_shape
   CHECK ((fee_settled_at IS NULL) = (fee_method IS NULL) AND (fee_settled_at IS NULL OR (fee_credits IS NOT NULL AND fee_price_version IS NOT NULL)));

ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
 CHECK (kind IN ('ISSUANCE','PLAN_GRANT','TOPUP','ADJUSTMENT','APPLICATION_FEE'));
ALTER TABLE credit_ledger ADD COLUMN application_id uuid;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_application_fk
 FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id);
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_application_shape
 CHECK ((kind = 'APPLICATION_FEE' AND application_id IS NOT NULL AND delta < 0)
        OR (kind <> 'APPLICATION_FEE' AND application_id IS NULL));
CREATE UNIQUE INDEX one_application_fee ON credit_ledger(tenant_id, application_id) WHERE kind = 'APPLICATION_FEE';

CREATE TABLE subscription_allowance_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 application_id uuid NOT NULL,
 period_month date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id, application_id),
 FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id)
);
CREATE INDEX allowance_consumptions_month ON subscription_allowance_consumptions(tenant_id, period_month);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON subscription_allowance_consumptions FOR EACH ROW EXECUTE FUNCTION immutable_record();
ALTER TABLE subscription_allowance_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_allowance_consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON subscription_allowance_consumptions
 USING (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=nullif(current_setting('astra.tenant_id',true),'')::uuid);
REVOKE ALL ON subscription_allowance_consumptions FROM PUBLIC, astra_app;
GRANT SELECT, INSERT ON subscription_allowance_consumptions TO astra_app;
