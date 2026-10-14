import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * 039 — `PageShell`: la misma geometría en todas las pantallas (encabezado de
 * 56 px, pestañas de 40 px) y las pestañas de cada pilar según módulos y
 * permisos. Se dibuja a HTML estático; lo visual lo cubre el e2e.
 */

let pathname = "/pipeline";
let permisos: string[] = [];
let modulos: string[] | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/viewer-context", () => ({
  useViewer: () => ({
    can: (p: string) => permisos.includes(p),
    hasModule: (k: string) => !modulos || modulos.includes(k),
  }),
}));

const { PageShell } = await import("@/components/ui/page-shell");

const dibujar = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(PageShell, { children: createElement("p", null, "contenido"), ...props } as never));

describe("PageShell", () => {
  it("UNA sola barra de 56 px (sm:h-14): título del pilar, divisor y pestañas en píldora DENTRO del encabezado", () => {
    pathname = "/contacts";
    modulos = null;
    const html = dibujar({ variant: "fluid" });
    expect(html).toMatch(/<header[^>]*class="[^"]*\bsm:h-14\b[^"]*"/);
    expect(html).toContain(">CRM Comercial</h1>");
    // Las pestañas viven dentro del <header> (no hay segunda barra debajo).
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain('aria-label="Secciones de CRM Comercial"');
    expect(html.slice(html.indexOf("</header>"))).not.toContain("<nav");
    // La activa, como el renglón del menú lateral.
    expect(header).toMatch(/href="\/contacts"[^>]*class="[^"]*bg-brand-tint/);
    expect(header).toMatch(/<span aria-hidden="true" class="[^"]*h-4 w-px[^"]*bg-border/);
    expect(html).not.toContain("h-10");
  });

  it("las pestañas del pilar siguen a los módulos de la organización", () => {
    pathname = "/pipeline";
    modulos = ["pipeline", "contacts"];
    const html = dibujar();
    expect(html).toContain("Pipeline");
    expect(html).toContain("Contactos");
    expect(html).not.toContain("Biblioteca");
    expect(html).not.toContain("Agenda");
  });

  it("y a los permisos: Marketing esconde «Plantillas WhatsApp» a quien no tiene templates.manage", () => {
    pathname = "/campaigns";
    modulos = null;
    permisos = ["campaigns.manage"];
    expect(dibujar()).not.toContain("Plantillas WhatsApp");
    permisos = ["campaigns.manage", "templates.manage"];
    expect(dibujar()).toContain("Plantillas WhatsApp");
  });

  it("`contained` centra el contenido (max-w-6xl) y `fluid` lo deja a lo ancho", () => {
    pathname = "/results";
    expect(dibujar({ variant: "contained" })).toContain("max-w-6xl");
    expect(dibujar({ variant: "fluid" })).not.toContain("max-w-6xl");
  });

  it("pestañas propias, acciones y la flecha de volver", () => {
    pathname = "/platform";
    const html = dibujar({
      title: "Plataforma",
      pillar: false,
      tabs: [{ href: "/platform", label: "Mi panel" }],
      back: { href: "/campaigns", label: "Volver a Campañas" },
      actions: createElement("button", null, "Acción"),
    });
    expect(html).toContain(">Plataforma</h1>");
    expect(html).toContain('aria-label="Volver a Campañas"');
    expect(html).toContain(">Acción</button>");
    expect(html).toContain("Mi panel");
  });
});

describe("039 — todas las pantallas usan PageShell", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const full = path.join(dir, e);
      return statSync(full).isDirectory() ? archivos(full) : /\.tsx$/.test(e) ? [full] : [];
    });
  }

  it("nadie fuera del cascarón pinta su propio título de pantalla con el botón del menú", () => {
    // El botón que reabre el menú solo vive en PageShell (y en el menú mismo).
    const permitidos = new Set([
      "components/ui/page-shell.tsx",
      "components/nav-mode.tsx",
      "components/app-nav.tsx",
      // La Bandeja y el Chat de equipo conservan sus columnas a altura completa
      // y su encabezado compacto con el selector «Bandeja ▾».
      "components/inbox/conversation-list.tsx",
      "components/team-chat/team-chat-client.tsx",
    ]);
    // Citas sin incrustar (nadie lo usa así hoy) conserva su título propio.
    const legado = new Set(["components/bookings/bookings-client.tsx", "components/bookings/calendar-toolbar.tsx"]);
    const fuera = archivos(SRC)
      .map((f) => path.relative(SRC, f))
      .filter((rel) => !permitidos.has(rel) && !legado.has(rel))
      .filter((rel) => readFileSync(path.join(SRC, rel), "utf8").includes("<NavRevealButton"));
    expect(fuera).toEqual([]);
  });
});
