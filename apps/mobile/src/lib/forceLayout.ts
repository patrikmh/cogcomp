/**
 * Force-directed layout for the graph explorer.
 *
 * Deliberately separate from rendering, and deliberately deterministic. A layout
 * that jumps to a different arrangement each time you open it makes the graph
 * feel like a lava lamp rather than a place — you lose the "my work stuff is over
 * there" spatial memory that makes an explorer worth having at all. So positions
 * are seeded from node ids rather than Math.random, and the same graph always
 * settles the same way.
 *
 * The simulation is the standard three forces:
 *   repulsion  — every node pushes every other apart (Coulomb-like)
 *   springs    — edges pull their endpoints together
 *   centering   — a weak pull toward the middle so nothing drifts off-screen
 */

export interface LayoutNode {
  id: string;
  /** Observations are anchored more heavily — they are the fixed points the
   *  inferences hang off, so letting them drift makes the picture harder to read. */
  isObservation: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Higher pushes nodes further apart. */
  repulsion?: number;
  /** 0–1; how strongly edges contract. */
  springStrength?: number;
  springLength?: number;
  centering?: number;
  /** Velocity retained per step. Below 1 so the simulation settles. */
  damping?: number;
}

const DEFAULTS = {
  repulsion: 8000,
  springStrength: 0.02,
  springLength: 90,
  centering: 0.008,
  damping: 0.82,
};

/** Nodes closer than this are treated as this far apart, so repulsion between
 *  two coincident nodes stays finite instead of flinging them to infinity. */
const MIN_DISTANCE = 12;

/** Past this speed a node is clamped. Keeps one bad frame from ejecting a node
 *  off-canvas, which the user then cannot find. */
const MAX_SPEED = 30;

/**
 * A small deterministic hash, so a node's starting position is a function of its
 * id. Same graph, same picture, every time.
 */
function seededUnit(id: string, salt: number): number {
  let hash = salt;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  // >>> 0 makes it unsigned; the divisor maps it to [0, 1).
  return ((hash >>> 0) % 10000) / 10000;
}

export function initialiseNodes(
  nodes: { id: string; kind: string }[],
  options: LayoutOptions,
): LayoutNode[] {
  const { width, height } = options;
  // Seeded on a ring rather than uniformly: starting everything in a blob makes
  // the first few frames a violent explosion as repulsion resolves.
  const radius = Math.min(width, height) * 0.3;

  return nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const jitter = seededUnit(node.id, 7) * 0.6 + 0.7;
    return {
      id: node.id,
      isObservation: node.kind === "Observation",
      x: width / 2 + Math.cos(angle) * radius * jitter,
      y: height / 2 + Math.sin(angle) * radius * jitter,
      vx: 0,
      vy: 0,
    };
  });
}

/** Advance the simulation by one frame, in place. Returns total movement, which
 *  the caller can use to stop stepping once the layout has settled. */
export function step(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions,
): number {
  const opts = { ...DEFAULTS, ...options };
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.hypot(dx, dy);

      if (distance < MIN_DISTANCE) {
        // Coincident nodes have no meaningful direction to separate along, so
        // one is derived from their ids — still deterministic.
        const angle = seededUnit(a.id + b.id, 13) * Math.PI * 2;
        dx = Math.cos(angle) * MIN_DISTANCE;
        dy = Math.sin(angle) * MIN_DISTANCE;
        distance = MIN_DISTANCE;
      }

      const force = opts.repulsion / (distance * distance);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const edge of edges) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    // An edge to a node we were not given is dropped rather than crashing. The
    // API prunes these, but a client should not fall over if one slips through.
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(Math.hypot(dx, dy), MIN_DISTANCE);
    const force = (distance - opts.springLength) * opts.springStrength;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  let movement = 0;
  for (const node of nodes) {
    // Observations resist being pushed around, so the entries stay put and the
    // inferences arrange themselves around them.
    const anchor = node.isObservation ? opts.centering * 2.5 : opts.centering;
    node.vx += (options.width / 2 - node.x) * anchor;
    node.vy += (options.height / 2 - node.y) * anchor;

    node.vx *= opts.damping;
    node.vy *= opts.damping;

    const speed = Math.hypot(node.vx, node.vy);
    if (speed > MAX_SPEED) {
      node.vx = (node.vx / speed) * MAX_SPEED;
      node.vy = (node.vy / speed) * MAX_SPEED;
    }

    node.x += node.vx;
    node.y += node.vy;
    movement += Math.abs(node.vx) + Math.abs(node.vy);
  }

  return movement;
}

/** Below this total movement the layout is considered settled. */
export const SETTLED_THRESHOLD = 0.5;

/**
 * Pull any node that ended up outside the canvas back inside.
 *
 * Centering keeps the layout roughly in frame, but repulsion can still push an
 * outlier past the edge — and a node you cannot see is a node you cannot tap.
 * Clamping after settling rather than constraining during it keeps the forces
 * simple and only touches the few nodes that actually escaped.
 */
export function clampToBounds(
  nodes: LayoutNode[],
  options: LayoutOptions,
  margin = 20,
): LayoutNode[] {
  for (const node of nodes) {
    node.x = Math.min(Math.max(node.x, margin), options.width - margin);
    node.y = Math.min(Math.max(node.y, margin), options.height - margin);
  }
  return nodes;
}

/** Run to completion, for a static render. Bounded so a pathological graph
 *  cannot hang the UI thread. */
export function settle(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions,
  maxSteps = 300,
): LayoutNode[] {
  for (let i = 0; i < maxSteps; i++) {
    if (step(nodes, edges, options) < SETTLED_THRESHOLD) break;
  }
  return clampToBounds(nodes, options);
}

/** The node under a tap, or null. Radius is in the same space as positions, so
 *  callers pass screen coordinates already converted out of pan/zoom. */
export function nodeAt(
  nodes: LayoutNode[],
  x: number,
  y: number,
  radius: number,
): LayoutNode | null {
  let closest: LayoutNode | null = null;
  let closestDistance = radius;
  for (const node of nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    // Strictly less, so the nearest wins when circles overlap rather than
    // whichever happened to be first in the array.
    if (distance < closestDistance) {
      closest = node;
      closestDistance = distance;
    }
  }
  return closest;
}
