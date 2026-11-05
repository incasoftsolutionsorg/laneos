-- RLS speed: shop checks once per query, not once per row.
-- Policies written as `(select app.can_shop(shop_id))` pass a column of the row, so Postgres runs the subquery for
-- every row, and each run rebuilds the user's shop list (app.shop_ids()). On the stock counts page (≈500 count lines)
-- that cost ≈0.35 s; sales, stock levels and movements pay the same on reports and the dashboard.
-- Rewritten to `shop_id = any ((select app.shop_ids())::uuid[])`: the list is built once per query (an InitPlan) and
-- each row is a cheap array lookup. The cast matters: without it `= any ((select ...))` is read as a subquery
-- comparison (uuid = uuid[]). Same rows visible: can_shop(x) is defined as `x = any (app.shop_ids())`.
-- Every policy is rewritten in place from its current text, so only the can_shop part changes.

do $$
declare
  p record;
  v_using text;
  v_check text;
  v_pattern constant text := '\( SELECT app\.can_shop\(([a-z_]+\.[a-z_]+)\) AS can_shop\)';
  v_with constant text := '(\1 = ANY (( SELECT app.shop_ids() AS shop_ids)::uuid[]))';
  v_n integer := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where coalesce(qual, '') || coalesce(with_check, '') like '%app.can_shop(%'
  loop
    v_using := regexp_replace(p.qual, v_pattern, v_with, 'g');
    v_check := regexp_replace(p.with_check, v_pattern, v_with, 'g');
    if coalesce(v_using, '') like '%app.can_shop(%' or coalesce(v_check, '') like '%app.can_shop(%' then
      raise exception 'policy %.% has a can_shop call this migration does not recognise: %', p.tablename, p.policyname, coalesce(p.qual, p.with_check);
    end if;
    if v_using is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, v_using);
    end if;
    if v_check is not null then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, v_check);
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'rewrote % policies', v_n;
end $$;
