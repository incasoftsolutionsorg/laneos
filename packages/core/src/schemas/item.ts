import { z } from 'zod';
import { ITEM_TYPES } from '../qty';
import { barcode, cents, uuid } from './common';

export const TAX_CLASSES = ['standard', 'exempt', 'zero'] as const;

export const ItemInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    departmentId: uuid.nullable().optional(),
    itemType: z.enum(ITEM_TYPES).default('standard'),
    taxClass: z.enum(TAX_CLASSES).default('standard'),
    plu: z.number().int().min(1).max(99999).nullable().optional(),
    barcode: barcode.nullable().optional(),
    priceCents: cents,
    mrpCents: cents.nullable().optional(),
    costCents: cents.nullable().optional(),
    reorderLevelMilli: z.number().int().min(0).default(0),
    isReturnable: z.boolean().default(true),
    trackBatches: z.boolean().default(false),
    isPinned: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.mrpCents == null || v.priceCents <= v.mrpCents, {
    message: 'Price cannot be above the MRP',
    path: ['priceCents'],
  })
  .refine((v) => v.itemType !== 'weighed' || v.plu != null, {
    message: 'Weighed items need a PLU for scale labels',
    path: ['plu'],
  });

export type ItemInput = z.infer<typeof ItemInput>;
