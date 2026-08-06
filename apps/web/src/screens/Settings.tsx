import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/lib/api";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

/** Switches and a way out. A journal should not open onto a control panel. */
export function Settings() {
  const signOut = useSession((s) => s.signOut);
  const { findings, motion, setFindings, setMotion } = usePreferences();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [exported, setExported] = useState(false);

  async function exportEverything() {
    // Everything the person wrote, and everything drawn from it. Assembled
    // client-side from the same endpoints the screens use.
    const [observations, patterns, themes] = await Promise.all([
      api.observations(500),
      api.patterns().catch(() => []),
      api.themes().catch(() => []),
    ]);
    const blob = new Blob(
      [JSON.stringify({ exported: new Date().toISOString(), observations, patterns, themes }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tlon-export.json";
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Settings</span>
          <h1>{me.data?.email ?? "This account"}</h1>
        </div>
      </div>

      <Switch
        label="Patterns and regions"
        note="What has been noticed across time. Turning this off keeps every entry."
        on={findings}
        onToggle={() => setFindings(!findings)}
      />
      <Switch
        label="Ambient motion"
        note="The headspace map breathes. Turn it off for stillness."
        on={motion}
        onToggle={() => setMotion(!motion)}
      />

      <div className="grp">
        <span className="kicker">Your words</span>
      </div>
      <button className="btn" onClick={() => void exportEverything()}>
        {exported ? "EXPORTED" : "EXPORT EVERYTHING"}
      </button>
      <p className="mono" style={{ color: "var(--faint)", marginTop: 8 }}>
        A JSON file of your entries and everything drawn from them.
      </p>
      <Link className="btn" to="/words" style={{ marginTop: 10 }}>
        WHAT HAPPENS TO YOUR WORDS →
      </Link>

      <div className="grp">
        <span className="kicker">Account</span>
      </div>
      <button className="btn" onClick={() => void signOut()}>
        SIGN OUT
      </button>
      {/* Deliberately disabled rather than faked: there is no endpoint behind
          it yet, and a delete control that does not delete is worse than none. */}
      <button className="btn" disabled title="Not available yet" style={{ marginTop: 10 }}>
        DELETE ACCOUNT
      </button>
      <p className="mono" style={{ color: "var(--faint)", marginTop: 8 }}>
        Deleting an account is not built yet. Until it is, this says so rather than pretending.
      </p>
    </>
  );
}

function Switch({
  label,
  note,
  on,
  onToggle,
}: {
  label: string;
  note: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="card row" style={{ justifyContent: "space-between" }}>
      <div>
        <b>{label}</b>
        <div className="mono" style={{ color: "var(--faint)" }}>
          {note}
        </div>
      </div>
      <button
        className="switch"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-on={on ? "" : undefined}
        onClick={onToggle}
      >
        <span className="knob" />
      </button>
    </div>
  );
}
