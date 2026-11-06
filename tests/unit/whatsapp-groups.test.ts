import { describe, expect, it } from "vitest";
import { isGroupJid, parseDeviceMessages } from "@/lib/direct-inbound";
import { listQueryParams } from "@/lib/inbox-list";
import { parseInboxView } from "@/lib/campaign-inbox";

const jid = "120363000000000000@g.us";
const envelope = (message: object, extra: object = {}) => ({
  key: { id: "GROUP-1", remoteJid: jid, participant: "5215512345678@s.whatsapp.net" },
  pushName: "Ana", messageTimestamp: 1794000000, message, ...extra,
});

describe("grupos de WhatsApp", () => {
  it.each(["status@broadcast", "1@newsletter", "1@s.whatsapp.net", "x@g.us", "1@g.us.evil"])("no interpreta %s como grupo", (value) => {
    expect(isGroupJid(value)).toBe(false);
  });
  it("conserva destino, participante y nombre separados del título", () => {
    const [m] = parseDeviceMessages(envelope({ conversation: "Hola" }, { groupName: "Ventas" }));
    expect(m?.group).toEqual({ jid, subject: "Ventas", sender: "Ana", senderId: "5215512345678@s.whatsapp.net" });
    expect(m?.phone).toBeNull();
    expect(m?.message.text?.body).toBe("Hola");
  });
  it.each([['imageMessage', 'image'], ['audioMessage', 'audio'], ['documentMessage', 'document']])("acepta %s sin perder el participante", (field, kind) => {
    const [m] = parseDeviceMessages(envelope({ [field]: { mimetype: "application/octet-stream", fileName: "prueba" } }));
    expect(m?.message.type).toBe(kind);
    expect(m?.group?.sender).toBe("Ana");
  });
  it("usa el teléfono normalizado cuando el participante no tiene nombre", () => {
    const [m] = parseDeviceMessages(envelope({ conversation: "Hola" }, { pushName: undefined }));
    expect(m?.group?.sender).toBe("525512345678");
  });
  it("la URL conserva la vista de grupos y sus filtros", () => {
    expect(parseInboxView("groups")).toBe("groups");
    const q = listQueryParams({ view: "groups", q: "Ventas", tag: "vip", owner: "mine" });
    expect(Object.fromEntries(q)).toEqual({ view: "groups", q: "Ventas", tag: "vip", assigned: "mine" });
  });
});
