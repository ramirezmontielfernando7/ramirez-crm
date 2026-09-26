import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * 020 — La matriz de permisos de Vocero. UN solo lugar.
 *
 * Se declara con el control de acceso del plugin `organization` de
 * better-auth (el mismo objeto se le pasa al plugin en `src/lib/auth`), así
 * que sus propias rutas de organización respetan los mismos roles. Los
 * recursos de better-auth (`organization`, `member`, `invitation`, `team`,
 * `ac`) solo los tiene el propietario.
 *
 * Regla dura: ninguna ruta pregunta "¿es owner?". Pregunta `can(session,
 * "<permiso>")`. Así, darle o quitarle algo a un rol es cambiar ESTE archivo,
 * y la matriz de pruebas (`tests/unit/permissions*.test.ts`) lo vigila.
 */

const statements = {
  ...defaultStatements,
  /** Crear, renombrar, reordenar y borrar etapas del pipeline. */
  pipeline: ["edit"],
  /** Subir, editar y sincronizar plantillas de Meta. */
  templates: ["manage"],
  /** Marca, WhatsApp, webhooks, canales, agenda, anuncios. */
  settings: ["manage"],
  /** Perfil del agente de IA, base de conocimiento y Laboratorio. */
  agent: ["manage"],
  /** Cuentas del equipo y sus roles. */
  users: ["manage", "read"],
  /** Exportar contactos (la base entera) e importarlos (021). */
  contacts: ["export", "import"],
  /** 021 — Crear, renombrar y borrar etiquetas de contacto. */
  tags: ["manage"],
  /** 021 — Crear y lanzar campañas de envío masivo por plantilla. */
  campaigns: ["manage"],
  /** Asignar y reasignar chats/leads, uno a uno o en lote. */
  assignment: ["manage"],
  /** Ver TODOS los chats, leads y citas, no solo los asignados. */
  scope: ["all"],
  /**
   * `read`: entrar a Resultados (022: el Asesor no, ni a los suyos).
   * `all`: los de todo el equipo, no solo los propios.
   */
  results: ["read", "all"],
  /** 024 — Crear, editar y borrar entradas de Conocimientos (verlas y enviarlas: todos). */
  knowledge: ["manage"],
  /**
   * 025 — Chat de equipo. Usarlo no pide permiso (se ve por membresía).
   * `create_groups`: crear grupos desde Ajustes (delegable al Coordinador).
   * `announce`: publicar en el canal de avisos.
   * `oversee`: ver directos y grupos ajenos (solo lectura) y controlar los
   * ajustes de supervisión.
   */
  team_chat: ["create_groups", "announce", "oversee"],
} as const;

export const ac = createAccessControl(statements);

const owner = ac.newRole({
  ...ownerAc.statements,
  pipeline: ["edit"],
  templates: ["manage"],
  settings: ["manage"],
  agent: ["manage"],
  users: ["manage", "read"],
  contacts: ["export", "import"],
  tags: ["manage"],
  campaigns: ["manage"],
  assignment: ["manage"],
  scope: ["all"],
  results: ["read", "all"],
  knowledge: ["manage"],
  team_chat: ["create_groups", "announce", "oversee"],
});

/** Operación: reparte, ve todo, edita etapas y plantillas. No configura. */
const coordinador = ac.newRole({
  pipeline: ["edit"],
  templates: ["manage"],
  users: ["read"],
  // 021: importa y exporta bases y lanza campañas: es la operación del día a
  // día de una agencia con su cliente (decisión del dueño, 2026-09-25).
  contacts: ["import", "export"],
  tags: ["manage"],
  campaigns: ["manage"],
  assignment: ["manage"],
  scope: ["all"],
  results: ["read", "all"],
  // 024: mantiene al día el material que el equipo manda a los clientes.
  knowledge: ["manage"],
  // 025: publica avisos. Crear grupos solo si el Propietario lo delega
  // (DELEGABLE, abajo); supervisar, nunca.
  team_chat: ["announce"],
});

/** Solo lo suyo: sus chats y sus leads (que sí puede mover). Sin Resultados (022). */
const asesor = ac.newRole({});

export const roles = { owner, coordinador, asesor };

export type Role = keyof typeof roles;

export const ROLES: readonly Role[] = ["owner", "coordinador", "asesor"];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Propietario",
  coordinador: "Coordinador",
  asesor: "Asesor",
};

/** Roles que se pueden dar desde Ajustes → Equipo (propietario hay uno). */
export const ASSIGNABLE_ROLES: readonly Role[] = ["coordinador", "asesor"];

export type Permission =
  | "pipeline.edit"
  | "templates.manage"
  | "settings.manage"
  | "agent.manage"
  | "users.manage"
  | "users.read"
  | "contacts.export"
  | "contacts.import"
  | "tags.manage"
  | "campaigns.manage"
  | "assignment.manage"
  | "scope.all"
  | "results.read"
  | "results.all"
  | "knowledge.manage"
  | "team_chat.create_groups"
  | "team_chat.announce"
  | "team_chat.oversee";

/**
 * 025 — Permisos que el Propietario puede DELEGAR por organización, desde
 * Ajustes (no por código). Sigue siendo esta matriz la que decide: `can()`
 * solo acepta una delegación que esté declarada aquí para ese rol, y la
 * sesión trae las que la organización encendió (`grants`, ver
 * `delegatedGrants` en src/server/team-chat/settings.ts).
 */
export const DELEGABLE: Partial<Record<Permission, readonly Role[]>> = {
  "team_chat.create_groups": ["coordinador"],
};

/** ¿Algún permiso de este rol depende de la organización? (evita la consulta si no). */
export function hasDelegableFor(role: string): boolean {
  return Object.values(DELEGABLE).some((roles) => (roles as readonly string[]).includes(role));
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABEL[role] : "Sin rol";
}

/**
 * ¿Puede este rol hacer esto? Falla CERRADO: un rol desconocido (un `member`
 * que la migración no alcanzó, un typo en BD) no puede nada.
 *
 * `grants` (025): las delegaciones que la organización encendió. Solo cuentan
 * si `DELEGABLE` las declara para ESTE rol: un grant de más en la sesión no
 * le da nada a quien la matriz no lo permite.
 */
export function can(
  subject: { role: string; grants?: readonly Permission[] },
  permission: Permission
): boolean {
  if (!isRole(subject.role)) return false;
  const [resource, action] = permission.split(".") as [string, string];
  if (roles[subject.role].authorize({ [resource]: [action] }).success) return true;
  return (
    !!subject.grants?.includes(permission) &&
    (DELEGABLE[permission] ?? []).includes(subject.role)
  );
}
