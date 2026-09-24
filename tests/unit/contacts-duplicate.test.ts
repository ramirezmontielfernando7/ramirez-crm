import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * 020 — Alta manual con un teléfono que ya existe.
 *
 * Decir "ya existe" solo a quien puede ver ese contacto. A un asesor sin
 * acceso (el contacto es de otro asesor o está sin asignar) el aviso le
 * confirmaría que ese cliente está en la base: para él, un error genérico con
 * el mismo estado que un dato inválido (422), sin el código `duplicate`.
 *
 * La BD es falsa: el INSERT siempre choca (devuelve nada, como
 * `onConflictDoNothing`), y la búsqueda del contacto existente devuelve lo que
 * devolvería Postgres con el filtro de asignación de quien pregunta.
 */

const ASESOR_A = "usr_asesor_a";
const ASESOR_B = "usr_asesor_b";

const state = vi.hoisted(() => ({
  session: null as unknown,
  /** El contacto que ya tiene ese teléfono, y a quién está asignado. */
  existente: { id: "ct_existente", assignedUserId: null as string | null },
  wheres: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
  getSessionOrNull: async () => state.session,
}));

/**
 * El SELECT responde como la BD real: el contacto aparece si la sesión ve
 * todo o si está asignado a ella — la misma regla que `scopedContacts`, cuyo
 * SQL además se revisa abajo.
 */
function visibleParaLaSesion(): { id: string }[] {
  const s = state.session as { access: { seesAll: boolean; userId: string } };
  const ve = s.access.seesAll || state.existente.assignedUserId === s.access.userId;
  return ve ? [{ id: state.existente.id }] : [];
}

function fakeDb(): unknown {
  const cadena = (resultado: () => unknown[]): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(resultado());
          }
          return (...args: unknown[]) => {
            if (prop === "where") state.wheres.push(args[0]);
            return proxy;
          };
        },
      }
    );
    return proxy;
  };
  return {
    // El alta choca con el índice único: `onConflictDoNothing` no devuelve fila.
    insert: () => cadena(() => []),
    select: () => cadena(visibleParaLaSesion),
  };
}

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => fakeDb() };
});

function como(role: "owner" | "coordinador" | "asesor", userId: string) {
  state.session = {
    userId,
    organizationId: "org_a",
    role,
    access: { organizationId: "org_a", userId, seesAll: role !== "asesor" },
  };
}

async function alta(): Promise<{ status: number; body: { error: { code: string; message: string } } }> {
  const { POST } = await import("@/app/api/contacts/route");
  const res = await POST(
    new Request("http://localhost/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cliente repetido", phone: "5215512345678" }),
    })
  );
  return { status: res.status, body: await res.json() };
}

const GENERICO = "No se pudo crear el contacto, verifica los datos e intenta de nuevo";
const ESPECIFICO = "Ya existe un contacto con ese teléfono";

beforeEach(() => {
  state.wheres = [];
  state.existente = { id: "ct_existente", assignedUserId: null };
});

describe("020 — asesor SIN acceso al contacto existente: error genérico", () => {
  it("el contacto es de otro asesor", async () => {
    state.existente.assignedUserId = ASESOR_B;
    como("asesor", ASESOR_A);
    const { status, body } = await alta();
    expect(status).toBe(422);
    expect(body.error.code).toBe("invalid");
    expect(body.error.message).toBe(GENERICO);
    // Nada en la respuesta sugiere que el número exista.
    expect(JSON.stringify(body)).not.toMatch(/existe|duplic/i);
  });

  it("el contacto está sin asignar", async () => {
    state.existente.assignedUserId = null;
    como("asesor", ASESOR_A);
    const { status, body } = await alta();
    expect(status).toBe(422);
    expect(body.error.message).toBe(GENERICO);
  });

  it("la búsqueda del existente lleva el filtro de asignación del asesor", async () => {
    state.existente.assignedUserId = ASESOR_B;
    como("asesor", ASESOR_A);
    await alta();
    const consultas = state.wheres
      .filter((w): w is SQL => !!w && typeof w === "object")
      .map((w) => new PgDialect().sqlToQuery(w));
    expect(
      consultas.some(
        (q) => /"assigned_user_id" = \$\d+/.test(q.sql) && q.params.includes(ASESOR_A)
      )
    ).toBe(true);
  });
});

describe("020 — quien SÍ ve el contacto existente: aviso específico de duplicado", () => {
  it("el asesor al que está asignado", async () => {
    state.existente.assignedUserId = ASESOR_A;
    como("asesor", ASESOR_A);
    const { status, body } = await alta();
    expect(status).toBe(409);
    expect(body.error.code).toBe("duplicate");
    expect(body.error.message).toBe(ESPECIFICO);
  });

  it.each([
    ["coordinador", "de otro asesor", ASESOR_B],
    ["coordinador", "sin asignar", null],
    ["owner", "de otro asesor", ASESOR_B],
    ["owner", "sin asignar", null],
  ] as const)("%s, con el contacto %s", async (role, _caso, asignado) => {
    state.existente.assignedUserId = asignado;
    como(role, `usr_${role}`);
    const { status, body } = await alta();
    expect(status).toBe(409);
    expect(body.error.code).toBe("duplicate");
    expect(body.error.message).toBe(ESPECIFICO);
  });
});
