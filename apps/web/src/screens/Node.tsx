import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

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
        <div className="p-head">
          <div>
            <span className="kicker">Your entry</span>
            <h1>{node.label}</h1>
          </div>
        </div>
        <p className="rest">
          This is something you wrote. Everything else in the graph is drawn from entries like this
          one — it makes no claim, so there is nothing here to agree or disagree with.
        </p>
      </>
    );
  }

  const confidence = node.confidence ?? 0;
  const status = node.epistemic_status ?? "hypothesis";

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Evidence chain</span>
          <h1>{node.label}</h1>
        </div>
        <span className="mono">
          {node.kind.toLowerCase()} · {fmt(confidence)}
        </span>
      </div>

      <div className="row">
        <Meter confidence={confidence} />
        <span className="mono">{confidence < 0.5 ? "a tentative guess" : "a guess"}</span>
      </div>

      <div className="grp">
        <span className="kicker">Does this match how it was?</span>
      </div>
      <div className="row">
        <button
          className={`btn${status === "user_confirmed" ? " go on" : ""}`}
          onClick={() => judge.mutate(status === "user_confirmed" ? "hypothesis" : "user_confirmed")}
        >
          YES
        </button>
        <button
          className={`btn${status === "user_rejected" ? " on" : ""}`}
          onClick={() => judge.mutate(status === "user_rejected" ? "hypothesis" : "user_rejected")}
        >
          NOT REALLY
        </button>
      </div>
      {status === "user_rejected" && (
        // The consequence is stated where the action is — that is what makes
        // disagreeing worth the tap.
        <p className="sub mono">Kept on record, but no longer counted toward patterns or changes.</p>
      )}

      <p className="sub">
        This is a hypothesis drawn from your own words, not a conclusion about you. It came from:
      </p>

      {derived_from.map((source) => (
        <div className="quote" key={source.id}>
          <p>{source.content}</p>
          <span className="mono" style={{ color: "var(--faint)" }}>
            {new Date(source.captured_at).toLocaleString()} · {source.source}
            {source.recall_days > 0 &&
              ` · written ${source.recall_days} ${source.recall_days === 1 ? "day" : "days"} later`}
          </span>
        </div>
      ))}

      <div className="card">
        <span className="kicker">How this was produced</span>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono">Status</span>
          <span className="mono">{status}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono">Extracted by</span>
          <span className="mono">{node.extractor ?? "unknown"}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono">Recorded</span>
          <span className="mono">{new Date(node.created_at).toLocaleString()}</span>
        </div>
      </div>
    </>
  );
}
