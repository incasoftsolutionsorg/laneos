// Creates (once) a LaneOS platform admin login on staging and stores it in apps/web/.env.local as
// DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD. Never prints the password.
// Run: node --env-file=apps/web/.env.local scripts/seed-admin.mjs

import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const envFile = fileURLToPath(new URL('../apps/web/.env.local', import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

if (process.env.DEMO_ADMIN_EMAIL) {
  console.log('DEMO_ADMIN_EMAIL is already set; nothing to do.');
  process.exit(0);
}

const email = 'platform-admin@laneos.test';
const password = randomBytes(18).toString('base64url');
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'LaneOS Support' } });
if (error) throw error;
const { error: e2 } = await admin.from('platform_admins').insert({ user_id: data.user.id });
if (e2) throw e2;
appendFileSync(envFile, `\nDEMO_ADMIN_EMAIL=${email}\nDEMO_ADMIN_PASSWORD=${password}\n`);
console.log(`Platform admin ${email} created; password saved to apps/web/.env.local.`);
