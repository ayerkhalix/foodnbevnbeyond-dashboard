import "server-only";
import { createClient } from "@supabase/supabase-js";

export function adminSupabase() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key)
    throw new Error("Supabase server configuration missing");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
