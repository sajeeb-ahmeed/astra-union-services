-- Phase 3b: per-office switch for the citizen profile completeness gate.
-- Off by default (owner decision "warn first, enforce later"): approvers see what is missing, and
-- certificate issuance is refused for an incomplete profile only once the office admin turns this on.
ALTER TABLE tenants ADD COLUMN require_complete_profile boolean NOT NULL DEFAULT false;
