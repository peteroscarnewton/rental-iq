import { createClient } from '@supabase/supabase-js';

// Server-side client - uses service role key, bypasses RLS
// Only import this in API routes (server-side)
export function getSupabaseAdmin() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}
