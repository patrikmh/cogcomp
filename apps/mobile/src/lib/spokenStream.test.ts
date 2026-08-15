import { SpokenStream } from "@tlon/speech/stream";

/** Feed a reply one character at a time — the worst case a tokeniser can hand
 *  us, and the one where an off-by-one in the buffering shows up. */
function drip(text: string): string[] {
  const stream = new SpokenStream();
  const out: string[] = [];
  for (const char of text) out.push(...stream.push(char));
  out.push(...stream.end());
  return out;
}

/** Feed it in whatever lumps the caller names, as a real stream would. */
function feed(deltas: string[]): string[] {
  const stream = new SpokenStream();
  const out: string[] = [];
  for (const delta of deltas) out.push(...stream.push(delta));
  out.push(...stream.end());
  return out;
}

const REPLY =
  "That sounds like it has been sitting with you for a while. What does it feel like when you notice it coming back? Take your time.";

describe("cutting a reply while it is still arriving", () => {
  it("says nothing about an empty reply", () => {
    expect(feed([])).toEqual([]);
    expect(feed(["  "])).toEqual([]);
  });

  it("gives up the first sentence before the rest has arrived", () => {
    const stream = new SpokenStream();
    expect(stream.push("That sounds like it has been sitting with you for a while.")).toEqual([]);
    // The boundary is the whitespace after the stop, so the first sentence is
    // only known to be complete once the next one starts.
    expect(stream.push(" What")).toEqual([
      "That sounds like it has been sitting with you for a while.",
    ]);
  });

  it("loses nothing, however the deltas fall", () => {
    expect(drip(REPLY).join(" ")).toBe(REPLY);
    expect(feed([REPLY]).join(" ")).toBe(REPLY);
    expect(feed(["That sounds", " like it has been sitting with you for a while. What", " next?"]).join(" ")).toBe(
      "That sounds like it has been sitting with you for a while. What next?",
    );
  });

  it("cuts a dripped reply exactly where a whole one is cut", () => {
    // The streaming path and the arrived-whole path must not disagree about
    // where this agent breathes.
    expect(drip(REPLY)[0]).toBe("That sounds like it has been sitting with you for a while.");
  });

  it("will not hand over an opener too short to carry the seam", () => {
    const out = drip("I see. That sounds heavy. What happened next?");
    expect(out[0]).toBe("I see. That sounds heavy.");
  });

  it("holds a sentence that has not ended yet", () => {
    const stream = new SpokenStream();
    expect(stream.push("That sounds like it has been sitting with you")).toEqual([]);
  });

  it("gives up the tail even when the model never punctuated it", () => {
    const stream = new SpokenStream();
    stream.push("That sounds like it has been there a long while. and then it just");
    expect(stream.end().join(" ")).toContain("and then it just");
  });

  it("groups later sentences rather than one request per sentence", () => {
    const long = `${"A".repeat(30)}. ${Array.from({ length: 12 }, (_, i) => `Sentence number ${i} runs on a little.`).join(" ")}`;
    const pieces = drip(long);
    // The opener is its own piece; the rest are grouped, not one apiece.
    expect(pieces.length).toBeLessThan(6);
    expect(pieces.join(" ")).toBe(long);
  });

  it("treats an ellipsis as the full stop this agent uses it as", () => {
    const out = drip("That is a lot to hold at once… Where does it sit in your body?");
    expect(out[0]).toBe("That is a lot to hold at once…");
  });
});
