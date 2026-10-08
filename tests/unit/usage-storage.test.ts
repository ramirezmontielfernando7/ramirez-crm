import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStorageUsage,
  documentsBytes,
  emptyStorageUsage,
  formatStorage,
  STORAGE_CATEGORIES,
  STORAGE_CATEGORY_LABEL,
  STORAGE_LABEL,
  STORAGE_NOTE,
  toBytes,
} from "@/lib/usage";

/** 036 (PR 2) — Reglas puras del almacenamiento aproximado. */
describe("almacenamiento (aprox.)", () => {
  it("la pantalla lo llama «Almacenamiento (aprox.)» y la nota dice qué incluye y qué no", () => {
    expect(STORAGE_LABEL).toBe("Almacenamiento (aprox.)");
    expect(STORAGE_NOTE).toMatch(/WhatsApp/);
    expect(STORAGE_NOTE).toMatch(/Conocimientos/);
    expect(STORAGE_NOTE).toMatch(/chat de equipo/);
    expect(STORAGE_NOTE).toMatch(/documentos del agente/);
    expect(STORAGE_NOTE).toMatch(/No incluye/);
    for (const c of STORAGE_CATEGORIES) expect(STORAGE_CATEGORY_LABEL[c].length).toBeGreaterThan(5);
  });

  it("documentos del agente: texto + texto de fragmentos + 4 bytes por número del vector", () => {
    expect(documentsBytes({ textBytes: 1000, chunkTextBytes: 1100, embeddingValues: 384 * 3 })).toBe(1000 + 1100 + 384 * 3 * 4);
    expect(documentsBytes({ textBytes: 10, chunkTextBytes: 10, embeddingValues: 0 })).toBe(20);
  });

  it("toBytes acepta lo que devuelve Postgres (texto, bigint, null) y nunca da negativos", () => {
    expect(toBytes("12345")).toBe(12345);
    expect(toBytes(BigInt(7))).toBe(7);
    expect(toBytes(null)).toBe(0);
    expect(toBytes(undefined)).toBe(0);
    expect(toBytes("abc")).toBe(0);
    expect(toBytes(-5)).toBe(0);
    expect(toBytes(3.9)).toBe(3);
  });

  it("buildStorageUsage suma las categorías y deja aparte los archivos sin tamaño", () => {
    const u = buildStorageUsage({
      whatsapp: "2048",
      knowledge: "1024",
      teamChat: 512,
      documents: { textBytes: "100", chunkTextBytes: "120", embeddingValues: "10" },
      filesWithoutSize: 2,
    });
    expect(u.byCategory).toEqual({ whatsapp: 2048, knowledge: 1024, teamChat: 512, documents: 260 });
    expect(u.totalBytes).toBe(2048 + 1024 + 512 + 260);
    expect(u.filesWithoutSize).toBe(2);
  });

  it("sin nada, todo en cero", () => {
    expect(buildStorageUsage({})).toEqual(emptyStorageUsage());
    expect(emptyStorageUsage().totalBytes).toBe(0);
  });

  it("formatStorage en base 1024", () => {
    expect(formatStorage(0)).toBe("0 B");
    expect(formatStorage(1023)).toBe("1023 B");
    expect(formatStorage(512 * 1024)).toBe("512 KB");
    expect(formatStorage(3.4 * 1024 ** 2)).toBe("3.4 MB");
    expect(formatStorage(1.25 * 1024 ** 3)).toBe("1.3 GB");
  });
});

describe("la medición no depende de cómo se reparten los documentos", () => {
  it("storage.ts no lee agente ni grupo de kb_document / kb_chunk (solo suma)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../../src/server/usage/storage.ts"), "utf8");
    expect(src).not.toMatch(/\b(kbDocument|kbChunk)\.(agentId|groupId)\b/);
    expect(src).not.toMatch(/\b(agent_id|group_id)\b/);
  });
});
