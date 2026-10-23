import { z } from 'zod';
import { cents, lkPhone } from './common';

export const CustomerInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: lkPhone,
    email: z.email().max(200).nullable().optional(),
    creditLimitCents: cents.default(0),
    marketingConsent: z.boolean().default(false),
  })
  .strict();

export const SupplierInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    contactName: z.string().trim().max(80).nullable().optional(),
    phone: lkPhone.nullable().optional(),
    email: z.email().max(200).nullable().optional(),
    vatNo: z.string().trim().max(30).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).default(30),
    isSaleOrReturn: z.boolean().default(false),
    dailyDelivery: z.boolean().default(false),
  })
  .strict();

export type CustomerInput = z.infer<typeof CustomerInput>;
export type SupplierInput = z.infer<typeof SupplierInput>;
