import { CHUNK, MIN_HEAD, SENTENCE_END } from "./chunks";

/**
 * Cutting a reply for speech while it is still being written.
 *
 * `speechChunks` cuts a reply that has arrived. This cuts one that is arriving,
 * which is the whole of the difference between the two waits being consecutive
 * and being the same wait. A sentence is finished long before a reply is, and a
 * finished sentence is everything synthesis needs — so the first one goes for
 * synthesis while the model is still writing the second, and the voice starts
 * while the reply is still being thought.
 *
 * The rules it cuts by are the ones `speechChunks` cuts by, from the same
 * constants: sentence ends and nowhere else, nothing so short it buys a seam and
 * no sound, and pieces grouped after the first so a long reply is a few requests
 * rather than one per sentence. What it cannot do is look ahead — it never knows
 * whether more is coming — so it holds anything it cannot yet decide about and
 * lets `end` deal with whatever is left.
 */
export class SpokenStream {
  /** Text arrived but not yet given out to be spoken. */
  private held = "";
  /** Whether the opening piece has gone. Until it has, the aim is speed: the
   *  first complete sentence leaves as soon as it is long enough to be worth
   *  speaking. After it, the aim is fewer seams, so pieces are grouped. */
  private opened = false;

  /**
   * Take a piece of the reply as it arrives.
   *
   * Returns whatever is now ready to be spoken, which is usually nothing: most
   * deltas land mid-sentence and only lengthen what is being held.
   */
  push(delta: string): string[] {
    this.held += delta;
    const ready: string[] = [];

    for (;;) {
      const piece = this.take();
      if (piece === null) break;
      ready.push(piece);
    }
    return ready;
  }

  /**
   * The rest of it, once nothing more is coming.
   *
   * Whatever is held goes out regardless of length here — a reply ending in a
   * half-clause the model never punctuated is still the end of the reply, and
   * holding it back would simply lose it.
   */
  end(): string[] {
    const ready = this.push("");
    const rest = this.held.trim();
    this.held = "";
    if (rest) ready.push(rest);
    return ready;
  }

  /** One piece if one is ready, or null. */
  private take(): string | null {
    // Only text followed by a sentence end is complete. Splitting the held text
    // and dropping the last part is what enforces that: the last part has no
    // boundary after it, so more of it may still be coming.
    const parts = this.held.split(SENTENCE_END);
    if (parts.length < 2) return null;

    const complete = parts.slice(0, -1);
    const trailing = parts[parts.length - 1] ?? "";

    if (!this.opened) {
      // The opening piece: as few sentences as will carry a seam.
      let taken = 0;
      let piece = "";
      for (const sentence of complete) {
        piece = piece ? `${piece} ${sentence}` : sentence;
        taken += 1;
        if (piece.length >= MIN_HEAD) break;
      }
      if (piece.length < MIN_HEAD) return null; // wait for more to join it

      this.opened = true;
      this.held = [...complete.slice(taken), trailing].join(" ").trimStart();
      return piece;
    }

    // After the opening, sentences are grouped until there is enough to be
    // worth a request of its own. Anything short of that waits — `end` will
    // take it if the reply stops first.
    let piece = "";
    let taken = 0;
    for (const sentence of complete) {
      piece = piece ? `${piece} ${sentence}` : sentence;
      taken += 1;
      if (piece.length >= CHUNK) break;
    }
    if (piece.length < CHUNK) return null;

    this.held = [...complete.slice(taken), trailing].join(" ").trimStart();
    return piece;
  }
}
