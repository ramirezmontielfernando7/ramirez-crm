import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  directIdFromWamid,
  directStatusOf,
  parseDirectStatusUpdates,
  pickEchoFallback,
  type EchoCandidate,
} from "@/lib/direct-echo";

/**
 * Conexión directa (PR 4) — reglas puras para unir el eco de Meta con lo que
 * salió por el dispositivo vinculado, y las palomitas que manda el
 * dispositivo.
 */

/** Un `wamid` con la forma vista en la Fase 0: `… 0x18 <largo> <ID> 0x00`. */
function wamid(phone: string, id: string, opts: { trailingZero?: boolean; urlSafe?: boolean } = {}) {
  const bytes = Buffer.concat([
    Buffer.from([0x1c, 0x18, phone.length]),
    Buffer.from(phone, "latin1"),
    Buffer.from([0x15, 0x02, 0x00, 0x11, 0x18, id.length]),
    Buffer.from(id, "latin1"),
    Buffer.from(opts.trailingZero === false ? [] : [0x00]),
  ]);
  const b64 = bytes.toString("base64");
  return `wamid.${opts.urlSafe ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b64}`;
}

describe("conexión directa — el ID del dispositivo dentro del wamid", () => {
  it("lee el ID de un wamid real de Meta", () => {
    expect(directIdFromWamid("wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBJDQjZCMzlEQUE4OTJBMTE4RTUA")).toBe("CB6B39DAA892A118E5");
  });

  it("lee IDs de Evolution de distintos largos (16, 20, 22, 32), con número de México de 13 dígitos", () => {
    for (const id of ["3EB0C431D5B4ECF1", "3EB0C431D5B4ECF1A2B3", "BAE5F0A1B2C3D4E5F6A7B8", "3EB0" + "A".repeat(28)]) {
      expect(directIdFromWamid(wamid("5215512340000", id))).toBe(id);
    }
  });

  it("sin el cero final, en base64 de URL y sin relleno", () => {
    expect(directIdFromWamid(wamid("5215512340000", "3EB0ABCDEF012345", { trailingZero: false }))).toBe("3EB0ABCDEF012345");
    expect(directIdFromWamid(wamid("5215512340000", "3EB0ABCDEF012345", { urlSafe: true }))).toBe("3EB0ABCDEF012345");
  });

  it("si la forma cambia, toma el último tramo de letras y números", () => {
    const raro = `wamid.${Buffer.from("\x01\x02xx\x7f3EB0FEDCBA987654\x00", "latin1").toString("base64")}`;
    expect(directIdFromWamid(raro)).toBe("3EB0FEDCBA987654");
  });

  it("lo que no se puede leer es null (y se usa el respaldo)", () => {
    expect(directIdFromWamid(null)).toBeNull();
    expect(directIdFromWamid("")).toBeNull();
    expect(directIdFromWamid("wamid.abc")).toBeNull();
    expect(directIdFromWamid("wamid.@@@@####$$$$")).toBeNull();
    expect(directIdFromWamid(`wamid.${Buffer.from("\x01\x02\x03\x04\x05\x06\x07\x08\x09", "latin1").toString("base64")}`)).toBeNull();
  });
});

describe("conexión directa — respaldo por chat, texto y hora", () => {
  const t0 = new Date("2026-10-22T12:00:00Z");
  const sec = (s: number) => new Date(t0.getTime() + s * 1000);
  const c = (over: Partial<EchoCandidate>): EchoCandidate => ({
    id: "m1",
    type: "text",
    text: "Hola",
    status: "sent",
    altMessageId: null,
    at: t0,
    ...over,
  });

  it("une el mismo texto a menos de 2 min; gana el más cercano", () => {
    const pick = pickEchoFallback({ type: "text", text: "Hola", at: sec(5), directId: null }, [
      c({ id: "lejos", at: sec(-60) }),
      c({ id: "cerca", at: sec(3) }),
    ]);
    expect(pick?.id).toBe("cerca");
  });

  it("no une otro texto, otro tipo, ni algo a más de 2 min", () => {
    expect(pickEchoFallback({ type: "text", text: "Hola", at: t0, directId: null }, [c({ text: "Adiós" })])).toBeNull();
    expect(pickEchoFallback({ type: "image", text: null, at: t0, directId: null }, [c({})])).toBeNull();
    expect(pickEchoFallback({ type: "text", text: "Hola", at: sec(121), directId: null }, [c({})])).toBeNull();
  });

  it("un archivo se une por tipo y hora (su eco no trae el texto)", () => {
    expect(pickEchoFallback({ type: "image", text: null, at: sec(2), directId: null }, [c({ type: "image", text: null })])?.id).toBe("m1");
  });

  it("nunca contradice al ID: si el eco y el envío traen IDs distintos, no se unen", () => {
    expect(pickEchoFallback({ type: "text", text: "Hola", at: t0, directId: "AAA111" }, [c({ altMessageId: "BBB222" })])).toBeNull();
    // El envío sin ID (se agotó el tiempo) sí puede unirse.
    expect(pickEchoFallback({ type: "text", text: "Hola", at: t0, directId: "AAA111" }, [c({ altMessageId: null, status: "failed" })])?.id).toBe("m1");
  });
});

describe("conexión directa — palomitas del dispositivo", () => {
  it("traduce los estados de Baileys (texto y número)", () => {
    expect(directStatusOf("SERVER_ACK")).toBe("sent");
    expect(directStatusOf("DELIVERY_ACK")).toBe("delivered");
    expect(directStatusOf("READ")).toBe("read");
    expect(directStatusOf("PLAYED")).toBe("read");
    expect(directStatusOf(3)).toBe("delivered");
    expect(directStatusOf(4)).toBe("read");
    expect(directStatusOf("ERROR")).toBeNull();
    expect(directStatusOf("PENDING")).toBeNull();
    expect(directStatusOf(undefined)).toBeNull();
  });

  it("lee las dos formas de messages.update y descarta lo que no salió de nuestro número", () => {
    expect(
      parseDirectStatusUpdates({ keyId: "3EB0AAA", remoteJid: "5215512340000@s.whatsapp.net", fromMe: true, status: "DELIVERY_ACK", datetime: 1792633224748 })
    ).toEqual([{ id: "3EB0AAA", status: "delivered", at: new Date(1792633224748) }]);
    expect(
      parseDirectStatusUpdates([
        { key: { id: "3EB0BBB", fromMe: true }, update: { status: 4 } },
        { key: { id: "3EB0CCC", fromMe: false }, update: { status: 4 } },
        { keyId: "3EB0DDD", status: "PENDING" },
        null,
        "basura",
      ])
    ).toEqual([{ id: "3EB0BBB", status: "read", at: null }]);
    expect(parseDirectStatusUpdates(undefined)).toEqual([]);
  });
});

describe("conexión directa — guardarraíles de la unión", () => {
  const SRC = path.resolve(import.meta.dirname, "../../src");
  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : [];
    });

  it("solo la ingesta de ecos usa la unión", () => {
    const quien = archivos(SRC)
      .filter((f) => /@\/server\/direct-connection\/echo["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(quien).toEqual(["server/inbox/ingest.ts"]);
  });

  it("la ingesta pregunta por la unión ANTES de registrar el eco", () => {
    const ingest = readFileSync(path.join(SRC, "server/inbox/ingest.ts"), "utf8");
    const fn = ingest.slice(ingest.indexOf("async function ingestManualEcho"));
    expect(fn.indexOf("joinDirectEcho(")).toBeGreaterThan(0);
    expect(fn.indexOf("joinDirectEcho(")).toBeLessThan(fn.indexOf(".insert(schema.message)"));
    expect(fn).toMatch(/if \(join\.joined\) return;/);
  });
});
