import type { AuthRepository } from "../services/demo-auth";
import type { StoragePort } from "../services/storage";

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
type StagingSession = Readonly<{ expiresAt: number }>;
const key = "dashfort.staging.session.v1";

export class StagingHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    login = false,
  ) {
    super(
      code === "ORGANIZATION_SUSPENDED" || code === "organization_suspended"
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
                  ? "Sin conexión con el entorno de pruebas."
                  : "No se pudo completar la solicitud. Reintenta.",
    );
  }
}

function credential(value: unknown): Credential {
  if (!value || typeof value !== "object") throw new StagingHttpError(502);
  const { token, expiresAt } = value as Partial<Credential>;
  if (
    typeof token !== "string" ||
    token.length > 512 ||
    !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_+/=-]+$/.test(token) ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  ) {
    throw new StagingHttpError(502);
  }
  return { token, expiresAt };
}

export class StagingAuthRepository implements AuthRepository<StagingSession> {
  private current: Credential | null = null;
  private writes: Promise<void> = Promise.resolve();
  readonly origin: string;

  constructor(
    origin: string,
    private readonly store: StoragePort,
    private readonly fetch: FetchPort,
    private readonly now = Date.now,
  ) {
    this.origin = stagingOrigin(origin);
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
      const raw = await this.store.get(key);
      if (!raw) return null;
      try {
        const saved = JSON.parse(raw);
        const parsed = credential(saved);
        if (saved.origin === this.origin && parsed.expiresAt > this.now()) {
          this.current = parsed;
          return { expiresAt: parsed.expiresAt };
        }
      } catch {
        // Invalid stored envelopes are discarded.
      }
      this.current = null;
      await this.store.remove(key);
      return null;
    });
  }

  signIn(email: string, password: string) {
    return this.serialize(async () => {
      const raw = (await this.request("/api/mobile/session", undefined, {
        email: email.trim(),
        password,
      })) as { token?: unknown; expiresAt?: unknown };
      const entry = credential({
        token: raw?.token,
        expiresAt:
          typeof raw?.expiresAt === "string" ? Date.parse(raw.expiresAt) : NaN,
      });
      if (entry.expiresAt <= this.now()) throw new StagingHttpError(502);
      try {
        await this.store.set(
          key,
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

  async redeem(): Promise<StagingSession> {
    throw new StagingHttpError(403);
  }

  signOut() {
    return this.serialize(async () => {
      const session = this.current;
      this.current = null;
      try {
        await this.store.remove(key);
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
      await this.request("/api/mobile/session/revoke", session, {});
    } catch (err) {
      if (err instanceof StagingHttpError && err.status === 401) return;
      throw new Error(
        "La sesión se borró del teléfono. No se pudo confirmar la revocación en el servidor.",
      );
    }
  }

  private clear(session: Credential) {
    return this.serialize(async () => {
      if (this.current !== session) return;
      this.current = null;
      await this.store.remove(key);
    });
  }

  async read(path: string): Promise<unknown> {
    if (!/^\/api\/conversations(?:\?[^#]*|\/[\w%-]+\/messages)$/.test(path))
      throw new StagingHttpError(403);
    const session = this.current;
    if (!session || session.expiresAt <= this.now()) {
      if (session) await this.clear(session).catch(() => {});
      throw new StagingHttpError(401);
    }
    try {
      const data = await this.request(path, session);
      if (this.current !== session) throw new StagingHttpError(401);
      return data;
    } catch (err) {
      if (
        err instanceof StagingHttpError &&
        (err.status === 401 || err.code === "organization_suspended")
      )
        await this.clear(session).catch(() => {});
      throw err;
    }
  }

  private async request(path: string, session?: Credential, body?: object) {
    const headers = new Headers({ accept: "application/json" });
    if (session) headers.set("authorization", `Bearer ${session.token}`);
    if (body) headers.set("content-type", "application/json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetch(this.origin + path, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      const value = await response.json().catch(() => null);
      if (!response.ok)
        throw new StagingHttpError(
          response.status,
          value?.error?.code ?? value?.code,
          path === "/api/mobile/session",
        );
      if (!value) throw new StagingHttpError(502);
      return value;
    } catch (error) {
      if (error instanceof StagingHttpError) throw error;
      throw new StagingHttpError(0);
    } finally {
      clearTimeout(timeout);
    }
  }
}
