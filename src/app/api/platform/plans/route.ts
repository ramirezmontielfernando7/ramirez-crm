import { z } from "zod";
import { parseBody } from "@/lib/api";
import { CATALOG_SCOPES, DEFAULT_PLAN_CATALOG, MAX_FEATURES } from "@/lib/plan-catalog";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { changePlanCatalog, getPlanCatalog } from "@/server/plan-catalog/store";

export const dynamic = "force-dynamic";

/**
 * Catálogo de planes (nombre, precio en MXN, qué incluye): lo que el
 * Propietario ve en «Mejora tu plan». Solo el administrador de plataforma
 * (404 a los demás). `null` en un campo = volver al valor de fábrica.
 */
const respuesta = async () => Response.json({ catalog: await getPlanCatalog(), defaults: DEFAULT_PLAN_CATALOG });

export const GET = withPlatformAdmin(async () => respuesta());

const pesos = z.number().int().min(0).max(1_000_000).nullable().optional();

const schema = z
  .object({
    scope: z.enum(CATALOG_SCOPES),
    name: z.string().trim().min(1).max(30).nullable().optional(),
    tagline: z.string().trim().max(80).nullable().optional(),
    priceMonthlyMxn: pesos,
    priceYearlyMxn: z.number().int().min(0).max(10_000_000).nullable().optional(),
    implementationFeeMxn: pesos,
    peopleLimit: z.number().int().min(1).max(100_000).nullable().optional(),
    storageGb: z.number().int().min(1).max(100_000).nullable().optional(),
    features: z.array(z.string().max(120)).max(MAX_FEATURES * 2).nullable().optional(),
    recommended: z.boolean().nullable().optional(),
  })
  .strict();

export const PUT = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const { scope, ...patch } = body.data;
  await changePlanCatalog(scope, patch, actorOf(admin), ip);
  return respuesta();
});
