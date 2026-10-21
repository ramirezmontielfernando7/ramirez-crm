import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El cajón del Pipeline sigue abierto si se cambia de lead con el teclado
 * (Tab sale del cajón y Enter en otra tarjeta). `AssignmentCard` guarda a
 * quien atiende en su propio estado: sin `key` por contacto, enseña al
 * asignado del lead anterior hasta que llega (o falla) la consulta del nuevo.
 * Verificado a mano con Playwright (consulta retrasada): antes mostraba al
 * asignado de otro lead; con la `key`, «Sin asignar» del lead nuevo.
 */
describe("LeadDrawer — AssignmentCard se reinicia al cambiar de lead", () => {
  it("lleva key = el contacto del lead", () => {
    const src = readFileSync("src/components/pipeline/lead-drawer.tsx", "utf8");
    expect(src).toMatch(/<AssignmentCard\s+key=\{lead\.contact\.id\}\s+contactId=\{lead\.contact\.id\}/);
  });
});
