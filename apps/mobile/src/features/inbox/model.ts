import type { Role } from "../../domain/access";
export const stages = [
  "Nuevo",
  "En conversación",
  "Interesado",
  "Cliente",
  "Perdido",
] as const;
export const tags = [
  "Promo nov",
  "Mayoreo",
  "Facebook Ads",
  "VIP",
  "Urgente",
  "Seguimiento",
  "Referido",
] as const;
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
  list(actor: Actor): readonly Conversation[];
  get(actor: Actor, id: string): Conversation;
  archive(actor: Actor, ids: readonly string[]): void;
  assign(actor: Actor, ids: readonly string[], assignee: string): void;
  create(actor: Actor, name: string, phone: string): Conversation;
  incoming(actor: Actor, id: string): void;
  setPreview(actor: Actor, id: string, text: string): void;
  updateContact(
    actor: Actor,
    id: string,
    patch: Partial<Pick<Conversation, "stage" | "tags" | "ai" | "assigned">>,
  ): void;
}
export class DemoConversationRepository implements ConversationRepository {
  private data: readonly Conversation[];
  private sequence = 0;
  constructor(data = seedConversations()) {
    this.data = data;
  }
  list(actor: Actor) {
    return this.data.filter((c) => allowed(actor, c));
  }
  get(actor: Actor, id: string) {
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
    this.data = this.data.map((c) => (set.has(c.id) ? patch(c) : c));
  }
  archive(actor: Actor, ids: readonly string[]) {
    this.update(actor, ids, (c) => ({ ...c, archived: !c.archived }));
  }
  assign(actor: Actor, ids: readonly string[], assignee: string) {
    if (actor.role === "advisor")
      throw new Error("Tu perfil no puede asignar conversaciones.");
    if (!["demo-owner", "demo-coordinator", "demo-advisor"].includes(assignee))
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
  updateContact(
    actor: Actor,
    id: string,
    patch: Partial<Pick<Conversation, "stage" | "tags" | "ai" | "assigned">>,
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
      !["demo-owner", "demo-coordinator", "demo-advisor"].includes(
        patch.assigned,
      )
    )
      throw new Error("Elige una persona activa del equipo.");
    if (
      patch.stage !== undefined &&
      !(stages as readonly string[]).includes(patch.stage)
    )
      throw new Error("Etapa no válida.");
    if (patch.ai !== undefined && !["on", "pause", "off"].includes(patch.ai))
      throw new Error("Estado de IA no válido.");
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
    this.update(actor, [id], (c) => {
      const next = {
        ...c,
        campaign: null,
        unread: c.unread + 1,
        preview: "Mensaje entrante de prueba",
        time: "Ahora",
      };
      return { ...next, search: searchable(next) };
    });
  }
}
