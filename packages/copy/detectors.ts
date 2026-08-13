/**
 * What each detector is called, where a person can see it.
 *
 * The names are deliberately plain and deliberately not the internal keys: a
 * reader meeting "same-day-order" learns nothing, and a reader meeting
 * "ordering, within a day" learns exactly what the machine looked for. Naming
 * the detector beside its finding is what lets someone weigh the claim — a
 * recurrence and a stated-versus-recorded discrepancy are different kinds of
 * assertion and should not read as one.
 *
 * Shared because the two clients must call the same machine the same thing.
 * The web had this list and the mobile client had none, so one client named
 * its detectors and the other did not name them at all.
 */
/** The five detectors, named as the schema names them. */
export type Detector =
  | "exact-label"
  | "weekday"
  | "lag"
  | "same-day-order"
  | "stated-vs-recorded";

export const DETECTOR_LABEL: Record<Detector, string> = {
  "exact-label": "recurrence",
  weekday: "calendar shape",
  lag: "ordering",
  "same-day-order": "ordering, within a day",
  "stated-vs-recorded": "stated vs recorded",
};
