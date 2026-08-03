import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import { Platform } from "react-native";

/**
 * Lazily load a component that renders Skia.
 *
 * Two things this exists to get right, both of which cost hours the first time:
 *
 * 1. On web, CanvasKit's WASM must finish loading before any Skia component is
 *    even *evaluated*, so the import is awaited behind `LoadSkiaWeb` rather than
 *    sitting at the top of the file.
 *
 * 2. The returned component must be created **once, at module scope**. A lazy
 *    component's identity has to be stable; building one inside a render — which
 *    Skia's own `WithSkiaWeb` and its `getComponent` prop quietly encourage —
 *    remounts the canvas on every state change. The symptom is baffling: taps
 *    appear to do nothing, because selecting something destroys the canvas you
 *    selected it on and the screen falls back to its Suspense fallback forever.
 *
 * Call this at module scope. Calling it inside a component reintroduces (2).
 */
export function lazySkia<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    if (Platform.OS === "web") {
      const { LoadSkiaWeb } = await import(
        "@shopify/react-native-skia/lib/module/web"
      );
      await LoadSkiaWeb({
        locateFile: () => "/canvaskit.wasm",
      });
    }
    return load();
  });
}
