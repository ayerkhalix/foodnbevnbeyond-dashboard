import { redirect } from "next/navigation";
import { Inbox } from "@/components/inbox";
import { serverSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!supabaseConfigured()) {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <img
            className="auth-logo"
            src="/food%20n%20bev%20transparent.png"
            alt="Food N Bev & Beyond"
          />
          <h1>Inbox setup in progress</h1>
          <p>
            Restaurant messaging will be available once your administrator
            connects the account.
          </p>
        </section>
      </main>
    );
  }
  const db = await serverSupabase();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) redirect("/login");
  return <Inbox operatorName={data.user.email || "Operator"} />;
}
