import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a 401 means depends on whether we sent a token.
 *
 * With a token, it means the server has forgotten the session, and the whole
 * app has to stop pretending otherwise. Without one — signing in with the wrong
 * password — it is an ordinary answer to an ordinary question, and the client
 * used to treat it as the first case: it cleared a token that was never there,
 * fired the session-lost handler, and threw away the server's "invalid email or
 * password" in favour of the status line's own word, which named neither field.
 */
async function freshApi() {
  vi.resetModules();
  return import("./api");
}

function reply(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      statusText: "",
      json: async () => body,
    }),
  );
}

describe("a 401 from the server", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps the server's own words when signing in fails", async () => {
    reply(401, { detail: "invalid email or password" });
    const { api } = await freshApi();

    await expect(api.login("someone@example.com", "wrong-password-here")).rejects.toThrow(
      "invalid email or password",
    );
  });

  it("does not report a lost session when there was no session", async () => {
    reply(401, { detail: "invalid email or password" });
    const { api, onSessionLost } = await freshApi();
    const lost = vi.fn();
    onSessionLost(lost);

    await expect(api.login("someone@example.com", "wrong-password-here")).rejects.toThrow();
    expect(lost).not.toHaveBeenCalled();
  });

  it("still reports a lost session when the token we sent was refused", async () => {
    localStorage.setItem("tlon.token", "stale");
    reply(401, { detail: "unauthorized" });
    const { api, onSessionLost } = await freshApi();
    const lost = vi.fn();
    onSessionLost(lost);

    await expect(api.me()).rejects.toThrow();
    expect(lost).toHaveBeenCalledOnce();
    expect(localStorage.getItem("tlon.token")).toBeNull();
  });

  it("leaves a failed sign-in able to try again", async () => {
    localStorage.setItem("tlon.token", "");
    reply(401, { detail: "invalid email or password" });
    const { api, currentToken } = await freshApi();

    await expect(api.login("someone@example.com", "wrong-password-here")).rejects.toThrow();
    expect(currentToken()).toBe("");
  });

  it("passes a duplicate signup through as the server explains it", async () => {
    reply(409, { detail: "an account with that email already exists" });
    const { api } = await freshApi();

    await expect(api.signup("taken@example.com", "a-long-enough-password")).rejects.toThrow(
      "an account with that email already exists",
    );
  });
});
