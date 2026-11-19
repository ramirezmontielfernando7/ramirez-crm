import { CatalogStore } from "../catalog/core";
import {
  DemoConversationRepository,
  defaultFilters,
  type Actor,
  type Filters,
  type Conversation,
} from "./model";
export type DataState = "normal" | "loading" | "empty" | "error" | "offline";
export class InboxStore {
  private pending: string[] = [];
  readonly repository: DemoConversationRepository;
  private listeners = new Set<() => void>();
  private state: {
    data: readonly Conversation[];
    filters: Filters;
    searching: boolean;
    selecting: boolean;
    selected: ReadonlySet<string>;
    status: DataState;
  } = {
    data: [],
    filters: { ...defaultFilters },
    searching: false,
    selecting: false,
    selected: new Set(),
    status: "normal",
  };
  anchor: { id: string; index: number; within: number } | null = null;
  scrollToTop = () => {};
  offset = 0;
  constructor(
    readonly actor: Actor,
    catalog = new CatalogStore(actor),
  ) {
    this.repository = new DemoConversationRepository(undefined, catalog);
    this.repository.subscribeCatalog(() => {
      const selected = this.state.filters.tag;
      const next =
        selected === "Toda etiqueta"
          ? selected
          : (catalog.tag(selected)?.name ?? "Toda etiqueta");
      this.state = {
        ...this.state,
        filters: { ...this.state.filters, tag: next },
      };
      this.reload();
    });
    this.state = { ...this.state, data: this.repository.list(actor) };
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  patch = (patch: Partial<Omit<typeof this.state, "data">>) => {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  };
  filter = (patch: Partial<Filters>) => {
    this.anchor = null;
    this.offset = 0;
    this.patch({ filters: { ...this.state.filters, ...patch } });
  };
  toggle = (id: string) => {
    this.repository.get(this.actor, id);
    const selected = new Set(this.state.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.patch({ selected, selecting: true });
  };
  cancel = () => this.patch({ selecting: false, selected: new Set() });
  reload = () => {
    this.state = { ...this.state, data: this.repository.list(this.actor) };
    this.listeners.forEach((f) => f());
  };
  archive = () => {
    this.repository.archive(this.actor, [...this.state.selected]);
    this.cancel();
    this.reload();
  };
  assign = (person: string) => {
    this.repository.assign(this.actor, [...this.state.selected], person);
    this.cancel();
    this.reload();
  };
  reconnect = () => {
    for (const id of this.pending) this.repository.incoming(this.actor, id);
    this.pending = [];
    this.reload();
    this.patch({ status: "normal" });
  };
  chatActivity = (id: string, text: string) => {
    this.repository.setPreview(this.actor, id, text);
    this.reload();
  };
  incoming = (id: string) => {
    if (this.state.status === "offline") {
      this.repository.get(this.actor, id);
      this.pending.push(id);
      return;
    }
    this.repository.incoming(this.actor, id);
    this.reload();
  };
  private notificationEvents = new Map<string, Set<string>>();
  reconcileNotification = (id: string, events: readonly string[]) => {
    this.repository.get(this.actor, id);
    const prior = this.notificationEvents.get(id) ?? new Set<string>();
    const added = [...new Set(events)].filter((e) => !prior.has(e));
    if (!added.length) return;
    this.repository.incomingBatch(this.actor, id, added.length);
    this.notificationEvents.set(id, new Set([...prior, ...added]));
    this.reload();
  };
  create = (name: string, phone: string) => {
    const c = this.repository.create(this.actor, name, phone);
    this.reload();
    return c;
  };
}
