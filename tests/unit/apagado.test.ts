import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { classifySendError } from "@/server/campaigns/outcome";
import { SendError } from "@/server/inbox/send";
import {
  acceptsWebhooks,
  advancePendingAgentTurns,
  beginTask,
  DEFAULT_GRACE_MS,
  graceMs,
  installShutdownHandler,
  isShuttingDown,
  onShutdown,
  resetShutdownForTests,
  shutdown,
  WEBHOOK_CUTOFF_MS,
} from "@/server/shutdown";

/** Operación 1 (spec 043, apagado.md) — el apagado limpio y el tope de Meta. */

const RAIZ = path.resolve(import.meta.dirname, "../..");

/** Reloj falso: `sleep` avanza el tiempo sin esperar de verdad. */
function reloj() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      await Promise.resolve();
    },
  };
}

describe("apagado limpio", () => {
  beforeEach(() => resetShutdownForTests());
  afterEach(() => {
    resetShutdownForTests();
    (globalThis as { __agentCoalesce?: unknown }).__agentCoalesce = undefined;
  });

  it("detiene, espera lo que está en curso, cierra los pools y sale con 0", async () => {
    const r = reloj();
    const orden: string[] = [];
    let terminar!: () => void;
    const enCurso = new Promise<void>((res) => (terminar = res));
    onShutdown("campañas", { stop: () => orden.push("stop"), drain: () => enCurso.then(() => void orden.push("drain")) });
    const webhook = beginTask("webhook:wa");
    const exit = vi.fn();
    const closePools = vi.fn(async () => void orden.push("pools"));

    const corriendo = shutdown("SIGTERM", { ...r, exit, closePools, graceMs: 25_000, minDrainMs: 0 });
    expect(isShuttingDown()).toBe(true);
    await r.sleep(500);
    expect(exit).not.toHaveBeenCalled();
    terminar();
    await r.sleep(500);
    webhook.end();
    const rep = await corriendo;

    expect(rep).toMatchObject({ timedOut: false, pending: [] });
    expect(orden).toEqual(["stop", "drain", "pools"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("espera un mínimo (peticiones HTTP en vuelo) aunque no haya nada registrado", async () => {
    const r = reloj();
    const exit = vi.fn();
    const rep = await shutdown("SIGTERM", { ...r, exit, closePools: async () => {}, graceMs: 25_000, minDrainMs: 3_000 });
    expect(rep!.ms).toBeGreaterThanOrEqual(3_000);
    expect(rep!.ms).toBeLessThan(4_000);
  });

  it("con tope: lo que no termina se deja (y se dice qué) y sale igual", async () => {
    const r = reloj();
    onShutdown("campañas", { drain: () => new Promise(() => {}) });
    beginTask("webhook:wa");
    const exit = vi.fn();
    const rep = await shutdown("SIGTERM", { ...r, exit, closePools: async () => {}, graceMs: 2_000, minDrainMs: 0 });
    expect(rep!.timedOut).toBe(true);
    expect(rep!.pending.join(" ")).toMatch(/campañas/);
    expect(rep!.pending.join(" ")).toMatch(/webhook:wa/);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("una segunda señal no arranca otro apagado", async () => {
    const r = reloj();
    const exit = vi.fn();
    const deps = { ...r, exit, closePools: async () => {}, graceMs: 1_000, minDrainMs: 0 };
    const [a, b] = await Promise.all([shutdown("SIGTERM", deps), shutdown("SIGINT", deps)]);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("webhooks: se aceptan mientras quede tiempo para procesarlos; si no, 503", async () => {
    expect(acceptsWebhooks()).toBe(true);
    let t = 0;
    const p = shutdown("SIGTERM", {
      now: () => t,
      sleep: () => new Promise(() => {}), // se queda «apagándose» para mirar
      exit: () => {},
      closePools: async () => {},
      graceMs: 25_000,
      minDrainMs: 60_000,
    });
    void p;
    expect(acceptsWebhooks(0)).toBe(true);
    expect(acceptsWebhooks(25_000 - WEBHOOK_CUTOFF_MS - 1)).toBe(true);
    expect(acceptsWebhooks(25_000 - WEBHOOK_CUTOFF_MS)).toBe(false);
    t = 1;
  });

  it("adelanta los turnos del agente que esperaban su ventana (sin tocar pipeline.ts)", () => {
    const corrio = vi.fn();
    const timer = setTimeout(corrio, 60_000) as unknown as ReturnType<typeof setTimeout>;
    const enCurso = { timer: null, running: true, pending: false };
    const map = new Map<string, { timer: ReturnType<typeof setTimeout> | null; running: boolean; pending: boolean }>([
      ["cv_espera", { timer, running: false, pending: false }],
      ["cv_corre", enCurso],
    ]);
    expect(advancePendingAgentTurns(map)).toBe(1);
    expect(corrio).toHaveBeenCalledTimes(1);
    // El temporizador quedó cancelado: no corre dos veces.
    expect(advancePendingAgentTurns(map)).toBe(0);
  });

  it("el apagado espera a que el mapa de turnos del agente se vacíe", async () => {
    const r = reloj();
    const map = new Map([["cv_1", { timer: null, running: true, pending: false }]]);
    (globalThis as { __agentCoalesce?: unknown }).__agentCoalesce = map;
    const exit = vi.fn();
    const corriendo = shutdown("SIGTERM", { ...r, exit, closePools: async () => {}, graceMs: 25_000, minDrainMs: 0 });
    await r.sleep(1_000);
    expect(exit).not.toHaveBeenCalled();
    map.delete("cv_1");
    expect((await corriendo)!.timedOut).toBe(false);
  });

  it("solo se instala con NEXT_MANUAL_SIG_HANDLE=true (sin ella, Next conserva el suyo)", () => {
    vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "");
    expect(installShutdownHandler()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("SHUTDOWN_GRACE_MS: valor válido o el de por defecto", () => {
    expect(graceMs("12000")).toBe(12_000);
    expect(graceMs("")).toBe(DEFAULT_GRACE_MS);
    expect(graceMs("10")).toBe(DEFAULT_GRACE_MS);
    expect(graceMs("abc")).toBe(DEFAULT_GRACE_MS);
    // Debe caber en el «Stop grace period» de Coolify (30 s por defecto).
    expect(DEFAULT_GRACE_MS).toBeLessThan(30_000);
  });
});

describe("tope de las llamadas a Meta", () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    // Un «Meta» que acepta la conexión y nunca responde.
    server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("META_GRAPH_BASE_URL", base);
    resetEnvCacheForTests();
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("una llamada colgada se corta y queda marcada como tiempo agotado", async () => {
    const err = await graphRequest("123/messages", { method: "POST", token: "t", body: {}, timeoutMs: 200 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ status: 0, timedOut: true });
  });

  it("un error de red NO es tiempo agotado", async () => {
    vi.stubEnv("META_GRAPH_BASE_URL", "http://127.0.0.1:1");
    resetEnvCacheForTests();
    const err = await graphRequest("x", { token: "t", timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, timedOut: false });
  });
});

describe("campañas: tiempo agotado = interrumpido (sin reintento)", () => {
  it("se marca fallido y NO se reintenta; «Meta caído» sí se reintenta", () => {
    const timeout = new SendError("meta_unavailable", "Meta no respondió a tiempo");
    timeout.timedOut = true;
    expect(classifySendError(timeout)).toMatchObject({ kind: "fail", countsForHealth: false });
    expect(classifySendError(new SendError("meta_unavailable", "Meta no está disponible ahora"))).toMatchObject({ kind: "retry" });
  });

  it("la reserva del mensaje se conserva (fallida) en vez de borrarse", () => {
    // Si se borrara, `recoverAbandoned` o un reintento podrían volver a enviarlo.
    const src = readFileSync(path.join(RAIZ, "src/server/whatsapp/templates.ts"), "utf8");
    const i = src.indexOf("err instanceof SendError && err.timedOut");
    expect(i).toBeGreaterThan(0);
    const bloque = src.slice(i, src.indexOf("throw err;", i));
    expect(bloque).toMatch(/status: "failed"/);
    expect(bloque).not.toMatch(/\.delete\(/);
  });
});

describe("imagen: la señal llega a Node", () => {
  const dockerfile = readFileSync(path.join(RAIZ, "Dockerfile"), "utf8");
  it("tini es el PID 1, Node reemplaza a la shell y Next no instala su manejador", () => {
    expect(dockerfile).toMatch(/ENTRYPOINT \["\/sbin\/tini", "-g", "--", "vocero-entrypoint\.sh"\]/);
    expect(dockerfile).toMatch(/CMD \["sh", "-c", "node migrate\.mjs && exec node server\.js"\]/);
    expect(dockerfile).toMatch(/ENV NEXT_MANUAL_SIG_HANDLE=true/);
  });
});
