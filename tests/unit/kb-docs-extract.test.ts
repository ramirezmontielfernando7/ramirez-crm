import { describe, expect, it } from "vitest";
import { extractDocumentText } from "@/server/kb-docs/extract";
import { makePdf } from "../fixtures/pdf";

/** 035 — Del archivo al texto: qué entra y con qué motivo se rechaza lo demás. */

const enc = (s: string) => new TextEncoder().encode(s);

describe("extracción de texto", () => {
  it(".txt y .md: el texto normalizado", async () => {
    expect(await extractDocumentText("faq.txt", enc("Hola\r\n\r\n\r\nEnvío gratis"))).toEqual({
      ok: true,
      mime: "text/plain",
      text: "Hola\n\nEnvío gratis",
    });
    expect(await extractDocumentText("faq.md", enc("# Envíos\n\nGratis"))).toMatchObject({ ok: true, mime: "text/markdown" });
  });

  it(".pdf con texto: sus líneas, con acentos", async () => {
    const r = await extractDocumentText(
      "precios.pdf",
      makePdf(["Envío gratis desde 1234 pesos.", "Horario: lunes a viernes de 9 a 18 h, señor."])
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe("application/pdf");
      expect(r.text).toContain("Envío gratis desde 1234 pesos.");
      expect(r.text).toContain("señor");
    }
  });

  it("un PDF sin texto (escaneado) es no_text; uno dañado, unreadable", async () => {
    expect(await extractDocumentText("escaneo.pdf", makePdf([]))).toEqual({ ok: false, code: "no_text" });
    expect(await extractDocumentText("roto.pdf", enc("%PDF-1.4\nbasura sin estructura"))).toEqual({ ok: false, code: "unreadable" });
  });

  it("vacío, binario o de otro tipo: rechazado con su motivo", async () => {
    expect(await extractDocumentText("vacio.txt", new Uint8Array())).toEqual({ ok: false, code: "empty" });
    expect(await extractDocumentText("blancos.md", enc("   \n\n"))).toEqual({ ok: false, code: "empty" });
    expect(await extractDocumentText("binario.txt", new Uint8Array([1, 0, 2, 0]))).toEqual({ ok: false, code: "unsupported" });
    expect(await extractDocumentText("contrato.docx", enc("PK\u0003\u0004"))).toEqual({ ok: false, code: "unsupported" });
  });
});
