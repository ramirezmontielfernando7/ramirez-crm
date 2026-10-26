/**
 * Conexión directa (PR 1) — reglas puras y textos del complemento oculto.
 *
 * El chat guarda UN solo dato, su modo (`conversation.connection_mode`):
 *
 * - `meta` (Oficial, verde): entra y sale por Meta. Lo de siempre.
 * - `directa` (azul): entra y sale por el dispositivo vinculado.
 * - `mixta` (morado, en pantalla «Conexión híbrida»): entra por Meta y sale
 *   por el dispositivo.
 *
 * Textos discretos: ninguna pantalla dice «no oficial» ni el nombre del
 * servidor; se dice «Conexión directa» y «Dispositivo vinculado». El
 * guardarraíl `tests/unit/conexion-directa.test.ts` lo vigila.
 */

export const CONNECTION_MODES = ["meta", "directa", "mixta"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export type InboundSource = "meta" | "evolution";
export type OutboundTransport = "meta" | "directa";

export function isConnectionMode(value: unknown): value is ConnectionMode {
  return typeof value === "string" && (CONNECTION_MODES as readonly string[]).includes(value);
}

/** El modo que vale para un chat: el suyo, o el de la organización si no tiene. */
export function effectiveMode(chatMode: ConnectionMode | null | undefined, orgDefault: ConnectionMode): ConnectionMode {
  return chatMode ?? orgDefault;
}

/** Por dónde ENTRA lo de un chat en este modo. */
export function inboundSourceOf(mode: ConnectionMode): InboundSource {
  return mode === "directa" ? "evolution" : "meta";
}

/** Por dónde SALE lo que se escribe en un chat en este modo (antes de límites y ventana). */
export function outboundTransportOf(mode: ConnectionMode): OutboundTransport {
  return mode === "meta" ? "meta" : "directa";
}

/** Nombres de pantalla de cada modo (Fer, 26 oct: tres opciones a la vista). */
export const CONNECTION_MODE_LABEL: Record<ConnectionMode, string> = {
  meta: "Meta",
  directa: "Conexión directa",
  mixta: "Conexión híbrida",
};

/** Color del punto en el avatar del chat. */
export const CONNECTION_MODE_COLOR: Record<ConnectionMode, "green" | "blue" | "purple"> = {
  meta: "green",
  directa: "blue",
  mixta: "purple",
};

/** Textos de pantalla y avisos. Discretos: nunca «no oficial». */
export const DIRECT_TEXT = {
  moduleName: "Conexión directa",
  pageIntro: "Tu WhatsApp vinculado como un dispositivo más, igual que WhatsApp Web. Úsalo para conversaciones uno a uno.",
  metaName: "Conexión Meta",
  device: "Dispositivo vinculado",
  linkDevice: "Vincular dispositivo",
  continueDirect: "Continuar por conexión directa",
  outgoingMark: "Directo",
  queued: "En cola",
  disconnected:
    "El dispositivo vinculado se desconectó. Vuelve a vincularlo para seguir enviando por conexión directa.",
  emergencyPause: "Pausamos la conexión directa por 24 h para proteger tu número.",
  metalessNote:
    "Esta empresa usa solo el dispositivo vinculado: todos los chats entran y salen por conexión directa, sin ventana de 24 horas.",
  limitsHint: "Enviar despacio, como una persona, reduce la probabilidad de que WhatsApp desconecte el dispositivo.",
  activationNotice:
    "La conexión directa vincula tu WhatsApp como un dispositivo más, igual que WhatsApp Web. No forma parte de la plataforma de Meta para empresas, así que WhatsApp puede desconectarlo o restringir el número si detecta envíos masivos. Te recomendamos usarla para conversaciones uno a uno.",
} as const;

/** El estado de la conexión de una organización, en palabras de pantalla. */
export const CONNECTION_STATUS_LABEL = {
  pending: "Sin vincular",
  connecting: "Reconectando",
  connected: "Conectado",
  disconnected: "Desconectado",
} as const;
export type DirectConnectionStatus = keyof typeof CONNECTION_STATUS_LABEL;

/* ───────── Configuración avanzada ───────── */

/** Roles a los que el Propietario puede delegar (además de él). */
export const DELEGABLE_ROLES = ["coordinador", "asesor"] as const;
export type DelegableRole = (typeof DELEGABLE_ROLES)[number];

export type DirectSettings = {
  defaultMode: ConnectionMode;
  limitsEnabled: boolean;
  minIntervalSeconds: number;
  perChatPerMinute: number;
  perHour: number;
  preferMetaInWindow: boolean;
  autoReturnToMeta: boolean;
  closedWindowMode: "directa" | "mixta";
  aiViaDirect: boolean;
  modeRoles: DelegableRole[];
  linkRoles: DelegableRole[];
  limitsRoles: DelegableRole[];
  noticeAcceptedBy: string | null;
  noticeAcceptedAt: Date | null;
};

/**
 * Sin fila en `direct_connection_settings`, esto. Son los mismos DEFAULT de
 * la migración 0055 (lo comprueba `tests/db/conexion-directa.test.ts`).
 */
export const DEFAULT_DIRECT_SETTINGS: DirectSettings = {
  defaultMode: "meta",
  limitsEnabled: true,
  minIntervalSeconds: 8,
  perChatPerMinute: 5,
  perHour: 60,
  preferMetaInWindow: true,
  autoReturnToMeta: true,
  closedWindowMode: "mixta",
  aiViaDirect: false,
  modeRoles: ["coordinador"],
  linkRoles: [],
  limitsRoles: [],
  noticeAcceptedBy: null,
  noticeAcceptedAt: null,
};

/** Rangos de los límites de envío (los mismos del CHECK de la 0055). */
export const LIMIT_RANGES = {
  minIntervalSeconds: { min: 0, max: 3600 },
  perChatPerMinute: { min: 1, max: 60 },
  perHour: { min: 1, max: 10_000 },
} as const;

export type SendLimits = Pick<DirectSettings, "minIntervalSeconds" | "perChatPerMinute" | "perHour">;

/** ¿Estos límites caben en sus rangos? Devuelve el primer problema, en palabras. */
export function validateLimits(limits: SendLimits): string | null {
  for (const key of Object.keys(LIMIT_RANGES) as (keyof typeof LIMIT_RANGES)[]) {
    const v = limits[key];
    const { min, max } = LIMIT_RANGES[key];
    if (!Number.isInteger(v) || v < min || v > max) return `${key} debe ir de ${min} a ${max}`;
  }
  return null;
}

/** Solo los roles delegables, sin repetir (lo demás se descarta: falla cerrado). */
export function cleanRoles(roles: readonly string[]): DelegableRole[] {
  return DELEGABLE_ROLES.filter((r) => roles.includes(r));
}

/* ───────── Servidores ───────── */

/**
 * URL base de un servidor: https (o http solo en localhost, para pruebas),
 * sin usuario ni contraseña, sin barra final. Devuelve null si no sirve.
 */
export function normalizeServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Últimos 4 de una llave, para reconocerla sin mostrarla. */
export function last4(secret: string): string {
  return secret.slice(-4);
}

/**
 * El servidor para una empresa nueva: el activo con más lugares libres (si
 * empatan, el primero). Ninguno con lugar = null.
 */
export function pickServer<T extends { id: string; status: string; maxInstances: number; used: number }>(
  servers: readonly T[]
): T | null {
  let best: T | null = null;
  for (const s of servers) {
    if (s.status !== "active" || s.used >= s.maxInstances) continue;
    if (!best || s.maxInstances - s.used > best.maxInstances - best.used) best = s;
  }
  return best;
}

/* ───────── Modo del chat (PR 5) ───────── */

/**
 * Textos del selector del punto de color del avatar y de Ajustes. Discretos.
 * Las tres opciones a la vista (Fer, 26 oct): la híbrida ya no es un
 * interruptor dentro de Directa.
 */
export const MODE_PICKER_TEXT = {
  title: "Conexión del chat",
  meta: { label: CONNECTION_MODE_LABEL.meta, hint: "Recibe y responde por Meta." },
  directa: { label: CONNECTION_MODE_LABEL.directa, hint: "Recibe y responde por el dispositivo vinculado." },
  mixta: { label: CONNECTION_MODE_LABEL.mixta, hint: "Recibe por Meta y responde por el dispositivo vinculado." },
  needsDevice: "Vincula un dispositivo en Ajustes para usar la conexión directa.",
  paused: DIRECT_TEXT.emergencyPause,
  autoReturn: "Si el cliente contesta, el chat vuelve solo a Meta.",
} as const;

/** Nombre de pantalla del punto. */
export function modeDotLabel(mode: ConnectionMode): string {
  return CONNECTION_MODE_LABEL[mode];
}

/** Lo que el servidor le da a la Bandeja cuando el complemento está encendido. */
export type InboxDirectContext = {
  defaultMode: ConnectionMode;
  canChangeMode: boolean;
  /** ¿Hay un dispositivo vinculado y conectado, y no en pausa? Sin eso solo se puede Oficial. */
  deviceReady: boolean;
  paused: boolean;
  /**
   * PR 6: la empresa no tiene conexión de Meta (solo el dispositivo). Todo
   * chat es Directa, sin punto de color, sin selector y sin ventana de 24 h.
   */
  metaless: boolean;
};

/**
 * ¿Se puede escribir texto libre en este chat aunque la ventana de 24 h esté
 * cerrada? Sí cuando sale por el dispositivo: en una empresa sin Meta, o en un
 * chat Directa/Automática con el dispositivo listo. Lo demás, como siempre
 * (plantilla).
 */
export function freeTextOutsideWindow(
  ctx: InboxDirectContext | null | undefined,
  conversation: { channel: string; connectionMode: string | null }
): boolean {
  if (!ctx || conversation.channel !== "whatsapp") return false;
  if (ctx.metaless) return true;
  const mode = effectiveMode(isConnectionMode(conversation.connectionMode) ? conversation.connectionMode : null, ctx.defaultMode);
  return mode !== "meta" && ctx.deviceReady;
}

/** Lo que se ve bajo el compositor cuando la ventana está cerrada y se escribe por el dispositivo. */
export const WINDOW_CLOSED_DIRECT_HINT = "La ventana de 24 horas está cerrada: este mensaje sale por conexión directa.";
