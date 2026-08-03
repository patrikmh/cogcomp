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

  it("sends revision and completion fields to lifecycle endpoints", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "experiment", state: "completed" }));
    await api.experimentTransition("token", "experiment", "complete", 3, "met", "observation");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/experiments/experiment/complete", expect.objectContaining({ method: "POST", body: JSON.stringify({ revision: 3, assessment: "met", final_checkin_observation_id: "observation" }) }));
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
