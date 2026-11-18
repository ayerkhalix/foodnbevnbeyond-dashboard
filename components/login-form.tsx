"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserSupabase } from "@/lib/supabase/client";

export function LoginForm({
  configured,
  onSuccess,
}: {
  configured: boolean;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !configured) return;
    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      emailInput.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await browserSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error) {
        setError(
          "Sign-in failed. Check your email and password, then try again.",
        );
        setPassword("");
      } else if (onSuccess) {
        onSuccess();
      } else {
        router.replace("/");
        router.refresh();
      }
    } catch {
      setError("The sign-in service could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" noValidate onSubmit={submit}>
      <label htmlFor="operator-email">Email address</label>
      <input
        ref={emailInput}
        id="operator-email"
        name="email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        aria-invalid={Boolean(error)}
        aria-describedby="login-status"
      />
      <label htmlFor="operator-password">Password</label>
      <input
        id="operator-password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
        aria-invalid={Boolean(error)}
        aria-describedby="login-status"
      />
      <div id="login-status" className="form-status" role="status">
        {configured
          ? error
          : "The inbox is awaiting account setup. Contact your administrator."}
      </div>
      <button
        className="send-button"
        type="submit"
        disabled={busy || !configured}
        aria-busy={busy}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="login-help">
        Use the account provided by your administrator. Contact them if you need
        access or a password reset.
      </p>
    </form>
  );
}
