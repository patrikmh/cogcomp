import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/lib/api";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

/** Switches and a way out. A journal should not open onto a control panel. */
export function Settings() {
  const signOut = useSession((s) => s.signOut);
  const { findings, motion, voice, setFindings, setMotion, setVoice } = usePreferences();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [exported, setExported] = useState(false);

  async function exportEverything() {
    // Everything the person wrote, and everything drawn from it. Assembled
    // client-side from the same endpoints the screens use.
    //
    // The readings are the point and they were missing: this offered "entries,
    // readings and patterns" and wrote a file with no readings in it. What was
    // inferred about someone is the part they are least able to reconstruct
    // themselves, so it is the part an export most owes them. The trials they
    // set and what they chose to keep are theirs too.
    const [observations, patterns, themes, readings, identity, experiments] = await Promise.all([
      api.observations(500),
      api.patterns().catch(() => []),
      api.themes().catch(() => []),
      api.graph(1000).catch(() => ({ nodes: [], edges: [] })),
      api.identity(true).catch(() => ({ nodes: [] })),
      api.experiments().catch(() => ({ experiments: [] })),
    ]);
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exported: new Date().toISOString(),
            observations,
            readings: readings.nodes,
            edges: readings.edges,
            patterns,
            themes,
            identity: identity.nodes,
            experiments: experiments.experiments,
          },
          null,
          2,
        ),
      ],
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
      <span className="kicker">Settings</span>
      <h1>Three switches and a way out</h1>
      <div style={{ maxWidth: 520 }}>
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
        <Switch
          label="Spoken replies"
          note="In Talk it through."
          on={voice}
          onToggle={() => setVoice(!voice)}
        />

        <Action
          label="Export everything"
          note="Entries, readings, patterns, regions, what you kept, and your experiments — as JSON."
          button={
            <button className="btn ghost" onClick={() => void exportEverything()}>
              {exported ? "EXPORTED" : "EXPORT"}
            </button>
          }
        />
        <Action
          label="Delete the account"
          note="Not built yet. When it exists it will erase entries, readings, patterns and the account itself — immediately, and not recoverably. Until then this says so rather than pretending."
          button={
            <button className="btn ghost warn" disabled title="Not available yet">
              DELETE
            </button>
          }
        />
        <Action
          label="What happens to your words"
          note="Text is sent to a model to extract readings. Audio is transcribed, then discarded."
          button={
            <Link className="btn ghost" to="/words">
              READ
            </Link>
          }
        />
        <Action
          label="If things are hard right now"
          note="Reachable here, not only mid-conversation."
          button={
            <Link className="btn ghost" to="/talk">
              RESOURCES
            </Link>
          }
        />
        <Action
          last
          label="Sign out"
          note="Revokes the session on the server."
          button={
            <button className="btn ghost" onClick={() => void signOut()}>
              SIGN OUT
            </button>
          }
        />

        <p className="mono" style={{ marginTop: 16 }}>
          {me.data?.email ? `Signed in as ${me.data.email}. ` : ""}Entries are shared with nobody.
        </p>
        {/* The design's colophon, minus its volume number: that one was a
            fiction the prototype could afford and a running app cannot. */}
        <p className="mono" style={{ marginTop: 10 }}>
          Tlön is written by a small society — Orbis Tertius — one volume at a time.
        </p>
      </div>
    </>
  );
}

/** A row that does something rather than toggling something. */
function Action({
  label,
  note,
  button,
  last,
}: {
  label: string;
  note: string;
  button: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="switch" style={last ? { border: 0 } : undefined}>
      <span>
        <b>{label}</b>
        <br />
        <span className="mono">{note}</span>
      </span>
      {button}
    </div>
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
    <div className="switch">
      <span>
        <b>{label}</b>
        <br />
        <span className="mono">{note}</span>
      </span>
      {/* The knob is the control, so it is the button — a switch you cannot
          reach by keyboard is a switch that is not there. */}
      <button
        className="knob"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-on={on ? "" : undefined}
        onClick={onToggle}
      />
    </div>
  );
}
