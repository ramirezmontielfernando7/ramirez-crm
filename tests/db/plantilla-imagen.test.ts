import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { attachTemplateHeaderImage, TemplateError, templateSendability } from "@/server/whatsapp/templates";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Adjuntar la imagen del encabezado a una plantilla aprobada creada FUERA del
 * CRM: se guarda solo del lado del CRM (sin llamar a Meta), la plantilla
 * queda enviable, no se reemplaza una imagen ya guardada y otra organización
 * no la alcanza.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
let A: Org;
let B: Org;
let mediaDir: string;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

const JPG = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mimeType: "image/jpeg", fileName: "promo.jpg" };

async function plantilla(org: string, conImagen: boolean): Promise<string> {
  const id = newId("template");
  await getSystemDb().insert(schema.template).values({
    id,
    organizationId: org,
    name: `promo_${id.slice(-6).toLowerCase()}`,
    language: "es_MX",
    category: "MARKETING",
    body: "Mira nuestra promo",
    status: "approved",
    metaStatus: "APPROVED",
    components: [
      ...(conImagen ? [{ type: "HEADER", format: "IMAGE" }] : []),
      { type: "BODY", text: "Mira nuestra promo" },
    ],
  });
  return id;
}

async function codigo(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof TemplateError) return err.code;
    throw err;
  }
}

beforeAll(async () => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "vocero-plantilla-imagen-"));
  process.env.MEDIA_DIR = mediaDir;
  resetEnvCacheForTests();
  A = await crearOrganizacion("Plantilla A");
  B = await crearOrganizacion("Plantilla B");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  rmSync(mediaDir, { recursive: true, force: true });
  delete process.env.MEDIA_DIR;
  resetEnvCacheForTests();
});

describe("adjuntar la imagen del encabezado a una plantilla importada", () => {
  it("la guarda sin llamar a Meta y la plantilla queda enviable", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no debe llamar a Meta")));
    vi.stubGlobal("fetch", fetchSpy);
    const id = await plantilla(A.id, true);
    const [antes] = await as(A.id, () => getDb().select().from(schema.template).where(eq(schema.template.id, id)));
    expect(templateSendability(antes!).sendable).toBe(false);

    const t = await as(A.id, () => attachTemplateHeaderImage(A.id, id, JPG));
    expect(t.headerMediaAssetId).toBeTruthy();
    expect(templateSendability(t)).toEqual({ sendable: true, reason: null });
    expect(fetchSpy).not.toHaveBeenCalled();

    const [asset] = await as(A.id, () =>
      getDb().select().from(schema.mediaAsset).where(eq(schema.mediaAsset.id, t.headerMediaAssetId!))
    );
    expect(asset).toMatchObject({ kind: "image", mimeType: "image/jpeg", fileSize: JPG.data.byteLength, fetchStatus: "available" });

    // Ya tiene imagen: no se reemplaza.
    expect(await codigo(() => as(A.id, () => attachTemplateHeaderImage(A.id, id, JPG)))).toBe("invalid");
  });

  it("otra organización no la alcanza", async () => {
    const id = await plantilla(A.id, true);
    expect(await codigo(() => as(B.id, () => attachTemplateHeaderImage(B.id, id, JPG)))).toBe("not_found");
    const [t] = await getSystemDb().select().from(schema.template).where(eq(schema.template.id, id));
    expect(t!.headerMediaAssetId).toBeNull();
  });

  it("rechaza plantillas sin imagen, formatos distintos de JPG/PNG y más de 5 MB", async () => {
    const sinImagen = await plantilla(A.id, false);
    expect(await codigo(() => as(A.id, () => attachTemplateHeaderImage(A.id, sinImagen, JPG)))).toBe("invalid");
    const id = await plantilla(A.id, true);
    expect(await codigo(() => as(A.id, () => attachTemplateHeaderImage(A.id, id, { ...JPG, mimeType: "image/webp" })))).toBe("invalid");
    const grande = { ...JPG, data: new Uint8Array(5 * 1024 * 1024 + 1) };
    expect(await codigo(() => as(A.id, () => attachTemplateHeaderImage(A.id, id, grande)))).toBe("invalid");
    const [t] = await getSystemDb().select().from(schema.template).where(eq(schema.template.id, id));
    expect(t!.headerMediaAssetId).toBeNull();
  });
});
