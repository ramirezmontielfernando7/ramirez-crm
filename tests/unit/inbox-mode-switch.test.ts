import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * 039 — El título de la Bandeja / Chat de equipo: selector «Bandeja ▾» con el
 * módulo `team_chat`; texto fijo sin él; punto cuando hay no leídos en el
 * OTRO modo. Se dibuja a HTML estático; el menú abierto lo cubre el e2e.
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

const { InboxModeSwitch } = await import("@/components/inbox/inbox-mode-switch");
const dibujar = (current: "inbox" | "chat") => renderToStaticMarkup(createElement(InboxModeSwitch, { current }));

describe("InboxModeSwitch", () => {
  it("sin `team_chat`: «Bandeja» como texto fijo, sin flecha ni menú", () => {
    modulos = [];
    const html = dibujar("inbox");
    expect(html).toContain(">Bandeja</h2>");
    expect(html).not.toContain("inbox-mode-switch");
    expect(html).not.toContain("<svg");
  });

  it("con `team_chat`: el título es un botón que abre un menú", () => {
    modulos = ["team_chat"];
    inbox = 0;
    team = 0;
    const html = dibujar("inbox");
    expect(html).toContain('data-testid="inbox-mode-switch"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toMatch(/Bandeja<svg/);
    expect(dibujar("chat")).toMatch(/Chat de equipo<svg/);
  });

  it("punto solo si hay no leídos en el OTRO modo", () => {
    modulos = ["team_chat"];
    inbox = 5;
    team = 0;
    expect(dibujar("inbox")).not.toContain("inbox-mode-dot");
    expect(dibujar("chat")).toContain('aria-label="Sin leer en Bandeja de clientes"');
    inbox = 0;
    team = 2;
    expect(dibujar("inbox")).toContain('aria-label="Sin leer en Chat de equipo"');
    expect(dibujar("chat")).not.toContain("inbox-mode-dot");
  });
});
