import React from "react";
import {
  Clock3,
  GitBranch,
  PlugZap,
  Tag,
  UserCheck,
  UserRound,
} from "lucide-react-native";
import { NavRow } from "../../components/ui";
import { useLayers } from "../../components/Layers";
import { useContactFlags } from "./context";
import type { ContactStore } from "./core";
import {
  AiSheet,
  AssignSheet,
  ConnectionSheet,
  DemoSheet,
  SaleSheet,
  StageSheet,
  TagsSheet,
  TaskSheet,
} from "./Sheets";
import { canAssign, canChangeMode } from "./model";
export function useContactActions(store: ContactStore) {
  const { open } = useLayers();
  return {
    stage: () =>
      open({
        kind: "sheet",
        title: "Etapa del pipeline",
        content: <StageSheet store={store} />,
      }),
    assign: () =>
      open({
        kind: "sheet",
        title: "Asignar a",
        content: <AssignSheet store={store} />,
      }),
    tags: () =>
      open({
        kind: "sheet",
        title: "Etiquetas",
        content: <TagsSheet store={store} />,
      }),
    ai: () =>
      open({
        kind: "sheet",
        title: "IA en este chat",
        content: <AiSheet store={store} />,
      }),
    connection: () =>
      open({
        kind: "sheet",
        title: "Conexión del chat",
        content: <ConnectionSheet store={store} />,
      }),
    amount: () =>
      open({
        kind: "sheet",
        title: "Monto",
        content: <SaleSheet store={store} kind="amount" />,
      }),
    priority: () =>
      open({
        kind: "sheet",
        title: "Prioridad",
        content: <SaleSheet store={store} kind="priority" />,
      }),
    task: () =>
      open({
        kind: "sheet",
        title: "Nueva tarea",
        content: <TaskSheet store={store} />,
      }),
    demo: () =>
      open({
        kind: "sheet",
        title: "Pruebas de detalles",
        content: <DemoSheet store={store} />,
      }),
  };
}
export function ContactMenuRows({
  store,
  details,
  history,
}: {
  store: ContactStore;
  details?: () => void;
  history: () => void;
}) {
  const actions = useContactActions(store),
    flags = useContactFlags();
  return (
    <>
      {details && (
        <NavRow icon={UserRound} label="Ver detalles" onPress={details} />
      )}
      <NavRow icon={Clock3} label="Ver historial" onPress={history} />
      <NavRow icon={GitBranch} label="Cambiar etapa" onPress={actions.stage} />
      {canAssign(store.actor) && (
        <NavRow icon={UserCheck} label="Asignar" onPress={actions.assign} />
      )}
      <NavRow icon={Tag} label="Etiquetas" onPress={actions.tags} />
      {canChangeMode(store.actor, store.authorize(), flags) && (
        <NavRow
          icon={PlugZap}
          label="Conexión del chat"
          onPress={actions.connection}
        />
      )}
    </>
  );
}
