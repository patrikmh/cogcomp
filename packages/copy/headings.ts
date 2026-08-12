/**
 * What each screen calls itself.
 *
 * The design gives every screen a kicker naming it and a title stating what it
 * claims — "Patterns" over "What keeps returning", "Explore · developer" over
 * "Fixed positions, seeded by id". The order matters: the kicker is where you
 * are, the title is what the screen is asserting. Getting them the wrong way
 * round, as this app did on Patterns for a while, makes the heading the one
 * word the navigation already says and demotes the claim to a label.
 *
 * Defined once for the same reason the section names are: two clients must say
 * the same words, and a name that lives in two files drifts. Where a heading
 * takes a number or a date, the parts that are fixed live here and the client
 * assembles the rest.
 */
export interface Heading {
  kicker: string;
  title?: string;
}

export const HEADINGS = {
  headspace: { kicker: "Headspace" },
  search: { kicker: "Find an entry", title: "Your own words, found" },
  patterns: { kicker: "Patterns", title: "What keeps returning" },
  identity: { kicker: "Identity · a composition", title: "Drawn from everything you kept" },
  node: { kicker: "Where this came from" },
  theme: { kicker: "A region of the graph" },
  experiments: { kicker: "Experiments", title: "Things you decided to try" },
  agents: { kicker: "Agent activity", title: "What was decided while you were away" },
  graph: { kicker: "Graph · developer" },
  explore: { kicker: "Explore · developer", title: "Fixed positions, seeded by id" },
  settings: { kicker: "Settings" },
  words: { kicker: "Before your first entry", title: "What happens to your words" },
  first: { kicker: "First fortnight", title: "The machinery is filling" },
  login: { kicker: "", title: "A private journal" },
  journal: { kicker: "Journal" },
} satisfies Record<string, Heading>;

export type HeadingName = keyof typeof HEADINGS;

/**
 * Settings names how many switches it has, and the two clients do not have the
 * same number. A heading that miscounts what is directly beneath it is the kind
 * of small wrongness that makes someone stop trusting the larger claims on the
 * same screen, so it is counted rather than copied.
 */
export function switchesHeading(count: number): string {
  const named = ["No switches", "One switch", "Two switches", "Three switches", "Four switches"];
  return `${named[count] ?? `${count} switches`} and a way out`;
}
