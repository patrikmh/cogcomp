import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { deviceTimezone, localDay, mondayOf, shiftDay } from "@/lib/format";

/**
 * A week, as a rhythm.
 *
 * Seven columns, each as bright as it was busy, so the shape of the week is the
 * first thing seen. Empty days stay visible and dim — a week with two entries
 * in it is a fact about the week, and hiding the blanks would flatter the
 * record. Nothing here suggests you should have written more.
 */
export function Week() {
  const tz = deviceTimezone();
  const [back, setBack] = useState(0);
  const monday = mondayOf(shiftDay(localDay(), -7 * back));

  const week = useQuery({
    queryKey: ["summary", "week", monday, tz],
    queryFn: () => api.weekly(monday, tz),
  });
  const words = useQuery({
    queryKey: ["vocabulary", monday, tz],
    queryFn: () => api.vocabulary(monday, tz, 1),
  });

  const busiest = Math.max(1, ...(week.data?.days ?? []).map((d) => d.entry_count));

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">This week</span>
          <h1>{monday}</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setBack((b) => b + 1)}>
            ← PREVIOUS
          </button>
          <button className="btn" disabled={back === 0} onClick={() => setBack((b) => Math.max(0, b - 1))}>
            NEXT →
          </button>
        </div>
      </div>

      {week.isLoading ? (
        <Loading />
      ) : week.isError ? (
        <Failed />
      ) : (
        <>
          <div className="w-chart">
            {week.data!.days.map((day) => (
              <Link
                key={day.date}
                to="/today"
                className="w-col"
                style={{ opacity: day.entry_count ? 1 : 0.35 }}
                title={`${day.date} · ${day.entry_count} entries`}
              >
                <span
                  className="w-pow"
                  style={{ height: `${Math.round((day.entry_count / busiest) * 100)}%` }}
                />
                <span className="mono">{day.date.slice(-2)}</span>
              </Link>
            ))}
          </div>

          <div className="sub mono">
            {week.data!.entry_count} {week.data!.entry_count === 1 ? "entry" : "entries"} ·{" "}
            {week.data!.active_days} of 7 days written on · {week.data!.timezone}
          </div>

          {week.data!.recurring.length > 0 && (
            <>
              <div className="grp">
                <span className="kicker">Came up more than once</span>
              </div>
              {week.data!.recurring.map((r) => (
                <div className="card" key={`${r.kind}:${r.label}`}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b>{r.label}</b>
                    <span className="mono">
                      {r.entries} entries · {r.days} days
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Not a finding: the person's own words counted back to them. It
              stays when patterns are switched off. */}
          {words.data?.weeks.at(-1) && (
            <p className="rest mono">{words.data.weeks.at(-1)!.description}</p>
          )}
        </>
      )}
    </>
  );
}
