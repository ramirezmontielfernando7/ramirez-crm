import {
  seedStudio,
  freezeStudio,
  validateStudio,
  type StudioDoc,
} from "../studio/model";
import type { Actor } from "../inbox/model";
import type { StoragePort } from "../../services/storage";
import {
  knowledgeDefaults,
  knowledgeReaders,
  type KnowledgeInfo,
} from "../knowledge/model";
export type LibraryFile = Readonly<{
  name: string;
  bytes: number;
  kind: "pdf" | "docx" | "txt" | "image";
}>;
export type LibraryEntry = Readonly<{
  id: string;
  organizationId: string;
  title: string;
  content: string;
  folder: string;
  tags: readonly string[];
  chat: boolean;
  rag: boolean;
  file: LibraryFile | null;
  version: number;
  knowledge?: KnowledgeInfo;
}>;
export type LibraryDraft = Omit<
  LibraryEntry,
  "organizationId" | "version" | "id"
> & { id?: string; expectedVersion?: number };
export type LibraryState = Readonly<{
  ready: boolean;
  saving: boolean;
  error: string;
  entries: readonly LibraryEntry[];
  folders: readonly string[];
  knowledgeGroups: readonly string[];
  studio: StudioDoc;
  query: string;
  folder: string;
  tag: string;
  status: "normal" | "loading" | "empty" | "error" | "offline";
  screen: "CRM-40" | "CRM-41";
  entryId: string | null;
  grid: boolean;
}>;
const freeze = (e: LibraryEntry): LibraryEntry =>
  Object.freeze({
    ...e,
    tags: Object.freeze([...e.tags]),
    file: e.file ? Object.freeze({ ...e.file }) : null,
    knowledge: e.knowledge ? Object.freeze({ ...e.knowledge }) : undefined,
  });
const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export const librarySamples: readonly LibraryFile[] = Object.freeze([
  { name: "Muestra.pdf", bytes: 2400000, kind: "pdf" },
  { name: "Muestra.docx", bytes: 16000, kind: "docx" },
  { name: "Muestra.txt", bytes: 3000, kind: "txt" },
  { name: "Muestra.png", bytes: 640000, kind: "image" },
]);
function seeds(organizationId: string) {
  return [
    {
      id: "demo-library-catalog",
      title: "Catálogo mayoreo 2026.pdf",
      content: "",
      folder: "Catálogos",
      chat: true,
      rag: true,
      file: { ...librarySamples[0]!, name: "Catálogo mayoreo 2026.pdf" },
    },
    {
      id: "demo-library-policy",
      title: "Política de envíos",
      content: "Enviamos a todo México en 2 a 4 días hábiles…",
      folder: "Políticas",
      chat: true,
      rag: true,
      file: null,
    },
    {
      id: "demo-library-prices",
      title: "Lista de precios noviembre",
      content: "",
      folder: "Catálogos",
      chat: true,
      rag: false,
      file: librarySamples[3]!,
    },
    {
      id: "demo-library-faq",
      title: "Preguntas frecuentes",
      content: "Material ficticio de consulta. No se conecta ningún agente.",
      folder: "Políticas",
      chat: false,
      rag: true,
      file: null,
    },
  ].map((e) => freeze({ ...e, organizationId, tags: [], version: 1 }));
}
export class LibraryStore {
  readonly key: string;
  readonly actor: Readonly<Actor>;
  private sequence = 0;
  private work: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private state: LibraryState;
  constructor(
    actor: Actor,
    readonly organizationId: string,
    readonly storage: StoragePort,
  ) {
    if (
      !/^demo-org-[\w-]{1,60}$/.test(organizationId) ||
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Scope ficticio inválido.");
    this.actor = Object.freeze({ ...actor });
    this.key = `dashfort:library:v1:${organizationId}:${actor.id}`;
    this.state = Object.freeze({
      ready: false,
      saving: false,
      error: "",
      entries: Object.freeze(seeds(organizationId)),
      folders: Object.freeze(["Catálogos", "Políticas"]),
      knowledgeGroups: Object.freeze(["General", "Ventas"]),
      studio: seedStudio(),
      query: "",
      folder: "Todas",
      tag: "",
      status: "normal",
      screen: "CRM-40",
      entryId: null,
      grid: false,
    });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  snapshot = () => this.state;
  private patch(p: Partial<LibraryState>) {
    this.state = Object.freeze({ ...this.state, ...p });
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* UI subscriber failure cannot abort local persistence. */
      }
    });
  }
  configure(
    p: Partial<
      Pick<LibraryState, "query" | "folder" | "tag" | "status" | "grid">
    >,
  ) {
    this.patch(p);
  }
  get canManage() {
    return this.actor.role !== "advisor";
  }
  private manage() {
    if (!this.canManage)
      throw Error("Tu perfil no permite gestionar conocimientos.");
  }
  private validate(
    e: LibraryEntry,
    folders: readonly string[],
    groups = this.state.knowledgeGroups,
    studio = this.state.studio,
  ) {
    if (
      e.knowledge !== undefined &&
      (!e.knowledge ||
        typeof e.knowledge !== "object" ||
        !groups.includes(e.knowledge.group) ||
        (e.knowledge.reader !== null &&
          !studio.agents.some(
            (r) =>
              r.id === e.knowledge!.reader && !r.archived && r.versions.length,
          )) ||
        !["indexed", "processing", "failed"].includes(e.knowledge.status) ||
        !["library", "studio"].includes(e.knowledge.source) ||
        typeof e.knowledge.readable !== "boolean")
    )
      throw Error("Los metadatos de conocimiento no son válidos.");
    if (
      !e ||
      !/^demo-library-[\w-]{1,100}$/.test(e.id) ||
      e.organizationId !== this.organizationId ||
      typeof e.title !== "string" ||
      !e.title.trim() ||
      e.title.length > 180 ||
      typeof e.content !== "string" ||
      e.content.length > 20000 ||
      !folders.includes(e.folder) ||
      typeof e.chat !== "boolean" ||
      typeof e.rag !== "boolean" ||
      (!e.chat && !e.rag) ||
      (!e.content.trim() && !e.file) ||
      !Number.isSafeInteger(e.version) ||
      e.version < 1 ||
      !Array.isArray(e.tags) ||
      e.tags.length > 20 ||
      e.tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 40) ||
      new Set(e.tags).size !== e.tags.length
    )
      throw Error(
        "Completa título, contenido o archivo y al menos un destino.",
      );
    if (
      e.file &&
      (!librarySamples.some((s) => s.kind === e.file!.kind) ||
        typeof e.file.name !== "string" ||
        !e.file.name.trim() ||
        e.file.name.length > 180 ||
        !Number.isSafeInteger(e.file.bytes) ||
        e.file.bytes <= 0 ||
        e.file.bytes > 100 * 1024 * 1024)
    )
      throw Error(
        "Archivo no válido. Máximo 100 MB: PDF, Word, texto o imagen.",
      );
  }
  hydrate = (): Promise<void> => {
    if (this.work) return this.work;
    if (this.state.ready && !this.state.error) return Promise.resolve();
    this.work = Promise.resolve().then(async () => {
      try {
        const raw = await this.storage.get(this.key);
        let entries = this.state.entries,
          folders = this.state.folders,
          knowledgeGroups = this.state.knowledgeGroups,
          studio = this.state.studio;
        if (raw !== null) {
          if (raw.length > 8_000_000)
            throw Error("La Biblioteca local supera el límite de lectura.");
          const d = JSON.parse(raw);
          if (
            d.schema !== 1 ||
            d.organizationId !== this.organizationId ||
            d.userId !== this.actor.id ||
            !Array.isArray(d.folders) ||
            d.folders.length > 60 ||
            d.folders.length < 1 ||
            d.folders.some(
              (f: unknown) =>
                typeof f !== "string" || !f.trim() || f.length > 60,
            ) ||
            new Set(d.folders).size !== d.folders.length ||
            !Array.isArray(d.entries) ||
            d.entries.length > 5000 ||
            d.entries.some((e: unknown) => !e || typeof e !== "object") ||
            new Set(d.entries.map((e: LibraryEntry) => e.id)).size !==
              d.entries.length
          )
            throw Error(
              "La Biblioteca local no es válida; no se sobrescribió.",
            );
          const groups = d.knowledgeGroups ?? ["General", "Ventas"];
          if (
            !Array.isArray(groups) ||
            groups.length > 60 ||
            !groups.includes("General") ||
            groups.some(
              (g: unknown) =>
                typeof g !== "string" ||
                !g.trim() ||
                g.length > 60 ||
                g === "Exclusivos",
            ) ||
            new Set(groups.map((g: string) => norm(g))).size !== groups.length
          )
            throw Error("Grupos de conocimiento locales no válidos.");
          studio = d.studio ?? seedStudio();
          validateStudio(studio);
          studio = freezeStudio(studio);
          d.entries.forEach((e: LibraryEntry) =>
            this.validate(e, d.folders, groups, studio),
          );
          knowledgeGroups = Object.freeze([...groups]);
          entries = Object.freeze(d.entries.map(freeze));
          folders = Object.freeze([...d.folders]);
        }
        this.patch({
          entries,
          folders,
          knowledgeGroups,
          studio,
          ready: true,
          status: "normal",
          error: "",
        });
      } catch (e) {
        this.patch({
          ready: false,
          status: "error",
          error:
            e instanceof Error
              ? e.message
              : "No se pudo leer la Biblioteca local.",
        });
      } finally {
        this.work = null;
      }
    });
    this.patch({ status: "loading", error: "" });
    return this.work;
  };
  list() {
    const { query, folder, tag, entries, status } = this.state;
    if (status === "empty") return [];
    const q = norm(query.trim());
    return entries.filter(
      (e) =>
        e.organizationId === this.organizationId &&
        e.knowledge?.source !== "studio" &&
        (this.canManage || e.chat) &&
        (folder === "Todas" || e.folder === folder) &&
        (!tag || e.tags.includes(tag)) &&
        (!q || norm(e.title + " " + e.content).includes(q)),
    );
  }
  get(id: string) {
    const e = this.state.entries.find(
      (e) =>
        e.id === id &&
        (e.knowledge?.source !== "studio" || this.actor.role === "owner") &&
        e.organizationId === this.organizationId &&
        (this.canManage || e.chat),
    );
    if (!e) throw Error("No tienes acceso a esta entrada.");
    return e;
  }
  open(id: string | null) {
    if (id) this.get(id);
    else this.manage();
    this.patch({ screen: "CRM-41", entryId: id, error: "" });
  }
  back() {
    if (
      this.state.screen === "CRM-40" &&
      this.state.entryId === null &&
      !this.state.error
    )
      return;
    this.patch({ screen: "CRM-40", entryId: null, error: "" });
  }
  forChat() {
    return this.list().filter((e) => e.chat);
  }
  private async commit(
    entries: readonly LibraryEntry[],
    folders = this.state.folders,
    navigation: Partial<Pick<LibraryState, "screen" | "entryId">> = {},
    knowledgeGroups = this.state.knowledgeGroups,
    studio = this.state.studio,
  ) {
    if (!this.state.ready || this.state.saving)
      throw Error(
        "Espera a que termine la operación local o reintenta la lectura.",
      );
    validateStudio(studio);
    entries.forEach((e) => this.validate(e, folders, knowledgeGroups, studio));
    const raw = JSON.stringify({
      schema: 1,
      organizationId: this.organizationId,
      userId: this.actor.id,
      folders,
      knowledgeGroups,
      studio,
      entries,
    });
    if (raw.length > 8_000_000)
      throw Error(
        "La Biblioteca local alcanzó su límite de almacenamiento de demostración.",
      );
    this.patch({ saving: true, error: "" });
    try {
      await this.storage.set(this.key, raw);
      this.patch({
        entries: Object.freeze([...entries]),
        folders: Object.freeze([...folders]),
        knowledgeGroups: Object.freeze([...knowledgeGroups]),
        studio: freezeStudio(studio),
        saving: false,
        error: "",
        ...navigation,
      });
    } catch {
      this.patch({
        saving: false,
        error: "No se pudo guardar localmente. Tu borrador sigue disponible.",
      });
      throw Error(this.state.error);
    }
  }
  async save(draft: LibraryDraft) {
    this.manage();
    const old = draft.id ? this.get(draft.id) : null;
    if (old && old.version !== draft.expectedVersion)
      throw Error("La entrada cambió. Vuelve a abrirla antes de guardar.");
    if (!old && this.state.entries.length >= 5000)
      throw Error("La Biblioteca de demostración alcanzó su límite.");
    const used = new Set(this.state.entries.map((e) => e.id));
    let id = old?.id ?? "";
    if (!old)
      do {
        id = `demo-library-local-${Date.now().toString(36)}-${++this.sequence}`;
      } while (used.has(id));
    const next = freeze({
      id,
      organizationId: this.organizationId,
      title: draft.title.trim(),
      content: draft.content,
      folder: draft.folder,
      tags: draft.tags,
      chat: draft.chat,
      rag: draft.rag,
      file: draft.file,
      version: (old?.version ?? 0) + 1,
      knowledge: draft.knowledge ?? old?.knowledge,
    });
    this.validate(next, this.state.folders);
    await this.commit(
      old
        ? this.state.entries.map((e) => (e.id === id ? next : e))
        : [...this.state.entries, next],
    );
    return id;
  }
  async remove(id: string, version: number) {
    this.manage();
    const old = this.get(id);
    if (old.version !== version)
      throw Error("La entrada cambió. Vuelve a abrirla.");
    await this.commit(
      this.state.entries.filter((e) => e.id !== id),
      this.state.folders,
      { screen: "CRM-40", entryId: null },
    );
  }
  async addFolder(name: string) {
    this.manage();
    const trimmed = name.trim();
    if (
      !trimmed ||
      trimmed.length > 60 ||
      this.state.folders.length >= 60 ||
      this.state.folders.some((f) => norm(f) === norm(trimmed))
    )
      throw Error("Elige otro nombre de carpeta (1–60 caracteres).");
    await this.commit(this.state.entries, [...this.state.folders, trimmed]);
  }
  private studio() {
    if (this.actor.role !== "owner")
      throw Error("Tu perfil no puede gestionar Estudio IA.");
  }
  knowledgeInfo(e: LibraryEntry): KnowledgeInfo {
    return e.knowledge ?? knowledgeDefaults;
  }
  knowledgeList(group: string) {
    this.studio();
    if (this.state.status === "empty") return [];
    return this.state.entries.filter(
      (e) =>
        e.rag &&
        e.organizationId === this.organizationId &&
        (group === "Exclusivos"
          ? !!this.knowledgeInfo(e).reader
          : this.knowledgeInfo(e).group === group),
    );
  }
  knowledgeGet(id: string) {
    this.studio();
    const e = this.get(id);
    if (!e.rag) throw Error("Documento no disponible para la IA.");
    return e;
  }
  async uploadKnowledge(
    file: LibraryFile,
    group: string,
    reader: string | null,
    readable: boolean,
  ) {
    this.studio();
    if (
      !["pdf", "txt"].includes(file.kind) ||
      !/\.(pdf|txt|md)$/i.test(file.name) ||
      file.bytes > 20 * 1024 * 1024 ||
      typeof readable !== "boolean"
    )
      throw Error("Elige un PDF con texto, TXT o MD ficticio de hasta 20 MB.");
    return this.save({
      title: file.name,
      content: "",
      folder: this.state.folders[0]!,
      tags: [],
      chat: false,
      rag: true,
      file: { name: file.name, bytes: file.bytes, kind: file.kind },
      knowledge: {
        group,
        reader,
        source: "studio",
        status: "processing",
        readable,
      },
    });
  }
  async moveKnowledge(id: string, version: number, group: string) {
    this.studio();
    const old = this.knowledgeGet(id);
    if (old.version !== version)
      throw Error("El documento cambió. Vuelve a abrirlo.");
    return this.save({
      ...old,
      expectedVersion: version,
      knowledge: { ...this.knowledgeInfo(old), group },
    });
  }
  async removeKnowledge(id: string, version: number) {
    this.studio();
    const old = this.knowledgeGet(id);
    if (old.version !== version)
      throw Error("El documento cambió. Vuelve a abrirlo.");
    if (old.chat)
      return this.save({ ...old, expectedVersion: version, rag: false });
    return this.remove(id, version);
  }
  async finishKnowledge() {
    this.studio();
    const next = this.state.entries.map((e) =>
      e.rag && e.knowledge?.status === "processing"
        ? freeze({
            ...e,
            version: e.version + 1,
            knowledge: {
              ...e.knowledge,
              status: e.knowledge.readable ? "indexed" : "failed",
            },
          })
        : e,
    );
    if (next.every((e, i) => e === this.state.entries[i])) return;
    await this.commit(next);
  }
  async addKnowledgeGroup(name: string) {
    this.studio();
    const n = name.trim(),
      groups = this.state.knowledgeGroups;
    if (
      !n ||
      n.length > 60 ||
      groups.length >= 60 ||
      norm(n) === norm("Exclusivos") ||
      groups.some((g) => norm(g) === norm(n))
    )
      throw Error("Elige otro nombre de grupo (1–60 caracteres).");
    await this.commit(this.state.entries, this.state.folders, {}, [
      ...groups,
      n,
    ]);
  }
  readers() {
    return this.state.studio.agents
      .filter((a) => !a.archived && a.versions.length)
      .map((a) => ({ id: a.id, name: a.name }));
  }
  readerLabel(id: string | null) {
    return (
      this.state.studio.agents.find((a) => a.id === id)?.name ??
      "Todos los agentes"
    );
  }
  async commitStudio(
    expected: number,
    studio: StudioDoc,
    entries: readonly LibraryEntry[] = this.state.entries,
  ) {
    this.studio();
    if (this.state.studio.revision !== expected)
      throw Error("Estudio cambió. Recarga antes de continuar.");
    if (studio.revision !== expected + 1)
      throw Error("Revisión de Estudio no válida.");
    await this.commit(
      entries.map((e) => (Object.isFrozen(e) ? e : freeze(e))),
      this.state.folders,
      {},
      this.state.knowledgeGroups,
      freezeStudio(studio),
    );
  }
}
