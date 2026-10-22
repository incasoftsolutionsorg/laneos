'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@laneos/db-types';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
