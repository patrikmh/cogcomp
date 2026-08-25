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

function extensionFor(mime: string): string {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/aac") return ".m4a";
  if (type === "audio/mpeg") return ".mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return ".wav";
  if (type === "audio/ogg") return ".ogg";
  return ".webm";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseVoiceEvents(
  raw: string,
  onTranscript: (text: string) => void,
  onDelta: (text: string) => void,
): { reply: string; crisis: boolean; crisis_resources: string[] } {
  let result: { reply: string; crisis: boolean; crisis_resources: string[] } | null = null;
  for (const event of raw.split("\n\n")) {
    const line = event.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    const payload = JSON.parse(line.slice("data: ".length));
    if (payload.type === "transcript") onTranscript(payload.text);
    else if (payload.type === "delta") onDelta(payload.text);
    else if (payload.type === "done") {
      result = {
        reply: payload.reply,
        crisis: payload.crisis,
        crisis_resources: payload.crisis_resources,
      };
    }
    else if (payload.type === "error") throw new ApiError(502, payload.message);
  }
  if (!result) throw new ApiError(502, "the reply ended before it was finished");
  return result;
}

let token: string | null = localStorage.getItem("tlon.token");
let onUnauthorized: ((token: string) => void) | null = null;

export function setToken(next: string | null) {
  token = next;
  if (next) localStorage.setItem("tlon.token", next);
  else localStorage.removeItem("tlon.token");
}

export function currentToken() {
  return token;
}

/** Called when the server has forgotten a token we still hold. */
export function onSessionLost(handler: (token: string) => void) {
  onUnauthorized = handler;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  authToken: string | null | undefined = undefined,
  handleUnauthorized = true,
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  // FormData sets its own multipart boundary; naming a content type breaks it.
  if (!(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const sent = authToken === undefined ? token : authToken;
  if (sent) headers.Authorization = `Bearer ${sent}`;

  const response = await fetch(`${BASE}${path}`, { ...init, headers });

  // Only a request that carried a token can have lost a session. Signing in
  // with the wrong password is a 401 too, and this branch used to treat it as
  // one: it cleared a token that was never there, fired the session-lost
  // handler, and replaced the server's "invalid email or password" with the
  // status line's own word for it, which named neither field.
  if (response.status === 401 && sent && sent === token && handleUnauthorized) {
    // A token the server has forgotten leaves you inside the app with every
    // screen showing its own unrelated error. Clear it once, here. A stale
    // request from an older account must not clear the newer account.
    setToken(null);
    onUnauthorized?.(sent);
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

/** Apply the same session-loss semantics to endpoints whose body is a stream. */
async function checkStreamingResponse(response: Response, sent: string | null): Promise<void> {
  if (response.status === 401 && sent && sent === token) {
    setToken(null);
    onUnauthorized?.(sent);
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

export interface ThreadMember {
  id: string;
  label: string;
  detector: Detector;
  confidence: number;
  tentative: boolean;
  occurrences: number;
  distinct_days: number;
}

/**
 * Findings that rest on the same thing, grouped for navigation.
 *
 * `subjects` are the exact labels (in their most-used phrasing) that connect
 * the members' own evidence — nothing summarised, nothing inferred. A group is
 * arithmetic over what mining already stored.
 */
export interface PatternThread {
  subjects: string[];
  members: ThreadMember[];
}

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
  /** One sentence a model wrote about what the members share, sent only with
   *  the model that wrote it. The membership list remains the name. */
  summary?: string | null;
  summary_model?: string | null;
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
  links?: { node_id: string; kind: string | null; label: string | null; availability: boolean }[];
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

export interface TemporalChange {
  kind: string;
  label: string;
  shift: "new" | "more" | "less" | "absent";
  recent_days: number;
  earlier_days: number;
  confidence: number;
  description: string;
}

export interface TemporalChanges {
  window_days: number;
  changes: TemporalChange[];
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
  /** How many entries this reading rests on. */
  cites_entries?: number;
  id: string;
  kind: string;
  label: string;
  confidence: number | null;
  epistemic_status: string | null;
  tentative: boolean;
}

/* ----------------------------------------------------------------- client */

export interface SemanticHit {
  node_id: string;
  label: string;
  kind: string;
  confidence: number;
  score: number;
}

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
  logout: (authToken?: string) =>
    request<void>("/v1/auth/logout", { method: "POST" }, authToken, false),
  me: () => request<{ user_id: string; email: string; created_at: string }>("/v1/auth/me"),

  /* capture */
  observations: (limit = 50) =>
    request<{ observations: Observation[]; next_before: string | null }>(
      `/v1/observations?limit=${limit}`,
    ),
  createObservation: (input: { id: string; content: string; capturedAt: string; timezone?: string }) =>
    request<Observation>("/v1/observations", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        content: input.content,
        source: "text",
        captured_at: input.capturedAt,
        // A day is a local fact; attached here so no screen can forget it.
        timezone: input.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      }),
    }),
  createVoiceObservation: (input: { id: string; audio: Blob; capturedAt: string; timezone?: string }, authToken?: string) => {
    const form = new FormData();
    form.append("id", input.id);
    form.append("audio", input.audio, "recording.webm");
    form.append("captured_at", input.capturedAt);
    form.append("timezone", input.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
    return request<Observation>("/v1/observations/voice", { method: "POST", body: form }, authToken);
  },
  extract: (id: string) =>
    request<{ observation_id: string; nodes: number; edges: number }>(
      `/v1/observations/${id}/extract`,
      { method: "POST" },
    ),

  /* reading back */
  daily: (day: string, tz: string, includeFindings = true) =>
    request<DailySummary>(
      `/v1/summary/${day}?tz=${encodeURIComponent(tz)}&include_findings=${includeFindings}`,
    ),
  weekly: (monday: string, tz: string, includeFindings = true) =>
    request<WeeklySummary>(
      `/v1/summary/week/${monday}?tz=${encodeURIComponent(tz)}&include_findings=${includeFindings}`,
    ),
  vocabulary: (monday: string, tz: string, weeks = 8) =>
    request<{ timezone: string; weeks: VocabularyWeek[] }>(
      `/v1/vocabulary/${monday}?tz=${encodeURIComponent(tz)}&weeks=${weeks}`,
    ),

  /* findings */
  patterns: () => request<Pattern[]>("/v1/patterns"),
  threads: () => request<PatternThread[]>("/v1/patterns/threads"),
  minePatterns: () =>
    request<{ patterns: number; added: number; confirmed: number; considered: number }>(
      "/v1/patterns/mine",
      { method: "POST" },
    ),
  ordering: (id: string) => request<Ordering>(`/v1/patterns/${id}/ordering`),
  themes: () => request<Theme[]>("/v1/themes"),
  /** Readings close in meaning to the question, ranked by the server's local
   *  embedding model. 503 when the deployment has no real embedder — the
   *  caller treats that as "this kind of looking is not available here",
   *  never as "nothing matches". */
  semanticSearch: (q: string) =>
    request<{ embedder: string; available?: boolean; hits: SemanticHit[] }>(
      `/v1/search/semantic?q=${encodeURIComponent(q)}`,
    ),
  theme: (id: string) => request<ThemeDetail>(`/v1/themes/${id}`),
  changes: (tz: string) =>
    request<TemporalChanges>(`/v1/temporal/changes?timezone=${encodeURIComponent(tz)}`),

  /** The readings a finding is made of — its SUPPORTS neighbours. */
  neighbours: (id: string) =>
    request<{
      node: GraphNode;
      /** Each carries how many entries it rests on, which the finding's
       *  composition shows beside it. */
      neighbours: (GraphNode & { cites_entries?: number })[];
      edges: { from_id: string; to_id: string; kind: string; note?: string | null }[];
    }>(
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
  /** `withRemoved` also returns tombstones — what the person took back. */
  identity: (withRemoved = false) =>
    request<{ nodes: IdentityNode[] }>(
      `/v1/identity${withRemoved ? "?include_removed=true" : ""}`,
    ),
  identityCandidates: () => request<{ candidates: IdentityNode[] }>("/v1/identity/candidates"),
  keep: (nodeId: string) =>
    request<IdentityNode>("/v1/identity/selections", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId }),
    }),
  unkeep: (nodeId: string) =>
    request<void>(`/v1/identity/selections/${nodeId}`, { method: "DELETE" }),

  /* experiments */
  experiments: (includeLinks = true) =>
    request<{ experiments: Experiment[] }>(`/v1/experiments${includeLinks ? "" : "?include_links=false"}`),
  experiment: (id: string, includeLinks = true) =>
    request<Experiment>(`/v1/experiments/${id}${includeLinks ? "" : "?include_links=false"}`),
  createExperiment: (input: Omit<Experiment, "state" | "revision">) =>
    request<Experiment>("/v1/experiments", { method: "POST", body: JSON.stringify(input) }),
  experimentTransition: (
    id: string,
    target: "start" | "pause" | "resume" | "cancel",
    revision: number,
    includeLinks = true,
  ) =>
    request<Experiment>(`/v1/experiments/${id}/${target}`, {
      method: "POST",
      body: JSON.stringify({ revision, ...(includeLinks ? {} : { include_links: false }) }),
    }),
  completeExperiment: (
    id: string,
    revision: number,
    assessment: string,
    finalCheckin: string,
    note?: string,
    includeLinks = true,
  ) =>
    request<Experiment>(`/v1/experiments/${id}/complete`, {
      method: "POST",
      body: JSON.stringify({
        revision,
        assessment,
        note: note?.trim() || null,
        final_checkin_observation_id: finalCheckin,
        ...(includeLinks ? {} : { include_links: false }),
      }),
    }),
  deleteExperiment: (id: string, revision: number) =>
    request<void>(`/v1/experiments/${id}?revision=${revision}`, { method: "DELETE" }),
  linkExperiment: (id: string, nodeId: string, revision: number, includeLinks = true) =>
    request<Experiment>(`/v1/experiments/${id}/links`, {
      method: "POST",
      body: JSON.stringify({
        node_id: nodeId,
        revision,
        ...(includeLinks ? {} : { include_links: false }),
      }),
    }),

  /* talking */
  listConversations: () =>
    request<{
      conversations: {
        id: string;
        started_at: string;
        closed_at: string | null;
        user_turns: number;
      }[];
    }>("/v1/conversations"),
  conversation: (id: string) =>
    request<{
      id: string;
      started_at: string;
      closed_at: string | null;
      agent: string;
      flagged: boolean;
      crisis_resources: string[];
      turns: { speaker: "user" | "assistant"; content: string }[];
    }>(`/v1/conversations/${id}`),
  startConversation: () =>
    request<{ id: string; started_at: string; agent: string }>("/v1/conversations", {
      method: "POST",
    }),
  say: (conversationId: string, content: string, clientTurnId = crypto.randomUUID()) =>
    request<{ reply: string; crisis: boolean; crisis_resources: string[] }>(
      `/v1/conversations/${conversationId}/turns`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          source: "text",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          client_turn_id: clientTurnId,
        }),
      },
    ),
  /**
   * The same turn, read as it is written.
   *
   * `onDelta` is called with each piece as it lands, and the whole reply comes
   * back at the end. Buffered response bodies are parsed from text; the stream
   * request is never retried through the plain endpoint.
   */
  sayAloudStreaming: async (
    conversationId: string,
    audio: Blob,
    onTranscript: (text: string) => void,
    onDelta: (text: string) => void,
    clientTurnId = crypto.randomUUID(),
    authToken?: string,
  ): Promise<{ reply: string; crisis: boolean; crisis_resources: string[] }> => {
    const form = new FormData();
    form.append("audio", audio, `recording${extensionFor(audio.type)}`);
    form.append("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    form.append("client_turn_id", clientTurnId);
    const headers: Record<string, string> = {};
    const sentToken = authToken === undefined ? token : authToken;
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
    const response = await fetch(`${BASE}/v1/conversations/${conversationId}/turns/voice/stream`, {
      method: "POST",
      headers,
      body: form,
    });
    await checkStreamingResponse(response, sentToken);

    const reader = response.body?.getReader();
    if (!reader) {
      const raw = await response.text();
      return parseVoiceEvents(raw, onTranscript, onDelta);
    }
    const decoder = new TextDecoder();
    let pending = "";
    let result: { reply: string; crisis: boolean; crisis_resources: string[] } | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const events = pending.split("\n\n");
      pending = events.pop() ?? "";
      for (const event of events) {
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice("data: ".length));
        if (payload.type === "transcript") onTranscript(payload.text);
        else if (payload.type === "delta") onDelta(payload.text);
        else if (payload.type === "done") {
          result = {
            reply: payload.reply,
            crisis: payload.crisis,
            crisis_resources: payload.crisis_resources,
          };
        }
        else if (payload.type === "error") throw new ApiError(502, payload.message);
      }
    }
    if (!result) throw new ApiError(502, "the reply ended before it was finished");
    return result;
  },

  sayStreaming: async (
    conversationId: string,
    content: string,
    onDelta: (text: string) => void,
    clientTurnId = crypto.randomUUID(),
  ): Promise<{ reply: string; crisis: boolean; crisis_resources: string[] }> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const sentToken = token;
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

    const response = await fetch(`${BASE}/v1/conversations/${conversationId}/turns/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content,
        source: "text",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        client_turn_id: clientTurnId,
      }),
    });

    await checkStreamingResponse(response, sentToken);
    if (!response.body) {
      const raw = await response.text();
      let reply: { reply: string; crisis: boolean; crisis_resources: string[] } | null = null;
      for (const event of raw.split("\n\n")) {
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice("data: ".length));
        if (payload.type === "delta") onDelta(payload.text);
        else if (payload.type === "done") {
          reply = {
            reply: payload.reply,
            crisis: payload.crisis,
            crisis_resources: payload.crisis_resources,
          };
        } else if (payload.type === "error") {
          throw new ApiError(502, payload.message);
        }
      }
      if (!reply) throw new ApiError(502, "the reply ended before it was finished");
      return reply;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Events are separated by a blank line and can be split across reads, so
    // what is left after the last complete one is kept for the next.
    let pending = "";
    let reply: { reply: string; crisis: boolean; crisis_resources: string[] } | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });

      const events = pending.split("\n\n");
      pending = events.pop() ?? "";

      for (const event of events) {
        const line = event.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice("data: ".length));

        if (payload.type === "delta") {
          onDelta(payload.text);
        } else if (payload.type === "done") {
          reply = {
            reply: payload.reply,
            crisis: payload.crisis,
            crisis_resources: payload.crisis_resources,
          };
        } else if (payload.type === "error") {
          // The status line said 200 before the agent failed, so the failure
          // arrives in the body and has to be raised from here.
          throw new ApiError(502, payload.message);
        }
      }
    }

    if (!reply) throw new ApiError(502, "the reply ended before it was finished");
    return reply;
  },

  closeConversation: (conversationId: string, includeFindings = true) => {
    const params = new URLSearchParams({ include_findings: String(includeFindings) });
    return request<{ conversation_id: string; observations: string[]; turns_converted: number }>(
      `/v1/conversations/${conversationId}/close?${params.toString()}`,
      { method: "POST" },
    );
  },

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
    request<{ nodes: GraphNode[]; edges: { from_id: string; to_id: string; kind: string; note?: string | null }[]; total_nodes: number }>(
      `/v1/graph?limit=${limit}`,
    ),
};
