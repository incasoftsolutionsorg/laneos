// Storage against staging (migration 20261027090100): tenant folders, logo and item photo paths, damage photo rule.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let owner: SupabaseClient;
let api: ReturnType<SupabaseClient['schema']>;
let tenantId: string;
let shopId: string;
let itemId: string;
const uploaded: { bucket: string; path: string }[] = [];

beforeAll(async () => {
  owner = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await owner.auth.signInWithPassword({ email: process.env.DEMO_OWNER_EMAIL!, password: process.env.DEMO_OWNER_PASSWORD! });
  if (error) throw error;
  api = owner.schema('api');
  const { data } = await owner.from('shops').select('id, tenant_id').eq('code', 'KDY1').single();
  tenantId = data!.tenant_id;
  shopId = data!.id;
  const up = await api.rpc('upsert_item', { p: { name: `ZZ Test Photo ${randomUUID().slice(0, 4)}`, priceCents: 100000, costCents: 2_000_000 } });
  if (up.error) throw up.error;
  itemId = up.data as string;
  await api.rpc('adjust_stock', { p_shop: shopId, p_item: itemId, p_qty_milli: 10_000, p_reason: 'opening' });
}, 60_000);

afterAll(async () => {
  for (const u of uploaded) await owner.storage.from(u.bucket).remove([u.path]);
  await owner.from('items').update({ is_active: false }).eq('id', itemId);
});

describe('tenant folders', () => {
  it('uploads to its own folder and not to another tenant\'s', async () => {
    const mine = `${tenantId}/items/${itemId}-test.png`;
    const ok = await owner.storage.from('tenant-public').upload(mine, PNG, { contentType: 'image/png', upsert: true });
    expect(ok.error).toBeNull();
    uploaded.push({ bucket: 'tenant-public', path: mine });
    expect((await api.rpc('set_item_image', { p_item: itemId, p_path: mine })).error).toBeNull();
    const res = await fetch(`${url}/storage/v1/object/public/tenant-public/${mine}`);
    expect(res.status).toBe(200);

    const other = `${randomUUID()}/items/x.png`;
    expect((await owner.storage.from('tenant-public').upload(other, PNG, { contentType: 'image/png' })).error).not.toBeNull();
    expect((await api.rpc('set_item_image', { p_item: itemId, p_path: other })).error?.message).toMatch(/FORBIDDEN/);
  });

  it('refuses files that are not images', async () => {
    const r = await owner.storage.from('tenant-public').upload(`${tenantId}/items/x.txt`, Buffer.from('hi'), { contentType: 'text/plain' });
    expect(r.error).not.toBeNull();
  });
});

describe('damage photo rule', () => {
  it('a report above the approval limit needs a photo; with one it is accepted', async () => {
    // 1 piece at Rs 20,000 cost is above the default Rs 10,000 limit.
    const without = await api.rpc('report_damage', { p_shop: shopId, p_item: itemId, p_qty_milli: 1000, p_reason: 'broken', p_source: 'shelf', p_note: null, p_photo: null });
    expect(without.error?.message).toMatch(/needs one/);
    const path = `${tenantId}/damage/test-${randomUUID()}.png`;
    expect((await owner.storage.from('tenant-private').upload(path, PNG, { contentType: 'image/png' })).error).toBeNull();
    uploaded.push({ bucket: 'tenant-private', path });
    const withPhoto = await api.rpc('report_damage', { p_shop: shopId, p_item: itemId, p_qty_milli: 1000, p_reason: 'broken', p_source: 'shelf', p_note: null, p_photo: path });
    expect(withPhoto.error).toBeNull();
    expect((withPhoto.data as { status: string }).status).toBe('awaiting_approval');
    const signed = await owner.storage.from('tenant-private').createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
  });
});
