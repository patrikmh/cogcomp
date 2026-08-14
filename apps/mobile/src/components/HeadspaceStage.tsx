import { HeadspaceMap, type Whorl } from "@/components/HeadspaceMap";

/**
 * The headspace, on a phone.
 *
 * This is the native half of a pair. Metro picks `HeadspaceStage.web.tsx` for
 * the web export, where the orb the design draws — three.js, a real camera, a
 * contour massif — can actually run, and this file everywhere else. The split
 * is by file extension rather than a `Platform.OS` branch on purpose: a branch
 * would still pull three.js into the bundle it never runs in, and that bundle
 * already carries 7.3 MB of canvaskit.
 *
 * The survey stands in for the orb here. It is drawn from the same whorls and
 * says the same things about them; what it cannot do is turn.
 */
export function HeadspaceStage({
  whorls,
  onSelect,
}: {
  whorls: Whorl[];
  onSelect: (whorl: Whorl) => void;
}) {
  return <HeadspaceMap whorls={whorls} onSelect={onSelect} />;
}
