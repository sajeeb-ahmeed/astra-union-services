-- Office-owned bKash merchant credentials (execution guide 5.3: "credentials per office, never one global
-- tenant binding"). Each office stores its own bKash merchant number and API credentials, encrypted under
-- MERCHANT_SECRET_KEY and bound to the office, provider and environment, exactly like its SSLCommerz store.
-- The deployment-wide BKASH_TENANT_ID configuration stays only as a legacy fallback for an office that has
-- not saved its own credentials.
-- Effect on existing data: none; existing SSLCommerz rows are unchanged.
ALTER TABLE office_payment_merchants DROP CONSTRAINT office_payment_merchants_provider_check;
ALTER TABLE office_payment_merchants ADD CONSTRAINT office_payment_merchants_provider_check CHECK (provider IN ('SSLCOMMERZ', 'BKASH'));
-- For bKash the merchant account is the receiving wallet number (01XXXXXXXXX).
ALTER TABLE office_payment_merchants ADD CONSTRAINT office_payment_merchants_bkash_account
  CHECK (provider <> 'BKASH' OR store_id ~ '^01[3-9][0-9]{8}$');
