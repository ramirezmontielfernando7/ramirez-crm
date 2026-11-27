import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { CATALOG_SCOPES, DEFAULT_PLAN_CATALOG, MAX_FEATURES } from "@/lib/plan-catalog";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import {
  changePlanCatalog,
  changePlanModules,
  changePlatformContact,
  getCustomModulePlans,
  getPlanCatalog,
  getPlanProfiles,
  getPlatformContact,
} from "@/server/plan-catalog/store";
import { FACTORY_PLAN_PROFILES, PLATFORM_MODULE_TOGGLES, type PlatformModuleToggle } from "@/lib/platform-modules";

export const dynamic = "force-dynamic";

/**
 * Catálogo de planes (nombre, precio en MXN, qué incluye): lo que el
 * Propietario ve en «Mejora tu plan». Solo el administrador de plataforma
 * (404 a los demás). `null` en un campo = volver al valor de fábrica.
 */
const respuesta = async () =>
  Response.json({
    catalog: await getPlanCatalog(),
    defaults: DEFAULT_PLAN_CATALOG,
    contactWhatsapp: await getPlatformContact(),
    // 048: qué módulos trae cada plan (editable) y los de fábrica.
    modules: await getPlanProfiles(),
    modulesDefaults: FACTORY_PLAN_PROFILES,
    modulesCustom: await getCustomModulePlans(),
  });

export const GET = withPlatformAdmin(async () => respuesta());

const pesos = z.number().int().min(0).max(1_000_000).nullable().optional();

const planSchema = z
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

/** 0077: el WhatsApp de contacto de «¿Necesitas más?» (vacío o null = sin número). */
const contactSchema = z.object({ contactWhatsapp: z.string().max(40).nullable() }).strict();

/** 048: qué módulos trae un plan (los 13; `null` = volver a los de fábrica). */
const modulesSchema = z
  .object({
    scope: z.enum(CATALOG_SCOPES),
    modules: z
      .object(Object.fromEntries(PLATFORM_MODULE_TOGGLES.map((k) => [k, z.boolean()])) as Record<PlatformModuleToggle, z.ZodBoolean>)
      .strict()
      .nullable(),
  })
  .strict();

const schema = z.union([modulesSchema, planSchema, contactSchema]);

export const PUT = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  if ("contactWhatsapp" in body.data) {
    try {
      await changePlatformContact(body.data.contactWhatsapp, actorOf(admin), ip);
    } catch {
      return apiError(422, "invalid_phone", "Escribe el WhatsApp con lada: 10 dígitos de México o el número completo con país.");
    }
    return respuesta();
  }
  if ("modules" in body.data) {
    await changePlanModules(body.data.scope, body.data.modules, actorOf(admin), ip);
    return respuesta();
  }
  const { scope, ...patch } = body.data;
  await changePlanCatalog(scope, patch, actorOf(admin), ip);
  return respuesta();
});
