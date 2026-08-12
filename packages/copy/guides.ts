/**
 * What each screen is doing, in one sentence, behind a "?".
 *
 * The design puts this affordance beside the heading of every screen that
 * makes a claim — the map, a pattern, a region, a reading, the graph — and the
 * sentences do a particular job: they say what the screen shows *and* what it
 * does not mean. "A pattern is not a diagnosis or a cause." "Positions are not
 * meaning." A product that draws conclusions about someone has to be able to
 * say where its conclusions stop, and this is where it says it.
 *
 * Shared so both clients answer "what is this screen" identically. Two
 * separately maintained sets of explanations is how a client ends up explaining
 * a screen it no longer has.
 *
 * The copy is the design's, verbatim, except where the design describes
 * something this app does differently — see `login`.
 */
export interface GuideEntry {
  title: string;
  body?: string;
  /** Headspace says something different per lens, because the lens is what the
   *  screen is showing. */
  bodies?: Record<string, string>;
}

export const GUIDES: Record<string, GuideEntry> = {
  headspace: {
    title: "Headspace",
    bodies: {
      Today: "Shows notes from today. Select a contour to inspect its readout.",
      Everything: "Shows the current set of contours. Select a whorl to open its evidence.",
      Recurring: "Shows patterns that returned across weeks.",
      Changed: "Compares what changed across the available record.",
    },
  },
  today: {
    title: "Today",
    body: "A factual record of the selected day: your acts, their readings, and what is still circling.",
  },
  search: {
    title: "Find an entry",
    body: "Searches only the words you wrote, newest first. Readings are not searched.",
  },
  pattern: {
    title: "Pattern",
    body: "Shows a recurring shape in your record and the evidence behind it. A pattern is not a diagnosis or a cause.",
  },
  theme: {
    title: "Graph region",
    body: "Groups associations in your words. It is structure, not a diagnosis; you decide whether it holds.",
  },
  identity: {
    title: "Identity",
    body: "A composition of readings held by your record. Confident and tentative readings remain distinct.",
  },
  node: {
    title: "Inferred reading",
    body: "This reading was drawn from cited entries. Its confidence and evidence remain visible for you to assess.",
  },
  agents: {
    title: "Agent activity",
    body: "Lists background attempts and counts only. Your words are not shown here.",
  },
  graph: {
    title: "Graph",
    body: "Shows nodes and relationships in the record. Positions are not meaning.",
  },
  explore: {
    title: "Explore",
    body: "The graph uses stable seeded positions for browsing. Edges carry the relationships.",
  },
  login: {
    title: "Login",
    // The design says eight characters. This app requires twelve, and a guide
    // that states the wrong rule sends someone to a form that rejects them.
    body: "Your journal is private. Use an email and a password with at least twelve characters.",
  },
  first: {
    title: "First fortnight",
    body: "Early findings need enough days to form. Nothing is owed; each status shows what the detector is waiting for.",
  },
};

export type GuideKey = keyof typeof GUIDES;

/** The sentence for a screen, and for Headspace the sentence for its lens. */
export function guideBody(key: string, lens = "Everything"): string {
  const entry = GUIDES[key];
  if (!entry) return "";
  return entry.bodies ? (entry.bodies[lens] ?? entry.bodies.Everything ?? "") : (entry.body ?? "");
}
