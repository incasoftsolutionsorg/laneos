-- Invoice generation fixes (SLICE-011). Admin → Billing "Create invoices" and the daily job created nothing:
--   * app.generate_invoices only billed tenants with app.tenant_mrr > 0, and tenant_mrr is 0 for status 'trial';
--     nothing ever moved an ended trial to 'active', so a trial tenant was never billed
--   * tenants created before trial dates existed have trial_ends_on = null, so their trial never ended
-- Now: billing starts when the trial ends (or when the business was created, if it never had a trial); the first
-- month is charged for the days from that date; the daily job runs the (idempotent) invoice run every day and moves
-- ended trials to 'active'.

-- What the plan costs per month, whatever the tenant's status (tenant_mrr stays the MRR figure for reports).
create or replace function app.tenant_plan_cents(p_tenant uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select case when p.per_shop then p.price_cents * greatest(1, (select count(*) from public.shops s where s.tenant_id = t.id and s.is_active))
              else p.price_cents end
    from public.tenants t join public.plans p on p.id = t.plan_id where t.id = p_tenant;
$$;

-- The first day a tenant pays for.
create or replace function app.tenant_billing_start(p_tenant uuid)
returns date
language sql stable security definer
set search_path = ''
as $$
  select coalesce(t.trial_ends_on, (t.created_at at time zone 'Asia/Colombo')::date + case when t.status = 'trial' then 14 else 0 end)
    from public.tenants t where t.id = p_tenant;
$$;

update public.tenants t
   set trial_ends_on = (t.created_at at time zone 'Asia/Colombo')::date + 14,
       next_charge_on = coalesce(t.next_charge_on, (t.created_at at time zone 'Asia/Colombo')::date + 14),
       updated_at = now()
 where t.status = 'trial' and t.trial_ends_on is null;

create or replace function app.generate_invoices(p_period date)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_end   date := (date_trunc('month', p_period) + interval '1 month' - interval '1 day')::date;
  v_days  integer := extract(day from (date_trunc('month', p_period) + interval '1 month' - interval '1 day'))::integer;
  v_base  integer;
  v_n     integer;
begin
  select count(*) into v_base from public.saas_invoices i where i.period_start = v_start;
  insert into public.saas_invoices (tenant_id, invoice_no, plan_id, period_start, period_end, amount_cents, due_on)
  select b.id, 'INV-' || to_char(v_start, 'YYMM') || '-' || lpad((v_base + row_number() over (order by b.created_at))::text, 3, '0'),
         b.plan_id, v_start, v_end,
         -- First month: only the days from the end of the trial.
         case when b.paid_from > v_start then app.div_round(b.price * (v_end - b.paid_from + 1), v_days) else b.price end,
         greatest(v_start, b.paid_from) + 7
    from (select t.id, t.plan_id, t.created_at, app.tenant_plan_cents(t.id) as price, app.tenant_billing_start(t.id) as paid_from
            from public.tenants t
           where t.status in ('trial', 'active', 'past_due')
             and not exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.period_start = v_start)) b
   where b.paid_from <= v_end and b.price > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function app.billing_tick()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Colombo')::date;
  v_new   integer;
  v_trial integer;
  v_due   integer;
  v_susp  integer;
begin
  -- Trial over: a paying customer from today.
  update public.tenants t set status = 'active', updated_at = now()
   where t.status = 'trial' and t.trial_ends_on <= v_today;
  get diagnostics v_trial = row_count;
  -- Every day, so a trial that ends mid-month (or a business added mid-month) gets this month's invoice.
  v_new := app.generate_invoices(v_today);
  -- A payment is late: past_due (the banner shows in Plan & billing).
  update public.tenants t set status = 'past_due', updated_at = now()
   where t.status in ('active', 'trial')
     and exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_on < v_today);
  get diagnostics v_due = row_count;
  -- 14 days' grace after the oldest overdue invoice, then read-only (suspended).
  update public.tenants t set status = 'suspended', updated_at = now()
   where t.status = 'past_due'
     and exists (select 1 from public.saas_invoices i where i.tenant_id = t.id and i.status = 'open' and i.due_on < v_today - 14);
  get diagnostics v_susp = row_count;
  if v_new + v_trial + v_due + v_susp > 0 then
    insert into public.audit_log (tenant_id, actor_id, action, entity, data)
    values (null, null, 'platform.billing_tick', 'tenants',
            jsonb_build_object('invoices', v_new, 'trialEnded', v_trial, 'pastDue', v_due, 'suspended', v_susp));
  end if;
  return jsonb_build_object('invoices', v_new, 'trialEnded', v_trial, 'pastDue', v_due, 'suspended', v_susp);
end $$;

revoke all on function app.tenant_plan_cents(uuid), app.tenant_billing_start(uuid), app.generate_invoices(date), app.billing_tick()
  from public, anon, authenticated;
