import React, { createContext, useContext } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { SegmentedControl } from "../../components/ModuleUi";
export type InboxArea = "clients" | "team" | "number";
export const inboxAreas = Object.freeze([
  { key: "clients", label: "Clientes" },
  { key: "team", label: "Equipo" },
  { key: "number", label: "Mi número" },
]);
export const areaFromParam = (value: unknown): InboxArea =>
  value === "team" || value === "number" ? value : "clients";
export const AreaHostContext = createContext<{
  hosted: boolean;
  area: InboxArea;
  active: boolean;
  report: (area: InboxArea, height: number) => void;
} | null>(null);
export function AreaHeader({ children }: React.PropsWithChildren) {
  const host = useContext(AreaHostContext);
  return (
    <View
      onLayout={(e) => {
        if (e.nativeEvent.layout.height > 0)
          host?.report(host.area, e.nativeEvent.layout.height);
      }}
    >
      {children}
    </View>
  );
}
export function AreaTabsSlot({ area }: { area: InboxArea }) {
  const host = useContext(AreaHostContext);
  return host?.hosted ? (
    <View style={{ height: 52 }} />
  ) : (
    <SegmentedControl
      fixedGeometry
      options={inboxAreas}
      value={area}
      onChange={(v) => router.setParams({ area: areaFromParam(v) })}
    />
  );
}
