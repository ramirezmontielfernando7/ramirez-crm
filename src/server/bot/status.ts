import {
  BRAIN_MODES,
  type BrainHealthDto,
  type BrainMode,
  type BrainRelayDto,
  type BrainStatusDto,
  type BrainWarning,
} from "@/lib/brain-status";

/**
 * «Quién responde a tus clientes»: qué cerebro contesta los WhatsApp de la
 * instancia y si hay dos contestando a la vez.
 *
 * El agente incluido solo contesta con token de IA Y el interruptor del
 * Agente encendido. Un cerebro externo (Nea) no mira ese interruptor —ni le
 * llega: `/api/bot/profile` no lo manda—, así que con los dos activos el
 * cliente recibe dos respuestas distintas. El CRM no sabe de Nea más que dos
 * cosas: cuándo llamó por última vez a `/api/bot/*` y, si se configuró
 * `BRAIN_HEALTH_URL`, qué dice su `/health`.
 */

/** Una llamada a `/api/bot/*` en esta ventana cuenta como «está contestando». */
export const EXTERNAL_SEEN_WINDOW_MS = 24 * 60 * 60 * 1000;
/** El `/health` se pregunta desde el servidor y no puede colgar la tarjeta. */
export const BRAIN_HEALTH_TIMEOUT_MS = 2000;
/** Cuánto se reutiliza una respuesta: la tarjeta se refresca sola y el panel
 *  de contacto la pide con cada evento de la bandeja. */
export const BRAIN_HEALTH_TTL_MS = 15_000;
/** Un `/health` son unos cientos de bytes; más que esto no es un `/health`. */
const MAX_HEALTH_BYTES = 64 * 1024;

type HealthCacheEntry = {
  url: string;
  expiresAt: number;
  pending: Promise<BrainHealthDto>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y la última llamada la anota `requireBotKey`, en otra ruta.
const globalForBrain = globalThis as unknown as {
  /** Fase 1 multitenant (H2): última llamada del cerebro, POR organización. */
  __voceroBotLastSeen?: Map<string, number>;
  __voceroBrainHealth?: HealthCacheEntry;
};

/** La anota `requireBotKey` en cada llamada autenticada, con la organización
 *  de la llave. Solo memoria: se pierde al reiniciar, y la UI lo dice
 *  («desde el último arranque»). */
export function markBotSeen(organizationId: string, now: number = Date.now()): void {
  (globalForBrain.__voceroBotLastSeen ??= new Map()).set(organizationId, now);
}

export function botLastSeenAt(organizationId: string): Date | null {
  const t = globalForBrain.__voceroBotLastSeen?.get(organizationId);
  return typeof t === "number" ? new Date(t) : null;
}

/** Solo para tests. */
export function resetBrainStatusState(): void {
  delete globalForBrain.__voceroBotLastSeen;
  delete globalForBrain.__voceroBrainHealth;
}

// ---------------------------------------------------------------------------
// El cálculo (puro)
// ---------------------------------------------------------------------------

export type BrainStatusInput = {
  aiConfigured: boolean;
  agentEnabled: boolean;
  botKeyConfigured: boolean;
  lastSeenAt: Date | null;
  health: BrainHealthDto | null;
  now: Date;
};

export function computeBrainStatus(input: BrainStatusInput): BrainStatusDto {
  const answering = input.aiConfigured && input.agentEnabled;
  const seenRecently =
    input.botKeyConfigured &&
    input.lastSeenAt !== null &&
    input.now.getTime() - input.lastSeenAt.getTime() <= EXTERNAL_SEEN_WINDOW_MS;
  const active = seenRecently || input.health?.reachable === true;

  let warning: BrainWarning | null = null;
  if (answering && active) warning = "doble_respuesta";
  // Nadie puede contestar: sin agente incluido y con /api/bot/* cerrada (sin
  // llave, un Nea en línea tampoco puede hablar por el CRM).
  else if (!answering && !input.botKeyConfigured) warning = "sin_cerebro";

  return {
    embedded: {
      configured: input.aiConfigured,
      enabled: input.agentEnabled,
      answering,
    },
    external: {
      keyConfigured: input.botKeyConfigured,
      lastSeenAt: input.lastSeenAt?.toISOString() ?? null,
      active,
      health: input.health,
    },
    warning,
  };
}

// ---------------------------------------------------------------------------
// El /health del cerebro externo
// ---------------------------------------------------------------------------

export type FetchBrainHealthOptions = {
  timeoutMs?: number;
  /** Solo para tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

/**
 * Pregunta al `/health` del cerebro externo. Nunca lanza: cualquier fallo es
 * `reachable: false` con su motivo, en 2 s como mucho. Una URL que no es
 * http(s) ni se intenta: `problem: "config"`.
 *
 * - No sigue redirecciones: el `/health` de un servicio interno no redirige,
 *   y seguirla sería pedirle al servidor que llame a donde diga otro.
 * - Las credenciales de la URL (`http://user:pass@nea:8000/health`) viajan
 *   como `Authorization: Basic` —fetch rechaza una URL que las trae— y, como
 *   la ruta y la query, jamás salen en la respuesta: solo el host.
 * - Tolera cualquier subconjunto de campos (una Nea vieja solo manda
 *   `status`): el mínimo es 200 con `ok: true` o `status: "ok"`.
 */
export async function fetchBrainHealth(
  rawUrl: string,
  opts: FetchBrainHealthOptions = {}
): Promise<BrainHealthDto> {
  const checkedAt = (opts.now?.() ?? new Date()).toISOString();
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { reachable: false, host: "", checkedAt, problem: "config" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { reachable: false, host: "", checkedAt, problem: "config" };
  }
  const base = { host: target.host, checkedAt };

  const headers: Record<string, string> = { accept: "application/json" };
  if (target.username || target.password) {
    const user = decodeURIComponent(target.username);
    const pass = decodeURIComponent(target.password);
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    target.username = "";
    target.password = "";
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? BRAIN_HEALTH_TIMEOUT_MS
  );
  try {
    const res = await (opts.fetchImpl ?? fetch)(target, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    // Node devuelve el 3xx tal cual; un navegador, un `opaqueredirect`.
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => {});
      return {
        ...base,
        reachable: false,
        problem: "redirect",
        ...(res.status ? { httpStatus: res.status } : {}),
      };
    }
    const body = parseJsonObject(await readCapped(res, MAX_HEALTH_BYTES));
    // La identidad sale aunque no esté sana: Nea la manda también en su 503.
    const identity = body ? parseIdentity(body) : {};
    if (res.status !== 200) {
      return { ...base, ...identity, reachable: false, problem: "status", httpStatus: res.status };
    }
    if (!body || !(body.ok === true || body.status === "ok")) {
      return { ...base, ...identity, reachable: false, problem: "invalid" };
    }
    return { ...base, ...identity, reachable: true };
  } catch {
    return {
      ...base,
      reachable: false,
      problem: controller.signal.aborted ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `fetchBrainHealth` con caché de 15 s por URL, compartida entre llamadas
 * simultáneas: la tarjeta y el panel de contacto no martillan a Nea.
 * `null` si no hay URL configurada.
 */
export async function getBrainHealth(
  rawUrl: string | undefined,
  opts: FetchBrainHealthOptions & { ttlMs?: number; clock?: () => number } = {}
): Promise<BrainHealthDto | null> {
  if (!rawUrl) return null;
  const clock = opts.clock ?? Date.now;
  const cached = globalForBrain.__voceroBrainHealth;
  if (cached && cached.url === rawUrl && clock() < cached.expiresAt) {
    return cached.pending;
  }
  const entry: HealthCacheEntry = {
    url: rawUrl,
    // En vuelo no caduca: quien llegue mientras tanto espera la misma.
    expiresAt: Number.POSITIVE_INFINITY,
    pending: fetchBrainHealth(rawUrl, opts),
  };
  globalForBrain.__voceroBrainHealth = entry;
  const result = await entry.pending;
  entry.expiresAt = clock() + (opts.ttlMs ?? BRAIN_HEALTH_TTL_MS);
  return result;
}

// ---------------------------------------------------------------------------
// Lectura defensiva
// ---------------------------------------------------------------------------

/** El cuerpo como texto, o `null` si excede el tope. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

type Identity = Pick<
  BrainHealthDto,
  "version" | "commit" | "commitVerified" | "mode" | "relay"
>;

function parseIdentity(body: Record<string, unknown>): Identity {
  const out: Identity = {};
  const version = shortText(body.version, 40);
  if (version) out.version = version;
  if (typeof body.commit === "string" && /^[0-9a-f]{4,40}$/i.test(body.commit)) {
    out.commit = body.commit;
  }
  if (typeof body.commitVerified === "boolean") {
    out.commitVerified = body.commitVerified;
  }
  const mode = parseMode(body.mode);
  if (mode) out.mode = mode;
  const relay = parseRelay(body.relay);
  if (relay) out.relay = relay;
  return out;
}

function shortText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return undefined;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 32 || c === 127) return undefined; // caracteres de control
  }
  return t;
}

function parseMode(v: unknown): BrainMode | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().toLowerCase().normalize("NFC");
  const normalized = m === "estandar" ? "estándar" : m;
  return (BRAIN_MODES as readonly string[]).includes(normalized)
    ? (normalized as BrainMode)
    : undefined;
}

function parseRelay(v: unknown): BrainRelayDto | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const pendientes = nonNegative(r.pendientes, true);
  const masViejoSegundos = nonNegative(r.masViejoSegundos, false);
  const ultimoErrorEn = isoOrNull(r.ultimoErrorEn);
  if (pendientes === null && masViejoSegundos === null && ultimoErrorEn === null) {
    return undefined;
  }
  return { pendientes, masViejoSegundos, ultimoErrorEn };
}

function nonNegative(v: unknown, integer: boolean): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return integer ? Math.floor(v) : v;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
