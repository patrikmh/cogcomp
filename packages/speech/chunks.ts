/**
 * Cutting a reply into the pieces it gets spoken in.
 *
 * Synthesis is charged per request in latency, not just in money: a whole reply
 * takes two to three seconds to come back, and every one of them is silence
 * after the text is already on screen. The first sentence on its own comes back
 * in well under one. So the reply is spoken in pieces — the first piece starts
 * while the rest is still being made — and the gap a person actually hears is
 * the time to synthesise one sentence rather than all of them.
 *
 * The seams are real. A voice re-starts at each piece, so pitch and pace reset
 * where the pieces meet. That is why the pieces are cut at sentence ends and
 * nowhere else: a reset at a full stop is a breath, and a reset mid-clause is a
 * stutter. It is also why there are few of them — the cost is per seam, and the
 * benefit is almost entirely in the first cut.
 */

/** Below this a sentence is too short to be worth a seam of its own — "Mm." at
 *  the head of a reply would buy nothing and cost a hitch — so it joins the one
 *  after it. */
const MIN_HEAD = 24;

/** Roughly how much goes in each piece after the first. Long enough that a reply
 *  is two or three requests rather than eight, short enough that the second
 *  piece is ready before the first has finished playing. */
const CHUNK = 240;

/** More pieces than this is more seams than the latency they save is worth, and
 *  more parallel synthesis than a reply should ever ask of the account. */
const MAX_CHUNKS = 4;

/** End of sentence, keeping the punctuation with the sentence it ends. Includes
 *  the ellipsis because this agent uses it and it is a full stop when it does. */
const SENTENCE_END = /(?<=[.!?…])\s+/;

/**
 * The reply, in the order it should be spoken.
 *
 * Always at least one piece for any non-empty text, and the pieces always
 * rejoin — with single spaces — to the text that came in. Never empty strings.
 */
export function speechChunks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentences = trimmed.split(SENTENCE_END).filter((s) => s.trim().length > 0);
  if (sentences.length <= 1) return [trimmed];

  // The head is its own piece, because the whole point is to start sounding
  // early — unless it is too short to carry a seam, in which case it takes the
  // next sentence with it.
  const chunks: string[] = [];
  const [first = trimmed, ...tail] = sentences;
  let head = first;
  let rest = tail;
  while (head.length < MIN_HEAD && rest.length > 0) {
    const [next = "", ...remaining] = rest;
    head = `${head} ${next}`;
    rest = remaining;
  }
  chunks.push(head);

  let current = "";
  for (const sentence of rest) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length + sentence.length + 1 > CHUNK) {
      chunks.push(current);
      current = sentence;
      continue;
    }
    current = `${current} ${sentence}`;
  }
  if (current) chunks.push(current);

  if (chunks.length <= MAX_CHUNKS) return chunks;
  // Everything past the cap becomes one last piece. The saving is in the early
  // cuts; the tail can be one long request because nobody is waiting on it.
  const kept = chunks.slice(0, MAX_CHUNKS - 1);
  kept.push(chunks.slice(MAX_CHUNKS - 1).join(" "));
  return kept;
}
