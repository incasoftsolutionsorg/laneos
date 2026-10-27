# ADR-0002: Shared schema with tenant_id and forced RLS

**Status:** Accepted · **Date:** 2026-10-15

## Context

Hundreds of small shops must never see each other's data, at low cost per tenant.

## Decision

One schema; every tenant table has `tenant_id`; row-level security is enabled **and forced** on every `public` table. Policies call `app.tenant_id()`, `app.can_shop()` and `app.has_perm()`, which read JWT claims set by the access token hook (`app_role`, never `role`).

## Consequences

- A missing policy fails closed; CI checks every public table has RLS forced.
- Cross-tenant work (platform admin, reports) goes through audited `SECURITY DEFINER` functions only.
- Schema-per-tenant migrations and connection pooling problems are avoided.
