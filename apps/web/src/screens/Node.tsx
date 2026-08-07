import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { clockOf, dayLabelOf, fmt } from "@/lib/format";

/**
 * Where this came from.
 *
 * The screen the whole provenance design exists to make possible. Everywhere
 * else promises that an inference can be traced back to the person's own words;
 * this is where that promise is kept — and where they can say it is wrong.
 */
export function Node() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const explanation = useQuery({ queryKey: ["explain", id], queryFn: () => api.explain(id) });

  const judge = useMutation({
    mutationFn: (status: "hypothesis" | "user_confirmed" | "user_rejected") =>
      api.judge(id, status),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["explain", id] });
      // Rejecting removes it from everything derived from it, so the screens
      // showing those have to be told.
      void client.invalidateQueries({ queryKey: ["patterns"] });
      void client.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  if (explanation.isLoading) return <Loading label="Tracing provenance…" />;
  if (explanation.isError || !explanation.data) return <Failed />;

  const { node, derived_from, is_observed } = explanation.data;

  if (is_observed) {
    return (
      <>
        <span className="kicker">Where this came from</span>
        <h1>{node.label}</h1>
        <div className="row" style={{ gap: 12 }}>
          <span className="pill">observation · makes no claim</span>
        </div>
        <p className="sub" style={{ marginTop: 18 }}>
          You wrote this down. Nothing was inferred, so there is nothing to justify.
        </p>
      </>
    );
  }

  const confidence = node.confidence ?? 0;
  const status = node.epistemic_status ?? "hypothesis";
  const tentative = confidence < 0.5;

  return (
    <>
      <span className="kicker">Where this came from</span>
      <h1>{node.label}</h1>

      <div className="row" style={{ gap: 12 }}>
        <span className="pill">{node.kind.toLowerCase()}</span>
        <span className={`pill${tentative ? " tent" : ""}`}>
          {tentative ? "growing vague" : "confident"} · {fmt(confidence)}
        </span>
      </div>

      {tentative && (
        <p className="mono" style={{ marginTop: 12, color: "var(--faint)" }}>
          Below the threshold, so it is drawn as a guess rather than as knowledge. Saying yes keeps
          it.
        </p>
      )}

      <div className="row" style={{ marginTop: 18, gap: 14 }}>
        <Meter confidence={confidence} />
        <span className="mono">0.50 threshold marked</span>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button
          className={`btn${status === "user_confirmed" ? " go on" : ""}`}
          onClick={() => judge.mutate(status === "user_confirmed" ? "hypothesis" : "user_confirmed")}
        >
          YES
        </button>
        <button
          className={`btn ghost warn${status === "user_rejected" ? " on" : ""}`}
          onClick={() => judge.mutate(status === "user_rejected" ? "hypothesis" : "user_rejected")}
        >
          NOT REALLY
        </button>
      </div>
      <p className="mono" style={{ marginTop: 12 }}>
        {status === "user_rejected"
          ? "Kept on record, but no longer feeding patterns, week comparisons or the graph. Tap again to withdraw."
          : status === "user_confirmed"
            ? "Kept. It will not be absorbed into another reading. Tap again to withdraw."
            : "Saying “not really” stops this feeding patterns, week comparisons and the graph. Tap again to withdraw."}
      </p>

      <h2>Evidence · every citing entry</h2>
      <div className="cards">
        {derived_from.map((source) => (
          <div className="card" key={source.id}>
            <span className="kicker">
              {/* The same stamp the journal uses. An entry should be recognisable
                  as the same entry wherever it is shown, and a raw locale string
                  with seconds in it is not how anyone remembers a moment. */}
              {dayLabelOf(source.captured_at)} · {clockOf(source.captured_at)}
              {source.source === "voice" && " · spoken"}
              {source.recall_days > 0 &&
                ` · written ${source.recall_days} ${source.recall_days === 1 ? "day" : "days"} later`}
            </span>
            <p style={{ margin: "10px 0 0" }}>{source.content}</p>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <span className="mono">extracted by {node.extractor ?? "unknown"}</span>
        <Link className="btn ghost" to="/agents">
          HOW THIS WAS PRODUCED
        </Link>
      </div>
    </>
  );
}
