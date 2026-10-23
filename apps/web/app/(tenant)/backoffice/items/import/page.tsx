import type { Metadata } from 'next';
import { PageHeader, buttonClass } from '@laneos/ui';
import { ImportItems } from '@/components/items/ImportItems';
import { requireTenant } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Import items' };

export default async function ImportItemsPage() {
  await requireTenant('item.edit');
  return (
    <>
      <PageHeader
        title="Import items"
        subtitle="Upload the item template; errors are shown per row. Existing items are matched by barcode, then PLU, and updated."
        actions={<a href="/backoffice/items/import/template" className={buttonClass('secondary')} download>Download template</a>}
      />
      <ImportItems />
    </>
  );
}
