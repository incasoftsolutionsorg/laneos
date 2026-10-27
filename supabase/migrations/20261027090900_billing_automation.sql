-- SaaS billing automation (blueprint SLICE-011, WF-008):
--   * app.generate_invoices(period): the monthly invoice run, shared by Admin → Billing and the daily job
--   * app.billing_tick(): daily — on the 1st create the month's invoices; tenants with an overdue invoice become
--     past_due; past_due beyond 14 days' grace becomes suspended (read-only: selling blocked by app.tenant_can_sell)
--   * api.payhere_paid(...): called only by the PayHere notify route (service role) after the signature is verified;
--     marks the invoice paid and reactivates the tenant when nothing is overdue

create or replace function app.generate_invoices(p_period date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_base  integer;
  v_n     integer;
begin
  select count(*) into v_base from public.saas_invoices i where i.period_start = v_start;
  insert into public.saas_invoices (tenant_id, invoice_no, plan_id, period_start, period_end, amount_cents, due_on)
  select t.id, 'INV-' || to_char(v_start, 'YYMM') || '-' || lpad((v_base + row_number() over (order by t.created_at))::text, 3, '0'),
         t.plan_id, v_start, (v_start + interval '1 month' - interval '1 day')::date, app.tenant_mrr(t.id), v_start + 7
    from public.tenants t
   where (t.status in ('active', 'past_due') or (t.status = 'trial' and t.trial_ends_on < v_start))
     and app.tenant_mrr(t.id) > 0
     and not exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.period_start = v_start);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function api.admin_generate_invoices(p_period date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform app.require_platform_admin();
  v_n := app.generate_invoices(p_period);
  insert into public.audit_log (tenant_id, actor_id, action, entity, data)
  values (null, auth.uid(), 'platform.invoices_generate', 'saas_invoices', jsonb_build_object('period', date_trunc('month', p_period)::date, 'count', v_n));
  return v_n;
end $$;

create or replace function app.billing_tick()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Colombo')::date;
  v_new   integer := 0;
  v_due   integer;
  v_susp  integer;
begin
  if extract(day from v_today) = 1 then
    v_new := app.generate_invoices(v_today);
  end if;
  -- Trial ended or a payment is late: past_due (the banner shows in Plan & billing).
  update public.tenants t set status = 'past_due', updated_at = now()
   where t.status in ('active', 'trial')
     and exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_on < v_today);
  get diagnostics v_due = row_count;
  -- 14 days' grace after the oldest overdue invoice, then read-only (suspended).
  update public.tenants t set status = 'suspended', updated_at = now()
   where t.status = 'past_due'
     and exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_on < v_today - 14);
  get diagnostics v_susp = row_count;
  if v_new + v_due + v_susp > 0 then
    insert into public.audit_log (tenant_id, actor_id, action, entity, data)
    values (null, null, 'platform.billing_tick', 'tenants', jsonb_build_object('invoices', v_new, 'pastDue', v_due, 'suspended', v_susp));
  end if;
  return jsonb_build_object('invoices', v_new, 'pastDue', v_due, 'suspended', v_susp);
end $$;

-- PayHere notify (status 2 = success). Idempotent: a repeated notify for a paid invoice returns 'already_paid'.
create or replace function api.payhere_paid(p_order text, p_payment text, p_amount_cents bigint, p_status integer)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.saas_invoices;
begin
  select * into v_inv from public.saas_invoices i where i.invoice_no = p_order for update;
  if v_inv.id is null then
    return 'unknown_order';
  end if;
  if p_status <> 2 then
    insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
    values (v_inv.tenant_id, null, 'billing.payhere_status', 'saas_invoices', v_inv.id, jsonb_build_object('status', p_status, 'payment', p_payment));
    return 'ignored_status';
  end if;
  if v_inv.status = 'paid' then
    return 'already_paid';
  end if;
  if p_amount_cents <> v_inv.amount_cents then
    insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
    values (v_inv.tenant_id, null, 'billing.payhere_amount_mismatch', 'saas_invoices', v_inv.id, jsonb_build_object('paid', p_amount_cents, 'due', v_inv.amount_cents));
    return 'amount_mismatch';
  end if;
  update public.saas_invoices set status = 'paid', paid_at = now(), payhere_order_id = p_payment where id = v_inv.id;
  if not exists (select 1 from public.saas_invoices i where i.tenant_id = v_inv.tenant_id and i.status = 'open'
                  and i.due_on < (now() at time zone 'Asia/Colombo')::date) then
    update public.tenants set status = 'active', updated_at = now(),
           next_charge_on = (date_trunc('month', (now() at time zone 'Asia/Colombo')::date) + interval '1 month')::date
     where id = v_inv.tenant_id and status in ('trial', 'past_due', 'suspended');
  end if;
  insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, data)
  values (v_inv.tenant_id, null, 'billing.payhere_paid', 'saas_invoices', v_inv.id, jsonb_build_object('payment', p_payment, 'amount', p_amount_cents));
  return 'paid';
end $$;

-- Daily at 01:00 Sri Lanka time (19:30 UTC).
do $$
begin
  perform cron.schedule('laneos-billing-tick', '30 19 * * *', 'select app.billing_tick()');
exception when others then
  raise notice 'pg_cron not available: %', sqlerrm;
end $$;

revoke all on function app.generate_invoices(date), app.billing_tick() from public, anon, authenticated;
revoke all on function api.payhere_paid(text, text, bigint, integer) from public, anon, authenticated;
grant execute on function api.payhere_paid(text, text, bigint, integer) to service_role;
