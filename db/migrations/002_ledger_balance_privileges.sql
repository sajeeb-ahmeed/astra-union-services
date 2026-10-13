-- The application role can append ledger entries, but cannot mutate the balance cache directly.
CREATE OR REPLACE FUNCTION apply_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_balance integer; BEGIN
 SELECT balance INTO current_balance FROM tenant_wallets WHERE tenant_id=NEW.tenant_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM credit_ledger WHERE tenant_id=NEW.tenant_id AND idempotency_key=NEW.idempotency_key) THEN RETURN NULL; END IF;
 IF current_balance IS NULL OR current_balance+NEW.delta<0 THEN RAISE EXCEPTION 'Insufficient credits'; END IF;
 NEW.balance_after := current_balance+NEW.delta;
 UPDATE tenant_wallets SET balance=NEW.balance_after WHERE tenant_id=NEW.tenant_id;
 RETURN NEW;
END $$;
REVOKE UPDATE ON tenant_wallets FROM astra_app;
REVOKE EXECUTE ON FUNCTION apply_ledger() FROM PUBLIC;
