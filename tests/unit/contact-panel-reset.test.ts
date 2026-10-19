import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Panel de Detalles de la Bandeja: `ContactPanel` y sus tarjetas
 * (`AssignmentCard`, `ParticipantsCard`, `ContactTagsCard`) guardan estado
 * propio (asignado, historial, participantes, etiquetas). Si el panel no se
 * remonta al cambiar de contacto, durante la carga —o si la carga falla— se
 * ven los datos del contacto ANTERIOR, y agregar una etiqueta copia las del
 * anterior al actual (`saveTags` manda `[...tags, tag]` al contacto nuevo).
 * El unit corre en `node` (sin DOM): se vigila la causa en el código.
 */
const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("ContactPanel se reinicia al cambiar de chat", () => {
  it("la Bandeja lo dibuja con key = id del contacto", () => {
    const src = leer("src/components/inbox/inbox-client.tsx");
    const uso = src.match(/<ContactPanel\b[\s\S]*?\/>/);
    expect(uso, "no se encontró <ContactPanel />").not.toBeNull();
    expect(uso![0]).toMatch(/key=\{selected\.contact\.id\}/);
  });

  it("las tarjetas con estado por contacto siguen dentro del panel (si salen, necesitan su propio key)", () => {
    const panel = leer("src/components/inbox/contact-panel.tsx");
    for (const card of ["AssignmentCard", "ParticipantsCard", "ContactTagsCard"]) {
      expect(panel).toContain(`<${card}`);
    }
  });
});
