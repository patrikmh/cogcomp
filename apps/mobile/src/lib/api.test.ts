import { api } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

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
