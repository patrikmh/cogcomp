import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { IdentityComposition, type Ring } from "@/components/IdentityComposition";
import { Failed, Loading } from "@/components/States";
import { api, type IdentityNode } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useSession } from "@/state/session";
import { Guide } from "@/components/Guide";

/**
 * Identity, as a composition.
 *
 * Not a profile. Each ring is a reading the record holds — the surer ones sit
 * closer, the tentative ones drift out and lose detail, and the dense core is
 * you. Nothing here is generated and no name is assigned: a profile page states
 * what you are, this shows what has been noticed and leaves the rest visible
 * but unclaimed.
 *
 * Removed readings stay as tombstones. The record that something *was* removed
 * is part of the record, and losing it would make the removal unaccountable.
 */
/** The rings the composition draws, in the order it draws them.
 *
 *  Kept readings come first, then offered ones, each surest-first inside its own
 *  group. Sorting the two together by confidence alone put the picture badly at
 *  odds with the heading above it: on a real account, thirty-nine offered
 *  readings outranked the one thing the person had actually kept, so a screen
 *  titled "Drawn from everything you kept" drew none of it, and filled all seven
 *  rings with `took the stairs` and `made coffee` instead. Extraction is surest
 *  about the most literal things, which is exactly why confidence alone is the
 *  wrong order for this particular picture.
 */
export function ringsFor(
  selected: IdentityNode[],
  candidates: IdentityNode[],
  removed: IdentityNode[],
): Ring[] {
  const surestFirst = (a: IdentityNode, b: IdentityNode) =>
    (b.confidence ?? 0) - (a.confidence ?? 0);

  return [
    ...[...selected].sort(surestFirst).concat([...candidates].sort(surestFirst))
      // The composition is a picture of the record, not its inventory — the
      // lists below hold every reading. Beyond seven or so rings the loops stop
      // reading as nested contours and become a scribble, which says less than
      // seven honest ones do. The design draws seven.
      .slice(0, 7)
      .map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        confidence: n.confidence ?? 0,
        kept: n.status === "selected",
        tentative: n.tentative,
        removed: false,
        evidence: `${n.kind.toLowerCase()}${n.status === "selected" ? " · kept" : " · offered"}`,
      })),
    ...removed.slice(0, 1).map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      confidence: 0,
      kept: false,
      tentative: false,
      removed: true,
      evidence: "removed · reversible",
    })),
  ];
}

export function Identity() {
  const userId = useSession((s) => s.userId);
  const client = useQueryClient();
  const [hovered, setHovered] = useState<Ring | null>(null);

  // Tombstones are asked for here, because this is the one screen that draws
  // them — a removal you cannot see is a decision you cannot reconsider.
  const kept = useQuery({ queryKey: ["identity", userId], queryFn: () => api.identity(true) });
  const offered = useQuery({
    queryKey: ["identity", "candidates", userId],
    queryFn: api.identityCandidates,
  });

  const invalidate = () => void client.invalidateQueries({ queryKey: ["identity"] });
  const keep = useMutation({ mutationFn: api.keep, onSuccess: invalidate });
  const unkeep = useMutation({ mutationFn: api.unkeep, onSuccess: invalidate });

  if (kept.isLoading || offered.isLoading) return <Loading />;
  if (kept.isError || offered.isError) return <Failed />;

  const nodes = kept.data?.nodes ?? [];
  const selected = nodes.filter((n) => n.status === "selected");
  const removed = nodes.filter((n) => n.status === "removed");
  const candidates = offered.data?.candidates ?? [];
  const tentative = [...selected, ...candidates].filter((n) => n.tentative);
  const kinds = new Set([...selected, ...candidates].map((n) => n.kind)).size;

  const rings = ringsFor(selected, candidates, removed);

  return (
    <>
      <span className="kicker">Identity · a composition</span>
      <div className="guide-heading">
        <h1>Drawn from everything you kept</h1>
        <Guide id="identity" />
      </div>
      <p className="sub">
        Not a profile. Each ring is a reading the record holds — the surer ones sit closer, the
        tentative ones drift out and lose detail. Nothing here is generated, and no name is
        assigned.
      </p>

      <IdentityComposition rings={rings} onHover={setHovered}>
        <div className="id-cap">
          {hovered ? (
            <>
              <b>{hovered.label}</b>{" "}
              <span className="mono">
                {hovered.evidence}
                {hovered.confidence > 0 ? ` · ${fmt(hovered.confidence)}` : ""}
              </span>
            </>
          ) : rings.length === 0 ? (
            // Nothing to hover, so nothing is promised. The core stays: there is
            // a point of view here even before anything has been noticed.
            <span className="rest">
              Nothing has been noticed yet. Readings appear once there are entries to draw them from.
            </span>
          ) : (
            <span className="rest">Hover a ring to see what it is. The dense core is you.</span>
          )}
        </div>
      </IdentityComposition>

      <div className="id-sum">
        <Count n={selected.length} label="KEPT" />
        <Count n={tentative.length} label="TENTATIVE" tent />
        <Count n={kinds} label="KINDS" />
        <Count n={removed.length} label="REMOVED" tent />
      </div>

      {candidates.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">Offered, not claimed</span>
            <span className="rule" />
            <span className="mono">keeping one is yours to do</span>
          </div>
          {candidates.map((node) => (
            <Row key={node.id} node={node} action="KEEP" onAction={() => keep.mutate(node.id)} />
          ))}
        </>
      )}

      {selected.length > 0 && (
        <>
          <div className="t-sec">
            <span className="kicker">Kept</span>
            <span className="rule" />
            <span className="mono">protected from consolidation</span>
          </div>
          {selected.map((node) => (
            <Row key={node.id} node={node} action="REMOVE" onAction={() => unkeep.mutate(node.id)} />
          ))}
        </>
      )}

      <p className="mono" style={{ margin: "22px auto 0", maxWidth: "60ch", textAlign: "center" }}>
        Kept readings are protected from consolidation — they will not be absorbed into another
        node. Removed ones stay as a tombstone, so the record that they were removed is never lost.
      </p>
    </>
  );
}

function Count({ n, label, tent }: { n: number; label: string; tent?: boolean }) {
  return (
    <div className={`id-kc${tent ? " tent" : ""}`}>
      <div className="n">{n}</div>
      <div className="k">{label}</div>
    </div>
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
    <div className={`t-read${node.tentative ? " ghost" : ""}`}>
      <span className="t-main">
        <Link to={`/node/${node.id}`}>
          <b>{node.label}</b>
        </Link>
        <span className="mono">
          {node.kind.toLowerCase()} · {fmt(node.confidence ?? 0)}
        </span>
      </span>
      <span className="t-side">
        <button className="btn ghost" onClick={onAction}>
          {action}
        </button>
      </span>
    </div>
  );
}
