import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/lib/api";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";

/** What went wrong, in words. The server already writes these properly —
 *  "invalid email or password", "an account with that email already exists" —
 *  and the client's job is only to not throw them away, which it used to do for
 *  every 401. Only the case the server cannot answer is written here. */
export function messageFor(err: unknown): string {
  return err instanceof ApiError
    ? err.message
    : "Could not reach the server. Your words are still here.";
}

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
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // The design's own column. It used to carry `.f-wrap`/`.f-field`, which are
    // the *search* screen's classes: `.f-field` is a flex container whose child
    // input takes the 20px face, so putting it on the input meant the child
    // rule never matched and the input wore a wrapper's border-bottom and
    // padding instead of the bordered field every other input in the app has.
    <div style={{ maxWidth: 380 }}>
      <img src="/assets/tlon-logo.png" alt="Tlön" style={{ width: 120, opacity: 0.9 }} />
      {/* What the thing is, before asking anyone to sign into it. */}
      <div className="guide-heading">
        <h1 style={{ marginTop: 26 }}>A private journal</h1>
        <Guide id="login" />
      </div>
      <p className="sub">
        Twelve characters or more for the password. Nothing else is required, and nothing is
        public.
      </p>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            type="email"
            value={email}
            placeholder="Email"
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            value={password}
            /* Said before it is demanded, not after it is refused. */
            placeholder="Password · twelve characters or more"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="mono" style={{ marginTop: 12, color: "var(--rust)" }} role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
          </button>
          {/* The design offers this here, and it is the right place: what
              happens to what you write is worth reading before you write any of
              it, not after you have already handed it over. */}
          <Link className="btn ghost" to="/words">
            WHAT HAPPENS TO YOUR WORDS
          </Link>
        </div>
      </form>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "CREATE AN ACCOUNT" : "I ALREADY HAVE ONE"}
        </button>
      </div>
    </div>
  );
}
