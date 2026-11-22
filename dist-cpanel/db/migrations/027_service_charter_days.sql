-- Phase 4a: citizen-charter delivery time per service, set by the office as part of its versioned fee policy.
-- Published with the price list on the office's public page. Null means the office has not stated a time.
-- Effect on existing data: none; earlier policy versions keep a null charter time.
ALTER TABLE service_order_policies
  ADD COLUMN charter_days integer CHECK (charter_days BETWEEN 1 AND 365);
