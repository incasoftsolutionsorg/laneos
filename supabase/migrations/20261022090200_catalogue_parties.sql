-- Catalogue (tenant level): departments, items, barcodes, price lists, promotions.
-- Parties (tenant level): customers and suppliers.
-- Every catalogue change bumps tenants.catalog_version so lanes can sync deltas (blueprint §21.4).

create table public.departments (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants (id),
  name       text not null check (char_length(name) between 1 and 60),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (tenant_id, name)
);

create table public.items (
  id                  uuid primary key default app.uuid_v7(),
  tenant_id           uuid not null references public.tenants (id),
  department_id       uuid references public.departments (id),
  name                text not null check (char_length(name) between 1 and 120),
  item_type           public.item_type not null default 'standard',
  tax_class           public.tax_class not null default 'standard',
  plu                 integer check (plu between 1 and 99999),
  mrp_cents           bigint check (mrp_cents >= 0),
  cost_cents          bigint check (cost_cents >= 0),
  reorder_level_milli bigint not null default 0 check (reorder_level_milli >= 0),
  track_batches       boolean not null default false,
  is_returnable       boolean not null default true,
  is_pinned           boolean not null default false,  -- shown on the lane "Pinned" tab
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id)
);
create unique index items_tenant_plu on public.items (tenant_id, plu) where plu is not null;
create index items_tenant_dept on public.items (tenant_id, department_id);
create index items_name_trgm on public.items using gin (name extensions.gin_trgm_ops);

create table public.barcodes (
  tenant_id  uuid not null references public.tenants (id),
  code       text not null check (code ~ '^[0-9A-Z-]{1,32}$'),
  item_id    uuid not null references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint barcodes_pkey primary key (tenant_id, code)
);
create index barcodes_item on public.barcodes (item_id);

create table public.price_lists (
  id         uuid primary key default app.uuid_v7(),
  tenant_id  uuid not null references public.tenants (id),
  name       text not null check (char_length(name) between 1 and 60),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create unique index price_lists_one_default on public.price_lists (tenant_id) where is_default;

create table public.price_list_items (
  price_list_id uuid not null references public.price_lists (id) on delete cascade,
  item_id       uuid not null references public.items (id) on delete cascade,
  tenant_id     uuid not null references public.tenants (id),
  price_cents   bigint not null check (price_cents >= 0),
  updated_at    timestamptz not null default now(),
  primary key (price_list_id, item_id)
);
create index price_list_items_item on public.price_list_items (item_id);

create table public.promotions (
  id                 uuid primary key default app.uuid_v7(),
  tenant_id          uuid not null references public.tenants (id),
  name               text not null check (char_length(name) between 1 and 80),
  kind               public.promotion_kind not null,
  buy_qty            integer check (buy_qty between 2 and 100),
  bundle_price_cents bigint check (bundle_price_cents >= 0),
  percent_bp         integer check (percent_bp between 1 and 10000),
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id),
  check (ends_at is null or ends_at > starts_at),
  check (
    (kind = 'multi_buy' and buy_qty is not null and bundle_price_cents is not null and percent_bp is null)
    or (kind = 'percent_off' and percent_bp is not null and buy_qty is null and bundle_price_cents is null)
  )
);

create table public.promotion_items (
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  item_id      uuid not null references public.items (id) on delete cascade,
  tenant_id    uuid not null references public.tenants (id),
  primary key (promotion_id, item_id)
);
create index promotion_items_item on public.promotion_items (item_id);

create table public.customers (
  id                uuid primary key default app.uuid_v7(),
  tenant_id         uuid not null references public.tenants (id),
  name              text not null check (char_length(name) between 1 and 120),
  phone             text not null check (phone ~ '^\+947\d{8}$'),
  email             text check (char_length(email) <= 200),
  credit_limit_cents bigint not null default 0 check (credit_limit_cents >= 0),
  balance_due_cents bigint not null default 0,      -- cached; history lives in the customer ledger (later)
  loyalty_points    integer not null default 0 check (loyalty_points >= 0),
  marketing_consent boolean not null default false,  -- PDPA: SMS marketing only with consent
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id)
);
create unique index customers_tenant_phone on public.customers (tenant_id, phone);
create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);

create table public.suppliers (
  id                 uuid primary key default app.uuid_v7(),
  tenant_id          uuid not null references public.tenants (id),
  name               text not null check (char_length(name) between 1 and 120),
  phone              text check (phone ~ '^\+947\d{8}$'),
  email              text check (char_length(email) <= 200),
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  is_sale_or_return  boolean not null default false,
  balance_due_cents  bigint not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id),
  unique (tenant_id, name)
);

-- Triggers ------------------------------------------------------------------------------------

create trigger departments_touch before update on public.departments for each row execute function app.touch_updated_at();
create trigger items_touch before update on public.items for each row execute function app.touch_updated_at();
create trigger price_lists_touch before update on public.price_lists for each row execute function app.touch_updated_at();
create trigger price_list_items_touch before update on public.price_list_items for each row execute function app.touch_updated_at();
create trigger promotions_touch before update on public.promotions for each row execute function app.touch_updated_at();
create trigger customers_touch before update on public.customers for each row execute function app.touch_updated_at();
create trigger suppliers_touch before update on public.suppliers for each row execute function app.touch_updated_at();
create trigger departments_keys before update on public.departments for each row execute function app.protect_keys();
create trigger items_keys before update on public.items for each row execute function app.protect_keys();
create trigger price_lists_keys before update on public.price_lists for each row execute function app.protect_keys();
create trigger promotions_keys before update on public.promotions for each row execute function app.protect_keys();
create trigger customers_keys before update on public.customers for each row execute function app.protect_keys();
create trigger suppliers_keys before update on public.suppliers for each row execute function app.protect_keys();

create or replace function app.bump_catalog_version()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.tenants set catalog_version = catalog_version + 1
   where id = coalesce(new.tenant_id, old.tenant_id);
  return null;
end $$;

create trigger items_catalog after insert or update or delete on public.items
  for each row execute function app.bump_catalog_version();
create trigger barcodes_catalog after insert or update or delete on public.barcodes
  for each row execute function app.bump_catalog_version();
create trigger price_list_items_catalog after insert or update or delete on public.price_list_items
  for each row execute function app.bump_catalog_version();
create trigger promotions_catalog after insert or update or delete on public.promotions
  for each row execute function app.bump_catalog_version();
create trigger promotion_items_catalog after insert or update or delete on public.promotion_items
  for each row execute function app.bump_catalog_version();

-- BR-011: never sell above MRP.
create or replace function app.check_price_vs_mrp()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mrp bigint;
begin
  select i.mrp_cents into v_mrp from public.items i where i.id = new.item_id;
  if v_mrp is not null and new.price_cents > v_mrp then
    raise exception 'ABOVE_MRP: price % is above MRP %', new.price_cents, v_mrp using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger price_list_items_mrp before insert or update on public.price_list_items
  for each row execute function app.check_price_vs_mrp();

-- Default price list for every tenant, created with the tenant.
create or replace function app.create_default_price_list()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.price_lists (tenant_id, name, is_default) values (new.id, 'Standard', true);
  return new;
end $$;

create trigger tenants_default_price_list after insert on public.tenants
  for each row execute function app.create_default_price_list();

-- RLS -------------------------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.departments force row level security;
create policy departments_read on public.departments for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy departments_write on public.departments for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('item.edit')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_perm('item.edit')));

alter table public.items enable row level security;
alter table public.items force row level security;
create policy items_read on public.items for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy items_update on public.items for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('item.edit')))
  with check (tenant_id = (select app.tenant_id()));

alter table public.barcodes enable row level security;
alter table public.barcodes force row level security;
create policy barcodes_read on public.barcodes for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.price_lists enable row level security;
alter table public.price_lists force row level security;
create policy price_lists_read on public.price_lists for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.price_list_items enable row level security;
alter table public.price_list_items force row level security;
create policy price_list_items_read on public.price_list_items for select to authenticated
  using (tenant_id = (select app.tenant_id()));

alter table public.promotions enable row level security;
alter table public.promotions force row level security;
create policy promotions_read on public.promotions for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy promotions_write on public.promotions for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('promotion.manage')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_perm('promotion.manage')));

alter table public.promotion_items enable row level security;
alter table public.promotion_items force row level security;
create policy promotion_items_read on public.promotion_items for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy promotion_items_write on public.promotion_items for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('promotion.manage')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_perm('promotion.manage')));

alter table public.customers enable row level security;
alter table public.customers force row level security;
create policy customers_read on public.customers for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy customers_insert on public.customers for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.has_perm('customer.manage')));
create policy customers_update on public.customers for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('customer.manage')))
  with check (tenant_id = (select app.tenant_id()));

alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;
create policy suppliers_read on public.suppliers for select to authenticated
  using (tenant_id = (select app.tenant_id()));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (tenant_id = (select app.tenant_id()) and (select app.has_perm('supplier.manage')));
create policy suppliers_update on public.suppliers for update to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_perm('supplier.manage')))
  with check (tenant_id = (select app.tenant_id()));

revoke all on public.departments, public.items, public.barcodes, public.price_lists, public.price_list_items,
  public.promotions, public.promotion_items, public.customers, public.suppliers from anon;
-- Items, barcodes and prices are written together by api.upsert_item so they never disagree.
revoke insert, delete on public.items from authenticated;
revoke insert, update, delete on public.barcodes, public.price_lists, public.price_list_items from authenticated;
-- Customers and suppliers are deactivated, never deleted (their sales and GRNs refer to them).
revoke delete on public.customers, public.suppliers from authenticated;

-- api.upsert_item: item + barcode + price in one transaction ------------------------------------

create or replace function api.upsert_item(p jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_list   uuid;
  v_code   text := nullif(upper(p ->> 'barcode'), '');
begin
  perform app.require_perm('item.edit');

  if v_id is null then
    insert into public.items (tenant_id, department_id, name, item_type, tax_class, plu, mrp_cents, cost_cents,
                              reorder_level_milli, track_batches, is_returnable, is_pinned, created_by)
    values (v_tenant, nullif(p ->> 'departmentId', '')::uuid, p ->> 'name',
            coalesce(p ->> 'itemType', 'standard')::public.item_type,
            coalesce(p ->> 'taxClass', 'standard')::public.tax_class,
            (p ->> 'plu')::integer, (p ->> 'mrpCents')::bigint, (p ->> 'costCents')::bigint,
            coalesce((p ->> 'reorderLevelMilli')::bigint, 0), coalesce((p ->> 'trackBatches')::boolean, false),
            coalesce((p ->> 'isReturnable')::boolean, true), coalesce((p ->> 'isPinned')::boolean, false), auth.uid())
    returning id into v_id;
  else
    update public.items set
      department_id = nullif(p ->> 'departmentId', '')::uuid,
      name = p ->> 'name',
      item_type = coalesce(p ->> 'itemType', 'standard')::public.item_type,
      tax_class = coalesce(p ->> 'taxClass', 'standard')::public.tax_class,
      plu = (p ->> 'plu')::integer,
      mrp_cents = (p ->> 'mrpCents')::bigint,
      cost_cents = (p ->> 'costCents')::bigint,
      reorder_level_milli = coalesce((p ->> 'reorderLevelMilli')::bigint, 0),
      track_batches = coalesce((p ->> 'trackBatches')::boolean, false),
      is_returnable = coalesce((p ->> 'isReturnable')::boolean, true),
      is_pinned = coalesce((p ->> 'isPinned')::boolean, false)
    where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  if v_code is not null then
    insert into public.barcodes (tenant_id, code, item_id) values (v_tenant, v_code, v_id)
    on conflict on constraint barcodes_pkey do update set item_id = excluded.item_id
      where public.barcodes.item_id = excluded.item_id;  -- another item's code is a conflict, not a takeover
    if not exists (select 1 from public.barcodes b where b.tenant_id = v_tenant and b.code = v_code and b.item_id = v_id) then
      raise exception 'DUPLICATE_BARCODE' using errcode = 'P0001';
    end if;
  end if;

  select id into v_list from public.price_lists where tenant_id = v_tenant and is_default;
  insert into public.price_list_items (price_list_id, item_id, tenant_id, price_cents)
  values (v_list, v_id, v_tenant, (p ->> 'priceCents')::bigint)
  on conflict (price_list_id, item_id) do update set price_cents = excluded.price_cents;

  return v_id;
end $$;

revoke all on function api.upsert_item(jsonb) from public, anon;
grant execute on function api.upsert_item(jsonb) to authenticated, service_role;
