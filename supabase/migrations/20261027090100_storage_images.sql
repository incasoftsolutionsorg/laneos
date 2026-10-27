-- File storage (blueprint §10 "Storage: logos · images · imports", THR-015):
--   tenant-public  — shop logos and item photos (public read; shown on receipts, lanes, customer display)
--   tenant-private — damage photos (read only by the business)
-- Every object lives under "<tenant_id>/…"; policies let members write only their own tenant's folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-public', 'tenant-public', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
       ('tenant-private', 'tenant-private', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Logos: settings.manage under <tenant>/logo*; item photos: item.edit under <tenant>/items/; damage photos: stock.adjust under <tenant>/damage/.
create or replace function app.storage_can_write(p_bucket text, p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = app.tenant_id()::text
     and case
           when p_bucket = 'tenant-public' and (storage.foldername(p_name))[2] = 'items' then app.has_perm('item.edit')
           when p_bucket = 'tenant-public' and array_length(storage.foldername(p_name), 1) = 1 and storage.filename(p_name) like 'logo%' then app.has_perm('settings.manage')
           when p_bucket = 'tenant-private' and (storage.foldername(p_name))[2] = 'damage' then app.has_perm('stock.adjust')
           else false
         end;
$$;
grant execute on function app.storage_can_write(text, text) to authenticated;

create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('tenant-public', 'tenant-private') and app.storage_can_write(bucket_id, name));
create policy tenant_files_update on storage.objects for update to authenticated
  using (bucket_id in ('tenant-public', 'tenant-private') and app.storage_can_write(bucket_id, name))
  with check (bucket_id in ('tenant-public', 'tenant-private') and app.storage_can_write(bucket_id, name));
create policy tenant_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('tenant-public', 'tenant-private') and app.storage_can_write(bucket_id, name));
-- Private files: any member of the business may view (damage review needs the photo).
create policy tenant_private_read on storage.objects for select to authenticated
  using (bucket_id = 'tenant-private' and (storage.foldername(name))[1] = app.tenant_id()::text);

alter table public.tenants add column logo_path text check (logo_path ~ '^[0-9a-f-]{36}/logo[^/]*$');
alter table public.items add column image_path text check (image_path ~ '^[0-9a-f-]{36}/items/[^/]+$');

-- Logo is set through the settings whitelist; item photo through its own call (items are not updatable directly
-- for this column's owner rules to be checked).
create or replace function api.set_logo(p_path text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('settings.manage');
  if p_path is not null and split_part(p_path, '/', 1) <> app.tenant_id()::text then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.tenants set logo_path = p_path, updated_at = now() where id = app.tenant_id();
  perform app.audit('settings.logo', 'tenants', app.tenant_id(), jsonb_build_object('path', p_path));
end $$;

create or replace function api.set_item_image(p_item uuid, p_path text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('item.edit');
  if p_path is not null and split_part(p_path, '/', 1) <> app.tenant_id()::text then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  update public.items set image_path = p_path, updated_at = now() where id = p_item and tenant_id = app.tenant_id();
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

-- api.report_damage v2: an optional photo (path in tenant-private), required when the value is above the tenant's
-- approval limit (THR-015 "photo required"). Same behaviour otherwise.
drop function if exists api.report_damage(uuid, uuid, bigint, text, text, text);
create or replace function api.report_damage(p_shop uuid, p_item uuid, p_qty_milli bigint, p_reason text, p_source text default 'shelf',
                                             p_note text default null, p_photo text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_item   public.items;
  v_limit  bigint;
  v_value  bigint;
  v_no     text;
  v_id     uuid;
  v_status public.damage_status;
begin
  perform app.require_perm('stock.adjust');
  select * into v_item from public.items i where i.id = p_item and i.tenant_id = v_tenant;
  if v_item.id is null or not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_qty_milli <= 0 then
    raise exception 'VALIDATION_ERROR: quantity must be positive' using errcode = 'P0001';
  end if;
  if p_photo is not null and (split_part(p_photo, '/', 1) <> v_tenant::text or split_part(p_photo, '/', 2) <> 'damage') then
    raise exception 'FORBIDDEN: photo path' using errcode = 'P0001';
  end if;
  select t.damage_approval_cents into v_limit from public.tenants t where t.id = v_tenant;
  v_value := app.div_round(coalesce(v_item.cost_cents, 0) * p_qty_milli, 1000);
  if v_value > v_limit and p_photo is null then
    raise exception 'VALIDATION_ERROR: add a photo — damage above the approval limit needs one' using errcode = 'P0001';
  end if;
  v_status := case when v_value > v_limit then 'awaiting_approval' else 'awaiting_decision' end;
  v_no := app.next_doc_no(p_shop, 'DMG');

  insert into public.damage_reports (tenant_id, shop_id, report_no, item_id, qty_milli, remaining_milli, unit_cost_cents,
                                     source, reason, note, photo_path, status, reported_by)
  values (v_tenant, p_shop, v_no, p_item, p_qty_milli, p_qty_milli, coalesce(v_item.cost_cents, 0),
          p_source::public.damage_source, p_reason::public.damage_reason, p_note, p_photo, v_status, app.member_id())
  returning id into v_id;

  perform app.post_movement(v_tenant, p_shop, p_item, -p_qty_milli, 'damage', 'damage_report', v_id, v_no);
  update public.stock_levels set damaged_milli = damaged_milli + p_qty_milli, updated_at = now()
   where shop_id = p_shop and item_id = p_item;

  return jsonb_build_object('id', v_id, 'reportNo', v_no, 'status', v_status, 'valueCents', v_value);
end $$;

revoke all on function api.set_logo(text), api.set_item_image(uuid, text), api.report_damage(uuid, uuid, bigint, text, text, text, text) from public, anon;
grant execute on function api.set_logo(text), api.set_item_image(uuid, text), api.report_damage(uuid, uuid, bigint, text, text, text, text)
  to authenticated, service_role;
