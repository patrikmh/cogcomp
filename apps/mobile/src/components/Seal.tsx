import { Suspense } from "react";
import { View } from "react-native";

import { lazySkia } from "@/lib/lazySkia";

/**
 * Every act is stamped with its own seal.
 *
 * A contour whorl seeded by the entry's id, from the same geometry in
 * `packages/design/marks.ts` that the web client draws — the same id makes the
 * same mark in both, which is what lets you recognise an entry before reading a
 * word of it.
 *
 * The Skia canvas is behind `lazySkia` and this wrapper exists so no caller has
 * to know that. On web, CanvasKit must load before any module touching `Skia`
 * is evaluated; getting that wrong fails at the first render rather than at the
 * import, which makes it look like a bug in the seal instead of in the loading.
 * The lazy component is built once at module scope for the reason `lazySkia`
 * documents: rebuilding it per render remounts the canvas on every keystroke.
 */
const LazySealCanvas = lazySkia(() => import("@/components/SealCanvas"));

export function Seal({ id, size = 34, tone }: { id: string; size?: number; tone?: string }) {
  return (
    <Suspense fallback={<View style={{ width: size, height: size }} />}>
      <LazySealCanvas id={id} size={size} tone={tone} />
    </Suspense>
  );
}
