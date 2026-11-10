import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría de seguridad (2026-11) — El canal SSE vive horas, así que vuelve
 * a preguntar por la sesión cada minuto. Antes, quien abría `/api/events`
 * como Propietario o Coordinador seguía recibiendo el texto de TODOS los
 * mensajes del negocio aunque cerrara sesión, lo sacaran del equipo, le
 * bajaran el rol a Asesor o se suspendiera la organización, mientras no
 * soltara la conexión.
 */

type Ctx = { userId: string; organizationId: string; role: string; access: { organizationId: string; userId: string; seesAll: boolean } };
const state = vi.hoisted(() => ({
  session: null as unknown,
  now: null as unknown,
  fails: false,
  visible: false,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
  sessionFromHeaders: async () => {
    if (state.fails) throw new Error("base caída");
    return state.now;
  },
}));
vi.mock("@/server/events/visibility", () => ({
  canSeeEvent: async () => state.visible,
  canSeeTeamEvent: () => false,
}));

import { publish, type SseEvent } from "@/server/events/bus";
import { GET } from "@/app/api/events/route";

const ctx = (role: string, org = "org_rev"): Ctx => ({
  userId: "usr_x",
  organizationId: org,
  role,
  access: { organizationId: org, userId: "usr_x", seesAll: role !== "asesor" },
});

const mensaje: SseEvent = {
  type: "message.new",
  data: { conversationId: "cv_ajeno", message: { id: "msg_1", text: "texto de un chat ajeno" } },
} as unknown as SseEvent;

async function abrir() {
  const ctl = new AbortController();
  const res = await GET(new Request("http://localhost/api/events", { signal: ctl.signal }));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  let done = false;
  const pump = (async () => {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        text += dec.decode(r.value, { stream: true });
      }
    } catch {
      /* abortado */
    }
    done = true;
  })();
  return {
    texto: () => text,
    cerrado: () => done,
    cerrar: async () => {
      ctl.abort();
      await reader.cancel().catch(() => {});
      await pump;
    },
  };
}

/** Deja correr el minuto de la revalidación y lo que encadena. */
async function pasaUnMinuto() {
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.advanceTimersByTimeAsync(5);
}

describe("/api/events vuelve a revisar la sesión", () => {
  let canal: Awaited<ReturnType<typeof abrir>>;
  beforeEach(() => {
    vi.useFakeTimers();
    state.fails = false;
    state.visible = false;
  });
  afterEach(async () => {
    await canal.cerrar();
    vi.useRealTimers();
  });

  it("sesión que sigue valiendo: el canal sigue abierto y entrega", async () => {
    state.session = state.now = ctx("owner");
    canal = await abrir();
    await pasaUnMinuto();
    publish("org_rev", mensaje);
    await vi.advanceTimersByTimeAsync(5);
    expect(canal.cerrado()).toBe(false);
    expect(canal.texto()).toContain("texto de un chat ajeno");
  });

  it("sin sesión (cerró sesión, la sacaron del equipo, organización suspendida): se cierra y ya no llega nada", async () => {
    state.session = ctx("owner");
    state.now = null;
    canal = await abrir();
    await pasaUnMinuto();
    expect(canal.cerrado()).toBe(true);
    publish("org_rev", mensaje);
    await vi.advanceTimersByTimeAsync(5);
    expect(canal.texto()).not.toContain("texto de un chat ajeno");
  });

  it("la sesión ahora es de otra organización: se cierra", async () => {
    state.session = ctx("owner");
    state.now = ctx("owner", "org_otra");
    canal = await abrir();
    await pasaUnMinuto();
    expect(canal.cerrado()).toBe(true);
  });

  it("le bajaron el rol a Asesor: deja de recibir los chats que ya no ve", async () => {
    state.session = ctx("coordinador");
    state.now = ctx("asesor");
    canal = await abrir();
    publish("org_rev", { ...mensaje, data: { ...mensaje.data, message: { id: "msg_0", text: "antes del cambio" } } } as SseEvent);
    await vi.advanceTimersByTimeAsync(5);
    expect(canal.texto()).toContain("antes del cambio");
    await pasaUnMinuto();
    publish("org_rev", mensaje);
    await vi.advanceTimersByTimeAsync(5);
    expect(canal.cerrado()).toBe(false);
    expect(canal.texto()).not.toContain("texto de un chat ajeno");
  });

  it("si la base no contesta no se corta: se reintenta al minuto siguiente", async () => {
    state.session = ctx("owner");
    state.now = null;
    state.fails = true;
    canal = await abrir();
    await pasaUnMinuto();
    expect(canal.cerrado()).toBe(false);
    state.fails = false;
    await pasaUnMinuto();
    expect(canal.cerrado()).toBe(true);
  });
});
