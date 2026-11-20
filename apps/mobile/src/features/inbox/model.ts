import type { TeamRepository } from "../team/core";
import { CatalogStore, initialTags } from "../catalog/core";
import { stagePalette } from "../../domain/stage-colors";
let catalogEpoch = 0;
import type { Role } from "../../domain/access";
export const stages = [
  "Nuevo",
  "En conversación",
  "Interesado",
  "Cliente",
  "Perdido",
] as const;
export const tags = initialTags;
export type Conversation = Readonly<{
  id: string;
  name: string;
  phone: string;
  preview: string;
  time: string;
  unread: number;
  stage: string;
  tags: readonly string[];
  assigned: string | null;
  ai: "on" | "pause" | "off";
  archived: boolean;
  campaign: string | null;
  group: boolean;
  closed: boolean;
  optedOut?: boolean;
  lossReason?: string;
  source?: "Facebook Ads" | "Orgánico";
  search: string;
}>;
export type Actor = { id: string; role: Role };
export type Filters = {
  chip: string;
  query: string;
  stage: string;
  tag: string;
  who: string;
};
export const defaultFilters: Filters = {
  chip: "Todos",
  query: "",
  stage: "Toda etapa",
  tag: "Toda etiqueta",
  who: "Todo el equipo",
};
export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
export const searchable = (
  c: Pick<Conversation, "name" | "phone" | "preview" | "tags">,
) => normalize([c.name, c.phone, c.preview, ...c.tags].join(" "));
export const allowed = (actor: Actor, c: Conversation) =>
  actor.role !== "advisor" || c.assigned === actor.id;
export function queryConversations(
  data: readonly Conversation[],
  actor: Actor,
  f: Filters,
) {
  const q = normalize(f.query);
  return data.filter(
    (c) =>
      allowed(actor, c) &&
      c.archived === (f.chip === "Archivados") &&
      (f.chip === "Campañas" ? !!c.campaign : !c.campaign) &&
      (f.chip !== "No leídos" || c.unread > 0) &&
      (f.chip !== "Míos" || c.assigned === actor.id) &&
      (f.chip !== "Grupos" || c.group) &&
      (f.stage === "Toda etapa" || c.stage === f.stage) &&
      (f.tag === "Toda etiqueta" || c.tags.includes(f.tag)) &&
      (f.who !== "Míos" || c.assigned === actor.id) &&
      (f.who !== "Sin asignar" || !c.assigned) &&
      (!q || c.search.includes(q)),
  );
}
export function seedConversations(count = 2000): readonly Conversation[] {
  const names = [
    "Karla Méndez",
    "Luis Ramírez",
    "Cristal Joyas",
    "Adriana Herrera",
    "Jorge Pérez",
    "Mariana Soto",
    "Unid Campus",
    "Roberto Bravo",
    "Elena Flores",
    "Daniel Torres",
    "Pastelería Dulce Vida",
    "Valeria Núñez",
    "Club de compradores",
  ];
  const previews = [
    "Perfecto, ¿me mandas la cotización?",
    "Gracias, mañana paso a la sucursal",
    "Te comparto las promociones de la tienda…",
    "📎 Imagen",
    "Claro, te paso con alguien del equipo",
    "¿Tienen horario el sábado?",
  ];
  return Array.from({ length: count }, (_, i) => {
    const c = {
      id: `demo-conv-${i + 1}`,
      name:
        i < 13
          ? names[i]!
          : `Contacto de prueba ${String(i + 1).padStart(4, "0")}`,
      phone: `+52 55 5550 ${String(i + 142).padStart(4, "0")}`,
      preview: previews[i % 6]!,
      time: i === 0 ? "9:34" : i === 1 ? "8:48" : i < 6 ? "1:21 p. m." : "Ayer",
      unread:
        i === 0 ? 2 : i === 1 ? 1 : i === 5 ? 3 : i > 12 && i % 5 === 0 ? 1 : 0,
      stage: stages[[2, 1, 3, 2, 1, 0, 2, 4, 3, 0, 1, 2, 0][i % 13]!]!,
      tags:
        i === 0
          ? ["Promo nov"]
          : i === 2
            ? ["Mayoreo"]
            : i === 4
              ? ["Seguimiento"]
              : i === 5
                ? ["Facebook Ads"]
                : i % 7 === 0
                  ? ["VIP"]
                  : [],
      assigned:
        i % 4 === 3
          ? null
          : i % 3 === 0
            ? "demo-owner"
            : i % 3 === 1
              ? "demo-coordinator"
              : "demo-advisor",
      ai: (i === 0 ? "pause" : i === 4 ? "off" : "on") as Conversation["ai"],
      archived: i > 12 && i % 29 === 0,
      campaign: i >= 13 && i % 17 === 0 ? "Promo noviembre 2×1" : null,
      group: i === 12,
      closed: i >= 6,
      search: "",
    };
    return { ...c, search: searchable(c) };
  });
}
export interface ConversationRepository {
  readonly catalog?: CatalogStore;
  readonly team?: TeamRepository;
  stageOptions?(): readonly string[];
  stageIdentity?(name: string): string | null;
  stageColor?(name: string): string;
  subscribeCatalog?(listener: () => void): () => void;
  list(actor: Actor): readonly Conversation[];
  get(actor: Actor, id: string): Conversation;
  archive(actor: Actor, ids: readonly string[]): void;
  tagMany?(actor: Actor, ids: readonly string[], tag: string): void;
  assign(actor: Actor, ids: readonly string[], assignee: string): void;
  create(actor: Actor, name: string, phone: string): Conversation;
  incoming(actor: Actor, id: string): void;
  incomingBatch(actor: Actor, id: string, count: number): void;
  setPreview(actor: Actor, id: string, text: string): void;
  updateContact(
    actor: Actor,
    id: string,
    patch: Partial<
      Pick<Conversation, "stage" | "tags" | "ai" | "assigned" | "lossReason">
    >,
  ): void;
}
export class DemoConversationRepository implements ConversationRepository {
  private data: readonly Conversation[];
  private sequence = 0;
  private stageNames = new Set<string>(stages);
  private stageSequence = stages.length;
  private readonly stageEpoch = `${Date.now().toString(36)}-${(++catalogEpoch).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  private catalogListeners = new Set<() => void>();
  private stageColors = new Map<string, string>(
    stages.map((s, i) => [s, stagePalette[i]!]),
  );
  stageColor = (name: string) => this.stageColors.get(name) ?? stagePalette[0];
  subscribeCatalog = (f: () => void) => {
    this.catalogListeners.add(f);
    return () => {
      this.catalogListeners.delete(f);
    };
  };
  private catalogChanged() {
    this.catalogListeners.forEach((f) => {
      try {
        f();
      } catch {
        /* Observer failure cannot interrupt catalog changes. */
      }
    });
  }
  setStageColor(actor: Actor, name: string, color: string) {
    actor = this.team?.actor(actor.id) ?? actor;
    if (
      actor.role === "advisor" ||
      !this.stageNames.has(name) ||
      !(stagePalette as readonly string[]).includes(color)
    )
      throw Error("Color de etapa no válido.");
    this.stageColors.set(name, color);
    this.catalogChanged();
  }
  private stageIds = new Map<string, string>(
    stages.map((s, i) => [s, `demo-stage-${i + 1}`]),
  );
  stageIdentity = (name: string) => this.stageIds.get(name) ?? null;
  stageOptions = () => [...this.stageNames];
  configureStages(actor: Actor, names: readonly string[]) {
    actor = this.team?.actor(actor.id) ?? actor;
    if (
      actor.role === "advisor" ||
      names.length < 1 ||
      names.length > 30 ||
      names.some((n) => !n.trim() || n.length > 60)
    )
      throw new Error("No se pueden configurar etapas.");
    this.stageIds = new Map(
      names.map((name) => [
        name,
        this.stageIds.get(name) ??
          `demo-stage-local-${this.stageEpoch}-${++this.stageSequence}`,
      ]),
    );
    this.stageColors = new Map(
      names.map((name) => [name, this.stageColor(name)]),
    );
    this.stageNames = new Set(names);
    this.catalogChanged();
  }
  editIdentity(actor: Actor, id: string, name: string, phone: string) {
    this.get(actor, id);
    if (
      !name.trim() ||
      name.length > 120 ||
      !/^\+?[0-9 ()-]{10,20}$/.test(phone) ||
      phone.replace(/\D/g, "").length < 10
    )
      throw new Error("Escribe nombre y teléfono completo con lada.");
    if (
      this.data.some(
        (c) => c.id !== id && normalize(c.phone) === normalize(phone),
      )
    )
      throw new Error("Ya existe otro contacto con ese teléfono.");
    this.update(actor, [id], (c) => {
      const next = { ...c, name: name.trim(), phone };
      return { ...next, search: searchable(next) };
    });
  }
  constructor(
    data = seedConversations(),
    readonly catalog = new CatalogStore({ id: "demo-owner", role: "owner" }),
    readonly team?: TeamRepository,
  ) {
    this.data = data.map((c) =>
      c.source
        ? c
        : {
            ...c,
            source: c.tags.includes("Facebook Ads")
              ? "Facebook Ads"
              : "Orgánico",
          },
    );
    let previous = catalog.snapshot().doc;
    const apply = () => {
      if (!catalog.snapshot().ready) return;
      const current = catalog.snapshot().doc;
      this.data = this.data.map((c) => {
        const next = catalog.normalizeTags(c.tags);
        const colorsChanged = c.tags.some(
          (name) =>
            previous.tags.find((t) => t.name === name)?.color !==
            catalog.tag(name)?.color,
        );
        if (JSON.stringify(next) === JSON.stringify(c.tags) && !colorsChanged)
          return c;
        return { ...c, tags: next, search: searchable({ ...c, tags: next }) };
      });
      previous = current;
      this.catalogChanged();
    };
    catalog.subscribe(() => {
      if (catalog.snapshot().doc !== previous) apply();
    });
    if (catalog.snapshot().ready) apply();
  }
  list(actor: Actor) {
    actor = this.team?.actor(actor.id) ?? actor;
    return this.data.filter((c) => allowed(actor, c));
  }
  get(actor: Actor, id: string) {
    actor = this.team?.actor(actor.id) ?? actor;
    const c = this.data.find((c) => c.id === id);
    if (!c || !allowed(actor, c))
      throw new Error("Conversación no disponible para tu perfil.");
    return c;
  }
  private update(
    actor: Actor,
    ids: readonly string[],
    patch: (c: Conversation) => Conversation,
  ) {
    const set = new Set(ids);
    for (const id of set) this.get(actor, id);
    this.data = this.data.map((c) => {
      if (!set.has(c.id)) return c;
      const next = patch(c);
      return next.optedOut ? { ...next, ai: "off" } : next;
    });
  }
  tagMany(actor: Actor, ids: readonly string[], tag: string) {
    actor = this.team?.actor(actor.id) ?? actor;
    if (
      !this.catalog.snapshot().ready ||
      actor.role !== "owner" ||
      !this.catalog.tag("Seguimiento") ||
      tag !== this.catalog.tag("Seguimiento")?.name ||
      !ids.length ||
      ids.length > 12
    )
      throw Error("No se puede aplicar esta propuesta ficticia.");
    for (const id of ids) {
      const c = this.get(actor, id);
      if (c.archived || c.group || c.campaign)
        throw Error(
          "El alcance de la propuesta cambió. Revisa sus contactos antes de aplicar.",
        );
    }
    this.update(actor, ids, (c) => {
      const next = [...new Set([...c.tags, tag])];
      return { ...c, tags: next, search: searchable({ ...c, tags: next }) };
    });
  }
  archive(actor: Actor, ids: readonly string[]) {
    this.update(actor, ids, (c) => ({ ...c, archived: !c.archived }));
  }
  assign(actor: Actor, ids: readonly string[], assignee: string) {
    actor = this.team?.actor(actor.id) ?? actor;
    if (actor.role === "advisor")
      throw new Error("Tu perfil no puede asignar conversaciones.");
    if (
      !(this.team
        ? this.team.available(assignee)
        : ["demo-owner", "demo-coordinator", "demo-advisor"].includes(assignee))
    )
      throw new Error("Elige una persona del equipo de prueba.");
    this.update(actor, ids, (c) => ({ ...c, assigned: assignee }));
  }
  create(actor: Actor, name: string, phone: string) {
    if (!name.trim()) throw new Error("Escribe un nombre.");
    if (
      !/^\+?[0-9 ()-]{10,20}$/.test(phone) ||
      phone.replace(/\D/g, "").length < 10
    )
      throw new Error("Escribe un número completo con lada.");
    const existing = this.data.find(
      (c) => normalize(c.phone) === normalize(phone),
    );
    if (existing) return this.get(actor, existing.id);
    const c: Conversation = {
      id: `demo-new-${++this.sequence}`,
      name: name.trim(),
      phone,
      preview: "Sin mensajes · inicia con plantilla",
      source: "Orgánico",
      time: "Ahora",
      unread: 0,
      stage: "Nuevo",
      tags: [],
      assigned: actor.id,
      ai: "off",
      archived: false,
      campaign: null,
      group: false,
      closed: true,
      search: "",
    };
    const result = { ...c, search: searchable(c) };
    this.data = [result, ...this.data];
    return result;
  }
  /** Atomic projection of validated demo import metadata; never copies messages. */
  importFictitiousBatch(
    actor: Actor,
    rows: readonly {
      id: string;
      name: string;
      phone: string;
      creator: string;
      updateName: boolean;
    }[],
  ) {
    actor = this.team?.actor(actor.id) ?? actor;
    if (actor.role === "advisor") throw Error("Tu rol no importa bases.");
    const copy = [...this.data],
      byId = new Map(copy.map((c, i) => [c.id, i])),
      byPhone = new Map(copy.map((c) => [c.phone.replace(/\D/g, ""), c]));
    for (const r of rows) {
      if (
        !/^demo-(conv|new)-\d+$/.test(r.id) ||
        !/^\+1555010\d{4}$/.test(r.phone) ||
        !r.name.trim() ||
        r.name.length > 80 ||
        !(this.team
          ? this.team.known(r.creator)
          : ["demo-owner", "demo-coordinator", "demo-advisor"].includes(
              r.creator,
            ))
      )
        throw Error("Contacto ficticio no válido.");
      const index = byId.get(r.id),
        old = index === undefined ? undefined : copy[index],
        phone = byPhone.get(r.phone.replace(/\D/g, ""));
      if (
        (old && old.phone.replace(/\D/g, "") !== r.phone.replace(/\D/g, "")) ||
        (phone && phone.id !== r.id)
      )
        throw Error("La identidad del contacto cambió.");
      if (old) {
        if (r.updateName) {
          const next = { ...old, name: r.name };
          const updated = { ...next, search: searchable(next) };
          copy[index!] = updated;
          byPhone.set(r.phone.replace(/\D/g, ""), updated);
        }
        continue;
      }
      const next: Conversation = {
        id: r.id,
        name: r.name,
        phone: r.phone,
        preview: "Sin mensajes · contacto importado ficticio",
        source: "Orgánico",
        time: "Ahora",
        unread: 0,
        stage: "Nuevo",
        tags: [],
        assigned:
          !this.team || this.team.available(r.creator) ? r.creator : null,
        ai: "off",
        archived: false,
        campaign: null,
        group: false,
        closed: true,
        search: "",
      };
      const added = { ...next, search: searchable(next) };
      byId.set(added.id, copy.length);
      byPhone.set(r.phone.replace(/\D/g, ""), added);
      copy.push(added);
    }
    this.data = copy;
  }
  /** Stable identity for an explicitly transferred fictitious personal contact. */
  createPersonal(actor: Actor, name: string, phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (!/^1555010[0-9]{4}$/.test(digits))
      throw Error("Solo números personales ficticios.");
    const prior = this.data.find((c) => c.phone.replace(/\D/g, "") === digits);
    if (prior) return this.get(actor, prior.id);
    const c = this.create(actor, name, phone);
    const code = Array.from(actor.id + ":" + phone.replace(/\D/g, ""))
      .map((ch) => ch.charCodeAt(0).toString().padStart(3, "0"))
      .join("");
    const stable = { ...c, id: `demo-new-9${code}` };
    this.data = this.data.map((x) => (x.id === c.id ? stable : x));
    return stable;
  }
  restoreOptOut(actor: Actor, ids: readonly string[]) {
    for (const id of ids) {
      try {
        this.update(actor, [id], (c) => ({ ...c, optedOut: true, ai: "off" }));
      } catch {
        /* Inaccessible or deleted contacts stay inaccessible. */
      }
    }
  }
  markOptOut(actor: Actor, id: string) {
    if (actor.role === "advisor")
      throw Error("Sin permiso para simular bajas.");
    this.update(actor, [id], (c) => ({ ...c, optedOut: true, ai: "off" }));
  }
  updateContact(
    actor: Actor,
    id: string,
    patch: Partial<
      Pick<Conversation, "stage" | "tags" | "ai" | "assigned" | "lossReason">
    >,
  ) {
    this.get(actor, id);
    if (
      patch.assigned !== undefined &&
      actor.role === "advisor" &&
      patch.assigned !== actor.id
    )
      throw new Error("Tu perfil no puede asignar conversaciones.");
    if (
      patch.assigned !== undefined &&
      patch.assigned !== null &&
      !(this.team
        ? this.team.available(patch.assigned)
        : ["demo-owner", "demo-coordinator", "demo-advisor"].includes(
            patch.assigned,
          ))
    )
      throw new Error("Elige una persona activa del equipo.");
    if (patch.stage !== undefined && !this.stageNames.has(patch.stage))
      throw new Error("Etapa no válida.");
    if (patch.ai !== undefined && !["on", "pause", "off"].includes(patch.ai))
      throw new Error("Estado de IA no válido.");
    if (patch.tags && !this.catalog.snapshot().ready)
      throw Error("Recupera el catálogo antes de etiquetar.");
    if (
      patch.tags &&
      (patch.tags.length > 30 ||
        patch.tags.some((t) => this.catalog.tag(t)?.name !== t))
    )
      throw Error("Etiqueta no válida.");
    if (patch.lossReason && !this.catalog.knownReason(patch.lossReason))
      throw Error("Motivo de pérdida no válido.");
    this.update(actor, [id], (c) => {
      const next = { ...c, ...patch };
      return { ...next, search: searchable(next) };
    });
  }
  setPreview(actor: Actor, id: string, text: string) {
    this.update(actor, [id], (c) => {
      const next = {
        ...c,
        preview: text.slice(0, 160),
        unread: 0,
        time: "Ahora",
      };
      return { ...next, search: searchable(next) };
    });
  }
  incoming(actor: Actor, id: string) {
    this.incomingBatch(actor, id, 1);
  }
  incomingBatch(actor: Actor, id: string, count: number) {
    if (!Number.isSafeInteger(count) || count < 1 || count > 2000)
      throw Error("Cantidad ficticia no válida.");
    this.update(actor, [id], (c) => {
      const next = {
        ...c,
        campaign: null,
        unread: c.unread + count,
        preview: "Mensaje entrante de prueba",
        time: "Ahora",
      };
      return { ...next, search: searchable(next) };
    });
  }
}
