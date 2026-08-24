import * as Crypto from "expo-crypto";
import type { EdgeKind, EpistemicStatus, NodeKind } from "@tlon/ontology";

import { deviceTimezone } from "./dates";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080";

export interface AuthResponse {
  user_id: string;
  token: string;
}

export interface MeResponse {
  user_id: string;
  email: string;
  created_at: string;
}

export interface ObservationResponse {
  id: string;
  content: string;
  source: "text" | "voice";
  captured_at: string;
  created_at: string;
  /** Null for entries written before the app recorded one — the server counted
   *  their day in UTC and says so wherever that matters. */
  timezone: string | null;
}

export interface ListResponse {
  observations: ObservationResponse[];
  next_before: string | null;
}

export interface NodeSummary {
  id: string;
  kind: NodeKind;
  label: string;
  created_at: string;
  confidence: number | null;
  epistemic_status: EpistemicStatus | null;
  extractor: string | null;
}

export interface SupportingObservation {
  id: string;
  content: string;
  source: string;
  captured_at: string;
  /** Whole days between the moment this describes and the moment it was
   *  written. Zero for something typed at the time. Recall is pulled toward
   *  peaks and endings, so a reader weighing a claim deserves to know. */
  recall_days: number;
}

/** What a person may say about a reading. `hypothesis` withdraws a judgement —
 *  someone who agreed with something in a bad week must not be held to it. */
export type Judgement = "hypothesis" | "user_confirmed" | "user_rejected";

export interface SelfModel {
  confirmed: number;
  rejected: number;
  unreviewed: number;
  /** 0–1. Zero for an empty picture, never one — nothing has been reviewed, it
   *  simply is not there yet. */
  reviewed_fraction: number;
  generated_at: string;
}

export interface Explanation {
  node: NodeSummary;
  derived_from: SupportingObservation[];
  /** True when the node is an observation — it explains itself. */
  is_observed: boolean;
}

export interface ConversationTurn {
  id: string;
  speaker: "user" | "assistant";
  content: string;
  source: "text" | "voice";
  spoken_at: string;
  /** Set once the conversation is closed and this turn became an entry.
   *  Always null on assistant turns — the model's words never become entries. */
  observation_id: string | null;
}

export interface Conversation {
  id: string;
  started_at: string;
  closed_at: string | null;
  agent: string;
  flagged: boolean;
  crisis_resources: string[];
  turns: ConversationTurn[];
}

export interface TurnReply {
  reply: string;
  /** The agent judged someone may be at risk. The UI stops prompting and shows
   *  the services below instead. */
  crisis: boolean;
  crisis_resources: string[];
}

export interface SpokenClip {
  /** base64 WAV. Inlined rather than served from a URL — a clip is a few seconds
   *  of a private conversation, and giving it an address means deciding who may
   *  follow that address. */
  audio: string;
  /** One 0–1 loudness value per `frame_ms` of audio. */
  envelope: number[];
  frame_ms: number;
  duration_ms: number;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** How many entries this reading rests on. */
  cites_entries?: number;
  created_at: string;
  confidence: number | null;
  epistemic_status: EpistemicStatus | null;
  extractor: string | null;
  tentative: boolean;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from_id: string;
  to_id: string;
  note: string | null;
  confidence: number;
  tentative: boolean;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  returned: number;
  total_nodes: number;
  /** More exists than was returned — say so rather than implying otherwise. */
  truncated: boolean;
}

export interface WeeklySummary {
  week_start: string;
  week_end: string;
  timezone: string;
  entry_count: number;
  active_days: number;
  days: { date: string; entry_count: number; observations: ObservationResponse[] }[];
  day_buckets: { date: string; entry_count: number; observations: ObservationResponse[] }[];
  observations: ObservationResponse[];
  inferred: (DailySummary["inferred"][number] & {
    source_observation_ids: string[];
    cites_days: number;
  })[];
  recurring: { kind: NodeKind; label: string; entries: number; days: number; inference_ids: string[] }[];
}

export interface DailySummary {
  date: string;
  timezone: string;
  entry_count: number;
  first_capture?: string;
  last_capture?: string;
  observations: { id: string; content: string; source: string; captured_at: string }[];
  inferred: {
    id: string;
    kind: NodeKind;
    label: string;
    confidence: number;
    epistemic_status: EpistemicStatus;
    extractor: string;
    /** Below the confidence threshold — render as a guess, never as knowledge. */
    tentative: boolean;
    cites_entries: number;
  }[];
  recurring: { kind: NodeKind; label: string; entries: number }[];
}

export type IdentitySelectionStatus = "selected" | "removed";

export interface IdentityNode extends GraphNode {
  status: IdentitySelectionStatus | null;
  selected_at: string | null;
  selection_id?: string;
}

export interface IdentityProjection {
  nodes: IdentityNode[];
  edges: GraphEdge[];
}

export interface IdentityCandidates {
  candidates: IdentityNode[];
}

export interface GraphSummary {
  schema_version: string;
  counts: { kind: NodeKind; count: number }[];
}

/** Matches the response from GET /v1/patterns. */
export interface TemporalChange {
  kind: string;
  label: string;
  /** new | more | less | absent. Arithmetic words only — there is deliberately
   *  no "improved", because the same change means opposite things to different
   *  people. See `tlon/temporal.py`. */
  shift: "new" | "more" | "less" | "absent";
  recent_days: number;
  earlier_days: number;
  confidence: number;
  /** The counts as a sentence, written by the server so every client says it the
   *  same way and none of them adds a verdict of its own. */
  description: string;
}

export interface TemporalChanges {
  window_days: number;
  changes: TemporalChange[];
  /** True when the two windows were too quiet to compare. Distinct from an empty
   *  list, which means it looked and nothing had moved. */
  not_enough_material: boolean;
}

/** The detectors the backend can attribute a pattern to. Each is entitled to a
 *  different claim, so the screen renders them differently. */
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
 * `subjects` are the exact labels — in their most-used phrasing — that the
 * members' own evidence shares. Nothing summarised, nothing inferred: a thread
 * is arithmetic over what mining already stored.
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
  /** Across how many distinct days. Three mentions in one evening is a mood. */
  distinct_days: number;
  detector: Detector;
  /** When this first held, not when the node was last written. */
  first_seen_at: string;
  tentative: boolean;
  created_at: string;
}

/** Matches the response from POST /v1/patterns/mine. */
export interface MinePatternsResponse {
  patterns: number;
  /** Split out because they read differently: `added` is something new, `confirmed`
   *  is the same things still holding. */
  added: number;
  confirmed: number;
  considered: number;
}

/** One week of vocabulary. Counts of the person's own words, never a score. */
export interface VocabularyWeek {
  week_start: string;
  entry_count: number;
  distinct_words: number;
  /** The words themselves — a count nobody can check is a score. */
  words: string[];
  /** Of those, the ones not used in any earlier week of the window. */
  first_time: string[];
  /** Written by the server so every client says it the same way. */
  description: string;
}

/** Matches the response from GET /v1/vocabulary/{week_start}. */
export interface Vocabulary {
  timezone: string;
  weeks: VocabularyWeek[];
}

/** Matches the response from GET /v1/themes. A region of someone's life: a
 *  group of things that keep turning up in the same entries. */
export interface Theme {
  id: string;
  /** The member labels joined — the region is named by what is in it, never by
   *  an invented phrase. */
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

export interface ThemeMember {
  id: string;
  kind: NodeKind;
  label: string;
  confidence: number;
  epistemic_status: string;
}

/** Adjacency only. `from`/`to` are storage order, not direction. */
export interface ThemeAssociation {
  from_id: string;
  to_id: string;
  confidence: number;
}

/** Matches the response from GET /v1/themes/{id}. */
export interface ThemeDetail extends Omit<Theme, "members"> {
  members: ThemeMember[];
  associations: ThemeAssociation[];
  last_confirmed_at: string;
}

/** One entry, in the person's own words. */
export interface Written {
  id: string;
  content: string;
  source: string;
  captured_at: string;
}

/** One pair of writing days behind an ordered finding. */
export interface Occasion {
  source_day: string;
  target_day: string;
  before: Written[];
  after: Written[];
}

/** Matches the response from GET /v1/patterns/{id}/ordering. Only lag patterns
 *  have one — the other detectors make no claim about order. */
export interface Ordering {
  pattern_id: string;
  label: string;
  lag_days: number;
  /** These days were counted in UTC because an entry never recorded its zone.
   *  The screen shows the caveat only then. */
  utc_fallback: boolean;
  occasions: Occasion[];
}

export type ExperimentState = "draft" | "active" | "paused" | "completed" | "cancelled";
export interface Experiment {
  id: string; user_id: string; title: string; hypothesis: string; action: string;
  success_criterion: string; start_date: string; duration_days: number; timezone: string;
  cadence: "daily" | "weekly" | "end_only"; state: ExperimentState; revision: number;
  links?: { node_id: string; kind: NodeKind; label: string; availability?: boolean }[];
  checkins?: ObservationResponse[];
  outcome?: { assessment: "met" | "partly_met" | "not_met" | "unclear"; note: string | null; final_checkin_observation_id: string } | null;
}

/** Matches the response from GET /v1/agents. */
export interface AgentInfo {
  name: string;
  version: string;
  cadence_seconds: number;
}

/** The current backend agents only write counts and short reasons to summaries. */
export interface AgentSummary {
  patterns?: number;
  considered?: number;
  groups?: number;
  nodes_merged?: number;
  reason?: string;
}

/** Matches the response from GET /v1/agents/runs. */
export interface AgentRun {
  id: string;
  agent: string;
  version: string;
  trigger: "scheduled" | "manual";
  status: "running" | "skipped" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  summary: AgentSummary;
  error: string | null;
}

/** Matches each item returned by POST /v1/agents/run. */
export interface AgentRunResult {
  agent: string;
  status: "skipped" | "succeeded" | "failed";
  summary?: AgentSummary;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Signup and login are the only unauthenticated calls.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    // FastAPI reports errors as {"detail": ...}; detail is an array of field
    // errors on a 422 and a plain string otherwise.
    const body = (await response
      .json()
      .catch(() => ({}))) as { detail?: string | { msg?: string }[] };
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => d.msg ?? "invalid value").join(", ")
      : body.detail;
    throw new ApiError(response.status, detail ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * A multipart body carrying a recording.
 *
 * React Native's FormData takes a {uri, name, type} descriptor; on web the
 * recording is a real Blob behind a blob: URL and has to be fetched first.
 */
/** The extension for a recorded blob's own MIME type. Falls back to webm, which
 *  is what every browser but Safari produces. */
function extensionFor(mime: string): string {
  const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/aac") return ".m4a";
  if (type === "audio/mpeg") return ".mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return ".wav";
  if (type === "audio/ogg") return ".ogg";
  return ".webm";
}

async function audioForm(uri: string): Promise<FormData> {
  const form = new FormData();
  if (uri.startsWith("blob:") || uri.startsWith("data:")) {
    const blob = await fetch(uri).then((r) => r.blob());
    // Named after what the browser actually recorded, not after what Chrome
    // records. Safari's MediaRecorder produces audio/mp4; this said
    // "recording.webm" for every browser, so an iPhone uploaded an MP4 under a
    // WebM name and the transcriber was handed a file that disagreed with
    // itself. Chrome never showed it, because there the name happened to be true.
    form.append("audio", blob, `recording${extensionFor(blob.type)}`);
  } else {
    form.append("audio", {
      uri,
      name: "recording.m4a",
      type: "audio/m4a",
    } as unknown as Blob);
  }
  return form;
}

async function uploadAudio<T>(path: string, token: string, form: FormData): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    // Content-Type is deliberately omitted: the runtime sets it along with the
    // multipart boundary, and overriding it breaks the upload.
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string | { msg?: string }[];
    };
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => d.msg ?? "invalid value").join(", ")
      : body.detail;
    throw new ApiError(response.status, detail ?? response.statusText);
  }
  return (await response.json()) as T;
}

type StreamCallbacks = {
  onTranscript?: (text: string) => void;
  onDelta: (text: string) => void;
};

async function parseTurnStream(response: Response, callbacks: StreamCallbacks): Promise<TurnReply> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }

  let reply: TurnReply | null = null;
  const handle = (event: string) => {
    const line = event.split("\n").find((l) => l.startsWith("data: "));
    if (!line) return;
    const payload = JSON.parse(line.slice("data: ".length));
    if (payload.type === "transcript") callbacks.onTranscript?.(payload.text);
    else if (payload.type === "delta") callbacks.onDelta(payload.text);
    else if (payload.type === "done") {
      reply = {
        reply: payload.reply,
        crisis: payload.crisis,
        crisis_resources: payload.crisis_resources,
      };
    } else if (payload.type === "error") {
      throw new ApiError(502, payload.message);
    }
  };

  if (!response.body) {
    const raw = await response.text();
    for (const event of raw.split("\n\n")) handle(event);
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const events = pending.split("\n\n");
      pending = events.pop() ?? "";
      for (const event of events) handle(event);
    }
    pending += decoder.decode();
    if (pending.trim()) handle(pending);
  }
  if (!reply) throw new ApiError(502, "the reply ended before it was finished");
  return reply;
}

export const api = {
  signup(email: string, password: string, device?: string) {
    return request<AuthResponse>("/v1/auth/signup", null, {
      method: "POST",
      body: JSON.stringify({ email, password, device }),
    });
  },

  login(email: string, password: string, device?: string) {
    return request<AuthResponse>("/v1/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ email, password, device }),
    });
  },

  /** Revokes only this device's token; other sessions stay signed in. */
  logout(token: string) {
    return request<void>("/v1/auth/logout", token, { method: "POST" });
  },

  me(token: string) {
    return request<MeResponse>("/v1/auth/me", token);
  },

  /**
   * The id is minted on the device, so a capture survives a failed request:
   * retrying sends the same id and the server treats it as the same observation
   * rather than a duplicate thought.
   */
  createObservation(
    token: string,
    input: {
      id: string;
      content: string;
      source: "text" | "voice";
      capturedAt: string;
      timezone?: string;
    },
  ) {
    return request<ObservationResponse>("/v1/observations", token, {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        content: input.content,
        source: input.source,
        captured_at: input.capturedAt,
        // Attached here rather than by each caller, so no capture path can
        // forget it and leave the server guessing which day this belongs to.
        timezone: input.timezone ?? deviceTimezone(),
      }),
    });
  },

  /**
   * Uploads a recording; the server transcribes it and stores the transcript.
   * The audio is not retained anywhere — the transcript is the entry.
   */
  async createVoiceObservation(
    token: string,
    input: { id: string; uri: string; capturedAt: string; timezone?: string },
  ): Promise<ObservationResponse> {
    const form = await audioForm(input.uri);
    form.append("id", input.id);
    form.append("captured_at", input.capturedAt);
    form.append("timezone", input.timezone ?? deviceTimezone());
    return uploadAudio<ObservationResponse>("/v1/observations/voice", token, form);
  },

  /**
   * Runs extraction over one kept entry.
   *
   * Fire-and-forget by the caller, like the desktop client: the words are
   * already safe, and readings are something the graph grows into rather than
   * something anyone waits for. The server skips what was already extracted,
   * so a retry costs nothing but a request.
   */
  extract(token: string, observationId: string) {
    return request<{ observation_id: string; extractor: string; nodes: number; edges: number }>(
      `/v1/observations/${encodeURIComponent(observationId)}/extract`,
      token,
      { method: "POST" },
    );
  },

  /** Speak a turn instead of typing it. Takes the same path as a typed turn
   *  once transcribed. */
  async sayAloud(
    token: string,
    conversationId: string,
    uri: string,
    clientTurnId: string = Crypto.randomUUID(),
  ): Promise<TurnReply> {
    const form = await audioForm(uri);
    form.append("timezone", deviceTimezone());
    form.append("client_turn_id", clientTurnId);
    return uploadAudio<TurnReply>(
      `/v1/conversations/${conversationId}/turns/voice`,
      token,
      form,
    );
  },

  /** Synthesise a reply so it can be listened to.
   *
   * The envelope arrives with the audio because the blob has to move in time
   * with the voice, and measuring loudness client-side is only possible on web.
   * See `tlon/speech.py`. */
  speak(token: string, text: string) {
    return request<SpokenClip>("/v1/voice/speak", token, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },

  async createExperiment(token: string, input: { id: string; title: string; hypothesis: string; action: string; success_criterion: string; start_date: string; duration_days: number; timezone: string; cadence: Experiment["cadence"] }) {
    const { id: _id, ...payload } = input;
    const fingerprint = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(payload, Object.keys(payload).sort()),
    );
    return request<Experiment>("/v1/experiments", token, { method: "POST", headers: { "X-Request-Fingerprint": fingerprint }, body: JSON.stringify(input) });
  },
  listExperiments(token: string, includeLinks = true) {
    const query = includeLinks ? "" : "?include_links=false";
    return request<{ experiments: Experiment[] }>(`/v1/experiments${query}`, token);
  },
  experiment(token: string, id: string, includeLinks = true) {
    const query = includeLinks ? "" : "?include_links=false";
    return request<Experiment>(`/v1/experiments/${id}${query}`, token);
  },
  editExperiment(token: string, id: string, revision: number, input: { id?: string; title: string; hypothesis: string; action: string; success_criterion: string; start_date: string; duration_days: number; timezone: string; cadence: Experiment["cadence"] }, includeLinks = true) {
    const query = `?revision=${revision}${includeLinks ? "" : "&include_links=false"}`;
    return request<Experiment>(`/v1/experiments/${id}${query}`, token, { method: "PATCH", body: JSON.stringify(input) });
  },
  unlinkExperimentPattern(token: string, id: string, nodeId: string, revision: number, includeLinks = true) {
    const query = `?revision=${revision}${includeLinks ? "" : "&include_links=false"}`;
    return request<Experiment>(`/v1/experiments/${id}/links/${nodeId}${query}`, token, { method: "DELETE" });
  },
  deleteExperiment(token: string, id: string, revision: number) {
    return request<void>(`/v1/experiments/${id}?revision=${revision}`, token, { method: "DELETE" });
  },
  experimentTransition(token: string, id: string, transition: "start" | "pause" | "resume" | "cancel" | "complete", revision: number, assessment?: string, finalCheckinObservationId?: string, includeLinks = true) {
    return request<Experiment>(`/v1/experiments/${id}/${transition}`, token, { method: "POST", body: JSON.stringify({ revision, assessment, final_checkin_observation_id: finalCheckinObservationId, ...(includeLinks ? {} : { include_links: false }) }) });
  },
  linkExperimentPattern(token: string, id: string, nodeId: string, revision: number, includeLinks = true) {
    return request<Experiment>(`/v1/experiments/${id}/links`, token, { method: "POST", body: JSON.stringify({ node_id: nodeId, revision, ...(includeLinks ? {} : { include_links: false }) }) });
  },
  attachExperimentCheckin(token: string, id: string, observationId: string, revision: number, includeLinks = true) {
    return request<Experiment>(`/v1/experiments/${id}/checkins`, token, { method: "POST", body: JSON.stringify({ observation_id: observationId, revision, ...(includeLinks ? {} : { include_links: false }) }) });
  },

  listObservations(token: string, before?: string) {
    const query = before ? `?before=${encodeURIComponent(before)}` : "";
    return request<ListResponse>(`/v1/observations${query}`, token);
  },

  getObservation(token: string, id: string) {
    return request<ObservationResponse>(`/v1/observations/${id}`, token);
  },

  deleteObservation(token: string, id: string) {
    return request<void>(`/v1/observations/${id}`, token, { method: "DELETE" });
  },

  /** "Why do you think this?" — the answer is always the user's own words. */
  explain(token: string, nodeId: string) {
    return request<Explanation>(`/v1/graph/nodes/${nodeId}/explain`, token);
  },

  /**
   * `day` is a local calendar date and `tz` the IANA zone it belongs to. An entry
   * written at 00:30 belongs to that day in the writer's timezone, not the
   * previous one in UTC.
   */
  vocabulary(token: string, weekStart: string, tz: string, weeks = 8) {
    return request<Vocabulary>(
      `/v1/vocabulary/${weekStart}?tz=${encodeURIComponent(tz)}&weeks=${weeks}`,
      token,
    );
  },

  weeklySummary(token: string, weekStart: string, tz: string, includeFindings = true) {
    return request<WeeklySummary>(
      `/v1/summary/week/${weekStart}?tz=${encodeURIComponent(tz)}&include_findings=${includeFindings}`,
      token,
    );
  },

  dailySummary(token: string, day: string, tz: string, includeFindings = true) {
    return request<DailySummary>(
      `/v1/summary/${day}?tz=${encodeURIComponent(tz)}&include_findings=${includeFindings}`,
      token,
    );
  },

  /** Conversations newest first, with enough to tell an abandoned one from a
   *  finished one. */
  listConversations(token: string) {
    return request<{
      conversations: {
        id: string;
        started_at: string;
        closed_at: string | null;
        user_turns: number;
      }[];
    }>("/v1/conversations", token);
  },

  startConversation(token: string) {
    return request<{ id: string; started_at: string; agent: string }>(
      "/v1/conversations",
      token,
      { method: "POST" },
    );
  },

  conversation(token: string, id: string) {
    return request<Conversation>(`/v1/conversations/${id}`, token);
  },

  say(token: string, id: string, content: string, source: "text" | "voice" = "text", clientTurnId: string = Crypto.randomUUID()) {
    return request<TurnReply>(`/v1/conversations/${id}/turns`, token, {
      method: "POST",
      body: JSON.stringify({ content, source, timezone: deviceTimezone(), client_turn_id: clientTurnId }),
    });
  },

  /**
   * The same turn, read as it is written.
   *
   * `onDelta` is called with each piece as it lands, and the whole reply comes
   * back at the end for storing and for anything that needs it entire.
   *
   * Buffered response bodies are parsed with the same SSE parser as readable
   * bodies. A stream request is never retried through the plain endpoint, which
   * would duplicate the stored user turn.
   */
  async sayStreaming(
    token: string,
    id: string,
    content: string,
    source: "text" | "voice",
    onDelta: (text: string) => void,
    clientTurnId: string = Crypto.randomUUID(),
  ): Promise<TurnReply> {
    const response = await fetch(`${BASE_URL}/v1/conversations/${id}/turns/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content, source, timezone: deviceTimezone(), client_turn_id: clientTurnId }),
    });
    return parseTurnStream(response, { onDelta });
  },

  async sayAloudStreaming(
    token: string,
    conversationId: string,
    uri: string,
    onTranscript: (text: string) => void,
    onDelta: (text: string) => void,
    clientTurnId: string = Crypto.randomUUID(),
  ): Promise<TurnReply> {
    const form = await audioForm(uri);
    form.append("timezone", deviceTimezone());
    form.append("client_turn_id", clientTurnId);
    const response = await fetch(
      `${BASE_URL}/v1/conversations/${conversationId}/turns/voice/stream`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
    );
    return parseTurnStream(response, { onTranscript, onDelta });
  },

  /** Ends the conversation and keeps only what the person said. */
  closeConversation(token: string, id: string, includeFindings = true) {
    const params = new URLSearchParams({ include_findings: String(includeFindings) });
    return request<{ turns_converted: number; observations: string[] }>(
      `/v1/conversations/${id}/close?${params.toString()}`,
      token,
      { method: "POST" },
    );
  },

  graph(token: string, options: { limit?: number; minConfidence?: number } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.minConfidence !== undefined) {
      params.set("min_confidence", String(options.minConfidence));
    }
    const query = params.toString();
    return request<Subgraph>(`/v1/graph${query ? `?${query}` : ""}`, token);
  },

  graphSummary(token: string) {
    return request<GraphSummary>("/v1/graph/summary", token);
  },

  /** The projection. `withRemoved` also returns what the person took back —
   *  the tombstones the identity screen says are never lost, which this client
   *  never asked for and therefore could never draw. */
  identity(token: string, withRemoved = false) {
    return request<IdentityProjection>(
      `/v1/identity${withRemoved ? "?include_removed=true" : ""}`,
      token,
    );
  },

  /** The readings a finding is made of — its SUPPORTS neighbours. The web
   *  client has had this since it was ported; this one never asked, so a
   *  recurrence here could not be decomposed into the readings behind it. */
  neighbours(token: string, nodeId: string) {
    return request<{
      node: GraphNode;
      neighbours: (GraphNode & { cites_entries?: number })[];
      edges: { from_id: string; to_id: string; kind: string; note?: string | null }[];
    }>(`/v1/graph/nodes/${nodeId}/neighbours`, token);
  },

  identityCandidates(token: string) {
    return request<IdentityCandidates>("/v1/identity/candidates", token);
  },

  selectIdentity(token: string, nodeId: string) {
    return request<IdentityNode>("/v1/identity/selections", token, {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId }),
    });
  },

  updateIdentitySelection(token: string, nodeId: string, status: IdentitySelectionStatus) {
    return request<IdentityNode>(`/v1/identity/selections/${nodeId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  removeIdentity(token: string, nodeId: string) {
    return request<void>(`/v1/identity/selections/${nodeId}`, token, { method: "DELETE" });
  },

  /** What moved between the last seven days and the seven before.
   *
   * Derived on request, never stored: a change is a statement about two windows
   * ending today, and a cached one would quietly become a statement about two
   * windows ending whenever it was written. */
  temporalChanges(token: string, timezone: string) {
    return request<TemporalChanges>(
      `/v1/temporal/changes?timezone=${encodeURIComponent(timezone)}`,
      token,
    );
  },

  /** Agree, disagree, or take it back.
   *
   * Rejecting does not delete: the reading stays with its provenance, marked
   * rejected, and stops feeding patterns and temporal changes. */
  judgeNode(token: string, nodeId: string, status: Judgement) {
    return request<NodeSummary>(`/v1/nodes/${nodeId}/judgement`, token, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  },

  selfModel(token: string) {
    return request<SelfModel>("/v1/self-model", token);
  },

  listPatterns(token: string) {
    return request<Pattern[]>("/v1/patterns", token);
  },

  listThreads(token: string) {
    return request<PatternThread[]>("/v1/patterns/threads", token);
  },

  listThemes(token: string) {
    return request<Theme[]>("/v1/themes", token);
  },

  theme(token: string, themeId: string) {
    return request<ThemeDetail>(`/v1/themes/${encodeURIComponent(themeId)}`, token);
  },

  patternOrdering(token: string, patternId: string) {
    return request<Ordering>(`/v1/patterns/${encodeURIComponent(patternId)}/ordering`, token);
  },

  minePatterns(token: string) {
    return request<MinePatternsResponse>("/v1/patterns/mine", token, {
      method: "POST",
    });
  },

  listAgents(token: string) {
    return request<AgentInfo[]>("/v1/agents", token);
  },

  listAgentRuns(token: string, limit = 50) {
    const query = new URLSearchParams({ limit: String(limit) }).toString();
    return request<AgentRun[]>(`/v1/agents/runs?${query}`, token);
  },

  runAgents(token: string) {
    return request<AgentRunResult[]>("/v1/agents/run", token, {
      method: "POST",
    });
  },
};

export type { EdgeKind, EpistemicStatus, NodeKind };
