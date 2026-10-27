-- SLICE-009 part 1: new enum values. PostgreSQL cannot use a value added in the same transaction, so the tables and
-- functions that use them follow in 20261027090500_promotions_loyalty.sql.
alter type public.promotion_kind add value if not exists 'mix_match';
alter type public.promotion_kind add value if not exists 'threshold';
alter type public.payment_method add value if not exists 'loyalty';
