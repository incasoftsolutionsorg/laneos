# ADR-0010: Reset access by deleting auth sessions

**Status:** Accepted · **Date:** 2026-10-23

## Context

Blueprint §27.5.5 describes reset markers compared with every token's issue time in the middleware.

## Decision

`api.reset_access` (user, lane, shop, tenant) and `api.admin_reset_platform` delete the affected rows in `auth.sessions` and unlock lanes; the proxy's `supabase.auth.getUser()` then fails for the old tokens. Reset markers are still written to `session_resets` for the audit trail.

## Consequences

- No per-request database lookup.
- Access tokens can live up to their expiry for direct REST calls; keep JWT expiry short (default 1 h).
