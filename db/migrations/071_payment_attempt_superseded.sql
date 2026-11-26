-- W-007: a payment attempt an operator has replaced is SUPERSEDED. A
-- superseded attempt can never confirm (the finalize guard refuses it),
-- so a stuck checkout (unknown / cancelled / failed / expired) can be
-- unblocked by an operator reset after the provider evidence has been
-- checked, and a fresh attempt with a fresh invoice can start. The
-- superseded attempt stays in history; it is never deleted.
ALTER TABLE gateway_payment_intents DROP CONSTRAINT gateway_payment_intents_status_check;
ALTER TABLE gateway_payment_intents ADD CONSTRAINT gateway_payment_intents_status_check CHECK (status IN ('CREATE_PENDING','CREATE_UNKNOWN','READY','EXECUTE_PENDING','VERIFYING','PAID','REVIEW_REQUIRED','FAILED','SUPERSEDED'));

-- The plain UNIQUE(tenant_id,application_id) would still block a
-- replacement checkout, so it is replaced by a partial unique index:
-- at most one LIVE attempt per application, while superseded attempts
-- accumulate as audit history. The other uniqueness guarantees
-- (request key, callback hash, invoice, payment id) already
-- distinguish attempts, so no other change is needed.
ALTER TABLE gateway_payment_intents
  DROP CONSTRAINT gateway_payment_intents_tenant_id_application_id_key;
CREATE UNIQUE INDEX gateway_payment_intents_live_application
  ON gateway_payment_intents(tenant_id, application_id)
  WHERE status <> 'SUPERSEDED';
