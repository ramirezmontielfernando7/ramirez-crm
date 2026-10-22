import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import {
  assignServer,
  clearInstance,
  connectionByWebhookHash,
  connectionsToCheck,
  getConnection,
  openServerKey,
  patchConnection,
  saveInstance,
  serverForNewOrganization,
  type ConnectionRow,
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
  type EvolutionServerRef,
  type InstanceState,
  type Qr,
} from "./evolution-api";

const log = logger("direct-connection");

/**
 * Conexión directa (PR 2) — Vincular el número de una organización por QR.
 * Dashfort crea y administra la instancia en el servidor que /platform le
 * asignó; la organización solo ve «Dispositivo vinculado» y su estado.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Dos desconexiones en un día pausan la conexión directa 24 h (freno de emergencia). */
const DISCONNECTS_BEFORE_PAUSE = 2;

export type LinkError = "no_server" | "server_unreachable" | "server_key_unreadable" | "paused" | "failed";

export function instanceNameOf(organizationId: string): string {
  return `df-${organizationId.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 60);
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
  const hook = await setWebhook(server, row.instanceName, `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/api/webhooks/direct/${token}`);
  if (!hook.ok) {
    await deleteInstance(server, row.instanceName);
    return hook.error === "unreachable" ? "server_unreachable" : "failed";
  }
  await saveInstance(row.organizationId, { instanceKey, webhookTokenHash: hashToken(token) });
  return null;
}

export type LinkStart = { ok: true; status: "connected" | "connecting"; qr: Qr | null } | { ok: false; error: LinkError };

/**
 * Vincular o reconectar: devuelve el QR para escanear (o «connected» si ya
 * está vinculado). Sin servidor asignado, toma el que tenga más lugar.
 */
export async function startLink(organizationId: string): Promise<LinkStart> {
  let row = await getConnection(organizationId);
  if (!row) {
    const server = await serverForNewOrganization();
    if (!server) return { ok: false, error: "no_server" };
    await assignServer(organizationId, server.id, instanceNameOf(organizationId));
    row = await getConnection(organizationId);
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
    await refreshFromState(row.organizationId, "open");
    return { ok: true, status: "connected", qr: null };
  }
  if (row.status !== "connecting") await patchConnection(organizationId, { status: "connecting" });
  return { ok: true, status: "connecting", qr: qr.data };
}

/** Desvincular: cierra la sesión del dispositivo y borra la instancia. */
export async function unlink(organizationId: string): Promise<{ ok: true } | { ok: false; error: LinkError }> {
  const row = await getConnection(organizationId);
  if (!row || !row.instanceKeyCipher) return { ok: true };
  const s = await serverOf(row);
  if (!s.ok) return s;
  await logoutInstance(s.server, row.instanceName);
  const del = await deleteInstance(s.server, row.instanceName);
  if (!del.ok && del.error !== "not_found") return { ok: false, error: del.error === "unreachable" ? "server_unreachable" : "failed" };
  await clearInstance(organizationId);
  return { ok: true };
}

/** Aplica el estado que dijo el servidor (webhook o revisión). Devuelve el estado nuevo. */
export async function refreshFromState(organizationId: string, state: InstanceState, now = new Date()): Promise<ConnectionRow | null> {
  const row = await getConnection(organizationId);
  if (!row) return null;
  const patch = patchForState(row, state, now);
  if (!patch) return row;
  if (state === "open" && !row.phoneNumber) {
    const s = await serverOf(row);
    if (s.ok) patch.phoneNumber = await linkedPhone(s.server, row.instanceName);
  }
  await patchConnection(organizationId, patch);
  if (patch.status === "disconnected") log.warn("el dispositivo vinculado se desconectó", { org: organizationId });
  return getConnection(organizationId);
}

/** El webhook del servidor: el token de la URL decide la organización. */
export async function handleWebhookState(token: string, state: InstanceState): Promise<boolean> {
  const row = await connectionByWebhookHash(hashToken(token));
  if (!row) return false;
  await refreshFromState(row.organizationId, state);
  return true;
}

/** La revisión de cada 5 minutos: pregunta al servidor el estado de cada conexión viva. */
export async function checkAllConnections(): Promise<{ checked: number; failed: number }> {
  const rows = await connectionsToCheck();
  const servers = new Map<string, Awaited<ReturnType<typeof serverOf>>>();
  let checked = 0;
  let failed = 0;
  for (const row of rows) {
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
        if (state.error === "not_found") await refreshFromState(row.organizationId, "close");
        else failed++;
        continue;
      }
      await patchConnection(row.organizationId, { lastCheckAt: new Date() });
      await refreshFromState(row.organizationId, state.data);
      checked++;
    } catch (err) {
      failed++;
      log.error("la revisión de una conexión directa falló", { org: row.organizationId, err });
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
export async function statusFor(organizationId: string): Promise<DirectStatusDto> {
  let row = await getConnection(organizationId);
  if (row?.status === "connecting" && row.instanceKeyCipher) {
    const s = await serverOf(row);
    if (s.ok) {
      const state = await connectionState(s.server, row.instanceName);
      if (state.ok) row = (await refreshFromState(organizationId, state.data)) ?? row;
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
