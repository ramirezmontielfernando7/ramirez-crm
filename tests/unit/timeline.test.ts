import { describe, expect, it } from "vitest";
import {
  describeTimelineItem,
  sortTimeline,
  type TimelineActor,
  type TimelineItemDto,
} from "@/lib/timeline";
import { nextNavMode, resolveNavCollapsed, resolveNavMode } from "@/lib/preferences";

/** 022 — La línea de tiempo en palabras: "[acción] por [quién]". */

const fernando: TimelineActor = { type: "user", id: "usr_f", name: "Fernando" };
const michel: TimelineActor = { type: "user", id: "usr_m", name: "Asesor Michel" };
const prueba: TimelineActor = { type: "user", id: "usr_p", name: "Prueba" };

function item(partial: Partial<TimelineItemDto> & Pick<TimelineItemDto, "kind">): TimelineItemDto {
  return { id: "x", at: "2026-09-25T10:00:00.000Z", actor: null, detail: {}, ...partial };
}

describe("022 — describeTimelineItem", () => {
  it("nota añadida por una persona, con el texto completo para 'ver más'", () => {
    const line = describeTimelineItem(
      item({ kind: "note", actor: fernando, detail: { text: "Quiere cotizar 3 piezas" } })
    );
    expect(line).toEqual({ title: "Nota añadida por Fernando", body: "Quiere cotizar 3 piezas" });
  });

  it("nota del agente de IA", () => {
    const line = describeTimelineItem(item({ kind: "note", actor: { type: "bot" }, detail: { text: "x" } }));
    expect(line.title).toBe("Nota añadida por el agente de IA");
  });

  it("la nota heredada de contact.notes es la 'Nota inicial'", () => {
    const line = describeTimelineItem(item({ kind: "initial_note", detail: { text: "Remodela su cocina" } }));
    expect(line).toEqual({ title: "Nota inicial", body: "Remodela su cocina" });
  });

  it("etapa cambiada a Perdido por una persona, con el motivo en 'ver más'", () => {
    const line = describeTimelineItem(
      item({
        kind: "stage",
        actor: michel,
        detail: { from: "Propuesta", to: "Perdido", toKind: "lost", lossReason: "precio", lossNote: "Pidió 10% menos" },
      })
    );
    expect(line.title).toBe("Etapa cambiada a Perdido por Asesor Michel");
    expect(line.body).toBe("Motivo: Le pareció caro\nPidió 10% menos");
  });

  it("etapa movida por el agente de IA", () => {
    const line = describeTimelineItem(
      item({ kind: "stage", actor: { type: "bot" }, detail: { from: "Nuevo", to: "Calificado" } })
    );
    expect(line).toEqual({ title: "Etapa cambiada a Calificado por el agente de IA", body: null });
  });

  it("el evento de creación del lead no dice 'cambiada'", () => {
    const line = describeTimelineItem(item({ kind: "stage", detail: { from: null, to: "Nuevo" } }));
    expect(line.title).toBe("Lead creado en Nuevo");
  });

  it("reasignación: de quién, a quién y quién la hizo", () => {
    const line = describeTimelineItem(
      item({ kind: "assignment", actor: prueba, detail: { from: "Prueba", to: "Fernando", source: "manual" } })
    );
    expect(line.title).toBe("Reasignado de Prueba a Fernando por Prueba");
  });

  it("primera asignación, en lote, y quedar sin asignar", () => {
    expect(
      describeTimelineItem(item({ kind: "assignment", actor: fernando, detail: { from: null, to: "Michel", source: "lote" } }))
        .title
    ).toBe("Asignado a Michel por Fernando (en lote)");
    expect(
      describeTimelineItem(item({ kind: "assignment", actor: fernando, detail: { from: "Michel", to: null } })).title
    ).toBe("Quedó sin asignar por Fernando");
    expect(
      describeTimelineItem(item({ kind: "assignment", detail: { from: null, to: "Michel", source: "auto" } })).title
    ).toBe("Asignado a Michel por reparto automático");
  });

  it("pausar y reactivar la IA", () => {
    expect(describeTimelineItem(item({ kind: "ai_paused", actor: fernando })).title).toBe(
      "IA pausada en esta conversación por Fernando"
    );
    expect(describeTimelineItem(item({ kind: "ai_resumed", actor: fernando })).title).toBe(
      "IA reactivada en esta conversación por Fernando"
    );
  });

  it("el handoff dice por qué", () => {
    expect(describeTimelineItem(item({ kind: "ai_handoff", detail: { reason: "cliente" } })).title).toBe(
      "IA en pausa · atención humana: el cliente pidió un humano"
    );
    expect(describeTimelineItem(item({ kind: "ai_handoff", detail: { reason: "manual_reply" } })).title).toBe(
      "IA en pausa · atención humana: respondieron desde el teléfono del negocio"
    );
  });

  it("consentimiento y etiquetas", () => {
    expect(
      describeTimelineItem(item({ kind: "consent", actor: fernando, detail: { to: "opt_in", source: "Formulario" } }))
    ).toEqual({ title: "Mensajes masivos: Acepta mensajes por Fernando", body: "Origen: Formulario" });
    expect(describeTimelineItem(item({ kind: "tag_added", actor: fernando, detail: { tag: "VIP" } })).title).toBe(
      "Etiqueta «VIP» añadida por Fernando"
    );
    expect(describeTimelineItem(item({ kind: "tag_removed", actor: fernando, detail: { tag: "VIP" } })).title).toBe(
      "Etiqueta «VIP» quitada por Fernando"
    );
  });
});

describe("022 — sortTimeline", () => {
  it("lo más reciente primero", () => {
    const a = item({ kind: "note", id: "a", at: "2026-09-25T09:00:00.000Z" });
    const b = item({ kind: "note", id: "b", at: "2026-09-25T11:00:00.000Z" });
    const c = item({ kind: "note", id: "c", at: "2026-09-25T10:00:00.000Z" });
    expect(sortTimeline([a, b, c]).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
});

describe("022 — el lateral colapsado por defecto depende del rol", () => {
  it("el Asesor arranca colapsado; Coordinador y Propietario, abierto", () => {
    expect(resolveNavCollapsed(null, "asesor")).toBe(true);
    expect(resolveNavCollapsed(null, "coordinador")).toBe(false);
    expect(resolveNavCollapsed(null, "owner")).toBe(false);
  });

  it("la preferencia guardada gana al default del rol", () => {
    expect(resolveNavCollapsed(false, "asesor")).toBe(false);
    expect(resolveNavCollapsed(true, "owner")).toBe(true);
  });
});

describe("022 — el lateral de tres estados (escritorio)", () => {
  it("el hamburguesa recorre expandido → íconos → oculto → expandido", () => {
    expect(nextNavMode("expanded")).toBe("collapsed");
    expect(nextNavMode("collapsed")).toBe("hidden");
    expect(nextNavMode("hidden")).toBe("expanded");
  });

  it("el modo guardado gana; sin él se lee la preferencia vieja de dos estados", () => {
    expect(resolveNavMode({ navMode: "hidden", navCollapsed: true }, "owner")).toBe("hidden");
    expect(resolveNavMode({ navMode: null, navCollapsed: true }, "owner")).toBe("collapsed");
    expect(resolveNavMode({ navMode: null, navCollapsed: false }, "asesor")).toBe("expanded");
  });

  it("sin nada guardado (o un valor que no existe), el default del rol", () => {
    expect(resolveNavMode(null, "asesor")).toBe("collapsed");
    expect(resolveNavMode({ navMode: "gigante", navCollapsed: null }, "coordinador")).toBe("expanded");
  });
});
