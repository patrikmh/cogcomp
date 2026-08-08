import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/lib/api";
import { useSession } from "@/state/session";

/** The only screen outside the auth gate. No marketing, no explanation of what
 *  a journal is — the guidance that matters is stated before it is demanded. */
export function Login() {
  const signIn = useSession((s) => s.signIn);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password, mode);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Your words are still here.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="f-wrap" style={{ maxWidth: 420, margin: "12vh auto" }}>
      <img src="/assets/tlon-logo.png" alt="Tlön" style={{ width: 150 }} />
      {/* What the thing is, before asking anyone to sign into it. */}
      <h1 style={{ marginTop: 26 }}>A private journal</h1>
      <p className="sub">
        Twelve characters or more for the password. Nothing else is required, and nothing is
        public.
      </p>
      <form onSubmit={submit}>
        <input
          className="f-field"
          type="email"
          value={email}
          placeholder="Email"
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="f-field"
          type="password"
          value={password}
          /* Said before it is demanded, not after it is refused. */
          placeholder="Password · twelve characters or more"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          onChange={(e) => setPassword(e.target.value)}
          style={{ marginTop: 10 }}
        />
        {error && (
          <p className="mono" style={{ color: "var(--rust)" }} role="alert">
            {error}
          </p>
        )}
        <button className="btn go on" type="submit" disabled={busy} style={{ marginTop: 14 }}>
          {busy ? "…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
        </button>
      </form>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "CREATE AN ACCOUNT" : "I ALREADY HAVE ONE"}
        </button>
        {/* The design offers this here, and it is the right place: what happens
            to what you write is worth reading before you write any of it, not
            after you have already handed it over. */}
        <Link className="btn ghost" to="/words">
          WHAT HAPPENS TO YOUR WORDS
        </Link>
      </div>
    </div>
  );
}
