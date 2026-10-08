import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageDto } from "@/lib/types";

/**
 * 031 (A2) — Los componentes extraídos (MessageBubble, SectionTabs,
 * AgentConfigForm) y las reglas de las pantallas nuevas del Laboratorio.
 * Se dibujan a HTML estático (sin navegador): lo visual lo cubren las
 * capturas antes/después y el e2e de agentes.
 */

let pathname = "/lab";
let permisos: string[] = [];
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/viewer-context", () => ({
  useViewer: () => ({ can: (p: string) => permisos.includes(p), hasModule: () => true }),
}));

const { MessageBubble } = await import("@/components/inbox/message-bubble");
const { SectionTabs } = await import("@/components/ui/section-tabs");
const { AgentConfigForm } = await import("@/components/agent/agent-config-form");

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const leer = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = path.join(dir, e);
    return statSync(full).isDirectory() ? archivos(full) : /\.tsx?$/.test(e) ? [full] : [];
  });
}

const msg = (over: Partial<MessageDto> = {}): MessageDto => ({
  id: "m1",
  conversationId: "c1",
  direction: "in",
  type: "text",
  text: "hola",
  status: "read",
  error: null,
  aiGenerated: false,
  origin: "operator",
  media: null,
  createdAt: "2026-01-01T15:04:00.000Z",
  ...over,
});

describe("MessageBubble", () => {
  it("el entrante va en el color del cliente y el saliente en el de la casa", () => {
    const entrante = renderToStaticMarkup(createElement(MessageBubble, { m: msg(), grouped: false }));
    const saliente = renderToStaticMarkup(createElement(MessageBubble, { m: msg({ direction: "out" }), grouped: false }));
    expect(entrante).toContain("bg-bubble-in");
    expect(entrante).not.toContain("bg-bubble-out");
    expect(saliente).toContain("bg-bubble-out");
  });

  it("la esquina con cola solo en el primero de un grupo", () => {
    const solo = renderToStaticMarkup(createElement(MessageBubble, { m: msg(), grouped: false }));
    const seguido = renderToStaticMarkup(createElement(MessageBubble, { m: msg(), grouped: true }));
    expect(solo).toContain("rounded-tl-[5px]");
    expect(seguido).not.toContain("rounded-tl-[5px]");
  });

  it("por defecto es idéntica a la de la Bandeja (64 %) y `wide` solo quita ese tope", () => {
    const normal = renderToStaticMarkup(createElement(MessageBubble, { m: msg(), grouped: false }));
    const ancha = renderToStaticMarkup(createElement(MessageBubble, { m: msg(), grouped: false, wide: true }));
    expect(normal).toContain("sm:max-w-[64%]");
    expect(ancha).not.toContain("sm:max-w-[64%]");
    expect(ancha).toContain("max-w-[85%]");
  });

  it("marca la IA, los ticks y el motivo de un envío fallido", () => {
    const ia = renderToStaticMarkup(createElement(MessageBubble, { m: msg({ direction: "out", aiGenerated: true }), grouped: false }));
    expect(ia).toContain("Respuesta generada por IA");
    const fallo = renderToStaticMarkup(
      createElement(MessageBubble, { m: msg({ direction: "out", status: "failed", error: "Número inválido" }), grouped: false })
    );
    expect(fallo).toContain("No se entregó.");
    expect(fallo).toContain("Número inválido");
  });
});

describe("SectionTabs", () => {
  const tabs = [
    { href: "/lab", label: "Agentes", match: (p: string) => p === "/lab" || p.startsWith("/lab/agents") },
    { href: "/lab/evaluaciones", label: "Evaluaciones" },
    { href: "/lab/secreta", label: "Secreta", permission: "templates.manage" as const },
  ];
  const dibujar = () => renderToStaticMarkup(createElement(SectionTabs, { tabs, label: "Secciones" }));

  it("marca la activa con aria-current y respeta `match` en rutas hijas", () => {
    pathname = "/lab/agents/agt_1";
    permisos = [];
    const html = dibujar();
    expect(html).toMatch(/href="\/lab"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/lab"/);
    expect(html).not.toMatch(/href="\/lab\/evaluaciones"[^>]*aria-current/);
  });

  it("sin `match`, solo la ruta exacta; y oculta la pestaña a quien no tiene el permiso", () => {
    pathname = "/lab/evaluaciones";
    permisos = [];
    const sin = dibujar();
    expect(sin).not.toContain("Secreta");
    expect(sin).toMatch(/href="\/lab\/evaluaciones"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/lab\/evaluaciones"/);
    permisos = ["templates.manage"];
    expect(dibujar()).toContain("Secreta");
  });

  it("Campañas usa este componente (una sola implementación de pestañas)", () => {
    expect(leer("components/campaigns/campaigns-tabs.tsx")).toContain("SectionTabs");
    expect(leer("components/lab/lab-shell.tsx")).toContain("SectionTabs");
  });
});

describe("AgentConfigForm", () => {
  const value = { name: "Luz", tone: "cercano", instructions: null, escalationRules: null, greeting: "Hola" };
  const dibujar = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(AgentConfigForm, { value, onChange: () => {}, ...props }));

  it("pinta los cinco campos con los ids de /agent por defecto", () => {
    const html = dibujar();
    for (const id of ["agent-name", "agent-tone", "agent-instructions", "agent-escalation", "agent-greeting"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Nombre del agente");
    expect(html).toContain('value="Luz"');
  });

  it("el editor del Laboratorio pide el nombre aparte: `showName={false}` lo oculta", () => {
    const html = dibujar({ showName: false, idPrefix: "lab-agent" });
    expect(html).not.toContain("lab-agent-name");
    expect(html).toContain('id="lab-agent-tone"');
  });
});

describe("pantallas del Laboratorio", () => {
  it("la burbuja vive en un solo archivo (la Bandeja y la vista previa la comparten)", () => {
    // (El chat de EQUIPO tiene su propia burbuja interna; no es la de clientes.)
    const conBurbuja = archivos(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("bubble-out-border"))
      .map((f) => path.relative(SRC, f))
      .filter((f) => !f.startsWith("components/team-chat/"));
    expect(conBurbuja).toEqual(["components/inbox/message-bubble.tsx"]);
    expect(leer("components/inbox/message-thread.tsx")).toContain("<MessageBubble");
    expect(leer("components/lab/agent-preview.tsx")).toContain("<MessageBubble");
  });

  it("todas las páginas de /lab exigen permiso y módulo en el servidor", () => {
    for (const p of [
      "app/(app)/lab/layout.tsx",
      "app/(app)/lab/page.tsx",
      "app/(app)/lab/evaluaciones/page.tsx",
      "app/(app)/lab/agents/[id]/page.tsx",
      // 035
      "app/(app)/lab/documentos/page.tsx",
      // 037
      "app/(app)/lab/documentos/[grupo]/page.tsx",
    ]) {
      const src = leer(p);
      expect(src, p).toContain('requirePagePermission("agent.manage")');
      expect(src, p).toContain('requireModulePage("lab")');
    }
  });

  it("ningún enlace interno apunta a /lab por un camino que no existe", () => {
    const validos = [/^\/lab$/, /^\/lab\/evaluaciones(\?.*)?$/, /^\/lab\/agents\/?[^/]*$/, /^\/lab\/asignacion$/, /^\/lab\/documentos$/, /^\/lab\/documentos\/[^/]+$/];
    for (const f of archivos(SRC)) {
      const rel = path.relative(SRC, f);
      if (rel.startsWith("app/api/") || rel.startsWith("server/")) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](\/lab[^"'`]*)["'`]/g)) {
        const ruta = (m[1] ?? "").replace(/\$\{[^}]*\}/g, "x");
        expect(validos.some((r) => r.test(ruta)), `${rel}: ${m[1]}`).toBe(true);
      }
    }
  });

  it("la vista previa solo habla con /api/lab/preview (no toca la Bandeja ni WhatsApp)", () => {
    const src = leer("components/lab/agent-preview.tsx");
    const rutas = [...src.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)].map((m) => m[1]);
    expect(rutas).toEqual(["/api/lab/preview"]);
  });

  it("«Hacer general» avisa del cerebro externo (/api/bot/profile) antes de confirmar", () => {
    const src = leer("components/lab/agent-editor.tsx");
    expect(src).toContain("cerebro externo");
    expect(src).toContain("/api/bot/profile");
  });
});
