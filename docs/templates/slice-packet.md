# SLICE-003 First sale
**Outcome:** a cashier sells a 20-item basket with a weighed item and prints a receipt.
**Requirements:** REQ-SAL-001..006, REQ-BAR-001..002 · **Milestone:** M2 · **Lead:** P3

## Contracts (agreed day 1)
- Function: `api.create_sale(p jsonb) returns jsonb` (P2)
- Route: `POST /api/lane/sales` (P2) · Schema: `CreateSale` in packages/core (P2)
- Tables: sales, sale_lines, payments, stock_movements (P1)
- Errors: VALIDATION_ERROR, PRICE_MISMATCH, ABOVE_MRP, BARCODE_MISMATCH, NO_OPEN_SHIFT

## Tasks
| Task | Owner | Size | Issue |
| --- | --- | --- | --- |
| Sales tables + partitions + RLS | P1 | M | #___ |
| create_sale + tests | P2 | L | #___ |
| Checkout screen + printing | P3 | L | #___ |
| Checkout E2E | P4 | M | #___ |

## Demo script
1. ... 2. ... 3. ...

## Acceptance result
Accepted / rejected by PO on <date> · Notes
