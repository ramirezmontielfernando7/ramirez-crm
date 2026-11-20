import { templatesFor } from "../templates/state";
import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useOptionalInbox } from "../inbox/store";
import { preferencesStorage } from "../../services/storage";
import { ChatDirectory, DraftRepository, type ChatStore } from "./core";
const drafts = new DraftRepository(preferencesStorage);
const Context = createContext<ChatDirectory | null>(null);
export function ChatProvider({ children }: React.PropsWithChildren) {
  const inbox = useOptionalInbox();
  const manager = useMemo(
    () =>
      inbox
        ? new ChatDirectory(
            inbox.actor,
            inbox.repository,
            drafts,
            inbox.chatActivity,
            templatesFor(inbox),
          )
        : null,
    [inbox],
  );
  useEffect(() => {
    if (!inbox) return;
    const t = templatesFor(inbox),
      release = t.retain();
    void t.hydrate();
    return release;
  }, [inbox]);
  return <Context.Provider value={manager}>{children}</Context.Provider>;
}
export const useChatDirectory = () => {
  const manager = useContext(Context);
  if (!manager) throw new Error("Se requiere una sesión ficticia.");
  return manager;
};
export const useChatState = (store: ChatStore) =>
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);

export const useOptionalChatDirectory = () => useContext(Context);
