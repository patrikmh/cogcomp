import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { clockOf } from "@/lib/format";

/**
 * What came first.
 *
 * The ordering stated as a sentence is the kind of thing a person cannot argue
 * with unless they can see what it was counting, so this shows the occasions
 * themselves: each pair of entries, in the order they were written, with the
 * gap named. It says *before*, never *because*.
 */
export function PatternDetail() {
  const { id = "" } = useParams();
  const ordering = useQuery({ queryKey: ["ordering", id], queryFn: () => api.ordering(id) });

  if (ordering.isLoading) return <Loading label="Reading the order…" />;
  if (ordering.isError || !ordering.data) {
    return <Failed label="This pattern has no ordered evidence." />;
  }

  const { lag_days, occasions, label, utc_fallback } = ordering.data;
  const gap = `${lag_days} ${lag_days === 1 ? "day" : "days"}`;

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">What came first</span>
          <h1>{label}</h1>
        </div>
      </div>

      {/* Before the evidence, not in a footnote: someone reading a list of
          "this, then that" will supply a cause if nobody says not to. */}
      <p className="sub">
        These entries were written {gap} apart, {occasions.length}{" "}
        {occasions.length === 1 ? "time" : "times"}. That is an order, not a reason — nothing here
        says one brought the other on.
      </p>

      {occasions.map((occasion) => (
        <div className="card" key={occasion.source_day}>
          <span className="kicker">First · {occasion.source_day}</span>
          {occasion.before.map((e) => (
            <Entry key={e.id} id={e.id} content={e.content} at={e.captured_at} />
          ))}
          <div className="mono" style={{ color: "var(--pattern)", margin: "10px 0" }}>
            {gap} later
          </div>
          <span className="kicker">Then · {occasion.target_day}</span>
          {occasion.after.map((e) => (
            <Entry key={e.id} id={e.id} content={e.content} at={e.captured_at} />
          ))}
        </div>
      ))}

      {utc_fallback && (
        <p className="rest mono">
          Some of these entries never recorded the timezone they were written in, so their days were
          counted in UTC. Near midnight a gap may read as one day more or less than it felt.
        </p>
      )}

      <Link className="btn" to={`/node/${ordering.data.pattern_id}`}>
        HOW THIS WAS PRODUCED →
      </Link>
    </>
  );
}

function Entry({ id, content, at }: { id: string; content: string; at: string }) {
  return (
    <Link to={`/node/${id}`} className="quote">
      <p>{content}</p>
      <span className="mono" style={{ color: "var(--faint)" }}>
        {clockOf(at)}
      </span>
    </Link>
  );
}
