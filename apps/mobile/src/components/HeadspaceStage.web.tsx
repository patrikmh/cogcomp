import { mountHeadspace, type Stage, type Whorl as StageWhorl } from "@tlon/headspace";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import type { Whorl } from "@/components/HeadspaceMap";

/**
 * The headspace, on the web export — the design's orb, not a stand-in.
 *
 * The web half of a pair; `HeadspaceStage.tsx` is the native one. Metro picks
 * between them by extension, which is what keeps three.js out of the phone
 * bundle: an import that only ever appears in a `.web` file is never reached
 * when building for iOS or Android.
 *
 * The stage itself is `@tlon/headspace`, the same module the desktop client
 * mounts, so the two draw the same map from the same geometry rather than two
 * implementations that agree for as long as someone keeps them agreeing.
 */

/** The stage wants a richer whorl than the survey does. The extra fields are
 *  what the readout says about a thing, and they are composed here rather than
 *  pushed back into `whorlsFor` so the native path is not made to carry a shape
 *  only the web reads. */
const TINT: Record<Whorl["group"], number> = {
  pattern: 0xe6b95c,
  reading: 0xa7c3c8,
  today: 0xc6e070,
  you: 0xeef1ec,
};
/** A less-sure reading is sand rather than the kept blue, as on the desktop. */
const TENTATIVE_TINT = 0xd8c79a;

function kickerFor(whorl: Whorl): string {
  if (whorl.group === "you") return "You · the point of view";
  if (whorl.group === "today") return "Today · drawn since midnight";
  if (whorl.group === "pattern") return "Pattern · what keeps returning";
  return whorl.tentative ? "Reading · less sure" : "Reading · kept";
}

function toStageWhorl(whorl: Whorl): StageWhorl {
  return {
    id: whorl.id,
    label: whorl.label,
    meta: whorl.meta ?? "",
    weight: whorl.weight,
    tentative: whorl.tentative,
    tint: whorl.tentative && whorl.group === "reading" ? TENTATIVE_TINT : TINT[whorl.group],
    group: whorl.group,
    kicker: kickerFor(whorl),
    readout: whorl.meta ?? whorl.label,
    bar: whorl.bar,
  };
}

export function HeadspaceStage({
  whorls,
  onSelect,
}: {
  whorls: Whorl[];
  onSelect: (whorl: Whorl) => void;
}) {
  const host = useRef<View>(null);
  const stage = useRef<Stage | null>(null);
  // Read inside the effect rather than closed over, so a selection does not
  // tear the scene down and rebuild it just to hand it a new callback.
  const select = useRef(onSelect);
  select.current = onSelect;

  // What the stage is, not which array carried it — the screen rebuilds this
  // list on every render, and rebuilding the scene each time would restart the
  // arrival and drop the camera back to its opening position mid-look.
  const signature = whorls
    .map((w) => `${w.id}:${w.group}:${w.weight}:${w.bar}:${w.tentative}`)
    .join("|");

  useEffect(() => {
    // react-native-web renders a View as a div, so the ref is a DOM node here.
    // Typed as View by React Native's types, which do not know that.
    const node = host.current as unknown as HTMLElement | null;
    if (!node || whorls.length === 0) return;

    const mounted = mountHeadspace(node, whorls.map(toStageWhorl), (focused) => {
      if (!focused) return;
      const original = whorls.find((w) => w.id === focused.id);
      if (original) select.current(original);
    });
    stage.current = mounted;
    return () => {
      mounted.dispose();
      stage.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // The stage sizes itself from the host, so the host has to have a size before
  // it mounts — a flex child with no explicit height measures zero here.
  return <View ref={host} style={{ flex: 1, minHeight: 320 }} />;
}
