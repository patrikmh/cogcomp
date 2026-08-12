/**
 * What each section of a screen is called, and what its aside says.
 *
 * Taken from the design, where every section is a kicker, a rule, and a short
 * phrase at the far end of it. The phrase is not decoration: it says how the
 * section is ordered or what it holds — "surest first", "kept verbatim",
 * "tentative — they may not hold" — which is what a reader needs before reading
 * the section rather than after.
 *
 * These live here because both clients must say the same words and because the
 * end-to-end suite asserts on them. Renaming a section used to mean changing it
 * in two clients and remembering a shell script; three times in one week that
 * last step was missed, and the suite only failed on its next full run. A name
 * defined once cannot drift between the places that use it.
 */
export interface Section {
  title: string;
  /** The phrase at the end of the rule. Absent where the design has none. */
  aside?: string;
  /** Where the design's phrase describes a mouse. Touch clients use this. */
  asideTouch?: string;
}

export const SECTIONS = {
  /** Journal and Today: the person's own words, unaltered. */
  acts: { title: "The acts", aside: "kept verbatim" },
  /** What the extractor drew and the record stands behind. */
  kept: { title: "What they left behind", aside: "surest first" },
  /** What it is not sure of. Its own section, never mixed in and greyed. */
  lessSure: { title: "Less sure", aside: "unobserved, they grow vague" },
  /** The recurrence a day belongs to. */
  circling: { title: "Circling" },
  /** The week's shape. The design's aside mentions hovering, which a phone
   *  cannot do, so touch clients say only what is true of a tap. */
  rhythm: {
    title: "The rhythm",
    aside: "written days open · hover previews",
    asideTouch: "written days open",
  },
  /** Patterns that hold. */
  returning: { title: "What kept returning", aside: "strongest first" },
  /** Patterns that do not yet. */
  forming: { title: "Still forming", aside: "tentative — they may not hold" },
  /** The person's own vocabulary, shown back to them. */
  words: { title: "Your own words for it", aside: "counted, never interpreted" },
  /** On a reading: the entries it was drawn from. */
  evidence: { title: "The acts behind it" },
  /** Experiments. */
  arcs: { title: "Your arcs", aside: "active first" },
  reason: { title: "Why you started it" },
  checkins: { title: "Check-ins", aside: "ordinary entries · most recent" },
  finish: { title: "Finish", aside: "yours to call" },
} satisfies Record<string, Section>;

export type SectionName = keyof typeof SECTIONS;

/** The aside to show, given whether the client is driven by touch. */
export function asideOf(name: SectionName, touch = false): string | undefined {
  const section: Section = SECTIONS[name];
  return touch ? (section.asideTouch ?? section.aside) : section.aside;
}
