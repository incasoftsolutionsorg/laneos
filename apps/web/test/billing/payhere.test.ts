import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { amountToCents, checkoutHash, notifySignature, payhereAmount } = await import('../../lib/payhere');

const md5 = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();

describe('PayHere signatures (WF-008)', () => {
  it('formats amounts the way PayHere signs them', () => {
    expect(payhereAmount(540000)).toBe('5400.00');
    expect(payhereAmount(5)).toBe('0.05');
  });

  it('builds the checkout hash from merchant, order, amount, currency and the hashed secret', () => {
    expect(checkoutHash('1211149', 'secret', 'INV-2611-001', 540000)).toBe(md5('1211149' + 'INV-2611-001' + '5400.00' + 'LKR' + md5('secret')));
  });

  it('verifies a notify signature and rejects a changed status or amount', () => {
    const base = { merchantId: '1211149', orderId: 'INV-2611-001', amount: '5400.00', currency: 'LKR', statusCode: '2' };
    const sig = notifySignature(base, 'secret');
    expect(sig).toBe(md5('1211149INV-2611-0015400.00LKR2' + md5('secret')));
    expect(notifySignature({ ...base, statusCode: '0' }, 'secret')).not.toBe(sig);
    expect(notifySignature({ ...base, amount: '1.00' }, 'secret')).not.toBe(sig);
    expect(notifySignature(base, 'other')).not.toBe(sig);
  });

  it('only accepts plain two-decimal amounts', () => {
    expect(amountToCents('5400.00')).toBe(540000);
    expect(amountToCents('5,400.00')).toBeNull();
    expect(amountToCents('5400')).toBeNull();
  });
});
