-- REG-UX Phase 1 (design note §3.2 option C, §3.4): one-screen signup with three
-- required fields (name, mobile, password). The data the short form deliberately
-- does not collect is DEFERRED to profile completion and stays honestly NULL until
-- the citizen provides it — never a placeholder that could reach a certificate.
--
-- Effect on existing data: none. Dropping NOT NULL changes no rows; every existing
-- row already satisfies the new name CHECK (both names were NOT NULL).
--
-- Where the guarantee moves: POST /applications refuses (409 PROFILE_INCOMPLETE)
-- until the deferred items are present, and the issuance gate is unchanged.
ALTER TABLE citizens
  ALTER COLUMN date_of_birth DROP NOT NULL,
  ALTER COLUMN address_bn DROP NOT NULL,
  ALTER COLUMN address_en DROP NOT NULL,
  ALTER COLUMN full_name_bn DROP NOT NULL,
  ALTER COLUMN full_name_en DROP NOT NULL,
  ADD CONSTRAINT citizens_name_present
    CHECK (full_name_bn IS NOT NULL OR full_name_en IS NOT NULL);

-- A mobile number given on the short signup form becomes the account's sign-in
-- identifier without a one-time code (no SMS delivery is live yet; the same
-- model the reference platforms use). It is marked self-declared so the UI and
-- any later OTP verification can tell it apart from an OTP-verified number.
-- Existing identifiers were all bound through the verified paths: they keep false.
ALTER TABLE account_identifiers
  ADD COLUMN self_declared boolean NOT NULL DEFAULT false;
