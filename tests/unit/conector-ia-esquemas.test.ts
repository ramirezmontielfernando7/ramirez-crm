import { describe, expect, it } from "vitest";
import { describeTool, TOOLS } from "@/server/ai-connector/tools";

/**
 * 047 — ChatGPT (y la API de OpenAI) convierten cada herramienta en una
 * función y rechazan algunos esquemas; si UNO falla, ChatGPT no descubre
 * ninguna («action discovery failed»). Este guardarraíl mantiene los
 * esquemas en el subconjunto que aceptan Claude y OpenAI.
 */
const ALLOWED_KEYS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum",
  "description", "minimum", "maximum", "minLength", "maxLength", "minItems",
  "maxItems", "format", "default", "pattern", "anyOf",
]);

function problems(schema: unknown, path: string, out: string[]): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as Record<string, unknown>;
  for (const k of Object.keys(s)) if (!ALLOWED_KEYS.has(k)) out.push(`${path}: palabra «${k}» no admitida`);
  if (!("type" in s) && !("anyOf" in s)) out.push(`${path}: falta «type»`);
  if (s.type === "array" && !s.items) out.push(`${path}: lista sin «items»`);
  if (Array.isArray(s.anyOf)) s.anyOf.forEach((x, i) => problems(x, `${path}/anyOf${i}`, out));
  if (s.properties && typeof s.properties === "object") {
    for (const [k, v] of Object.entries(s.properties)) problems(v, `${path}.${k}`, out);
  }
  if (s.items) problems(s.items, `${path}[]`, out);
}

describe("conector de IA — esquemas compatibles con ChatGPT", () => {
  const tools = TOOLS.map(describeTool);

  it("nombres válidos y únicos", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it("cada esquema es un objeto sin oneOf/allOf/const y con type en cada nodo", () => {
    const out: string[] = [];
    for (const t of tools) {
      if (t.inputSchema.type !== "object") out.push(`${t.name}: el esquema raíz debe ser un objeto`);
      problems(t.inputSchema, t.name, out);
    }
    expect(out).toEqual([]);
  });
});
