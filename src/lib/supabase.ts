import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  // Fail loudly at boot rather than with a confusing network error later.
  document.body.innerHTML =
    '<pre style="padding:24px;font:14px ui-monospace">Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.\nCopy .env.example to .env.local and fill them in.</pre>'
  throw new Error('Supabase env vars missing')
}

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 10 } }
})

/**
 * Postgres raises human-readable messages from the RPCs; surface those
 * verbatim and keep the plumbing detail out of the user's way.
 */
export function readableError (err: unknown): string {
  const anyErr = err as { message?: string; hint?: string } | null
  const raw = anyErr?.message ?? String(err)
  return raw
    .replace(/^.*?(?:ERROR|error):\s*/i, '')
    .replace(/\s*CONTEXT:[\s\S]*$/i, '')
    .trim() || 'Something went wrong.'
}
