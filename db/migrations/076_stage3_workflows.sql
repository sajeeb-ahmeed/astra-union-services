-- Phase 4 Stage 3 workflows.
-- W-023: correction-cycle counter (capped at 3 in the API; see CORRECTION_CYCLE_LIMIT).
-- W-013: partial-draft marker — a draft whose latest payload has not passed full
--   form validation yet. Submit/resubmit always re-validate, so a partial draft
--   can never leave DRAFT/CORRECTION_REQUIRED in an invalid state.
-- W-014: re-application link — a new draft created from a REJECTED application
--   records the application it re-applies for, so the history stays connected.
ALTER TABLE applications ADD COLUMN correction_count integer NOT NULL DEFAULT 0 CHECK (correction_count >= 0);
ALTER TABLE applications ADD COLUMN partial_payload boolean NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN reapplication_of uuid;
ALTER TABLE applications ADD CONSTRAINT applications_reapplication_of_fk
  FOREIGN KEY (tenant_id, reapplication_of) REFERENCES applications(tenant_id, id);
CREATE INDEX applications_reapplication_of ON applications(tenant_id, reapplication_of);
