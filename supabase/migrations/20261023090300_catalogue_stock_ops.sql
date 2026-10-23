-- Catalogue and stock operations for the back office (Figma 1-1846, 11-4551, 1-4807, 11-3929, 1-1849, 11-3268):
--   item brand / wholesale / minimum price and case barcodes, bulk import, promotions save,
--   shelf-label queue, damage report → approve → decide (blueprint §30.1), stock counts.

-- Items and barcodes ---------------------------------------------------------------------------------

alter table public.items
  add column brand               text check (char_length(brand) <= 60),
  add column wholesale_cents     bigint check (wholesale_cents >= 0),
  add column min_price_cents     bigint check (min_price_cents >= 0);   -- floor for open price and discounts

-- A case barcode sells several units at once (blueprint ITEM_UNIT, simplified): scanning it adds pack_qty.
alter table public.barcodes add column pack_qty integer not null default 1 check (pack_qty between 1 and 1000);

alter table public.tenants
  add column damage_approval_cents bigint not null default 1000000 check (damage_approval_cents >= 0); -- REQ-DMG-005: Rs 10,000

-- Item + barcodes + default price in one transaction (v2: brand, wholesale, minimum, several barcodes).
-- p.barcodes = [{code, packQty}] replaces the item's barcode set; p.barcode (single) still works.
create or replace function api.upsert_item(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_list   uuid;
  v_codes  jsonb;
  v_bc     jsonb;
  v_code   text;
begin
  perform app.require_perm('item.edit');

  if v_id is null then
    insert into public.items (tenant_id, department_id, name, brand, item_type, tax_class, plu, mrp_cents, cost_cents,
                              wholesale_cents, min_price_cents, reorder_level_milli, track_batches, is_returnable,
                              is_pinned, created_by)
    values (v_tenant, nullif(p ->> 'departmentId', '')::uuid, p ->> 'name', nullif(trim(p ->> 'brand'), ''),
            coalesce(p ->> 'itemType', 'standard')::public.item_type,
            coalesce(p ->> 'taxClass', 'standard')::public.tax_class,
            (p ->> 'plu')::integer, (p ->> 'mrpCents')::bigint, (p ->> 'costCents')::bigint,
            (p ->> 'wholesaleCents')::bigint, (p ->> 'minPriceCents')::bigint,
            coalesce((p ->> 'reorderLevelMilli')::bigint, 0), coalesce((p ->> 'trackBatches')::boolean, false),
            coalesce((p ->> 'isReturnable')::boolean, true), coalesce((p ->> 'isPinned')::boolean, false), auth.uid())
    returning id into v_id;
  else
    update public.items set
      department_id = nullif(p ->> 'departmentId', '')::uuid,
      name = p ->> 'name',
      brand = nullif(trim(p ->> 'brand'), ''),
      item_type = coalesce(p ->> 'itemType', 'standard')::public.item_type,
      tax_class = coalesce(p ->> 'taxClass', 'standard')::public.tax_class,
      plu = (p ->> 'plu')::integer,
      mrp_cents = (p ->> 'mrpCents')::bigint,
      cost_cents = (p ->> 'costCents')::bigint,
      wholesale_cents = (p ->> 'wholesaleCents')::bigint,
      min_price_cents = (p ->> 'minPriceCents')::bigint,
      reorder_level_milli = coalesce((p ->> 'reorderLevelMilli')::bigint, 0),
      track_batches = coalesce((p ->> 'trackBatches')::boolean, false),
      is_returnable = coalesce((p ->> 'isReturnable')::boolean, true),
      is_pinned = coalesce((p ->> 'isPinned')::boolean, false)
    where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  v_codes := case
    when jsonb_typeof(p -> 'barcodes') = 'array' then p -> 'barcodes'
    when nullif(p ->> 'barcode', '') is not null then jsonb_build_array(jsonb_build_object('code', p ->> 'barcode', 'packQty', 1))
    else null end;

  if v_codes is not null then
    if jsonb_typeof(p -> 'barcodes') = 'array' then
      delete from public.barcodes b
       where b.tenant_id = v_tenant and b.item_id = v_id
         and upper(b.code) not in (select upper(x ->> 'code') from jsonb_array_elements(v_codes) x);
    end if;
    for v_bc in select x from jsonb_array_elements(v_codes) x loop
      v_code := upper(trim(v_bc ->> 'code'));
      insert into public.barcodes (tenant_id, code, item_id, pack_qty)
      values (v_tenant, v_code, v_id, coalesce((v_bc ->> 'packQty')::integer, 1))
      on conflict on constraint barcodes_pkey do update set pack_qty = excluded.pack_qty
        where public.barcodes.item_id = excluded.item_id;  -- another item's code is a conflict, not a takeover
      if not exists (select 1 from public.barcodes b where b.tenant_id = v_tenant and b.code = v_code and b.item_id = v_id) then
        raise exception 'DUPLICATE_BARCODE: %', v_code using errcode = 'P0001';
      end if;
    end loop;
  end if;

  if (p ->> 'priceCents') is not null then
    select id into v_list from public.price_lists where tenant_id = v_tenant and is_default;
    insert into public.price_list_items (price_list_id, item_id, tenant_id, price_cents)
    values (v_list, v_id, v_tenant, (p ->> 'priceCents')::bigint)
    on conflict (price_list_id, item_id) do update set price_cents = excluded.price_cents
      where public.price_list_items.price_cents is distinct from excluded.price_cents;
  end if;

  return v_id;
end $$;

-- Bulk import (Figma 11-4551). Rows are already shape-checked by the server action; this applies
-- each row in its own savepoint and returns per-row problems instead of failing the whole file.
-- p_rows: [{row, name, category, itemType, taxClass, barcode, plu, priceCents, mrpCents, costCents,
--           reorderLevelMilli, openingStockMilli, isPinned, brand}]
create or replace function api.import_items(p_shop uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant  uuid := app.tenant_id();
  v_row     jsonb;
  v_dept    uuid;
  v_id      uuid;
  v_new     boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_msg     text;
begin
  perform app.require_perm('item.edit');
  if not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'VALIDATION_ERROR: send at most 500 rows per call' using errcode = 'P0001';
  end if;

  for v_row in select x from jsonb_array_elements(p_rows) x loop
    begin
      v_dept := null;
      if nullif(trim(v_row ->> 'category'), '') is not null then
        insert into public.departments (tenant_id, name, created_by) values (v_tenant, trim(v_row ->> 'category'), auth.uid())
        on conflict (tenant_id, name) do nothing;
        select d.id into v_dept from public.departments d where d.tenant_id = v_tenant and d.name = trim(v_row ->> 'category');
      end if;

      -- Match an existing item by barcode, then by PLU; otherwise create it.
      select b.item_id into v_id from public.barcodes b
       where b.tenant_id = v_tenant and b.code = upper(nullif(trim(v_row ->> 'barcode'), ''));
      if v_id is null and (v_row ->> 'plu') is not null then
        select i.id into v_id from public.items i where i.tenant_id = v_tenant and i.plu = (v_row ->> 'plu')::integer;
      end if;
      v_new := v_id is null;

      v_id := api.upsert_item(jsonb_strip_nulls(jsonb_build_object(
        'id', v_id, 'name', v_row ->> 'name', 'brand', v_row ->> 'brand', 'departmentId', v_dept,
        'itemType', coalesce(v_row ->> 'itemType', 'standard'), 'taxClass', coalesce(v_row ->> 'taxClass', 'standard'),
        'plu', v_row -> 'plu', 'barcode', v_row ->> 'barcode', 'priceCents', v_row -> 'priceCents',
        'mrpCents', v_row -> 'mrpCents', 'costCents', v_row -> 'costCents',
        'reorderLevelMilli', v_row -> 'reorderLevelMilli', 'isPinned', v_row -> 'isPinned')));

      if v_new and coalesce((v_row ->> 'openingStockMilli')::bigint, 0) > 0 then
        perform app.post_movement(v_tenant, p_shop, v_id, (v_row ->> 'openingStockMilli')::bigint, 'opening', 'import', null);
      end if;
      if v_new then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
    exception when others then
      v_msg := sqlerrm;
      v_errors := v_errors || jsonb_build_object('row', (v_row ->> 'row')::integer,
        'column', case
          when v_msg like 'DUPLICATE_BARCODE%' or v_msg like '%barcodes%' then 'barcode'
          when v_msg like '%items_tenant_plu%' then 'plu'
          when v_msg like 'ABOVE_MRP%' then 'price'
          else 'row' end,
        'value', case
          when v_msg like 'DUPLICATE_BARCODE%' or v_msg like '%barcodes%' then v_row ->> 'barcode'
          when v_msg like '%items_tenant_plu%' then v_row ->> 'plu'
          when v_msg like 'ABOVE_MRP%' then v_row ->> 'priceCents'
          else v_row ->> 'name' end,
        'problem', case
          when v_msg like 'DUPLICATE_BARCODE%' or v_msg like '%barcodes_pkey%' then 'Barcode already used by another item'
          when v_msg like '%items_tenant_plu%' then 'PLU already used by another item'
          when v_msg like 'ABOVE_MRP%' then 'Price is above the MRP'
          else left(v_msg, 120) end);
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'errors', v_errors);
end $$;

-- Promotions (Figma 1-4807) ------------------------------------------------------------------------------

-- p: {id?, name, kind, buyQty?, bundlePriceCents?, percentBp?, startsAt?, endsAt?, isActive?, itemIds[]}
create or replace function api.save_promotion(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform app.require_perm('promotion.manage');
  if jsonb_array_length(coalesce(p -> 'itemIds', '[]')) = 0 then
    raise exception 'VALIDATION_ERROR: choose at least one item' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.promotions (tenant_id, name, kind, buy_qty, bundle_price_cents, percent_bp, starts_at, ends_at, is_active, created_by)
    values (v_tenant, p ->> 'name', (p ->> 'kind')::public.promotion_kind, (p ->> 'buyQty')::integer,
            (p ->> 'bundlePriceCents')::bigint, (p ->> 'percentBp')::integer,
            coalesce((p ->> 'startsAt')::timestamptz, now()), (p ->> 'endsAt')::timestamptz,
            coalesce((p ->> 'isActive')::boolean, true), auth.uid())
    returning id into v_id;
  else
    update public.promotions set name = p ->> 'name', kind = (p ->> 'kind')::public.promotion_kind,
           buy_qty = (p ->> 'buyQty')::integer, bundle_price_cents = (p ->> 'bundlePriceCents')::bigint,
           percent_bp = (p ->> 'percentBp')::integer, starts_at = coalesce((p ->> 'startsAt')::timestamptz, starts_at),
           ends_at = (p ->> 'endsAt')::timestamptz, is_active = coalesce((p ->> 'isActive')::boolean, is_active)
     where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  delete from public.promotion_items pi
   where pi.promotion_id = v_id
     and pi.item_id not in (select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'itemIds') x);
  insert into public.promotion_items (promotion_id, item_id, tenant_id)
  select v_id, i.id, v_tenant
    from public.items i
   where i.tenant_id = v_tenant and i.id in (select (x #>> '{}')::uuid from jsonb_array_elements(p -> 'itemIds') x)
  on conflict do nothing;
  perform app.audit('promotion.save', 'promotions', v_id, jsonb_build_object('name', p ->> 'name'));
  return v_id;
end $$;

-- Shelf-label queue (Figma 11-3929, WF-007) ----------------------------------------------------------------

create type public.label_reason as enum ('price_changed', 'new_item', 'promotion', 'reduced', 'manual');

create table public.label_queue (
  id              uuid primary key default app.uuid_v7(),
  tenant_id       uuid not null references public.tenants (id),
  shop_id         uuid not null references public.shops (id),
  item_id         uuid not null references public.items (id) on delete cascade,
  reason          public.label_reason not null,
  copies          integer not null default 1 check (copies between 1 and 100),
  old_price_cents bigint,
  created_at      timestamptz not null default now(),
  printed_at      timestamptz,
  printed_by      uuid references public.members (id)
);
create unique index label_queue_open on public.label_queue (shop_id, item_id) where printed_at is null;

alter table public.label_queue enable row level security;
alter table public.label_queue force row level security;
create policy label_queue_read on public.label_queue for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));
revoke all on public.label_queue from anon;
revoke insert, update, delete, truncate on public.label_queue from authenticated;

create or replace function app.queue_label(p_tenant uuid, p_item uuid, p_reason public.label_reason, p_old bigint)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.label_queue (tenant_id, shop_id, item_id, reason, old_price_cents)
  select p_tenant, s.id, p_item, p_reason, p_old from public.shops s where s.tenant_id = p_tenant and s.is_active
  on conflict (shop_id, item_id) where printed_at is null
  do update set reason = excluded.reason, old_price_cents = coalesce(public.label_queue.old_price_cents, excluded.old_price_cents);
$$;

-- Every price change in the default list puts a shelf label in the queue of every shop.
create or replace function app.label_on_price()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.price_lists pl where pl.id = new.price_list_id and pl.is_default) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform app.queue_label(new.tenant_id, new.item_id, 'new_item', null);
  elsif new.price_cents is distinct from old.price_cents then
    perform app.queue_label(new.tenant_id, new.item_id, 'price_changed', old.price_cents);
  end if;
  return null;
end $$;

create trigger price_list_items_labels after insert or update of price_cents on public.price_list_items
  for each row execute function app.label_on_price();

create or replace function app.label_on_promotion()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.queue_label(new.tenant_id, new.item_id, 'promotion', null);
  return null;
end $$;

create trigger promotion_items_labels after insert on public.promotion_items
  for each row execute function app.label_on_promotion();

create or replace function api.queue_labels(p_shop uuid, p_items uuid[])
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform app.require_perm('item.edit');
  if not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.label_queue (tenant_id, shop_id, item_id, reason)
  select i.tenant_id, p_shop, i.id, 'manual' from public.items i
   where i.tenant_id = app.tenant_id() and i.id = any (p_items)
  on conflict (shop_id, item_id) where printed_at is null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function api.update_labels(p_ids uuid[], p_action text, p_copies integer default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('item.edit');
  if p_action = 'printed' then
    update public.label_queue set printed_at = now(), printed_by = app.member_id()
     where id = any (p_ids) and tenant_id = app.tenant_id() and app.can_shop(shop_id) and printed_at is null;
  elsif p_action = 'remove' then
    delete from public.label_queue
     where id = any (p_ids) and tenant_id = app.tenant_id() and app.can_shop(shop_id) and printed_at is null;
  elsif p_action = 'copies' and p_copies between 1 and 100 then
    update public.label_queue set copies = p_copies
     where id = any (p_ids) and tenant_id = app.tenant_id() and app.can_shop(shop_id) and printed_at is null;
  else
    raise exception 'VALIDATION_ERROR: action must be printed, remove or copies (1–100)' using errcode = 'P0001';
  end if;
end $$;

-- Damage: report → (approve) → decide (blueprint §30.1) ------------------------------------------------------

create or replace function api.report_damage(p_shop uuid, p_item uuid, p_qty_milli bigint, p_reason text, p_source text default 'shelf', p_note text default null)
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
  select t.damage_approval_cents into v_limit from public.tenants t where t.id = v_tenant;
  v_value := app.div_round(coalesce(v_item.cost_cents, 0) * p_qty_milli, 1000);
  v_status := case when v_value > v_limit then 'awaiting_approval' else 'awaiting_decision' end;
  v_no := app.next_doc_no(p_shop, 'DMG');

  insert into public.damage_reports (tenant_id, shop_id, report_no, item_id, qty_milli, remaining_milli, unit_cost_cents,
                                     source, reason, note, status, reported_by)
  values (v_tenant, p_shop, v_no, p_item, p_qty_milli, p_qty_milli, coalesce(v_item.cost_cents, 0),
          p_source::public.damage_source, p_reason::public.damage_reason, p_note, v_status, app.member_id())
  returning id into v_id;

  -- Sellable → damaged (REQ-DMG-001): the ledger records the sellable side.
  perform app.post_movement(v_tenant, p_shop, p_item, -p_qty_milli, 'damage', 'damage_report', v_id, v_no);
  update public.stock_levels set damaged_milli = damaged_milli + p_qty_milli, updated_at = now()
   where shop_id = p_shop and item_id = p_item;

  return jsonb_build_object('id', v_id, 'reportNo', v_no, 'status', v_status, 'valueCents', v_value);
end $$;

create or replace function api.approve_damage(p_report uuid, p_approve boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_r public.damage_reports;
begin
  perform app.require_perm('stock.adjust');
  select * into v_r from public.damage_reports d where d.id = p_report and d.tenant_id = app.tenant_id() for update;
  if v_r.id is null or not app.can_shop(v_r.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status <> 'awaiting_approval' then
    raise exception 'VALIDATION_ERROR: this report is not waiting for approval' using errcode = 'P0001';
  end if;
  if v_r.reported_by = app.member_id() then
    raise exception 'FORBIDDEN: a different person must approve (REQ-DMG-005)' using errcode = 'P0001';
  end if;
  if p_approve then
    update public.damage_reports set status = 'awaiting_decision', approved_by = app.member_id() where id = p_report;
  else
    -- Not damaged after all: back to sellable.
    update public.damage_reports set status = 'rejected', approved_by = app.member_id(), remaining_milli = 0 where id = p_report;
    update public.stock_levels set damaged_milli = damaged_milli - v_r.remaining_milli, updated_at = now()
     where shop_id = v_r.shop_id and item_id = v_r.item_id;
    perform app.post_movement(v_r.tenant_id, v_r.shop_id, v_r.item_id, v_r.remaining_milli, 'adjustment', 'damage_report', p_report, 'rejected');
  end if;
  perform app.audit(case when p_approve then 'damage.approve' else 'damage.reject' end, 'damage_reports', p_report);
end $$;

create or replace function api.decide_damage(p_report uuid, p_decision text, p_qty_milli bigint, p_markdown_cents bigint default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_r      public.damage_reports;
  v_left   bigint;
  v_status public.damage_status;
begin
  perform app.require_perm('stock.adjust');
  select * into v_r from public.damage_reports d where d.id = p_report and d.tenant_id = app.tenant_id() for update;
  if v_r.id is null or not app.can_shop(v_r.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status not in ('reported', 'awaiting_decision') then
    raise exception 'VALIDATION_ERROR: this report is not waiting for a decision' using errcode = 'P0001';
  end if;
  if p_qty_milli <= 0 or p_qty_milli > v_r.remaining_milli then
    raise exception 'VALIDATION_ERROR: quantity must be between 1 and what is left on the report' using errcode = 'P0001';
  end if;
  if p_decision = 'reduced_sale' and p_markdown_cents is null then
    raise exception 'VALIDATION_ERROR: enter the reduced price' using errcode = 'P0001';
  end if;

  insert into public.damage_decisions (tenant_id, damage_report_id, decision, qty_milli, markdown_price_cents, decided_by)
  values (v_r.tenant_id, p_report, p_decision::public.damage_decision, p_qty_milli, p_markdown_cents, app.member_id());

  update public.stock_levels set damaged_milli = damaged_milli - p_qty_milli, updated_at = now()
   where shop_id = v_r.shop_id and item_id = v_r.item_id;
  if p_decision = 'reduced_sale' then
    -- Back on the shelf (with reduced stickers); the ledger records it returning to sellable.
    perform app.post_movement(v_r.tenant_id, v_r.shop_id, v_r.item_id, p_qty_milli, 'adjustment', 'damage_report', p_report, 'reduced sale');
    insert into public.label_queue (tenant_id, shop_id, item_id, reason, copies, old_price_cents)
    values (v_r.tenant_id, v_r.shop_id, v_r.item_id, 'reduced', least(100, greatest(1, (p_qty_milli / 1000)::integer)), p_markdown_cents)
    on conflict (shop_id, item_id) where printed_at is null do update set reason = 'reduced';
  end if;

  v_left := v_r.remaining_milli - p_qty_milli;
  v_status := case
    when v_left > 0 then 'awaiting_decision'
    when p_decision = 'supplier_return' then 'sent_to_supplier'
    when p_decision = 'reduced_sale' then 'reduced_for_sale'
    when p_decision = 'write_off' then 'written_off'
    else 'used_in_store' end;
  update public.damage_reports set remaining_milli = v_left, status = v_status where id = p_report;
  perform app.audit('damage.decide', 'damage_reports', p_report,
    jsonb_build_object('decision', p_decision, 'qty', p_qty_milli, 'markdown', p_markdown_cents));
end $$;

-- Stock counts (Figma 11-3268) ----------------------------------------------------------------------------

create type public.count_status as enum ('counting', 'submitted', 'posted', 'cancelled');

create table public.stock_counts (
  id            uuid primary key default app.uuid_v7(),
  tenant_id     uuid not null references public.tenants (id),
  shop_id       uuid not null references public.shops (id),
  count_no      text not null,
  name          text not null check (char_length(name) between 1 and 80),   -- the section, e.g. "Dairy · Aisle 3"
  department_id uuid references public.departments (id),
  status        public.count_status not null default 'counting',
  created_by    uuid not null references public.members (id),
  created_at    timestamptz not null default now(),
  submitted_by  uuid references public.members (id),
  submitted_at  timestamptz,
  posted_by     uuid references public.members (id),
  posted_at     timestamptz,
  unique (shop_id, count_no)
);
create index stock_counts_shop on public.stock_counts (shop_id, created_at desc);

create table public.stock_count_lines (
  id            uuid primary key default app.uuid_v7(),
  count_id      uuid not null references public.stock_counts (id) on delete cascade,
  tenant_id     uuid not null references public.tenants (id),
  shop_id       uuid not null references public.shops (id),
  item_id       uuid not null references public.items (id),
  system_milli  bigint not null,               -- snapshot when the count started ("frozen for count")
  counted_milli bigint check (counted_milli >= 0),
  counted_by    uuid references public.members (id),
  counted_at    timestamptz,
  unique (count_id, item_id)
);

alter table public.stock_counts enable row level security;
alter table public.stock_counts force row level security;
create policy stock_counts_read on public.stock_counts for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));
alter table public.stock_count_lines enable row level security;
alter table public.stock_count_lines force row level security;
create policy stock_count_lines_read on public.stock_count_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.can_shop(shop_id)));
revoke all on public.stock_counts, public.stock_count_lines from anon;
revoke insert, update, delete, truncate on public.stock_counts, public.stock_count_lines from authenticated;

create or replace function api.start_count(p_shop uuid, p_name text, p_department uuid default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid;
begin
  perform app.require_perm('stock.adjust');
  if not app.can_shop(p_shop) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into public.stock_counts (tenant_id, shop_id, count_no, name, department_id, created_by)
  values (v_tenant, p_shop, app.next_doc_no(p_shop, 'CNT'), p_name, p_department, app.member_id())
  returning id into v_id;
  insert into public.stock_count_lines (count_id, tenant_id, shop_id, item_id, system_milli)
  select v_id, v_tenant, p_shop, i.id, coalesce(sl.qty_milli, 0)
    from public.items i
    left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = p_shop
   where i.tenant_id = v_tenant and i.is_active and i.item_type <> 'open_price'
     and (p_department is null or i.department_id = p_department);
  return v_id;
end $$;

create or replace function api.record_count(p_line uuid, p_counted_milli bigint)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform app.require_perm('stock.adjust');
  update public.stock_count_lines l
     set counted_milli = p_counted_milli, counted_by = app.member_id(), counted_at = now()
   where l.id = p_line and l.tenant_id = app.tenant_id() and app.can_shop(l.shop_id)
     and exists (select 1 from public.stock_counts c where c.id = l.count_id and c.status = 'counting');
  if not found then
    raise exception 'NOT_FOUND: line, or the count is no longer open' using errcode = 'P0001';
  end if;
end $$;

-- p_action: submit (counter) | post (manager: shift.manage) | cancel | reopen
create or replace function api.count_action(p_count uuid, p_action text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c    public.stock_counts;
  v_line record;
begin
  perform app.require_perm('stock.adjust');
  select * into v_c from public.stock_counts c where c.id = p_count and c.tenant_id = app.tenant_id() for update;
  if v_c.id is null or not app.can_shop(v_c.shop_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_action = 'submit' and v_c.status = 'counting' then
    update public.stock_counts set status = 'submitted', submitted_by = app.member_id(), submitted_at = now() where id = p_count;
  elsif p_action = 'reopen' and v_c.status = 'submitted' then
    update public.stock_counts set status = 'counting', submitted_by = null, submitted_at = null where id = p_count;
  elsif p_action = 'cancel' and v_c.status in ('counting', 'submitted') then
    update public.stock_counts set status = 'cancelled' where id = p_count;
  elsif p_action = 'post' and v_c.status = 'submitted' then
    perform app.require_perm('shift.manage');   -- variances need a manager to post
    for v_line in
      select l.item_id, l.counted_milli - l.system_milli as diff from public.stock_count_lines l
       where l.count_id = p_count and l.counted_milli is not null and l.counted_milli <> l.system_milli
       order by l.item_id
    loop
      perform app.post_movement(v_c.tenant_id, v_c.shop_id, v_line.item_id, v_line.diff, 'count', 'stock_count', p_count, v_c.count_no);
    end loop;
    update public.stock_counts set status = 'posted', posted_by = app.member_id(), posted_at = now() where id = p_count;
    perform app.audit('count.post', 'stock_counts', p_count);
  else
    raise exception 'VALIDATION_ERROR: cannot % a count that is %', p_action, v_c.status using errcode = 'P0001';
  end if;
end $$;

-- Lane catalogue v3: case barcodes carry their pack quantity --------------------------------------------------

create or replace function api.lane_catalog(p_lane uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_lane   record;
  v_tenant public.tenants;
  v_shift  public.shifts;
begin
  select l.id, l.tenant_id, l.shop_id, l.code, l.name, l.status, l.registered_at, l.active_member_id
    into v_lane from public.lanes l where l.id = p_lane;
  if v_lane.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_tenant from public.tenants t where t.id = v_lane.tenant_id;
  select * into v_shift from public.shifts s where s.lane_id = v_lane.id and s.status = 'open';

  return jsonb_build_object(
    'lane', jsonb_build_object('id', v_lane.id, 'code', v_lane.code, 'name', v_lane.name, 'status', v_lane.status,
                               'registered', v_lane.registered_at is not null),
    'activeMember', (select jsonb_build_object('id', m.id, 'name', m.display_name)
                       from public.members m where m.id = v_lane.active_member_id),
    'shop', (select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) from public.shops s where s.id = v_lane.shop_id),
    'tenant', jsonb_build_object('name', v_tenant.name, 'roundingUnitCents', v_tenant.rounding_unit_cents,
                                 'embeddedBarcodeMode', v_tenant.embedded_barcode_mode,
                                 'catalogVersion', v_tenant.catalog_version),
    'shift', case when v_shift.id is null then null else jsonb_build_object(
               'id', v_shift.id, 'shiftNo', v_shift.shift_no, 'openedAt', v_shift.opened_at,
               'cashier', (select m.display_name from public.members m where m.id = v_shift.opened_by),
               'reservedFrom', v_shift.reserved_from, 'reservedTo', v_shift.reserved_to,
               'nextReserved', case when v_shift.reserved_from is null then null else greatest(v_shift.reserved_from,
                  coalesce((select max(right(s.invoice_no, 6)::bigint) + 1 from public.sales s
                             where s.shift_id = v_shift.id
                               and right(s.invoice_no, 6)::bigint between v_shift.reserved_from and v_shift.reserved_to), 0)) end)
             end,
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.sort_order, d.name), '[]')
                      from public.departments d where d.tenant_id = v_lane.tenant_id and d.is_active),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id, 'name', i.name, 'itemType', i.item_type, 'plu', i.plu, 'departmentId', i.department_id,
                'priceCents', pli.price_cents, 'mrpCents', i.mrp_cents, 'isPinned', i.is_pinned, 'taxClass', i.tax_class,
                'isReturnable', i.is_returnable, 'stockMilli', coalesce(sl.qty_milli, 0),
                'barcodes', (select coalesce(jsonb_agg(b.code), '[]') from public.barcodes b where b.item_id = i.id and b.pack_qty = 1),
                'packBarcodes', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'qty', b.pack_qty)), '[]')
                                   from public.barcodes b where b.item_id = i.id and b.pack_qty > 1))
                order by i.name), '[]')
                from public.items i
                join public.price_lists pl on pl.tenant_id = i.tenant_id and pl.is_default
                left join public.price_list_items pli on pli.price_list_id = pl.id and pli.item_id = i.id
                left join public.stock_levels sl on sl.item_id = i.id and sl.shop_id = v_lane.shop_id
               where i.tenant_id = v_lane.tenant_id and i.is_active),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', pr.id, 'name', pr.name, 'kind', pr.kind, 'buyQty', pr.buy_qty,
                     'bundlePriceCents', pr.bundle_price_cents, 'percentBp', pr.percent_bp, 'endsAt', pr.ends_at,
                     'itemIds', (select coalesce(jsonb_agg(pi.item_id), '[]') from public.promotion_items pi where pi.promotion_id = pr.id))), '[]')
                     from public.promotions pr
                    where pr.tenant_id = v_lane.tenant_id and pr.is_active and pr.starts_at <= now()
                      and (pr.ends_at is null or pr.ends_at > now()))
  );
end $$;

-- Grants --------------------------------------------------------------------------------------------------

revoke all on function api.upsert_item(jsonb), api.import_items(uuid, jsonb), api.save_promotion(jsonb),
  api.queue_labels(uuid, uuid[]), api.update_labels(uuid[], text, integer),
  api.report_damage(uuid, uuid, bigint, text, text, text), api.approve_damage(uuid, boolean),
  api.decide_damage(uuid, text, bigint, bigint), api.start_count(uuid, text, uuid), api.record_count(uuid, bigint),
  api.count_action(uuid, text), api.lane_catalog(uuid)
  from public, anon;
grant execute on function api.upsert_item(jsonb), api.import_items(uuid, jsonb), api.save_promotion(jsonb),
  api.queue_labels(uuid, uuid[]), api.update_labels(uuid[], text, integer),
  api.report_damage(uuid, uuid, bigint, text, text, text), api.approve_damage(uuid, boolean),
  api.decide_damage(uuid, text, bigint, bigint), api.start_count(uuid, text, uuid), api.record_count(uuid, bigint),
  api.count_action(uuid, text), api.lane_catalog(uuid)
  to authenticated, service_role;
grant execute on function app.queue_label(uuid, uuid, public.label_reason, bigint), app.label_on_price(), app.label_on_promotion()
  to service_role;
