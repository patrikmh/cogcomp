import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Empty, Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { clockOf, deviceTimezone, fmt, localDay, shiftDay } from "@/lib/format";

/**
 * One day, as an object.
 *
 * What you wrote, then what was noticed, then what is only suspected. That
 * split is the one distinction this product exists to keep: a guess sitting
 * beside a certainty reads as equally true however it is styled.
 */
export function Today() {
  const tz = deviceTimezone();
  const [offset, setOffset] = useState(0);
  const day = shiftDay(localDay(), offset);

  const summary = useQuery({
    queryKey: ["summary", day, tz],
    queryFn: () => api.daily(day, tz),
  });

  const noticed = (summary.data?.inferred ?? []).filter((i) => !i.tentative);
  const unsure = (summary.data?.inferred ?? []).filter((i) => i.tentative);

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Today</span>
          <h1>{offset === 0 ? "Today" : day}</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setOffset((o) => o - 1)}>
            ← EARLIER
          </button>
          <button className="btn" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}>
            LATER →
          </button>
        </div>
      </div>

      {summary.isLoading ? (
        <Loading />
      ) : summary.isError ? (
        <Failed />
      ) : summary.data!.entry_count === 0 ? (
        <Empty label="Nothing recorded." />
      ) : (
        <>
          <div className="sub mono">
            {summary.data!.entry_count} {summary.data!.entry_count === 1 ? "entry" : "entries"} ·{" "}
            {summary.data!.timezone}
          </div>

          <div className="grp">
            <span className="kicker">What you wrote</span>
          </div>
          {summary.data!.observations.map((o) => (
            <Link key={o.id} to={`/node/${o.id}`} className="card">
              <p>{o.content}</p>
              <span className="mono" style={{ color: "var(--faint)" }}>
                {clockOf(o.captured_at)} · {o.source}
              </span>
            </Link>
          ))}

          {noticed.length > 0 && (
            <>
              <div className="grp">
                <span className="kicker">Noticed</span>
              </div>
              {noticed.map((i) => (
                <Reading key={i.id} reading={i} />
              ))}
            </>
          )}

          {unsure.length > 0 && (
            <>
              <div className="grp">
                <span className="kicker">Less sure about</span>
              </div>
              {unsure.map((i) => (
                <Reading key={i.id} reading={i} />
              ))}
            </>
          )}

          <p className="rest mono">
            Everything under Noticed and Less sure about is a guess drawn from your entries, not a
            conclusion about you. Open one to see which words it came from.
          </p>
        </>
      )}
    </>
  );
}

function Reading({
  reading,
}: {
  reading: { id: string; kind: string; label: string; confidence: number; tentative: boolean; cites_entries: number };
}) {
  return (
    <div className={`card${reading.tentative ? " hollow" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link to={`/node/${reading.id}`}>
          <b>{reading.label}</b>
        </Link>
        <span className="mono">
          {reading.kind.toLowerCase()} · {fmt(reading.confidence)}
        </span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Meter confidence={reading.confidence} />
        <span className="mono">
          {reading.cites_entries} {reading.cites_entries === 1 ? "entry" : "entries"}
        </span>
      </div>
    </div>
  );
}
