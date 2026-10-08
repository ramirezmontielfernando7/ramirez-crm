import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 035 — Toda llamada al servicio de embeddings va a nombre de una
 * organización y cuenta su uso: solo `src/server/ai-quota/embed.ts` importa
 * `embedTexts`. Si estás aquí porque esto se puso rojo: usa
 * `embedForOrg(org, "query" | "passage", textos)`.
 */
const RAIZ = path.resolve(import.meta.dirname, "../..");
const UNICO = "src/server/ai-quota/embed.ts";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("embeddings: una sola puerta", () => {
  it("nadie más que embed.ts importa embedTexts", () => {
    const mal: string[] = [];
    for (const abs of archivos(path.join(RAIZ, "src"))) {
      const rel = path.relative(RAIZ, abs).split(path.sep).join("/");
      if (rel === UNICO || rel === "src/lib/ai/embeddings.ts") continue;
      const src = readFileSync(abs, "utf8");
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/ai\/embeddings["']/g)) {
        if (/\bembedTexts\b/.test(m[1]!)) mal.push(rel);
      }
      if (/import\(\s*["']@\/lib\/ai\/embeddings["']\s*\)/.test(src)) mal.push(`${rel} (import dinámico)`);
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });
});
