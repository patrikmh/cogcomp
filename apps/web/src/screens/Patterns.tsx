import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Empty, Failed, Loading } from "@/components/States";
import { api, type Pattern } from "@/lib/api";
import { DETECTOR_LABEL, fmt } from "@/lib/format";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

/**
 * What keeps returning.
 *
 * Each finding carries the method that found it, because the detectors are not
 * interchangeable: a recurrence counts entries, an ordering counts occasions,
 * and stated-vs-recorded rests on an overlap that did *not* happen. The label
 * the server writes is the claim; nothing here rephrases it.
 */
export function Patterns() {
  const userId = useSession((s) => s.userId);
  const client = useQueryClient();
  const showFindings = usePreferences((s) => s.findings);
  const setFindings = usePreferences((s) => s.setFindings);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: api.patterns,
    enabled: showFindings,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: api.themes,
    enabled: showFindings,
  });
  const mine = useMutation({
    mutationFn: api.minePatterns,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["patterns", userId] });
      void client.invalidateQueries({ queryKey: ["themes", userId] });
    },
  });

  if (!showFindings) {
    return (
      <>
        <div className="p-head">
          <div>
            <span className="kicker">Patterns</span>
            <h1>Turned off</h1>
          </div>
        </div>
        <Empty label="Everything you have written is still kept, and nothing here has been deleted." />
        <button className="btn go on" onClick={() => setFindings(true)}>
          SHOW PATTERNS AGAIN
        </button>
      </>
    );
  }

  const found = patterns.data ?? [];
  const busiest = Math.max(1, ...found.map((p) => p.occurrences));

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Patterns</span>
          <h1>What keeps returning</h1>
        </div>
        <button className="btn" disabled={mine.isPending} onClick={() => mine.mutate()}>
          {mine.isPending ? "LOOKING…" : "LOOK AGAIN"}
        </button>
      </div>

      {patterns.isLoading ? (
        <Loading />
      ) : patterns.isError ? (
        <Failed />
      ) : found.length === 0 ? (
        <Empty label="Nothing has come back often enough to call a pattern yet." />
      ) : (
        found.map((p) => <PatternCard key={p.id} pattern={p} busiest={busiest} />)
      )}

      {(themes.data ?? []).length > 0 && (
        <>
          <div className="grp">
            <span className="kicker">Regions</span>
          </div>
          {themes.data!.map((t) => (
            <Link key={t.id} to={`/theme/${t.id}`} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{t.label}</b>
                <span className="mono">{t.member_count} things</span>
              </div>
            </Link>
          ))}
        </>
      )}
    </>
  );
}

function PatternCard({ pattern, busiest }: { pattern: Pattern; busiest: number }) {
  const ordered = pattern.detector === "lag" || pattern.detector === "same-day-order";
  return (
    <Link
      to={ordered ? `/pattern/${pattern.id}` : `/node/${pattern.id}`}
      className={`card p-row${pattern.tentative ? " hollow" : ""}`}
    >
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{pattern.label}</b>
        <span className="mono">{DETECTOR_LABEL[pattern.detector] ?? pattern.detector}</span>
      </div>
      <div className="p-stripwrap">
        <span className="p-bar" style={{ width: `${Math.round((pattern.occurrences / busiest) * 100)}%` }} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Meter confidence={pattern.confidence} />
        <span className="mono">
          {pattern.distinct_days} {pattern.distinct_days === 1 ? "day" : "days"} · {fmt(pattern.confidence)}
        </span>
      </div>
    </Link>
  );
}
