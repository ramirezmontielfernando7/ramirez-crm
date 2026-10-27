import { asc, count, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import {
  deleteNumberConnection,
  type ConnectionRef,
} from "@/server/credentials/direct";
import {
  startLink,
  statusFor,
  unlink,
  type DirectStatusDto,
  type LinkError,
  type LinkStart,
} from "@/server/direct-connection/link";
import { getOrgModules } from "@/server/modules";

const log = logger("mi-numero");

/**
 * Mi número (046), PR 3 — Autorizar a las personas, su tipo, sus cuatro
 * interruptores y su QR. Reglas (spec 046):
 *
 * - Autoriza el Propietario o un Coordinador (`mi_numero.manage`), a un
 *   miembro de la organización, dentro del tope que fijó la plataforma. Uno
 *   vivo por persona.
 * - Un número `personal` es de su dueño: solo él cambia sus interruptores
 *   (nacen apagados) y solo él lo vincula. Un número `empresa`: sus
 *   interruptores los decide quien autoriza.
 * - El tipo se elige al autorizar. Una vez que la persona aceptó el aviso,
 *   pasar de `personal` a `empresa` solo lo hace ella (su OK); de `empresa` a
 *   `personal` lo decide quien autoriza.
 * - Para vincular, la persona acepta antes el aviso (privacidad, bloqueos y
 *   qué pasa si deja la empresa).
 * - Revocar desvincula el dispositivo y borra su conexión. Lo de sus chats
 *   (los de cliente se quedan, los privados se borran) es del PR 6.
 */

export type NumberKind = "personal" | "empresa";

export type Switches = {
  shareClients: boolean;
  overlapNotice: boolean;
  allowViewRequests: boolean;
  aiReplies: boolean;
};

const SWITCH_KEYS = [
  "shareClients",
  "overlapNotice",
  "allowViewRequests",
  "aiReplies",
] as const;

export type MiNumeroError =
  | "not_member"
  | "has_number"
  | "limit_reached"
  | "not_found"
  | "owner_must_accept"
  | "owner_only"
  | "company_decides"
  | "notice_required"
  | "share_off"
  | "not_linked"
  | LinkError;

export class MiNumeroFailure extends Error {
  constructor(readonly code: MiNumeroError) {
    super(code);
    this.name = "MiNumeroFailure";
  }
}

type Row = typeof schema.directNumber.$inferSelect;

/** No revocado (va siempre dentro de `scoped`). */
function alive() {
  return isNull(schema.directNumber.revokedAt);
}

function refOfNumber(
  row: Pick<Row, "organizationId" | "id">,
): ConnectionRef & { directNumberId: string } {
  return { organizationId: row.organizationId, directNumberId: row.id };
}

function switchesOf(row: Row): Switches {
  return {
    shareClients: row.shareClients,
    overlapNotice: row.overlapNotice,
    allowViewRequests: row.allowViewRequests,
    aiReplies: row.aiReplies,
  };
}

function pickSwitches(patch: Partial<Switches>): Partial<Switches> {
  const out: Partial<Switches> = {};
  for (const k of SWITCH_KEYS) if (patch[k] !== undefined) out[k] = patch[k];
  return out;
}

/** Para las rutas: `null` si la organización tiene «Mi número»; si no, el 404 listo (cero rastro). */
export async function miNumeroOff(
  organizationId: string,
): Promise<Response | null> {
  return (await getOrgModules(organizationId)).miNumero
    ? null
    : new Response(null, { status: 404 });
}

export type NumberDto = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  kind: NumberKind;
  label: string | null;
  switches: Switches;
  noticeAcceptedAt: string | null;
  connection: Pick<DirectStatusDto, "status" | "phoneNumber" | "pausedUntil">;
  createdAt: string;
};

async function toDto(
  row: Row,
  person: { name: string; email: string },
): Promise<NumberDto> {
  const c = await statusFor(refOfNumber(row));
  return {
    id: row.id,
    userId: row.userId,
    userName: person.name,
    userEmail: person.email,
    kind: row.kind,
    label: row.label,
    switches: switchesOf(row),
    noticeAcceptedAt: row.noticeAcceptedAt?.toISOString() ?? null,
    connection: {
      status: c.status,
      phoneNumber: c.phoneNumber,
      pausedUntil: c.pausedUntil,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

export type TeamNumbers = {
  max: number;
  inUse: number;
  numbers: NumberDto[];
  /** Miembros sin número, para autorizar. */
  candidates: { userId: string; name: string; email: string; role: string }[];
};

/** Lo que ve quien autoriza: los números vivos y quién puede recibir uno. Nunca los chats. */
export async function listTeamNumbers(
  organizationId: string,
): Promise<TeamNumbers> {
  const db = getDb();
  const rows = await db
    .select({
      n: schema.directNumber,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.directNumber)
    .innerJoin(schema.user, eq(schema.user.id, schema.directNumber.userId))
    .where(scoped(schema.directNumber.organizationId, organizationId, alive()))
    .orderBy(asc(schema.directNumber.createdAt));
  const members = await db
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(scoped(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.user.name));
  const taken = new Set(rows.map((r) => r.n.userId));
  const { miNumeroMax } = await getOrgModules(organizationId);
  return {
    max: miNumeroMax,
    inUse: rows.length,
    numbers: await Promise.all(rows.map((r) => toDto(r.n, r))),
    candidates: members.filter((m) => !taken.has(m.userId)),
  };
}

export type AuthorizeInput = {
  userId: string;
  kind: NumberKind;
  label?: string | null;
};

export async function authorizeNumber(
  organizationId: string,
  by: string,
  input: AuthorizeInput,
): Promise<string> {
  const { miNumeroMax } = await getOrgModules(organizationId);
  return withTenant(organizationId, async (tx) => {
    // Dos autorizaciones a la vez no se saltan el tope.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`mi-numero:${organizationId}`}))`,
    );
    const [member] = await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        scoped(
          schema.member.organizationId,
          organizationId,
          eq(schema.member.userId, input.userId),
        ),
      )
      .limit(1);
    if (!member) throw new MiNumeroFailure("not_member");
    const [mine] = await tx
      .select({ id: schema.directNumber.id })
      .from(schema.directNumber)
      .where(
        scoped(
          schema.directNumber.organizationId,
          organizationId,
          alive(),
          eq(schema.directNumber.userId, input.userId),
        ),
      )
      .limit(1);
    if (mine) throw new MiNumeroFailure("has_number");
    const [used] = await tx
      .select({ n: count() })
      .from(schema.directNumber)
      .where(
        scoped(schema.directNumber.organizationId, organizationId, alive()),
      );
    if (Number(used?.n ?? 0) >= miNumeroMax)
      throw new MiNumeroFailure("limit_reached");
    const id = newId("directNumber");
    await tx.insert(schema.directNumber).values({
      id,
      organizationId,
      userId: input.userId,
      kind: input.kind,
      label: input.label?.trim() || null,
      authorizedBy: by,
    });
    return id;
  });
}

async function getLive(
  organizationId: string,
  where: ReturnType<typeof eq>,
): Promise<Row | null> {
  const [row] = await getDb()
    .select()
    .from(schema.directNumber)
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        alive(),
        where,
      ),
    )
    .limit(1);
  return row ?? null;
}

export type TeamPatch = {
  kind?: NumberKind;
  label?: string | null;
} & Partial<Switches>;

/** Quien autoriza cambia el tipo, el nombre y (solo de un número de empresa) los interruptores. */
export async function updateTeamNumber(
  organizationId: string,
  id: string,
  patch: TeamPatch,
): Promise<void> {
  const row = await getLive(organizationId, eq(schema.directNumber.id, id));
  if (!row) throw new MiNumeroFailure("not_found");
  const kind = patch.kind ?? row.kind;
  if (row.kind === "personal" && kind === "empresa" && row.noticeAcceptedAt)
    throw new MiNumeroFailure("owner_must_accept");
  const switches = pickSwitches(patch);
  if (Object.keys(switches).length > 0 && kind !== "empresa")
    throw new MiNumeroFailure("owner_only");
  const set: Partial<typeof schema.directNumber.$inferInsert> = {
    ...switches,
    kind,
    updatedAt: new Date(),
  };
  if (patch.label !== undefined) set.label = patch.label?.trim() || null;
  await getDb()
    .update(schema.directNumber)
    .set(set)
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        alive(),
        eq(schema.directNumber.id, id),
      ),
    );
}

/** Revocar: se desvincula el dispositivo (si se puede) y el número deja de existir para todos. */
export async function revokeNumber(
  organizationId: string,
  id: string,
): Promise<void> {
  const row = await getLive(organizationId, eq(schema.directNumber.id, id));
  if (!row) throw new MiNumeroFailure("not_found");
  const ref = refOfNumber(row);
  const off = await unlink(ref);
  if (!off.ok)
    log.warn("no se pudo desvincular un número revocado; se revoca igual", {
      org: organizationId,
      number: id,
      error: off.error,
    });
  await deleteNumberConnection(ref);
  await getDb()
    .update(schema.directNumber)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        alive(),
        eq(schema.directNumber.id, id),
      ),
    );
}

/* ───────── Lo de la persona ───────── */

export type MyNumberDto = Omit<NumberDto, "userName" | "userEmail"> & {
  /** Solo en un número personal la persona mueve sus interruptores. */
  canEditSwitches: boolean;
};

export async function myNumber(
  organizationId: string,
  userId: string,
): Promise<MyNumberDto | null> {
  const row = await getLive(
    organizationId,
    eq(schema.directNumber.userId, userId),
  );
  if (!row) return null;
  const dto: Partial<NumberDto> = await toDto(row, { name: "", email: "" });
  delete dto.userName;
  delete dto.userEmail;
  return { ...(dto as MyNumberDto), canEditSwitches: row.kind === "personal" };
}

export type MyPatch = Partial<Switches> & {
  /** La persona acepta el aviso (una vez; queda la fecha). */
  acceptNotice?: true;
  /** La persona da su OK para que su número sea de la empresa. */
  becomeCompany?: true;
};

export async function updateMyNumber(
  organizationId: string,
  userId: string,
  patch: MyPatch,
): Promise<void> {
  const row = await getLive(
    organizationId,
    eq(schema.directNumber.userId, userId),
  );
  if (!row) throw new MiNumeroFailure("not_found");
  const switches = pickSwitches(patch);
  if (Object.keys(switches).length > 0 && row.kind !== "personal")
    throw new MiNumeroFailure("company_decides");
  const set: Partial<typeof schema.directNumber.$inferInsert> = {
    ...switches,
    updatedAt: new Date(),
  };
  if (patch.acceptNotice && !row.noticeAcceptedAt)
    set.noticeAcceptedAt = new Date();
  if (patch.becomeCompany) set.kind = "empresa";
  await getDb()
    .update(schema.directNumber)
    .set(set)
    .where(
      scoped(
        schema.directNumber.organizationId,
        organizationId,
        alive(),
        eq(schema.directNumber.id, row.id),
      ),
    );
}

async function mine(organizationId: string, userId: string): Promise<Row> {
  const row = await getLive(
    organizationId,
    eq(schema.directNumber.userId, userId),
  );
  if (!row) throw new MiNumeroFailure("not_found");
  return row;
}

/** El QR de MI número. Solo su dueño, y con el aviso aceptado. */
export async function startMyLink(
  organizationId: string,
  userId: string,
): Promise<LinkStart> {
  const row = await mine(organizationId, userId);
  if (!row.noticeAcceptedAt) throw new MiNumeroFailure("notice_required");
  return startLink(refOfNumber(row));
}

export async function myLinkStatus(
  organizationId: string,
  userId: string,
): Promise<DirectStatusDto> {
  return statusFor(refOfNumber(await mine(organizationId, userId)));
}

export async function unlinkMine(
  organizationId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: LinkError }> {
  return unlink(refOfNumber(await mine(organizationId, userId)));
}

/** Para el menú de Ajustes: ¿tiene esta persona un número vivo? (sin preguntar al servidor). */
export async function hasMyNumber(organizationId: string, userId: string): Promise<boolean> {
  return runWithOrganization(organizationId, async () => (await getLive(organizationId, eq(schema.directNumber.userId, userId))) !== null);
}
