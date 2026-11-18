-- Phase 3A: the platform owner can cancel a pending payment order from the
-- owner dashboard (POST /api/v1/owner/payment-orders/:id/cancel), which needs a
-- terminal CANCELLED state. Migration 001 constrained payment_orders.status to
-- ('PENDING','SETTLED'), so cancelling was impossible without this change.
-- Effect on existing data: none — existing rows keep their status; the wider
-- CHECK only admits the new value for future cancellations. The settlement
-- path (app.ts settle()) refuses CANCELLED orders, so a late gateway webhook
-- can never resurrect a cancelled order.
ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_status_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_status_check CHECK(status IN ('PENDING','SETTLED','CANCELLED'));
