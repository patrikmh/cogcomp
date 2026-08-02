import type { EdgeKind, EpistemicStatus, NodeKind } from "@tlon/ontology";

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
  turns: ConversationTurn[];
}

export interface TurnReply {
  reply: string;
  /** The agent judged someone may be at risk. The UI stops prompting and shows
   *  the services below instead. */
  crisis: boolean;
  crisis_resources: string[];
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
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

export interface GraphSummary {
  schema_version: string;
  counts: { kind: NodeKind; count: number }[];
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
async function audioForm(uri: string): Promise<FormData> {
  const form = new FormData();
  if (uri.startsWith("blob:") || uri.startsWith("data:")) {
    const blob = await fetch(uri).then((r) => r.blob());
    form.append("audio", blob, "recording.webm");
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
    },
  ) {
    return request<ObservationResponse>("/v1/observations", token, {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        content: input.content,
        source: input.source,
        captured_at: input.capturedAt,
      }),
    });
  },

  /**
   * Uploads a recording; the server transcribes it and stores the transcript.
   * The audio is not retained anywhere — the transcript is the entry.
   */
  async createVoiceObservation(
    token: string,
    input: { id: string; uri: string; capturedAt: string },
  ): Promise<ObservationResponse> {
    const form = await audioForm(input.uri);
    form.append("id", input.id);
    form.append("captured_at", input.capturedAt);
    return uploadAudio<ObservationResponse>("/v1/observations/voice", token, form);
  },

  /** Speak a turn instead of typing it. Takes the same path as a typed turn
   *  once transcribed. */
  async sayAloud(
    token: string,
    conversationId: string,
    uri: string,
  ): Promise<TurnReply> {
    const form = await audioForm(uri);
    return uploadAudio<TurnReply>(
      `/v1/conversations/${conversationId}/turns/voice`,
      token,
      form,
    );
  },

  listObservations(token: string, before?: string) {
    const query = before ? `?before=${encodeURIComponent(before)}` : "";
    return request<ListResponse>(`/v1/observations${query}`, token);
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
  dailySummary(token: string, day: string, tz: string) {
    return request<DailySummary>(
      `/v1/summary/${day}?tz=${encodeURIComponent(tz)}`,
      token,
    );
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

  say(token: string, id: string, content: string, source: "text" | "voice" = "text") {
    return request<TurnReply>(`/v1/conversations/${id}/turns`, token, {
      method: "POST",
      body: JSON.stringify({ content, source }),
    });
  },

  /** Ends the conversation and keeps only what the person said. */
  closeConversation(token: string, id: string) {
    return request<{ turns_converted: number; observations: string[] }>(
      `/v1/conversations/${id}/close`,
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
};

export type { EdgeKind, EpistemicStatus, NodeKind };
