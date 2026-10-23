import { redirect } from 'next/navigation';

// "Purchasing (GRN)" in the sidebar opens the purchase orders (Figma 11-3669).
export default function PurchasingPage() {
  redirect('/backoffice/purchasing/orders');
}
