import React, { useEffect, useState } from "react";
import { BackHandler, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
import { LibraryView } from "../library/LibraryView";
import { libraryFor } from "../library/state";
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
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<"crm" | "library">(
    params.section === "library" ? "library" : "crm",
  );
  useEffect(() => {
    if (params.section === "library") setSection("library");
  }, [params.section]);
  const libraryStore = libraryFor(inbox);
  useEffect(() => {
    const sync = () =>
      m.patch({
        status: inbox.snapshot().status,
        tag:
          m.state.tag === "Todas"
            ? "Todas"
            : (inbox.repository.catalog.tag(m.state.tag)?.name ?? "Todas"),
      });
    sync();
    return inbox.subscribe(sync);
  }, [inbox, m]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (layers.layer) return false;
      if (section === "library") {
        if (libraryStore.snapshot().screen === "CRM-41") return false;
        setSection("crm");
        return true;
      }
      if (["CRM-11", "CRM-17", "CRM-07"].includes(m.state.screen)) {
        m.navigate(m.state.screen === "CRM-07" ? "CRM-01" : "CRM-10", "");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [m, layers.layer, section, libraryStore]);
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
        setSection("library");
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
        {section === "library" ? (
          <LibraryView
            store={libraryStore}
            onSection={(value) => {
              if (value !== "library") {
                setSection("crm");
                m.navigate(value === "contacts" ? "CRM-10" : "CRM-01", "");
              }
            }}
          />
        ) : (
          <CrmView {...actions} />
        )}
      </View>
    </Screen>
  );
}
