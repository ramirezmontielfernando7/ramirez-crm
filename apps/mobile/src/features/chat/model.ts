import type {
  Actor,
  Conversation,
  ConversationRepository,
} from "../inbox/model";
import { CHAT_TEXT_MAX, splitForMeta } from "./message-length";
import { checkOutgoing, MB } from "./upload-limits";
export { CHAT_TEXT_MAX, MB };
export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const windowOpen = (lastIncoming: number, now: number) =>
  lastIncoming <= now && now - lastIncoming < WINDOW_MS;
export type Delivery = "pending" | "sent" | "delivered" | "read" | "failed";
export type Sender = "in" | "team" | "ai" | "connected" | "note" | "system";
export type Attachment = Readonly<{
  id: string;
  name: string;
  mime: string;
  bytes: number;
  kind: "image" | "video" | "document" | "contact" | "location";
  readable: boolean;
}>;
export type Message = Readonly<{
  id: string;
  conversationId: string;
  sender: Sender;
  text: string;
  time: number;
  status: Delivery;
  failure?: string;
  attachment?: Attachment;
  templateId?: string;
  parts: readonly string[];
}>;
export const deliveryLabels: Record<Delivery, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};
export const samples: readonly Attachment[] = [
  {
    id: "image",
    name: "Imagen de muestra.png",
    mime: "image/png",
    bytes: 640 * 1024,
    kind: "image",
    readable: true,
  },
  {
    id: "video",
    name: "Video de muestra.mp4",
    mime: "video/mp4",
    bytes: 2 * MB,
    kind: "video",
    readable: true,
  },
  {
    id: "document",
    name: "Catálogo mayoreo 2026.pdf",
    mime: "application/pdf",
    bytes: Math.round(2.4 * MB),
    kind: "document",
    readable: true,
  },
  {
    id: "contact",
    name: "Contacto ficticio.vcf",
    mime: "text/vcard",
    bytes: 1024,
    kind: "contact",
    readable: true,
  },
  {
    id: "location",
    name: "Ubicación de muestra",
    mime: "text/plain",
    bytes: 100,
    kind: "location",
    readable: true,
  },
  {
    id: "large",
    name: "Foto demasiado grande.png",
    mime: "image/png",
    bytes: 6 * MB,
    kind: "image",
    readable: true,
  },
  {
    id: "broken",
    name: "Imagen por recuperar.png",
    mime: "image/png",
    bytes: 640 * 1024,
    kind: "image",
    readable: false,
  },
];
export function validateAttachment(a: Attachment) {
  if (!a.readable)
    throw new Error("No se pudo leer la muestra. Vuelve a cargarla.");
  const result = checkOutgoing(a.mime, a.bytes, a.name);
  if (!Number.isFinite(a.bytes) || a.bytes < 0)
    throw new Error("Tamaño de archivo no válido.");
  if (!result.ok) throw new Error(result.message);
  if (["image", "video", "document"].includes(a.kind) && result.kind !== a.kind)
    throw new Error("El tipo de archivo no coincide con la muestra.");
}
export const templates = [
  {
    id: "recordatorio_cita",
    name: "recordatorio_cita",
    approved: true,
    body: "Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}}.",
  },
  {
    id: "promo_2x1",
    name: "promo_2x1",
    approved: true,
    body: "Hola {{1}}, este mes tenemos 2×1 en tu plan favorito. Responde SÍ y te apartamos el lugar.",
  },
  {
    id: "te_extrañamos",
    name: "te_extrañamos · En revisión",
    approved: false,
    body: "Hola {{1}}, hace tiempo no te vemos.",
  },
] as const;
export function fillTemplate(id: string, values: readonly string[]) {
  const t = templates.find((t) => t.id === id);
  if (!t?.approved)
    throw new Error("Solo puedes enviar una plantilla aprobada.");
  return t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const v = values[Number(n) - 1]?.trim();
    if (!v || v.length > 200 || /\{[{}]|\}\}/.test(v))
      throw new Error("Completa todas las variables de la plantilla.");
    return v;
  });
}
export const quickReplies = [
  {
    shortcut: "hola",
    body: "¡Hola {nombre}! Gracias por escribirnos. ¿En qué te puedo ayudar?",
  },
  {
    shortcut: "precio",
    body: "Con gusto te comparto la lista de precios. ¿Para cuántas personas la necesitas?",
  },
  {
    shortcut: "horario",
    body: "Atendemos de lunes a viernes de 9:00 a 19:00 y sábados de 10:00 a 14:00.",
  },
  { shortcut: "gracias", body: "¡Gracias a ti! Quedo al pendiente." },
];
export const library = [
  {
    id: "catalog",
    name: "Catálogo mayoreo 2026.pdf",
    chat: true,
    attachment: samples[2],
  },
  {
    id: "policy",
    name: "Política de envíos",
    chat: true,
    text: "Envíos de demostración: entrega de 3 a 5 días hábiles.",
  },
  {
    id: "prices",
    name: "Lista de precios noviembre",
    chat: true,
    attachment: samples[0],
  },
  {
    id: "faq",
    name: "Preguntas frecuentes · Lectura IA",
    chat: false,
    text: "Material exclusivo de lectura IA.",
  },
];
export function libraryEntry(id: string) {
  const entry = library.find((x) => x.id === id && x.chat);
  if (!entry)
    throw new Error("Este material no está disponible para envío en chat.");
  return entry;
}
export interface HistoryPage {
  messages: readonly Message[];
  before: number;
  hasMore: boolean;
}
export interface HistoryRepository {
  page(
    actor: Actor,
    id: string,
    before: number | undefined,
    limit?: number,
  ): HistoryPage;
}
const tail = [
  ["in", "Hola, vi su anuncio. ¿Cuánto cuesta el plan para 3 personas?"],
  [
    "ai",
    "¡Hola Karla! El plan Pro para 3 personas cuesta $899 al mes. ¿Te gustaría que te mande la cotización?",
  ],
  ["in", "Sí, por favor 🙌"],
  ["system", "— La IA pasó el chat a Ana López —"],
  [
    "team",
    "Claro Karla, te la mando en un momento. ¿A nombre de quién la hago?",
  ],
  ["in", "A nombre de Grupo Méndez"],
  ["in", "Perfecto, ¿me mandas la cotización?"],
] as const;
export class DemoHistoryRepository implements HistoryRepository {
  readonly total = 1000;
  private epochs = new Map<string, number>();
  constructor(
    private conversations: ConversationRepository,
    private now: () => number = Date.now,
  ) {}
  page(actor: Actor, id: string, before = this.total, limit = 20): HistoryPage {
    const conversation = this.conversations.get(actor, id);
    if (
      !Number.isInteger(before) ||
      before < 0 ||
      before > this.total ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Página de historial no válida.");
    const latestAt =
      this.epochs.get(id) ??
      this.now() - (conversation.closed ? 25 * 3600_000 : 0);
    this.epochs.set(id, latestAt);
    const start = Math.max(0, before - limit);
    const messages = Array.from({ length: before - start }, (_, j) =>
      this.seed(id, start + j, latestAt),
    );
    return { messages, before: start, hasMore: start > 0 };
  }
  private seed(id: string, i: number, latestAt: number): Message {
    const t = id === "demo-conv-1" && i >= 993 ? tail[i - 993] : null;
    const sender: Sender = t
      ? t[0]
      : i % 11 === 0
        ? "connected"
        : i % 7 === 0
          ? "ai"
          : i % 13 === 0
            ? "note"
            : i % 2
              ? "in"
              : "team";
    const attachment =
      id === "demo-conv-4" && i === 998 ? samples[0] : undefined;
    const failed = id === "demo-conv-12" && i === 999;
    return {
      id: `${id}:seed:${i}`,
      conversationId: id,
      sender: failed ? "team" : sender,
      text: failed
        ? "Te confirmo tu cita del martes"
        : t
          ? t[1]
          : attachment
            ? "Imagen de muestra"
            : `Mensaje histórico ficticio ${i + 1}`,
      time: latestAt - (this.total - i) * 60_000,
      status: failed ? "failed" : "read",
      failure: failed
        ? "La ventana de 24 horas está cerrada. Envía una plantilla aprobada."
        : undefined,
      parts: [],
      attachment,
    };
  }
}
export interface MessageTransport {
  send(message: Message, report: (status: Delivery) => void): Promise<void>;
}
export class DemoTransport implements MessageTransport {
  online = true;
  nextFailure: "none" | "before" | "ack" = "none";
  readonly accepted = new Set<string>();
  constructor(
    private wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  async send(m: Message, report: (status: Delivery) => void) {
    if (!this.online)
      throw new Error("Sin conexión. Reintenta cuando vuelvas a conectarte.");
    const failure = this.nextFailure;
    this.nextFailure = "none";
    await this.wait(80);
    if (!this.online)
      throw new Error("Sin conexión. Reintenta cuando vuelvas a conectarte.");
    if (failure === "before")
      throw new Error("El envío de prueba falló. Puedes reintentar.");
    for (let i = 0; i < m.parts.length; i++) {
      this.accepted.add(`${m.id}:part:${i}`);
      if (failure === "ack" && i === 0)
        throw new Error(
          "No llegó la confirmación. Reintentar comprueba el mismo envío.",
        );
    }
    report("sent");
    await this.wait(80);
    report("delivered");
    await this.wait(80);
    report("read");
  }
}
export const textParts = (text: string) => {
  if (!text.trim() || text.length > CHAT_TEXT_MAX)
    throw new Error(`Escribe un mensaje de hasta ${CHAT_TEXT_MAX} caracteres.`);
  return splitForMeta(text);
};
