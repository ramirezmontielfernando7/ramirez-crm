import { describe, expect, it } from "vitest";
import {
  DIRECT_TEXT,
  freeTextOutsideWindow,
  WINDOW_CLOSED_DIRECT_HINT,
  type InboxDirectContext,
} from "@/lib/direct-connection";
import {
  contactFromVcard,
  DEVICE_MEDIA_PREFIX,
  DEVICE_MESSAGE_PREFIX,
  deviceMediaKeyId,
  isPersonalChat,
  parseDeviceMessages,
} from "@/lib/direct-inbound";
import { routeFor, type RouteInput } from "@/lib/direct-send";
import { WEBHOOK_EVENTS } from "@/server/direct-connection/evolution-api";

/**
 * Conexión directa (PR 6) — empresa SIN Meta: todo entra y sale por el
 * dispositivo vinculado. Por dónde sale cada mensaje (persona, IA, campañas),
 * cómo se lee lo que entra del dispositivo y cuándo el compositor deja
 * escribir con la ventana de 24 h cerrada.
 */

const NOW = new Date("2026-11-20T12:00:00Z");

function input(over: Partial<RouteInput> = {}): RouteInput {
  return {
    moduleOn: true,
    allowDirect: true,
    channel: "whatsapp",
    chatMode: null,
    settings: { defaultMode: "meta", preferMetaInWindow: true, aiViaDirect: false },
    connection: { status: "connected", pausedUntil: null },
    windowOpen: true,
    now: NOW,
    hasMeta: false,
    ...over,
  };
}

describe("sin Meta — por dónde sale cada mensaje", () => {
  it("una persona sale por el dispositivo en cualquier chat, con la ventana abierta o cerrada", () => {
    expect(routeFor(input())).toEqual({ via: "directa" });
    expect(routeFor(input({ chatMode: "meta" }))).toEqual({ via: "directa" });
    expect(routeFor(input({ windowOpen: false }))).toEqual({ via: "directa" });
  });

  it("la IA solo si la plataforma encendió «IA por conexión directa»", () => {
    const ai = { allowDirect: false, ai: true };
    expect(routeFor(input(ai))).toEqual({ via: "meta" });
    expect(routeFor(input({ ...ai, settings: { defaultMode: "meta", preferMetaInWindow: true, aiViaDirect: true } }))).toEqual({
      via: "directa",
    });
  });

  it("con Meta la IA sale por Meta aunque el ajuste esté encendido", () => {
    const settings = { defaultMode: "directa" as const, preferMetaInWindow: false, aiViaDirect: true };
    expect(routeFor(input({ hasMeta: true, allowDirect: false, ai: true, settings }))).toEqual({ via: "meta" });
    // Y sin decirlo (`hasMeta` ausente) es una empresa con Meta: lo de siempre.
    expect(routeFor(input({ hasMeta: undefined, allowDirect: false, ai: true, settings }))).toEqual({ via: "meta" });
  });

  it("campañas, plantillas, cerebro externo y bajas no piden la directa: siguen por Meta (y fallan como hoy)", () => {
    expect(routeFor(input({ allowDirect: false }))).toEqual({ via: "meta" });
  });

  it("sin dispositivo, desconectado o en pausa: falla claro (no hay Meta a dónde caer)", () => {
    expect(routeFor(input({ connection: null }))).toEqual({ via: "unavailable", reason: "disconnected" });
    expect(routeFor(input({ connection: { status: "pending", pausedUntil: null } }))).toEqual({
      via: "unavailable",
      reason: "disconnected",
    });
    expect(routeFor(input({ connection: { status: "disconnected", pausedUntil: null } }))).toEqual({
      via: "unavailable",
      reason: "disconnected",
    });
    expect(routeFor(input({ connection: { status: "connected", pausedUntil: new Date(NOW.getTime() + 60_000) } }))).toEqual({
      via: "unavailable",
      reason: "paused",
    });
  });

  it("sin el complemento o fuera de WhatsApp: Meta, como siempre", () => {
    expect(routeFor(input({ moduleOn: false }))).toEqual({ via: "meta" });
    expect(routeFor(input({ channel: "instagram" }))).toEqual({ via: "meta" });
  });
});

/* ───────── Lo que entra por el dispositivo ───────── */

const base = (over: Record<string, unknown> = {}, key: Record<string, unknown> = {}) => ({
  key: { remoteJid: "5215512345678@s.whatsapp.net", fromMe: false, id: "3EB0ABCDEF123456", ...key },
  pushName: "Ana",
  messageTimestamp: 1763640000,
  message: { conversation: "hola" },
  ...over,
});

describe("sin Meta — leer lo que manda el dispositivo", () => {
  it("un texto del contacto: teléfono en la forma de Dashfort (52 + 10), nombre e ID propio", () => {
    const [m] = parseDeviceMessages(base());
    expect(m).toMatchObject({
      keyId: "3EB0ABCDEF123456",
      fromMe: false,
      phone: "525512345678",
      pushName: "Ana",
      timestamp: "1763640000",
      message: {
        id: `${DEVICE_MESSAGE_PREFIX}3EB0ABCDEF123456`,
        from: "525512345678",
        type: "text",
        text: { body: "hola" },
      },
    });
  });

  it("texto largo, respuestas citadas y mensajes temporales también son texto", () => {
    expect(parseDeviceMessages(base({ message: { extendedTextMessage: { text: "con cita" } } }))[0]?.message.text?.body).toBe(
      "con cita"
    );
    expect(
      parseDeviceMessages(base({ message: { ephemeralMessage: { message: { conversation: "temporal" } } } }))[0]?.message.text
        ?.body
    ).toBe("temporal");
  });

  it("archivos: imagen con texto, nota de voz y documento (también envuelto con texto)", () => {
    const img = parseDeviceMessages(base({ message: { imageMessage: { mimetype: "image/jpeg", caption: "foto" } } }))[0];
    expect(img?.message).toMatchObject({
      type: "image",
      image: { id: `${DEVICE_MEDIA_PREFIX}3EB0ABCDEF123456`, mime_type: "image/jpeg", caption: "foto" },
    });
    const voice = parseDeviceMessages(base({ message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } } }))[0];
    expect(voice?.message).toMatchObject({ type: "audio", audio: { voice: true } });
    const doc = parseDeviceMessages(
      base({
        message: {
          documentWithCaptionMessage: {
            message: { documentMessage: { mimetype: "application/pdf", fileName: "cotizacion.pdf", caption: "va" } },
          },
        },
      })
    )[0];
    expect(doc?.message).toMatchObject({ type: "document", document: { filename: "cotizacion.pdf", caption: "va" } });
  });

  it("ubicación y contacto compartido en la forma que ya pinta la burbuja", () => {
    const loc = parseDeviceMessages(
      base({ message: { locationMessage: { degreesLatitude: 19.43, degreesLongitude: -99.13, name: "Oficina" } } })
    )[0];
    expect(loc?.message).toMatchObject({ type: "location", location: { latitude: 19.43, longitude: -99.13, name: "Oficina" } });
    const card = parseDeviceMessages(
      base({
        message: {
          contactMessage: { displayName: "Luis", vcard: "BEGIN:VCARD\nFN:Luis Pérez\nitem1.TEL;waid=5215511112222:+52 1 55 1111 2222\nEND:VCARD" },
        },
      })
    )[0];
    expect(card?.message.contacts).toEqual([
      { name: { formatted_name: "Luis", first_name: "Luis" }, phones: [{ phone: "+52 1 55 1111 2222" }] },
    ]);
    expect(contactFromVcard(null, "FN:Solo Nombre")).toEqual({
      name: { formatted_name: "Solo Nombre", first_name: "Solo Nombre" },
      phones: [],
    });
  });

  it("lo que escribe el negocio (celular o Dashfort) va con `to` y sin nombre de perfil", () => {
    const [m] = parseDeviceMessages(base({}, { fromMe: true }));
    expect(m).toMatchObject({ fromMe: true, pushName: null, message: { to: "525512345678" } });
    expect(m?.message.from).toBeUndefined();
  });

  it("contacto con ID privado (@lid): el teléfono sale del campo alterno; sin él, solo el ID", () => {
    const [alt] = parseDeviceMessages(base({}, { remoteJid: "123456789012345@lid", remoteJidAlt: "5215512345678@s.whatsapp.net" }));
    expect(alt).toMatchObject({ phone: "525512345678", lid: "123456789012345@lid" });
    const [pn] = parseDeviceMessages(base({}, { remoteJid: "123456789012345@lid", senderPn: "5215512345678@s.whatsapp.net" }));
    expect(pn?.phone).toBe("525512345678");
    const [only] = parseDeviceMessages(base({}, { remoteJid: "123456789012345@lid" }));
    expect(only).toMatchObject({ phone: null, lid: "123456789012345@lid" });
    expect(only?.message.from).toBeUndefined();
  });

  it("grupos, estados, difusión, reacciones, borrados y basura no entran", () => {
    expect(parseDeviceMessages(base({}, { remoteJid: "120363000000000000@g.us" }))).toEqual([]);
    expect(parseDeviceMessages(base({}, { remoteJid: "status@broadcast" }))).toEqual([]);
    expect(parseDeviceMessages(base({}, { remoteJid: "120363000000000000@newsletter" }))).toEqual([]);
    expect(parseDeviceMessages(base({ message: { reactionMessage: { text: "👍" } } }))).toEqual([]);
    expect(parseDeviceMessages(base({ message: { protocolMessage: { type: 0 } } }))).toEqual([]);
    expect(parseDeviceMessages(base({}, { id: "" }))).toEqual([]);
    expect(parseDeviceMessages(null)).toEqual([]);
    expect(parseDeviceMessages("x")).toEqual([]);
    expect(parseDeviceMessages({ key: { id: "A" } })).toEqual([]);
    expect(isPersonalChat("5215512345678@s.whatsapp.net")).toBe(true);
    expect(isPersonalChat("120363000000000000@g.us")).toBe(false);
  });

  it("uno o varios por aviso; la hora en segundos aunque venga en milisegundos, texto o {low}", () => {
    const many = parseDeviceMessages([base(), base({}, { id: "OTRO0000000000001" })]);
    expect(many.map((m) => m.keyId)).toEqual(["3EB0ABCDEF123456", "OTRO0000000000001"]);
    expect(parseDeviceMessages({ messages: [base()] })).toHaveLength(1);
    expect(parseDeviceMessages(base({ messageTimestamp: 1763640000123 }))[0]?.timestamp).toBe("1763640000");
    expect(parseDeviceMessages(base({ messageTimestamp: "1763640000" }))[0]?.timestamp).toBe("1763640000");
    expect(parseDeviceMessages(base({ messageTimestamp: { low: 1763640000, high: 0 } }))[0]?.timestamp).toBe("1763640000");
    expect(parseDeviceMessages(base({ messageTimestamp: undefined }), NOW)[0]?.timestamp).toBe(String(NOW.getTime() / 1000));
  });

  it("el archivo se reconoce por su prefijo; uno de Meta no", () => {
    expect(deviceMediaKeyId(`${DEVICE_MEDIA_PREFIX}ABC123`)).toBe("ABC123");
    expect(deviceMediaKeyId("1234567890")).toBeNull();
    expect(deviceMediaKeyId(null)).toBeNull();
    expect(deviceMediaKeyId(DEVICE_MEDIA_PREFIX)).toBeNull();
  });

  it("el servidor manda también los mensajes (para las empresas sin Meta)", () => {
    expect(WEBHOOK_EVENTS).toContain("MESSAGES_UPSERT");
  });
});

/* ───────── El compositor con la ventana cerrada ───────── */

const ctx = (over: Partial<InboxDirectContext> = {}): InboxDirectContext => ({
  defaultMode: "meta",
  canChangeMode: true,
  deviceReady: true,
  paused: false,
  metaless: false,
  ...over,
});

describe("sin Meta — escribir con la ventana cerrada", () => {
  const wa = (connectionMode: string | null) => ({ channel: "whatsapp", connectionMode });

  it("sin Meta siempre se puede escribir (el envío dice si el dispositivo no está)", () => {
    expect(freeTextOutsideWindow(ctx({ metaless: true }), wa(null))).toBe(true);
    expect(freeTextOutsideWindow(ctx({ metaless: true, deviceReady: false }), wa("meta"))).toBe(true);
  });

  it("con Meta: solo un chat Directa/Automática con el dispositivo listo; Oficial pide plantilla", () => {
    expect(freeTextOutsideWindow(ctx(), wa("directa"))).toBe(true);
    expect(freeTextOutsideWindow(ctx(), wa("mixta"))).toBe(true);
    expect(freeTextOutsideWindow(ctx(), wa("meta"))).toBe(false);
    expect(freeTextOutsideWindow(ctx(), wa(null))).toBe(false);
    expect(freeTextOutsideWindow(ctx({ defaultMode: "directa" }), wa(null))).toBe(true);
    expect(freeTextOutsideWindow(ctx({ deviceReady: false }), wa("directa"))).toBe(false);
  });

  it("sin el complemento u otro canal: lo de siempre", () => {
    expect(freeTextOutsideWindow(null, wa("directa"))).toBe(false);
    expect(freeTextOutsideWindow(ctx({ metaless: true }), { channel: "instagram", connectionMode: null })).toBe(false);
  });

  it("textos discretos: nunca «no oficial», «Evolution» ni «Baileys»", () => {
    for (const t of [DIRECT_TEXT.metalessNote, WINDOW_CLOSED_DIRECT_HINT]) {
      expect(t).not.toMatch(/no\s*oficial|evolution|baileys/i);
    }
  });
});
