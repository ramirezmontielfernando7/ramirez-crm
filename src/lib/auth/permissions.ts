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
  /** Exportar contactos. */
  contacts: ["export"],
  /** Asignar y reasignar chats/leads, uno a uno o en lote. */
  assignment: ["manage"],
  /** Ver TODOS los chats, leads y citas, no solo los asignados. */
  scope: ["all"],
  /** Ver los resultados de todo el equipo, no solo los propios. */
  results: ["all"],
} as const;

export const ac = createAccessControl(statements);

const owner = ac.newRole({
  ...ownerAc.statements,
  pipeline: ["edit"],
  templates: ["manage"],
  settings: ["manage"],
  agent: ["manage"],
  users: ["manage", "read"],
  contacts: ["export"],
  assignment: ["manage"],
  scope: ["all"],
  results: ["all"],
});

/** Operación: reparte, ve todo, edita etapas y plantillas. No configura. */
const coordinador = ac.newRole({
  pipeline: ["edit"],
  templates: ["manage"],
  users: ["read"],
  assignment: ["manage"],
  scope: ["all"],
  results: ["all"],
});

/** Solo lo suyo: sus chats, sus leads (que sí puede mover), sus resultados. */
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
  | "assignment.manage"
  | "scope.all"
  | "results.all";

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABEL[role] : "Sin rol";
}

/**
 * ¿Puede este rol hacer esto? Falla CERRADO: un rol desconocido (un `member`
 * que la migración no alcanzó, un typo en BD) no puede nada.
 */
export function can(
  subject: { role: string },
  permission: Permission
): boolean {
  if (!isRole(subject.role)) return false;
  const [resource, action] = permission.split(".") as [string, string];
  return roles[subject.role].authorize({ [resource]: [action] }).success;
}
