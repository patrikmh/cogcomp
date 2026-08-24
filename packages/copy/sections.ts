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
  /** Need, value, belief — kept apart from the day's weather. */
  holds: { title: "What you hold", aside: "not a mood" },
  /** Inner readings that returned in this window. A count, never a diagnosis. */
  cameBack: { title: "Came back", aside: "more than once, not a diagnosis" },
  /** People, places, acts, events that returned in this window. */
  again: { title: "Came up more than once", aside: "a count, not a verdict" },
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
  /** Inner names no region lists. Only when some names are in a region. */
  alone: { title: "Not in a region", aside: "alone, not lost" },
  /** Written days this window did not name inside. Only when both exist. */
  unsaid: { title: "Days the record left unnamed", aside: "written, nothing inner" },
  /** Written days that named a need or value and left no act. Only when a paired day exists. */
  asked: { title: "Named, no act written", aside: "the record, not the day" },
  /** Identity holds this window did not name. Only when some holds were named. */
  quiet: { title: "Quiet this week", aside: "held, not written" },
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
  /** On a recurrence: the readings it counts, in rooms. */
  parts: { title: "What it is made of", aside: "rooms, not a mix" },
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
  /** On a thought: a belief it holds up. */
  holdsUp: { title: "Holds up", aside: "evidence, not proof" },
  /** On that belief: the thoughts that hold it up. */
  heldUp: { title: "Held up by", aside: "evidence, not proof" },
  /** On a feeling or thought: what the record wondered came after. */
  maybeAfter: { title: "After, maybe", aside: "a hypothesis, not a cause" },
  /** On that activity, event, or thought: what the record wondered this came before. */
  maybeBefore: { title: "Before this, maybe", aside: "a hypothesis, not a cause" },
  /** On a reading: another reading the record linked only by writing why. */
  related: { title: "Also related", aside: "a note, not a kind" },
  /** On a reading: the distinct writing days behind its evidence, so the
   *  spread of a recurrence can be walked in context. */
  behind: { title: "The days behind", aside: "written days, first seen first" },
  /** Beliefs the record both holds up and sits against. */
  pulled: { title: "Pulled both ways", aside: "both in the record" },
  /** Beliefs the record holds and never argues. */
  unargued: { title: "Never argued", aside: "held, not tested" },
  /** Needs and values the record holds and never hints at. */
  unhinted: { title: "Never hinted", aside: "held, not named from a thought" },
  /** Emotions the record names and never aims. */
  untargeted: { title: "Felt, toward nothing", aside: "a feeling, not a direction" },
  /** Thoughts the record names and never points at a subject. */
  untitled: { title: "Thought, about nothing", aside: "a thought, not a topic" },
  /** Experiments. */
  arcs: { title: "Your arcs", aside: "active first" },
  /** On a reading: the trials already set against it. */
  wondered: { title: "You wondered", aside: "yours, not proposed" },
  /** Holds never linked to a trial. Only when some hold already is. */
  untried: { title: "Never tried", aside: "held, not a trial" },
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
