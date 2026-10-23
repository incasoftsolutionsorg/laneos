-- Billing fixes:
--   * api.admin_generate_invoices numbered every eligible tenant, so a second run in the same month could reuse an
--     invoice number already taken; now only tenants without an invoice for the period are numbered, after the last one.
--   * A suspended or cancelled tenant cannot record sales or wholesale invoices (blueprint §27.7 suspension).

create or replace function api.admin_generate_invoices(p_period date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_base  integer;
  v_n     integer;
begin
  perform app.require_platform_admin();
  select count(*) into v_base from public.saas_invoices i where i.period_start = v_start;
  insert into public.saas_invoices (tenant_id, invoice_no, plan_id, period_start, period_end, amount_cents, due_on)
  select t.id, 'INV-' || to_char(v_start, 'YYMM') || '-' || lpad((v_base + row_number() over (order by t.created_at))::text, 3, '0'),
         t.plan_id, v_start, (v_start + interval '1 month' - interval '1 day')::date, app.tenant_mrr(t.id), v_start + 7
    from public.tenants t
   where (t.status in ('active', 'past_due') or (t.status = 'trial' and t.trial_ends_on < v_start))
     and not exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.period_start = v_start);
  get diagnostics v_n = row_count;
  insert into public.audit_log (tenant_id, actor_id, action, entity, data)
  values (null, auth.uid(), 'platform.invoices_generate', 'saas_invoices', jsonb_build_object('period', v_start, 'count', v_n));
  return v_n;
end $$;

create or replace function app.tenant_can_sell()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select t.status from public.tenants t where t.id = new.tenant_id) in ('suspended', 'cancelled') then
    raise exception 'TENANT_SUSPENDED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sales_tenant_active before insert on public.sales for each row execute function app.tenant_can_sell();
create trigger wholesale_tenant_active before insert on public.wholesale_docs for each row execute function app.tenant_can_sell();
revoke all on function app.tenant_can_sell() from public, anon, authenticated;
