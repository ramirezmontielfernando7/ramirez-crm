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

export type NavGroup = "dia" | "crecer" | "ia";
export const NAV_GROUP_LABEL: Record<NavGroup, string> = {
  dia: "Día a día",
  crecer: "Crecer",
  ia: "Inteligencia artificial",
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
   * 2026-11 — Grupo del menú lateral («Día a día», «Crecer», «Inteligencia
   * artificial»). Solo se pintan los títulos si hay más de un grupo y cada
   * uno queda junto (un menú reordenado a mano los mezcla: sin títulos).
   */
  group?: NavGroup;
  /** Otros nombres con los que alguien lo busca (el buscador ⌘K; p. ej. el nombre viejo). */
  aka?: string;
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
 *
 * 2026-11 (nuevo orden del menú, aprobado por Fer): lo que la gente busca por
 * su nombre tiene renglón propio — Contactos, Agenda (Tareas, Citas, Notas) y
 * Biblioteca (que también junta lo que lee la IA) — en tres grupos. Las claves
 * nuevas (`contacts`, `agenda`, `knowledge`) ya existían como módulos; las
 * rutas siguen siendo las mismas.
 */
export const MODULES: readonly ModuleDef[] = [
  // ── Día a día (2026-11, nuevo orden del menú): lo que usa todo el equipo.
  {
    key: "inbox",
    label: "Bandeja",
    route: "/inbox",
    icon: "Inbox",
    core: true,
    defaultRoles: ALL,
    requires: [],
    badges: ["inbox", "team"],
    group: "dia",
    sections: [
      { label: "Clientes", route: "/inbox", module: "inbox" },
      // 025 — Comunicación interna: junto a la Bandeja, porque se usa atendiendo.
      { label: "Equipo", route: "/chat", module: "team_chat" },
    ],
  },
  {
    key: "pipeline",
    label: "Ventas",
    aka: "CRM Comercial Pipeline Embudo",
    route: "/pipeline",
    icon: "Kanban",
    core: true,
    defaultRoles: ALL,
    requires: [],
    group: "dia",
    sections: [{ label: "Pipeline", route: "/pipeline", module: "pipeline" }],
  },
  {
    key: "contacts",
    label: "Contactos",
    aka: "Clientes CRM Comercial",
    route: "/contacts",
    icon: "Users",
    core: true,
    defaultRoles: ALL,
    requires: [],
    group: "dia",
    sections: [{ label: "Contactos", route: "/contacts", module: "contacts" }],
  },
  // Tareas, Citas y Notas: «qué tengo pendiente». Sin el módulo Agenda (plan
  // Esencial) el renglón sigue con Tareas y Notas; sin `trabajo`, solo Citas.
  {
    key: "agenda",
    label: "Agenda",
    aka: "Pendientes Trabajo CRM Comercial",
    route: "/trabajo/tareas",
    icon: "CalendarDays",
    core: false,
    defaultRoles: ALL,
    requires: [],
    group: "dia",
    sections: [
      // 033 — Tareas y Notas (módulo `trabajo`), en /trabajo/*.
      { label: "Tareas", route: "/trabajo/tareas", module: "trabajo", also: ["/trabajo"] },
      // 015 — Citas: sigue en /bookings y su módulo es `agenda`.
      { label: "Citas", route: "/bookings", module: "agenda" },
      { label: "Notas", route: "/trabajo/notas", module: "trabajo" },
    ],
  },
  // 040 — UN archivo, dos destinos: lo que el equipo envía (024) y lo que lee
  // la IA (035, antes «Conocimiento» del Estudio de IA).
  {
    key: "knowledge",
    label: "Biblioteca",
    aka: "Conocimiento Documentos Archivos Material",
    route: "/knowledge",
    icon: "BookOpen",
    core: false,
    defaultRoles: ALL,
    requires: [],
    group: "dia",
    sections: [
      { label: "Para enviar en chats", route: "/knowledge", module: "knowledge" },
      { label: "Para que lea la IA", route: "/lab/documentos", module: "lab", permissions: ["agent.manage"] },
    ],
  },
  // ── Crecer.
  {
    key: "campaigns",
    label: "Campañas",
    aka: "Marketing Difusión",
    route: "/campaigns",
    icon: "Megaphone",
    core: false,
    permissions: ["campaigns.manage"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    group: "crecer",
    sections: [
      { label: "Campañas", route: "/campaigns", module: "campaigns", permissions: ["campaigns.manage"] },
      { label: "Audiencias", route: "/campaigns/audiences", module: "campaigns", permissions: ["campaigns.manage"] },
      // 030 (PR 4): antes en Ajustes → Plantillas (que ahora redirige aquí).
      { label: "Plantillas", route: "/campaigns/templates", module: "campaigns", permissions: ["templates.manage"] },
      { label: "Métricas", route: "/campaigns/metrics", module: "campaigns", permissions: ["campaigns.manage"] },
    ],
  },
  // 019 — Primero se atiende y se organiza, luego se mide.
  {
    key: "results",
    label: "Resultados",
    aka: "Inteligencia Reportes Embudo",
    route: "/results",
    icon: "ChartColumn",
    core: false,
    permissions: ["results.read"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    group: "crecer",
    sections: [
      { label: "Resultados y embudo", route: "/results", module: "results", permissions: ["results.read"] },
    ],
  },
  // ── Inteligencia artificial.
  {
    key: "lab",
    label: "Agentes IA",
    aka: "Estudio de IA Laboratorio Agente",
    route: "/lab",
    icon: "BotMessageSquare",
    core: false,
    permissions: ["agent.manage"],
    defaultRoles: ["owner"],
    // El Laboratorio evalúa al agente: sin agente no hay nada que evaluar.
    requires: ["agent"],
    group: "ia",
    sections: [
      // El editor (/lab/agents/[id]) cuenta como parte de Mis agentes.
      // Esencial (sin Laboratorio): UN agente con el creador y la prueba en
      // vivo; el resto de las pestañas piden el Laboratorio (Pro).
      { label: "Mis agentes", route: "/lab", module: "agent", permissions: ["agent.manage"], also: ["/lab/agents"] },
      { label: "Asignación por etapa", route: "/lab/asignacion", module: "lab", permissions: ["agent.manage"] },
      { label: "Pruebas", route: "/lab/evaluaciones", module: "lab", permissions: ["agent.manage"] },
    ],
  },
  // 038 — Asistente interno (premium, solo el Propietario).
  {
    key: "asistente",
    label: "Asistente",
    route: "/asistente",
    icon: "Sparkles",
    core: false,
    permissions: ["assistant.use"],
    defaultRoles: ["owner"],
    requires: [],
    group: "ia",
    sections: [{ label: "Asistente", route: "/asistente", module: "asistente", permissions: ["assistant.use"] }],
  },
  {
    key: "settings",
    label: "Ajustes",
    route: "/settings",
    icon: "Settings",
    core: true,
    // Basta una pestaña que se pueda abrir (ver SETTINGS_TAB_PERMISSION).
    permissions: ["settings.manage", "templates.manage", "users.read", "tags.manage", "team_chat.create_groups", "usage.read", "direct_connection.link", "mi_numero.manage", "pipeline.edit", "agent.manage", "data.export"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    pinnedBottom: true,
  },
  // 039 — Sin renglón propio: viven como pestañas de un pilar (arriba).
  { key: "team_chat", label: "Chat de equipo", route: null, icon: "MessagesSquare", core: false, defaultRoles: ALL, requires: [] },
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

/** Núcleo: Bandeja, Contactos, Pipeline y Ajustes. */
export const CORE_MODULES: readonly ModuleKey[] = MODULES.filter((m) => m.core).map((m) => m.key);


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
const INICIO = {
  team_chat: true,
  knowledge: false,
  results: false,
  trabajo: false,
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
// Esencial: el creador del agente con prueba en vivo, de UN solo agente
// (`agent` sin `lab`; el tope de uno lo pone `createAgent`).
const ESENCIAL = { ...INICIO, knowledge: true, results: true, trabajo: true, agent: true } as const;
// Instagram y Messenger quedan fuera de la oferta hasta probarlos.
const PRO = {
  ...ESENCIAL,
  lab: true,
  agenda: true,
  atribucion: true,
  customNav: true,
} as const;
const ULTRA = { ...PRO, campaigns: true, asistente: true } as const;

export type ProfileModules = { readonly [K in keyof typeof INICIO]: boolean };

export const MODULE_PROFILES = {
  inicio: { label: "Inicio", modules: INICIO as ProfileModules },
  esencial: { label: "Esencial", modules: ESENCIAL as ProfileModules },
  pro: { label: "Pro", modules: PRO as ProfileModules },
  ultra: { label: "Ultra", modules: ULTRA as ProfileModules },
} as const;
export type ModuleProfile = keyof typeof MODULE_PROFILES;

/** Lo que /platform ofrece al crear: los tres planes o «Personalizado» (sin plantilla). */
export const PLAN_OPTIONS = ["inicio", "esencial", "pro", "ultra", "personalizado"] as const;
export type PlanOption = (typeof PLAN_OPTIONS)[number];
export const PLAN_LABEL: Record<PlanOption, string> = {
  inicio: "Inicio",
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
