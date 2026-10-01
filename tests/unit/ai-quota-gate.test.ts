import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentPeriod } from "@/server/ai-quota/quota";

/**
 * Fase 3, PR 1 — Toda llamada al modelo va a nombre de una organización y
 * contra su cuota: solo `src/server/ai-quota/llm.ts` importa `chatJson`. Si
 * estás aquí porque esto se puso rojo: usa `chatJsonForOrg(org, tipo, …)`.
 */
const RAIZ = path.resolve(import.meta.dirname, "../..");
const UNICO = "src/server/ai-quota/llm.ts";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("cuota de IA: una sola puerta al modelo", () => {
  it("nadie más que llm.ts importa chatJson", () => {
    const mal: string[] = [];
    for (const abs of archivos(path.join(RAIZ, "src"))) {
      const rel = path.relative(RAIZ, abs).split(path.sep).join("/");
      if (rel === UNICO || rel.startsWith("src/lib/ai/")) continue;
      const src = readFileSync(abs, "utf8");
      const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/ai["']/);
      if (imp && /\bchatJson\b/.test(imp[1]!)) mal.push(rel);
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });

  it("el periodo es el mes calendario en UTC", () => {
    expect(currentPeriod(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10-01");
    expect(currentPeriod(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
    // 31-oct 20:00 en México (UTC-6) ya es 1-nov en UTC: cuenta para noviembre.
    expect(currentPeriod(new Date("2026-11-01T02:00:00Z"))).toBe("2026-11-01");
  });
});
