import type { Permission, Role } from "@/lib/auth/permissions";

/**
 * 030 (PR 4) — Registro central de los módulos de Vocero. UN solo lugar.
 *
 * Cada módulo dice cómo se llama, a qué ruta lleva su entrada del menú, con
 * qué ícono, si es NÚCLEO (no se puede apagar) u opcional, qué roles lo ven
 * por defecto y de qué otros depende. El menú lateral, el editor de
 * Ajustes → Navegación, /platform y las pruebas leen de aquí.
 *
 * Dos capas, ninguna de seguridad por sí sola:
 * 1. Plataforma (`organization_module`): un módulo apagado NO EXISTE para esa
 *    organización — su pantalla y sus rutas responden 404 en el servidor.
 * 2. Organización (`nav_layout`): el Propietario reordena u oculta entradas
 *    del menú por rol. Ocultar es SOLO estético: el permiso y el módulo se
 *    siguen validando en cada ruta.
 *
 * Puro (sin servidor ni React): el ícono va por nombre y lo pinta el menú.
 */

export const MODULE_KEYS = [
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
  // Sin entrada propia en el menú (viven dentro de Ajustes o de la Bandeja).
  "atribucion",
  "instagram",
  "messenger",
  // 033 — Tareas y Notas: viven dentro de «Trabajo» (la entrada de `agenda`).
  "trabajo",
  // 038 — Asistente interno (premium, solo el Propietario).
  "asistente",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Nombres de ícono de lucide-react que el menú sabe pintar. */
export type ModuleIcon =
  | "Inbox"
  | "MessagesSquare"
  | "CalendarDays"
  | "Kanban"
  | "Users"
  | "BookOpen"
  | "Megaphone"
  | "ChartColumn"
  | "Sparkles"
  | "FlaskConical"
  | "Settings"
  | "Target"
  | "Camera"
  | "MessageCircle"
  | "BriefcaseBusiness"
  | "ListChecks"
  | "BotMessageSquare";

/**
 * 039 — Una pestaña de un pilar del menú: una pantalla que ya existe (su ruta
 * no cambia), del módulo que la hace existir. El pilar aparece si al menos
 * una de sus secciones se puede abrir, y su renglón lleva a la PRIMERA que se
 * pueda abrir.
 */
export type NavSection = {
  label: string;
  route: string;
  /** Módulo que hace existir esta pantalla (apagado = no hay pestaña). */
  module: ModuleKey;
  /** Permisos de la pantalla (basta uno); el servidor los valida igual. */
  permissions?: readonly Permission[];
  /** La sección cede su lugar si este módulo está encendido (el Agente general → Laboratorio). */
  unless?: ModuleKey;
  /** Otras rutas (y sus hijas) que cuentan como esta sección. */
  also?: readonly string[];
};

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  /**
   * Ruta «de casa» del renglón del menú; `null` = no tiene renglón propio
   * (039: vive como pestaña de un pilar). Con `sections`, el renglón lleva a
   * la primera sección disponible, no necesariamente aquí.
   */
  route: string | null;
  icon: ModuleIcon;
  /** Núcleo: siempre encendido, la plataforma no lo puede apagar. */
  core: boolean;
  /**
   * Permiso que la entrada exige (lo valida el servidor en cada ruta; el menú
   * solo lo refleja). Con varios, basta uno.
   */
  permissions?: readonly Permission[];
  /** Roles que ven la entrada sin que nadie toque Ajustes → Navegación. */
  defaultRoles: readonly Role[];
  /** Módulos que deben estar encendidos para que este exista. */
  requires: readonly ModuleKey[];
  /** Globos del menú. */
  badges?: readonly ("inbox" | "team")[];
  /** Ajustes va anclado abajo: se oculta, pero no se reordena. */
  pinnedBottom?: boolean;
  /**
   * 039 — Pilar del menú: sus pestañas, en orden. El renglón existe si
   * CUALQUIERA se puede abrir (módulo encendido + permiso) y se pinta activo
   * en todas sus rutas.
   */
  sections?: readonly NavSection[];
};

const ALL: readonly Role[] = ["owner", "coordinador", "asesor"];

/**
 * 039 — El menú son 5 pilares operativos + Ajustes. Los pilares conservan la
 * clave de un módulo que ya existía (`inbox`, `pipeline`, `lab`, `campaigns`,
 * `results`): el menú que un Propietario ya guardó en Ajustes → Navegación
 * sigue valiendo, y las demás claves (que ya no tienen renglón) se descartan
 * al normalizarlo. Ninguna ruta cambia de dirección: los pilares solo
 * agrupan pantallas que ya existen como pestañas.
 */
export const MODULES: readonly ModuleDef[] = [
  {
    key: "inbox",
    label: "Bandeja",
    route: "/inbox",
    icon: "Inbox",
    core: true,
    defaultRoles: ALL,
    requires: [],
    badges: ["inbox", "team"],
    sections: [
      { label: "Clientes", route: "/inbox", module: "inbox" },
      // 025 — Comunicación interna: junto a la Bandeja, porque se usa atendiendo.
      { label: "Equipo", route: "/chat", module: "team_chat" },
    ],
  },
  {
    key: "pipeline",
    label: "CRM Comercial",
    route: "/pipeline",
    icon: "Kanban",
    core: true,
    defaultRoles: ALL,
    requires: [],
    sections: [
      { label: "Pipeline", route: "/pipeline", module: "pipeline" },
      { label: "Contactos", route: "/contacts", module: "contacts" },
      // 015 — Citas: sigue en /bookings y su módulo es `agenda`.
      { label: "Agenda", route: "/bookings", module: "agenda" },
      // 033 — Tareas y Notas (módulo `trabajo`), en /trabajo/*.
      { label: "Tareas y notas", route: "/trabajo/tareas", module: "trabajo", also: ["/trabajo"] },
      // 024 — Material que el equipo envía (Conocimientos).
      { label: "Biblioteca", route: "/knowledge", module: "knowledge" },
    ],
  },
  {
    key: "lab",
    label: "Estudio de IA",
    route: "/lab",
    icon: "FlaskConical",
    core: false,
    permissions: ["agent.manage"],
    defaultRoles: ["owner"],
    // El Laboratorio evalúa al agente: sin agente no hay nada que evaluar.
    requires: ["agent"],
    sections: [
      // El editor (/lab/agents/[id]) cuenta como parte de Mis agentes.
      { label: "Mis agentes", route: "/lab", module: "lab", permissions: ["agent.manage"], also: ["/lab/agents"] },
      // Sin Laboratorio, el agente general de siempre (/agent sigue vivo).
      { label: "Mi agente", route: "/agent", module: "agent", permissions: ["agent.manage"], unless: "lab" },
      { label: "Conocimiento y documentos", route: "/lab/documentos", module: "lab", permissions: ["agent.manage"] },
      { label: "Asignación por etapa", route: "/lab/asignacion", module: "lab", permissions: ["agent.manage"] },
      { label: "Evaluaciones", route: "/lab/evaluaciones", module: "lab", permissions: ["agent.manage"] },
    ],
  },
  {
    key: "campaigns",
    label: "Marketing",
    route: "/campaigns",
    icon: "Megaphone",
    core: false,
    permissions: ["campaigns.manage"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    sections: [
      { label: "Campañas", route: "/campaigns", module: "campaigns", permissions: ["campaigns.manage"] },
      { label: "Audiencias", route: "/campaigns/audiences", module: "campaigns", permissions: ["campaigns.manage"] },
      // 030 (PR 4): antes en Ajustes → Plantillas (que ahora redirige aquí).
      { label: "Plantillas WhatsApp", route: "/campaigns/templates", module: "campaigns", permissions: ["templates.manage"] },
      { label: "Métricas y costos Meta", route: "/campaigns/metrics", module: "campaigns", permissions: ["campaigns.manage"] },
    ],
  },
  // 019 — Primero se atiende y se organiza, luego se mide.
  {
    key: "results",
    label: "Inteligencia",
    route: "/results",
    icon: "ChartColumn",
    core: false,
    permissions: ["results.read", "assistant.use"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    sections: [
      { label: "Resultados y embudo", route: "/results", module: "results", permissions: ["results.read"] },
      // 038 — Asistente interno (premium, solo el Propietario).
      { label: "Asistente de negocio ✨", route: "/asistente", module: "asistente", permissions: ["assistant.use"] },
    ],
  },
  {
    key: "settings",
    label: "Ajustes",
    route: "/settings",
    icon: "Settings",
    core: true,
    // Basta una pestaña que se pueda abrir (ver SETTINGS_TAB_PERMISSION).
    permissions: ["settings.manage", "templates.manage", "users.read", "tags.manage", "team_chat.create_groups", "usage.read", "direct_connection.link", "mi_numero.manage", "pipeline.edit"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    pinnedBottom: true,
  },
  // 039 — Sin renglón propio: viven como pestañas de un pilar (arriba).
  { key: "team_chat", label: "Chat de equipo", route: null, icon: "MessagesSquare", core: false, defaultRoles: ALL, requires: [] },
  { key: "agenda", label: "Agenda (Citas)", route: null, icon: "CalendarDays", core: false, defaultRoles: ALL, requires: [] },
  { key: "contacts", label: "Contactos", route: null, icon: "Users", core: true, defaultRoles: ALL, requires: [] },
  { key: "knowledge", label: "Biblioteca", route: null, icon: "BookOpen", core: false, defaultRoles: ALL, requires: [] },
  {
    key: "agent",
    label: "Agente",
    route: null,
    icon: "Sparkles",
    core: false,
    permissions: ["agent.manage"],
    defaultRoles: ["owner"],
    requires: [],
  },
  // 038 — Asistente interno: preguntas sobre los datos propios. Premium y
  // solo del Propietario.
  {
    key: "asistente",
    label: "Asistente",
    route: null,
    icon: "BotMessageSquare",
    core: false,
    permissions: ["assistant.use"],
    defaultRoles: ["owner"],
    requires: [],
  },
  { key: "atribucion", label: "Atribución", route: null, icon: "Target", core: false, defaultRoles: ALL, requires: [] },
  { key: "instagram", label: "Instagram", route: null, icon: "Camera", core: false, defaultRoles: ALL, requires: [] },
  { key: "messenger", label: "Messenger", route: null, icon: "MessageCircle", core: false, defaultRoles: ALL, requires: [] },
  // 033 — Tareas y Notas.
  { key: "trabajo", label: "Tareas y notas", route: null, icon: "ListChecks", core: false, defaultRoles: ALL, requires: [] },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export function moduleDef(key: ModuleKey): ModuleDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`módulo desconocido: ${key}`);
  return def;
}

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && BY_KEY.has(value as ModuleKey);
}

/** Los que tienen entrada en el menú, en el orden por defecto. */
export const NAV_MODULES: readonly ModuleDef[] = MODULES.filter((m) => m.route !== null);
export type NavKey = ModuleKey;

/** Núcleo: Bandeja, Contactos, Pipeline y Ajustes. */
export const CORE_MODULES: readonly ModuleKey[] = MODULES.filter((m) => m.core).map((m) => m.key);

/**
 * Los módulos que la plataforma puede apagar y cuya columna nueva nace en la
 * 0034 encendida (las organizaciones que ya existen no pierden nada).
 */
export const TOGGLEABLE_0034 = ["knowledge", "lab", "agent", "team_chat", "results"] as const;

/**
 * 039 — Planes comerciales (perfiles de alta): SOLO una plantilla para los 13
 * interruptores al crear la organización. No se guarda cuál fue: después cada
 * interruptor es independiente y el administrador lo cambia en /platform.
 * Cada plan incluye al anterior. «Personalizado» no es plantilla: la
 * organización nace con los valores del entorno y los 13 se mueven a mano.
 *
 * - Esencial: Bandeja (con chat de equipo), CRM Comercial (Tareas, Notas,
 *   Biblioteca) y Resultados. Sin IA.
 * - Pro: + Agente y Laboratorio, Agenda, Atribución (CAPI), Instagram,
 *   Messenger y menú personalizable.
 * - Ultra: + Campañas masivas y el Asistente interno del dueño (el 13.º).
 *   «Varios agentes» es el Laboratorio (ya en Pro): hoy no hay un interruptor
 *   aparte que limite cuántos.
 */
const ESENCIAL = {
  team_chat: true,
  knowledge: true,
  results: true,
  trabajo: true,
  agent: false,
  lab: false,
  agenda: false,
  atribucion: false,
  instagram: false,
  messenger: false,
  customNav: false,
  campaigns: false,
  asistente: false,
} as const;
const PRO = {
  ...ESENCIAL,
  agent: true,
  lab: true,
  agenda: true,
  atribucion: true,
  instagram: true,
  messenger: true,
  customNav: true,
} as const;
const ULTRA = { ...PRO, campaigns: true, asistente: true } as const;

export type ProfileModules = { readonly [K in keyof typeof ESENCIAL]: boolean };

export const MODULE_PROFILES = {
  esencial: { label: "Esencial", modules: ESENCIAL as ProfileModules },
  pro: { label: "Pro", modules: PRO as ProfileModules },
  ultra: { label: "Ultra", modules: ULTRA as ProfileModules },
} as const;
export type ModuleProfile = keyof typeof MODULE_PROFILES;

/** Lo que /platform ofrece al crear: los tres planes o «Personalizado» (sin plantilla). */
export const PLAN_OPTIONS = ["esencial", "pro", "ultra", "personalizado"] as const;
export type PlanOption = (typeof PLAN_OPTIONS)[number];
export const PLAN_LABEL: Record<PlanOption, string> = {
  esencial: "Esencial",
  pro: "Pro",
  ultra: "Ultra",
  personalizado: "Personalizado",
};

/** El perfil de un plan (`personalizado` no tiene: valen el entorno y los 13 a mano). */
export function profileOfPlan(plan: PlanOption | undefined): ModuleProfile | undefined {
  return plan && plan !== "personalizado" ? plan : undefined;
}

/**
 * Aplica las dependencias: un módulo cuyo requisito está apagado, tampoco
 * existe. Núcleo, siempre.
 */
export function effectiveModules(enabled: ReadonlySet<ModuleKey>): Set<ModuleKey> {
  const out = new Set<ModuleKey>(CORE_MODULES);
  for (const m of MODULES) if (enabled.has(m.key)) out.add(m.key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...out]) {
      if (moduleDef(key).requires.some((r) => !out.has(r))) {
        out.delete(key);
        changed = true;
      }
    }
  }
  return out;
}
