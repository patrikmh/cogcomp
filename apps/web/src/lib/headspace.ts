import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * The headspace, as a topographic chart.
 *
 * Ported from the design prototype's `initOrb`. Every centre of gravity is
 * drawn the way the wordmark draws its letters — concentric organic rings, three
 * harmonics and a seeded elliptical squash, so the loops read like hand-drawn
 * contours rather than smooth ripples. Radii and ring counts are *data*: a
 * pattern's size is how often it recurred, a reading's is how sure it is.
 *
 * Three decisions are load-bearing and were kept exactly:
 *
 * **Read from directly above.** A topographic map keeps its north; auto-rotate
 * is off. Position carries no meaning beyond "not on top of anything else",
 * which is why the settle below only pushes peaks apart.
 *
 * **Line art needs no lights.** The scene has none — the ink is ink, not
 * plastic. Depth comes from fog, and mass from a whisper of hillshade.
 *
 * **Tentative whorls are ghosted, not hidden.** A reading below the threshold
 * sheds opacity rather than disappearing, so what is uncertain stays visible as
 * uncertain.
 */

const INK = 0xeef1ec;

/**
 * When each kind of whorl lands, in seconds into the camera's settle.
 *
 * You are already there. The patterns follow, spaced widest because they are
 * the fewest and the largest; the readings come after in a quicker run; today
 * lands last, on top of the record it belongs to.
 */
const ARRIVE_AT: Record<string, (i: number) => number> = {
  you: () => 0,
  pattern: (i) => 0.35 + i * 0.22,
  reading: (i) => 1.1 + i * 0.15,
  today: () => 2.2,
};

/** Back-out easing: a slight overshoot, so a peak is placed rather than faded. */
function backOut(k: number) {
  if (k >= 1) return 1;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}
const R = 0.115;

export interface Whorl {
  id: string;
  label: string;
  /** The datum etched along the contours, survey-map style ("9 / 14", "0.91"). */
  meta: string;
  /** 0–1. Drives radius, ring count and how solid the ink reads. */
  weight: number;
  tentative: boolean;
  tint: number;
  href?: string;
  group: "pattern" | "reading" | "today" | "you";
  /** What the readout says about this kind of thing. A pattern and a reading
   *  are different claims and are read out differently. */
  kicker: string;
  readout: string;
  /** 0–1 for the readout's bar, or 0 for no bar. */
  bar: number;
}

export interface Stage {
  focus: (id: string | null) => void;
  setVisible: (groups: Whorl["group"][]) => void;
  setPaused: (paused: boolean) => void;
  dispose: () => void;
}

/** Deterministic hash — the same id always settles in the same place. */
function seeded(str: string) {
  let x = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i) + i * 0x85ebca6b;
    x = Math.imul(x ^ (x >>> 15), 0x2545f491);
    x = (x ^ (x >>> 13)) >>> 0;
  }
  return (x >>> 8) / 0x1000000;
}

export function mountHeadspace(
  host: HTMLElement,
  whorls: Whorl[],
  onFocus: (whorl: Whorl | null) => void,
): Stage {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x0a0d0c, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Whatever is further away dissolves into the dark.
  scene.fog = new THREE.FogExp2(0x0a0d0c, 0.15);

  const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.01, 12);
  // Framed after the settle below, once the massif's real extent is known.
  camera.position.set(0, R * 5.1, R * 2.05);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // A topo map keeps its north.
  controls.autoRotate = false;
  controls.enablePan = false;
  controls.minDistance = R * 2.2;
  controls.maxDistance = R * 9;

  const model = new THREE.Group();
  scene.add(model);

  /* --------------------------------------------------------- the sprites */
  const glowTexture = (() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const g = canvas.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.28, "rgba(255,255,255,.5)");
    grad.addColorStop(0.62, "rgba(255,255,255,.1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  })();

  /** A whisper of tonal ground, so a peak has terrain mass and not just lines. */
  function hillshade(radius: number, opacity: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xdfe6dc,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.scale.setScalar(radius * 3.1);
    sprite.position.y = -R * 0.03;
    return sprite;
  }

  /** The cartographer's label: the datum the whorl is shaped by, laid flat. */
  function surveyLabel(text: string, radius: number, opacity: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 80;
    const g = canvas.getContext("2d")!;
    g.font = '500 38px "IBM Plex Mono", ui-monospace, monospace';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.fillText(text, 160, 42);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    // Sized against the stage, not the whorl. Scaled by radius a small reading
    // got a label too small to read at any zoom the map is actually viewed at,
    // which is the reading whose confidence you most want to know.
    const h = R * 0.075;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(h * 4, h),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity,
        color: INK,
        depthWrite: false,
        depthTest: false,
      }),
    );
    plane.renderOrder = 2;
    plane.rotation.x = -Math.PI / 2;
    // Above the whorl in plan view rather than on top of it — a survey map
    // writes the height beside the contour, never across it.
    plane.position.y = radius * 0.5;
    plane.position.z = -(radius + h * 0.75);
    return plane;
  }

  /* -------------------------------------------------------- the contours */
  interface Breather {
    line: THREE.Line;
    level: number;
    speed: number;
    phase: number;
    base: { x: Float32Array; z: Float32Array };
  }
  const breathers: Breather[] = [];

  function contour(
    key: string,
    radius: number,
    levels: number,
    opts: { top?: number; wob?: number; lift?: number; detail?: number; warp?: Warp[] } = {},
  ) {
    const { top = 0.5, wob = 1, lift = 0.1, detail = 0, warp } = opts;
    const group = new THREE.Group();
    const mats: THREE.LineBasicMaterial[] = [];
    const SEG = 128;

    const rx = 1 + (seeded(key + "sx") - 0.5) * 0.3;
    const ry = 1 + (seeded(key + "sy") - 0.5) * 0.3;
    const harm = (h: string) => ({
      a: (0.04 + 0.09 * seeded(key + h + "a")) * wob,
      f: 1 + Math.floor(seeded(key + h + "f") * 3),
      ph: seeded(key + h + "p") * Math.PI * 2,
    });
    const h1 = harm("1");
    const h2 = harm("2");
    const h3 = harm("3");

    const addRing = (
      level: number,
      ringRadius: number,
      baseOpacity: number,
      py: number,
      scale = 1,
    ) => {
      const points: THREE.Vector3[] = [];
      const bx = new Float32Array(SEG + 1);
      const bz = new Float32Array(SEG + 1);
      for (let s = 0; s <= SEG; s++) {
        const th = (s / SEG) * Math.PI * 2;
        const r =
          ringRadius *
          (1 +
            h1.a * Math.sin(h1.f * th + h1.ph) +
            h2.a * Math.sin(h2.f * th + h2.ph) +
            h3.a * 0.5 * Math.sin(h3.f * th + h3.ph));
        let x = Math.cos(th) * r * rx;
        let z = Math.sin(th) * r * ry;
        // Gravity: the ring leans toward every other whorl. Pull falls off with
        // distance², outer rings bend most, capped so it stays a lean rather
        // than a merge — neighbours adapt to each other without touching.
        if (warp) {
          let ox = 0;
          let oz = 0;
          for (const a of warp) {
            const vx = a.dx - x;
            const vz = a.dz - z;
            const f = (a.m * scale) / (vx * vx + vz * vz + a.soft);
            ox += vx * f;
            oz += vz * f;
          }
          const om = Math.hypot(ox, oz);
          const cap = radius * 0.13 * scale;
          if (om > cap && om > 0) {
            ox = (ox / om) * cap;
            oz = (oz / om) * cap;
          }
          x += ox;
          z += oz;
        }
        bx[s] = x;
        bz[s] = z;
        points.push(new THREE.Vector3(x, 0, z));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: INK,
        transparent: true,
        opacity: baseOpacity,
      });
      material.userData.baseOp = baseOpacity;
      const line = new THREE.Line(geometry, material);
      line.position.y = py;
      breathers.push({
        line,
        level,
        speed: 0.22 + 0.3 * seeded(key + level + "s"),
        phase: seeded(key + level + "h") * Math.PI * 2,
        base: { x: bx, z: bz },
      });
      mats.push(material);
      group.add(line);
    };

    for (let l = 0; l < levels; l++) {
      const rl = (radius * (l + 1)) / levels;
      const op = top * (0.78 + 0.22 * (1 - l / levels));
      // Index contours — the cartographer's hierarchy. The outer boundary and
      // every third ring inward are inked heavier, so a whorl reads at a glance
      // the way a survey map reads its index lines.
      const index = (levels - 1 - l) % 3 === 0 ? 1.7 : 1;
      addRing(l, rl, Math.min(0.95, op * index), ((levels - 1) / 2 - l) * radius * lift, (l + 1) / levels);
    }

    // Interior texture: a few small closed sub-loops, the fingerprint fill that
    // makes a whorl read as a contour map rather than a hollow ring.
    for (let i = 0; i < detail; i++) {
      const ir = radius * (0.1 + 0.22 * seeded(key + "d" + i + "r"));
      const sub = 2 + Math.floor(seeded(key + "d" + i + "l") * 2);
      for (let l = 0; l < sub; l++) {
        addRing(99 + i * 7 + l, (ir * (l + 1)) / sub, top * 0.5, ((sub - 1) / 2 - l) * ir * 0.6, 0.4);
      }
    }

    group.userData.mats = mats;
    return group;
  }

  interface Warp {
    dx: number;
    dz: number;
    m: number;
    soft: number;
  }

  /* ------------------------------------------------------- the massif */
  // Radii come from the data first; then a short settle pushes any two whorls
  // apart until no contour fields touch. Neighbours keep their ridge, but every
  // peak owns its ground.
  // Size is a property of the kind of thing, not one scale for everything. A
  // pattern that keeps returning is a massif and a single tentative reading is
  // a hillock, and the gap between them is most of what the map says: drawing
  // both at roughly one size made a field of identical dots that carried no
  // information at all.
  const radiusOf = (w: Whorl) => {
    if (w.group === "you") return R * 0.52;
    if (w.group === "pattern") return R * (0.18 + 0.46 * w.bar);
    if (w.group === "today") return R * (0.05 + 0.013 * w.weight * 14);
    return R * (0.05 + 0.18 * w.weight);
  };

  // And position is a property of the kind too. Patterns run in a chain across
  // the top of the map, readings in a chain below, today off to one side, and
  // you at the fixed point — a survey, not a scatter.
  const byGroup = (group: string) => whorls.filter((w) => w.group === group);
  const patterns = byGroup("pattern");
  const readings = byGroup("reading");
  const chainX = (i: number, n: number, span: number) =>
    n === 1 ? 0 : -span + (2 * span * i) / (n - 1);

  const placed = whorls.map((w) => {
    const radius = radiusOf(w);
    const spot = { x: 0, z: 0 };
    if (w.group === "pattern") {
      const i = patterns.indexOf(w);
      spot.x = chainX(i, patterns.length, R * 0.7);
      spot.z = -R * 0.5 + (seeded(w.id + "z") - 0.5) * R * 0.2;
    } else if (w.group === "reading") {
      // The design was drawn against seven readings; a real record holds
      // dozens. The span grows with the count so the chain keeps the density
      // it was drawn at instead of compressing into one mass — the alternative
      // was to draw fewer than there are, which is not the map's to decide.
      const i = readings.indexOf(w);
      const span = R * 0.85 * Math.max(1, Math.sqrt(readings.length / 7));
      spot.x = chainX(i, readings.length, span) + (seeded(w.id + "x") - 0.5) * R * 0.14;
      spot.z = R * 0.7 + (seeded(w.id + "z") - 0.5) * R * 0.5;
    } else if (w.group === "today") {
      spot.x = R * 0.6;
      spot.z = R * 0.14;
    } else {
      spot.z = R * 0.08;
    }
    return { whorl: w, radius, x: spot.x, z: spot.z, pinned: w.group === "you" };
  });

  for (let pass = 0; pass < 90; pass++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.0001;
        const want = (a.radius + b.radius) * 1.45;
        if (dist < want) {
          // You do not move; the map arranges itself around the point of view.
          const push = (want - dist) / (a.pinned || b.pinned ? 1 : 2);
          if (!a.pinned) {
            a.x -= (dx / dist) * push;
            a.z -= (dz / dist) * push;
          }
          if (!b.pinned) {
            b.x += (dx / dist) * push;
            b.z += (dz / dist) * push;
          }
        }
      }
    }
  }

  // Frame the chart like a cartographer: fit the settled map's bounding box to
  // the stage, so the massif fills the canvas — the landing page is the map
  // itself, not a vignette of it. A circular extent was the bug here: it took
  // the furthest peak in any direction and framed a circle around it, which on
  // a wide canvas left the map floating in the middle with black to both sides.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.radius);
    maxX = Math.max(maxX, p.x + p.radius);
    minZ = Math.min(minZ, p.z - p.radius);
    maxZ = Math.max(maxZ, p.z + p.radius);
  }
  const aimX = (minX + maxX) / 2;
  const aimZ = (minZ + maxZ) / 2;
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const extent = Math.max(
    ((maxZ - minZ) / 2) / tanV,
    ((maxX - minX) / 2) / (tanV * camera.aspect),
  );
  /** Where the camera sits for a given tilt, in radians off true plan. */
  const TILT = 0.18; // a breath of perspective; a topo map keeps its north
  const INTRO = 3200;
  let introEase = reduced ? 1 : 0;
  let landed = reduced;
  const groupIndex: Record<string, number> = { you: 0, pattern: 0, reading: 0, today: 0 };
  const placeCamera = (polar: number) => {
    camera.position.set(
      aimX,
      extent * Math.cos(polar),
      aimZ + extent * Math.sin(polar),
    );
    camera.lookAt(aimX, 0, aimZ);
  };
  // Reduced motion gets the settled map, not the settling of it.
  placeCamera(introEase === 1 ? TILT : 0.05);
  controls.target.set(aimX, 0, aimZ);
  controls.minDistance = extent * 0.5;
  controls.maxDistance = extent * 2.4;

  interface Pick {
    hit: THREE.Mesh;
    group: THREE.Group;
    whorl: Whorl;
    mats: THREE.LineBasicMaterial[];
    baseScale: number;
  }
  const picks: Pick[] = [];
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
  });

  placed.forEach((p) => {
    const warp: Warp[] = placed
      .filter((o) => o !== p)
      .map((o) => ({ dx: o.x - p.x, dz: o.z - p.z, m: o.radius * o.radius * 0.5, soft: R * R * 0.02 }));

    const levels = p.whorl.group === "you" ? 11 : 5 + Math.round(p.whorl.weight * 6);
    const group = contour(p.whorl.id, p.radius, levels, {
      top: p.whorl.tentative ? 0.34 : 0.62,
      lift: 0.1,
      detail: p.whorl.group === "you" ? 4 : p.whorl.weight > 0.6 ? 2 : 1,
      warp,
    });
    group.name = `${p.whorl.group}_${p.whorl.id}`;
    group.position.set(p.x, 0, p.z);
    group.add(hillshade(p.radius, p.whorl.tentative ? 0.03 : 0.07));
    if (p.whorl.meta) group.add(surveyLabel(p.whorl.meta, p.radius, p.whorl.tentative ? 0.3 : 0.5));

    // Invisible proxies, so hovering a whorl is forgiving.
    const hit = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 1.15, 8, 6), hitMaterial);
    group.add(hit);
    picks.push({ hit, group, whorl: p.whorl, mats: group.userData.mats, baseScale: 1 });

    // The map assembles around you, in the order the design chose: you first,
    // then the patterns the weeks keep circling, then what is kept about you,
    // then today. Ordered by kind, not by index — the sequence is an argument
    // about what the map is made of, and a flat stagger says nothing.
    const schedule = ARRIVE_AT[p.whorl.group] ?? (() => 0);
    const seen = groupIndex[p.whorl.group] ?? 0;
    groupIndex[p.whorl.group] = seen + 1;
    group.userData.arriveAt = schedule(seen);
    group.userData.arriveK = reduced ? 1 : 0;
    model.add(group);
  });

  /* ------------------------------------------------------------ the loop */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(-2, -2);
  let focused: string | null = null;
  let paused = false;
  let visible: Whorl["group"][] = ["pattern", "reading", "today", "you"];
  let parallaxX = 0;
  let parallaxY = 0;
  const start = performance.now();
  let frame = 0;

  const onPointerMove = (ev: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    parallaxX = pointer.y * 0.06;
    parallaxY = pointer.x * 0.08;
  };
  const onClick = () => {
    const pick = picks.find((p) => p.whorl.id === focused);
    if (pick?.whorl.href) location.hash = `#${pick.whorl.href}`;
  };
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("click", onClick);

  const resize = () => {
    if (!host.clientWidth) return;
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const tick = () => {
    frame = requestAnimationFrame(tick);
    const elapsed = performance.now() - start;
    const t = elapsed / 1000;

    // The survey settles: the camera starts at a true plan view and eases to a
    // breath of perspective, so the terrain rises out of the flat chart. This
    // is the whole arrival — the peaks themselves never move.
    if (introEase < 1) {
      introEase = Math.min(1, elapsed / INTRO);
      // Ease-out cubic: quick at first, then a long settle.
      placeCamera(0.05 + (TILT - 0.05) * (1 - Math.pow(1 - introEase, 3)));
      controls.update();

      // The landing runs on the camera's own clock, so the peaks rise into
      // place exactly as the view settles onto them — one movement, not two.
      const seconds = introEase * (INTRO / 1000);
      for (const pick of picks) {
        pick.group.userData.arriveK = reduced
          ? 1
          : backOut(Math.max(0, Math.min(1, (seconds - pick.group.userData.arriveAt) / 0.85)));
      }
    } else if (!landed) {
      landed = true;
      for (const pick of picks) pick.group.userData.arriveK = 1;
    }

    for (const pick of picks) {
      const on = visible.includes(pick.whorl.group);
      pick.group.visible = on;
    }

    if (!paused && !reduced) {
      for (const b of breathers) {
        const positions = b.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        const swell = 1 + Math.sin(t * b.speed + b.phase) * 0.018;
        for (let i = 0; i < b.base.x.length; i++) {
          positions.setX(i, b.base.x[i]! * swell);
          positions.setZ(i, b.base.z[i]! * swell);
        }
        positions.needsUpdate = true;
      }
      model.rotation.x += (parallaxX - model.rotation.x) * 0.04;
      model.rotation.y += (parallaxY - model.rotation.y) * 0.04;
    }

    raycaster.setFromCamera(pointer, camera);
    const pickable = picks.filter((p) => visible.includes(p.whorl.group));
    const hits = raycaster.intersectObjects(pickable.map((p) => p.hit), false);
    const hitWhorl = hits.length
      ? (pickable.find((p) => p.hit === hits[0]!.object)?.whorl ?? null)
      : null;
    renderer.domElement.style.cursor = hitWhorl ? "pointer" : "";
    if ((hitWhorl?.id ?? null) !== focused) {
      focused = hitWhorl?.id ?? null;
      onFocus(hitWhorl);
    }
    for (const pick of picks) {
      const lit = pick.whorl.id === focused;
      const ak = (pick.group.userData.arriveK as number) ?? 1;
      // A peak rises from seven tenths of its size and fades up as it goes. It
      // never comes from nothing: a whorl scaled out of a speck reads as a
      // thing being created, and none of this is created on arrival — it was
      // already true, and the map is only reaching it.
      const target = (lit ? 1.16 : 1) * (0.72 + 0.28 * ak);
      pick.baseScale += (target - pick.baseScale) * 0.12;
      pick.group.scale.setScalar(pick.baseScale);
      for (const mat of pick.mats) {
        const base = mat.userData.baseOp as number;
        const goal = Math.min(lit ? base * 1.7 : base, 0.95) * ak;
        mat.opacity += (goal - mat.opacity) * 0.12;
        mat.color.lerp(new THREE.Color(lit ? pick.whorl.tint : INK), 0.12);
      }
    }

    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  return {
    focus: (id) => {
      focused = id;
    },
    setVisible: (groups) => {
      visible = groups;
    },
    setPaused: (next) => {
      paused = next;
      if (next) {
        // Put every ring back where it started, rather than freezing it
        // mid-undulation.
        for (const b of breathers) {
          const positions = b.line.geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < b.base.x.length; i++) {
            positions.setX(i, b.base.x[i]!);
            positions.setZ(i, b.base.z[i]!);
          }
          positions.needsUpdate = true;
        }
      }
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    },
  };
}
