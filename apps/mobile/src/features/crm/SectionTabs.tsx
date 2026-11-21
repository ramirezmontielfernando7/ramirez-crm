import React from "react";
import { View } from "react-native";
import { SegmentedControl } from "../../components/ui";
export type CrmSection = "pipeline" | "contacts" | "library";
export function SectionTabs({
  value,
  onChange,
}: {
  value: CrmSection;
  onChange: (s: CrmSection) => void;
}) {
  return (
    <View style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 4 }}>
      <SegmentedControl
        refinement="crm"
        options={[
          { key: "pipeline", label: "Pipeline" },
          { key: "contacts", label: "Contactos" },
          { key: "library", label: "Biblioteca" },
        ]}
        value={value}
        onChange={(s) => onChange(s as CrmSection)}
      />
    </View>
  );
}
