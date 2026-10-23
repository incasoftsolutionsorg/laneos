import { TEMPLATE_CSV, TEMPLATE_VERSION } from '@/lib/import/items';

export function GET() {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${TEMPLATE_VERSION}.csv"`,
    },
  });
}
