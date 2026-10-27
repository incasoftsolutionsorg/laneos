import 'server-only';
import { createHash } from 'node:crypto';

// PayHere (blueprint ADR-0008, WF-008). Checkout and notify signatures are upper-case MD5 hashes built from the
// merchant id, order, amount, currency (and status), and the MD5 of the merchant secret. The secret never leaves
// the server; set PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET in apps/web/.env.local (PAYHERE_SANDBOX=true for tests).

const md5 = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();

/** "5400.00" — PayHere wants two decimals and no grouping. */
export const payhereAmount = (cents: number) => (cents / 100).toFixed(2);

export function payhereConfig() {
  const merchantId = process.env.PAYHERE_MERCHANT_ID;
  const secret = process.env.PAYHERE_MERCHANT_SECRET;
  if (!merchantId || !secret) return null;
  const sandbox = process.env.PAYHERE_SANDBOX === 'true';
  return { merchantId, secret, checkoutUrl: sandbox ? 'https://sandbox.payhere.lk/pay/checkout' : 'https://www.payhere.lk/pay/checkout' };
}

export function checkoutHash(merchantId: string, secret: string, orderId: string, amountCents: number, currency = 'LKR') {
  return md5(merchantId + orderId + payhereAmount(amountCents) + currency + md5(secret));
}

/** md5sig sent with every notify; compare before trusting anything in the request. */
export function notifySignature(p: { merchantId: string; orderId: string; amount: string; currency: string; statusCode: string }, secret: string) {
  return md5(p.merchantId + p.orderId + p.amount + p.currency + p.statusCode + md5(secret));
}

/** "5400.00" → 540000, refusing anything that is not a plain two-decimal amount. */
export function amountToCents(amount: string): number | null {
  return /^\d+\.\d{2}$/.test(amount) ? Math.round(Number(amount) * 100) : null;
}
