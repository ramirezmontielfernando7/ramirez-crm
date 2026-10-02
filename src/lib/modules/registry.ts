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
  | "MessageCircle";

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  /** Ruta de su entrada del menú; `null` = no tiene entrada propia. */
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
  /** Globo del menú. */
  badge?: "inbox" | "team";
  /** Ajustes va anclado abajo: se oculta, pero no se reordena. */
  pinnedBottom?: boolean;
};

const ALL: readonly Role[] = ["owner", "coordinador", "asesor"];

export const MODULES: readonly ModuleDef[] = [
  { key: "inbox", label: "Bandeja", route: "/inbox", icon: "Inbox", core: true, defaultRoles: ALL, requires: [], badge: "inbox" },
  // 025 — Comunicación interna: junto a la Bandeja, porque se usa atendiendo.
  { key: "team_chat", label: "Chat de equipo", route: "/chat", icon: "MessagesSquare", core: false, defaultRoles: ALL, requires: [], badge: "team" },
  // 015 — Citas va antes de Pipeline: es el paso siguiente de un trato.
  { key: "agenda", label: "Citas", route: "/bookings", icon: "CalendarDays", core: false, defaultRoles: ALL, requires: [] },
  { key: "pipeline", label: "Pipeline", route: "/pipeline", icon: "Kanban", core: true, defaultRoles: ALL, requires: [] },
  { key: "contacts", label: "Contactos", route: "/contacts", icon: "Users", core: true, defaultRoles: ALL, requires: [] },
  // 024 — Material que el equipo envía: junto a Contactos.
  { key: "knowledge", label: "Conocimientos", route: "/knowledge", icon: "BookOpen", core: false, defaultRoles: ALL, requires: [] },
  {
    key: "campaigns",
    label: "Campañas",
    route: "/campaigns",
    icon: "Megaphone",
    core: false,
    permissions: ["campaigns.manage"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
  },
  // 019 — Primero se atiende y se organiza, luego se mide.
  {
    key: "results",
    label: "Resultados",
    route: "/results",
    icon: "ChartColumn",
    core: false,
    permissions: ["results.read"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
  },
  {
    key: "agent",
    label: "Agente",
    route: "/agent",
    icon: "Sparkles",
    core: false,
    permissions: ["agent.manage"],
    defaultRoles: ["owner"],
    requires: [],
  },
  {
    key: "lab",
    label: "Laboratorio",
    route: "/lab",
    icon: "FlaskConical",
    core: false,
    permissions: ["agent.manage"],
    defaultRoles: ["owner"],
    // El Laboratorio evalúa al agente: sin agente no hay nada que evaluar.
    requires: ["agent"],
  },
  {
    key: "settings",
    label: "Ajustes",
    route: "/settings",
    icon: "Settings",
    core: true,
    // Basta una pestaña que se pueda abrir (ver SETTINGS_TAB_PERMISSION).
    permissions: ["settings.manage", "templates.manage", "users.read", "tags.manage", "team_chat.create_groups"],
    defaultRoles: ["owner", "coordinador"],
    requires: [],
    pinnedBottom: true,
  },
  { key: "atribucion", label: "Atribución", route: null, icon: "Target", core: false, defaultRoles: ALL, requires: [] },
  { key: "instagram", label: "Instagram", route: null, icon: "Camera", core: false, defaultRoles: ALL, requires: [] },
  { key: "messenger", label: "Messenger", route: null, icon: "MessageCircle", core: false, defaultRoles: ALL, requires: [] },
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
 * Perfiles de alta: SOLO una plantilla para los interruptores al crear la
 * organización. No se guardan: después cada interruptor es independiente.
 * Los canales (Instagram, Messenger) siguen a las variables: necesitan
 * conexión propia.
 */
export const MODULE_PROFILES = {
  basico: {
    label: "Básico",
    modules: { team_chat: true, knowledge: true, results: true, agent: false, lab: false, campaigns: false, agenda: false, atribucion: false, customNav: false },
  },
  completo: {
    label: "Completo",
    modules: { team_chat: true, knowledge: true, results: true, agent: true, lab: true, campaigns: true, agenda: true, atribucion: true, customNav: true },
  },
} as const;
export type ModuleProfile = keyof typeof MODULE_PROFILES;

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
