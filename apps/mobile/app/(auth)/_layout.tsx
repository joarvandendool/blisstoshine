import React from "react";
import { Stack } from "expo-router";
import { kleur } from "@/theme/tokens";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: "Terug",
        headerTintColor: kleur.blauw600,
        contentStyle: { backgroundColor: kleur.oppervlak },
      }}
    />
  );
}
