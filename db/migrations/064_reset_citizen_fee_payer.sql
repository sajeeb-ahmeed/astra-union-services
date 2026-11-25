-- W-005 remediation for deployments already in the broken state.
--
-- The citizen payment rail does not exist yet (Phase 7), so a stored
-- application_fee_payer='citizen' bricks every citizen submit: the fee
-- cannot be taken and each application stays a draft forever. The API
-- now refuses the flip (409 CITIZEN_PAYMENT_UNSUPPORTED); this
-- migration repairs any value already stored, resetting it to the
-- office wallet and recording the reset in the settings-change history
-- (attributed to the owner who made the original change). Deployments
-- already on 'office' are untouched — the block only acts when a
-- 'citizen' row exists.
DO $$
DECLARE
  actor uuid;
BEGIN
  SELECT updated_by INTO actor
    FROM platform_settings
   WHERE key = 'application_fee_payer' AND value = 'citizen';
  IF actor IS NOT NULL THEN
    INSERT INTO platform_setting_changes(key, value, reason, changed_by)
    VALUES (
      'application_fee_payer',
      'office',
      'W-005 remediation: citizen payment has no payment rail yet (Phase 7); the citizen-pays setting would leave every submit a draft, so it is reset to the office wallet.',
      actor
    );
    UPDATE platform_settings
       SET value = 'office', updated_at = now()
     WHERE key = 'application_fee_payer' AND value = 'citizen';
  END IF;
END $$;
