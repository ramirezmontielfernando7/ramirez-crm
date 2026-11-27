/**
 * 048 — Semáforo de clientes en Plataforma (regla PURA): por empresa dice
 * verde, amarillo o rojo y POR QUÉ, para saber a quién llamar antes de que
 * se vaya. Solo con metadatos y conteos (nunca contenido).
 */

export type HealthLevel = "green" | "yellow" | "red" | "inactive";

export type HealthInput = {
  status: "active" | "suspended" | "deleted";
  isPlatform: boolean;
  createdAt: Date;
  whatsappConnected: boolean;
  /** El módulo Agente está encendido para la empresa. */
  agentModule: boolean;
  /** El negocio encendió su agente (y no está en pausa general). */
  agentOn: boolean;
  lastMessageAt: Date | null;
  lastLoginAt: Date | null;
  sent7d: number;
  failed7d: number;
  /** % de la bolsa de IA del mes (null = sin tope). */
  aiPct: number | null;
  /** Estado comercial (`billingState`). */
  billingKind: string;
  billingRestricted: boolean;
};

type Health = { level: HealthLevel; reasons: string[] };

const DAY = 86_400_000;
const daysSince = (d: Date | null, now: Date) => (d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null);

export function healthOf(h: HealthInput, now: Date = new Date()): Health {
  if (h.status !== "active") return { level: "inactive", reasons: [h.status === "suspended" ? "Suspendida" : "Borrada"] };
  const red: string[] = [];
  const yellow: string[] = [];
  const age = daysSince(h.createdAt, now) ?? 0;

  if (h.billingRestricted) red.push(h.billingKind === "trial_expired" ? "Prueba terminada: IA y campañas en pausa" : "Pago vencido: IA y campañas en pausa");
  else if (h.billingKind === "trial_ending") yellow.push("Prueba por terminar");
  else if (h.billingKind === "grace") yellow.push("Pago pendiente (en días de gracia)");
  else if (h.billingKind === "due") yellow.push("Pago por vencer");

  if (!h.whatsappConnected && !h.isPlatform) (age >= 3 ? red : yellow).push("WhatsApp sin conectar");

  const quiet = daysSince(h.lastMessageAt, now);
  const login = daysSince(h.lastLoginAt, now);
  // «Sin uso» = ni mensajes ni entradas: una empresa que solo contesta desde el celular sigue viva.
  const idle = Math.min(quiet ?? Infinity, login ?? Infinity);
  if (age >= 7) {
    if (idle >= 14) red.push(idle === Infinity ? "Nunca la han usado" : `Sin uso hace ${idle} días`);
    else if (idle >= 7) yellow.push(`Sin uso hace ${idle} días`);
  }

  if (h.failed7d >= 5 && h.failed7d / Math.max(1, h.sent7d) >= 0.2) red.push(`${h.failed7d} envíos fallidos en 7 días`);
  else if (h.failed7d > 0) yellow.push(h.failed7d === 1 ? "1 envío fallido en 7 días" : `${h.failed7d} envíos fallidos en 7 días`);

  if (h.aiPct !== null) {
    if (h.aiPct >= 100) red.push("IA del mes agotada");
    else if (h.aiPct >= 80) yellow.push(`IA del mes al ${Math.round(h.aiPct)} %`);
  }
  if (h.agentModule && !h.agentOn && h.whatsappConnected) yellow.push("Tiene agente de IA pero no lo ha encendido");

  if (red.length > 0) return { level: "red", reasons: [...red, ...yellow] };
  if (yellow.length > 0) return { level: "yellow", reasons: yellow };
  return { level: "green", reasons: ["Todo en orden"] };
}

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  green: "Bien",
  yellow: "Revisar",
  red: "Llamar",
  inactive: "Inactiva",
};

/** Orden para la lista: primero a quién llamar. */
export const HEALTH_ORDER: Record<HealthLevel, number> = { red: 0, yellow: 1, green: 2, inactive: 3 };
