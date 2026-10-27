import { timingSafeEqual } from 'node:crypto';
import { amountToCents, notifySignature, payhereConfig } from '@/lib/payhere';
import { createAdminClient } from '@/lib/supabase/admin';

// PayHere notify_url (WF-008). Public, but nothing happens unless the md5sig matches the merchant secret, the
// merchant id is ours, and the amount equals the invoice (checked again in api.payhere_paid). Always answers 200
// once the signature is valid so PayHere stops retrying; problems are recorded in the audit log.
export async function POST(req: Request) {
  const cfg = payhereConfig();
  if (!cfg) return new Response('PayHere is not configured', { status: 503 });
  const form = await req.formData().catch(() => null);
  if (!form) return new Response('Bad request', { status: 400 });
  const f = (k: string) => String(form.get(k) ?? '');
  const p = { merchantId: f('merchant_id'), orderId: f('order_id'), amount: f('payhere_amount'), currency: f('payhere_currency'), statusCode: f('status_code') };
  const expected = Buffer.from(notifySignature(p, cfg.secret));
  const given = Buffer.from(f('md5sig').toUpperCase());
  if (p.merchantId !== cfg.merchantId || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return new Response('Invalid signature', { status: 401 });
  }
  const cents = amountToCents(p.amount);
  if (p.currency !== 'LKR' || cents == null) return new Response('Unsupported amount', { status: 400 });
  const { data, error } = await createAdminClient().schema('api').rpc('payhere_paid', {
    p_order: p.orderId, p_payment: f('payment_id'), p_amount_cents: cents, p_status: Number(p.statusCode),
  });
  if (error) return new Response('Could not record', { status: 500 });
  return Response.json({ result: data });
}
