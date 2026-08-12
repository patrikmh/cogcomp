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

/**
 * Everything that can offer a way in, minus the places that only look like they
 * do.
 *
 * `dev.tsx` is excluded because it sits behind a preference that is off by
 * default: a route offered only there is unreachable for everyone who has not
 * turned the switch on. And a screen is not a way into its own family — the
 * experiment detail redirects to /experiments after a delete, which is a way
 * *out*, not a door.
 *
 * Both exclusions are here because the first version of this test accepted both
 * and passed while Experiments was reachable from nowhere.
 */
function sources(forRoute: string): string {
  // Singular and plural are one family. `experiment/[id].tsx` redirects to
  // `/experiments` after a delete, which is a way *out* of the feature; counting
  // it as a way in is precisely how this test passed while Experiments was
  // reachable from nowhere.
  // Only when checking a *list* route. A list linking to its own detail screen
  // is a real door — `experiments.tsx` is how you reach `experiment/[id]` — but
  // the detail screen redirecting back to the list after a delete is a way out.
  const stem = (forRoute.split("/")[0] ?? forRoute).replace(/s$/, "");
  const checkingAList = !forRoute.includes("[");
  const sameFamily = (name: string) =>
    checkingAList && name.replace(/\.tsx?$/, "").replace(/s$/, "") === stem;
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (sameFamily(entry.name)) continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        if (entry.name === "dev.tsx") continue;
        if (sameFamily(entry.name)) continue;
        if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
        parts.push(fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(APP);
  walk(path.join(__dirname, ".."));
  return parts.join("\n");
}

/**
 * Screens a person reaches only by turning the developer switch on.
 *
 * Named rather than inferred. `destinations.ts` explains the decision: the graph,
 * the run log and the explorer are machinery, not places you pass through on the
 * way to writing something down, and mobile cut its menu to four on purpose.
 * Listing them here means the test states that decision instead of accepting any
 * reference from `dev.tsx` — which is how it missed Experiments becoming
 * unreachable while still passing.
 */
const DEVELOPER_ONLY = new Set(["agents", "graph", "explore"]);

describe("every screen has a way in", () => {
  const cases = routes()
    // index is the app's own root, and login is where the gate sends you.
    .filter((r) => r !== "index" && r !== "login")
    .map((r) => [r] as const);

  it.each(cases)("%s is navigated to from somewhere a person can reach", (route) => {
    // Developer surfaces are allowed to hang off the developer menu, and only
    // there. Anything else has to be reachable with the switch off.
    const all = DEVELOPER_ONLY.has(route)
      ? sources(route) + fs.readFileSync(path.join(APP, "dev.tsx"), "utf8")
      : sources(route);
    const dynamic = route.includes("[");
    const needle = dynamic ? route.replace(/\[\w+\]/, "") : route;
    // `/node/${id}` for dynamic screens, `"/settings"` for fixed ones.
    const referenced = dynamic
      ? all.includes(`/${needle}`)
      : new RegExp(`["'\`]/${needle}["'\`]`).test(all);
    expect(referenced).toBe(true);
  });
});
