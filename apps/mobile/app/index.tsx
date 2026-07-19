// Startpunt: routeert op sessieherstel. laden → (splash zichtbaar);
// uitgelogd → openbare vacaturezoeker; onboarding → onboardingflow;
// actief → de app-tabs.

import React from "react";
import { Redirect } from "expo-router";
import { useSessie } from "@/lib/session";
import { LaadStaat, Scherm } from "@/components/ui";

export default function Start() {
  const { status } = useSessie();

  if (status === "laden") {
    return (
      <Scherm scroll={false}>
        <LaadStaat label="Je sessie wordt hersteld…" />
      </Scherm>
    );
  }
  if (status === "actief") return <Redirect href="/(app)/(tabs)" />;
  if (status === "onboarding") return <Redirect href="/onboarding" />;
  return <Redirect href="/(public)" />;
}
