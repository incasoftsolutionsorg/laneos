import { z } from 'zod';
import { ITEM_TYPES } from '../qty';
import { barcode, cents, uuid } from './common';

export const TAX_CLASSES = ['standard', 'exempt', 'zero'] as const;

/** A barcode on an item; packQty > 1 is a case barcode that sells several units at once. */
export const BarcodeInput = z.object({ code: barcode, packQty: z.number().int().min(1).max(1000).default(1) }).strict();

export const ItemInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(60).nullable().optional(),
    departmentId: uuid.nullable().optional(),
    itemType: z.enum(ITEM_TYPES).default('standard'),
    taxClass: z.enum(TAX_CLASSES).default('standard'),
    plu: z.number().int().min(1).max(99999).nullable().optional(),
    /** Single barcode (simple form and CSV import). */
    barcode: barcode.nullable().optional(),
    /** Full barcode set (item form): replaces the item's barcodes. */
    barcodes: z.array(BarcodeInput).max(20).optional(),
    priceCents: cents,
    mrpCents: cents.nullable().optional(),
    costCents: cents.nullable().optional(),
    wholesaleCents: cents.nullable().optional(),
    minPriceCents: cents.nullable().optional(),
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
  .refine((v) => v.minPriceCents == null || v.minPriceCents <= v.priceCents, {
    message: 'Minimum price cannot be above the selling price',
    path: ['minPriceCents'],
  })
  .refine((v) => v.itemType !== 'weighed' || v.plu != null, {
    message: 'Weighed items need a PLU for scale labels',
    path: ['plu'],
  })
  .refine((v) => !v.barcodes || new Set(v.barcodes.map((b) => b.code)).size === v.barcodes.length, {
    message: 'The same barcode is listed twice',
    path: ['barcodes'],
  });

export type ItemInput = z.infer<typeof ItemInput>;
