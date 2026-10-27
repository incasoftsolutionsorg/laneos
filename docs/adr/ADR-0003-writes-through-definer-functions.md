# ADR-0003: Money and stock writes through SECURITY DEFINER functions

**Status:** Accepted · **Date:** 2026-10-15

## Context

Sales, returns, stock and ledgers must be consistent and auditable even if a client is buggy or hostile.

## Decision

Financial and stock tables are select-only for `authenticated` (INSERT/UPDATE/DELETE revoked). Writes happen only in `api.*` functions with `set search_path = ''`, a permission check, a WHERE clause on every UPDATE/DELETE, and an audit row. Ledgers are append-only by trigger.

## Consequences

- Every rule exists once, in one transaction; the UI cannot bypass it.
- New `api`/`app` functions are not executable by default; each migration grants what it adds.
