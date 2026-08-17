/**
 * What happens to what you write, in one place.
 *
 * These sentences exist here rather than in either client because they are the
 * only copy in the product where being wrong is not a typo. The mobile client
 * wrote its own once and told people their entries "stay on your account" while
 * the text was being sent to a language model — not a lie anyone intended, just
 * two screens maintained separately, one of which nobody revisited.
 *
 * Everything here has to stay true of the running system. If the pipeline
 * changes and one of these does not, the page becomes the most confidently
 * wrong thing in the app.
 */

export interface Disclosure {
  /** Short label for the setting or section that links to it. */
  title: string;
  body: string;
}

export const DISCLOSURE_HEADING = "What happens to your words";

/** The receipt shown on Talk, where a person needs to know exactly which side
 * of a conversation becomes part of the journal before they speak. */
export const TALK_DISCLOSURE = {
  heading: "What stays from this conversation",
  body:
    "The conversation transcript, including your turns and the agent's turns, is " +
    "kept on your account. Only your turns become journal entries; the agent's " +
    "turns never do. To provide Talk, conversation text is sent to the configured " +
    "model provider and voice audio is sent to the configured transcription " +
    "provider. Audio is transcribed and then discarded.",
} as const;

export const DISCLOSURES: Disclosure[] = [
  {
    title: "Where it is kept",
    body:
      "What you write is stored on your account and shown back to you. It is not " +
      "shared with other users or used for advertising. When you use extraction " +
      "or transcription, the required text or audio is sent to the configured " +
      "processing provider to provide that feature.",
  },
  {
    title: "What reads it",
    body:
      "To draw readings from an entry, its text is sent to a language model. The " +
      "readings come back with a confidence score and a link to the exact words " +
      "that produced them — which is why every claim in this app can be opened " +
      "and argued with.",
  },
  {
    title: "Audio",
    body:
      "A spoken entry is transcribed and the audio is then discarded. It is never " +
      "written to the database and never becomes part of your record — only the " +
      "transcript is kept.",
  },
  {
    title: "What runs unasked",
    body:
      "Background agents read your entries on a schedule to look for shape across " +
      "time. Nothing about that is hidden: every run is listed in Agent activity, " +
      "including the ones that looked and found nothing.",
  },
  {
    title: "What a reading is",
    body:
      "A reading is a quality — “rest”, “the water” — never a noun hung on you. " +
      "Nothing here gets to name you: the app shows what it has noticed and " +
      "leaves the rest visible but unclaimed.",
  },
  {
    title: "What it will not do",
    body:
      "Nothing is ever diagnosed, scored, or ranked against other people. The app " +
      "reports counts you can check, and stops.",
  },
];
