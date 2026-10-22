import { logger } from "@/lib/log";

const log = logger("direct-connection");

/**
 * Conexión directa (PR 2) — Cliente del servidor del dispositivo vinculado
 * (Evolution API v2). Solo Dashfort habla con él: la organización nunca ve su
 * dirección ni su llave. Cada llamada usa la llave maestra del servidor
 * (cabecera `apikey`), tiene tope de tiempo y NUNCA registra la llave ni el
 * cuerpo de la respuesta (puede traer el QR).
 */

const TIMEOUT_MS = 10_000;

export type EvolutionServerRef = { baseUrl: string; apiKey: string };

export type EvolutionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: "unreachable" | "rejected" | "not_found" | "conflict" | "bad_response" };

async function call(
  server: EvolutionServerRef,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<EvolutionResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { apikey: server.apiKey, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    log.warn("el servidor del dispositivo vinculado no respondió", { path: path.split("?")[0], err: (err as Error).name });
    return { ok: false, status: 0, error: "unreachable" };
  }
  if (res.status === 404) return { ok: false, status: 404, error: "not_found" };
  // Evolution contesta 403 cuando el nombre de la instancia ya existe.
  if (res.status === 409 || res.status === 403) return { ok: false, status: res.status, error: res.status === 409 ? "conflict" : "rejected" };
  if (!res.ok) return { ok: false, status: res.status, error: res.status >= 500 ? "unreachable" : "rejected" };
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, status: res.status, error: "bad_response" };
  }
}

export type InstanceState = "open" | "close" | "connecting";

export function parseState(raw: unknown): InstanceState | null {
  const state = (raw as { instance?: { state?: unknown }; state?: unknown } | null);
  const value = state?.instance?.state ?? state?.state;
  return value === "open" || value === "close" || value === "connecting" ? value : null;
}

/** Solo dígitos del número que viene como `5215512345678:12@s.whatsapp.net`. */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string") return null;
  const digits = jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 8 ? digits : null;
}

/** La imagen del QR lista para `<img src>` (Evolution manda base64 con o sin prefijo). */
export function qrImage(base64: unknown): string | null {
  if (typeof base64 !== "string" || base64.length < 20) return null;
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

export type Qr = { image: string | null; pairingCode: string | null };

export function parseQr(raw: unknown): Qr {
  const r = (raw ?? {}) as { base64?: unknown; pairingCode?: unknown; qrcode?: { base64?: unknown; pairingCode?: unknown } };
  const pairing = r.pairingCode ?? r.qrcode?.pairingCode;
  return {
    image: qrImage(r.base64 ?? r.qrcode?.base64),
    pairingCode: typeof pairing === "string" && pairing ? pairing : null,
  };
}

/** Eventos que pide Dashfort al servidor: solo el estado del dispositivo. */
export const WEBHOOK_EVENTS = ["CONNECTION_UPDATE"] as const;

export async function createInstance(server: EvolutionServerRef, input: { instanceName: string; token: string }) {
  return call(server, "POST", "/instance/create", {
    instanceName: input.instanceName,
    token: input.token,
    qrcode: false,
    integration: "WHATSAPP-BAILEYS",
  });
}

export async function setWebhook(server: EvolutionServerRef, instanceName: string, url: string) {
  return call(server, "POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
    webhook: { enabled: true, url, byEvents: false, base64: false, events: [...WEBHOOK_EVENTS] },
  });
}

export async function connectInstance(server: EvolutionServerRef, instanceName: string): Promise<EvolutionResult<Qr>> {
  const r = await call(server, "GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
  return r.ok ? { ok: true, data: parseQr(r.data) } : r;
}

export async function connectionState(server: EvolutionServerRef, instanceName: string): Promise<EvolutionResult<InstanceState>> {
  const r = await call(server, "GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  if (!r.ok) return r;
  const state = parseState(r.data);
  return state ? { ok: true, data: state } : { ok: false, status: 200, error: "bad_response" };
}

/** El número vinculado (para mostrarlo), si el servidor lo dice. */
export async function linkedPhone(server: EvolutionServerRef, instanceName: string): Promise<string | null> {
  const r = await call(server, "GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`);
  if (!r.ok) return null;
  const first = (Array.isArray(r.data) ? r.data[0] : r.data) as { ownerJid?: unknown; owner?: unknown; instance?: { owner?: unknown } } | undefined;
  return phoneFromJid(first?.ownerJid ?? first?.owner ?? first?.instance?.owner);
}

export async function logoutInstance(server: EvolutionServerRef, instanceName: string) {
  return call(server, "DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
}

export async function deleteInstance(server: EvolutionServerRef, instanceName: string) {
  return call(server, "DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
}

/** Prueba de /platform: ¿la dirección responde y la llave sirve? Devuelve cuántas instancias hay. */
export async function pingServer(server: EvolutionServerRef): Promise<EvolutionResult<{ instances: number }>> {
  const r = await call(server, "GET", "/instance/fetchInstances");
  if (!r.ok) return r;
  return { ok: true, data: { instances: Array.isArray(r.data) ? r.data.length : 0 } };
}
