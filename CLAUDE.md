# LaneOS — notes for Claude

Monorepo: `apps/web` (Next.js 16, App Router), `packages/*` (core, barcode, pricing, ui, db-types), `supabase/` (migrations, config). Blueprint: `docs/01-blueprint.md`; screens and Figma frames: its Appendix E.

## Database changes — always, in the same change

1. New migration file in `supabase/migrations/` (`pnpm exec supabase migration new <name>`). Never edit a migration that has been pushed; add a fix migration instead.
2. Every new table: RLS enabled **and forced**, policies via `app.tenant_id()` / `app.can_shop()` / `app.has_perm()`, and revoke writes `authenticated` must not have.
3. Functions: `set search_path = ''`, and always write a WHERE clause on UPDATE/DELETE (Supabase's pg-safeupdate rejects them otherwise, even on temp tables).
4. **Update `docs/08-data-model.md`**: table catalogue (§3), functions (§5), deviations (§6), migration log (§7), version line. `scripts/test/data-model-doc.test.ts` fails if a table or migration is missing.
5. `pnpm db:push`, then `pnpm db:types`, then `pnpm test` and `pnpm test:db`.

## Rules that are easy to break

- Money in integer cents, quantities in milli-units; use `@laneos/core` helpers.
- Pricing exists twice: `packages/pricing` (lane preview) and `api.create_sale` (server truth). Change both; `pnpm test:db` checks parity.
- Never put a LaneOS role in the JWT `role` claim (PostgREST uses it); the hook uses `app_role`.
- Permission bits live in both `packages/core/src/permissions.ts` and the tenancy migration; a unit test compares them.
- Use design tokens from `packages/ui/src/theme.css` (e.g. `bg-brand-primary`), never raw hex.
- Secrets only in `apps/web/.env.local` (gitignored); never print them.

## Commands

`pnpm dev` (http://localhost:3000) · `pnpm test` (unit) · `pnpm test:db` (integration against staging) · `pnpm db:push` · `pnpm db:types` · `pnpm db:seed` (demo tenant)
