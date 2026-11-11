import type {
  Actor,
  Conversation,
  ConversationRepository,
} from "../inbox/model";
import {
  DemoHistoryRepository,
  DemoTransport,
  fillTemplate,
  textParts,
  validateAttachment,
  windowOpen,
  type Attachment,
  type Delivery,
  type HistoryRepository,
  type Message,
  type MessageTransport,
  type Sender,
} from "./model";
export interface LocalStoragePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export type DraftDocument = {
  version: 1;
  draft: string;
  historyDeleted: boolean;
};
const empty = (): DraftDocument => ({
  version: 1,
  draft: "",
  historyDeleted: false,
});
export class DraftRepository {
  private chains = new Map<string, Promise<unknown>>();
  constructor(private storage: LocalStoragePort) {}
  private parse(raw: string | null): DraftDocument {
    if (!raw) return empty();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object")
      throw new Error("Borrador local no válido.");
    const d = value as Partial<DraftDocument>;
    if (
      d.version !== 1 ||
      typeof d.draft !== "string" ||
      d.draft.length > 65536 ||
      typeof d.historyDeleted !== "boolean"
    )
      throw new Error("Borrador local no válido.");
    return d as DraftDocument;
  }
  async read(key: string) {
    await this.chains.get(key);
    return this.parse(await this.storage.get(key));
  }
  update(key: string, patch: Partial<Omit<DraftDocument, "version">>) {
    const op = (this.chains.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const value = { ...this.parse(await this.storage.get(key)), ...patch };
        await this.storage.set(key, JSON.stringify(value));
        return value;
      });
    this.chains.set(key, op);
    void op
      .finally(() => {
        if (this.chains.get(key) === op) this.chains.delete(key);
      })
      .catch(() => {});
    return op;
  }
}
export type ChatSnapshot = Readonly<{
  messages: readonly Message[];
  before: number;
  hasMore: boolean;
  paging: boolean;
  pageError: string;
  ready: boolean;
  draft: string;
  draftError: string;
  error: string;
  lastIncomingAt: number;
  taken: boolean;
  historyDeleted: boolean;
  view: "normal" | "loading" | "empty" | "error" | "offline";
  busy: number;
}>;
let token = 0;
export class ChatStore {
  anchor: { id: string; index: number; within: number } | null = null;
  private listeners = new Set<() => void>();
  private sequence = 0;
  private draftRevision = 0;
  private draftWork: Promise<unknown> = Promise.resolve();
  private hydrateWork: Promise<void> | null = null;
  private pageWork: Promise<void> | null = null;
  private jobs = new Map<string, Promise<Message>>();
  private signatures = new Map<string, string>();
  private readonly prefix = `demo-${Date.now().toString(36)}-${++token}`;
  private outboxCount = 0;
  private state: ChatSnapshot;
  readonly storageKey: string;
  failNextPage = false;
  constructor(
    readonly actor: Actor,
    readonly conversationId: string,
    private conversations: ConversationRepository,
    private history: HistoryRepository,
    readonly transport: MessageTransport,
    private drafts: DraftRepository,
    private activity: (id: string, text: string) => void = () => {},
    private now: () => number = Date.now,
  ) {
    const c = this.authorize();
    this.storageKey = `dashfort.demo.chat.v1.${actor.id}.${conversationId}`;
    this.state = {
      messages: [],
      before: 1000,
      hasMore: true,
      paging: false,
      pageError: "",
      ready: false,
      draft: "",
      draftError: "",
      error: "",
      lastIncomingAt: now() - (c.closed ? 25 : 1) * 3600_000,
      taken: false,
      historyDeleted: false,
      view: "normal",
      busy: 0,
    };
  }
  authorize(): Conversation {
    return this.conversations.get(this.actor, this.conversationId);
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  private patch(patch: Partial<ChatSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.hydrateWork) return this.hydrateWork;
    this.hydrateWork = (async () => {
      try {
        this.authorize();
        const d = await this.drafts.read(this.storageKey);
        const page = d.historyDeleted
          ? { messages: [], before: 0, hasMore: false }
          : this.history.page(this.actor, this.conversationId, undefined, 20);
        this.patch({
          ...page,
          ready: true,
          draft: d.draft,
          historyDeleted: d.historyDeleted,
          error: "",
          draftError: "",
        });
      } catch {
        this.patch({
          error:
            "No se pudieron leer el borrador y el historial locales. Reintenta.",
          ready: false,
        });
      } finally {
        this.hydrateWork = null;
      }
    })();
    return this.hydrateWork;
  };
  setDraft = (draft: string) => {
    this.authorize();
    if (!this.state.ready)
      throw new Error("Espera a que se recupere el borrador.");
    if (draft.length > 65536)
      throw new Error("El borrador supera 65.536 caracteres.");
    this.patch({ draft });
    const revision = ++this.draftRevision;
    this.draftWork = this.draftWork
      .catch(() => {})
      .then(async () => {
        if (revision !== this.draftRevision) return;
        try {
          await this.drafts.update(this.storageKey, { draft });
          if (revision === this.draftRevision) this.patch({ draftError: "" });
        } catch {
          if (revision === this.draftRevision)
            this.patch({
              draftError: "No se pudo guardar el borrador en este dispositivo.",
            });
        }
      });
  };
  flushDraft = async () => {
    await this.draftWork;
    if (this.state.draftError) throw new Error(this.state.draftError);
  };
  retryDraft = () => {
    this.setDraft(this.state.draft);
    return this.flushDraft();
  };
  loadOlder = () => {
    if (this.pageWork) return this.pageWork;
    if (!this.state.ready || !this.state.hasMore) return Promise.resolve();
    this.patch({ paging: true, pageError: "" });
    const before = this.state.before;
    this.pageWork = Promise.resolve()
      .then(() => {
        this.authorize();
        if (this.failNextPage) {
          this.failNextPage = false;
          throw new Error("No se pudo cargar la página anterior.");
        }
        const page = this.history.page(
          this.actor,
          this.conversationId,
          before,
          40,
        );
        const known = new Set(this.state.messages.map((m) => m.id));
        this.patch({
          messages: [
            ...page.messages.filter((m) => !known.has(m.id)),
            ...this.state.messages,
          ],
          before: page.before,
          hasMore: page.hasMore,
        });
      })
      .catch((e) => this.patch({ pageError: (e as Error).message }))
      .finally(() => {
        this.pageWork = null;
        this.patch({ paging: false });
      });
    return this.pageWork;
  };
  isOpen = () => windowOpen(this.state.lastIncomingAt, this.now());
  tick = () => this.patch({});
  clearError = () => this.patch({ error: "" });
  take = () => {
    this.authorize();
    this.patch({ taken: true });
  };
  closeWindow = () =>
    this.patch({ lastIncomingAt: this.now() - 25 * 3600_000 });
  setView = (view: ChatSnapshot["view"]) => {
    if (this.transport instanceof DemoTransport)
      this.transport.online = view !== "offline";
    this.patch({ view });
  };
  private pendingIncoming: Sender[] = [];
  receive = (sender: Sender = "in") => {
    this.authorize();
    if (this.state.view === "offline") {
      this.pendingIncoming.push(sender);
      return;
    }
    const message: Message = {
      id: `${this.prefix}:incoming:${++this.sequence}`,
      conversationId: this.conversationId,
      sender,
      text:
        sender === "in"
          ? "Mensaje entrante de prueba"
          : sender === "ai"
            ? "Respuesta simulada del agente de IA"
            : sender === "connected"
              ? "Joe · Respuesta de IA conectada"
              : sender === "note"
                ? "Nota interna de demostración"
                : "Evento de prueba",
      time: this.now(),
      status: "read",
      parts: [],
    };
    this.patch({
      messages: [...this.state.messages, message],
      lastIncomingAt: sender === "in" ? this.now() : this.state.lastIncomingAt,
    });
    this.activity(this.conversationId, message.text);
  };
  reconnect = () => {
    this.setView("normal");
    const incoming = this.pendingIncoming;
    this.pendingIncoming = [];
    incoming.forEach((sender) => this.receive(sender));
  };
  send = (input: {
    key?: string;
    text: string;
    attachment?: Attachment;
    templateId?: string;
    variables?: readonly string[];
  }): Promise<Message> => {
    this.authorize();
    if (!this.state.ready)
      throw new Error("Espera a que termine la carga local.");
    const key = input.key ?? String(++this.sequence);
    if (!key || key.length > 120)
      throw new Error("Identificador de envío no válido.");
    const text = input.templateId
      ? fillTemplate(input.templateId, input.variables ?? [])
      : input.text.trim();
    if (input.attachment) {
      validateAttachment(input.attachment);
      if (input.text.length > 1024)
        throw new Error("El pie del adjunto admite hasta 1.024 caracteres.");
    }
    const parts = textParts(text || input.attachment?.name || "");
    const signature = JSON.stringify([
      text,
      input.attachment ?? null,
      input.templateId ?? null,
    ]);
    const id = `${this.prefix}:out:${key}`;
    if (this.signatures.has(id)) {
      if (this.signatures.get(id) !== signature)
        throw new Error("Ese identificador ya pertenece a otro mensaje.");
      const existing = this.state.messages.find((m) => m.id === id)!;
      return this.jobs.get(id) ?? Promise.resolve(existing);
    }
    if (!input.templateId && !this.isOpen())
      throw new Error(
        "La ventana de 24 horas está cerrada. Envía una plantilla aprobada.",
      );
    if (this.outboxCount >= 128)
      throw new Error(
        "Se alcanzó el límite de 128 envíos de esta conversación de prueba.",
      );
    const message: Message = {
      id,
      conversationId: this.conversationId,
      text: text || input.attachment!.name,
      sender: "team",
      time: this.now(),
      status: "pending",
      parts,
      attachment: input.attachment,
      templateId: input.templateId,
    };
    this.signatures.set(id, signature);
    this.outboxCount++;
    this.patch({
      messages: [...this.state.messages, message],
      error: "",
      view: this.state.view === "empty" ? "normal" : this.state.view,
    });
    return this.transmit(message);
  };
  sendDraft = () => {
    if (this.state.busy)
      throw new Error("Espera a que termine el envío de prueba.");
    const result = this.send({ text: this.state.draft });
    this.setDraft("");
    return result;
  };
  private updateMessage(id: string, patch: Partial<Message>) {
    this.patch({
      messages: this.state.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    });
  }
  private transmit(message: Message): Promise<Message> {
    if (this.jobs.has(message.id)) return this.jobs.get(message.id)!;
    this.patch({ busy: this.state.busy + 1 });
    const work = Promise.resolve()
      .then(async () => {
        this.authorize();
        if (!message.templateId && !this.isOpen())
          throw new Error(
            "La ventana de 24 horas está cerrada. Envía una plantilla aprobada.",
          );
        if (message.attachment) validateAttachment(message.attachment);
        let transportFailure = false;
        await this.transport.send(message, (status) => {
          if (status === "failed") transportFailure = true;
          const current = this.state.messages.find((m) => m.id === message.id);
          const rank = {
            pending: 0,
            sent: 1,
            delivered: 2,
            read: 3,
            failed: -1,
          };
          if (
            current &&
            current.status !== "failed" &&
            status !== "failed" &&
            rank[status] >= rank[current.status]
          )
            this.updateMessage(message.id, { status });
        });
        const final = this.state.messages.find((m) => m.id === message.id);
        if (transportFailure || final?.status === "pending")
          throw new Error(
            "No se confirmó el envío. Puedes reintentarlo sin duplicar.",
          );
        this.activity(this.conversationId, message.text);
      })
      .catch((e) => {
        const current = this.state.messages.find((m) => m.id === message.id);
        if (current?.status === "read" || current?.status === "delivered")
          this.patch({ error: (e as Error).message });
        else
          this.updateMessage(message.id, {
            status: "failed",
            failure: (e as Error).message,
          });
      })
      .then(() => this.state.messages.find((m) => m.id === message.id)!)
      .finally(() => {
        this.jobs.delete(message.id);
        this.patch({ busy: Math.max(0, this.state.busy - 1) });
      });
    this.jobs.set(message.id, work);
    return work;
  }
  retry = (id: string) => {
    this.authorize();
    const message = this.state.messages.find((m) => m.id === id);
    if (!message) throw new Error("Mensaje no disponible.");
    if (this.jobs.has(id)) return this.jobs.get(id)!;
    if (message.status !== "failed") return Promise.resolve(message);
    if (!message.templateId && !this.isOpen())
      throw new Error(
        "La ventana de 24 horas está cerrada. Envía una plantilla aprobada.",
      );
    this.updateMessage(id, { status: "pending", failure: undefined });
    return this.transmit({ ...message, status: "pending", failure: undefined });
  };
  remove = async () => {
    this.authorize();
    if (this.actor.role === "advisor")
      throw new Error("Tu perfil no puede eliminar este chat.");
    if (this.state.busy)
      throw new Error("Espera a que termine el envío de prueba.");
    await this.flushDraft();
    await this.drafts.update(this.storageKey, {
      draft: "",
      historyDeleted: true,
    });
    this.patch({
      messages: [],
      before: 0,
      hasMore: false,
      draft: "",
      historyDeleted: true,
    });
    this.activity(this.conversationId, "Sin mensajes");
  };
}
export class ChatDirectory {
  private stores = new Map<string, ChatStore>();
  readonly history: DemoHistoryRepository;
  constructor(
    private actor: Actor,
    private conversations: ConversationRepository,
    private drafts: DraftRepository,
    private activity: (id: string, text: string) => void = () => {},
  ) {
    this.history = new DemoHistoryRepository(conversations);
  }
  get(id: string) {
    this.conversations.get(this.actor, id);
    let store = this.stores.get(id);
    if (store) {
      this.stores.delete(id);
      this.stores.set(id, store);
      return store;
    }
    if (this.stores.size >= 8) {
      const candidate = [...this.stores].find(([, s]) => !s.snapshot().busy);
      if (!candidate)
        throw new Error("Espera a que terminen los envíos de prueba.");
      this.stores.delete(candidate[0]);
    }
    store = new ChatStore(
      this.actor,
      id,
      this.conversations,
      this.history,
      new DemoTransport(),
      this.drafts,
      this.activity,
    );
    this.stores.set(id, store);
    return store;
  }
}
