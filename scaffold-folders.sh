#!/usr/bin/env bash
# LaneOS — create the full folder structure (T-001, Chathuka)
# Run from the repository root AFTER:
#   pnpm dlx create-next-app@latest apps/web --ts --app --tailwind --eslint --no-src-dir --import-alias '@/*'
#   supabase init
# Safe to run more than once: it only creates missing folders and .gitkeep files.
set -euo pipefail

dirs=(
  # ---------- GitHub ----------
  ".github/workflows"
  ".github/ISSUE_TEMPLATE"

  # ---------- Next.js app: route groups ----------
  # Auth
  "apps/web/app/(auth)/login/mfa"
  "apps/web/app/(auth)/forgot-password"
  "apps/web/app/(auth)/reset-password"
  "apps/web/app/auth/callback"

  # Platform admin
  "apps/web/app/(platform)/admin/tenants/new"
  "apps/web/app/(platform)/admin/tenants/[id]"
  "apps/web/app/(platform)/admin/billing"
  "apps/web/app/(platform)/admin/security"

  # Back office (owner, head office, store manager)
  "apps/web/app/(tenant)/backoffice/items/new"
  "apps/web/app/(tenant)/backoffice/items/[id]"
  "apps/web/app/(tenant)/backoffice/items/import"
  "apps/web/app/(tenant)/backoffice/pricing/lists"
  "apps/web/app/(tenant)/backoffice/pricing/overrides"
  "apps/web/app/(tenant)/backoffice/pricing/schedules"
  "apps/web/app/(tenant)/backoffice/promotions/new"
  "apps/web/app/(tenant)/backoffice/promotions/[id]"
  "apps/web/app/(tenant)/backoffice/labels"
  "apps/web/app/(tenant)/backoffice/stock/damage/[id]"
  "apps/web/app/(tenant)/backoffice/stock/counts"
  "apps/web/app/(tenant)/backoffice/stock/wastage"
  "apps/web/app/(tenant)/backoffice/stock/expiry"
  "apps/web/app/(tenant)/backoffice/suppliers/[id]"
  "apps/web/app/(tenant)/backoffice/purchasing/orders/[id]"
  "apps/web/app/(tenant)/backoffice/purchasing/grn/new"
  "apps/web/app/(tenant)/backoffice/purchasing/grn/[id]"
  "apps/web/app/(tenant)/backoffice/purchasing/returns"
  "apps/web/app/(tenant)/backoffice/purchasing/payments"
  "apps/web/app/(tenant)/backoffice/transfers/[id]"
  "apps/web/app/(tenant)/backoffice/head-office"
  "apps/web/app/(tenant)/backoffice/customers/[id]"
  "apps/web/app/(tenant)/backoffice/credit-notes"
  "apps/web/app/(tenant)/backoffice/staff/[id]/sessions"
  "apps/web/app/(tenant)/backoffice/lanes"
  "apps/web/app/(tenant)/backoffice/reports/[report]"
  "apps/web/app/(tenant)/backoffice/sync-issues"
  "apps/web/app/(tenant)/backoffice/billing"
  "apps/web/app/(tenant)/backoffice/settings/branding"
  "apps/web/app/(tenant)/backoffice/settings/security"
  "apps/web/app/(tenant)/backoffice/profile/security/enrol-mfa"

  # Checkout lane (PWA)
  "apps/web/app/(lane)/lane/register"
  "apps/web/app/(lane)/lane/locked"
  "apps/web/app/(lane)/lane/[laneId]/pin"
  "apps/web/app/(lane)/lane/[laneId]/display"
  "apps/web/app/(lane)/lane/[laneId]/return"
  "apps/web/app/(lane)/lane/[laneId]/shift"

  # Public digital receipt
  "apps/web/app/r/[id]"

  # Dev-only pages
  "apps/web/app/dev/ui"
  "apps/web/app/dev/whoami"

  # ---------- Route handlers (API) ----------
  "apps/web/app/api/lane/catalog"
  "apps/web/app/api/lane/sales/[id]/receipt"
  "apps/web/app/api/lane/returns"
  "apps/web/app/api/lane/payments"
  "apps/web/app/api/lane/credit-notes/[code]"
  "apps/web/app/api/lane/loyalty/[phone]"
  "apps/web/app/api/lane/damage"
  "apps/web/app/api/lane/shifts/open"
  "apps/web/app/api/lane/shifts/[id]/pickup"
  "apps/web/app/api/lane/shifts/[id]/close"
  "apps/web/app/api/lane/shifts/[id]/z-report"
  "apps/web/app/api/import/items"
  "apps/web/app/api/qz/sign"

  # ---------- App code ----------
  "apps/web/components/auth"
  "apps/web/components/lane"
  "apps/web/components/items"
  "apps/web/components/import"
  "apps/web/components/charts"
  "apps/web/components/security"
  "apps/web/lib/supabase"
  "apps/web/lib/server/import"
  "apps/web/lib/lane"
  "apps/web/lib/security"
  "apps/web/messages"
  "apps/web/public/icons"
  "apps/web/test/server"
  "apps/web/test/api"
  "apps/web/test/admin"
  "apps/web/test/catalogue"
  "apps/web/test/lane"
  "apps/web/test/parity"
  "apps/web/test/utils"

  # ---------- Shared packages ----------
  "packages/core/src/schemas"
  "packages/core/test"
  "packages/pricing/src"
  "packages/pricing/test"
  "packages/pricing/fixtures"
  "packages/barcode/src"
  "packages/barcode/test"
  "packages/devices/src"
  "packages/devices/test"
  "packages/ui/src/components"
  "packages/db-types/src"

  # ---------- Supabase ----------
  "supabase/migrations"
  "supabase/tests"
  "supabase/functions/_shared"
  "supabase/functions/payhere-notify"
  "supabase/functions/outbox-worker"
  "supabase/functions/licence"

  # ---------- Tests, scripts, docs ----------
  "e2e"
  "load"
  "scripts"
  "docs/adr"
  "docs/slices"
  "docs/templates"
  "docs/training"
  "docs/security-reports"
  "docs/incidents"
  "docs/delivery"
)

for d in "${dirs[@]}"; do
  mkdir -p "$d"
done

# Empty folders need a placeholder so Git keeps them
find apps packages supabase e2e load scripts docs .github -type d -empty -exec touch {}/.gitkeep \;

echo "LaneOS folder structure created (${#dirs[@]} folders)."
