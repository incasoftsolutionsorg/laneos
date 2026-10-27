# ADR-0005: Local catalogue on the lane, one call per basket, offline queue

**Status:** Accepted · **Date:** 2026-10-15

## Context

Scanning must take < 50 ms and shops lose internet.

## Decision

The lane loads the catalogue (`api.lane_catalog`), prices baskets locally, and sends one finished basket to `POST /api/lane/sales` with a client UUID. Offline baskets wait in IndexedDB and sync with backoff; shifts can reserve invoice numbers for offline receipts.

## Consequences

- Duplicate protection by idempotency key; refused offline sales become sync issues.
- Catalogue delta sync and a service worker are follow-ups (data model §6).
