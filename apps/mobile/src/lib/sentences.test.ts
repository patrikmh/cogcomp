import { speechChunks } from "@tlon/speech";

describe("cutting a reply for speech", () => {
  it("has nothing to say about nothing", () => {
    expect(speechChunks("")).toEqual([]);
    expect(speechChunks("   ")).toEqual([]);
  });

  it("leaves a single sentence whole", () => {
    expect(speechChunks("That sounds like it has been sitting with you.")).toEqual([
      "That sounds like it has been sitting with you.",
    ]);
  });

  it("gives the first sentence its own piece, so it can start early", () => {
    const chunks = speechChunks(
      "That sounds like it has been sitting with you for a while. What does it feel like when you notice it coming back?",
    );
    expect(chunks[0]).toBe("That sounds like it has been sitting with you for a while.");
    expect(chunks).toHaveLength(2);
  });

  it("will not cut after an opener too short to carry the seam", () => {
    const chunks = speechChunks("I see. That sounds heavy. What happened next?");
    expect(chunks[0]).toBe("I see. That sounds heavy.");
  });

  it("keeps the punctuation with the sentence it ends", () => {
    const chunks = speechChunks(
      "Does that sound right to you, or have I got it backwards? Tell me more.",
    );
    expect(chunks[0]).toBe("Does that sound right to you, or have I got it backwards?");
  });

  it("treats an ellipsis as the full stop this agent uses it as", () => {
    const chunks = speechChunks("That is a lot to hold at once… Where does it sit in your body?");
    expect(chunks[0]).toBe("That is a lot to hold at once…");
  });

  it("never cuts a reply into more pieces than the seams are worth", () => {
    const long = Array.from(
      { length: 40 },
      (_, i) => `This is sentence number ${i} and it runs on for a little while.`,
    ).join(" ");
    expect(speechChunks(long).length).toBeLessThanOrEqual(4);
  });

  it("loses none of the reply, whatever it does with it", () => {
    const text =
      "I hear you. That sounds like it has been sitting there a long time. What does it feel like when it comes back? Take your time.";
    expect(speechChunks(text).join(" ")).toBe(text);
  });
});
