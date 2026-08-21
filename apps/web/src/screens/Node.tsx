import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Meter } from "@/components/Meter";
import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { aboutOf, amongReadingsOf, arcsOf, contradictsOf, feltTowardOf, indicatesOf, regionsOfReading, supportsOf, travelsWithOf } from "@/lib/drawn-from";
import { usePreferences } from "@/state/preferences";
import { fmt, stampOf } from "@/lib/format";
import { Guide } from "@/components/Guide";
import { HEADINGS } from "@tlon/copy/headings";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

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
  const showFindings = usePreferences((s) => s.findings);
  const observations = useQuery({
    queryKey: ["observations", "node", id],
    queryFn: () => api.observations(500),
    enabled: !showFindings,
  });
  const explanation = useQuery({
    queryKey: ["explain", id],
    queryFn: () => api.explain(id),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    enabled: showFindings,
  });
  const patterns = useQuery({
    queryKey: ["patterns"],
    queryFn: api.patterns,
    enabled: showFindings,
  });
  const neighbours = useQuery({
    queryKey: ["neighbours", id],
    queryFn: () => api.neighbours(id),
    enabled: showFindings && Boolean(id),
  });
  const themes = useQuery({
    queryKey: ["themes"],
    queryFn: api.themes,
    enabled: showFindings,
  });
  const experiments = useQuery({
    queryKey: ["experiments", showFindings],
    queryFn: () => api.experiments(showFindings),
    enabled: showFindings,
  });

  const judge = useMutation({
    mutationFn: (status: "hypothesis" | "user_confirmed" | "user_rejected") =>
      api.judge(id, status),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["explain", id] });
      // Rejecting removes it from everything derived from it, so the screens
      // showing those have to be told.
      void client.invalidateQueries({ queryKey: ["patterns"] });
      void client.invalidateQueries({ queryKey: ["summary"] });
      // The two clients had different lists here, each missing what the other
      // remembered. These are the rest: the map and the graph draw the reading,
      // the identity screen offers it, and a comparison between two weeks
      // counts it.
      void client.invalidateQueries({ queryKey: ["graph"] });
      void client.invalidateQueries({ queryKey: ["identity"] });
      void client.invalidateQueries({ queryKey: ["temporal"] });
    },
  });

  if (!showFindings) {
    if (observations.isLoading) return <Loading label="Reading your journal…" />;
    const observation = observations.data?.observations.find((entry) => entry.id === id);
    if (!observation) return <Failed label="This finding is hidden while findings are off." />;
    return (
      <>
        <span className="kicker">Your journal</span>
        <h1>{observation.content}</h1>
        <div className="row" style={{ gap: 12 }}>
          <span className="pill">observation</span>
          <span className="pill">raw entry · no reading</span>
        </div>
        <p className="sub" style={{ marginTop: 18 }}>
          This is what you wrote. Findings are off, so no derived reading or provenance is shown.
        </p>
      </>
    );
  }

  if (explanation.isLoading) return <Loading label="Tracing provenance…" />;
  if (explanation.isError || !explanation.data) return <Failed onRetry={() => void explanation.refetch()} />;

  const { node, derived_from, is_observed } = explanation.data;

  if (is_observed) {
    return (
      <>
        <span className="kicker">{HEADINGS.node.kicker}</span>
        <h1>{node.label}</h1>
        {/* The kind first, then what it is not. The design shows both on an
            entry as it does on a reading; this showed only the second, so an
            entry was the one node that never said what kind of thing it was. */}
        <div className="row" style={{ gap: 12 }}>
          <span className="pill">{node.kind.toLowerCase()}</span>
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
  const among = amongReadingsOf(neighbours.data?.neighbours ?? [], patterns.data ?? []);
  const company = travelsWithOf(
    id,
    neighbours.data?.neighbours ?? [],
    neighbours.data?.edges ?? [],
  );
  const regions = regionsOfReading(node.label, themes.data ?? []);
  const aimed = feltTowardOf(id, neighbours.data?.neighbours ?? [], neighbours.data?.edges ?? []);
  const spoken = aboutOf(id, neighbours.data?.neighbours ?? [], neighbours.data?.edges ?? []);
  const hinted = indicatesOf(id, neighbours.data?.neighbours ?? [], neighbours.data?.edges ?? []);
  const tension = contradictsOf(id, neighbours.data?.neighbours ?? [], neighbours.data?.edges ?? []);
  const backing = supportsOf(id, neighbours.data?.neighbours ?? [], neighbours.data?.edges ?? []);
  const wondered = arcsOf(id, experiments.data?.experiments ?? []);

  return (
    <>
      <span className="kicker">{HEADINGS.node.kicker}</span>
      <div className="guide-heading">
        <h1>{node.label}</h1>
        <Guide id="node" />
      </div>

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
              {stampOf(source.captured_at)}
              {source.source === "voice" && " · spoken"}
              {source.recall_days > 0 &&
                ` · written ${source.recall_days} ${source.recall_days === 1 ? "day" : "days"} later`}
            </span>
            <p style={{ margin: "10px 0 0" }}>{source.content}</p>
          </div>
        ))}
      </div>

      {aimed.toward.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.toward.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("toward")}</span>
          </div>
          {aimed.toward.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {aimed.from.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.towardThis.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("towardThis")}</span>
          </div>
          {aimed.from.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {spoken.about.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.about.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("about")}</span>
          </div>
          {spoken.about.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {spoken.aboutThis.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.aboutThis.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("aboutThis")}</span>
          </div>
          {spoken.aboutThis.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {hinted.hints.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.hints.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("hints")}</span>
          </div>
          {hinted.hints.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {hinted.hinted.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.hinted.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("hinted")}</span>
          </div>
          {hinted.hinted.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {tension.against.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.against.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("against")}</span>
          </div>
          {tension.against.map((reading) => (
            <Link
              key={reading.id}
              className="t-circle"
              to={reading.kind === "Pattern" ? `/pattern/${reading.id}` : `/node/${reading.id}`}
            >
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {tension.againstThis.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.againstThis.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("againstThis")}</span>
          </div>
          {tension.againstThis.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {backing.holdsUp.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.holdsUp.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("holdsUp")}</span>
          </div>
          {backing.holdsUp.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {backing.heldUp.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.heldUp.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("heldUp")}</span>
          </div>
          {backing.heldUp.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
            </Link>
          ))}
        </>
      )}

      {among.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.among.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("among")}</span>
          </div>
          {among.map((pattern) => (
            <Link key={pattern.id} className="t-circle" to={`/pattern/${pattern.id}`}>
              <b>{pattern.label.split(" · ")[0]}</b>
              <span className="mono go">the pattern →</span>
            </Link>
          ))}
        </>
      )}

      {company.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.travels.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("travels")}</span>
          </div>
          {company.map((reading) => (
            <Link key={reading.id} className="t-circle" to={`/node/${reading.id}`}>
              <b>{reading.label}</b>
              <span className="mono">{reading.kind.toLowerCase()}</span>
              <span className="mono go">the reading →</span>
            </Link>
          ))}
        </>
      )}

      {regions.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.inRegion.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("inRegion")}</span>
          </div>
          {regions.map((theme) => (
            <Link key={theme.id} className="t-circle" to={`/theme/${theme.id}`}>
              <b>{theme.label}</b>
              <span className="mono">{theme.member_count} things</span>
              <span className="mono go">the region →</span>
            </Link>
          ))}
        </>
      )}

      {wondered.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">{SECTIONS.wondered.title}</span>
            <span className="rule" />
            <span className="mono">{asideOf("wondered")}</span>
          </div>
          {wondered.map((trial) => (
            <Link key={trial.id} className="t-circle" to={`/experiment/${trial.id}`}>
              <b>{trial.title}</b>
              <span className="mono">{trial.state}</span>
              <span className="mono go">the trial →</span>
            </Link>
          ))}
        </>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <span className="mono">extracted by {node.extractor ?? "unknown"}</span>
        <Link className="btn ghost" to="/agents">
          HOW THIS WAS PRODUCED
        </Link>
      </div>
    </>
  );
}
