export const roles = ["owner", "coordinator", "advisor"] as const;
export type Role = (typeof roles)[number];
export type Module = "inbox" | "crm" | "studio" | "marketing" | "more";
export const roleLabels: Record<Role, string> = {
  owner: "Propietario",
  coordinator: "Coordinador",
  advisor: "Asesor",
};
const access: Record<Role, readonly Module[]> = {
  owner: ["inbox", "crm", "studio", "marketing", "more"],
  coordinator: ["inbox", "crm", "marketing", "more"],
  advisor: ["inbox", "crm", "more"],
};
export function canAccess(
  role: Role,
  module: Module,
  disabled: readonly Module[] = [],
) {
  return access[role].includes(module) && !disabled.includes(module);
}
export function visibleModules(role: Role, disabled: readonly Module[] = []) {
  return access[role].filter((module) => canAccess(role, module, disabled));
}
export type Session = {
  id: string;
  name: string;
  role: Role;
  expiresAt: number;
  source: "demo";
};
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
export function isSession(value: unknown, now = Date.now()): value is Session {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<Session>;
  return (
    s.source === "demo" &&
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    roles.includes(s.role as Role) &&
    typeof s.expiresAt === "number" &&
    Number.isFinite(s.expiresAt) &&
    s.expiresAt > now &&
    s.expiresAt <= now + SESSION_TTL
  );
}
export function validateLogin(email: string, password: string) {
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ? ""
      : "Escribe un correo válido.",
    password: password ? "" : "Escribe tu contraseña.",
  };
}
export function validatePassword(password: string, confirmation: string) {
  return {
    password: password.length >= 8 ? "" : "Usa al menos 8 caracteres.",
    confirmation:
      password === confirmation ? "" : "Las contraseñas no coinciden.",
  };
}
export type BackAction = "close-layer" | "pop" | "inbox" | "arm-exit" | "exit";
export function resolveBack(
  layer: boolean,
  nested: boolean,
  isInbox: boolean,
  lastPress: number | null,
  now: number,
): BackAction {
  if (layer) return "close-layer";
  if (nested) return "pop";
  if (!isInbox) return "inbox";
  return lastPress !== null && now - lastPress < 2000 ? "exit" : "arm-exit";
}
