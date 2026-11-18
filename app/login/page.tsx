import { LoginForm } from "@/components/login-form";
import { supabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <img
          className="auth-logo"
          src="/food%20n%20bev%20transparent.png"
          alt="Food N Bev & Beyond"
        />
        <h1>Sign in to your inbox</h1>
        <p>Manage Messenger conversations for your restaurants.</p>
        <LoginForm configured={supabaseConfigured()} />
      </section>
    </main>
  );
}
