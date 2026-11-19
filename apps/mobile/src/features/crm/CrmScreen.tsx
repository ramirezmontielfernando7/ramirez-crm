import React, { useEffect } from "react";
import { BackHandler, View } from "react-native";
import { router } from "expo-router";
import { Screen } from "../../components/Screen";
import { EmptyState } from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useInbox } from "../inbox/store";
import { useContactDirectory } from "../contact/context";
import { TaskSheet } from "../contact/Sheets";
import { CrmModel, type CrmId } from "./core";
import { CrmView, type CrmNavigation } from "./CrmView";
import { CrmOverlay, layerTitles } from "./CrmOverlay";
import { useSession } from "../../state/SessionProvider";
import { canAccess } from "../../domain/access";
const models = new WeakMap<object, CrmModel>();
export function CrmScreen() {
  const inbox = useInbox(),
    directory = useContactDirectory(),
    layers = useLayers(),
    { session, disabled } = useSession();
  let model = models.get(inbox);
  if (!model) {
    model = new CrmModel(inbox.actor, inbox.repository, inbox.reload);
    models.set(inbox, model);
  }
  const m = model;
  useEffect(() => inbox.subscribe(() => m.patch({})), [inbox, m]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (layers.layer) return false;
      if (["CRM-11", "CRM-17", "CRM-07"].includes(m.state.screen)) {
        m.navigate(m.state.screen === "CRM-07" ? "CRM-01" : "CRM-10", "");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [m, layers.layer]);
  const actions: CrmNavigation = {
    model: m,
    onChat: (id) => router.push(`/conversation/${id}`),
    onHistory: (id) => router.push(`/history/${id}`),
    onTask: (id) =>
      layers.open({
        kind: "sheet",
        title: "Nueva tarea",
        content: <TaskSheet store={directory.get(id)} />,
      }),
    onLayer: (id: CrmId, arg?: string) => {
      if (arg === "library") {
        layers.toast("Biblioteca pendiente de implementación");
        return;
      }
      if (id === "CRM-02" || id === "CRM-12") {
        if (arg) m.get(arg);
        m.patch({ contactId: arg ?? m.state.contactId });
      }
      layers.open({
        kind: ["CRM-05", "CRM-07D"].includes(id)
          ? "dialog"
          : ["CRM-09", "CRM-13", "CRM-16"].includes(id)
            ? "menu"
            : "sheet",
        title: layerTitles[id] ?? "CRM",
        content: <CrmOverlay {...actions} id={id} arg={arg} />,
      });
    },
  };
  if (!session || !canAccess(session.role, "crm", disabled))
    return (
      <Screen>
        <EmptyState
          title="Módulo no disponible"
          message="Tu perfil no tiene acceso a CRM."
        />
      </Screen>
    );
  return (
    <Screen keyboard>
      <View style={{ flex: 1 }}>
        <CrmView {...actions} />
      </View>
    </Screen>
  );
}
