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
  is_observed: boolean;
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

  graphSummary(token: string) {
    return request<GraphSummary>("/v1/graph/summary", token);
  },
};

export type { EdgeKind, EpistemicStatus, NodeKind };
