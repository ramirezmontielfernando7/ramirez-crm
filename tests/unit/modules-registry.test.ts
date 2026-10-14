import { describe, expect, it } from "vitest";
import { can, ROLES, type Permission, type Role } from "@/lib/auth/permissions";
import { SETTINGS_TAB_PERMISSION } from "@/lib/auth/page-guard";
import {
  CORE_MODULES,
  MODULES,
  MODULE_PROFILES,
  NAV_MODULES,
  PLAN_OPTIONS,
  moduleDef,
  profileOfPlan,
  effectiveModules,
  type ModuleKey,
} from "@/lib/modules/registry";
import {
  activeSection,
  availableSections,
  defaultLayout,
  normalizeLayout,
  pillarOfPath,
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

  it("039: los planes Esencial, Pro y Ultra: cada uno incluye al anterior y respetan la dependencia", () => {
    const { esencial, pro, ultra } = MODULE_PROFILES;
    for (const p of Object.values(MODULE_PROFILES)) {
      if (p.modules.lab) expect(p.modules.agent).toBe(true);
      // Los 13 interruptores de /platform, todos definidos.
      expect(Object.keys(p.modules)).toHaveLength(13);
    }
    const enc = (m: Record<string, boolean>) => Object.keys(m).filter((k) => m[k]);
    for (const k of enc(esencial.modules)) expect(pro.modules[k as keyof typeof pro.modules], k).toBe(true);
    for (const k of enc(pro.modules)) expect(ultra.modules[k as keyof typeof ultra.modules], k).toBe(true);
    // Esencial: Bandeja (con equipo), CRM (Tareas, Notas, Biblioteca), sin IA.
    expect(esencial.modules).toMatchObject({ team_chat: true, trabajo: true, knowledge: true, agent: false, lab: false, asistente: false, campaigns: false });
    // Pro: + IA, Agenda, CAPI, Instagram y Messenger.
    expect(pro.modules).toMatchObject({ agent: true, lab: true, agenda: true, atribucion: true, instagram: true, messenger: true, campaigns: false, asistente: false });
    // Ultra: + Campañas y el Asistente interno (el 13.º).
    expect(ultra.modules).toMatchObject({ campaigns: true, asistente: true });
    expect(enc(ultra.modules)).toHaveLength(13);
  });

  it("039: «Personalizado» no es plantilla (valen el entorno y los 13 a mano)", () => {
    expect(PLAN_OPTIONS).toEqual(["esencial", "pro", "ultra", "personalizado"]);
    expect(profileOfPlan("personalizado")).toBeUndefined();
    expect(profileOfPlan(undefined)).toBeUndefined();
    expect(profileOfPlan("pro")).toBe("pro");
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
  const rutas = (r: ReturnType<typeof resolveNav>) => r.main.map((m) => r.hrefs[m.key]);

  it("039: el menú son 5 pilares + Ajustes, y cada rol ve los suyos", () => {
    const esperado: Record<Role, string[]> = {
      owner: ["Bandeja", "CRM Comercial", "Estudio de IA", "Marketing", "Inteligencia"],
      coordinador: ["Bandeja", "CRM Comercial", "Marketing", "Inteligencia"],
      asesor: ["Bandeja", "CRM Comercial"],
    };
    for (const role of ROLES) {
      const nav = resolveNav({ role, modules: TODOS, can: canRole(role), layout: null });
      expect(nav.main.map((m) => m.label), role).toEqual(esperado[role]);
      expect(nav.settings, role).toBe(role !== "asesor");
    }
    expect(NAV_MODULES.map((m) => m.key)).toEqual(["inbox", "pipeline", "lab", "campaigns", "results", "settings"]);
  });

  it("039: las pestañas de cada pilar, en orden y sin rutas repetidas", () => {
    const pestañas = (key: ModuleKey) => (moduleDef(key).sections ?? []).map((s) => s.route);
    expect(pestañas("inbox")).toEqual(["/inbox", "/chat"]);
    expect(pestañas("pipeline")).toEqual(["/pipeline", "/contacts", "/bookings", "/trabajo/tareas", "/knowledge"]);
    expect(pestañas("lab")).toEqual(["/lab", "/agent", "/lab/documentos", "/lab/asignacion", "/lab/evaluaciones"]);
    expect(pestañas("campaigns")).toEqual(["/campaigns", "/campaigns/audiences", "/campaigns/templates", "/campaigns/metrics"]);
    expect(pestañas("results")).toEqual(["/results", "/asistente"]);
    const todas = NAV_MODULES.flatMap((m) => (m.sections ?? []).map((s) => s.route));
    expect(new Set(todas).size).toBe(todas.length);
    // Ningún módulo absorbido conserva renglón propio.
    for (const k of ["team_chat", "agenda", "contacts", "knowledge", "agent", "asistente", "trabajo"] as const) {
      expect(moduleDef(k).route, k).toBeNull();
    }
  });

  it("039: el renglón lleva a la primera pestaña que se puede abrir", () => {
    // Estudio de IA: con Laboratorio, /lab; sin él (Agente encendido), /agent.
    const con = resolveNav({ role: "owner", modules: TODOS, can: canRole("owner"), layout: null });
    expect(con.hrefs.lab).toBe("/lab");
    const sinLab = effectiveModules(new Set<ModuleKey>(["team_chat", "knowledge", "results", "agent"]));
    const a = resolveNav({ role: "owner", modules: sinLab, can: canRole("owner"), layout: null });
    expect(a.hrefs.lab).toBe("/agent");
    expect(availableSections(moduleDef("lab"), sinLab, canRole("owner")).map((s) => s.route)).toEqual(["/agent"]);
    // Con Laboratorio, la pestaña del agente general cede su lugar.
    expect(availableSections(moduleDef("lab"), TODOS, canRole("owner")).map((s) => s.route)).not.toContain("/agent");
    // Sin agente: no hay Estudio de IA.
    const sinIa = effectiveModules(new Set<ModuleKey>(["team_chat", "results"]));
    expect(resolveNav({ role: "owner", modules: sinIa, can: canRole("owner"), layout: null }).main.map((m) => m.key)).not.toContain("lab");
    // Inteligencia solo con el Asistente: lleva a /asistente.
    const soloAsistente = effectiveModules(new Set<ModuleKey>(["asistente"]));
    const b = resolveNav({ role: "owner", modules: soloAsistente, can: canRole("owner"), layout: null });
    expect(b.hrefs.results).toBe("/asistente");
    // …y el Coordinador (sin assistant.use) no la ve.
    expect(resolveNav({ role: "coordinador", modules: soloAsistente, can: canRole("coordinador"), layout: null }).main.map((m) => m.key)).not.toContain("results");
  });

  it("039: el CRM Comercial y la Bandeja siempre existen; sus pestañas siguen a sus módulos", () => {
    const nada = effectiveModules(new Set());
    const nav = resolveNav({ role: "asesor", modules: nada, can: canRole("asesor"), layout: null });
    expect(rutas(nav)).toEqual(["/inbox", "/pipeline"]);
    expect(availableSections(moduleDef("inbox"), nada, canRole("asesor")).map((s) => s.label)).toEqual(["Clientes"]);
    expect(availableSections(moduleDef("pipeline"), nada, canRole("asesor")).map((s) => s.label)).toEqual(["Pipeline", "Contactos"]);
    const todo = availableSections(moduleDef("pipeline"), TODOS, canRole("asesor")).map((s) => s.label);
    expect(todo).toEqual(["Pipeline", "Contactos", "Agenda", "Tareas y notas", "Biblioteca"]);
  });

  it("039: la pestaña activa es la de la ruta más larga que contiene a la página", () => {
    const mkt = moduleDef("campaigns").sections!;
    expect(activeSection(mkt, "/campaigns")?.label).toBe("Campañas");
    expect(activeSection(mkt, "/campaigns/c_123")?.label).toBe("Campañas");
    expect(activeSection(mkt, "/campaigns/audiences")?.label).toBe("Audiencias");
    const crm = moduleDef("pipeline").sections!;
    expect(activeSection(crm, "/trabajo/notas")?.label).toBe("Tareas y notas");
    expect(activeSection(crm, "/bookings")?.label).toBe("Agenda");
    const lab = moduleDef("lab").sections!;
    expect(activeSection(lab, "/lab/agents/ag_1")?.label).toBe("Mis agentes");
    expect(activeSection(lab, "/lab/documentos/grp_1")?.label).toBe("Conocimiento y documentos");
    expect(pillarOfPath("/chat")?.key).toBe("inbox");
    expect(pillarOfPath("/knowledge")?.key).toBe("pipeline");
    expect(pillarOfPath("/asistente")?.key).toBe("results");
    expect(pillarOfPath("/settings/team")).toBeUndefined();
  });

  it("039: un menú guardado con claves viejas (sin renglón) se normaliza a los pilares", () => {
    const viejo = [
      { key: "contacts", hidden: false },
      { key: "team_chat", hidden: true },
      { key: "results", hidden: false },
      { key: "inbox", hidden: false },
    ];
    expect(normalizeLayout(viejo, "owner").map((i) => i.key)).toEqual(["results", "inbox", "pipeline", "lab", "campaigns", "settings"]);
  });

  it("un módulo apagado no aparece aunque el menú guardado lo muestre", () => {
    const sinCampanas = effectiveModules(new Set<ModuleKey>(["team_chat", "knowledge", "results", "agent", "lab"]));
    const nav = resolveNav({ role: "owner", modules: sinCampanas, can: canRole("owner"), layout: defaultLayout("owner") });
    expect(nav.main.map((m) => m.key)).not.toContain("campaigns");
  });

  it("ocultar es solo estético: mostrar algo sin permiso no lo hace aparecer", () => {
    const layout = defaultLayout("asesor").map((i) => ({ ...i, hidden: false }));
    const nav = resolveNav({ role: "asesor", modules: TODOS, can: canRole("asesor"), layout });
    expect(nav.main.map((m) => m.key)).not.toContain("results");
    expect(nav.main.map((m) => m.key)).not.toContain("lab");
    expect(nav.settings).toBe(false);
  });

  it("reordena y oculta según lo guardado", () => {
    const layout: NavLayoutItem[] = [
      { key: "pipeline", hidden: false },
      { key: "inbox", hidden: false },
      { key: "campaigns", hidden: true },
    ];
    const nav = resolveNav({ role: "coordinador", modules: TODOS, can: canRole("coordinador"), layout });
    expect(nav.main.map((m) => m.key)).toEqual(["pipeline", "inbox", "results"]);
  });

  it("normaliza: descarta claves desconocidas y repetidas, agrega las nuevas y deja Ajustes al final", () => {
    const items = normalizeLayout(
      [{ key: "settings", hidden: false }, { key: "x" }, { key: "inbox", hidden: true }, { key: "inbox", hidden: false }, { key: "instagram" }],
      "coordinador"
    );
    expect(items.map((i) => i.key)).toEqual(["inbox", "pipeline", "lab", "campaigns", "results", "settings"]);
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
