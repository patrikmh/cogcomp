import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "@/lib/api";
import { localDay, mondayOf } from "@/lib/format";

/** What the app does with what you write, in content rather than a consent wall. */
export function Words() {
  return (
    <>
      {/* Kicker and heading as direct children, as the design has them. The
          `p-head` wrapper here was a two-column header with nothing in its
          second column — it only ever pushed the heading around. */}
      <span className="kicker">
        Before your first entry <span className="new">NEW</span>
      </span>
      <h1>What happens to your words</h1>
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
  const entries = useQuery({ queryKey: ["observations"], queryFn: () => api.observations(500) });
  const patterns = useQuery({ queryKey: ["patterns"], queryFn: api.patterns });

  const written = entries.data?.observations ?? [];
  const days = new Set(written.map((o) => localDay(new Date(o.captured_at))));
  const weeks = new Set([...days].map((d) => mondayOf(d)));
  const found = patterns.data ?? [];
  const has = (detector: string) => found.some((p) => p.detector === detector);

  // What each detector is actually waiting for, in its own terms. The numbers
  // are the thresholds in the backend, not round ones chosen to look tidy:
  // recurrence wants the same thing on two days, calendar shape wants four
  // distinct weeks, ordering wants three, stated-against-recorded wants ten
  // days of material before it will compare anything.
  const waiting = [
    {
      name: "Recurrence",
      needs: "the same thing written on two different days",
      standing: has("exact-label")
        ? "found"
        : `you have written on ${days.size} ${days.size === 1 ? "day" : "days"}`,
      ready: has("exact-label") || days.size >= 2,
    },
    {
      name: "Calendar shape",
      needs: "writing in four different weeks",
      standing: has("weekday")
        ? "found"
        : `you have ${weeks.size} ${weeks.size === 1 ? "week" : "weeks"}`,
      ready: has("weekday") || weeks.size >= 4,
    },
    {
      name: "Ordering",
      needs: "two things recorded apart, across three weeks",
      standing: has("lag")
        ? "found"
        : `you have ${weeks.size} ${weeks.size === 1 ? "week" : "weeks"}`,
      ready: has("lag") || weeks.size >= 3,
    },
    {
      name: "Stated vs recorded",
      needs: "something you said you would do, and ten days to check it against",
      // Never "ready": this one also needs an intention you actually stated,
      // which is not something the day count can tell us. Claiming ready when
      // the second condition may be unmet would be the app promising a finding
      // it has no way to know is coming.
      standing: has("stated-vs-recorded")
        ? "found"
        : days.size >= 10
          ? "waiting on something you said you would do"
          : `you have written on ${days.size} ${days.size === 1 ? "day" : "days"}`,
      ready: has("stated-vs-recorded"),
    },
  ];

  return (
    <>
      <span className="kicker">
        First fortnight <span className="new">NEW</span>
      </span>
      <h1>The machinery is filling</h1>
      <p className="sub">
        Some findings need more days than you have written. Nothing is owed — this is what each
        detector is waiting for.
      </p>

      <div className="cards">
        {waiting.map((w) => (
          <div className={`card${w.ready ? "" : " hollow"}`} key={w.name}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{w.name}</b>
              <span className="mono">{w.ready ? "ready" : w.standing}</span>
            </div>
            <p className="mono" style={{ margin: "8px 0 0" }}>
              needs {w.needs}
            </p>
          </div>
        ))}
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

