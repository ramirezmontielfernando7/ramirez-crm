import { z } from "zod";
import { getEnv } from "@/lib/env";
import type { AiRole } from "@/lib/costs";
import { chatJson } from "./index";
import { embedTexts, embeddingsConfig } from "./embeddings";

/**
 * «Probar conexión» de Plataforma → Costos: UNA llamada mínima por función
 * (modelo principal, juez, análisis, embeddings) para confirmar que el
 * proveedor reconoce el modelo. Es de PLATAFORMA, no de una organización: no
 * cuenta en ninguna cuota ni en `ai_usage`. Va por el mismo adaptador que el
 * resto (`chatJson`, `embedTexts`), así que prueba justo la ruta real, sea
 * cual sea el proveedor. Devuelve solo OK/error y latencia: nunca el
 * contenido de la respuesta ni la llave.
 */

export type ProbeResult = {
  role: AiRole;
  ok: boolean;
  /** El modelo probado (el nombre, no un secreto). */
  model: string | null;
  latencyMs: number;
  /** Si falló, por qué (recortado y sin la llave). */
  detail?: string;
};

const pong = z.object({ ok: z.boolean() });

function clean(detail: string): string {
  const env = getEnv();
  let d = detail;
  for (const secret of [env.OPENROUTER_API_TOKEN, env.EMBEDDINGS_API_TOKEN]) {
    if (secret && secret.length >= 8) d = d.split(secret).join("***");
  }
  return d.replace(/\s+/g, " ").slice(0, 240);
}

export async function probeRole(role: AiRole): Promise<ProbeResult> {
  const env = getEnv();
  const started = Date.now();
  const done = (model: string | null, ok: boolean, detail?: string): ProbeResult => ({
    role,
    ok,
    model,
    latencyMs: Date.now() - started,
    ...(detail ? { detail: clean(detail) } : {}),
  });

  if (role === "embed") {
    const cfg = embeddingsConfig();
    if (!cfg) return done(null, false, "Sin servicio de embeddings configurado (EMBEDDINGS_BASE_URL)");
    const r = await embedTexts(["hola"], "query", { timeoutMs: 20_000 });
    return r.ok ? done(cfg.model, true) : done(cfg.model, false, r.detail ?? r.error);
  }

  const model =
    role === "main"
      ? env.OPENROUTER_MODEL
      : role === "judge"
        ? (env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL)
        : (env.OPENROUTER_ANALYSIS_MODEL ?? env.OPENROUTER_MODEL);
  const name = model?.trim() || null;
  if (!name) return done(null, false, "Sin modelo configurado");

  const r = await chatJson(
    pong,
    [
      { role: "system", content: 'Responde únicamente este JSON, sin nada más: {"ok":true}' },
      { role: "user", content: "ping" },
    ],
    { model: name, timeoutMs: 20_000 }
  );
  if (r.ok) return done(name, true);
  // El modelo contestó pero con otro formato: el proveedor sí lo reconoció.
  if (r.error === "invalid_output") return done(name, true, "Respondió, pero no en el formato pedido");
  return done(name, false, r.detail ?? r.error);
}
