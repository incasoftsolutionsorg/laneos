-- Reduced stickers for near-expiry stock (Figma 11-3474): queue a "reduced" shelf label with the
-- markdown price. The lane still sells at the list price until markdown pricing comes with M6.

create or replace function api.queue_reduced_label(p_shop uuid, p_item uuid, p_price_cents bigint, p_copies integer default 1)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('item.edit');
  if not app.can_shop(p_shop) or not exists (select 1 from public.items i where i.id = p_item and i.tenant_id = app.tenant_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_price_cents < 0 or p_copies not between 1 and 100 then
    raise exception 'VALIDATION_ERROR: price must be 0 or more and copies 1–100' using errcode = 'P0001';
  end if;
  insert into public.label_queue (tenant_id, shop_id, item_id, reason, copies, old_price_cents)
  values (app.tenant_id(), p_shop, p_item, 'reduced', p_copies, p_price_cents)
  on conflict (shop_id, item_id) where printed_at is null
  do update set reason = 'reduced', copies = excluded.copies, old_price_cents = excluded.old_price_cents;
end $$;

revoke all on function api.queue_reduced_label(uuid, uuid, bigint, integer) from public, anon;
grant execute on function api.queue_reduced_label(uuid, uuid, bigint, integer) to authenticated, service_role;
