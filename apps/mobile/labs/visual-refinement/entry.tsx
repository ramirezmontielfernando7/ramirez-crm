import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import InboxScreen from "../../src/features/inbox/InboxScreen";
import { TabBar } from "../../src/components/TabBar";
import { CrmView } from "../../src/features/crm/CrmView";
import { CrmModel } from "../../src/features/crm/core";
import { InboxStore } from "../../src/features/inbox/store-core";
import { configure, labState, type Variant } from "./profiles";
export const fixtureSession = {
  id: "demo-owner",
  name: "Fer Ramírez",
  role: "owner" as const,
  expiresAt: Date.now() + 86400000,
  source: "demo" as const,
};
export let store = new InboxStore(fixtureSession);
declare global {
  interface Window {
    renderLab: (v: Variant, t: "light" | "dark", screen?: string) => void;
    labLayers: {
      open: (x: unknown) => void;
      close: () => void;
      toast: (x: string) => void;
    };
    labEvents: unknown[];
  }
}
let rerender: (value: number) => void;
window.labEvents = [];
window.labLayers = {
  open: (x) => window.labEvents.push(x),
  close: () => {},
  toast: (x) => window.labEvents.push(x),
};
window.renderLab = (v, t, screen = "inbox") => {
  configure(v, t);
  store = new InboxStore(fixtureSession);
  currentScreen = screen;
  rerender(Date.now() + Math.random());
};
let currentScreen = "inbox";
function App() {
  const [epoch, setEpoch] = useState(0);
  rerender = setEpoch;
  const dark = labState().theme === "dark";
  const crm = new CrmModel(fixtureSession, store.repository);
  if (currentScreen === "contacts") crm.patch({ screen: "CRM-10" });
  const routes = ["inbox", "crm", "studio", "marketing", "more"].map(
    (name) => ({ key: name, name }),
  );
  return (
    <View
      key={epoch}
      style={{
        flex: 1,
        height: "100%",
        backgroundColor: dark ? "#1c263c" : "#fff",
      }}
    >
      {currentScreen === "inbox" ? (
        <InboxScreen />
      ) : (
        <CrmView
          model={crm}
          onLayer={() => {}}
          onChat={() => {}}
          onTask={() => {}}
          onHistory={() => {}}
        />
      )}
      <TabBar
        state={{ index: currentScreen === "inbox" ? 0 : 1, routes } as never}
        descriptors={{} as never}
        insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        emitter={{ emit: () => ({ defaultPrevented: false }) } as never}
        navigateToTab={() => {}}
      />
    </View>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
