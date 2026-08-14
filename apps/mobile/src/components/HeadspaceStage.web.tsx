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
  // tear the scene down and rebuild it just to hand it a new callback. Assigned
  // in an effect rather than during render, which is not a place to be writing
  // to anything.
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  // What the stage is, not which array carried it — the screen rebuilds this
  // list on every render, and rebuilding the scene each time would restart the
  // arrival and drop the camera back to its opening position mid-look.
  //
  // Every field the stage is handed belongs here, `label` and `meta` included:
  // they are the whorl's name and the datum etched beside it, and leaving them
  // out meant a reading whose confidence had changed kept the old number under
  // it until something else happened to move a weight.
  const signature = whorls
    .map((w) => `${w.id}:${w.group}:${w.weight}:${w.bar}:${w.tentative}:${w.label}:${w.meta ?? ""}`)
    .join("|");

  useEffect(() => {
    // react-native-web renders a View as a div, so the ref is a DOM node here.
    // Typed as View by React Native's types, which do not know that.
    const node = host.current as unknown as HTMLElement | null;
    if (!node || whorls.length === 0) return;

    // What the pointer is over, which is all the stage's own callback reports.
    // It fires on hover, not on choosing: the desktop passes it straight to a
    // `focus` state and uses it to write the readout. Wiring it to selection
    // would open identity when someone merely swept the pointer across the
    // middle of the map.
    let under: Whorl | null = null;
    const mounted = mountHeadspace(node, whorls.map(toStageWhorl), (focused) => {
      under = focused ? (whorls.find((w) => w.id === focused.id) ?? null) : null;
    });

    // Choosing is a click, and it has to be handled here. The stage does have a
    // click of its own, but it navigates by assigning `location.hash`, which is
    // the desktop's HashRouter — this client's router uses real paths, so that
    // would write a fragment nothing reads.
    const onClick = () => {
      if (under) select.current(under);
    };
    node.addEventListener("click", onClick);

    stage.current = mounted;
    return () => {
      node.removeEventListener("click", onClick);
      mounted.dispose();
      stage.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // The stage measures its host, so the host has to have a size of its own.
  //
  // `alignSelf` is the load-bearing part. Observatory centres its stage slot
  // (`alignItems: "center"`), which sizes a child to its content across the
  // axis — and this child has no content, only a canvas the stage appends
  // later. Left to centre it measures zero wide, and the stage's ResizeObserver
  // gives up on a zero width rather than retrying, so the orb would never
  // appear at all. The survey escapes this by computing its own dimensions.
  return <View ref={host} style={{ flex: 1, alignSelf: "stretch", minHeight: 320 }} />;
}
