import { ApiError } from "@/lib/api";

import { createUserQueryClient, isExpiredSession } from "./queryClient";

describe("user query cache isolation", () => {
  it("does not reuse identity data after an account switch", () => {
    const firstUser = createUserQueryClient("user-a");
    firstUser.setQueryData(["identity", "user-a"], { nodes: [{ label: "private" }] });

    const secondUser = createUserQueryClient("user-b");

    expect(secondUser.getQueryData(["identity", "user-b"])).toBeUndefined();
    expect(secondUser.getQueryData(["identity", "user-a"])).toBeUndefined();

    firstUser.clear();
    secondUser.clear();
  });

  it("starts with an empty cache after sign-out", () => {
    const signedIn = createUserQueryClient("user-a");
    signedIn.setQueryData(["identity", "user-a"], { nodes: [{ label: "private" }] });

    const signedOut = createUserQueryClient(null);

    expect(signedOut.getQueryData(["identity", "user-a"])).toBeUndefined();

    signedIn.clear();
    signedOut.clear();
  });
});

describe("expired sessions", () => {
  it("recognises a 401", () => {
    expect(isExpiredSession(new ApiError(401, "unauthorized"))).toBe(true);
  });

  it("ignores other API failures", () => {
    // A 500 is the server having a bad day; a 404 is a missing row. Neither means
    // the person has been signed out, and treating them that way would throw
    // someone out of the app over an unrelated hiccup.
    for (const status of [400, 403, 404, 409, 500, 502, 503]) {
      expect(isExpiredSession(new ApiError(status, "nope"))).toBe(false);
    }
  });

  it("ignores network errors", () => {
    // Offline is not signed out. Clearing the session here would make a tunnel
    // log you out and lose your place.
    expect(isExpiredSession(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("survives nonsense", () => {
    expect(isExpiredSession(null)).toBe(false);
    expect(isExpiredSession(undefined)).toBe(false);
    expect(isExpiredSession("401")).toBe(false);
  });

  it("does not retry an expired session", () => {
    // A 401 will still be a 401 in two seconds. Retrying only delays the redirect
    // and leaves the person watching a spinner.
    const decide = createUserQueryClient(null).getDefaultOptions().queries
      ?.retry as (count: number, error: unknown) => boolean;
    expect(decide(0, new ApiError(401, "unauthorized"))).toBe(false);
  });

  it("still retries ordinary failures, then gives up", () => {
    const decide = createUserQueryClient(null).getDefaultOptions().queries
      ?.retry as (count: number, error: unknown) => boolean;
    expect(decide(0, new ApiError(500, "boom"))).toBe(true);
    expect(decide(2, new ApiError(500, "boom"))).toBe(false);
  });

  it("never retries mutations", () => {
    // Retrying a write can save the same entry twice.
    expect(createUserQueryClient(null).getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("reports an expired session from a failed query", () => {
    const expired = jest.fn();
    const client = createUserQueryClient("u1", expired);
    client.getQueryCache().config.onError?.(new ApiError(401, "no"), {} as never);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("reports an expired session from a failed mutation", () => {
    // Writes go through a different cache, and a token can die between reading a
    // screen and saving from it.
    const expired = jest.fn();
    const client = createUserQueryClient("u1", expired);
    client.getMutationCache().config.onError?.(
      new ApiError(401, "no"),
      undefined,
      undefined,
      {} as never,
      {} as never,
    );
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for failures that are not about auth", () => {
    const expired = jest.fn();
    const client = createUserQueryClient("u1", expired);
    client.getQueryCache().config.onError?.(new ApiError(500, "boom"), {} as never);
    expect(expired).not.toHaveBeenCalled();
  });

  it("works without a handler", () => {
    const client = createUserQueryClient("u1");
    expect(() =>
      client.getQueryCache().config.onError?.(new ApiError(401, "no"), {} as never),
    ).not.toThrow();
  });
});
