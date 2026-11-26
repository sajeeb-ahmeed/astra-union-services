-- S-015: the owner-only retention purge (POST /owner/public-data/purge)
-- deletes eligible support_requests / subscriptions_interest rows. Migration
-- 006 granted the app role SELECT, INSERT and UPDATE on those tables only,
-- so the purge failed with insufficient privilege. DELETE is granted here
-- and nowhere else: the purge endpoint is the only DELETE path on these
-- tables, it is owner-only, and every purge writes a PUBLIC_DATA_PURGED row
-- to the append-only platform audit stream (migration 073).
GRANT DELETE ON support_requests, subscriptions_interest TO astra_app;
