import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conexión directa (PR 5) — modo del chat: reglas puras, regreso automático a
 * Oficial cuando el contacto escribe, y que sin el complemento no pase nada.
 */

const state = vi.hoisted(() => ({
  moduleOn: true,
  autoReturn: true,
  updates: 0,
  returned: [{ id: "cv_1" }] as { id: string }[],
  published: [] as unknown[],
}));

vi.mock("@/server/modules", () => ({ orgHasConexionDirecta: async () => state.moduleOn }));
vi.mock("@/server/direct-connection/settings", () => ({
  getDirectSettings: async () => ({ autoReturnToMeta: state.autoReturn, defaultMode: "meta" }),
}));
vi.mock("@/server/credentials/direct", () => ({ getConnection: async () => null }));
vi.mock("@/server/events/bus", () => ({ publish: (_o: string, e: unknown) => state.published.push(e) }));
vi.mock("@/lib/db", () => ({
  schema: {
    conversation: { organizationId: "organization_id", id: "id", connectionMode: "connection_mode" },
  },
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            state.updates++;
            return state.returned;
          },
        }),
      }),
    }),
  }),
}));

import { autoReturnOnInbound, deviceReady } from "@/server/direct-connection/mode";
import { modeDotLabel, receivesViaMeta, modeFromDirectToggle, MODE_PICKER_TEXT } from "@/lib/direct-connection";
import { modeDotClass } from "@/components/inbox/chat-mode-dot";

const conv = (connectionMode: string | null, channel = "whatsapp") => ({ id: "cv_1", channel, connectionMode });

beforeEach(() => {
  state.moduleOn = true;
  state.autoReturn = true;
  state.updates = 0;
  state.returned = [{ id: "cv_1" }];
  state.published = [];
});

describe("conexión directa — punto de color", () => {
  it("verde Oficial, azul Directa, morado Directa con «Recibir por Meta»", () => {
    expect(modeDotClass("meta")).toContain("success");
    expect(modeDotClass("directa")).toContain("info");
    expect(modeDotClass("mixta")).toContain("8b5cf6");
  });

  it("los nombres son discretos y Mixta es Directa con el interruptor", () => {
    expect(modeDotLabel("meta")).toBe("Oficial");
    expect(modeDotLabel("directa")).toBe("Directa");
    expect(modeDotLabel("mixta")).toContain("Recibir por Meta");
    expect(receivesViaMeta(modeFromDirectToggle(true))).toBe(true);
    expect(receivesViaMeta(modeFromDirectToggle(false))).toBe(false);
    expect(JSON.stringify(MODE_PICKER_TEXT)).not.toMatch(/no\s*oficial|evolution|baileys/i);
  });
});

describe("conexión directa — dispositivo listo", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  it("solo conectado y sin pausa", () => {
    expect(deviceReady(null, now)).toBe(false);
    expect(deviceReady({ status: "pending", pausedUntil: null }, now)).toBe(false);
    expect(deviceReady({ status: "disconnected", pausedUntil: null }, now)).toBe(false);
    expect(deviceReady({ status: "connected", pausedUntil: null }, now)).toBe(true);
    expect(deviceReady({ status: "connected", pausedUntil: new Date("2026-10-23T00:00:00Z") }, now)).toBe(false);
    expect(deviceReady({ status: "connected", pausedUntil: new Date("2026-10-21T00:00:00Z") }, now)).toBe(true);
  });
});

describe("conexión directa — regreso automático a Oficial", () => {
  it("un chat en Directa o Mixta vuelve a Oficial cuando el contacto escribe, y avisa a la Bandeja", async () => {
    expect(await autoReturnOnInbound("org_a", conv("directa"))).toBe(true);
    expect(await autoReturnOnInbound("org_a", conv("mixta"))).toBe(true);
    expect(state.updates).toBe(2);
    expect(state.published).toHaveLength(2);
  });

  it("un chat en Oficial, sin modo o de otro canal no toca la base", async () => {
    expect(await autoReturnOnInbound("org_a", conv("meta"))).toBe(false);
    expect(await autoReturnOnInbound("org_a", conv(null))).toBe(false);
    expect(await autoReturnOnInbound("org_a", conv("directa", "instagram"))).toBe(false);
    expect(state.updates).toBe(0);
  });

  it("sin el complemento o con el regreso apagado, el chat se queda como está", async () => {
    state.moduleOn = false;
    expect(await autoReturnOnInbound("org_a", conv("directa"))).toBe(false);
    state.moduleOn = true;
    state.autoReturn = false;
    expect(await autoReturnOnInbound("org_a", conv("directa"))).toBe(false);
    expect(state.updates).toBe(0);
  });

  it("si otro proceso ya lo regresó, no avisa dos veces", async () => {
    state.returned = [];
    expect(await autoReturnOnInbound("org_a", conv("directa"))).toBe(false);
    expect(state.published).toHaveLength(0);
  });
});
