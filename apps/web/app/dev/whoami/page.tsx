import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function WhoAmI() {
  if (process.env.NODE_ENV === 'production') notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  // A JWT is header.payload.signature; we only need the payload (index 1)
  const payload = session?.access_token.split('.')[1]
  const claims = payload
    ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    : null

  return <pre>{JSON.stringify({ user: user?.id, claims }, null, 2)}</pre>
}