import { useEffect, useSyncExternalStore } from "react";
import { preferencesStorage } from "../../services/storage";
import { TeamRepository } from "./core";
const stores = new Map<string, TeamRepository>();
export function teamFor(org = "demo-org-cristal") {
  let s = stores.get(org);
  if (!s) {
    s = new TeamRepository(org, preferencesStorage);
    stores.set(org, s);
  }
  return s;
}
export function useTeam() {
  const store = teamFor(),
    state = useSyncExternalStore(
      store.subscribe,
      store.snapshot,
      store.snapshot,
    );
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return { store, state };
}

export function usePeople() {
  const { state } = useTeam();
  const people = state.doc.members.filter((m) => m.active);
  return {
    team: people,
    personName: (id: string | null) =>
      state.doc.members.find((m) => m.id === id)?.name ?? "Sin asignar",
  };
}
