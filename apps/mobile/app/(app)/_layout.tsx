// Guard voor het ingelogde deel: zonder sessie terug naar openbaar zoeken;
// met draft-profiel naar onboarding.

import React from "react";
import { Redirect, Stack } from "expo-router";
import { useSessie } from "@/lib/session";
import { kleur } from "@/theme/tokens";

export default function AppLayout() {
  const { status } = useSessie();
  if (status === "laden") return null;
  if (status === "uitgelogd") return <Redirect href="/(public)" />;
  if (status === "onboarding") return <Redirect href="/onboarding" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: kleur.oppervlak },
      }}
    />
  );
}
