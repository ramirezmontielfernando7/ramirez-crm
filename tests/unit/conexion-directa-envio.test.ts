import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIRECT_SETTINGS } from "@/lib/direct-connection";
import {
  brakeAfterFailure,
  classifyFailure,
  directNumber,
  failureText,
  nextSlot,
  phoneFromDirect,
  routeFor,
  typingDelayMs,
  unavailableText,
  type RouteInput,
} from "@/lib/direct-send";

/**
 * Conexión directa (PR 3) — envío por el dispositivo vinculado: por dónde
 * sale cada mensaje, la fila con los límites, el freno de emergencia, los
 * textos discretos y que la IA, las campañas y el cerebro externo NUNCA
 * puedan usar esta vía.
 */

const NOW = new Date("2026-11-20T12:00:00Z");
const at = (s: number) => new Date(NOW.getTime() + s * 1000);

function input(over: Partial<RouteInput> = {}): RouteInput {
  return {
    moduleOn: true,
    allowDirect: true,
    channel: "whatsapp",
    chatMode: "mixta",
    settings: { defaultMode: "meta", preferMetaInWindow: false },
    connection: { status: "connected", pausedUntil: null },
    windowOpen: false,
    now: NOW,
    ...over,
  };
}

describe("conexión directa — por dónde sale cada mensaje", () => {
  it("Directa y Automática salen por el dispositivo", () => {
    expect(routeFor(input({ chatMode: "directa" }))).toEqual({ via: "directa" });
    expect(routeFor(input({ chatMode: "mixta" }))).toEqual({ via: "directa" });
  });

  it("sin módulo, sin permiso (IA, campañas, cerebro externo), fuera de WhatsApp o en modo Meta: Meta, como siempre", () => {
    expect(routeFor(input({ moduleOn: false }))).toEqual({ via: "meta" });
    expect(routeFor(input({ allowDirect: false }))).toEqual({ via: "meta" });
    expect(routeFor(input({ channel: "instagram" }))).toEqual({ via: "meta" });
    expect(routeFor(input({ chatMode: "meta" }))).toEqual({ via: "meta" });
  });

  it("sin modo propio, el chat usa el de la organización", () => {
    expect(routeFor(input({ chatMode: null }))).toEqual({ via: "meta" });
    expect(routeFor(input({ chatMode: null, settings: { defaultMode: "directa", preferMetaInWindow: false } }))).toEqual({
      via: "directa",
    });
  });

  it("sin dispositivo vinculado nada cambia (Meta)", () => {
    expect(routeFor(input({ connection: null }))).toEqual({ via: "meta" });
    expect(routeFor(input({ connection: { status: "pending", pausedUntil: null } }))).toEqual({ via: "meta" });
  });

  it("«Usar Meta mientras la ventana esté abierta»: con ventana abierta, Meta; cerrada, el dispositivo", () => {
    const settings = { defaultMode: "meta" as const, preferMetaInWindow: true };
    expect(routeFor(input({ settings, windowOpen: true }))).toEqual({ via: "meta" });
    expect(routeFor(input({ settings, windowOpen: false }))).toEqual({ via: "directa" });
  });

  it("en pausa o desconectado: falla claro, nunca cae solo a Meta", () => {
    expect(routeFor(input({ connection: { status: "connected", pausedUntil: at(60) } }))).toEqual({
      via: "unavailable",
      reason: "paused",
    });
    expect(routeFor(input({ connection: { status: "connected", pausedUntil: at(-60) } }))).toEqual({ via: "directa" });
    expect(routeFor(input({ connection: { status: "disconnected", pausedUntil: null } }))).toEqual({
      via: "unavailable",
      reason: "disconnected",
    });
    expect(routeFor(input({ connection: { status: "connecting", pausedUntil: null } }))).toEqual({
      via: "unavailable",
      reason: "disconnected",
    });
  });

  it("el número va solo en dígitos; México como lo usa el dispositivo (521 + 10); sin teléfono, null", () => {
    expect(directNumber("+52 1 55 1234 0000")).toBe("5215512340000");
    expect(directNumber("5215512340000")).toBe("5215512340000");
    // Como lo guarda Dashfort (52 + 10) → 521 + 10.
    expect(directNumber("525512340000")).toBe("5215512340000");
    expect(directNumber("14155550100")).toBe("14155550100");
    expect(directNumber(null)).toBeNull();
    expect(directNumber("123")).toBeNull();
  });

  it("lo que llega del dispositivo vuelve a la forma de Dashfort (52 + 10)", () => {
    expect(phoneFromDirect("5215512340000@s.whatsapp.net")).toBe("525512340000");
    expect(phoneFromDirect("5215512340000")).toBe("525512340000");
    expect(phoneFromDirect("14155550100@s.whatsapp.net")).toBe("14155550100");
    expect(phoneFromDirect(directNumber("525512340000")!)).toBe("525512340000");
  });
});

describe("conexión directa — límites de envío y fila", () => {
  const limits = { enabled: true, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 };

  it("sin envíos recientes sale ya", () => {
    expect(nextSlot(NOW, "cv_1", [], limits)).toEqual(NOW);
  });

  it("1 cada 8 s en toda la cuenta, aunque sea otro chat", () => {
    expect(nextSlot(NOW, "cv_2", [{ at: at(-3), conversationId: "cv_1" }], limits)).toEqual(at(5));
    expect(nextSlot(NOW, "cv_2", [{ at: at(-30), conversationId: "cv_1" }], limits)).toEqual(NOW);
  });

  it("la fila sale en orden: después del último ya agendado, nunca en ráfaga", () => {
    const recent = [
      { at: at(0), conversationId: "cv_1" },
      { at: at(8), conversationId: "cv_1" },
      { at: at(16), conversationId: "cv_2" },
    ];
    expect(nextSlot(NOW, "cv_3", recent, limits)).toEqual(at(24));
  });

  it("5 por minuto por chat: el 6.º espera a que salga de la ventana el primero", () => {
    const sinIntervalo = { ...limits, minIntervalSeconds: 0 };
    const recent = [0, 5, 10, 15, 20].map((s) => ({ at: at(s - 30), conversationId: "cv_1" }));
    expect(nextSlot(NOW, "cv_1", recent, sinIntervalo)).toEqual(at(30));
    // Otro chat no espera por el límite por chat.
    expect(nextSlot(NOW, "cv_2", recent, sinIntervalo)).toEqual(NOW);
  });

  it("60 por hora en total", () => {
    const sinIntervalo = { ...limits, minIntervalSeconds: 0, perChatPerMinute: 60 };
    const recent = Array.from({ length: 60 }, (_, i) => ({ at: at(-3000 + i * 10), conversationId: `cv_${i}` }));
    expect(nextSlot(NOW, "cv_x", recent, sinIntervalo)).toEqual(at(600));
  });

  it("con los límites apagados sale ya, aunque haya ráfaga", () => {
    const recent = [{ at: at(-1), conversationId: "cv_1" }];
    expect(nextSlot(NOW, "cv_1", recent, { ...limits, enabled: false })).toEqual(NOW);
  });

  it("«escribiendo…» dura de 1 a 3 segundos", () => {
    expect(typingDelayMs(() => 0)).toBe(1000);
    expect(typingDelayMs(() => 0.999)).toBeLessThanOrEqual(3000);
    for (let i = 0; i < 50; i++) {
      const d = typingDelayMs();
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
    }
  });

  it("los límites de fábrica son 8 s, 5 por minuto por chat y 60 por hora", () => {
    expect(DEFAULT_DIRECT_SETTINGS).toMatchObject({ limitsEnabled: true, minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 });
  });
});

describe("conexión directa — fallos y freno de emergencia", () => {
  it("clasifica: sin respuesta o 5xx = dispositivo; número sin WhatsApp = del contacto; bloqueo = ban", () => {
    expect(classifyFailure({ status: 0, message: "sin respuesta", timedOut: true })).toBe("connection");
    expect(classifyFailure({ status: 500, message: "boom" })).toBe("connection");
    expect(classifyFailure({ status: 401, message: "Unauthorized" })).toBe("connection");
    expect(classifyFailure({ status: 404, message: "instance does not exist" })).toBe("connection");
    expect(
      classifyFailure({ status: 400, message: "Bad Request", details: { response: { message: [{ exists: false, number: "52" }] } } })
    ).toBe("recipient");
    expect(classifyFailure({ status: 400, message: "Connection Closed" })).toBe("connection");
    expect(classifyFailure({ status: 400, message: "invalid media" })).toBe("request");
    expect(classifyFailure({ status: 403, message: "account banned" })).toBe("ban");
  });

  const limpio = { disconnectCount: 0, disconnectWindowStart: null, pausedUntil: null, pauseReason: null };

  it("un fallo cuenta; el segundo en 24 h apaga la directa 24 h", () => {
    const uno = brakeAfterFailure(limpio, "connection", NOW)!;
    expect(uno).toMatchObject({ disconnectCount: 1, disconnectWindowStart: NOW, pausedUntil: null });
    const dos = brakeAfterFailure(uno, "connection", at(3600))!;
    expect(dos.disconnectCount).toBe(2);
    expect(dos.pausedUntil).toEqual(at(3600 + 24 * 3600));
    expect(dos.pauseReason).toBe("disconnects");
  });

  it("pasadas 24 h el conteo vuelve a empezar", () => {
    const uno = brakeAfterFailure(limpio, "connection", NOW)!;
    const otroDia = brakeAfterFailure(uno, "connection", at(24 * 3600 + 1))!;
    expect(otroDia).toMatchObject({ disconnectCount: 1, pausedUntil: null });
  });

  it("un bloqueo apaga ya, sin esperar el segundo", () => {
    const b = brakeAfterFailure(limpio, "ban", NOW)!;
    expect(b.pauseReason).toBe("ban");
    expect(b.pausedUntil).toEqual(at(24 * 3600));
  });

  it("un número sin WhatsApp o un archivo rechazado no cuentan", () => {
    expect(brakeAfterFailure(limpio, "recipient", NOW)).toBeNull();
    expect(brakeAfterFailure(limpio, "request", NOW)).toBeNull();
  });

  it("una pausa más larga ya puesta no se acorta", () => {
    const largo = { ...limpio, disconnectCount: 1, disconnectWindowStart: NOW, pausedUntil: at(48 * 3600), pauseReason: "manual" as const };
    expect(brakeAfterFailure(largo, "connection", at(10))!.pausedUntil).toEqual(at(48 * 3600));
  });

  it("textos discretos: nunca «no oficial», «Evolution» ni «Baileys»", () => {
    const prohibido = /no\s*oficial|evolution|baileys/i;
    const textos = [
      unavailableText("paused"),
      unavailableText("disconnected"),
      unavailableText("module_off"),
      ...(["ban", "connection", "recipient", "request"] as const).map(failureText),
    ];
    for (const t of textos) expect(t, t).not.toMatch(prohibido);
  });
});

/* ───────── Guardarraíles estáticos ───────── */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(ROOT, "src");

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e);
    if (statSync(f).isDirectory()) out.push(...archivos(f));
    else if (/\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const todos = archivos(SRC).map((f) => ({ rel: rel(f), src: readFileSync(f, "utf8") }));

describe("conexión directa — guardarraíles del envío", () => {
  it("solo la Bandeja (src/server/inbox/send.ts) y «Mi número» de una persona usan la vía directa", () => {
    const quien = todos.filter((f) => /from\s+["']@\/server\/direct-connection\/send["']/.test(f.src)).map((f) => f.rel);
    // 046 (PR 5): una persona contesta SUS chats por su número; `send-http.ts` solo traduce el error.
    expect(quien.sort()).toEqual(["src/server/inbox/send.ts", "src/server/mi-numero/send-http.ts", "src/server/mi-numero/send.ts"]);
    // instrumentation.ts la importa dinámicamente, solo para retomar la fila.
    const dinamico = todos.filter((f) => /import\(\s*["']@\/server\/direct-connection\/send["']\s*\)/.test(f.src)).map((f) => f.rel);
    expect(dinamico).toEqual(["src/instrumentation.ts"]);
  });

  it("solo la vía directa habla con el cliente de mensajes del dispositivo", () => {
    const quien = todos.filter((f) => /@\/lib\/evolution\/client/.test(f.src)).map((f) => f.rel);
    // PR 6: la descarga de archivos que ENTRAN (empresa sin Meta) no envía nada.
    expect(quien.sort()).toEqual([
      "src/server/credentials/direct-instance.ts",
      "src/server/direct-connection/inbound-media.ts",
      "src/server/direct-connection/send.ts",
    ]);
  });

  it("046: el envío por «Mi número» solo lo piden las rutas de MIS chats y la IA conectada del dueño (047 PR 4b)", () => {
    const quien = todos.filter((f) => /from\s+["']@\/server\/mi-numero\/send["']/.test(f.src)).map((f) => f.rel);
    expect(quien.sort()).toEqual([
      "src/app/api/my-number/chats/[id]/messages/media/route.ts",
      "src/app/api/my-number/chats/[id]/messages/route.ts",
      "src/server/ai-connector/my-number.ts",
      "src/server/mi-numero/knowledge.ts",
    ]);
    // La IA conectada solo manda TEXTO, solo a chats de cliente de SU número
    // (`aiNumberChat` lo revisa justo antes) y con el quinto interruptor.
    const ia = todos.find((f) => f.rel === "src/server/ai-connector/my-number.ts")!.src;
    expect(ia).toMatch(/const chat = await aiNumberChat\(session, conversationId\);\s*if \(!chat\) return null;/);
    expect(ia).toMatch(/sendFromMyNumber\([^)]*\{ text \}, via\)/);
    expect(ia).toMatch(/!row\.aiConnector \|\| !row\.shareClients/);
    expect(ia).toMatch(/isNotNull\(schema\.conversation\.clientMarkedAt\)/);
  });

  it("046 (PR 8): la IA sale por un «Mi número» solo desde el envío de texto de la Bandeja (`numberAiRoute`)", () => {
    const quien = todos.filter((f) => /\bnumberAiRoute\b/.test(f.src)).map((f) => f.rel);
    expect(quien.sort()).toEqual(["src/server/inbox/send.ts", "src/server/mi-numero/ai.ts"]);
    // Y solo cuando el texto es de la IA: `sendText` lo consulta dentro de `if (input.aiGenerated)`.
    const send = todos.find((f) => f.rel === "src/server/inbox/send.ts")!.src;
    expect(send).toMatch(/if \(input\.aiGenerated\) \{\s*const route = await numberAiRoute\(/);
  });

  it("allowDirect: true solo en las rutas de la Bandeja y en la IA conectada de una persona (047, Fer 2026-10-28)", () => {
    const quien = todos.filter((f) => /allowDirect:\s*true/.test(f.src)).map((f) => f.rel);
    expect(quien.sort()).toEqual([
      "src/app/api/conversations/[id]/messages/knowledge/route.ts",
      "src/app/api/conversations/[id]/messages/media/route.ts",
      "src/app/api/conversations/[id]/messages/route.ts",
      "src/server/ai-connector/tools.ts",
    ]);
    // La IA conectada solo manda TEXTO por esa vía (con su tope diario), nunca archivos.
    const tools = todos.find((f) => f.rel === "src/server/ai-connector/tools.ts")!.src;
    expect(tools).not.toMatch(/sendMedia|sendFile/);
  });

  it("la IA, las campañas, el cerebro externo y las bajas nunca piden la vía directa", () => {
    const vigilados = todos.filter(
      (f) =>
        f.rel === "src/server/ai/pipeline.ts" ||
        f.rel.startsWith("src/server/ai/") ||
        f.rel.startsWith("src/server/campaigns/") ||
        f.rel.startsWith("src/app/api/bot/") ||
        f.rel.startsWith("src/app/api/campaigns/") ||
        f.rel === "src/server/inbox/opt-out.ts" ||
        f.rel === "src/server/whatsapp/templates.ts" ||
        f.rel.startsWith("src/server/knowledge/")
    );
    expect(vigilados.length).toBeGreaterThan(5);
    for (const f of vigilados) {
      expect(f.src, f.rel).not.toMatch(/allowDirect|direct-connection\/send|lib\/evolution|direct-send/);
    }
  });

  it("un texto de la IA sale por Meta aunque alguien pase allowDirect", () => {
    const send = readFileSync(path.join(SRC, "server/inbox/send.ts"), "utf8");
    expect(send).toMatch(/allowDirect:\s*input\.allowDirect === true && !input\.aiGenerated/);
  });

  it("las plantillas y la ubicación/contactos no conocen la vía directa", () => {
    const send = readFileSync(path.join(SRC, "server/inbox/send.ts"), "utf8");
    const structured = send.slice(send.indexOf("export async function sendStructured"), send.indexOf("async function viaDirect"));
    expect(structured).not.toMatch(/allowDirect|viaDirect/);
  });
});
