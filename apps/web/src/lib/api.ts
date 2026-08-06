/**
 * The backend, as the browser sees it.
 *
 * A port of `apps/mobile/src/lib/api.ts` — same method names, same response
 * types, `fetch` in place of React Native's. Keeping the two in step matters
 * more than sharing code: a divergence here shows up as one client quietly
 * disagreeing with the other about what the person's graph contains.
 *
 * Requests go to a relative path so production is same-origin; in development
 * Vite proxies `/v1` to the API on 8080.
 */

const BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = localStorage.getItem("tlon.token");
let onUnauthorized: (() => void) | null = null;

export function setToken(next: string | null) {
  token = next;
  if (next) localStorage.setItem("tlon.token", next);
  else localStorage.removeItem("tlon.token");
}

export function currentToken() {
  return token;
}

/** Called when the server has forgotten a token we still hold. */
export function onSessionLost(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  // FormData sets its own multipart boundary; naming a content type breaks it.
  if (!(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE}${path}`, { ...init, headers });

  if (response.status === 401) {
    // A token the server has forgotten leaves you inside the app with every
    // screen showing its own unrelated error. Clear it once, here.
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string | { msg?: string }[];
    };
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => d.msg ?? "invalid value").join(", ")
      : (body.detail ?? response.statusText);
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ types */

export type Source = "text" | "voice";

export interface Observation {
  id: string;
  content: string;
  source: Source;
  captured_at: string;
  created_at: string;
  timezone: string | null;
}

export interface Inference {
  id: string;
  kind: string;
  label: string;
  confidence: number;
  epistemic_status: string;
  extractor: string;
  tentative: boolean;
  cites_entries: number;
}

export interface DailySummary {
  date: string;
  timezone: string;
  entry_count: number;
  first_capture?: string;
  last_capture?: string;
  observations: { id: string; content: string; source: string; captured_at: string }[];
  inferred: Inference[];
  recurring: { kind: string; label: string; entries: number }[];
}

export interface WeeklySummary {
  week_start: string;
  week_end: string;
  timezone: string;
  entry_count: number;
  active_days: number;
  days: { date: string; entry_count: number; observations: DailySummary["observations"] }[];
  observations: DailySummary["observations"];
  inferred: (Inference & { source_observation_ids: string[]; cites_days: number })[];
  recurring: { kind: string; label: string; entries: number; days: number }[];
}

/** The detectors the backend can attribute a finding to. */
export type Detector =
  | "exact-label"
  | "weekday"
  | "lag"
  | "same-day-order"
  | "stated-vs-recorded";

export interface Pattern {
  id: string;
  label: string;
  confidence: number;
  epistemic_status: string;
  extractor: string;
  occurrences: number;
  distinct_days: number;
  detector: Detector;
  first_seen_at: string;
  tentative: boolean;
  created_at: string;
}

export interface Written {
  id: string;
  content: string;
  source: string;
  captured_at: string;
}

export interface Ordering {
  pattern_id: string;
  label: string;
  lag_days: number;
  utc_fallback: boolean;
  occasions: {
    source_day: string;
    target_day: string;
    before: Written[];
    after: Written[];
  }[];
}

export interface Theme {
  id: string;
  label: string;
  members: string[];
  member_count: number;
  confidence: number;
  epistemic_status: string;
  detector: string;
  first_seen_at: string;
  tentative: boolean;
  created_at: string;
}

export interface ThemeDetail extends Omit<Theme, "members"> {
  members: { id: string; kind: string; label: string; confidence: number; epistemic_status: string }[];
  associations: { from_id: string; to_id: string; confidence: number }[];
  last_confirmed_at: string;
}

export interface Explanation {
  node: {
    id: string;
    kind: string;
    label: string;
    created_at: string;
    confidence: number | null;
    epistemic_status: string | null;
    extractor: string | null;
  };
  derived_from: (Written & { recall_days: number })[];
  is_observed: boolean;
}

export interface IdentityNode {
  id: string;
  kind: string;
  label: string;
  created_at: string;
  confidence: number | null;
  epistemic_status: string | null;
  extractor: string | null;
  tentative: boolean;
  status: "selected" | "removed" | null;
  selected_at: string | null;
}

export interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  action: string;
  success_criterion: string;
  start_date: string;
  duration_days: number;
  timezone: string;
  cadence: "daily" | "weekly" | "end_only";
  state: "draft" | "active" | "paused" | "completed" | "cancelled";
  revision: number;
  links?: { node_id: string; kind: string | null; label: string | null }[];
  checkins?: Written[];
  outcome?: { assessment: string; note: string | null; final_checkin_observation_id: string } | null;
}

export interface AgentRun {
  id: string;
  agent: string;
  version: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface TemporalChanges {
  window_days: number;
  changes: {
    kind: string;
    label: string;
    shift: "new" | "more" | "less" | "absent";
    recent_days: number;
    earlier_days: number;
    confidence: number;
    description: string;
  }[];
  not_enough_material: boolean;
}

export interface VocabularyWeek {
  week_start: string;
  entry_count: number;
  distinct_words: number;
  words: string[];
  first_time: string[];
  description: string;
}

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  confidence: number | null;
  epistemic_status: string | null;
  tentative: boolean;
}

/* ----------------------------------------------------------------- client */

export const api = {
  /* auth */
  signup: (email: string, password: string) =>
    request<{ user_id: string; token: string }>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, device: "web" }),
    }),
  login: (email: string, password: string) =>
    request<{ user_id: string; token: string }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, device: "web" }),
    }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST" }),
  me: () => request<{ user_id: string; email: string; created_at: string }>("/v1/auth/me"),

  /* capture */
  observations: (limit = 50) =>
    request<{ observations: Observation[]; next_before: string | null }>(
      `/v1/observations?limit=${limit}`,
    ),
  createObservation: (input: { id: string; content: string; capturedAt: string }) =>
    request<Observation>("/v1/observations", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        content: input.content,
        source: "text",
        captured_at: input.capturedAt,
        // A day is a local fact; attached here so no screen can forget it.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      }),
    }),
  createVoiceObservation: (input: { id: string; audio: Blob; capturedAt: string }) => {
    const form = new FormData();
    form.append("id", input.id);
    form.append("audio", input.audio, "recording.webm");
    form.append("captured_at", input.capturedAt);
    form.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    return request<Observation>("/v1/observations/voice", { method: "POST", body: form });
  },
  extract: (id: string) =>
    request<{ observation_id: string; nodes: number; edges: number }>(
      `/v1/observations/${id}/extract`,
      { method: "POST" },
    ),

  /* reading back */
  daily: (day: string, tz: string) =>
    request<DailySummary>(`/v1/summary/${day}?tz=${encodeURIComponent(tz)}`),
  weekly: (monday: string, tz: string) =>
    request<WeeklySummary>(`/v1/summary/week/${monday}?tz=${encodeURIComponent(tz)}`),
  vocabulary: (monday: string, tz: string, weeks = 8) =>
    request<{ timezone: string; weeks: VocabularyWeek[] }>(
      `/v1/vocabulary/${monday}?tz=${encodeURIComponent(tz)}&weeks=${weeks}`,
    ),

  /* findings */
  patterns: () => request<Pattern[]>("/v1/patterns"),
  minePatterns: () =>
    request<{ patterns: number; added: number; confirmed: number; considered: number }>(
      "/v1/patterns/mine",
      { method: "POST" },
    ),
  ordering: (id: string) => request<Ordering>(`/v1/patterns/${id}/ordering`),
  themes: () => request<Theme[]>("/v1/themes"),
  theme: (id: string) => request<ThemeDetail>(`/v1/themes/${id}`),
  changes: (tz: string) =>
    request<TemporalChanges>(`/v1/temporal/changes?timezone=${encodeURIComponent(tz)}`),

  /** The readings a finding is made of — its SUPPORTS neighbours. */
  neighbours: (id: string) =>
    request<{ node: GraphNode; neighbours: GraphNode[]; edges: { from_id: string; to_id: string }[] }>(
      `/v1/graph/nodes/${id}/neighbours`,
    ),

  /* one claim */
  explain: (id: string) => request<Explanation>(`/v1/graph/nodes/${id}/explain`),
  judge: (id: string, status: "hypothesis" | "user_confirmed" | "user_rejected") =>
    request<{ id: string; epistemic_status: string }>(`/v1/nodes/${id}/judgement`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  selfModel: () =>
    request<{ confirmed: number; rejected: number; unreviewed: number; reviewed_fraction: number }>(
      "/v1/self-model",
    ),

  /* identity */
  identity: () => request<{ nodes: IdentityNode[] }>("/v1/identity"),
  identityCandidates: () => request<{ candidates: IdentityNode[] }>("/v1/identity/candidates"),
  keep: (nodeId: string) =>
    request<IdentityNode>("/v1/identity/selections", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId }),
    }),
  unkeep: (nodeId: string) =>
    request<void>(`/v1/identity/selections/${nodeId}`, { method: "DELETE" }),

  /* experiments */
  experiments: () => request<{ experiments: Experiment[] }>("/v1/experiments"),
  experiment: (id: string) => request<Experiment>(`/v1/experiments/${id}`),
  createExperiment: (input: Omit<Experiment, "state" | "revision">) =>
    request<Experiment>("/v1/experiments", { method: "POST", body: JSON.stringify(input) }),
  experimentTransition: (
    id: string,
    target: "start" | "pause" | "resume" | "cancel",
    revision: number,
  ) =>
    request<Experiment>(`/v1/experiments/${id}/${target}`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  completeExperiment: (
    id: string,
    revision: number,
    assessment: string,
    finalCheckin: string,
  ) =>
    request<Experiment>(`/v1/experiments/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        revision,
        assessment,
        final_checkin_observation_id: finalCheckin,
      }),
    }),
  deleteExperiment: (id: string, revision: number) =>
    request<void>(`/v1/experiments/${id}?revision=${revision}`, { method: "DELETE" }),

  /* talking */
  startConversation: () =>
    request<{ id: string; started_at: string; agent: string }>("/v1/conversations", {
      method: "POST",
    }),
  say: (conversationId: string, content: string) =>
    request<{ reply: string; crisis: boolean; crisis_resources: string[] }>(
      `/v1/conversations/${conversationId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          source: "text",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      },
    ),
  closeConversation: (conversationId: string) =>
    request<{ conversation_id: string; observations: string[]; turns_converted: number }>(
      `/v1/conversations/${conversationId}/close`,
      { method: "POST" },
    ),

  /** Synthesise a reply so it can be listened to.
   *
   *  The envelope arrives with the audio because the shape has to move in time
   *  with the voice, and measuring loudness in the browser is not possible for
   *  audio it did not generate. See `tlon/speech.py`. */
  speak: (text: string) =>
    request<{ audio: string; envelope: number[]; frame_ms: number; duration_ms: number }>(
      "/v1/voice/speak",
      { method: "POST", body: JSON.stringify({ text }) },
    ),

  /* machinery */
  agentRuns: (limit = 50) => request<AgentRun[]>(`/v1/agents/runs?limit=${limit}`),
  runAgents: () => request<{ agent: string; status: string }[]>("/v1/agents/run", { method: "POST" }),
  graphSummary: () =>
    request<{ schema_version: string; counts: { kind: string; count: number }[] }>(
      "/v1/graph/summary",
    ),
  graph: (limit = 200) =>
    request<{ nodes: GraphNode[]; edges: { from_id: string; to_id: string }[]; total_nodes: number }>(
      `/v1/graph?limit=${limit}`,
    ),
};
