import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { ASSIGNABLE_ROLES, type Role } from "@/lib/auth/permissions";
import { countAssignedByUser } from "@/server/assignment/assign";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const members = await db
    .select({
      id: schema.member.id,
      userId: schema.member.userId,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, session.organizationId));
  // 020: cuántos chats tiene cada quien, para decidir a quién repartir y
  // para la reasignación en lote.
  const assigned = await countAssignedByUser(session.organizationId);
  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      assignedCount: assigned.get(m.userId) ?? 0,
      name: m.name,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}, { permission: "users.read" });

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  /** 020: por defecto, asesor. Propietario hay uno y no se crea desde aquí. */
  role: z
    .enum(ASSIGNABLE_ROLES as [Role, ...Role[]])
    .optional()
    .default("asesor"),
});

/** Alta de cuenta de equipo (owner only): email + contraseña temporal (FR-061). */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: body.data.name,
          email: body.data.email,
          password: body.data.password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  const db = getDb();
  await db
    .insert(schema.member)
    .values({
      id: newId("member"),
      organizationId: session.organizationId,
      userId: newUserId,
      role: body.data.role,
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
}, { permission: "users.manage" });
