import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, setToken } from "./api";

describe("spoken conversation turns", () => {
  beforeEach(() => {
    setToken("token");
    vi.restoreAllMocks();
  });

  it("lists conversations without limiting the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ conversations: [] }),
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listConversations()).resolves.toEqual({ conversations: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/conversations");
    expect(fetchMock.mock.calls[0]![0]).not.toContain("limit=1");
  });

  it("loads an existing conversation's turns", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: "conversation-1",
        started_at: "2026-08-16T00:00:00Z",
        closed_at: null,
        agent: "converse-v0.1",
        flagged: false,
        turns: [{ speaker: "user", content: "hello" }],
      }),
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.conversation("conversation-1")).resolves.toMatchObject({
      id: "conversation-1",
      turns: [{ speaker: "user", content: "hello" }],
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/conversations/conversation-1");
  });

  it("uploads one multipart request and parses the spoken stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: () => Promise.resolve(
        'data: {"type":"transcript","text":"I said this"}\n\n' +
          'data: {"type":"delta","text":"What "}\n\n' +
          'data: {"type":"delta","text":"next?"}\n\n' +
          'data: {"type":"done","reply":"What next?","crisis":false,"crisis_resources":[]}\n\n',
      ),
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);
    const transcript: string[] = [];
    const deltas: string[] = [];

    await expect(
      api.sayAloudStreaming("conversation-1", new Blob(["audio"]), transcript.push.bind(transcript), deltas.push.bind(deltas)),
    ).resolves.toEqual({ reply: "What next?", crisis: false, crisis_resources: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const init = call![1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: "Bearer token" });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("timezone")).toBeTruthy();
    expect(transcript).toEqual(["I said this"]);
    expect(deltas).toEqual(["What ", "next?"]);
    expect(fetchMock.mock.calls[0]![0]).toContain("/turns/voice/stream");
  });

  it("parses a buffered text stream without posting the turn again", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: () => Promise.resolve(
        'data: {"type":"delta","text":"What "}\n\n' +
          'data: {"type":"delta","text":"next?"}\n\n' +
          'data: {"type":"done","reply":"What next?","crisis":false,"crisis_resources":[]}\n\n',
      ),
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    await expect(api.sayStreaming("conversation-1", "I said this", deltas.push.bind(deltas)))
      .resolves.toEqual({ reply: "What next?", crisis: false, crisis_resources: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain("/turns/stream");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/turns"))).toBe(false);
    expect(deltas).toEqual(["What ", "next?"]);
  });

  it("raises when a buffered stream has no done event", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: () => Promise.resolve('data: {"type":"delta","text":"Still writing"}\n\n'),
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.sayStreaming("conversation-1", "I said this", () => undefined))
      .rejects.toMatchObject({ status: 502, message: "the reply ended before it was finished" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("raises an SSE error without retrying through the text endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
      text: () => Promise.resolve('data: {"type":"error","message":"failed"}\n\n'),
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.sayAloudStreaming("conversation-1", new Blob(["audio"]), () => undefined, () => undefined)).rejects.toThrow("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
