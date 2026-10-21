import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Conexión directa (PR 1) — reglas puras, delegaciones, textos discretos y
 * que el complemento no se cuele entre los 13 interruptores ni en el plan.
 */

const state = vi.hoisted(() => ({ moduleOn: false, settingsCalls: 0, fail: false, row: null as null | Record<string, unknown> }));

vi.mock("@/server/modules", () => ({
  orgHasConexionDirecta: async () => state.moduleOn,
}));
vi.mock("@/server/direct-connection/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/direct-connection/settings")>();
  const { DEFAULT_DIRECT_SETTINGS } = await import("@/lib/direct-connection");
  return {
    ...original,
    getDirectSettings: async () => {
      state.settingsCalls++;
      if (state.fail) throw new Error("boom");
      return { ...DEFAULT_DIRECT_SETTINGS, ...(state.row ?? {}) };
    },
  };
});

import {
  CONNECTION_MODE_LABEL,
  CONNECTION_STATUS_LABEL,
  DEFAULT_DIRECT_SETTINGS,
  DIRECT_TEXT,
  cleanRoles,
  effectiveMode,
  inboundSourceOf,
  modeFromDirectToggle,
  normalizeServerUrl,
  outboundTransportOf,
  pickServer,
  validateLimits,
} from "@/lib/direct-connection";
import { can } from "@/lib/auth/permissions";
import { countActiveModules, planOfModules, planToggles, PLATFORM_MODULE_TOGGLES } from "@/lib/platform-modules";
import { NEW_MODULE_DEFAULTS } from "@/server/modules/defaults";
import { directConnectionGrants, grantsFromDirectSettings } from "@/server/direct-connection/grants";
import { settingsFromRow } from "@/server/direct-connection/settings";

describe("conexión directa — los tres modos son UN dato", () => {
  it("Oficial entra y sale por Meta; Directa por el dispositivo; Mixta entra por Meta y sale por el dispositivo", () => {
    expect([inboundSourceOf("meta"), outboundTransportOf("meta")]).toEqual(["meta", "meta"]);
    expect([inboundSourceOf("directa"), outboundTransportOf("directa")]).toEqual(["evolution", "directa"]);
    expect([inboundSourceOf("mixta"), outboundTransportOf("mixta")]).toEqual(["meta", "directa"]);
  });

  it("«Recibir por Meta» dentro de Directa es la Mixta", () => {
    expect(modeFromDirectToggle(true)).toBe("mixta");
    expect(modeFromDirectToggle(false)).toBe("directa");
  });

  it("sin modo propio, el chat usa el de la organización", () => {
    expect(effectiveMode(null, "meta")).toBe("meta");
    expect(effectiveMode(undefined, "mixta")).toBe("mixta");
    expect(effectiveMode("directa", "meta")).toBe("directa");
  });

  it("nombres aprobados: Meta, Directa y Automática", () => {
    expect(CONNECTION_MODE_LABEL).toEqual({ meta: "Meta", directa: "Directa", mixta: "Automática" });
  });
});

describe("conexión directa — textos discretos", () => {
  const prohibido = /no\s*oficial|evolution|baileys/i;

  it("ningún texto de pantalla dice «no oficial», «Evolution» ni «Baileys»", () => {
    const textos = [
      ...Object.values(DIRECT_TEXT),
      ...Object.values(CONNECTION_MODE_LABEL),
      ...Object.values(CONNECTION_STATUS_LABEL),
    ];
    for (const t of textos) expect(t, t).not.toMatch(prohibido);
  });

  it("ningún componente ni página dice «no oficial»", () => {
    const raiz = path.resolve(import.meta.dirname, "../..");
    const archivos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : [];
      });
    const mal = [...archivos(path.join(raiz, "src/components")), ...archivos(path.join(raiz, "src/app"))]
      .filter((f) => /no\s*oficial/i.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(raiz, f));
    expect(mal).toEqual([]);
  });
});

describe("conexión directa — configuración avanzada", () => {
  it("los valores por defecto del plan: 1 cada 8 s, 5 por minuto por chat, 60 por hora, activos", () => {
    expect(DEFAULT_DIRECT_SETTINGS).toMatchObject({
      defaultMode: "meta",
      limitsEnabled: true,
      minIntervalSeconds: 8,
      perChatPerMinute: 5,
      perHour: 60,
      preferMetaInWindow: true,
      autoReturnToMeta: true,
      aiViaDirect: false,
      modeRoles: ["coordinador"],
      linkRoles: [],
      limitsRoles: [],
    });
    expect(settingsFromRow(undefined)).toBe(DEFAULT_DIRECT_SETTINGS);
  });

  it("valida los rangos de los límites", () => {
    expect(validateLimits({ minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 60 })).toBeNull();
    expect(validateLimits({ minIntervalSeconds: 0, perChatPerMinute: 1, perHour: 1 })).toBeNull();
    expect(validateLimits({ minIntervalSeconds: -1, perChatPerMinute: 5, perHour: 60 })).toMatch(/minIntervalSeconds/);
    expect(validateLimits({ minIntervalSeconds: 8, perChatPerMinute: 0, perHour: 60 })).toMatch(/perChatPerMinute/);
    expect(validateLimits({ minIntervalSeconds: 8, perChatPerMinute: 5, perHour: 1.5 })).toMatch(/perHour/);
  });

  it("solo roles delegables: el Propietario o un rol inventado se descartan", () => {
    expect(cleanRoles(["owner", "asesor", "x", "coordinador", "asesor"])).toEqual(["coordinador", "asesor"]);
  });
});

describe("conexión directa — servidores", () => {
  it("la dirección debe ser https sin usuario ni parámetros (http solo en localhost)", () => {
    expect(normalizeServerUrl(" https://evo.ejemplo.com/ ")).toBe("https://evo.ejemplo.com");
    expect(normalizeServerUrl("https://evo.ejemplo.com/api//")).toBe("https://evo.ejemplo.com/api");
    expect(normalizeServerUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeServerUrl("http://evo.ejemplo.com")).toBeNull();
    expect(normalizeServerUrl("https://u:p@evo.ejemplo.com")).toBeNull();
    expect(normalizeServerUrl("https://evo.ejemplo.com/?apikey=1")).toBeNull();
    expect(normalizeServerUrl("no es url")).toBeNull();
  });

  it("una empresa nueva cae en el servidor activo con más lugar libre", () => {
    const s = (id: string, status: string, maxInstances: number, used: number) => ({ id, status, maxInstances, used });
    expect(pickServer([s("a", "active", 25, 20), s("b", "active", 25, 3), s("c", "disabled", 100, 0)])?.id).toBe("b");
    expect(pickServer([s("a", "active", 25, 25), s("b", "full", 25, 1)])).toBeNull();
    expect(pickServer([])).toBeNull();
  });
});

describe("conexión directa — permisos delegables", () => {
  it("el Propietario puede todo; los demás solo con la delegación de su organización", () => {
    for (const p of ["direct_connection.mode", "direct_connection.link", "direct_connection.limits"] as const) {
      expect(can({ role: "owner" }, p)).toBe(true);
      expect(can({ role: "coordinador" }, p)).toBe(false);
      expect(can({ role: "asesor" }, p)).toBe(false);
      expect(can({ role: "asesor", grants: [p] }, p)).toBe(true);
      expect(can({ role: "coordinador", grants: [p] }, p)).toBe(true);
      expect(can({ role: "member", grants: [p] }, p)).toBe(false);
    }
  });

  it("de fábrica el Coordinador cambia el modo; vincular y límites, nadie más que el Propietario", () => {
    expect(grantsFromDirectSettings("coordinador", DEFAULT_DIRECT_SETTINGS)).toEqual(["direct_connection.mode"]);
    expect(grantsFromDirectSettings("asesor", DEFAULT_DIRECT_SETTINGS)).toEqual([]);
    const todo = { ...DEFAULT_DIRECT_SETTINGS, modeRoles: ["asesor" as const], linkRoles: ["asesor" as const], limitsRoles: ["asesor" as const] };
    expect(grantsFromDirectSettings("asesor", todo)).toEqual([
      "direct_connection.mode",
      "direct_connection.link",
      "direct_connection.limits",
    ]);
    expect(grantsFromDirectSettings("coordinador", todo)).toEqual([]);
  });

  it("sin el módulo no hay delegaciones y no se leen los ajustes", async () => {
    state.moduleOn = false;
    state.settingsCalls = 0;
    expect(await directConnectionGrants("org_a", "coordinador")).toEqual([]);
    expect(state.settingsCalls).toBe(0);
  });

  it("con el módulo, las de la organización; el Propietario no consulta (ya lo tiene todo)", async () => {
    state.moduleOn = true;
    state.row = { modeRoles: ["coordinador", "asesor"], linkRoles: ["coordinador"] };
    expect(await directConnectionGrants("org_a", "coordinador")).toEqual(["direct_connection.mode", "direct_connection.link"]);
    expect(await directConnectionGrants("org_a", "asesor")).toEqual(["direct_connection.mode"]);
    state.settingsCalls = 0;
    expect(await directConnectionGrants("org_a", "owner")).toEqual([]);
    expect(state.settingsCalls).toBe(0);
    state.row = null;
  });

  it("si la lectura falla, falla CERRADO", async () => {
    state.moduleOn = true;
    state.fail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await directConnectionGrants("org_a", "coordinador")).toEqual([]);
    spy.mockRestore();
    state.fail = false;
  });
});

describe("conexión directa — complemento oculto, fuera de los 13 y del plan", () => {
  it("apagado por defecto y no es uno de los interruptores de /platform", () => {
    expect(NEW_MODULE_DEFAULTS.conexionDirecta).toBe(false);
    expect(PLATFORM_MODULE_TOGGLES as readonly string[]).not.toContain("conexionDirecta");
  });

  it("encenderlo no cambia el plan ni el conteo de módulos", () => {
    const ultra = planToggles("ultra");
    const con = { ...ultra, conexionDirecta: true } as typeof ultra;
    expect(planOfModules(con)).toBe("ultra");
    expect(countActiveModules(con)).toEqual(countActiveModules(ultra));
  });
});

describe("conexión directa — la IA y las campañas nunca la usan", () => {
  it("ni el pipeline de IA ni las campañas importan la conexión directa", () => {
    const raiz = path.resolve(import.meta.dirname, "../..");
    const archivos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : [];
      });
    const vigilados = [
      ...archivos(path.join(raiz, "src/server/ai")),
      ...archivos(path.join(raiz, "src/server/campaigns")),
    ];
    const mal = vigilados
      .filter((f) => /direct-connection|credentials\/direct/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(raiz, f));
    expect(mal).toEqual([]);
  });
});
