import type { AuthRepository } from "../services/demo-auth";
import type { StoragePort } from "../services/storage";

import {
  allowsCrmRequest,
  crmCalendar,
  crmContact,
  crmCreatedId,
  crmNotes,
  crmRecord,
  crmSlots,
  crmTags,
  crmTasks,
  crmTeam,
  isRemoteId,
  validInstant,
} from "./remote-crm-contract";

import {
  canSendTemplates,
  quickRepliesResponse,
  reviewTemplate,
  templatesResponse,
  type RemoteTemplate,
} from "./remote-composer";
import {
  readEventHints,
  StreamingUnavailable,
  type LiveHint,
} from "./remote-live";
import type { WireConversation } from "./wire";

import {
  agentsResponse,
  allowsWorkspaceRequest,
  lossReasonsResponse,
  pipelineResponse,
} from "./remote-workspace";

import {
  acceptsMediaResponse,
  allowsMediaRequest,
  baseMime,
  MEDIA_LIMIT,
  uploadMediaKind,
  type RemoteAttachment,
} from "./remote-media";

type Method = "GET" | "POST" | "PATCH" | "PUT";

export type RemoteMode = "staging" | "production";
export type BuildMode = "demo" | RemoteMode | "invalid";

const productionOrigin = "https://dash.demfort.com";

export function resolveBuildMode(raw: string | undefined): BuildMode {
  if (raw === undefined) return "demo";
  return raw === "demo" || raw === "staging" || raw === "production"
    ? raw
    : "invalid";
}

export function remoteOrigin(
  mode: RemoteMode,
  raw: string | undefined,
): string {
  if (mode === "staging") return stagingOrigin(raw);
  // Compare the literal value. URL normalization would accept :443, dot
  // segments, different casing, or a trailing slash.
  if (raw !== productionOrigin)
    throw new Error(
      "En producción, EXPO_PUBLIC_API_URL debe ser exactamente https://dash.demfort.com.",
    );
  return productionOrigin;
}

export function stagingOrigin(raw: string | undefined): string {
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new Error("Define EXPO_PUBLIC_API_URL para el entorno de pruebas.");
  }
  const host = url.hostname.replace(/\.+$/, "").toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(
    host,
  );
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    host === "dash.demfort.com" ||
    host.endsWith(".dash.demfort.com") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Configura un origen HTTPS de pruebas o una dirección local.",
    );
  }
  return url.origin;
}

type FetchPort = (
  url: string,
  options: RequestInit,
) => Promise<
  Pick<Response, "ok" | "status" | "json"> &
    Partial<Pick<Response, "body" | "headers">>
>;

type Credential = { token: string; expiresAt: number };
export type RemoteSession = Readonly<{ expiresAt: number }>;
type RemoteErrorCode =
  | "ORGANIZATION_SUSPENDED"
  | "organization_suspended"
  | "TOO_MANY_REQUESTS"
  | "SESSION_EXPIRED"
  | "window_closed"
  | "slot_taken"
  | "not_connected"
  | "reconnect_required"
  | "template_changed"
  | "template_line_unsupported"
  | "meta_unavailable"
  | "meta_error"
  | "storage_quota";
function errorCode(raw: unknown): RemoteErrorCode | undefined {
  return raw === "ORGANIZATION_SUSPENDED" ||
    raw === "organization_suspended" ||
    raw === "window_closed" ||
    raw === "slot_taken" ||
    raw === "meta_unavailable" ||
    raw === "meta_error" ||
    raw === "storage_quota" ||
    raw === "not_connected" ||
    raw === "reconnect_required" ||
    raw === "TOO_MANY_REQUESTS"
    ? raw
    : undefined;
}

// Keep each mobile submission within one Meta text message.
export const REMOTE_TEXT_MAX = 4_096;
const conversationId = /^[a-zA-Z0-9_-]{1,200}$/;
const historyPath = /^\/api\/conversations\/[a-zA-Z0-9_-]{1,200}\/messages$/;
const templatePath =
  /^\/api\/conversations\/[a-zA-Z0-9_-]{1,200}\/messages\/template$/;
const conversationPath = /^\/api\/conversations\/[a-zA-Z0-9_-]{1,200}$/;

export function remoteSendEnabled(raw: string | undefined): boolean {
  return raw === "true";
}

export function allowsRemoteRequest(
  method: string,
  path: string,
  allowSend = false,
): boolean {
  if (/\s/.test(path)) return false;
  if (allowsMediaRequest(method, path, allowSend)) return true;
  if (allowsWorkspaceRequest(method, path, allowSend)) return true;
  if (allowsCrmRequest(method, path, allowSend)) return true;
  if (method === "POST")
    return (
      path === "/api/mobile/session" ||
      path === "/api/mobile/session/revoke" ||
      (allowSend && (historyPath.test(path) || templatePath.test(path)))
    );
  if (method === "PATCH") return allowSend && conversationPath.test(path);
  if (method !== "GET") return false;
  if (
    historyPath.test(path) ||
    path === "/api/templates" ||
    path === "/api/quick-replies" ||
    path === "/api/whatsapp-numbers" ||
    path === "/api/events"
  )
    return true;
  if (
    path === "/api/conversations" ||
    /^\/api\/conversations\?ids=[a-zA-Z0-9_-]{1,200}$/.test(path)
  )
    return true;
  if (
    !path.startsWith("/api/conversations?") ||
    /[#\s\u0000-\u001f\u007f]/.test(path)
  )
    return false;
  // The installed inbox reader uses only pagination parameters.
  return [
    ...new URLSearchParams(path.slice(path.indexOf("?") + 1)).keys(),
  ].every((name) => name === "limit" || name === "cursor");
}

export class RemoteHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code?: RemoteErrorCode,
    login = false,
    mode: RemoteMode = "staging",
    serverMessage?: unknown,
    crm = false,
  ) {
    super(
      code === "storage_quota" || status === 507
        ? "Tu negocio alcanzó su límite de almacenamiento."
        : status === 413
          ? "El archivo excede el límite de tamaño."
          : status === 415
            ? "Este tipo de archivo no está permitido."
            : status === 410
              ? "El archivo ya no está disponible."
              : code === "template_line_unsupported"
                ? "La ruta del CRM solo envía plantillas por la línea principal de WhatsApp de Meta."
                : code === "template_changed"
                  ? "La plantilla cambió o ya no está aprobada. Vuelve a abrir el catálogo."
                  : code === "not_connected" &&
                      serverMessage === "Sin número conectado"
                    ? serverMessage
                    : code === "reconnect_required" &&
                        serverMessage === "Reconecta el número"
                      ? serverMessage
                      : status === 409 &&
                          code === "window_closed" &&
                          serverMessage ===
                            "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
                        ? serverMessage
                        : crm && status === 409 && code === "slot_taken"
                          ? "Ese horario ya no está disponible. Selecciona otro."
                          : code === "SESSION_EXPIRED"
                            ? "Tu sesión caducó. Vuelve a iniciar sesión."
                            : status === 403 &&
                                (code === "ORGANIZATION_SUSPENDED" ||
                                  code === "organization_suspended")
                              ? "Tu negocio está suspendido. Contacta a soporte de la plataforma."
                              : status === 429
                                ? "Demasiados intentos. Espera unos minutos."
                                : status === 401
                                  ? login
                                    ? "Correo o contraseña incorrectos."
                                    : "Tu sesión ya no está activa. Vuelve a iniciar sesión."
                                  : status === 404
                                    ? crm
                                      ? "El registro o módulo ya no está disponible."
                                      : "La conversación ya no está disponible."
                                    : status === 403
                                      ? "No tienes acceso a esta operación."
                                      : status === 0
                                        ? mode === "production"
                                          ? "Sin conexión con Dashfort. Reintenta."
                                          : "Sin conexión con el entorno de pruebas."
                                        : "No se pudo completar la solicitud. Reintenta.",
    );
  }
}

export function requiresRemoteLogin(
  error: unknown,
): error is RemoteHttpError &
  (
    | { status: 401 }
    | { status: 403; code: "organization_suspended" | "ORGANIZATION_SUSPENDED" }
  ) {
  return (
    error instanceof RemoteHttpError &&
    (error.status === 401 ||
      (error.status === 403 &&
        (error.code === "organization_suspended" ||
          error.code === "ORGANIZATION_SUSPENDED")))
  );
}

function credential(value: unknown): Credential {
  if (!value || typeof value !== "object") throw new RemoteHttpError(502);
  const { token, expiresAt } = value as Partial<Credential>;
  if (
    typeof token !== "string" ||
    token.length > 512 ||
    !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_+/=-]+$/.test(token) ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  ) {
    throw new RemoteHttpError(502);
  }
  return { token, expiresAt };
}

export class RemoteAuthRepository implements AuthRepository<RemoteSession> {
  private current: Credential | null = null;
  private writes: Promise<void> = Promise.resolve();
  private sending = false;
  private uncertainTemplates = new Set<string>();
  private uncertainMedia = new Set<string>();
  private updatingCrm = false;
  readonly origin: string;
  private readonly key: string;

  constructor(
    readonly mode: RemoteMode,
    origin: string | undefined,
    private readonly store: StoragePort,
    private readonly fetch: FetchPort,
    private readonly now = Date.now,
    readonly allowSend = false,
  ) {
    this.origin = remoteOrigin(mode, origin);
    this.key = `dashfort.${mode}.session.v1`;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.writes.then(fn);
    this.writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  restore() {
    return this.serialize(async () => {
      const raw = await this.store.get(this.key);
      this.current = null;
      if (!raw) return null;
      let parsed: Credential | null = null;
      try {
        const saved = JSON.parse(raw);
        if (saved?.origin === this.origin) parsed = credential(saved);
      } catch {
        // Invalid stored envelopes are discarded.
      }
      if (parsed && parsed.expiresAt > this.now()) {
        this.current = parsed;
        return { expiresAt: parsed.expiresAt };
      }
      if (parsed) {
        await this.store.remove(this.key).catch(() => {});
        throw new RemoteHttpError(401, "SESSION_EXPIRED");
      }
      await this.store.remove(this.key);
      return null;
    });
  }

  signIn(email: string, password: string) {
    return this.serialize(async () => {
      const raw = (await this.request(
        "POST",
        "/api/mobile/session",
        undefined,
        {
          email: email.trim(),
          password,
        },
      )) as { token?: unknown; expiresAt?: unknown };
      const entry = credential({
        token: raw?.token,
        expiresAt:
          typeof raw?.expiresAt === "string" ? Date.parse(raw.expiresAt) : NaN,
      });
      if (entry.expiresAt <= this.now()) throw new RemoteHttpError(502);
      try {
        await this.store.set(
          this.key,
          JSON.stringify({ ...entry, origin: this.origin }),
        );
      } catch {
        await this.revoke(entry).catch(() => {});
        throw new Error("No se pudo guardar la sesión de forma segura.");
      }
      this.uncertainTemplates.clear();
      this.uncertainMedia.clear();
      this.current = entry;
      return { expiresAt: entry.expiresAt };
    });
  }

  async redeem(): Promise<RemoteSession> {
    throw new RemoteHttpError(403);
  }

  signOut() {
    return this.serialize(async () => {
      const session = this.current;
      this.current = null;
      try {
        await this.store.remove(this.key);
      } catch {
        if (session) await this.revoke(session).catch(() => {});
        throw new Error(
          "No se pudo borrar la sesión del almacenamiento seguro.",
        );
      }
      if (session) await this.revoke(session);
    });
  }

  private async revoke(session: Credential) {
    try {
      await this.request("POST", "/api/mobile/session/revoke", session, {});
    } catch (err) {
      if (err instanceof RemoteHttpError && err.status === 401) return;
      throw new Error(
        "La sesión se borró del teléfono. No se pudo confirmar la revocación en el servidor.",
      );
    }
  }

  private clear(session: Credential) {
    return this.serialize(async () => {
      if (this.current !== session) return;
      this.current = null;
      await this.store.remove(this.key);
    });
  }

  expireIfNeeded() {
    return this.serialize(async () => {
      if (!this.current || this.current.expiresAt > this.now()) return false;
      this.current = null;
      await this.store.remove(this.key).catch(() => {});
      return true;
    });
  }

  read(path: string): Promise<unknown> {
    if (path === "/api/events" || allowsMediaRequest("GET", path, false))
      return Promise.reject(new RemoteHttpError(403));
    return this.authenticatedRequest("GET", path);
  }

  async markRead(id: string): Promise<void> {
    if (!conversationId.test(id) || /\s/.test(id))
      throw new RemoteHttpError(403);
    await this.authenticatedRequest("PATCH", `/api/conversations/${id}`, {
      markRead: true,
    });
  }

  async sendText(
    id: string,
    draft: string,
  ): Promise<{ queued: boolean } | null> {
    if (!this.allowSend || !conversationId.test(id) || /\s/.test(id))
      throw new RemoteHttpError(403);
    const text = draft.trim();
    if (!text || text.length > REMOTE_TEXT_MAX) throw new RemoteHttpError(422);
    if (this.sending) return null;

    this.sending = true;
    try {
      const value = (await this.authenticatedRequest(
        "POST",
        `/api/conversations/${id}/messages`,
        { text },
      )) as {
        messageId?: unknown;
        queuedUntil?: unknown;
      };
      if (typeof value?.messageId !== "string" || !value.messageId)
        throw new RemoteHttpError(502);
      return {
        queued:
          typeof value.queuedUntil === "string" &&
          Number.isFinite(Date.parse(value.queuedUntil)),
      };
    } finally {
      this.sending = false;
    }
  }

  async templates() {
    return templatesResponse(await this.read("/api/templates"));
  }

  async quickReplies() {
    return quickRepliesResponse(await this.read("/api/quick-replies"));
  }

  async downloadMedia(
    media: RemoteAttachment,
    signal: AbortSignal,
    write: (chunk: Uint8Array) => Promise<void>,
    limit = MEDIA_LIMIT,
  ) {
    const path = `/api/media/${idSegment(media.id)}`;
    if (!allowsMediaRequest("GET", path, false)) throw new RemoteHttpError(403);
    if (media.size !== null && media.size > limit)
      throw new RemoteHttpError(413);
    const session = this.current;
    if (!session || session.expiresAt <= this.now())
      throw new RemoteHttpError(401);
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(stop, 120_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (signal.aborted) throw new RemoteHttpError(0);
      const response = await this.fetch(this.origin + path, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: new Headers({ authorization: `Bearer ${session.token}` }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new RemoteHttpError(
          response.status,
          errorCode(body?.error?.code) ?? errorCode(body?.code),
          false,
          this.mode,
        );
      }
      const headers = response.headers;
      const length = headers?.get("content-length");
      if (
        length !== null &&
        length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) > limit)
      )
        throw new RemoteHttpError(413);
      const mime = baseMime(headers?.get("content-type") ?? "");
      if (!acceptsMediaResponse(media, mime) || !response.body)
        throw new RemoteHttpError(415);
      reader = response.body.getReader();
      let bytes = 0;
      for (;;) {
        const next = await reader.read();
        if (this.current !== session || session.expiresAt <= this.now())
          throw new RemoteHttpError(401);
        if (controller.signal.aborted)
          throw new RemoteHttpError(0, undefined, false, this.mode);
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > limit) throw new RemoteHttpError(413);
        await write(next.value);
      }
      if (bytes === 0 || (length != null && bytes !== Number(length)))
        throw new RemoteHttpError(502);
    } catch (reason) {
      if (requiresRemoteLogin(reason))
        await this.clear(session).catch(() => {});
      if (reason instanceof RemoteHttpError) throw reason;
      throw new RemoteHttpError(0, undefined, false, this.mode);
    } finally {
      stop();
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }

  mediaNeedsRefresh(id: string) {
    return this.uncertainMedia.has(id);
  }
  mediaHistoryChecked(id: string) {
    this.uncertainMedia.delete(id);
  }

  async sendMedia(
    id: string,
    file: { uri: string; name: string; mime: string; size: number },
    signal: AbortSignal,
  ) {
    if (!this.allowSend || this.mediaNeedsRefresh(id))
      throw new RemoteHttpError(403);
    const path = `/api/conversations/${idSegment(id)}/messages/media`;
    if (
      !uploadMediaKind(file.mime, file.name, file.size) ||
      !file.uri.startsWith("file://")
    )
      throw new RemoteHttpError(file.size > MEDIA_LIMIT ? 413 : 415);
    if (this.sending) return null;
    if (signal.aborted) throw new RemoteHttpError(0);
    const form = new FormData();
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mime,
    } as unknown as Blob);
    this.sending = true;
    const session = this.current;
    try {
      const raw = crmRecord(
        await this.authenticatedRequest("POST", path, form, signal),
      );
      if (!isRemoteId(raw.messageId)) throw new RemoteHttpError(502);
      return { queued: typeof raw.queuedUntil === "string" };
    } catch (reason) {
      if (
        this.current === session &&
        (!(reason instanceof RemoteHttpError) ||
          reason.status === 0 ||
          reason.status === 408 ||
          reason.status >= 500)
      )
        this.uncertainMedia.add(id);
      throw reason;
    } finally {
      this.sending = false;
    }
  }

  async templateLineAvailable(chat: WireConversation) {
    if (!canSendTemplates(chat)) return false;
    const { numbers } = crmRecord(await this.read("/api/whatsapp-numbers"));
    if (!Array.isArray(numbers)) throw new RemoteHttpError(502);
    const primary = numbers
      .map(crmRecord)
      .filter((number) => number.isPrimary === true);
    return primary.length === 1 && primary[0]?.id === chat.waNumberId;
  }

  async sendTemplate(
    chat: WireConversation,
    selected: RemoteTemplate,
    values: readonly string[],
  ) {
    if (
      !this.allowSend ||
      !canSendTemplates(chat) ||
      this.templateIsUncertain(chat.id)
    )
      throw new RemoteHttpError(403);
    const reviewed = reviewTemplate(selected, values);
    if (!reviewed || !isRemoteId(selected.id)) throw new RemoteHttpError(422);
    if (this.sending) return null;
    this.sending = true;
    const session = this.current;
    let submitted = false;
    try {
      const [catalog, allowedLine] = await Promise.all([
        this.templates(),
        this.templateLineAvailable(chat),
      ]);
      const latest = catalog.find(({ id }) => id === selected.id);
      if (session !== this.current) throw new RemoteHttpError(401);
      if (!allowedLine)
        throw new RemoteHttpError(403, "template_line_unsupported");
      if (!latest || JSON.stringify(latest) !== JSON.stringify(selected))
        throw new RemoteHttpError(422, "template_changed");
      const path = `/api/conversations/${idSegment(chat.id)}/messages/template`;
      submitted = true;
      const raw = await this.authenticatedRequest("POST", path, {
        templateId: latest.id,
        variables: reviewed.variables,
      });
      if (!isRemoteId(crmRecord(raw).messageId)) throw new RemoteHttpError(502);
      return true;
    } catch (reason) {
      if (
        submitted &&
        this.current === session &&
        (!(reason instanceof RemoteHttpError) ||
          reason.status === 0 ||
          reason.status >= 500 ||
          reason.code === "meta_unavailable" ||
          reason.code === "meta_error")
      )
        this.uncertainTemplates.add(chat.id);
      throw reason;
    } finally {
      this.sending = false;
    }
  }

  templateIsUncertain(id: string) {
    return this.uncertainTemplates.has(id);
  }

  templateHistoryChecked(id: string) {
    this.uncertainTemplates.delete(id);
  }

  async liveEvents(
    signal: AbortSignal,
    hint: (event: LiveHint) => void,
    ready: () => void,
  ) {
    const session = this.current;
    if (!session || session.expiresAt <= this.now()) {
      if (session) await this.clear(session).catch(() => {});
      throw new RemoteHttpError(401, "SESSION_EXPIRED");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    let timeout = setTimeout(abort, 15_000);
    const ping = () => {
      clearTimeout(timeout);
      timeout = setTimeout(abort, 65_000);
    };
    try {
      if (signal.aborted) return;
      const response = await this.fetch(this.origin + "/api/events", {
        method: "GET",
        headers: new Headers({
          accept: "text/event-stream",
          authorization: `Bearer ${session.token}`,
        }),
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.current !== session) return;
      if (!response.ok) {
        if (response.status === 403) {
          const data = await response.json().catch(() => null);
          const reason = new RemoteHttpError(
            403,
            errorCode(data?.error?.code) ?? errorCode(data?.code),
          );
          if (requiresRemoteLogin(reason)) throw reason;
          throw new StreamingUnavailable();
        }
        if (response.status === 404 || response.status === 405)
          throw new StreamingUnavailable();
        throw new RemoteHttpError(response.status);
      }
      if (
        typeof TextDecoder !== "function" ||
        !response.body?.getReader ||
        !response.headers?.get("content-type")?.includes("text/event-stream")
      )
        throw new StreamingUnavailable();
      ping();
      ready();
      await readEventHints(
        response.body,
        controller.signal,
        (event) => {
          if (this.current === session && !signal.aborted) hint(event);
        },
        ping,
      );
    } catch (reason) {
      if (requiresRemoteLogin(reason))
        await this.clear(session).catch(() => {});
      throw reason;
    } finally {
      abort();
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  async agents() {
    return agentsResponse(await this.read("/api/lab/agents"));
  }

  async writingAvailable() {
    return crmRecord(await this.read("/api/writing-assist")).available === true;
  }

  suggestDraft(draft: string) {
    return this.updateCrm(async (request) => {
      const text = boundedText(draft, 4_000);
      const raw = crmRecord(
        await request("POST", "/api/writing-assist", {
          action: "improve",
          text,
        }),
      );
      if (typeof raw.text !== "string" || !raw.text.trim())
        throw new RemoteHttpError(502);
      return raw.text.slice(0, REMOTE_TEXT_MAX);
    });
  }

  setConversationAI(id: string, action: "pause" | "enable" | "reactivate") {
    return this.updateCrm(async (request) => {
      const patch =
        action === "reactivate"
          ? { reactivate: true }
          : { aiEnabled: action === "enable" };
      const result = crmRecord(
        await request("PATCH", `/api/conversations/${idSegment(id)}`, patch),
      );
      if (crmRecord(result.conversation).id !== id)
        throw new RemoteHttpError(502);
      return true;
    });
  }

  async pipeline(stage?: { id: string; offset: number }) {
    const suffix = stage
      ? `&stageId=${idSegment(stage.id)}&offset=${stage.offset}`
      : "";
    return pipelineResponse(
      await this.read("/api/pipeline/board?take=50" + suffix),
    );
  }

  async lossReasons() {
    return lossReasonsResponse(await this.read("/api/pipeline/loss-reasons"));
  }

  moveLead(id: string, stageId: string, lossReason?: string) {
    return this.updateCrm(async (request) => {
      const raw = crmRecord(
        await request("PATCH", `/api/pipeline/leads/${idSegment(id)}`, {
          stageId: idSegment(stageId),
          ...(lossReason ? { lossReason: idSegment(lossReason) } : {}),
        }),
      );
      if (crmRecord(raw.lead).id !== id) throw new RemoteHttpError(502);
      return true;
    });
  }

  async contact(id: string) {
    return crmContact(await this.read(`/api/contacts/${idSegment(id)}`), id);
  }

  async notes(id: string) {
    return crmNotes(await this.read(`/api/contacts/${idSegment(id)}/timeline`));
  }

  async tags() {
    return crmTags(await this.read("/api/contact-tags"));
  }

  async team() {
    return crmTeam(await this.read("/api/settings/team"));
  }

  async tasks() {
    return crmTasks(await this.read("/api/work/tasks?filter=all"));
  }

  async calendar(from: string, to: string) {
    return crmCalendar(await this.read(`/api/bookings?from=${from}&to=${to}`));
  }

  async slots() {
    return crmSlots(await this.read("/api/calendar/availability"));
  }

  addNote(id: string, draft: string) {
    return this.updateCrm(async (request) => {
      const text = boundedText(draft, 4_000);
      return crmCreatedId(
        await request("POST", `/api/contacts/${idSegment(id)}/notes`, { text }),
      );
    });
  }

  changeTag(id: string, tagId: string, add: boolean) {
    return this.updateCrm(async (request) => {
      const path = `/api/contacts/${idSegment(id)}`;
      const [current, catalog] = await Promise.all([
        request("GET", path).then((raw) => crmContact(raw, id)),
        request("GET", "/api/contact-tags").then(crmTags),
      ]);
      // System labels are kept intact because the server replaces the whole set.
      if (!catalog.some((tag) => tag.id === tagId))
        throw new RemoteHttpError(403);
      const ids = new Set(current.tags.map((tag) => tag.id));
      if (ids.has(tagId) === add) return true;
      if (add) ids.add(tagId);
      else ids.delete(tagId);
      if (ids.size > 50) throw new RemoteHttpError(422);
      crmTags(await request("PUT", path + "/tags", { tagIds: [...ids] }));
      return true;
    });
  }

  assign(id: string, userId: string | null) {
    return this.updateCrm(async (request) => {
      const team = crmTeam(await request("GET", "/api/settings/team"));
      if (userId !== null && !team.some((person) => person.id === userId))
        throw new RemoteHttpError(403);
      const result = crmRecord(
        await request("POST", "/api/assignments", {
          contactIds: [idSegment(id)],
          userId,
        }),
      );
      if (result.changed !== 0 && result.changed !== 1)
        throw new RemoteHttpError(502);
      return true;
    });
  }

  addTask(draft: string, details: string) {
    return this.updateCrm(async (request) => {
      const title = boundedText(draft, 200);
      const description = details.trim();
      if (description.length > 4_000) throw new RemoteHttpError(422);
      const raw = crmRecord(
        await request("POST", "/api/work/tasks", {
          title,
          ...(description ? { description } : {}),
        }),
      );
      return crmCreatedId(raw.task);
    });
  }

  setTaskDone(id: string, done: boolean) {
    return this.updateCrm(async (request) => {
      if (typeof done !== "boolean") throw new RemoteHttpError(422);
      const result = crmRecord(
        await request("PATCH", `/api/work/tasks/${idSegment(id)}`, { done }),
      );
      if (crmCreatedId(result.task) !== id) throw new RemoteHttpError(502);
      return true;
    });
  }

  addBooking(contactId: string, startUtc: string) {
    return this.updateCrm(async (request) => {
      if (!validInstant(startUtc)) throw new RemoteHttpError(422);
      const raw = crmRecord(
        await request("POST", "/api/bookings", {
          kind: "session",
          contactId: idSegment(contactId),
          startUtc,
        }),
      );
      return crmCreatedId(raw.booking);
    });
  }

  moveBooking(id: string, startUtc: string) {
    return this.updateCrm(async (request) => {
      if (!validInstant(startUtc)) throw new RemoteHttpError(422);
      const raw = crmRecord(
        await request("PATCH", `/api/bookings/${idSegment(id)}`, {
          action: "reschedule",
          startUtc,
        }),
      );
      if (raw.ok !== true) throw new RemoteHttpError(502);
      return true;
    });
  }

  private async updateCrm<T>(
    fn: (
      request: (
        method: Method,
        path: string,
        body?: object,
      ) => Promise<unknown>,
    ) => Promise<T>,
  ): Promise<T | null> {
    if (!this.allowSend) throw new RemoteHttpError(403);
    if (this.updatingCrm) return null;
    const session = this.current;
    if (!session) throw new RemoteHttpError(401);
    this.updatingCrm = true;
    try {
      return await fn((method, path, body) => {
        if (session !== this.current) throw new RemoteHttpError(401);
        return this.authenticatedRequest(method, path, body);
      });
    } finally {
      this.updatingCrm = false;
    }
  }

  private async authenticatedRequest(
    method: Method,
    path: string,
    body?: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!allowsRemoteRequest(method, path, this.allowSend))
      throw new RemoteHttpError(403);
    const session = this.current;
    if (!session) throw new RemoteHttpError(401);
    if (session.expiresAt <= this.now()) {
      await this.clear(session).catch(() => {});
      throw new RemoteHttpError(401, "SESSION_EXPIRED");
    }
    try {
      const data = await this.request(method, path, session, body, signal);
      if (this.current !== session) throw new RemoteHttpError(401);
      if (session.expiresAt <= this.now())
        throw new RemoteHttpError(401, "SESSION_EXPIRED");
      return data;
    } catch (err) {
      if (requiresRemoteLogin(err)) await this.clear(session).catch(() => {});
      throw err;
    }
  }

  private async request(
    method: Method,
    path: string,
    session?: Credential,
    body?: object,
    signal?: AbortSignal,
  ) {
    if (!allowsRemoteRequest(method, path, this.allowSend))
      throw new RemoteHttpError(403);
    const headers = new Headers({ accept: "application/json" });
    if (session) headers.set("authorization", `Bearer ${session.token}`);
    const multipart = body instanceof FormData;
    if (body && !multipart) headers.set("content-type", "application/json");

    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const timeout = setTimeout(stop, multipart ? 180_000 : 15_000);
    try {
      const response = await this.fetch(this.origin + path, {
        method,
        headers,
        body: multipart ? body : body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      const value = await response.json().catch(() => null);
      if (!response.ok)
        throw new RemoteHttpError(
          response.status,
          errorCode(value?.error?.code) ?? errorCode(value?.code),
          path === "/api/mobile/session",
          this.mode,
          value?.error?.message,
          allowsCrmRequest(method, path, this.allowSend) ||
            allowsWorkspaceRequest(method, path, this.allowSend),
        );
      if (!value) throw new RemoteHttpError(502);
      return value;
    } catch (error) {
      if (error instanceof RemoteHttpError) throw error;
      throw new RemoteHttpError(0, undefined, false, this.mode);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
    }
  }
}

function idSegment(id: string) {
  if (!isRemoteId(id)) throw new RemoteHttpError(422);
  return id;
}

function boundedText(draft: string, max: number) {
  const text = draft.trim();
  if (!text || text.length > max) throw new RemoteHttpError(422);
  return text;
}
