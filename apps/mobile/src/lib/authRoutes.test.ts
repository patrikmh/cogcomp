import { isPublicRoute, PUBLIC_ROUTES } from "./authRoutes";

describe("public mobile routes", () => {
  it("allows only the disclosure and login routes", () => {
    expect(PUBLIC_ROUTES).toEqual(["/login", "/words"]);
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/words")).toBe(true);
    expect(isPublicRoute("/")).toBe(false);
    expect(isPublicRoute("/settings")).toBe(false);
  });

  it("handles a trailing slash and query without widening the allowlist", () => {
    expect(isPublicRoute("/words/")).toBe(true);
    expect(isPublicRoute("/words?from=login")).toBe(true);
    expect(isPublicRoute("/wordsmith")).toBe(false);
  });
});
