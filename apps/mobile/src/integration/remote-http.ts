import type { AuthRepository } from "../services/demo-auth";
import type { StoragePort } from "../services/storage";

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
) => Promise<Pick<Response, "ok" | "status" | "json">>;

type Credential = { token: string; expiresAt: number };
export type RemoteSession = Readonly<{ expiresAt: number }>;
type RemoteErrorCode =
  | "ORGANIZATION_SUSPENDED"
  | "organization_suspended"
  | "TOO_MANY_REQUESTS"
  | "SESSION_EXPIRED";
function errorCode(raw: unknown): RemoteErrorCode | undefined {
  return raw === "ORGANIZATION_SUSPENDED" ||
    raw === "organization_suspended" ||
    raw === "TOO_MANY_REQUESTS"
    ? raw
    : undefined;
}

export function allowsRemoteRequest(method: string, path: string): boolean {
  if (method === "POST")
    return (
      path === "/api/mobile/session" || path === "/api/mobile/session/revoke"
    );
  if (method !== "GET") return false;
  if (/^\/api\/conversations\/[a-zA-Z0-9_-]{1,200}\/messages$/.test(path))
    return !/[\s]/.test(path);
  if (path === "/api/conversations") return true;
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
  ) {
    super(
      code === "SESSION_EXPIRED"
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
                ? "La conversación ya no está disponible."
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
  readonly origin: string;
  private readonly key: string;

  constructor(
    readonly mode: RemoteMode,
    origin: string | undefined,
    private readonly store: StoragePort,
    private readonly fetch: FetchPort,
    private readonly now = Date.now,
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

  async read(path: string): Promise<unknown> {
    const session = this.current;
    if (!session) throw new RemoteHttpError(401);
    if (session.expiresAt <= this.now()) {
      await this.clear(session).catch(() => {});
      throw new RemoteHttpError(401, "SESSION_EXPIRED");
    }
    try {
      const data = await this.request("GET", path, session);
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
    method: "GET" | "POST",
    path: string,
    session?: Credential,
    body?: object,
  ) {
    if (!allowsRemoteRequest(method, path)) throw new RemoteHttpError(403);
    const headers = new Headers({ accept: "application/json" });
    if (session) headers.set("authorization", `Bearer ${session.token}`);
    if (body) headers.set("content-type", "application/json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetch(this.origin + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
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
        );
      if (!value) throw new RemoteHttpError(502);
      return value;
    } catch (error) {
      if (error instanceof RemoteHttpError) throw error;
      throw new RemoteHttpError(0, undefined, false, this.mode);
    } finally {
      clearTimeout(timeout);
    }
  }
}
