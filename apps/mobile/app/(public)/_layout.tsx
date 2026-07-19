import React from "react";
import { Stack } from "expo-router";
import { kleur } from "@/theme/tokens";

export default function PubliekLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: kleur.oppervlak },
      }}
    />
  );
}
