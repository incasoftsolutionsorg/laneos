import { tenantBrand } from '@/components/backoffice/Shell';
import { LaneServiceWorker } from '@/components/lane/LaneServiceWorker';
import { getContext } from '@/lib/server/context';

// Lanes carry the shop's brand colour / seasonal theme too (Figma 1-3701 "on lanes").
export default async function LaneLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  return <div style={ctx.member ? tenantBrand(ctx.tenant) : undefined}><LaneServiceWorker />{children}</div>;
}
