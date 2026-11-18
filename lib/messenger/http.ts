import "server-only";
import { serverSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
export { sameOrigin } from "./origin";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function operator() {
  if (!supabaseConfigured())
    return {
      response: json({ error: "The inbox is awaiting setup." }, 503),
    } as const;
  const db = await serverSupabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.is_anonymous)
    return {
      response: json(
        { error: "Sign in to continue. Your draft is kept in this tab." },
        401,
      ),
    } as const;
  return { db, user: data.user } as const;
}

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function logFailure(operation: string, code?: string) {
  // Only known database error codes; never log tokens, PSIDs, message bodies or provider error objects.
  console.error(
    "[messenger]",
    operation,
    code && /^[A-Z0-9]{5}$/.test(code) ? code : "failed",
  );
}
