import { describe, expect, it } from "vitest";
import { can, ROLES, type Permission, type Role } from "@/lib/auth/permissions";
import { SETTINGS_TAB_PERMISSION } from "@/lib/auth/page-guard";
import {
  CORE_MODULES,
  MODULES,
  MODULE_PROFILES,
  NAV_MODULES,
  effectiveModules,
  type ModuleKey,
} from "@/lib/modules/registry";
import {
  defaultLayout,
  normalizeLayout,
  resolveNav,
  validateLayout,
  type NavLayoutItem,
} from "@/lib/modules/nav-layout";
import { enabledModuleKeys, envModuleDefaults } from "@/server/modules/defaults";
import { resolveLabAgent, ModuleDependencyError } from "@/server/modules/store";

/**
 * 030 (PR 4) — Registro central de módulos y menú por rol (puro).
 */

const TODOS = new Set<ModuleKey>(MODULES.map((m) => m.key));
const canRole = (role: Role) => (p: Permission) => can({ role }, p);

describe("registro de módulos", () => {
  it("el núcleo es Bandeja, Contactos, Pipeline y Ajustes", () => {
    expect([...CORE_MODULES].sort()).toEqual(["contacts", "inbox", "pipeline", "settings"]);
  });

  it("claves únicas, rutas únicas y dependencias que existen", () => {
    const keys = MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const rutas = NAV_MODULES.map((m) => m.route);
    expect(new Set(rutas).size).toBe(rutas.length);
    for (const m of MODULES) for (const r of m.requires) expect(keys).toContain(r);
  });

  it("el Laboratorio requiere al Agente", () => {
    expect(MODULES.find((m) => m.key === "lab")?.requires).toEqual(["agent"]);
    const sinAgente = effectiveModules(new Set<ModuleKey>(["lab", "knowledge"]));
    expect(sinAgente.has("lab")).toBe(false);
    expect(sinAgente.has("knowledge")).toBe(true);
    expect(effectiveModules(new Set<ModuleKey>(["lab", "agent"])).has("lab")).toBe(true);
  });

  it("el núcleo existe aunque nada esté encendido", () => {
    const vacio = effectiveModules(new Set());
    for (const k of CORE_MODULES) expect(vacio.has(k)).toBe(true);
  });

  it("los roles por defecto coinciden con la matriz de permisos", () => {
    for (const m of NAV_MODULES) {
      for (const role of ROLES) {
        const permitido = !m.permissions || m.permissions.some((p) => can({ role }, p));
        expect(m.defaultRoles.includes(role), `${m.key} · ${role}`).toBe(permitido);
      }
    }
  });

  it("Ajustes pide cualquiera de los permisos de sus pestañas", () => {
    const ajustes = MODULES.find((m) => m.key === "settings")!;
    expect([...new Set(Object.values(SETTINGS_TAB_PERMISSION))].sort()).toEqual([...(ajustes.permissions ?? [])].sort());
  });

  it("los perfiles Básico y Completo respetan la dependencia", () => {
    for (const p of Object.values(MODULE_PROFILES)) {
      if (p.modules.lab) expect(p.modules.agent).toBe(true);
    }
    expect(MODULE_PROFILES.completo.modules.customNav).toBe(true);
    expect(MODULE_PROFILES.basico.modules.customNav).toBe(false);
    // 033: las organizaciones nuevas con perfil nacen con Tareas y Notas.
    expect(MODULE_PROFILES.completo.modules.trabajo).toBe(true);
    expect(MODULE_PROFILES.basico.modules.trabajo).toBe(true);
  });

  it("las columnas de la 0034 nacen encendidas y custom_nav apagado", () => {
    const d = envModuleDefaults();
    expect(d).toMatchObject({ knowledge: true, lab: true, agent: true, teamChat: true, results: true, customNav: false });
    // 033: Tareas y Notas nace apagado (las organizaciones existentes no ven nada nuevo).
    expect(d.trabajo).toBe(false);
    expect(enabledModuleKeys(d).has("trabajo")).toBe(false);
    expect(enabledModuleKeys({ ...d, trabajo: true }).has("trabajo")).toBe(true);
    const keys = enabledModuleKeys(d);
    for (const k of ["knowledge", "lab", "agent", "team_chat", "results"] as const) expect(keys.has(k)).toBe(true);
    expect(enabledModuleKeys({ ...d, agent: false }).has("lab")).toBe(false);
  });

  it("Agente y Laboratorio: apagar el Agente apaga el Laboratorio; encender el Laboratorio sin Agente es error", () => {
    expect(resolveLabAgent({ lab: true, agent: true }, { agent: false })).toEqual({ lab: false, agent: false });
    expect(resolveLabAgent({ lab: false, agent: false }, { agent: true, lab: true })).toEqual({ lab: true, agent: true });
    expect(() => resolveLabAgent({ lab: false, agent: false }, { lab: true })).toThrow(ModuleDependencyError);
  });
});

describe("menú por rol", () => {
  // 033: la entrada de Citas (clave `agenda`) ahora es «Trabajo» en /trabajo,
  // en el mismo lugar del menú.
  it("sin personalizar, cada rol ve lo mismo que antes del PR 4", () => {
    const esperado: Record<Role, string[]> = {
      owner: ["/inbox", "/chat", "/trabajo", "/pipeline", "/contacts", "/knowledge", "/campaigns", "/results", "/lab"],
      coordinador: ["/inbox", "/chat", "/trabajo", "/pipeline", "/contacts", "/knowledge", "/campaigns", "/results"],
      asesor: ["/inbox", "/chat", "/trabajo", "/pipeline", "/contacts", "/knowledge"],
    };
    for (const role of ROLES) {
      const nav = resolveNav({ role, modules: TODOS, can: canRole(role), layout: null });
      expect(nav.main.map((m) => m.route), role).toEqual(esperado[role]);
      expect(nav.settings, role).toBe(role !== "asesor");
    }
  });

  it("031: con el Laboratorio a la vista «Agente» sale del menú; sin Laboratorio (apagado, sin permiso u oculto) se queda", () => {
    const keys = (r: ReturnType<typeof resolveNav>) => r.main.map((m) => m.key);
    // Con Laboratorio: solo Laboratorio.
    const con = resolveNav({ role: "owner", modules: TODOS, can: canRole("owner"), layout: null });
    expect(keys(con)).toContain("lab");
    expect(keys(con)).not.toContain("agent");
    // Laboratorio apagado (Agente encendido): se ve «Agente».
    const sinLab = effectiveModules(new Set<ModuleKey>(["team_chat", "knowledge", "results", "agent"]));
    const a = resolveNav({ role: "owner", modules: sinLab, can: canRole("owner"), layout: null });
    expect(keys(a)).toContain("agent");
    expect(keys(a)).not.toContain("lab");
    // Sin permiso de Laboratorio (agent.manage) pero con el módulo: no hay ni uno ni otro.
    const sinPermiso = resolveNav({ role: "asesor", modules: TODOS, can: canRole("asesor"), layout: null });
    expect(keys(sinPermiso)).not.toContain("lab");
    // Laboratorio oculto por el Propietario en Ajustes → Navegación: «Agente» vuelve.
    const layout = defaultLayout("owner").map((i) => (i.key === "lab" ? { ...i, hidden: true } : { ...i, hidden: i.key === "agent" ? false : i.hidden }));
    const oculto = resolveNav({ role: "owner", modules: TODOS, can: canRole("owner"), layout });
    expect(keys(oculto)).toContain("agent");
    expect(keys(oculto)).not.toContain("lab");
  });

  it("033: «Trabajo» aparece con Citas (agenda) o con Tareas y notas (trabajo); sin ninguno, no", () => {
    const base = ["team_chat", "knowledge", "results", "agent", "lab"] as ModuleKey[];
    const ruta = (mods: ModuleKey[]) =>
      resolveNav({ role: "asesor", modules: effectiveModules(new Set<ModuleKey>([...base, ...mods])), can: canRole("asesor"), layout: null }).main.map(
        (m) => m.route
      );
    expect(ruta([])).not.toContain("/trabajo");
    expect(ruta(["agenda"])).toContain("/trabajo");
    expect(ruta(["trabajo"])).toContain("/trabajo");
    expect(ruta(["agenda", "trabajo"]).filter((r) => r === "/trabajo")).toHaveLength(1);
    // Mismo lugar que tenía «Citas»: justo después del Chat de equipo.
    expect(ruta(["trabajo"]).slice(0, 3)).toEqual(["/inbox", "/chat", "/trabajo"]);
    // Tareas y notas no tiene entrada propia: vive dentro de «Trabajo».
    expect(MODULES.find((m) => m.key === "trabajo")?.route).toBeNull();
  });

  it("033: un menú guardado con «Citas» oculta conserva «Trabajo» oculto (misma clave)", () => {
    const layout = defaultLayout("owner").map((i) => (i.key === "agenda" ? { ...i, hidden: true } : i));
    const nav = resolveNav({ role: "owner", modules: TODOS, can: canRole("owner"), layout });
    expect(nav.main.map((m) => m.route)).not.toContain("/trabajo");
  });

  it("un módulo apagado no aparece aunque el menú guardado lo muestre", () => {
    const sinCampanas = effectiveModules(new Set<ModuleKey>(["team_chat", "knowledge", "results", "agent", "lab"]));
    const nav = resolveNav({ role: "owner", modules: sinCampanas, can: canRole("owner"), layout: defaultLayout("owner") });
    expect(nav.main.map((m) => m.key)).not.toContain("campaigns");
    expect(nav.main.map((m) => m.key)).not.toContain("agenda");
  });

  it("ocultar es solo estético: mostrar algo sin permiso no lo hace aparecer", () => {
    const layout = defaultLayout("asesor").map((i) => ({ ...i, hidden: false }));
    const nav = resolveNav({ role: "asesor", modules: TODOS, can: canRole("asesor"), layout });
    expect(nav.main.map((m) => m.key)).not.toContain("results");
    expect(nav.main.map((m) => m.key)).not.toContain("agent");
    expect(nav.settings).toBe(false);
  });

  it("reordena y oculta según lo guardado", () => {
    const layout: NavLayoutItem[] = [
      { key: "contacts", hidden: false },
      { key: "inbox", hidden: false },
      { key: "team_chat", hidden: true },
    ];
    const nav = resolveNav({ role: "asesor", modules: TODOS, can: canRole("asesor"), layout });
    expect(nav.main.map((m) => m.key)).toEqual(["contacts", "inbox", "agenda", "pipeline", "knowledge"]);
  });

  it("normaliza: descarta claves desconocidas y repetidas, agrega las nuevas y deja Ajustes al final", () => {
    const items = normalizeLayout(
      [{ key: "settings", hidden: false }, { key: "x" }, { key: "inbox", hidden: true }, { key: "inbox", hidden: false }, { key: "instagram" }],
      "coordinador"
    );
    expect(items.map((i) => i.key)).toEqual([
      "inbox",
      "team_chat",
      "agenda",
      "pipeline",
      "contacts",
      "knowledge",
      "campaigns",
      "results",
      "agent",
      "lab",
      "settings",
    ]);
    expect(items[0]).toEqual({ key: "inbox", hidden: true });
  });

  it("el Propietario no puede ocultarse Ajustes", () => {
    const layout = defaultLayout("owner").map((i) => (i.key === "settings" ? { ...i, hidden: true } : i));
    expect(validateLayout(layout, "owner", TODOS, canRole("owner"))?.code).toBe("locked");
    expect(normalizeLayout(layout, "owner").find((i) => i.key === "settings")?.hidden).toBe(false);
    // Al Coordinador sí se le puede ocultar.
    const coord = defaultLayout("coordinador").map((i) => (i.key === "settings" ? { ...i, hidden: true } : i));
    expect(validateLayout(coord, "coordinador", TODOS, canRole("coordinador"))).toBeNull();
  });

  it("cada rol conserva al menos una entrada visible", () => {
    const todoOculto = defaultLayout("asesor").map((i) => ({ ...i, hidden: true }));
    expect(validateLayout(todoOculto, "asesor", TODOS, canRole("asesor"))?.code).toBe("empty");
    // Visible solo algo que el Asesor no puede abrir: también cuenta como vacío.
    const soloResultados = todoOculto.map((i) => (i.key === "results" ? { ...i, hidden: false } : i));
    expect(validateLayout(soloResultados, "asesor", TODOS, canRole("asesor"))?.code).toBe("empty");
    const soloBandeja = todoOculto.map((i) => (i.key === "inbox" ? { ...i, hidden: false } : i));
    expect(validateLayout(soloBandeja, "asesor", TODOS, canRole("asesor"))).toBeNull();
  });

  it("rechaza claves desconocidas o repetidas", () => {
    const can = canRole("owner");
    expect(validateLayout([{ key: "nada" as ModuleKey, hidden: false }], "owner", TODOS, can)?.code).toBe("unknown_key");
    expect(validateLayout([{ key: "instagram", hidden: false }], "owner", TODOS, can)?.code).toBe("unknown_key");
    expect(
      validateLayout(
        [
          { key: "inbox", hidden: false },
          { key: "inbox", hidden: true },
        ],
        "owner",
        TODOS,
        can
      )?.code
    ).toBe("duplicate_key");
  });
});
