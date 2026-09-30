import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * H13 — Dar de alta a alguien no revela qué correos existen en OTRAS
 * organizaciones: el correo es único en toda la instancia, así que "ya
 * existe" solo se dice si la persona es de este mismo equipo.
 */
const estado = vi.hoisted(() => ({ existe: false, miembroDeEsteEquipo: false, altas: 0 }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: async () => actual.sessionContext("usr_owner", "org_a", "owner") };
});
vi.mock("@/lib/auth", () => ({
  runInternalSignup: <T>(fn: () => Promise<T>) => fn(),
  getAuth: () => ({
    api: {
      signUpEmail: async () => {
        estado.altas++;
        if (estado.existe) throw new Error("User already exists. Use another email.");
        return { user: { id: "usr_nuevo" } };
      },
    },
  }),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "innerJoin", "where", "limit", "insert", "values", "onConflictDoNothing"]) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(estado.miembroDeEsteEquipo ? [{ id: "mem_1" }] : []);
  return { ...actual, getDb: () => builder };
});

import { POST } from "@/app/api/settings/team/route";

function alta(email: string) {
  return POST(
    new Request("http://x/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nueva", email, password: "password-123", role: "asesor" }),
    })
  );
}

describe("alta de miembros sin enumeración de correos", () => {
  beforeEach(() => {
    estado.existe = false;
    estado.miembroDeEsteEquipo = false;
    estado.altas = 0;
    resetRateLimit();
  });

  it("correo nuevo → 201", async () => {
    expect((await alta("nueva@x.test")).status).toBe(201);
  });

  it("correo de OTRA organización → 422 genérico, sin decir que existe", async () => {
    estado.existe = true;
    const res = await alta("de.otra.org@x.test");
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(text).not.toMatch(/exist/i);
    expect(JSON.parse(text).error.code).toBe("email_unavailable");
  });

  it("correo de alguien de MI equipo → 409 «ya está en tu equipo»", async () => {
    estado.existe = true;
    estado.miembroDeEsteEquipo = true;
    const res = await alta("companera@x.test");
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/tu equipo/);
  });

  it("probar correos en serie se frena por organización (429)", async () => {
    estado.existe = true;
    const vistos: number[] = [];
    for (let i = 0; i < 35; i++) vistos.push((await alta(`adivina${i}@x.test`)).status);
    expect(vistos.slice(0, 30).every((s) => s === 422)).toBe(true);
    expect(vistos.slice(30).every((s) => s === 429)).toBe(true);
    expect(estado.altas).toBe(30);
  });
});
