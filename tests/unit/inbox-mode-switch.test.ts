import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * 039 / ronda 3 — Las pestañas Clientes · Equipo de la Bandeja: siempre visibles con el
 * módulo `team_chat`, con el conteo de no leídos de cada una; sin el módulo
 * no se dibuja ninguna barra.
 */

let modulos: string[] = ["team_chat"];
let inbox = 0;
let team = 0;
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/viewer-context", () => ({
  useViewer: () => ({ userId: "u1", can: () => true, hasModule: (k: string) => modulos.includes(k) }),
}));
vi.mock("@/components/inbox/unread-store", () => ({ useInboxUnread: () => inbox }));
vi.mock("@/components/team-chat/unread-store", () => ({ useTeamUnread: () => team }));
vi.mock("@/components/inbox/number-unread-store", () => ({ useNumberUnread: () => 0 }));
vi.mock("@/components/nav-mode", () => ({ NavRevealButton: () => null }));

const { InboxListHeader } = await import("@/components/inbox/inbox-mode-switch");
const tabs = (current: "inbox" | "chat") => renderToStaticMarkup(createElement(InboxListHeader, { current }));

describe("InboxListHeader", () => {
  it("sin `team_chat`: sin pestañas, solo el nombre de la bandeja", () => {
    modulos = [];
    const html = tabs("inbox");
    expect(html).not.toContain("inbox-tabs");
    expect(html).toContain(">Clientes</h2>");
  });

  it("con `team_chat`: Clientes y Equipo a la vista, la actual marcada", () => {
    modulos = ["team_chat"];
    inbox = 0;
    team = 0;
    const html = tabs("inbox");
    expect(html).toContain("Clientes");
    expect(html).toContain("Equipo");
    expect(html).toContain('href="/chat"');
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="inbox-tab-inbox"|data-testid="inbox-tab-inbox"[^>]*aria-current="page"/);
    expect(tabs("chat")).toMatch(/data-testid="inbox-tab-chat"[^>]*aria-current="page"|aria-current="page"[^>]*data-testid="inbox-tab-chat"/);
  });

  it("cada pestaña lleva su propio conteo de no leídos", () => {
    modulos = ["team_chat"];
    inbox = 5;
    team = 120;
    const html = tabs("inbox");
    expect(html).toContain('aria-label="5 sin leer"');
    expect(html).toContain("99+");
    inbox = 0;
    team = 0;
    expect(tabs("inbox")).not.toContain("sin leer");
  });
});
