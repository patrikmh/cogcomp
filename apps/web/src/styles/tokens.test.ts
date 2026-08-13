import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { colors, radii, type } from "@tlon/design";

/**
 * The two ways this product describes itself, kept in agreement.
 *
 * The web renders from `tlon.css`, which is the design's stylesheet copied
 * verbatim. The mobile client renders from `packages/design/tokens.ts`, because
 * React Native has no stylesheet. Nothing has ever compared them, and four
 * values drifted before anyone looked: a title's leading, a section heading's
 * size, and both letter-spacings — each wrong only on mobile, each invisible on
 * the web because the web never reads the tokens.
 *
 * So this reads the numbers out of the stylesheet and asserts the tokens say
 * the same thing. It is deliberately not a snapshot: it fails with the two
 * values side by side, which is the only useful thing a test like this can say.
 *
 * Letter-spacing is stated in em by the design and in pixels by the tokens,
 * because React Native has no em. The conversion is done here rather than
 * trusted.
 */
// Resolved from the project root: vitest serves this module over http, so
// `import.meta.url` is not a file URL here.
const css = readFileSync(join(process.cwd(), "src/styles/tlon.css"), "utf8");

/** `font: <weight> <size>px/<line>px "…"` — the shorthand the design uses. */
function fontOf(selector: string): { size: number; line: number; weight: number } {
  const rule = new RegExp(`${selector}\\s*\\{[^}]*?font:\\s*(\\d+)\\s+([\\d.]+)px/([\\d.]+)px`).exec(css);
  if (!rule) throw new Error(`no font shorthand for ${selector} in tlon.css`);
  return { weight: Number(rule[1]), size: Number(rule[2]), line: Number(rule[3]) };
}

/** Letter-spacing in em, as the design states it. */
function trackingOf(selector: string): number {
  const rule = new RegExp(`${selector}\\s*\\{[^}]*?letter-spacing:\\s*(-?[\\d.]+)em`).exec(css);
  if (!rule) throw new Error(`no letter-spacing for ${selector} in tlon.css`);
  return Number(rule[1]);
}

function variable(name: string): string {
  const rule = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
  return rule ? rule[1]!.toLowerCase() : "";
}

describe("the type scale says the same thing in both clients", () => {
  it("sets a title as the stylesheet sets h1", () => {
    const h1 = fontOf("h1");
    expect({ size: type.title.size, line: type.title.line }).toEqual({
      size: h1.size,
      line: h1.line,
    });
    expect(type.title.tracking).toBeCloseTo(trackingOf("h1") * h1.size, 2);
  });

  it("sets a heading as the stylesheet sets h2", () => {
    const h2 = fontOf("h2");
    expect({ size: type.heading.size, line: type.heading.line }).toEqual({
      size: h2.size,
      line: h2.line,
    });
    expect(Number(type.heading.weight)).toBe(h2.weight);
  });

  it("sets body text as the stylesheet sets it", () => {
    const body = fontOf("body");
    expect({ size: type.body.size, line: type.body.line }).toEqual({
      size: body.size,
      line: body.line,
    });
  });

  it("tracks a kicker the way the stylesheet tracks it", () => {
    const kicker = new RegExp(
      `\\.kicker\\s*\\{[^}]*?font:\\s*\\d+\\s+([\\d.]+)px[^}]*?letter-spacing:\\s*([\\d.]+)em`,
    ).exec(css);
    expect(kicker, "no .kicker rule in tlon.css").toBeTruthy();
    const size = Number(kicker![1]);
    const em = Number(kicker![2]);
    expect(type.kicker.size).toBe(size);
    expect(type.kicker.tracking).toBeCloseTo(em * size, 2);
  });
});

describe("the palette says the same thing in both clients", () => {
  it("carries every colour the stylesheet declares, unchanged", () => {
    for (const [name, hex] of Object.entries(colors)) {
      const declared = variable(name);
      if (!declared) continue; // a token the stylesheet has no variable for
      expect(`${name}=${hex.toLowerCase()}`).toBe(`${name}=${declared}`);
    }
  });
});

describe("the radii say the same thing in both clients", () => {
  it("keeps a surface at the radius the stylesheet uses for one", () => {
    // The design rounds content and controls to 3, chips to 2, and only a
    // switch to a circle. A drift here reads as a different product.
    expect(radii.surface).toBe(3);
    expect(radii.chip).toBe(2);
    expect(radii.pill).toBe(999);
    expect(css).toContain("border-radius:3px");
  });
});
