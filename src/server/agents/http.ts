import { apiError } from "@/lib/api";
import { StageNotFoundError, StageTakenError } from "./assignments";
import { KbError } from "./kb";
import { AgentError } from "./store";

/**
 * 031 — Los errores tipados de los agentes, como respuesta HTTP. `null` si
 * el error no es de aquí (la ruta lo relanza y `withAuth` responde 500).
 */
export function agentErrorResponse(err: unknown): Response | null {
  if (err instanceof AgentError) {
    const status = err.code === "not_found" ? 404 : err.code === "unknown_group" ? 422 : 409;
    return apiError(status, err.code, err.message);
  }
  if (err instanceof StageTakenError) {
    return Response.json(
      { error: { code: "stage_taken", message: err.message, current: err.current } },
      { status: 409 }
    );
  }
  if (err instanceof StageNotFoundError) return apiError(404, "stage_not_found", err.message);
  if (err instanceof KbError) {
    return apiError(404, err.code, err.code === "agent_not_found" ? "Agente no encontrado" : "Entrada no encontrada");
  }
  return null;
}

/** Corre `fn` y traduce los errores tipados; los demás se relanzan. */
export async function withAgentErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const res = agentErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
