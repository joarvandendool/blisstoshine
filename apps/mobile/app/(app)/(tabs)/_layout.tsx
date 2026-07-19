// Tabbalk — platformconform iOS met tekstuele labels en symbolen.

import React from "react";
import { Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { inkt, kleur } from "@/theme/tokens";

function TabIcoon({
  symbool,
  kleurWaarde,
}: {
  symbool: string;
  kleurWaarde: ColorValue;
}) {
  return <Text style={{ fontSize: 20, color: kleurWaarde }}>{symbool}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: kleur.blauw600,
        tabBarInactiveTintColor: inkt(0.45),
        tabBarStyle: { backgroundColor: "rgba(255,255,255,0.94)" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Matches",
          tabBarIcon: ({ color }) => <TabIcoon symbool="◎" kleurWaarde={color} />,
        }}
      />
      <Tabs.Screen
        name="zoeken"
        options={{
          title: "Zoeken",
          tabBarIcon: ({ color }) => <TabIcoon symbool="⌕" kleurWaarde={color} />,
        }}
      />
      <Tabs.Screen
        name="uitnodigingen"
        options={{
          title: "Uitnodigingen",
          tabBarIcon: ({ color }) => <TabIcoon symbool="✉" kleurWaarde={color} />,
        }}
      />
      <Tabs.Screen
        name="profiel"
        options={{
          title: "Profiel",
          tabBarIcon: ({ color }) => <TabIcoon symbool="●" kleurWaarde={color} />,
        }}
      />
    </Tabs>
  );
}
