/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST as MCP } from "@/app/api/mcp/route";
import { POST as SUBIR } from "@/app/api/ai-connector/upload-links/[token]/files/route";
import { POST as CERRAR } from "@/app/api/ai-connector/upload-links/[token]/close/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 — Enlace de subida de un solo uso: la IA lo pide, la PERSONA sube con
 * su sesión (solo quien lo pidió), cada archivo queda en la Biblioteca con
 * las etiquetas y destinos del enlace, y «Listo» lo cierra.
 */

const h = vi.hoisted(() => ({
  session: null as null | ReturnType<typeof import("@/lib/auth/session").sessionContext>,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    requireSession: async () => {
      if (!h.session) throw new real.UnauthorizedError();
      return h.session;
    },
    getSessionOrNull: async () => h.session,
  };
});

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();
let A: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", coord: "", asesor: "" };
let key = "";

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@enlace.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

let seq = 0;
async function herramienta(name: string, args: Record<string, unknown> = {}) {
  const res = await MCP(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  return ((await res.json()) as any).result as { structuredContent: Record<string, any>; isError: boolean };
}

function como(userId: string, role: Role) {
  h.session = sessionContext(userId, A.id, role);
}

async function subir(token: string, name: string, type: string, body = "contenido de prueba") {
  const form = new FormData();
  form.set("file", new File([body], name, { type }));
  const res = await SUBIR(new Request(`http://localhost/api/ai-connector/upload-links/${token}/files`, { method: "POST", body: form }), {
    params: Promise.resolve({ token }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  process.env.KB_DOCS = "on";
  delete process.env.EMBEDDINGS_BASE_URL;
  resetEnvCacheForTests();
  A = await crearOrganizacion("Enlace A");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.coord = await persona(A.id, "coordinador", "Coco");
  u.asesor = await persona(A.id, "asesor", "Ana");
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, lab: true, agent: true, knowledge: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, lab: true, agent: true, knowledge: true } });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, {
      enabled: true,
      allowedRoles: ["coordinador", "asesor"],
      dailyMessageLimit: 100,
      advanced: { enabled: true, roles: ["coordinador"], areas: ["agents"], launchCampaigns: false },
    })
  );
  const made = await runWithOrganization(A.id, () =>
    createPersonalKey(sessionContext(u.owner, A.id, "owner"), { name: "Claude de prueba", scopes: ["read", "write"] })
  );
  key = made!.key;
});

afterAll(async () => {
  h.session = null;
  await borrarOrganizaciones([A.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
  delete process.env.KB_DOCS;
  resetEnvCacheForTests();
});

describe("Enlace de subida para la IA conectada", () => {
  it("la IA pide el enlace; la persona sube con etiquetas y destinos; «Listo» lo cierra", async () => {
    const made = await herramienta("create_upload_link", {
      note: "Sube los PDF de las carreras",
      tags: ["Carreras"],
      rag: true,
    });
    expect(made.isError).toBe(false);
    const url = String(made.structuredContent.url);
    expect(url).toMatch(/\/subir\/[A-Za-z0-9_-]{32}$/);
    const token = url.split("/").pop()!;
    // Solo se guarda el hash.
    const [row] = await sys().select().from(schema.aiUploadLink).where(eq(schema.aiUploadLink.id, made.structuredContent.link_id));
    expect(row!.tokenHash).not.toContain(token);

    // Otra persona del equipo no lo puede usar; un asesor ni siquiera sube a la Biblioteca.
    como(u.coord, "coordinador");
    expect((await subir(token, "a.txt", "text/plain")).status).toBe(404);
    como(u.asesor, "asesor");
    expect((await subir(token, "a.txt", "text/plain")).status).toBe(403);

    como(u.owner, "owner");
    const ok = await subir(token, "Plan_Derecho.txt", "text/plain", "Primer semestre: introducción al derecho.");
    expect(ok.status).toBe(201);
    expect(ok.body.entry.title).toBe("Plan Derecho");
    expect(ok.body.ragError).toBeNull();
    expect((await subir(token, "logo.svg", "image/svg+xml", "<svg/>")).status).toBe(415);

    const seen = await herramienta("check_upload_link", { link_id: made.structuredContent.link_id });
    expect(seen.structuredContent.state).toBe("open");
    expect(seen.structuredContent.files).toHaveLength(1);
    expect(seen.structuredContent.files[0]).toMatchObject({ title: "Plan Derecho", file: "Plan_Derecho.txt", tags: ["Carreras"], in_chat: true });
    expect(seen.structuredContent.files[0].rag).not.toBeNull();

    const closed = await CERRAR(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ token }) });
    expect(closed.status).toBe(204);
    expect((await subir(token, "otro.txt", "text/plain")).status).toBe(410);
    expect((await herramienta("check_upload_link", { link_id: made.structuredContent.link_id })).structuredContent.state).toBe("closed");
  });

  it("vencido no recibe; un token inventado no existe", async () => {
    const made = await herramienta("create_upload_link", { tags: [] });
    const token = String(made.structuredContent.url).split("/").pop()!;
    await sys()
      .update(schema.aiUploadLink)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.aiUploadLink.id, made.structuredContent.link_id));
    como(u.owner, "owner");
    expect((await subir(token, "a.txt", "text/plain")).status).toBe(410);
    expect((await subir("x".repeat(32), "a.txt", "text/plain")).status).toBe(404);
  });
});
