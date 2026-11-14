# Phase 2 plan — offices, account types and sign-in

Status: **2a, 2b and 2c merged (PRs #14, #15, #16); 2d in review. Owner decisions recorded 12 November 2026.** Source: the parity execution guide, Phase 2 (G1–G4).

## What already exists (no rebuild)

- **Office types.** Every office (tenant) already has `office_type` ∈ {UNION, MUNICIPALITY, CITY_CORPORATION} (migration 004) and division/district/upazila/union geography codes (migration 010). An office stays a tenant: tenant isolation (forced RLS on `astra.tenant_id`) is unchanged. The guide's separate `offices` table is therefore not created.
- **Roles.** Each account has one role per office through `staff_memberships.role` ∈ {admin, approver, reviewer, staff, finance, citizen}, plus the platform `owner`. All API permission checks use these roles. They stay the only thing that grants access.
- **Sign-in** is email + password with optional MFA; a per-IP limit of 60 attempts a minute applies.

## Owner decisions

| Question | Decision |
| --- | --- |
| Upazila administrator, District administrator, Divisional Commissioner (cross-office oversight) | **Deferred.** They need a separate jurisdiction-wide read path; planned as its own step after Phase 2. |
| How NID / birth-registration numbers are stored | **Keyed hash only** (HMAC-SHA-256 with a new server secret `IDENTIFIER_SECRET`). Numbers can be matched, never read back. |
| Who verifies new administrative accounts | **The platform owner**, in a manual verification queue. |
| OTP / SMS | **Development provider only.** The OTP flow is complete behind a provider interface; in development the code goes to the server log, never to the API response. Live SMS waits for a provider the owner chooses. |

## Account types (data, mapped onto existing roles)

The guide names 21 types but its list has **20**; the missing one must come from the Phase 0 role evidence. Mappings marked *provisional* follow the guide's described workflow (Secretary verifies, Chairman approves) and must be confirmed against `docs/evidence/prottoyon-roles/` when captured.

| Account type | Office type | Maps to role | Status |
| --- | --- | --- | --- |
| UP Chairman | Union | approver | provisional |
| UP Panel Chairman | Union | approver | provisional |
| UP Secretary | Union | reviewer | provisional |
| UP Administrative Officer | Union | admin | provisional |
| UP Member | Union | staff | provisional (may be view-only) |
| UP Reserved Women Member | Union | staff | provisional (may be view-only) |
| Gram Police | Union | staff | provisional (may be view-only) |
| Information Officer | Union | staff | provisional |
| Municipality Mayor | Municipality | approver | provisional |
| Municipality Secretary | Municipality | reviewer | provisional |
| Municipality Officer | Municipality | staff | provisional |
| City Corporation Mayor | City corporation | approver | provisional |
| City Corporation Secretary | City corporation | reviewer | provisional |
| City Corporation Officer | City corporation | staff | provisional |
| Digital Centre Entrepreneur (UDC) | any | staff | confirmed by the observed UDC interface |
| Information & Service Centre staff | any | staff | provisional |
| Upazila administrator | — | — | deferred (oversight) |
| District administrator | — | — | deferred (oversight) |
| Divisional Commissioner | — | — | deferred (oversight) |
| System Admin | platform | owner | maps to the existing platform owner |

An approver still needs explicit per-service approval authorizations before approving or issuing; mapping a Chairman to `approver` grants nothing by itself.

## Delivery, one pull request each

1. **2a — Account-type catalogue.** Migration: `account_types` reference table (code, BN/EN names, office types, mapped role, status) and a nullable `staff_memberships.account_type` that must agree with the membership's role and the office type. Admin user creation accepts an account type; the UI shows it. Existing members keep working unchanged.
2. **2b — Multi-identifier sign-in.** Migration: `account_identifiers` (user, kind ∈ {mobile, email, nid, birth_reg}, keyed digest, unique per kind). `POST /api/v1/auth/login` accepts `identifierType` + `identifier` (email-only requests keep working). Unknown identifier and wrong password give the same error and similar timing; a per-identifier limit sits beside the per-IP limit and behaves the same for every kind. The login form gets an identifier-type selector.
3. **2c — OTP and citizen registration.** `OtpProvider` interface with a development provider. Citizen sign-up: name BN/EN, mobile, optional email → OTP to mobile → profile completion. OTP codes are stored hashed, expire, are single-use and attempt-limited.
4. **2d — Administrative registration and verification queue.** Public office-account registration: office, account type, identifiers → verification code → **pending** account that cannot sign in. Owner workspace gets a verification queue (approve / reject with reason, audited). Approval activates the membership with the mapped role.

Each PR ships its tests (API and browser), updates `ROLES_PERMISSIONS.md`, and keeps every existing sign-in and permission test passing.

## Not in Phase 2

Cross-office oversight roles (deferred), live SMS, real identity verification against an external register (citizens remain `SYNTHETIC_DEMO`), and Phase 3 citizen fields.
