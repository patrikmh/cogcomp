import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { IdentityComposition, type Ring } from "@/components/IdentityComposition";
import { Failed, Loading } from "@/components/States";
import { api, type IdentityNode } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useSession } from "@/state/session";

/**
 * Identity, as something you assemble rather than something you are told.
 *
 * Everything the extractor has ever suggested is here at once. What you have
 * kept is lit; what has only been suggested is hollow. Nothing moves between
 * those states except by you — a profile page states what you are, this shows
 * what has been noticed and leaves the rest visible but unclaimed.
 */
export function Identity() {
  const userId = useSession((s) => s.userId);
  const client = useQueryClient();

  const [hovered, setHovered] = useState<Ring | null>(null);
  const kept = useQuery({ queryKey: ["identity", userId], queryFn: api.identity });
  const offered = useQuery({
    queryKey: ["identity", "candidates", userId],
    queryFn: api.identityCandidates,
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["identity"] });
  };
  const keep = useMutation({ mutationFn: api.keep, onSuccess: invalidate });
  const unkeep = useMutation({ mutationFn: api.unkeep, onSuccess: invalidate });

  if (kept.isLoading || offered.isLoading) return <Loading />;
  if (kept.isError || offered.isError) return <Failed />;

  const selected = (kept.data?.nodes ?? []).filter((n) => n.status === "selected");
  const candidates = offered.data?.candidates ?? [];

  return (
    <>
      <div className="p-head">
        <div>
          <span className="kicker">Identity</span>
          <h1>What you have kept</h1>
        </div>
        <span className="mono">{selected.length} kept</span>
      </div>

      {/* The picture is the data: what you kept is inked, what is merely
          offered is ghosted, and only your tap moves anything between them. */}
      <IdentityComposition
        rings={[...selected, ...candidates].slice(0, 11).map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind,
          confidence: n.confidence ?? 0,
          kept: n.status === "selected",
          tentative: n.tentative,
        }))}
        onHover={setHovered}
      />
      <div className="id-cap mono">
        {hovered
          ? `${hovered.label} · ${hovered.kind.toLowerCase()} · ${fmt(hovered.confidence)}${hovered.kept ? " · kept" : " · offered"}`
          : "Point at a ring. Tap it to see where it came from."}
      </div>

      {selected.length === 0 ? (
        <p className="sub">
          Nothing kept yet. Below is what has been noticed — keeping one says it is yours, and
          protects it from being merged away.
        </p>
      ) : (
        selected.map((node) => (
          <Row key={node.id} node={node} action="REMOVE" onAction={() => unkeep.mutate(node.id)} />
        ))
      )}

      <div className="grp">
        <span className="kicker">Offered, not claimed</span>
      </div>
      {candidates.length === 0 ? (
        <p className="sub mono">Nothing to offer yet.</p>
      ) : (
        candidates.map((node) => (
          <Row key={node.id} node={node} action="KEEP" onAction={() => keep.mutate(node.id)} />
        ))
      )}
    </>
  );
}

function Row({
  node,
  action,
  onAction,
}: {
  node: IdentityNode;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className={`card${node.tentative ? " hollow" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link to={`/node/${node.id}`}>
          <b>{node.label}</b>
        </Link>
        <span className="mono">
          {node.kind.toLowerCase()} · {fmt(node.confidence ?? 0)}
        </span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onAction}>
          {action}
        </button>
      </div>
    </div>
  );
}
