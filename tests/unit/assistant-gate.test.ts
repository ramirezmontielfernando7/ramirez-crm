import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 038 (PR 1) — Vigilancia del asistente interno. Es SOLO LECTURA sobre los
 * datos del negocio y la única puerta al modelo es `chatJsonForOrg` con el
 * tipo "assistant" (su tope propio). Este test pone en rojo cualquier archivo
 * del asistente que:
 *
 * - importe algo que envíe mensajes o toque campañas (WhatsApp, Instagram,
 *   Messenger, plantillas, el envío de la Bandeja, Campañas, el cerebro externo);
 * - llame al modelo por otra vía (`@/lib/ai` directo) o con otro tipo;
 * - use el pool de sistema (el asistente siempre va a nombre de UNA organización);
 * - escriba en una tabla que no sea suya (conversaciones del asistente y el
 *   aviso aceptado en `user_preference`).
 *
 * 038 (PR 2): y que el catálogo siga CERRADO: el modelo solo pide consultas
 * por nombre; ninguna arma SQL con texto que venga de él (`sql.raw`), y la
 * lista de consultas no cambia sin que alguien actualice este test.
 *
 * Acciones (asistente con las herramientas del conector): lee con ellas y
 * PROPONE cambios y envíos que solo corren con «Aplicar» (`apply.ts`), con la
 * sesión de quien pulsa. Los archivos del asistente siguen sin importar el
 * envío ni las campañas directamente (todo pasa por las herramientas del
 * conector, que ya llevan permisos, ventana de 24 h y tope diario), y
 * escriben solo en sus tablas.
 *
 * 038 (PR 3): el análisis guardado (`conversation_insight`) es su única
 * escritura sobre algo derivado del negocio, y también va por el tipo del
 * asistente (con o sin genérico explícito en la llamada).
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LUGARES = [
  "src/server/assistant",
  "src/app/api/assistant",
  "src/components/assistant",
  "src/app/(app)/asistente",
  "src/lib/assistant.ts",
  "src/lib/assistant-engine.ts",
  "src/lib/conversation-insight.ts",
];

function archivos(rel: string): string[] {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((e) => archivos(path.join(rel, e)));
}

const PROHIBIDOS = [
  "@/server/inbox/send",
  "@/server/whatsapp",
  "@/server/instagram",
  "@/server/messenger",
  "@/server/zernio",
  "@/server/campaigns",
  "@/server/bot",
  "@/lib/meta",
  // El modelo solo por chatJsonForOrg (src/server/ai-quota/llm.ts).
  "@/lib/ai",
];

/** Las únicas tablas en las que el asistente puede escribir. */
const TABLAS_PROPIAS = new Set(["assistantThread", "assistantMessage", "userPreference", "conversationInsight"]);

const todos = LUGARES.flatMap(archivos).filter((f) => /\.(ts|tsx)$/.test(f));

describe("038 — el asistente interno es solo lectura y tiene una sola puerta al modelo", () => {
  it("hay archivos que vigilar", () => {
    expect(todos.length).toBeGreaterThanOrEqual(5);
  });

  it.each(todos.map((f) => [path.relative(ROOT, f), f]))("%s", (_rel, file) => {
    const code = readFileSync(file, "utf8");
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    for (const p of PROHIBIDOS) {
      expect(imports.filter((i) => i === p || i.startsWith(`${p}/`)), `importa ${p}`).toEqual([]);
    }
    expect(code, "pool de sistema").not.toMatch(/getSystemDb|getSystemSql/);
    // Escrituras: solo en sus tablas.
    for (const m of code.matchAll(/\.(insert|update|delete)\(\s*schema\.(\w+)/g)) {
      expect(TABLAS_PROPIAS.has(m[2]!), `${m[1]} en ${m[2]}`).toBe(true);
    }
    // Ningún SQL armado con texto de afuera.
    expect(code, "sql.raw").not.toMatch(/sql\.raw\(/);
    // El modelo: siempre a nombre de la organización y con el tipo del asistente.
    for (const m of code.matchAll(/chatJsonForOrg(?:<[^>(]*>)?\(\s*[^,]+,\s*([^,]+),/g)) {
      expect(m[1]!.trim(), "tipo de IA").toBe(file.endsWith("insights.ts") ? '"analysis"' : '"assistant"');
    }
  });
});

describe("038 (PR 2) — el catálogo de consultas es cerrado", () => {
  it("son exactamente estas consultas (agregar una pide revisar que sea de solo lectura)", async () => {
    const { ASSISTANT_QUERY_NAMES } = await import("@/server/assistant/catalog");
    expect(ASSISTANT_QUERY_NAMES).toEqual([
      "consumo_ia",
      "consumo_ia_por_funcion",
      "consumo_ia_por_agente",
      "almacenamiento",
      "plan_y_topes",
      "avisos_consumo",
      "modulos",
      "equipo",
      "etiquetas",
      "conversaciones_por_etapa",
      "conversaciones_recientes",
      "analisis_conversaciones",
      "auditoria_agentes",
    ]);
  });

  it("el análisis llama al modelo con el tipo del asistente (el detector ve el genérico)", () => {
    const code = readFileSync(path.join(ROOT, "src/server/assistant/insights.ts"), "utf8");
    const calls = [...code.matchAll(/chatJsonForOrg(?:<[^>(]*>)?\(\s*[^,]+,\s*([^,]+),/g)].map((m) => m[1]!.trim());
    expect(calls).toEqual(['"analysis"']);
  });

  it("el catálogo solo lee: ni insert, ni update, ni delete", () => {
    const code = readFileSync(path.join(ROOT, "src/server/assistant/catalog.ts"), "utf8");
    expect(code).not.toMatch(/\.(insert|update|delete)\(/);
    expect(code).not.toMatch(/\.transaction\(/);
  });
});

describe("Acciones — el asistente usa las herramientas del conector, y todo lo que cambia o envía pasa por «Aplicar»", () => {
  it("las exclusiones y los envíos son exactamente estos (cambiarlos pide revisar este test)", async () => {
    const { ASSISTANT_EXCLUDED_TOOLS, SENDING_TOOLS } = await import("@/lib/assistant-actions");
    expect([...ASSISTANT_EXCLUDED_TOOLS]).toEqual(["create_upload_link", "check_upload_link"]);
    expect([...SENDING_TOOLS]).toEqual(["send_message", "send_template", "send_material", "launch_campaign"]);
  });

  it("toda herramienta del conector que envía o lanza está en SENDING_TOOLS (su propuesta enseña a quién y qué sale)", async () => {
    const { SENDING_TOOLS } = await import("@/lib/assistant-actions");
    const { TOOLS } = await import("@/server/ai-connector/tools");
    const names = TOOLS.map((t) => t.name);
    for (const n of SENDING_TOOLS) expect(names, `${n} existe en el conector`).toContain(n);
    for (const t of TOOLS) {
      if (/^(send|launch)_/.test(t.name)) expect([...SENDING_TOOLS], `${t.name} debe estar en SENDING_TOOLS`).toContain(t.name);
    }
  });

  it("el asistente nunca corre una herramienta de cambio sin «Aplicar»: solo `apply.ts` y la lectura la corren", () => {
    const corren = todos
      .filter((f) => /\.run\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(corren).toEqual(["src/server/assistant/apply.ts", "src/server/assistant/tools.ts"]);
    const tools = readFileSync(path.join(ROOT, "src/server/assistant/tools.ts"), "utf8");
    // En tools.ts solo la lectura la corre (runReadTool, con la lista `read`).
    expect(tools.match(/\.run\(/g)?.length).toBe(1);
    expect(tools).toMatch(/tools\.read\.find/);
  });

  it("los envíos marcan «Asistente» (ni nombre de conexión ni conexión del conector)", async () => {
    const { ASSISTANT_CONNECTION_ID, ASSISTANT_SENDER_NAME } = await import("@/lib/assistant-actions");
    expect(ASSISTANT_CONNECTION_ID).toBe("assistant");
    expect(ASSISTANT_SENDER_NAME).toBe("Asistente");
  });
});
