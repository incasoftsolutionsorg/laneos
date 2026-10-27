# Architecture decision records

One file per decision. Change a decision with a change request (blueprint §18) and a new ADR that supersedes the old one.

| ADR | Decision | Status | Date |
| --- | --- | --- | --- |
| [ADR-0001](ADR-0001-next-supabase-postgres-stack.md) | Next.js + Supabase + PostgreSQL stack | Accepted | 2026-10-15 |
| [ADR-0002](ADR-0002-shared-schema-forced-rls.md) | Shared schema with tenant_id and forced RLS | Accepted | 2026-10-15 |
| [ADR-0003](ADR-0003-writes-through-definer-functions.md) | Money and stock writes through SECURITY DEFINER functions | Accepted | 2026-10-15 |
| [ADR-0004](ADR-0004-integer-money-and-quantities.md) | Money as bigint cents; quantities as integer milli-units | Accepted | 2026-10-15 |
| [ADR-0005](ADR-0005-local-catalogue-offline-queue.md) | Local catalogue on the lane, one call per basket, offline queue | Accepted | 2026-10-15 |
| [ADR-0006](ADR-0006-shared-pricing-engine.md) | One shared TypeScript pricing engine; server is the truth | Accepted | 2026-10-15 |
| [ADR-0007](ADR-0007-trunk-based-development.md) | Trunk-based development with short-lived branches | Accepted | 2026-10-15 |
| [ADR-0008](ADR-0008-payhere-saas-billing.md) | PayHere for SaaS billing | Proposed | 2026-10-15 |
| [ADR-0009](ADR-0009-bcrypt-pins.md) | Cashier PINs hashed with bcrypt in the database | Accepted | 2026-10-23 |
| [ADR-0010](ADR-0010-reset-access-by-session-deletion.md) | Reset access by deleting auth sessions | Accepted | 2026-10-23 |
