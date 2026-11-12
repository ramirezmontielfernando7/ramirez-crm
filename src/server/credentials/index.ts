import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { currentOrganizationId, runWithOrganization } from "@/lib/request-context";
import { logger } from "@/lib/log";
import { asc } from "drizzle-orm";
import { open, seal, type OpenFailure, type SealedValue } from "./vault";

/**
 * Fase 3, PR 1 — LA PUERTA ÚNICA de las credenciales de una organización.
 *
 * Todo lo que necesite un token o secreto de un negocio lo pide aquí:
 *
 *   const r = await getOrgCredentials(orgId, "whatsapp");
 *   if (!r.ok) …r.error  // "not_connected" | "reconnect_required" | "decrypt_failed" | "key_unavailable"
 *
 * - Lee con el pool de la APP a nombre de esa organización (RLS): una
 *   organización no puede pedir las credenciales de otra. Llamada dentro del
 *   contexto de OTRA organización, lanza.
 * - Descifra con la llave de la versión de cada fila (`key_version`).
 * - Nunca registra el secreto.
 *
 * El enrutamiento inverso (número → organización) vive aparte, en
 * `./resolve.ts`, con el pool de sistema y SIN descifrar nada.
 */

type CredentialKind = "whatsapp" | "instagram" | "messenger" | "capi" | "zoom" | "google";

type CredentialError = "not_connected" | "reconnect_required" | OpenFailure;

export type WhatsAppCredentials = {
  id: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** 0080: nombre que la empresa le puso al número («Ventas»); null = sin nombre. */
  label: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

export type InstagramCredentials = {
  id: string;
  organizationId: string;
  source: "zernio" | "meta";
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

export type MessengerCredentials = {
  id: string;
  organizationId: string;
  source: "zernio" | "meta";
  /** ID de la página de Facebook. En modo Zernio puede no conocerse. */
  pageId: string | null;
  pageName: string | null;
  /** Zernio: accountId de la cuenta conectada. Meta directo: null. */
  accountRef: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

export type CapiSettings = {
  datasetId: string;
  token: string;
  qualifiedStageId: string | null;
  status: "connected" | "error";
};

export type ZoomCreds = {
  accountId: string;
  clientId: string;
  clientSecret: string;
  status: "connected" | "error";
};

export type GoogleCreds = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  status: "connected" | "error";
};

type CredentialMap = {
  whatsapp: WhatsAppCredentials;
  instagram: InstagramCredentials;
  messenger: MessengerCredentials;
  capi: CapiSettings;
  zoom: ZoomCreds;
  google: GoogleCreds;
};

type CredentialResult<K extends CredentialKind> =
  | { ok: true; value: CredentialMap[K] }
  | { ok: false; error: CredentialError };

/** Las credenciales existen pero no se pueden usar (sin el secreto en el mensaje). */
export class CredentialUnavailableError extends Error {
  constructor(
    readonly kind: CredentialKind,
    readonly code: Exclude<CredentialError, "not_connected">
  ) {
    super(
      code === "key_unavailable"
        ? `credenciales de ${kind}: cifradas con una versión de ENCRYPTION_KEY que este proceso no tiene (revisa ENCRYPTION_KEY_VERSION / ENCRYPTION_KEY_OLD)`
        : code === "decrypt_failed"
          ? `credenciales de ${kind}: no se pudieron descifrar (¿ENCRYPTION_KEY equivocada?)`
          : `credenciales de ${kind}: hay que reconectar`
    );
    this.name = "CredentialUnavailableError";
  }
}

/** Cifra un secreto para guardarlo, con la versión de llave actual. */
export function sealForStorage(plain: string): SealedValue {
  return seal(plain);
}

/** Abre lo que guardó `sealForStorage` (sin lanzar: el fallo viene tipado). */
export function openFromStorage(cipher: string, iv: string, tag: string, keyVersion: number) {
  return open(cipher, iv, tag, keyVersion);
}

const log = logger("credentials");

class OpenError extends Error {
  constructor(readonly code: OpenFailure) {
    super(code);
  }
}

function must(cipher: string, iv: string, tag: string, keyVersion: number): string {
  const r = open(cipher, iv, tag, keyVersion);
  if (!r.ok) throw new OpenError(r.error);
  return r.value;
}

/** Secreto de webhook de Zernio: el cifrado si existe; si no, el viejo en claro (hasta que el arranque lo cifre). */
function webhookSecretOf(row: {
  webhookSecret: string | null;
  webhookSecretCipher: string | null;
  webhookSecretIv: string | null;
  webhookSecretTag: string | null;
  keyVersion: number;
}): string | null {
  if (row.webhookSecretCipher && row.webhookSecretIv && row.webhookSecretTag) {
    return must(row.webhookSecretCipher, row.webhookSecretIv, row.webhookSecretTag, row.keyVersion);
  }
  return row.webhookSecret;
}

type MetaRow = typeof schema.metaCredentials.$inferSelect;
type IgRow = typeof schema.instagramCredentials.$inferSelect;
type FbRow = typeof schema.messengerCredentials.$inferSelect;

/** Uso interno del módulo (también lo usa `resolve.ts` para el secreto de Zernio). */
function decodeWhatsApp(row: MetaRow): WhatsAppCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    label: row.label,
    status: row.status,
    token: must(row.tokenCipher, row.tokenIv, row.tokenTag, row.keyVersion),
  };
}

function decodeInstagram(row: IgRow): InstagramCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    igUserId: row.igUserId,
    accountRef: row.accountRef,
    username: row.username,
    webhookSecret: webhookSecretOf(row),
    status: row.status,
    token: must(row.tokenCipher, row.tokenIv, row.tokenTag, row.keyVersion),
  };
}

function decodeMessenger(row: FbRow): MessengerCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: row.source,
    pageId: row.pageId,
    pageName: row.pageName,
    accountRef: row.accountRef,
    webhookSecret: webhookSecretOf(row),
    status: row.status,
    token: must(row.tokenCipher, row.tokenIv, row.tokenTag, row.keyVersion),
  };
}

/** Uso interno: el secreto de Zernio de una fila ya resuelta, o el error tipado. */
export function openWebhookSecret(row: IgRow | FbRow): { ok: true; value: string | null } | { ok: false; error: OpenFailure } {
  try {
    return { ok: true, value: webhookSecretOf(row) };
  } catch (err) {
    if (err instanceof OpenError) return { ok: false, error: err.code };
    throw err;
  }
}

type Loaded<K extends CredentialKind> = { value: CredentialMap[K]; usable: boolean } | null;

async function load<K extends CredentialKind>(
  organizationId: string,
  kind: K,
  phoneNumberId?: string | null
): Promise<Loaded<K>> {
  const db = getDb();
  switch (kind) {
    case "whatsapp": {
      // 0080: varios números por organización. Sin `phoneNumberId` (o si ese
      // número ya no existe) se usa el PRINCIPAL: el más antiguo.
      const rows = await db
        .select()
        .from(schema.metaCredentials)
        .where(scoped(schema.metaCredentials.organizationId, organizationId))
        .orderBy(asc(schema.metaCredentials.createdAt), asc(schema.metaCredentials.id));
      const row = (phoneNumberId ? rows.find((r) => r.phoneNumberId === phoneNumberId) : undefined) ?? rows[0];
      if (!row) return null;
      return { value: decodeWhatsApp(row), usable: row.status === "connected" } as Loaded<K>;
    }
    case "instagram": {
      const [row] = await db
        .select()
        .from(schema.instagramCredentials)
        .where(scoped(schema.instagramCredentials.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      return { value: decodeInstagram(row), usable: row.status === "connected" } as Loaded<K>;
    }
    case "messenger": {
      const [row] = await db
        .select()
        .from(schema.messengerCredentials)
        .where(scoped(schema.messengerCredentials.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      return { value: decodeMessenger(row), usable: row.status === "connected" } as Loaded<K>;
    }
    case "capi": {
      const [row] = await db
        .select()
        .from(schema.capiSettings)
        .where(scoped(schema.capiSettings.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      const value: CapiSettings = {
        datasetId: row.datasetId,
        token: must(row.tokenCipher, row.tokenIv, row.tokenTag, row.keyVersion),
        qualifiedStageId: row.qualifiedStageId,
        status: row.status,
      };
      return { value, usable: row.status === "connected" } as Loaded<K>;
    }
    case "zoom": {
      const [row] = await db
        .select()
        .from(schema.zoomCredentials)
        .where(scoped(schema.zoomCredentials.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      const value: ZoomCreds = {
        accountId: row.accountId,
        clientId: row.clientId,
        clientSecret: must(row.secretCipher, row.secretIv, row.secretTag, row.keyVersion),
        status: row.status,
      };
      return { value, usable: row.status === "connected" } as Loaded<K>;
    }
    case "google": {
      const [row] = await db
        .select()
        .from(schema.googleCredentials)
        .where(scoped(schema.googleCredentials.organizationId, organizationId))
        .limit(1);
      if (!row) return null;
      const value: GoogleCreds = {
        clientId: row.clientId,
        clientSecret: must(row.clientSecretCipher, row.clientSecretIv, row.clientSecretTag, row.keyVersion),
        refreshToken: must(row.refreshTokenCipher, row.refreshTokenIv, row.refreshTokenTag, row.keyVersion),
        calendarId: row.calendarId,
        status: row.status,
      };
      return { value, usable: row.status === "connected" } as Loaded<K>;
    }
  }
  throw new Error(`tipo de credencial desconocido: ${String(kind)}`);
}

/**
 * Las credenciales `kind` de `organizationId`, descifradas.
 *
 * Con `{ requireUsable: true }` una conexión marcada para reconectar (o en
 * error) devuelve `reconnect_required`; sin ella se devuelve igual (Ajustes
 * la muestra con su estado).
 */
export async function getOrgCredentials<K extends CredentialKind>(
  organizationId: string,
  kind: K,
  opts?: { requireUsable?: boolean; phoneNumberId?: string | null }
): Promise<CredentialResult<K>> {
  if (!organizationId) throw new Error("getOrgCredentials: organizationId vacío");
  const ctx = currentOrganizationId();
  if (ctx !== null && ctx !== organizationId) {
    // Nunca se leen credenciales de una organización desde el trabajo de otra.
    throw new Error("getOrgCredentials: la organización pedida no es la del contexto");
  }
  const run = () => load(organizationId, kind, opts?.phoneNumberId);
  let loaded: Loaded<K>;
  try {
    loaded = ctx === null ? await runWithOrganization(organizationId, run) : await run();
  } catch (err) {
    if (err instanceof OpenError) {
      // Sin el secreto ni la llave: solo qué falló y con qué tipo.
      log.error(`no se pudieron abrir las credenciales de ${kind}`, { code: err.code });
      return { ok: false, error: err.code };
    }
    throw err;
  }
  if (!loaded) return { ok: false, error: "not_connected" };
  if (opts?.requireUsable && !loaded.usable) return { ok: false, error: "reconnect_required" };
  return { ok: true, value: loaded.value };
}

/**
 * 0080 — Todos los números oficiales de la organización (el principal
 * primero), SIN secretos: lo que necesitan Ajustes y la Bandeja. El token solo
 * viaja como sus últimos 4 caracteres.
 */
export type WhatsAppNumberInfo = {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  label: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string | null;
  isPrimary: boolean;
};

export async function listWhatsAppNumbers(organizationId: string): Promise<WhatsAppNumberInfo[]> {
  const run = async () => {
    const rows = await getDb()
      .select()
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .orderBy(asc(schema.metaCredentials.createdAt), asc(schema.metaCredentials.id));
    return rows.map((row, i): WhatsAppNumberInfo => {
      let last4: string | null = null;
      try {
        last4 = must(row.tokenCipher, row.tokenIv, row.tokenTag, row.keyVersion).slice(-4);
      } catch {
        last4 = null; // sin llave o dañado: Ajustes lo muestra sin los 4 dígitos
      }
      return {
        id: row.id,
        wabaId: row.wabaId,
        phoneNumberId: row.phoneNumberId,
        displayPhoneNumber: row.displayPhoneNumber,
        verifiedName: row.verifiedName,
        label: row.label,
        status: row.status,
        tokenLast4: last4,
        isPrimary: i === 0,
      };
    });
  };
  const ctx = currentOrganizationId();
  if (ctx !== null && ctx !== organizationId) throw new Error("listWhatsAppNumbers: la organización pedida no es la del contexto");
  return ctx === null ? runWithOrganization(organizationId, run) : run();
}

/**
 * Atajo para el código que ya trataba "no hay conexión" como `null`: devuelve
 * null si no está conectada y LANZA `CredentialUnavailableError` (tipada) si
 * existe pero no se puede abrir. Nunca devuelve un secreto a medias.
 */
export async function getOrgCredentialsOrNull<K extends CredentialKind>(
  organizationId: string,
  kind: K,
  opts?: { phoneNumberId?: string | null }
): Promise<CredentialMap[K] | null> {
  const r = await getOrgCredentials(organizationId, kind, opts);
  if (r.ok) return r.value;
  if (r.error === "not_connected") return null;
  throw new CredentialUnavailableError(kind, r.error);
}

/**
 * Conexión directa (PR 6) — ¿La organización tiene número de WhatsApp de Meta
 * guardado (aunque esté por reconectar)? Solo mira si la fila existe: no abre
 * ningún secreto. Sin ella, la empresa opera solo con el dispositivo vinculado.
 */
export async function orgHasWhatsAppConnection(organizationId: string): Promise<boolean> {
  const run = async () => {
    const [row] = await getDb()
      .select({ id: schema.metaCredentials.organizationId })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .limit(1);
    return !!row;
  };
  const ctx = currentOrganizationId();
  if (ctx !== null && ctx !== organizationId) throw new Error("orgHasWhatsAppConnection: la organización pedida no es la del contexto");
  return ctx === null ? runWithOrganization(organizationId, run) : run();
}
