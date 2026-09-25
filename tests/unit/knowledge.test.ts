import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTags } from "@/lib/knowledge";
import { readKnowledgeInput } from "@/server/knowledge/input";

/**
 * 024 — Conocimientos: etiquetas, lectura del formulario, entrega (texto o
 * archivo, y su punto de integración) y separación del agente de IA.
 */

const sent = vi.hoisted(() => ({ text: [] as unknown[], media: [] as unknown[] }));

vi.mock("@/server/inbox/send", () => ({
  sendText: async (input: unknown) => {
    sent.text.push(input);
    return { messageId: "msg_t" };
  },
  sendMediaMessage: async (input: unknown) => {
    sent.media.push(input);
    return { messageId: "msg_m" };
  },
}));

vi.mock("@/server/knowledge/store", () => ({
  readKnowledgeFile: async () => Buffer.from("PDF"),
}));

describe("parseTags", () => {
  it("separa por comas, recorta, quita vacíos y repetidos (sin importar mayúsculas)", () => {
    expect(parseTags(" Precios, envíos ,precios,, ")).toEqual(["Precios", "envíos"]);
  });
  it("acepta arreglo y respeta el tope de 10", () => {
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
});

describe("readKnowledgeInput", () => {
  const multipart = (fields: Record<string, string | File>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return new Request("http://x/api/knowledge", { method: "POST", body: form });
  };

  it("multipart con archivo: título, cuerpo, etiquetas y archivo", async () => {
    const r = await readKnowledgeInput(
      multipart({
        title: " Catálogo ",
        body: "Precios 2026",
        tags: "catálogo, precios",
        file: new File(["%PDF"], "catalogo.pdf", { type: "application/pdf" }),
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.title).toBe("Catálogo");
    expect(r.data.tags).toEqual(["catálogo", "precios"]);
    expect(r.data.file).toMatchObject({ fileName: "catalogo.pdf", mimeType: "application/pdf" });
  });

  it("un .docx sin tipo del navegador se reconoce por la extensión", async () => {
    const r = await readKnowledgeInput(
      multipart({ title: "Contrato", file: new File(["x"], "contrato.docx", { type: "" }) })
    );
    expect(r.ok && r.data.file && r.data.file.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("removeFile=true → file null; sin archivo ni removeFile → undefined", async () => {
    const quitar = await readKnowledgeInput(multipart({ removeFile: "true" }));
    expect(quitar.ok && quitar.data.file).toBeNull();
    const nada = await readKnowledgeInput(multipart({ title: "x" }));
    expect(nada.ok && nada.data.file).toBeUndefined();
  });

  it("JSON solo texto", async () => {
    const r = await readKnowledgeInput(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Horario", body: "L-V 9 a 18", tags: ["horario"] }),
      })
    );
    expect(r.ok && r.data).toMatchObject({ title: "Horario", body: "L-V 9 a 18", tags: ["horario"] });
  });

  it("título vacío o demasiado largo → 422", async () => {
    for (const title of ["   ", "x".repeat(201)]) {
      const r = await readKnowledgeInput(multipart({ title }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(422);
    }
  });
});

describe("deliverKnowledgeEntry", () => {
  beforeEach(() => {
    sent.text.length = 0;
    sent.media.length = 0;
  });

  const row = (over: Record<string, unknown> = {}) =>
    ({
      id: "kn_1",
      organizationId: "org_a",
      title: "Catálogo",
      body: "Aquí va el catálogo",
      tags: [],
      filePath: "org_a/kn_1",
      fileName: "catalogo.pdf",
      fileMime: "application/pdf",
      fileSize: 3,
      createdByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as never;

  const target = { kind: "whatsapp_conversation", organizationId: "org_a", conversationId: "cv_1" } as const;

  it("texto → sendText con el cuerpo, por el envío normal (sandbox y ventana incluidas)", async () => {
    const { deliverKnowledgeEntry } = await import("@/server/knowledge/deliver");
    await deliverKnowledgeEntry(target, row(), "text");
    expect(sent.text).toEqual([{ conversationId: "cv_1", organizationId: "org_a", text: "Aquí va el catálogo" }]);
  });

  it("archivo → sendMediaMessage con el archivo y el cuerpo como pie", async () => {
    const { deliverKnowledgeEntry } = await import("@/server/knowledge/deliver");
    await deliverKnowledgeEntry(target, row(), "file");
    expect(sent.media[0]).toMatchObject({
      conversationId: "cv_1",
      file: { mimeType: "application/pdf", fileName: "catalogo.pdf" },
      caption: "Aquí va el catálogo",
    });
  });

  it("un cuerpo más largo que un pie de WhatsApp no va como pie", async () => {
    const { deliverKnowledgeEntry } = await import("@/server/knowledge/deliver");
    await deliverKnowledgeEntry(target, row({ body: "x".repeat(1025) }), "file");
    expect((sent.media[0] as { caption?: string }).caption).toBeUndefined();
  });

  it("sin texto o sin archivo → error tipado, nada se envía", async () => {
    const { deliverKnowledgeEntry, KnowledgeDeliveryError } = await import("@/server/knowledge/deliver");
    await expect(deliverKnowledgeEntry(target, row({ body: "" }), "text")).rejects.toBeInstanceOf(
      KnowledgeDeliveryError
    );
    await expect(
      deliverKnowledgeEntry(target, row({ filePath: null, fileMime: null }), "file")
    ).rejects.toBeInstanceOf(KnowledgeDeliveryError);
    expect(sent.text).toHaveLength(0);
    expect(sent.media).toHaveLength(0);
  });
});

describe("separación del agente", () => {
  it("el agente de IA (src/server/ai) no lee Conocimientos", () => {
    const dir = path.resolve(import.meta.dirname, "..", "..", "src", "server", "ai");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const full = path.join(d, f);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    for (const file of walk(dir)) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/knowledgeEntry|knowledge_entry|server\/knowledge/);
    }
  });
});
