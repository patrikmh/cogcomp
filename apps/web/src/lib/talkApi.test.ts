import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, setToken } from "./api";

describe("spoken conversation turns", () => {
  beforeEach(() => {
    setToken("token");
    vi.restoreAllMocks();
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
