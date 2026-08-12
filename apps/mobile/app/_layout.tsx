// One weight per import, not the package barrel. The barrel's index requires
// every weight and every italic, and Metro bundles what is required — importing
// five faces that way shipped fourteen megabytes of TTF for the five we use.
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { IBMPlexSans_700Bold } from "@expo-google-fonts/ibm-plex-sans/700Bold";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SpatialDock } from "@/components/SpatialField";
import { createUserQueryClient } from "@/state/queryClient";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/** Sends signed-out users to /login and signed-in users away from it. */
function useAuthGate() {
  const { token, ready, restore } = useSession();
  const restorePreferences = usePreferences((s) => s.restore);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void restore();
    // Alongside the session, so the first render of any screen that reads a
    // preference sees the stored value rather than the default.
    void restorePreferences();
  }, [restore, restorePreferences]);

  useEffect(() => {
    // Wait for the keychain read, or we would redirect someone who is in fact
    // still signed in.
    if (!ready) return;
    const onLoginScreen = segments[0] === "login";
    if (!token && !onLoginScreen) {
      router.replace("/login");
    } else if (token && onLoginScreen) {
      router.replace("/");
    }
  }, [token, ready, segments, router]);

  return ready;
}

export default function RootLayout() {
  const userId = useSession((s) => s.userId);
  const signOut = useSession((s) => s.signOut);
  // A QueryClient is private to one principal. Replacing it during an account
  // switch prevents tenant-independent keys in existing screens from exposing
  // the previous user's cache while those screens are being rendered.
  //
  // It is also where an expired session is caught: any 401 clears the session,
  // which drops the token, which sends the Gate to /login. Without this a token
  // the server has forgotten leaves you inside the app with every screen showing
  // its own unrelated error.
  const queryClient = useMemo(
    () => createUserQueryClient(userId, () => void signOut()),
    [userId, signOut],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <Gate />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const ready = useAuthGate();
  const segments = useSegments();
  // Not on the login screen: there is nowhere to go from there but in.
  const showDock = segments[0] !== "login";
  // /dev is offered by Settings too; the bar carries it when the switch is on
  // so a developer is not made to go through Settings every time.
  const developer = usePreferences((s) => s.developer);

  // The product's voice, rather than whatever the device defaults to. Held
  // alongside the session read that was already here: a first paint in San
  // Francisco that reflows into IBM Plex a moment later is worse than a spinner
  // for the same moment, because the reflow moves text somebody has started
  // reading.
  const [fontsLoaded] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });

  if (!ready || !fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.room }}>
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.room },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: "700", color: colors.ink },
          contentStyle: { backgroundColor: colors.room },
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ title: "Journal" }} />
        <Stack.Screen name="headspace" options={{ title: "Headspace" }} />
        <Stack.Screen name="today" options={{ title: "Today" }} />
        <Stack.Screen name="week" options={{ title: "This week" }} />
        <Stack.Screen name="talk" options={{ title: "Talk it through" }} />
        <Stack.Screen name="graph" options={{ title: "Graph" }} />
        <Stack.Screen name="identity" options={{ title: "Identity" }} />
        <Stack.Screen name="patterns" options={{ title: "Patterns" }} />
        <Stack.Screen name="pattern/[id]" options={{ title: "What came first" }} />
        <Stack.Screen name="theme/[id]" options={{ title: "A region" }} />
        <Stack.Screen name="experiments" options={{ title: "Experiments" }} />
        <Stack.Screen name="experiment/[id]" options={{ title: "Experiment" }} />
        <Stack.Screen name="agents" options={{ title: "Agent activity" }} />
        <Stack.Screen name="explore" options={{ title: "Explore" }} />
        <Stack.Screen name="node/[id]" options={{ title: "Where this came from" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        {/* Registered like any other screen. The developer switch decides
            whether it can be reached, not whether it has a name — an
            unregistered route falls back to its filename, which reads as a bug
            rather than as a deliberately quiet corner. */}
        <Stack.Screen name="dev" options={{ title: "Developer" }} />
      </Stack>
      {/* Below the Stack rather than inside a screen, so it is one bar that
          every route shares instead of a component eighteen screens each have
          to remember to render — which is how five of them ended up being
          destinations you could arrive at and not leave. */}
      {showDock && <SpatialDock developer={developer} />}
    </>
  );
}
