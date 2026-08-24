import { api } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("experiment API wrappers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("lists experiments with the account-authenticated response shape", async () => {
    const result = { experiments: [{ id: "00000000-0000-0000-0000-000000000001", state: "draft" }] };
    fetchMock.mockResolvedValue(jsonResponse(result));
    await expect(api.listExperiments("token")).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/experiments", { headers: { "Content-Type": "application/json", Authorization: "Bearer token" } });
  });

  it("can omit derived links for findings-off reads", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ experiments: [] }));
    await api.listExperiments("token", false);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:8080/v1/experiments?include_links=false");

    fetchMock.mockResolvedValue(jsonResponse({ id: "experiment" }));
    await api.experiment("token", "experiment", false);
    expect(String(fetchMock.mock.calls[1][0])).toBe("http://localhost:8080/v1/experiments/experiment?include_links=false");
  });

  it("sends revision and completion fields to lifecycle endpoints", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "experiment", state: "completed" }));
    await api.experimentTransition("token", "experiment", "complete", 3, "met", "observation");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/experiments/experiment/complete", expect.objectContaining({ method: "POST", body: JSON.stringify({ revision: 3, assessment: "met", final_checkin_observation_id: "observation" }) }));
  });

  it("can omit derived links from lifecycle responses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "experiment", state: "active" }));
    await api.experimentTransition("token", "experiment", "start", 3, undefined, undefined, false);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ revision: 3, assessment: undefined, final_checkin_observation_id: undefined, include_links: false });
  });
});

describe("summary API wrappers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue(jsonResponse({}));
  });

  it("passes findings state to daily and weekly summaries", async () => {
    await api.dailySummary("token", "2026-03-05", "UTC", false);
    await api.weeklySummary("token", "2026-03-02", "UTC", false);

    expect(String(fetchMock.mock.calls[0][0])).toContain("include_findings=false");
    expect(String(fetchMock.mock.calls[1][0])).toContain("include_findings=false");
  });
});

describe("conversation API wrappers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("passes findings preference when closing a conversation", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ conversation_id: "conversation-1", observations: [], turns_converted: 0 }));

    await api.closeConversation("token", "conversation-1", false);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://localhost:8080/v1/conversations/conversation-1/close?include_findings=false",
    );
  });

  it("lists conversations without limiting the results to one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ conversations: [] }));

    await api.listConversations("token");

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("http://localhost:8080/v1/conversations");
    expect(url).not.toContain("limit=1");
  });
});

describe("capture carries the device timezone", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  // Attached inside the client rather than by each screen: a day is a local
  // fact, and a capture path that forgot to say where it happened would put the
  // entry on the wrong day for anyone writing late at night.
  it("sends the zone with a typed entry", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 201));

    await api.createObservation("token", {
      id: "entry-1",
      content: "late one tonight",
      source: "text",
      capturedAt: "2026-03-05T23:30:00.000Z",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  });

  it("sends the zone with a conversation turn", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ reply: "mm" }));

    await api.say("token", "conversation-1", "I said this at midnight");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  });
});

describe("patterns and agent API wrappers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("lists patterns with the authenticated GET contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await api.listPatterns("token");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/patterns", {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
    });
  });

  it("fetches the ordered evidence behind one pattern", async () => {
    const ordering = {
      pattern_id: "pattern-1",
      label: "sleeping badly came up 1 day before foggy · 4 times (UTC)",
      lag_days: 1,
      occasions: [],
    };
    fetchMock.mockResolvedValue(jsonResponse(ordering));

    expect(await api.patternOrdering("token", "pattern-1")).toEqual(ordering);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/patterns/pattern-1/ordering",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      },
    );
  });

  it("mines patterns with POST and preserves the mining response", async () => {
    const result = { patterns: 2, considered: 9 };
    fetchMock.mockResolvedValue(jsonResponse(result));

    await expect(api.minePatterns("token")).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/patterns/mine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
    });
  });

  it("selects and removes identity nodes through the typed API", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "node-1" }))
      .mockResolvedValueOnce(jsonResponse({ id: "node-1", status: "removed" }));

    await api.selectIdentity("token", "node-1");
    await api.updateIdentitySelection("token", "node-1", "removed");

    expect(fetchMock.mock.calls).toEqual([
      ["http://localhost:8080/v1/identity/selections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({ node_id: "node-1" }),
      }],
      ["http://localhost:8080/v1/identity/selections/node-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        body: JSON.stringify({ status: "removed" }),
      }],
    ]);
  });

  it("uses the agent list, run history, and run-all contracts", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ name: "patterns", version: "v1", cadence_seconds: 60 }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ agent: "patterns", status: "succeeded" }]));

    await api.listAgents("token");
    await api.listAgentRuns("token", 10);
    await api.runAgents("token");

    expect(fetchMock.mock.calls).toEqual([
      ["http://localhost:8080/v1/agents", {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      }],
      ["http://localhost:8080/v1/agents/runs?limit=10", {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      }],
      ["http://localhost:8080/v1/agents/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
      }],
    ]);
  });
});

describe("streaming a turn when the body cannot be read incrementally", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("parses the already-stored stream instead of posting the turn again", async () => {
    const raw =
      'data: {"type":"delta","text":"What "}\n\n' +
      'data: {"type":"delta","text":"next?"}\n\n' +
      'data: {"type":"done","reply":"What next?","crisis":false,"crisis_resources":[]}\n\n';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: null,
      text: jest.fn().mockResolvedValue(raw),
      json: jest.fn(),
    } as unknown as Response);

    const deltas: string[] = [];
    await expect(
      api.sayStreaming("token", "conversation-1", "I said this", "voice", (text) => {
        deltas.push(text);
      }, "11111111-1111-4111-8111-111111111111"),
    ).resolves.toEqual({ reply: "What next?", crisis: false, crisis_resources: [] });

    expect(deltas).toEqual(["What ", "next?"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/turns/stream");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).client_turn_id)
      .toBe("11111111-1111-4111-8111-111111111111");
  });

  it("does not invent a finished reply from a truncated stream", async () => {
    const raw = 'data: {"type":"delta","text":"What "}\n\n';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: null,
      text: jest.fn().mockResolvedValue(raw),
      json: jest.fn(),
    } as unknown as Response);

    await expect(
      api.sayStreaming("token", "conversation-1", "I said this", "voice", () => undefined),
    ).rejects.toThrow("the reply ended before it was finished");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streaming a spoken turn", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("posts audio once to the voice stream and never to /turns", async () => {
    const raw =
      'data: {"type":"transcript","text":"I said this"}\n\n' +
      'data: {"type":"delta","text":"What "}\n\n' +
      'data: {"type":"done","reply":"What next?","crisis":false,"crisis_resources":[]}\n\n';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: null,
      text: jest.fn().mockResolvedValue(raw),
      json: jest.fn(),
    } as unknown as Response);

    const transcripts: string[] = [];
    const deltas: string[] = [];
    await expect(
      api.sayAloudStreaming(
        "token",
        "conversation-1",
        "file:///tmp/recording.m4a",
        (text) => transcripts.push(text),
        (text) => deltas.push(text),
        "33333333-3333-4333-8333-333333333333",
      ),
    ).resolves.toEqual({ reply: "What next?", crisis: false, crisis_resources: [] });

    expect(transcripts).toEqual(["I said this"]);
    expect(deltas).toEqual(["What "]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/turns/voice/stream");
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/\/turns$/);
    expect(((fetchMock.mock.calls[0][1] as RequestInit).body as FormData).get("client_turn_id"))
      .toBe("33333333-3333-4333-8333-333333333333");
  });
});

describe("extraction after save", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("posts to the observation's extract endpoint with the account token", async () => {
    const result = { observation_id: "00000000-0000-0000-0000-000000000009", extractor: "stub-v0", nodes: 2, edges: 1 };
    fetchMock.mockResolvedValue(jsonResponse(result));
    await expect(api.extract("token", "00000000-0000-0000-0000-000000000009")).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/v1/observations/00000000-0000-0000-0000-000000000009/extract",
      { headers: { "Content-Type": "application/json", Authorization: "Bearer token" }, method: "POST" },
    );
  });
});
