import fs from "node:fs";
import path from "node:path";

/**
 * Every screen has a way in.
 *
 * This exists because of a specific failure. The Journal used to carry a menu
 * listing Settings, that menu was removed as redundant, and for one commit
 * Settings was registered, titled, rendered — and reachable from nowhere. Nothing
 * failed. Every test passed. It was found by looking at the app.
 *
 * A route is reachable if some other file navigates to it, or the bottom bar
 * offers it. Screens you can only arrive at with an id in hand are checked by
 * their pattern rather than their literal path.
 */
const APP = path.join(__dirname, "..", "..", "app");

function routes(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".tsx") && entry.name !== "_layout.tsx") {
        found.push(`${prefix}${entry.name.replace(/\.tsx$/, "")}`);
      }
    }
  };
  walk(APP);
  return found;
}

function sources(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) parts.push(fs.readFileSync(full, "utf8"));
    }
  };
  walk(APP);
  walk(path.join(__dirname, ".."));
  return parts.join("\n");
}

describe("every screen has a way in", () => {
  const all = sources();

  const cases = routes()
    // index is the app's own root, and login is where the gate sends you.
    .filter((r) => r !== "index" && r !== "login")
    .map((r) => [r] as const);

  it.each(cases)("%s is navigated to from somewhere", (route) => {
    const dynamic = route.includes("[");
    const needle = dynamic ? route.replace(/\[\w+\]/, "") : route;
    // `/node/${id}` for dynamic screens, `"/settings"` for fixed ones.
    const referenced = dynamic
      ? all.includes(`/${needle}`)
      : new RegExp(`["'\`]/${needle}["'\`]`).test(all);
    expect(referenced).toBe(true);
  });
});
