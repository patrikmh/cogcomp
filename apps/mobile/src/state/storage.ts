import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Token storage, per platform.
 *
 * **Native** uses the OS keychain (Keychain on iOS, Keystore on Android). A bearer
 * token grants full access to someone's journal, so it belongs behind the
 * hardware-backed store rather than in plain app storage a device backup would
 * carry off.
 *
 * **Web** falls back to `localStorage`, because `expo-secure-store` has no web
 * implementation and would throw. This is a genuinely weaker guarantee — anything
 * that achieves XSS on the page can read `localStorage`, and there is no browser
 * equivalent of the keychain. Web exists here so the app can be driven by an
 * end-to-end browser test; it is not a shipping surface. If web ever becomes one,
 * this needs revisiting — most likely an httpOnly cookie set by the server, which
 * script on the page cannot read.
 */
const isWeb = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
