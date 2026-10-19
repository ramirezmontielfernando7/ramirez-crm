import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  campaignKeepsPending,
  campaignPendingLabel,
  campaignReplyLabel,
  inboxViewOf,
  parseInboxView,
} from "@/lib/campaign-inbox";

/**
 * 041 — Reglas puras de los chats de campaña en la Bandeja, y guardarraíles
 * de que los caminos de envío masivo no publican eventos por cada tick.
 */

describe("chats de campaña: reglas puras", () => {
  it("solo queda en «Campañas» quien nunca escribió (y nunca el Laboratorio)", () => {
    expect(campaignKeepsPending({ lastInboundAt: null, isTest: false })).toBe(true);
    expect(campaignKeepsPending({ lastInboundAt: new Date(), isTest: false })).toBe(false);
    expect(campaignKeepsPending({ lastInboundAt: "2026-10-01T00:00:00Z", isTest: false })).toBe(false);
    expect(campaignKeepsPending({ lastInboundAt: null, isTest: true })).toBe(false);
  });

  it("la lista se decide por la marca de pendiente", () => {
    expect(inboxViewOf({ campaignPendingId: "cmp_1" })).toBe("campaigns");
    expect(inboxViewOf({ campaignPendingId: null })).toBe("main");
  });

  it("la vista solo acepta «campaigns»; lo demás es la principal", () => {
    expect(parseInboxView("campaigns")).toBe("campaigns");
    expect(parseInboxView(null)).toBe("main");
    expect(parseInboxView("archived")).toBe("main");
    expect(parseInboxView("")).toBe("main");
  });

  it("textos de la marca, con y sin campaña (borrada)", () => {
    expect(campaignReplyLabel("Buen Fin")).toBe("Respondió a campaña Buen Fin");
    expect(campaignReplyLabel(null)).toBe("Respondió a una campaña");
    expect(campaignReplyLabel("  ")).toBe("Respondió a una campaña");
    expect(campaignPendingLabel("Buen Fin")).toBe("Campaña Buen Fin · sin respuesta");
    expect(campaignPendingLabel(undefined)).toBe("Campaña · sin respuesta");
  });
});

describe("chats de campaña: guardarraíles de eventos en vivo", () => {
  const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

  it("el despachador marca el chat y pide el envío sin aviso cuando queda pendiente", () => {
    const d = src("src/server/campaigns/dispatcher.ts");
    expect(d).toMatch(/markCampaignPending\(organizationId, conversation\.id, campaign\.id\)/);
    expect(d).toMatch(/silent: pending/);
  });

  it("sendTemplate solo publica message.new si no es silencioso", () => {
    const t = src("src/server/whatsapp/templates.ts");
    expect(t).toMatch(/if \(!input\.silent\) \{\s*publish\(input\.organizationId, \{\s*type: "message\.new"/);
  });

  it("los ticks de estado de mensajes de campaña no se publican", () => {
    const s = src("src/server/inbox/status.ts");
    expect(s).toMatch(/if \(msg\.fromCampaign\) return;\s*\n(\s*\n)?\s*publish\(organizationId, \{\s*type: "message\.status"/);
  });

  it("el primer entrante suelta la marca en la MISMA sentencia que suma no leídos", () => {
    const i = src("src/server/inbox/ingest.ts");
    const update = i.slice(i.indexOf("unreadCount: sql`"), i.indexOf("await onLeadActivity"));
    expect(update).toMatch(/campaignPendingId: null/);
    expect(update).toMatch(/campaignRepliedId: sql`coalesce\(/);
  });
});
