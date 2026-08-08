import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { seed } from "@/lib/seal";

/**
 * Identity, drawn as concentric contours.
 *
 * The same harmonic language as the entry seals and the headspace map, at the
 * middle of the three scales. Each ring is one reading: kept readings are inked,
 * offered ones are ghosted, and the core is you.
 *
 * The rings draw themselves on, one after another. That is not decoration — the
 * screen's argument is that this is *assembled*, not stated, and watching it be
 * drawn says so before any of the copy does. It respects
 * `prefers-reduced-motion`: with motion reduced the rings are simply there.
 */
export interface Ring {
  id: string;
  label: string;
  kind: string;
  confidence: number;
  kept: boolean;
  tentative: boolean;
  /** A reading the person took back. Drawn as a dashed tombstone rather than
   *  deleted — the record that it was removed is part of the record. */
  removed?: boolean;
  /** What the caption says about it: its kind, and whether it is kept. */
  evidence?: string;
}

/** How many loops a ring is drawn with — detail is confidence, made visible.
 *
 *  Two unless the reading is tentative or removed. This used to give the second
 *  loop only to *kept* readings, so a confidently offered one was drawn as
 *  faintly as a doubtful one. The rule is about how sure the reading is, not
 *  about whether you have answered it yet. */
export function loopsOf(ring: Pick<Ring, "tentative" | "removed">): number[] {
  return !ring.tentative && !ring.removed ? [0, 1] : [0];
}

export function IdentityComposition({
  rings,
  onHover,
  children,
}: {
  rings: Ring[];
  onHover: (ring: Ring | null) => void;
  /** The caption. It lives inside the stage because the stage is the flex
   *  column that centres it under the composition. */
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const composition = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = composition.current;
    if (!svg) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Not the core. The design strokes the readings on and leaves you already
    // drawn, which is the right way round: the readings accumulate around a
    // person who was there first. Animating the core too made the self arrive
    // on the same terms as an observation about it.
    const paths = Array.from(
      svg.querySelectorAll<SVGPathElement>(".id-ring:not(.id-core) .id-path"),
    );

    if (reduced) {
      paths.forEach((path) => {
        path.style.strokeDasharray = "none";
        path.style.strokeDashoffset = "0";
      });
      return;
    }

    // Draw each ring on with its own stroke, staggered outward.
    paths.forEach((path, i) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      path.style.transition = "stroke-dashoffset 1100ms cubic-bezier(.22,.61,.36,1)";
      window.setTimeout(() => {
        path.style.strokeDashoffset = "0";
      }, 140 + i * 95);
    });

    // And then it breathes, very slightly, so the picture is alive without
    // moving. Stopped on unmount so navigating away leaves nothing running.
    let alive = true;
    let raf = 0;
    const start = performance.now();
    const breathe = (now: number) => {
      if (!alive) return;
      const t = (now - start) / 1000;
      svg.style.transform = `scale(${1 + Math.sin(t * 0.5) * 0.012})`;
      raf = requestAnimationFrame(breathe);
    };
    raf = requestAnimationFrame(breathe);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [rings]);

  return (
    <div className="id-stage">
      <svg
        className="id-comp"
        viewBox="0 0 280 280"
        ref={composition}
        role="img"
        aria-label="What has been noticed about you, as rings"
      >
        {rings.map((ring, i) => (
          <g
            key={ring.id}
            className={`id-ring${
              ring.removed ? " tomb" : ring.tentative ? " tent" : ring.kept ? "" : " obs"
            }`}
            onMouseEnter={() => onHover(ring)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(ring)}
            onClick={() => navigate(`/node/${ring.id}`)}
            tabIndex={0}
            role="button"
            aria-label={`${ring.label}, ${ring.kind.toLowerCase()}`}
          >
            {loopsOf(ring).map((k) => (
              <path
                key={k}
                className="id-path"
                d={loop(ring.id + k, 24 + i * 14 - k * 5, 0.86 + (i % 3) * 0.05)}
              />
            ))}
          </g>
        ))}
        {/* You, at the centre: inked heavier than anything drawn around it. */}
        <g className="id-ring id-core" aria-hidden>
          <path className="id-path" d={loop("you-core", 9, 0.92)} />
          <path className="id-path" d={loop("you-core2", 15, 0.9)} />
          <path className="id-path" d={loop("you-core3", 22, 0.94)} />
          <circle className="id-eye" cx="140" cy="140" r="2.2" />
        </g>
      </svg>
      {children}
    </div>
  );
}

/** One organic contour loop: three harmonics and a seeded squash. */
function loop(key: string, baseR: number, squash: number) {
  const rnd = seed(key);
  const harmonics = [0, 1, 2].map(() => ({
    f: 2 + Math.floor(rnd() * 4),
    a: 0.04 + rnd() * 0.12,
    p: rnd() * Math.PI * 2,
  }));
  let d = "";
  for (let i = 0; i <= 96; i++) {
    const th = (i / 96) * Math.PI * 2;
    let r = baseR;
    for (const h of harmonics) r += baseR * h.a * Math.sin(th * h.f + h.p);
    const x = 140 + Math.cos(th) * r;
    const y = 140 + Math.sin(th) * r * squash;
    d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
  }
  return d + "Z";
}
