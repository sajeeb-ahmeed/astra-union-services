-- Phase W (owner decision, 16 Nov 2026): in-app notifications for application events.
-- Until now outbox_events carried only certificate issuance (resource_id = certificate id).
-- The chairman-direct workflow also notifies about submissions and rejections
-- (resource_id = application id); a rejection notification must carry the chairman's
-- reason, which lives in this nullable free-text detail column. Existing rows keep
-- detail NULL. Effect on existing data: none (additive column only).
ALTER TABLE outbox_events ADD COLUMN detail text;
