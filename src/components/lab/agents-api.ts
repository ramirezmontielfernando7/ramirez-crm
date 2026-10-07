import type { AgentConfig } from "@/server/agents/config";
import type { AgentDetail, AgentSummary, AgentVersion } from "@/server/agents/store";

/** 031 (A2) — Tipos y llamadas del Centro de Agentes (rutas /api/lab/agents/*). */
export type { AgentConfig, AgentDetail, AgentSummary, AgentVersion };

export const STATUS_LABEL: Record<AgentSummary["status"], string> = {
  published: "Publicado",
  draft: "Borrador",
  changes: "Cambios sin publicar",
};

export const NO_NAME_LABEL = "Sin nombre · habla como el negocio";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

/** Llama a la API y devuelve el error en español listo para mostrar (nunca lanza). */
export async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, code: "network", message: "No hay conexión. Revisa tu internet e inténtalo de nuevo." };
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      code: body?.error?.code ?? "error",
      message: body?.error?.message ?? "Algo salió mal. Inténtalo de nuevo.",
    };
  }
  return { ok: true, data: body as T };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
