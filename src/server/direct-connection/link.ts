import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import {
  assignServer,
  clearInstance,
  connectionByWebhookHash,
  connectionRefOf,
  connectionsToCheck,
  getConnection,
  openServerKey,
  patchConnection,
  saveInstance,
  saveWebhookTokenHash,
  refOf,
  serverForNewOrganization,
  type ConnectionRef,
  type ConnectionRow,
  type ConnectionTarget,
  type StatusPatch,
} from "@/server/credentials/direct";
import {
  connectInstance,
  connectionState,
  createInstance,
  deleteInstance,
  linkedPhone,
  logoutInstance,
  setWebhook,
  webhookEvents,
  WEBHOOK_EVENTS,
  type EvolutionServerRef,
  type InstanceState,
  type Qr,
} from "./evolution-api";

const log = logger("direct-connection");

/**
 * Conexión directa (PR 2) — Vincular el número de una organización por QR.
 * Dashfort crea y administra la instancia en el servidor que /platform le
 * asignó; la organización solo ve «Dispositivo vinculado» y su estado.
 *
 * Mi número (046): lo mismo sirve para el número de una persona. Cada función
 * recibe la organización (la conexión de la empresa) o un `ConnectionRef` con
 * el número; cada número tiene su propia instancia, webhook y freno.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Dos desconexiones en un día pausan la conexión directa 24 h (freno de emergencia). */
const DISCONNECTS_BEFORE_PAUSE = 2;

export type LinkError = "no_server" | "server_unreachable" | "server_key_unreadable" | "paused" | "failed";

function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `df-<org>` la de la empresa; `df-<org>-<número>` la de un «Mi número». */
export function instanceNameOf(organizationId: string, directNumberId: string | null = null): string {
  const base = `df-${slug(organizationId)}`;
  return (directNumberId ? `${base}-${slug(directNumberId)}` : base).slice(0, 60);
}

function logCtx(ref: ConnectionRef) {
  return ref.directNumberId ? { org: ref.organizationId, number: ref.directNumberId } : { org: ref.organizationId };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Pura: cómo cambia la fila cuando el servidor dice el estado del dispositivo. */
export function patchForState(row: Pick<ConnectionRow, "status" | "disconnectCount" | "disconnectWindowStart" | "pausedUntil">, state: InstanceState, now: Date): StatusPatch | null {
  if (state === "open") {
    return { status: "connected", lastSeenAt: now, ...(row.status === "connected" ? {} : { connectedAt: now }) };
  }
  if (state === "connecting") {
    // Un dispositivo ya vinculado que está reconectando no pierde su estado.
    return row.status === "connected" || row.status === "connecting" ? null : { status: "connecting" };
  }
  // «close»: solo cuenta como desconexión si estaba vinculado.
  if (row.status !== "connected") return null;
  const fresh = !row.disconnectWindowStart || now.getTime() - row.disconnectWindowStart.getTime() > DAY_MS;
  const count = fresh ? 1 : row.disconnectCount + 1;
  const patch: StatusPatch = {
    status: "disconnected",
    disconnectCount: count,
    disconnectWindowStart: fresh ? now : row.disconnectWindowStart,
  };
  if (count >= DISCONNECTS_BEFORE_PAUSE && (!row.pausedUntil || row.pausedUntil <= now)) {
    patch.pausedUntil = new Date(now.getTime() + DAY_MS);
    patch.pauseReason = "disconnects";
  }
  return patch;
}

async function serverOf(row: ConnectionRow): Promise<{ ok: true; server: EvolutionServerRef } | { ok: false; error: LinkError }> {
  const key = await openServerKey(row.serverId);
  if (!key.ok) return { ok: false, error: key.error === "not_found" ? "no_server" : "server_key_unreadable" };
  return { ok: true, server: { baseUrl: key.baseUrl, apiKey: key.apiKey } };
}

function webhookUrl(token: string): string {
  return `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/api/webhooks/direct/${token}`;
}

/** Crea la instancia en el servidor y su webhook. Si el nombre quedó de antes, la borra y la hace de nuevo. */
async function ensureInstance(row: ConnectionRow, server: EvolutionServerRef): Promise<LinkError | null> {
  const token = randomBytes(24).toString("hex");
  const instanceKey = randomBytes(24).toString("hex");
  let created = await createInstance(server, { instanceName: row.instanceName, token: instanceKey });
  if (!created.ok && (created.error === "conflict" || created.error === "rejected")) {
    await deleteInstance(server, row.instanceName);
    created = await createInstance(server, { instanceName: row.instanceName, token: instanceKey });
  }
  if (!created.ok) return created.error === "unreachable" ? "server_unreachable" : "failed";
  const hook = await setWebhook(server, row.instanceName, webhookUrl(token));
  if (!hook.ok) {
    await deleteInstance(server, row.instanceName);
    return hook.error === "unreachable" ? "server_unreachable" : "failed";
  }
  await saveInstance(connectionRefOf(row), { instanceKey, webhookTokenHash: hashToken(token) });
  return null;
}

export type LinkStart = { ok: true; status: "connected" | "connecting"; qr: Qr | null } | { ok: false; error: LinkError };

/**
 * Vincular o reconectar: devuelve el QR para escanear (o «connected» si ya
 * está vinculado). Sin servidor asignado, toma el que tenga más lugar.
 */
export async function startLink(target: ConnectionTarget): Promise<LinkStart> {
  const ref = refOf(target);
  let row = await getConnection(ref);
  if (!row) {
    const server = await serverForNewOrganization();
    if (!server) return { ok: false, error: "no_server" };
    await assignServer(ref, server.id, instanceNameOf(ref.organizationId, ref.directNumberId));
    row = await getConnection(ref);
    if (!row) return { ok: false, error: "failed" };
  }
  if (row.pausedUntil && row.pausedUntil > new Date()) return { ok: false, error: "paused" };
  const s = await serverOf(row);
  if (!s.ok) return s;

  if (!row.instanceKeyCipher) {
    const err = await ensureInstance(row, s.server);
    if (err) return { ok: false, error: err };
  }

  let qr = await connectInstance(s.server, row.instanceName);
  if (!qr.ok && qr.error === "not_found") {
    // La instancia se borró del servidor por fuera: se crea de nuevo.
    const err = await ensureInstance(row, s.server);
    if (err) return { ok: false, error: err };
    qr = await connectInstance(s.server, row.instanceName);
  }
  if (!qr.ok) return { ok: false, error: qr.error === "unreachable" ? "server_unreachable" : "failed" };

  // Si el servidor ya no pide QR, el dispositivo está vinculado.
  const state = await connectionState(s.server, row.instanceName);
  if (state.ok && state.data === "open") {
    await refreshFromState(ref, "open");
    return { ok: true, status: "connected", qr: null };
  }
  if (row.status !== "connecting") await patchConnection(ref, { status: "connecting" });
  return { ok: true, status: "connecting", qr: qr.data };
}

/** Desvincular: cierra la sesión del dispositivo y borra la instancia. */
export async function unlink(target: ConnectionTarget): Promise<{ ok: true } | { ok: false; error: LinkError }> {
  const row = await getConnection(target);
  if (!row || !row.instanceKeyCipher) return { ok: true };
  const s = await serverOf(row);
  if (!s.ok) return s;
  await logoutInstance(s.server, row.instanceName);
  const del = await deleteInstance(s.server, row.instanceName);
  if (!del.ok && del.error !== "not_found") return { ok: false, error: del.error === "unreachable" ? "server_unreachable" : "failed" };
  await clearInstance(target);
  return { ok: true };
}

/** Aplica el estado que dijo el servidor (webhook o revisión). Devuelve el estado nuevo. */
export async function refreshFromState(target: ConnectionTarget, state: InstanceState, now = new Date()): Promise<ConnectionRow | null> {
  const ref = refOf(target);
  const row = await getConnection(ref);
  if (!row) return null;
  const patch = patchForState(row, state, now);
  if (!patch) return row;
  if (state === "open" && !row.phoneNumber) {
    const s = await serverOf(row);
    if (s.ok) patch.phoneNumber = await linkedPhone(s.server, row.instanceName);
  }
  await patchConnection(ref, patch);
  if (patch.status === "disconnected") log.warn("el dispositivo vinculado se desconectó", logCtx(ref));
  return getConnection(ref);
}

/** El webhook del servidor: el token de la URL decide la organización (y el número, si es de uno). */
export async function handleWebhookState(token: string, state: InstanceState): Promise<boolean> {
  const row = await connectionByWebhookHash(hashToken(token));
  if (!row) return false;
  await refreshFromState(connectionRefOf(row), state);
  return true;
}

const globalForHooks = globalThis as unknown as { __voceroDirectHooksOk?: Set<string> };

/**
 * PR 4: una instancia vinculada antes de este cambio solo manda el estado del
 * dispositivo. Una vez por arranque se revisa qué eventos manda; si le faltan
 * las palomitas (o, desde el PR 6, los mensajes), se le pone el webhook de nuevo (token nuevo: en la base solo
 * vive su hash, así que el viejo no se puede reusar). Nunca lanza.
 */
export async function ensureWebhookEvents(row: ConnectionRow, server: EvolutionServerRef): Promise<void> {
  const done = (globalForHooks.__voceroDirectHooksOk ??= new Set());
  if (done.has(row.instanceName) || !row.instanceKeyCipher) return;
  try {
    const current = await webhookEvents(server, row.instanceName);
    if (!current.ok) return;
    const have = new Set((current.data ?? []).map((e) => e.toUpperCase().replace(/\./g, "_")));
    if (WEBHOOK_EVENTS.every((e) => have.has(e))) {
      done.add(row.instanceName);
      return;
    }
    const token = randomBytes(24).toString("hex");
    const hook = await setWebhook(server, row.instanceName, webhookUrl(token));
    if (!hook.ok) return;
    await saveWebhookTokenHash(connectionRefOf(row), hashToken(token));
    done.add(row.instanceName);
    log.info("webhook del dispositivo vinculado al día (palomitas y mensajes)", logCtx(connectionRefOf(row)));
  } catch (err) {
    log.warn("no se pudo revisar el webhook del dispositivo vinculado", { ...logCtx(connectionRefOf(row)), err });
  }
}

/** Solo pruebas. */
export function resetWebhookEventsCheckForTests(): void {
  globalForHooks.__voceroDirectHooksOk?.clear();
}

/** La revisión de cada 5 minutos: pregunta al servidor el estado de cada conexión viva. */
export async function checkAllConnections(): Promise<{ checked: number; failed: number }> {
  const rows = await connectionsToCheck();
  const servers = new Map<string, Awaited<ReturnType<typeof serverOf>>>();
  let checked = 0;
  let failed = 0;
  for (const row of rows) {
    const ref = connectionRefOf(row);
    try {
      let s = servers.get(row.serverId);
      if (!s) {
        s = await serverOf(row);
        servers.set(row.serverId, s);
      }
      if (!s.ok) {
        failed++;
        continue;
      }
      const state = await connectionState(s.server, row.instanceName);
      if (!state.ok) {
        // Instancia desaparecida del servidor: se ve como desconectada. Servidor caído: no se cambia nada.
        if (state.error === "not_found") await refreshFromState(ref, "close");
        else failed++;
        continue;
      }
      await patchConnection(ref, { lastCheckAt: new Date() });
      await refreshFromState(ref, state.data);
      await ensureWebhookEvents(row, s.server);
      checked++;
    } catch (err) {
      failed++;
      log.error("la revisión de una conexión directa falló", { ...logCtx(ref), err });
    }
  }
  return { checked, failed };
}

const EVERY_MS = 5 * 60 * 1000;
const globalForCheck = globalThis as unknown as { __voceroDirectCheck?: NodeJS.Timeout };

/** Al arrancar y cada 5 minutos (sin frenar el arranque). */
export function startDirectConnectionCheck(): void {
  if (globalForCheck.__voceroDirectCheck) return;
  const run = async () => {
    try {
      await checkAllConnections();
    } catch (err) {
      log.error("la revisión de la conexión directa falló", { err });
    }
  };
  globalForCheck.__voceroDirectCheck = setInterval(() => void run(), EVERY_MS);
  globalForCheck.__voceroDirectCheck.unref();
}

export type DirectStatusDto = {
  status: "pending" | "connecting" | "connected" | "disconnected";
  phoneNumber: string | null;
  connectedAt: string | null;
  /** Hasta cuándo está en pausa por desconexiones repetidas (null = no lo está). */
  pausedUntil: string | null;
  /** Si hay un servidor asignado (o disponible) para vincular. */
  canLink: boolean;
};

/** Lo que ve la organización de su conexión: nada del servidor. Mientras espera el QR, pregunta en vivo. */
export async function statusFor(target: ConnectionTarget): Promise<DirectStatusDto> {
  let row = await getConnection(target);
  if (row?.status === "connecting" && row.instanceKeyCipher) {
    const s = await serverOf(row);
    if (s.ok) {
      const state = await connectionState(s.server, row.instanceName);
      if (state.ok) row = (await refreshFromState(target, state.data)) ?? row;
    }
  }
  const now = new Date();
  return {
    status: row?.status ?? "pending",
    phoneNumber: row?.phoneNumber ?? null,
    connectedAt: row?.connectedAt?.toISOString() ?? null,
    pausedUntil: row?.pausedUntil && row.pausedUntil > now ? row.pausedUntil.toISOString() : null,
    canLink: row ? true : (await serverForNewOrganization()) !== null,
  };
}
