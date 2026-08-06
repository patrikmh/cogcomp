import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "@/lib/api";
import { deviceTimezone, localDay, mondayOf } from "@/lib/format";

/** What the app does with what you write, in content rather than a consent wall. */
export function Words() {
  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Before you write</span>
          <h1>What happens to your words</h1>
        </div>
      </div>
      <div className="cards">
      <div className="card">
        <p>
          What you write is stored on your account and shown back to you. It is not shared with
          anyone, and nothing here is sold or advertised against.
        </p>
      </div>
      <div className="card">
        <p>
          To draw readings from an entry, its text is sent to a language model. The readings come
          back with a confidence score and a link to the exact words that produced them — which is
          why every claim in this app can be opened and argued with.
        </p>
      </div>
      <div className="card">
        <p>
          A spoken entry is transcribed and the audio is then discarded. It is never written to the
          database and never becomes part of your record — only the transcript is kept.
        </p>
      </div>
      <div className="card">
        <p>
          Nothing is ever diagnosed, scored, or ranked against other people. The app reports counts
          you can check, and stops.
        </p>
      </div>
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <Link className="btn" to="/journal">
          START WRITING →
        </Link>
        <Link className="btn ghost" to="/settings">
          SETTINGS
        </Link>
      </div>
    </>
  );
}

/**
 * The first fortnight.
 *
 * Detectors need weeks of material before they can say anything. Rather than an
 * empty app, this shows the machinery filling — evidence accruing is true, and
 * it is not a nudge. Nobody owes the system material.
 */
export function First() {
  const tz = deviceTimezone();
  const monday = mondayOf(localDay());
  const words = useQuery({
    queryKey: ["vocabulary", monday, tz, 4],
    queryFn: () => api.vocabulary(monday, tz, 4),
  });

  const written = (words.data?.weeks ?? []).reduce((n, w) => n + w.entry_count, 0);
  const days = (words.data?.weeks ?? []).filter((w) => w.entry_count > 0).length;

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Early days</span>
          <h1>What is accruing</h1>
        </div>
      </div>

      <p className="sub">
        Writing things down repeatedly tends to make them clearer on its own, and that does not
        depend on how often you write. The rest needs material before it can say anything — here is
        what it has.
      </p>

      <div className="cards">
        <Accrual label="Entries kept" have={written} need={12} />
        <Accrual label="Weeks with writing in them" have={days} need={4} />
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <Link className="btn" to="/journal">
          WRITE SOMETHING
        </Link>
      </div>

      <p className="rest mono">
        These are thresholds the detectors need, not targets you owe anyone. A quiet week is a quiet
        week.
      </p>
    </>
  );
}

function Accrual({ label, have, need }: { label: string; have: number; need: number }) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{label}</b>
        <span className="mono">
          {have} of {need}
        </span>
      </div>
      <div className="p-stripwrap">
        <span className="p-bar" style={{ width: `${Math.min(100, Math.round((have / need) * 100))}%` }} />
      </div>
    </div>
  );
}
