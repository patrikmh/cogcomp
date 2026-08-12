import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { DISCLOSURES, DISCLOSURE_HEADING } from "@tlon/copy";
import { detectorsWaiting } from "@tlon/ontology";

import { api } from "@/lib/api";
import { localDay, mondayOf } from "@/lib/format";
import { Guide } from "@/components/Guide";
import { HEADINGS } from "@tlon/copy/headings";

/** What the app does with what you write, in content rather than a consent wall. */
export function Words() {
  return (
    <>
      {/* Kicker and heading as direct children, as the design has them. The
          `p-head` wrapper here was a two-column header with nothing in its
          second column — it only ever pushed the heading around. */}
      <span className="kicker">
        {/* `.new` is styled only inside the rail, so the span did nothing here
            but swallow the separator the design has between the two halves. */}
        Before your first entry · new
      </span>
      <h1>{DISCLOSURE_HEADING}</h1>
      {/* The sentences come from `@tlon/copy`, which both clients read. Two
          independently maintained privacy pages is how the mobile one came to
          say entries "stay on your account" while they were being sent to a
          model. */}
      <div className="cards">
        {DISCLOSURES.map((item) => (
          <div className="card" key={item.title}>
            <p>{item.body}</p>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <Link className="btn" to="/journal">
          {/* No arrow. The design keeps those for moving along the timeline —
              NEXT →, THU → — and this is an action, not a step. */}
          START WRITING
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

  // The arithmetic and the thresholds live in `@tlon/ontology`, shared with the
  // mobile client and checked against the Python by
  // `scripts/check_ontology_sync.py`. Two clients quoting different numbers at
  // someone about the same detector is the failure this prevents.
  const waiting = detectorsWaiting({ days: days.size, weeks: weeks.size, found: found.map((p) => p.detector) });


  return (
    <>
      <span className="kicker">
        First fortnight · new
      </span>
      <div className="guide-heading">
        <h1>{HEADINGS.first.title}</h1>
        <Guide id="first" />
      </div>
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

