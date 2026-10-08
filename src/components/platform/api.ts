import type { PlatformModuleToggle } from "@/lib/platform-modules";
import type { AiUsageKind, StorageUsage } from "@/lib/usage";

/**
 * Fase 3 / 036 (PR 4) — Lo que comparten las pantallas de /platform: la
 * llamada a la API y los tipos de lo que responde. Solo metadatos y números
 * de las organizaciones: nunca su contenido.
 */

/** Fase 3, PR 3 — Los módulos opcionales de una organización. */
export type Modules = Record<PlatformModuleToggle, boolean> & {
  campaignSendRate: number;
};

export type Limits = { turns: number | null; tokens: number | null };

/** 036 (PR 4) — El consumo del mes de una organización, para su fila. */
export type OrgUsage = {
  period: string;
  ai: { turns: number; tokens: number; limits: Limits };
  storageBytes: number;
};

export type Org = {
  id: string;
  name: string;
  slug: string | null;
  status: "active" | "suspended" | "deleted";
  statusReason: string | null;
  purgeAfter: string | null;
  createdAt: string;
  isPlatform: boolean;
  members: number;
  owners: { userId: string; name: string; email: string }[];
  whatsappConnected: boolean;
  modules: Modules;
  usage: OrgUsage | null;
};

type Totals = { turns: number; tokens: number };

/** 036 (PR 4) — El detalle del consumo al abrir la fila. */
export type OrgUsageDetail = {
  period: string;
  ai: Totals & {
    limits: Limits;
    byKind: Partial<Record<AiUsageKind, Totals>>;
    byAgent: {
      agentId: string;
      name: string | null;
      archived: boolean;
      turns: number;
      tokens: number;
      byKind: Partial<Record<"agent" | "lab" | "judge", Totals>>;
    }[];
  };
  storage: StorageUsage;
};

export type Member = { userId: string; name: string; email: string; role: string };

export type AuditEntry = {
  id: string;
  at: string;
  actorEmail: string | null;
  action: string;
  targetOrgName: string | null;
  targetUserEmail: string | null;
  ip: string | null;
};

export async function api<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? json : null,
    error: res.ok ? null : json?.error?.message ?? `Error ${res.status}`,
  };
}

export function fecha(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** «octubre de 2026» a partir de 'YYYY-MM-01' (el mes de la cuota, UTC). */
export function mesDe(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
}
