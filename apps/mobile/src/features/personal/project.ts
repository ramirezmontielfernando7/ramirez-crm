import type { InboxStore } from "../inbox/store-core";
import type { PersonalStore } from "./core";
/** Explicit demo metadata transfer; private messages/drafts never enter Inbox. */
export function projectCustomer(
  inbox: InboxStore,
  store: PersonalStore,
  id: string,
) {
  if (
    inbox.actor.id !== store.actor ||
    inbox.repository.catalog.organizationId !== store.team.organizationId
  )
    throw Error("Ámbito de traspaso no válido.");
  const r = store.room(id);
  if (!r.client || r.private) throw Error("Confirma primero el traspaso.");
  const c = inbox.repository.createPersonal(inbox.actor, r.name, r.phone);
  inbox.repository.updateContact(inbox.actor, c.id, {
    ai: store.snapshot().doc.privacy[1] ? "on" : "off",
  });
  inbox.reload();
  return c;
}
