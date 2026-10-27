import type { Metadata } from 'next';
import { Inter, Roboto_Mono } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', weight: ['400', '500', '600', '700'] });
const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-roboto-mono' });

export const metadata: Metadata = {
  title: { default: 'LaneOS', template: '%s · LaneOS' },
  description: 'Cloud POS for grocery shops, supermarkets and franchise chains.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: the CSP (proxy.ts) only allows scripts carrying that request's nonce, and a
  // page prerendered at build time has none, so its scripts are blocked (the lane print window stayed blank).
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${robotoMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-text">{children}</body>
    </html>
  );
}
