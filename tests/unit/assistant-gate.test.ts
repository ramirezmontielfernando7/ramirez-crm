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
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LUGARES = [
  "src/server/assistant",
  "src/app/api/assistant",
  "src/components/assistant",
  "src/app/(app)/asistente",
  "src/lib/assistant.ts",
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
const TABLAS_PROPIAS = new Set(["assistantThread", "assistantMessage", "userPreference"]);

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
    // El modelo: siempre a nombre de la organización y con el tipo del asistente.
    for (const m of code.matchAll(/chatJsonForOrg\(\s*[^,]+,\s*([^,]+),/g)) {
      expect(m[1]!.trim(), "tipo de IA").toBe('"assistant"');
    }
  });
});
