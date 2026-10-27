# ADR-0008: PayHere for SaaS billing

**Status:** Proposed · **Date:** 2026-10-15

## Context

Stripe is not available to Sri Lankan merchants; tenants pay monthly in LKR.

## Decision

Use PayHere (recurring payments, signed notify webhook to an Edge Function). Until the merchant account exists, LaneOS staff record payments in Admin → Billing (`api.admin_set_invoice`) and tenants see invoices in Plan & billing.

## Consequences

- Webhook signature checks and idempotency are required before go-live.
- Suspended tenants cannot record sales (trigger `app.tenant_can_sell`).
