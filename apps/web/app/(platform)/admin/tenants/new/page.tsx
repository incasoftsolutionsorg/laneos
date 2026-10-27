import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, buttonClass } from '@laneos/ui';
import { NewTenantForm } from '@/components/admin/NewTenantForm';
import { requireAdmin } from '@/lib/server/admin';

export const metadata: Metadata = { title: 'New tenant' };

// Platform admin creates a tenant for a customer (blueprint SLICE-001 / WF-001; no Figma frame).
export default async function NewTenantPage() {
  const { supabase } = await requireAdmin();
  const { data: plans } = await supabase.from('plans').select('id, name, is_custom').eq('is_active', true).order('sort_order');
  return (
    <>
      <PageHeader title="New tenant" subtitle="Set up a business for a customer. The owner gets an email to choose a password."
        actions={<Link href="/admin/tenants" className={buttonClass('secondary')}>Back</Link>} />
      <NewTenantForm plans={(plans ?? []).map((p) => ({ id: p.id, name: p.name + (p.is_custom ? ' (custom)' : '') }))} />
    </>
  );
}
