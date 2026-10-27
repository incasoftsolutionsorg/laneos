# ADR-0004: Money as bigint cents; quantities as integer milli-units

**Status:** Accepted · **Date:** 2026-10-15

## Context

Floating point causes rounding errors in totals, VAT and weighed items.

## Decision

Money is `bigint` cents; quantities are `bigint` milli-units (1 piece = 1000; weighed: grams). Rounding is half-up through `app.div_round` and `@laneos/core` helpers.

## Consequences

- Lane and server compute identical totals.
- Display formatting happens only at the edge (`formatRs`, `formatQty`).
