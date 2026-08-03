import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

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

  if (!ready) {
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
        <Stack.Screen name="today" options={{ title: "Today" }} />
        <Stack.Screen name="week" options={{ title: "This week" }} />
        <Stack.Screen name="talk" options={{ title: "Talk it through" }} />
        <Stack.Screen name="graph" options={{ title: "Graph" }} />
        <Stack.Screen name="identity" options={{ title: "Identity" }} />
        <Stack.Screen name="patterns" options={{ title: "Patterns" }} />
        <Stack.Screen name="experiments" options={{ title: "Experiments" }} />
        <Stack.Screen name="experiment/[id]" options={{ title: "Experiment" }} />
        <Stack.Screen name="agents" options={{ title: "Agent activity" }} />
        <Stack.Screen name="explore" options={{ title: "Explore" }} />
        <Stack.Screen name="node/[id]" options={{ title: "Where this came from" }} />
      </Stack>
    </>
  );
}
