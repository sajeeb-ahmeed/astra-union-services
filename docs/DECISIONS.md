# Decision log

Short records of design decisions that change the schema or remove something. Newest first.

## D-001 — Drop `government_fee_assessments` (12 November 2026, migration 018)

**Context.** Migration 001 created `government_fee_assessments` for official (statutory) fees, kept apart from SaaS wallets. Nothing in the API, web app or scripts ever read or wrote it. Since release 0.4, each office's statutory, processing, urgency and delivery fees are captured per order in `service_order_policies` and `application_order_snapshots`; since 0.5 the gateway tables record checkout, confirmation, receipt and reconciliation. The live database held 0 rows in this table and no foreign key pointed at it.

**Decision.** Drop the table in migration 018. The migration refuses to run if the table has any rows, so a real fee record can never be dropped silently.

**Consequences.** One fewer tenant table under forced RLS (its policy and grants are removed with it). There is no parallel fee system: real fee parity (price lists, coupons, points wallet) is planned in Phases 4 and 5 on top of the order/fee snapshot path. Historical evidence files under `execution/` still mention the table because they record earlier releases; they are not changed.
