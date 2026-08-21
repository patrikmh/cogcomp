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
  /** The inner week: felt, needed, valued, believed, thought. Named, never
   *  diagnosed, and kept apart from people, places, and activities so that
   *  world can be walked on its own. */
  inside: { title: "Felt and thought", aside: "named, not a verdict" },
  /** Inner readings that returned in this window. A count, never a diagnosis. */
  cameBack: { title: "Came back", aside: "more than once, not a diagnosis" },
  /** A search term the record also used as a name for something felt. */
  named: { title: "Also named", aside: "the record's word, not yours" },
  /** People, places, and acts — the outer room of a composition or a region. */
  around: { title: "People, places, acts", aside: "what the days did" },
  /** What it is not sure of. Its own section, never mixed in and greyed. */
  lessSure: { title: "Less sure", aside: "unobserved, they grow vague" },
  /** The recurrence a day belongs to. */
  circling: { title: "Circling" },
  /** A cluster of associations, not a pair and not a diagnosis. */
  regions: { title: "Regions", aside: "groups, not pairs" },
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
  /** On a reading: the recurrences it supports. Membership, not origin. */
  among: { title: "This reading is among", aside: "it supports these" },
  /** On a reading: what keeps arriving in the same entries. Adjacency only. */
  travels: { title: "Travels with", aside: "together, not because" },
  /** On a reading: the regions that list it. Membership, not a heading. */
  inRegion: { title: "This reading is in", aside: "a region, not a pair" },
  /** On a weekday finding: the week as a shape, not a reason. */
  calendar: { title: "The calendar", aside: "shape, not a reason" },
  /** On a stated-vs-recorded finding: the two sides that stayed apart. */
  apart: { title: "What stayed apart", aside: "a gap, not a verdict" },
  /** On a feeling: who or what it is aimed at. */
  toward: { title: "Felt toward", aside: "a direction, not a reason" },
  /** On a person, place, or act: feelings aimed at it. */
  towardThis: { title: "Felt toward this", aside: "a direction, not a reason" },
  /** On a thought or feeling: the person, place, or act it names. */
  about: { title: "About", aside: "subject, not a verdict" },
  /** On that subject: the thoughts and feelings that name it. */
  aboutThis: { title: "About this", aside: "subject, not a verdict" },
  /** On a thought or feeling: a need or value it may be naming. */
  hints: { title: "Hints at", aside: "a hint, not a cause" },
  /** On that need or value: the thoughts and feelings that name it. */
  hinted: { title: "Hinted at by", aside: "a hint, not a cause" },
  /** On a thought: a belief or pattern it sits against. */
  against: { title: "Sits against", aside: "tension, not a verdict" },
  /** On that belief or pattern: the thoughts that sit against it. */
  againstThis: { title: "Sat against by", aside: "tension, not a verdict" },
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
