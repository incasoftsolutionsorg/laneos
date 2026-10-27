# Slice status

Where each vertical slice from blueprint §15 stands in the code, and what is left. Update the row when a slice moves; one packet per slice (template: `docs/templates/slice-packet.md`) can be added when a slice is planned in detail.

Status: **Done** = the outcome works end to end on staging · **Partial** = works, with the gaps listed · **Not started**.

| Slice | Outcome | Status | Built | Left to do |
| --- | --- | --- | --- | --- |
| SLICE-001 Tenant & login | Admin creates a tenant; owner 2FA; cashier PIN on a registered lane | Done | Sign-up or Admin → New tenant (invite); owner email + TOTP 2-step; failed-login lock; lane registration + PIN unlock with PIN rules and change interval | Isolation test suite in pgTAP form (today: `pnpm test:db`) |
| SLICE-002 Catalogue | 3,000-item CSV import; prices, barcodes, PLU, weighed | Done | Item form with photo, case barcodes, CSV import with per-row errors | Measure import time at 3,000 rows |
| SLICE-003 First sale | Scan, scale labels, cash/card/LankaQR, receipt, drawer | Partial | Checkout, embedded barcodes, payments, browser printing | QZ Tray silent ESC/POS printing and drawer kick (`packages/devices`); scan < 50 ms measured on hardware |
| SLICE-004 Offline lane | Sell offline, sync once, 0 duplicates | Done | IndexedDB queue, idempotent sync, reserved invoice numbers, sync issues, service worker for offline reload | Catalogue delta sync (whole catalogue today); 30-sale offline drill on hardware |
| SLICE-005 After-sale & cash | Returns, credit notes, credit customers, shifts, Z | Done | Returns + credit notes (look-up rate limit and lock), on-account sales and payments, shifts, pickups, Z-report, credit-note cash-out | Lost-slip reissue (`api.reissue_credit_note`) |
| SLICE-006 Stock & simple promos | Stock, wastage, damaged goods, % / amount promos | Done | Adjustments, counts, damage reports with photos (required above the approval limit) + decisions, multi-buy / % promotions | — |
| SLICE-007 Reports, branding, security | Dashboards, logo, sessions, reset access, security options | Done | Dashboard, 7 report tabs + CSV, logo upload, brand colour / seasonal themes, sessions, reset access at every scope, security settings enforced | Login alerts (needs an email sender) |
| SLICE-008 Purchasing | Suppliers, PO, GRN with batches/expiry, sale-or-return, payments, counts | Done | Suppliers, PO, GRN, batches, FEFO expiry, supplier ledger and payments, supplier returns (damaged or unsold stock, credit or refusal) | Lane FEFO warning at scan (blueprint S6 P3) |
| SLICE-009 Promotions+ & loyalty | Multi-buy, mix & match, threshold, loyalty points | Done | Mix & match, spend-X, members-only in `packages/pricing` and `api.create_sale` (parity tested); loyalty earn, spend as payment, reverse on return, manual adjust | SMS points messages (needs the SMS outbox) |
| SLICE-010 Chain | Head office, central prices and schedules, transfers | Done | Overview, shops, stock across shops, transfers (WF-006), central pricing + pg_cron schedules, chain reports | Compare screens with Figma frames 3-xxx |
| SLICE-011 SaaS billing | PayHere recurring, grace, read-only mode | Done (needs merchant keys) | Plans, invoices (admin + daily job; billing starts when the trial ends, first month by the day), PayHere checkout and signed notify route, past due after the due date, suspended (read-only) after 14 days' grace, reactivation on payment | Set `PAYHERE_MERCHANT_ID` / `PAYHERE_MERCHANT_SECRET` (+ `PAYHERE_SANDBOX=true` to test) in Vercel and whitelist the domain in PayHere; card-on-file recurring after PayHere approval |
| SLICE-012 Advanced reports | Shrinkage, expiry, promotion effect, chain roll-ups | Done | Shrinkage, Expiry and Promotions report tabs (+ CSV); chain revenue and damage roll-ups | Report review with the pilot shop |
| SLICE-013 Platform+ | Public API, custom domains, PowerSync, scale PLU export | Not started | — | v2.0 |
