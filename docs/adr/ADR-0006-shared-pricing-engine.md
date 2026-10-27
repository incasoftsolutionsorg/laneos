# ADR-0006: One shared TypeScript pricing engine; server is the truth

**Status:** Accepted · **Date:** 2026-10-15

## Context

The lane must show the right total before the server confirms it.

## Decision

`packages/pricing` prices the basket on the lane; `api.create_sale` re-prices with the same rules and refuses a different total (`PRICE_MISMATCH`). The effective price is the shop override (`shop_prices`) else the default list, in both `api.lane_catalog` and `api.create_sale`. `pnpm test:db` checks parity.

## Consequences

- Any pricing change touches both places in the same PR.
