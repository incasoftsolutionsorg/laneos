import { describe, expect, it } from 'vitest';
import { mapDbError } from '../src/errors';
import { CreateSale, ItemInput, normalizeLkPhone } from '../src/schemas';

const uuid = '0192f0c4-7a1e-7c3b-9a2d-1f2e3d4c5b6a';

describe('mapDbError', () => {
  it('maps P0001 business codes', () => {
    expect(mapDbError({ code: 'P0001', message: 'PRICE_MISMATCH: server total 426800' })).toEqual({
      status: 409, code: 'PRICE_MISMATCH', message: 'server total 426800',
    });
    expect(mapDbError({ code: 'P0001', message: 'SHIFT_NOT_OPEN' }).code).toBe('SHIFT_NOT_OPEN');
  });
  it('maps unique violations by constraint name', () => {
    expect(mapDbError({ code: '23505', message: 'duplicate key value violates unique constraint "barcodes_pkey"' }).code).toBe('DUPLICATE_BARCODE');
    expect(mapDbError({ code: '23505', message: 'x', details: 'customers_tenant_phone' }).code).toBe('DUPLICATE_PHONE');
  });
  it('never leaks unknown errors', () => {
    expect(mapDbError({ code: 'XX000', message: 'relation "secret" does not exist' })).toEqual({ status: 500, code: 'INTERNAL' });
    expect(mapDbError({ code: 'P0001', message: 'something custom' }).code).toBe('INTERNAL');
  });
  it('maps lock and serialization failures to a retry', () => {
    expect(mapDbError({ code: '40001' })).toEqual({ status: 503, code: 'BUSY_RETRY' });
  });
});

describe('ItemInput', () => {
  const base = { name: 'Samba Rice 5kg', priceCents: 123000 };
  it('accepts a minimal item and fills defaults', () => {
    const v = ItemInput.parse(base);
    expect(v.itemType).toBe('standard');
    expect(v.isReturnable).toBe(true);
  });
  it('rejects a price above MRP (BR-011)', () => {
    expect(ItemInput.safeParse({ ...base, mrpCents: 120000 }).success).toBe(false);
  });
  it('requires a PLU for weighed items', () => {
    expect(ItemInput.safeParse({ ...base, itemType: 'weighed' }).success).toBe(false);
    expect(ItemInput.safeParse({ ...base, itemType: 'weighed', plu: 1234 }).success).toBe(true);
  });
  it('rejects unknown fields', () => {
    expect(ItemInput.safeParse({ ...base, tenantId: uuid }).success).toBe(false);
  });
});

describe('CreateSale', () => {
  const sale = {
    clientUuid: uuid, laneId: uuid, lines: [{ itemId: uuid, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amountCents: 50000 }], expectedTotalCents: 12300,
  };
  it('accepts a valid sale', () => {
    expect(CreateSale.safeParse(sale).success).toBe(true);
  });
  it('rejects client-computed totals and prices (PRN-002)', () => {
    expect(CreateSale.safeParse({ ...sale, totalCents: 1 }).success).toBe(false);
    expect(CreateSale.safeParse({ ...sale, lines: [{ itemId: uuid, qtyMilli: 1000, unitPriceCents: 1 }] }).success).toBe(false);
  });
  it('limits basket size and payments (blueprint §24)', () => {
    expect(CreateSale.safeParse({ ...sale, lines: Array(301).fill(sale.lines[0]) }).success).toBe(false);
    expect(CreateSale.safeParse({ ...sale, payments: Array(7).fill(sale.payments[0]) }).success).toBe(false);
    expect(CreateSale.safeParse({ ...sale, lines: [] }).success).toBe(false);
  });
});

describe('normalizeLkPhone', () => {
  it.each(['0771234567', '771234567', '94771234567', '+94 77 123 4567', '077-123-4567'])('%s', (input) => {
    expect(normalizeLkPhone(input)).toBe('+94771234567');
  });
  it('rejects landlines and junk', () => {
    expect(normalizeLkPhone('0812345678')).toBeNull();
    expect(normalizeLkPhone('12345')).toBeNull();
  });
});
