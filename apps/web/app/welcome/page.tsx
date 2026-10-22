import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, Logo, buttonClass } from '@laneos/ui';
import { getContext } from '@/lib/server/context';

export const metadata: Metadata = { title: 'Welcome' };

// Signed in, but not (yet) a member of any business.
export default async function WelcomePage() {
  const ctx = await getContext();
  if (ctx.member && ctx.shop) redirect('/backoffice');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="flex max-w-md flex-col gap-4 p-8">
        <Logo />
        <h1 className="text-2xl font-bold">Your account is not linked to a shop</h1>
        <p className="text-[13px] text-text-muted">
          Signed in as {ctx.email}. Ask the shop owner to add you as staff, or create a new shop with a different email.
        </p>
        <div className="flex gap-3">
          <Link href="/register" className={buttonClass('primary')}>Create a shop</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className={buttonClass('secondary')}>Sign out</button>
          </form>
        </div>
      </Card>
    </main>
  );
}
