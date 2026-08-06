/** Confidence as a length, with the 0.5 threshold marked.
 *  Below it a reading is drawn as tentative, on every surface. */
export function Meter({ confidence }: { confidence: number }) {
  return (
    <span className="meter">
      <i
        className={confidence < 0.5 ? "tent" : ""}
        style={{ width: `${Math.round(confidence * 100)}%` }}
      />
      <u />
    </span>
  );
}
