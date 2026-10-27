import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { motivosDePerdida, type Desenlace } from "@/server/analytics/sales";
import {
  createLossReason,
  isActiveLossReason,
  listLossReasons,
  lossReasonLabels,
  updateLossReason,
} from "@/server/leads/loss-reasons";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/** Motivos de pérdida editables (0058): siembra, edición, archivado y aislamiento. */

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const enA = <T,>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);
const enB = <T,>(fn: () => Promise<T>) => runWithOrganization(B.id, fn);

beforeAll(async () => {
  A = await crearOrganizacion("Motivos A");
  B = await crearOrganizacion("Motivos B");
});
afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
});

describe("motivos de pérdida", () => {
  it("una organización nueva recibe los seis de siempre, y leerlos dos veces no los duplica", async () => {
    const primera = await enA(() => listLossReasons(A.id));
    const segunda = await enA(() => listLossReasons(A.id));
    expect(primera.map((r) => r.key)).toEqual([
      "precio",
      "no_es_perfil",
      "sin_presupuesto",
      "eligio_otro",
      "nunca_contesto",
      "otro",
    ]);
    expect(segunda).toHaveLength(6);
    expect(primera.every((r) => r.active)).toBe(true);
  });

  it("crear, renombrar y quitar: el nombre nuevo llega a las etiquetas y lo quitado ya no se puede elegir", async () => {
    const nuevo = await enA(() => createLossReason(A.id, "Compró en otra ciudad"));
    expect(nuevo.key).toMatch(/^m_/);
    expect(await enA(() => isActiveLossReason(A.id, nuevo.key))).toBe(true);

    await enA(() => updateLossReason(A.id, nuevo.id, { label: "Se mudó" }));
    expect((await enA(() => lossReasonLabels(A.id)))[nuevo.key]).toBe("Se mudó");

    await enA(() => updateLossReason(A.id, nuevo.id, { active: false }));
    expect(await enA(() => isActiveLossReason(A.id, nuevo.key))).toBe(false);
    // El historial sigue pudiendo nombrarlo.
    expect((await enA(() => lossReasonLabels(A.id)))[nuevo.key]).toBe("Se mudó");
    // Y se puede recuperar.
    await enA(() => updateLossReason(A.id, nuevo.id, { active: true }));
    expect(await enA(() => isActiveLossReason(A.id, nuevo.key))).toBe(true);
  });

  it("«Otro» no se puede quitar, aunque sí renombrar", async () => {
    const otro = (await enA(() => listLossReasons(A.id))).find((r) => r.key === "otro")!;
    expect(await enA(() => updateLossReason(A.id, otro.id, { active: false }))).toBe("protected");
    const res = await enA(() => updateLossReason(A.id, otro.id, { label: "Otro motivo" }));
    expect(res).not.toBe("protected");
    expect(await enA(() => isActiveLossReason(A.id, "otro"))).toBe(true);
  });

  it("cada organización ve y edita solo lo suyo", async () => {
    const deB = await enB(() => listLossReasons(B.id));
    expect(deB.map((r) => r.label)).not.toContain("Se mudó");
    const deA = await enA(() => listLossReasons(A.id));
    // Editar un motivo de A estando en B: no existe.
    expect(await enB(() => updateLossReason(B.id, deA[0]!.id, { label: "Hackeado" }))).toBeNull();
    expect((await enA(() => listLossReasons(A.id)))[0]!.label).not.toBe("Hackeado");
    expect(await enB(() => isActiveLossReason(B.id, "m_inexistente"))).toBe(false);
  });

  it("la gráfica de pérdidas usa los nombres de la organización", async () => {
    const labels = await enA(() => lossReasonLabels(A.id));
    const desenlaces: Desenlace[] = ["otro", "otro", "precio"].map((lossReason) => ({
      leadId: newId("lead"),
      kind: "lost",
      lossReason,
      amountCents: null,
      currency: null,
    }));
    const filas = motivosDePerdida(desenlaces, labels);
    expect(filas[0]).toMatchObject({ reason: "otro", label: "Otro motivo", count: 2 });
  });

  it("el CHECK impide nombres vacíos", async () => {
    await expect(
      getSystemDb().insert(schema.lossReason).values({
        id: newId("lossReason"),
        organizationId: A.id,
        key: "x",
        label: "",
      })
    ).rejects.toThrow();
    expect(
      await getSystemDb().select().from(schema.lossReason).where(eq(schema.lossReason.key, "x"))
    ).toHaveLength(0);
  });
});
