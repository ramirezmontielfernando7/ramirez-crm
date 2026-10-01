import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import {
  getMessengerCredentialsByOrg,
  saveMessengerCredentials,
  tokenLast4,
} from "@/server/messenger/credentials";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { verifyZernioToken } from "@/server/zernio";

export const dynamic = "force-dynamic";

/** 017 — Estado de la conexión de Messenger (el token nunca sale entero). */
export const GET = withAuth(async (session) => {
  if (!(await isChannelEnabled(session.organizationId, "messenger"))) return channelDisabledResponse();
  const creds = await getMessengerCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      source: creds.source,
      pageId: creds.pageId,
      pageName: creds.pageName,
      accountRef: creds.accountRef,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
      // Fase 3: sin secreto, los eventos de Zernio se rechazan (401).
      hasWebhookSecret: Boolean(creds.webhookSecret),
    },
  });
}, { permission: "settings.manage" });

const putSchema = z.object({
  source: z.enum(["zernio", "meta"]).default("meta"),
  pageId: z.string().trim().min(1).nullish(),
  accountRef: z.string().trim().min(1).nullish(),
  token: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1).nullish(),
});

/**
 * Guarda la conexión validando ANTES contra la plataforma, igual que el wizard
 * de WhatsApp: un token que no sirve no llega a la base. Solo el propietario
 * de la organización puede hacerlo.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!(await isChannelEnabled(session.organizationId, "messenger"))) return channelDisabledResponse();
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  // `.default()` deja el tipo opcional aunque Zod siempre lo rellene: se fija
  // aquí para que el resto del handler trabaje con un valor cerrado.
  const data = { ...body.data, source: body.data.source ?? "meta" };

  if (data.source === "meta" && !data.pageId) {
    return apiError(
      422,
      "invalid_body",
      "En modo Meta hace falta el ID de la página"
    );
  }
  if (data.source === "zernio" && !data.accountRef) {
    return apiError(
      422,
      "invalid_body",
      "En modo Zernio hace falta el accountId de la cuenta conectada"
    );
  }

  // Fase 3: en modo Zernio el secreto del webhook es OBLIGATORIO (sin él, sus
  // eventos se rechazan con 401). Si no se manda, vale el que ya estaba
  // guardado para esa misma cuenta.
  let webhookSecret: string | null = null;
  if (data.source === "zernio") {
    const previous = await getMessengerCredentialsByOrg(session.organizationId);
    webhookSecret =
      data.webhookSecret ??
      (previous?.source === "zernio" && previous.accountRef === data.accountRef ? previous.webhookSecret : null);
    if (!webhookSecret) {
      return apiError(
        422,
        "webhook_secret_required",
        "En modo Zernio hace falta el secreto del webhook (lo da Zernio al registrar el webhook): sin él, los mensajes se rechazan"
      );
    }
  }

  const check = await verify(data);
  if (!check.ok) return apiError(check.status, check.code, check.message);

  await saveMessengerCredentials({
    organizationId: session.organizationId,
    source: data.source,
    pageId: data.pageId ?? null,
    pageName: check.pageName,
    accountRef: data.accountRef ?? null,
    token: data.token,
    webhookSecret,
  });

  return Response.json({ ok: true, pageName: check.pageName });
}, { permission: "settings.manage" });

type Check =
  | { ok: true; pageName: string | null }
  | { ok: false; status: number; code: string; message: string };

type VerifyInput = Omit<z.infer<typeof putSchema>, "source"> & {
  source: "zernio" | "meta";
};

async function verify(data: VerifyInput): Promise<Check> {
  if (data.source === "zernio") {
    try {
      await verifyZernioToken(data.token);
      return { ok: true, pageName: null };
    } catch (err) {
      return translate(err, "La API key de Zernio no es válida");
    }
  }

  // Meta: el token debe ser de ESA página. Un token de otra guardaría
  // credenciales que reciben webhooks de una y contestan por otra.
  try {
    const res = await graphRequest<{ id?: string; name?: string }>(
      `${data.pageId}?fields=id,name`,
      { token: data.token }
    );
    if (res.id && res.id !== data.pageId) {
      return {
        ok: false,
        status: 422,
        code: "id_mismatch",
        message: `El token pertenece a la página ${res.id}, no a ${data.pageId}`,
      };
    }
    return { ok: true, pageName: res.name?.trim() || null };
  } catch (err) {
    return translate(
      err,
      "El token de la página no es válido o no tiene permiso de mensajes (pages_messaging)"
    );
  }
}

function translate(err: unknown, invalidMessage: string): Check {
  if (err instanceof MetaApiError) {
    if (err.status === 0 || err.status >= 500) {
      return {
        ok: false,
        status: 503,
        code: "platform_unavailable",
        message: "No se pudo contactar la plataforma; intenta de nuevo",
      };
    }
    return { ok: false, status: 422, code: "invalid_token", message: invalidMessage };
  }
  throw err;
}
