import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

/**
 * Restoring a session.
 *
 * The rule these pin down is a single distinction: a 401 means the server has
 * forgotten the token and the person must sign in again; everything else means
 * the server had a bad moment and the person should keep their place. Getting
 * this wrong put a password prompt in front of someone whose token was fine.
 */
const me = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { me: () => me() },
    currentToken: () => localStorage.getItem("tlon.token"),
    setToken: (next: string | null) =>
      next ? localStorage.setItem("tlon.token", next) : localStorage.removeItem("tlon.token"),
  };
});

async function freshStore() {
  vi.resetModules();
  return (await import("./session")).useSession;
}

describe("restoring a session", () => {
  beforeEach(() => {
    localStorage.clear();
    me.mockReset();
  });

  it("signs you out when the server has forgotten the token", async () => {
    localStorage.setItem("tlon.token", "stale");
    me.mockRejectedValue(new ApiError(401, "unauthorized"));

    const store = await freshStore();
    await store.getState().restore();

    expect(store.getState().token).toBeNull();
    expect(store.getState().ready).toBe(true);
  });

  it("keeps you signed in when the server merely failed", async () => {
    localStorage.setItem("tlon.token", "good");
    localStorage.setItem("tlon.user", "u-1");
    me.mockRejectedValue(new ApiError(500, "internal error"));

    const store = await freshStore();
    await store.getState().restore();

    // The token is untouched and the screens are free to show their own error.
    expect(store.getState().token).toBe("good");
    expect(store.getState().userId).toBe("u-1");
    expect(store.getState().ready).toBe(true);
  });

  it("keeps you signed in when the request never reached the server", async () => {
    localStorage.setItem("tlon.token", "good");
    me.mockRejectedValue(new TypeError("Failed to fetch"));

    const store = await freshStore();
    await store.getState().restore();

    expect(store.getState().token).toBe("good");
  });

  it("is ready, and signed out, when there was never a token", async () => {
    const store = await freshStore();
    await store.getState().restore();

    expect(store.getState().token).toBeNull();
    expect(store.getState().ready).toBe(true);
    expect(me).not.toHaveBeenCalled();
  });
});
