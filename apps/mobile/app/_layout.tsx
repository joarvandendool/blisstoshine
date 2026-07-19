// Root-layout: sessieprovider, splash-beheer, pushtaps → deep links en de
// stack. Navigatie is platformconform iOS (native stack, gestures, safe
// areas via react-native-screens/safe-area-context).

import React, { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSessie } from "@/lib/session";
import { volgNotificatieTaps, volgTokenRotatie } from "@/lib/push";
import { kleur } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync().catch(() => {});

function Binnenkant() {
  const { status } = useSessie();
  const router = useRouter();

  // Splash blijft staan tot het sessieherstel klaar is.
  useEffect(() => {
    if (status !== "laden") void SplashScreen.hideAsync().catch(() => {});
  }, [status]);

  // Pushtaps en tokenrotatie volgen zolang de app leeft.
  useEffect(() => {
    const stopTaps = volgNotificatieTaps((pad) => {
      router.push(pad as never);
    });
    const stopRotatie = volgTokenRotatie();
    return () => {
      stopTaps();
      stopRotatie();
    };
  }, [router]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: kleur.oppervlak },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Binnenkant />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
