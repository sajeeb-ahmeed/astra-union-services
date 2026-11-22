-- Demand list (billing plan §3.6, owner-approved 18 Nov 08:01): when a citizen signup is
-- refused because the claimed union is not listed on the platform (422 UNION_NOT_LISTED,
-- Phase 3E gate), the attempt is captured here so the owner can see which unions to onboard
-- next. Only what the registration flow genuinely collected is stored: the citizen's name,
-- their mobile number when one was supplied, and the geography they claimed — no account is
-- created and the rejection response is unchanged.
-- Platform-level table, following the platform_coupons / platform_notices pattern
-- (migrations 044–046): no tenant RLS (the rows belong to no tenant — the citizen's union
-- has no office yet), no audit_events (FORCE-RLS tenant-scoped). Rows are never edited by
-- hand; the only mutation is the repeat-attempt counter below.
-- Repeat handling: a partial UNIQUE index on (phone, geography) lets a repeat attempt from
-- the same phone for the same union fold into the existing row (attempts + 1, latest name
-- and ward, last_attempt_at refreshed) instead of piling up duplicate rows. Attempts that
-- supplied no phone have no stable key the flow collected, so each is its own row.

CREATE TABLE platform_registration_demand (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name_bn text NOT NULL CHECK (length(btrim(name_bn)) BETWEEN 2 AND 120),
 name_en text NOT NULL CHECK (length(btrim(name_en)) BETWEEN 2 AND 120),
 phone text CHECK (phone IS NULL OR phone ~ '^01[3-9][0-9]{8}$'),
 division_code text NOT NULL,
 district_code text NOT NULL,
 upazila_code text NOT NULL,
 union_code text NOT NULL,
 ward_code text,
 attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
 first_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_registration_demand_phone_union
 ON platform_registration_demand(phone, division_code, district_code, upazila_code, union_code)
 WHERE phone IS NOT NULL;
CREATE INDEX platform_registration_demand_recent ON platform_registration_demand(last_attempt_at DESC);
CREATE INDEX platform_registration_demand_union
 ON platform_registration_demand(division_code, district_code, upazila_code, union_code);

REVOKE ALL ON platform_registration_demand FROM PUBLIC, astra_app;
GRANT SELECT, INSERT, UPDATE ON platform_registration_demand TO astra_app;
