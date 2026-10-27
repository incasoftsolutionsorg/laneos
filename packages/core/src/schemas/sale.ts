import { z } from 'zod';
import { cents, uuid } from './common';

export const PAYMENT_METHODS = ['cash', 'card', 'lankaqr', 'credit_note', 'account', 'loyalty'] as const;

export const SaleLineInput = z
  .object({
    itemId: uuid,
    qtyMilli: z.number().int().min(1).max(100_000_000),
    /** Only for open-price items; every other price comes from the server. */
    openPriceCents: cents.optional(),
  })
  .strict();

export const PaymentInput = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amountCents: cents.min(1),
    reference: z.string().max(64).optional(),
  })
  .strict();

/** Body of POST /api/lane/sales — the client never sends prices or totals it computed, except as a check. */
export const CreateSale = z
  .object({
    clientUuid: uuid,
    laneId: uuid,
    customerId: uuid.nullable().optional(),
    lines: z.array(SaleLineInput).min(1).max(300),
    payments: z.array(PaymentInput).min(1).max(6),
    expectedTotalCents: cents,
    /** A number from the shift's reserved range (lets an offline lane print the final number). */
    invoiceNo: z.string().regex(/^[A-Z0-9]{2,8}-L\d{1,2}-\d{6}$/).optional(),
  })
  .strict();

export type CreateSale = z.infer<typeof CreateSale>;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
