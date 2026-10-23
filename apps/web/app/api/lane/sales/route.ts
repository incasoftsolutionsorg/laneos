import { CreateSale } from '@laneos/core';
import { apiError, dbErrorResponse } from '@/lib/server/errors';
import { createClient } from '@/lib/supabase/server';

const MAX_BODY_BYTES = 256 * 1024;

// POST /api/lane/sales (blueprint §23.2): validate strictly, then let api.create_sale re-price
// and write everything in one transaction. The Idempotency-Key header must equal clientUuid.
// X-Lane-Key (the registered device key, blueprint §27.5.1) is checked inside api.create_sale.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return apiError(401, 'UNAUTHENTICATED');

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return apiError(400, 'VALIDATION_ERROR', 'body too large');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'invalid JSON');
  }

  const parsed = CreateSale.safeParse(json);
  if (!parsed.success) return apiError(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  if (req.headers.get('Idempotency-Key') !== parsed.data.clientUuid) {
    return apiError(400, 'VALIDATION_ERROR', 'Idempotency-Key must equal clientUuid');
  }

  const laneKey = req.headers.get('X-Lane-Key');
  const { data, error } = await supabase.schema('api').rpc('create_sale', {
    p: { ...parsed.data, ...(laneKey ? { laneKey } : {}) },
  });
  if (error) return dbErrorResponse(error);
  const result = data as { replayed?: boolean };
  return Response.json(data, { status: result.replayed ? 200 : 201 });
}
