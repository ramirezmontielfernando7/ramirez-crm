import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 020 — Guardarraíles de la asignación.
 *
 * 1. Una sola puerta escribe `contact.assigned_user_id`: la que también anota
 *    el movimiento en la bitácora. Otro camino no truena; solo deja el
 *    historial ("¿quién lo tenía y desde cuándo?") con huecos.
 * 2. Las consultas de datos de clientes de las rutas de usuario pasan por
 *    `scopedContacts`/`scopedConversations`, no por `scoped()` a secas. Si
 *    una consulta nueva se olvida, un asesor vería lo de otro.
 *
 * Si estás aquí porque se puso rojo: no lo relajes. Enruta tu cambio por la
 * puerta, o, si de verdad la consulta es del negocio entero (y solo la usa
 * quien ve todo), deja en la línea anterior `// scoped-ok: <por qué>`.
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const PUERTA = path.join("server", "assignment", "assign.ts");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...archivosTs(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Bloques `.set({…})` y `.values({…})` (los que escriben en la BD). */
function bloquesDeEscritura(code: string): string[] {
  const bloques: string[] = [];
  const re = /\.(set|values)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    bloques.push(code.slice(m.index, m.index + 500));
  }
  return bloques;
}

describe("guardarraíl: una sola puerta asigna", () => {
  it("nadie fuera de assign.ts escribe assignedUserId", () => {
    const infractores: string[] = [];
    for (const file of archivosTs(SRC)) {
      if (file.endsWith(PUERTA)) continue;
      const code = readFileSync(file, "utf8");
      if (!code.includes("assignedUserId")) continue;
      if (bloquesDeEscritura(code).some((b) => /\bassignedUserId\s*:/.test(b))) {
        infractores.push(path.relative(SRC, file));
      }
    }
    expect(
      infractores,
      "Asigna con assignContacts() de server/assignment/assign.ts:\n" +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("la puerta sí la escribe (el detector no está ciego)", () => {
    const code = readFileSync(path.join(SRC, PUERTA), "utf8");
    expect(bloquesDeEscritura(code).some((b) => /\bassignedUserId\s*:/.test(b))).toBe(true);
  });
});

/** Donde viven las consultas que responden a una PERSONA. */
const ALCANCE = [
  path.join("app", "api"),
  path.join("server", "analytics"),
  path.join("server", "inbox", "queries.ts"),
  path.join("server", "contacts.ts"),
  path.join("server", "agenda", "queries.ts"),
  path.join("server", "events", "visibility.ts"),
];
/** Superficies sin sesión de usuario: su propia autenticación. */
const FUERA = ["bot", "webhooks", "dev"].map((d) => path.join("app", "api", d) + path.sep);

const TABLAS_DE_CLIENTES =
  "conversation|lead|contact|message|booking|leadStageEvent|mediaAsset|adAttribution|contactAssignmentEvent";

describe("guardarraíl: el filtro por asignación no se olvida", () => {
  it("ninguna ruta de usuario consulta datos de clientes con scoped() a secas", () => {
    const re = new RegExp(
      `(scoped\\(\\s*schema\\.(${TABLAS_DE_CLIENTES})\\.organizationId|eq\\(\\s*schema\\.(${TABLAS_DE_CLIENTES})\\.organizationId)`,
      "g"
    );
    const infractores: string[] = [];
    for (const file of archivosTs(SRC)) {
      const rel = path.relative(SRC, file);
      if (!ALCANCE.some((a) => rel === a || rel.startsWith(a + path.sep))) continue;
      if (FUERA.some((f) => rel.startsWith(f))) continue;
      const code = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        // `eq(a.organizationId, b.organizationId)` es la condición de un
        // JOIN entre dos tablas, no el filtro de la consulta.
        const resto = code.slice(m.index + m[0].length, m.index + m[0].length + 20);
        if (m[0].startsWith("eq(") && /^\s*,\s*schema\./.test(resto)) continue;
        // La justificación va en las líneas inmediatamente anteriores.
        const antes = code.slice(Math.max(0, m.index - 400), m.index);
        if (/scoped-ok:/.test(antes)) continue;
        const linea = code.slice(0, m.index).split("\n").length;
        infractores.push(`${rel}:${linea}`);
      }
    }
    expect(
      infractores,
      "Usa scopedContacts()/scopedConversations() de lib/db/tenant.ts:\n" +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });
});
