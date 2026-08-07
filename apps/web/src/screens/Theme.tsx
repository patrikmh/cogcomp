import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Failed, Loading } from "@/components/States";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

/**
 * A region of a life, opened.
 *
 * A pattern says one thing keeps coming back; an association says two things
 * travel together. This says something neither can — that a *group* of things
 * is one area of your life — which makes it the densest claim here and the one
 * with the most room to be wrong. So it shows its working: the members, and how
 * many associations formed the region.
 */
export function Theme() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const theme = useQuery({ queryKey: ["theme", id], queryFn: () => api.theme(id) });

  // The heading says "in your words", so it has to be the person's words. The
  // theme read carries only each member's label, kind and confidence, and one
  // citing entry lives behind `explain` — a handful of small reads, keyed the
  // same way the node screen keys them, so opening a member afterwards is
  // already in cache.
  const evidence = useQueries({
    queries: (theme.data?.members ?? []).map((member) => ({
      queryKey: ["explain", member.id],
      queryFn: () => api.explain(member.id),
    })),
  });
  const quoteFor = new Map(
    (theme.data?.members ?? []).map((member, i) => [
      member.id,
      evidence[i]?.data?.derived_from?.[0]?.content,
    ]),
  );

  const judge = useMutation({
    mutationFn: (status: "hypothesis" | "user_confirmed" | "user_rejected") =>
      api.judge(id, status),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["theme", id] });
      void client.invalidateQueries({ queryKey: ["themes"] });
    },
  });

  if (theme.isLoading) return <Loading label="Reading the region…" />;
  if (theme.isError || !theme.data) return <Failed label="Could not load this region." />;

  const region = theme.data;
  const status = region.epistemic_status;

  return (
    <>
      <span className="kicker">A region of the graph</span>
      <h1>
        {region.member_count} things that keep arriving together
      </h1>
      <p className="sub">
        This is structure in what you wrote — an area where associations cluster. It is not a
        diagnosis, and it has no name until you give it one.
      </p>

      <h2>Members, in your words</h2>
      <div className="cards">
        {region.members.map((member) => (
          <Link className={`card${member.confidence < 0.5 ? " hollow" : ""}`} key={member.id} to={`/node/${member.id}`}>
            <b>{member.label}</b>
            <p className="quote" style={{ margin: "10px 0 0" }}>
              {quoteFor.get(member.id) ??
                `${member.kind.toLowerCase()} · ${fmt(member.confidence)}`}
            </p>
            <span className="mono" style={{ display: "block", marginTop: 8 }}>
              {member.kind.toLowerCase()} · {fmt(member.confidence)}
              {member.epistemic_status === "user_rejected" ? " · you rejected this" : ""}
            </span>
          </Link>
        ))}
      </div>

      <h2>How the region formed</h2>
      <div className="card">
        <p className="mono" style={{ margin: 0 }}>
          associated across {region.associations.length}{" "}
          {region.associations.length === 1 ? "pair" : "pairs"} · held since{" "}
          {new Date(region.first_seen_at).toLocaleDateString()} · last confirmed{" "}
          {new Date(region.last_confirmed_at).toLocaleDateString()}
        </p>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button
          className={`btn${status === "user_confirmed" ? " go on" : ""}`}
          onClick={() => judge.mutate(status === "user_confirmed" ? "hypothesis" : "user_confirmed")}
        >
          YES, THAT HOLDS
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
          ? "Kept on record, but no longer feeding patterns, comparisons or the graph."
          : "Saying “not really” stops this region feeding patterns, comparisons and the graph."}
      </p>

      <p className="rest mono">
        Regions are built from things appearing together and nothing else. No direction, no cause,
        and no claim about which of them came first.
      </p>
    </>
  );
}
