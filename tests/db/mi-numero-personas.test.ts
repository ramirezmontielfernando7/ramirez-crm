import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { assignServer, getConnection } from "@/server/credentials/direct";
import { instanceNameOf } from "@/server/direct-connection/link";
import {
  authorizeNumber,
  listTeamNumbers,
  miNumeroOff,
  MiNumeroFailure,
  myNumber,
  revokeNumber,
  startMyLink,
  updateMyNumber,
  updateTeamNumber,
} from "@/server/mi-numero/numbers";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 3 — autorizar personas, sus interruptores y su QR,
 * contra Postgres real (la app como `vocero_app`, con RLS):
 *
 * - Autoriza quien tiene `mi_numero.manage`, a un miembro, dentro del tope,
 *   uno vivo por persona.
 * - Un número personal: solo su dueño mueve sus interruptores; uno de
 *   empresa: los decide quien autoriza. De personal a empresa, una vez
 *   aceptado el aviso, solo con el OK del dueño.
 * - Sin el aviso aceptado no hay QR; el QR de un número usa SU conexión
 *   (otra instancia), nunca la de la empresa.
 * - Revocar borra su conexión y deja lugar para otro.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

async function falla(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    if (err instanceof MiNumeroFailure) return err.code;
    throw err;
  }
}

async function crearMiembro(organizationId: string, name: string, role = "asesor"): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@x.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId, userId: id, role });
  return id;
}

describe("Mi número — autorizar personas y sus ajustes (PR 3)", () => {
  let A: Org;
  let B: Org;
  let fer: string;
  let ana: string;
  let luis: string;
  let rosa: string;
  let deB: string;
  let servidor: string;

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero personas A");
    B = await crearOrganizacion("MiNumero personas B");
    fer = await crearMiembro(A.id, "Fer", "owner");
    ana = await crearMiembro(A.id, "Ana");
    luis = await crearMiembro(A.id, "Luis");
    rosa = await crearMiembro(A.id, "Rosa");
    deB = await crearMiembro(B.id, "De B");
    servidor = newId("evolutionServer");
    await sys().insert(schema.evolutionServer).values({
      id: servidor,
      name: "Servidor de prueba",
      baseUrl: `https://${servidor}.test`,
      apiKeyCipher: "x",
      apiKeyIv: "x",
      apiKeyTag: "x",
      apiKeyLast4: "abcd",
    });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await sys().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, servidor));
    await sys().delete(schema.user).where(inArray(schema.user.id, [fer, ana, luis, rosa, deB]));
  });

  it("sin el complemento las rutas no existen (404)", async () => {
    expect((await miNumeroOff(A.id))?.status).toBe(404);
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 2 }, "prueba");
    forgetOrgModules(A.id);
    expect(await miNumeroOff(A.id)).toBeNull();
  });

  it("autoriza a miembros, uno vivo por persona y dentro del tope", async () => {
    const id = await as(A.id, () => authorizeNumber(A.id, fer, { userId: ana, kind: "personal" }));
    const [n] = await sys().select().from(schema.directNumber).where(eq(schema.directNumber.id, id));
    expect(n).toMatchObject({ userId: ana, kind: "personal", authorizedBy: fer, shareClients: false, aiReplies: false });
    expect(await falla(as(A.id, () => authorizeNumber(A.id, fer, { userId: ana, kind: "personal" })))).toBe("has_number");
    // Alguien de otra organización no es del equipo.
    expect(await falla(as(A.id, () => authorizeNumber(A.id, fer, { userId: deB, kind: "personal" })))).toBe("not_member");
    await as(A.id, () => authorizeNumber(A.id, fer, { userId: luis, kind: "empresa", label: "Ventas 2" }));
    expect(await falla(as(A.id, () => authorizeNumber(A.id, fer, { userId: rosa, kind: "personal" })))).toBe("limit_reached");
    const equipo = await as(A.id, () => listTeamNumbers(A.id));
    expect(equipo).toMatchObject({ max: 2, inUse: 2 });
    expect(equipo.numbers.map((x) => x.userName)).toEqual(["Ana", "Luis"]);
    expect(equipo.numbers[0]!.connection.status).toBe("pending");
    expect(equipo.candidates.map((c) => c.name).sort()).toEqual(["Fer", "Rosa"]);
  });

  it("número personal: solo su dueño mueve sus interruptores", async () => {
    const [deAna] = (await as(A.id, () => listTeamNumbers(A.id))).numbers;
    expect(await falla(as(A.id, () => updateTeamNumber(A.id, deAna!.id, { aiReplies: true })))).toBe("owner_only");
    await as(A.id, () => updateMyNumber(A.id, ana, { aiReplies: true, shareClients: true }));
    const mio = await as(A.id, () => myNumber(A.id, ana));
    expect(mio).toMatchObject({ kind: "personal", canEditSwitches: true });
    expect(mio!.switches).toEqual({ shareClients: true, overlapNotice: false, allowViewRequests: false, aiReplies: true, clientByDefault: false });
    expect(mio).not.toHaveProperty("userEmail");
    // Quien no tiene número no tiene nada que ver.
    expect(await as(A.id, () => myNumber(A.id, rosa))).toBeNull();
  });

  it("número de empresa: sus interruptores los decide quien autoriza, no la persona", async () => {
    const deLuis = (await as(A.id, () => listTeamNumbers(A.id))).numbers.find((x) => x.userId === luis)!;
    expect(await falla(as(A.id, () => updateMyNumber(A.id, luis, { aiReplies: true })))).toBe("company_decides");
    await as(A.id, () => updateTeamNumber(A.id, deLuis.id, { aiReplies: true }));
    expect((await as(A.id, () => myNumber(A.id, luis)))!.switches.aiReplies).toBe(true);
    // De empresa a personal lo decide quien autoriza.
    await as(A.id, () => updateTeamNumber(A.id, deLuis.id, { kind: "personal" }));
    expect((await as(A.id, () => myNumber(A.id, luis)))!.kind).toBe("personal");
  });

  it("de personal a empresa: antes del aviso lo elige quien autoriza; después, solo con el OK del dueño", async () => {
    const deAna = (await as(A.id, () => listTeamNumbers(A.id))).numbers.find((x) => x.userId === ana)!;
    await as(A.id, () => updateMyNumber(A.id, ana, { acceptNotice: true }));
    expect(await falla(as(A.id, () => updateTeamNumber(A.id, deAna.id, { kind: "empresa" })))).toBe("owner_must_accept");
    await as(A.id, () => updateMyNumber(A.id, ana, { becomeCompany: true }));
    expect((await as(A.id, () => myNumber(A.id, ana)))!).toMatchObject({ kind: "empresa", canEditSwitches: false });
    // Un número que nadie aceptó aún: quien autoriza lo cambia sin problema.
    const deLuis = (await as(A.id, () => listTeamNumbers(A.id))).numbers.find((x) => x.userId === luis)!;
    await as(A.id, () => updateTeamNumber(A.id, deLuis.id, { kind: "empresa" }));
    await as(A.id, () => updateTeamNumber(A.id, deLuis.id, { kind: "personal" }));
  });

  it("sin el aviso no hay QR; el QR del número usa su propia conexión", async () => {
    expect(await falla(as(A.id, () => startMyLink(A.id, luis)))).toBe("notice_required");
    await as(A.id, () => updateMyNumber(A.id, luis, { acceptNotice: true }));
    const mio = (await as(A.id, () => myNumber(A.id, luis)))!;
    const ref = { organizationId: A.id, directNumberId: mio.id };
    await assignServer(A.id, servidor, instanceNameOf(A.id));
    await assignServer(ref, servidor, instanceNameOf(A.id, mio.id));
    // El servidor de prueba no tiene llave legible: se llega hasta él por la conexión del NÚMERO.
    const r = await as(A.id, () => startMyLink(A.id, luis));
    expect(r).toEqual({ ok: false, error: "server_key_unreadable" });
    const empresa = await getConnection(A.id);
    const delNumero = await getConnection(ref);
    expect(empresa!.directNumberId).toBeNull();
    expect(delNumero).toMatchObject({ directNumberId: mio.id, instanceName: instanceNameOf(A.id, mio.id) });
    expect(delNumero!.id).not.toBe(empresa!.id);
    expect(instanceNameOf(A.id, mio.id)).toMatch(/^df-[a-z0-9]+-[a-z0-9]+$/);
    expect(instanceNameOf(A.id, mio.id).length).toBeLessThanOrEqual(60);
  });

  it("revocar borra su conexión, deja la de la empresa y abre lugar para otro", async () => {
    const deLuis = (await as(A.id, () => listTeamNumbers(A.id))).numbers.find((x) => x.userId === luis)!;
    await as(A.id, () => revokeNumber(A.id, deLuis.id));
    expect(await getConnection({ organizationId: A.id, directNumberId: deLuis.id })).toBeNull();
    expect(await getConnection(A.id)).not.toBeNull();
    expect(await as(A.id, () => myNumber(A.id, luis))).toBeNull();
    expect(await falla(as(A.id, () => revokeNumber(A.id, deLuis.id)))).toBe("not_found");
    await as(A.id, () => authorizeNumber(A.id, fer, { userId: rosa, kind: "personal" }));
  });

  it("B no ve ni toca los números de A", async () => {
    await updateOrgModules(B.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 2 }, "prueba");
    forgetOrgModules(B.id);
    const deAna = (await as(A.id, () => listTeamNumbers(A.id))).numbers.find((x) => x.userId === ana)!;
    expect((await as(B.id, () => listTeamNumbers(B.id))).numbers).toEqual([]);
    expect(await falla(as(B.id, () => updateTeamNumber(B.id, deAna.id, { label: "mío" })))).toBe("not_found");
    expect(await falla(as(B.id, () => revokeNumber(B.id, deAna.id)))).toBe("not_found");
    expect(await as(B.id, () => myNumber(B.id, ana))).toBeNull();
  });
});
