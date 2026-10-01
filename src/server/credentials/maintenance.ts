import { and, eq, getTableColumns, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getSystemDb, schema } from "@/lib/db";
import { currentKeyVersion } from "@/lib/crypto";
import { logger } from "@/lib/log";
import { open, seal } from "./vault";

/**
 * Fase 3, PR 1 — Mantenimiento de lo cifrado, AL ARRANCAR (antes de atender).
 *
 * 1. ROTACIÓN: toda fila con `key_version` distinta de la actual se descifra
 *    con su llave (la vieja, `ENCRYPTION_KEY_OLD`) y se vuelve a cifrar con
 *    la actual. Antes de escribir se comprueba que lo recién cifrado se
 *    descifra igual. La escritura exige que la fila siga en la versión que
 *    se leyó: re-ejecutable y sin pisar a nadie.
 * 2. El `webhook_secret` de Zernio que quedara EN CLARO (antes de la 0028) se
 *    cifra y la columna en claro queda en NULL.
 *
 * - Pool de sistema: recorre todas las organizaciones (no es trabajo de una).
 * - Un candado de Postgres (`pg_try_advisory_lock`) evita que dos
 *   contenedores lo hagan a la vez durante un despliegue.
 * - En el log solo hay conteos por tabla. Jamás un valor ni una llave.
 * - Nunca tumba el arranque: lo que no se pudo (llave faltante, tag
 *   inválido) queda contado y la app sigue; esas credenciales responden
 *   `key_unavailable` / `decrypt_failed` hasta que se arregle.
 */

const log = logger("credentials");

/** Llave del candado: constante, arbitraria, solo para este trabajo. */
const LOCK_KEY = 0x766f6365; // "voce"

type SecretCols = { cipher: PgColumn; iv: PgColumn; tag: PgColumn };

type Target = {
  name: string;
  table: PgTable;
  id: PgColumn;
  keyVersion: PgColumn;
  secrets: SecretCols[];
  /** Columna en claro que, si tiene valor, se cifra en `plainTo`. */
  plain?: { column: PgColumn; to: SecretCols };
};

function targets(): Target[] {
  const ig = schema.instagramCredentials;
  const fb = schema.messengerCredentials;
  return [
    {
      name: "meta_credentials",
      table: schema.metaCredentials,
      id: schema.metaCredentials.id,
      keyVersion: schema.metaCredentials.keyVersion,
      secrets: [{ cipher: schema.metaCredentials.tokenCipher, iv: schema.metaCredentials.tokenIv, tag: schema.metaCredentials.tokenTag }],
    },
    {
      name: "instagram_credentials",
      table: ig,
      id: ig.id,
      keyVersion: ig.keyVersion,
      secrets: [
        { cipher: ig.tokenCipher, iv: ig.tokenIv, tag: ig.tokenTag },
        { cipher: ig.webhookSecretCipher, iv: ig.webhookSecretIv, tag: ig.webhookSecretTag },
      ],
      plain: { column: ig.webhookSecret, to: { cipher: ig.webhookSecretCipher, iv: ig.webhookSecretIv, tag: ig.webhookSecretTag } },
    },
    {
      name: "messenger_credentials",
      table: fb,
      id: fb.id,
      keyVersion: fb.keyVersion,
      secrets: [
        { cipher: fb.tokenCipher, iv: fb.tokenIv, tag: fb.tokenTag },
        { cipher: fb.webhookSecretCipher, iv: fb.webhookSecretIv, tag: fb.webhookSecretTag },
      ],
      plain: { column: fb.webhookSecret, to: { cipher: fb.webhookSecretCipher, iv: fb.webhookSecretIv, tag: fb.webhookSecretTag } },
    },
    {
      name: "zoom_credentials",
      table: schema.zoomCredentials,
      id: schema.zoomCredentials.id,
      keyVersion: schema.zoomCredentials.keyVersion,
      secrets: [{ cipher: schema.zoomCredentials.secretCipher, iv: schema.zoomCredentials.secretIv, tag: schema.zoomCredentials.secretTag }],
    },
    {
      name: "google_credentials",
      table: schema.googleCredentials,
      id: schema.googleCredentials.id,
      keyVersion: schema.googleCredentials.keyVersion,
      secrets: [
        { cipher: schema.googleCredentials.clientSecretCipher, iv: schema.googleCredentials.clientSecretIv, tag: schema.googleCredentials.clientSecretTag },
        { cipher: schema.googleCredentials.refreshTokenCipher, iv: schema.googleCredentials.refreshTokenIv, tag: schema.googleCredentials.refreshTokenTag },
      ],
    },
    {
      name: "capi_settings",
      table: schema.capiSettings,
      id: schema.capiSettings.id,
      keyVersion: schema.capiSettings.keyVersion,
      secrets: [{ cipher: schema.capiSettings.tokenCipher, iv: schema.capiSettings.tokenIv, tag: schema.capiSettings.tokenTag }],
    },
    {
      name: "webhook_unrouted",
      table: schema.webhookUnrouted,
      id: schema.webhookUnrouted.id,
      keyVersion: schema.webhookUnrouted.keyVersion,
      secrets: [{ cipher: schema.webhookUnrouted.payloadCipher, iv: schema.webhookUnrouted.payloadIv, tag: schema.webhookUnrouted.payloadTag }],
    },
  ];
}

export type TableReport = {
  table: string;
  /** Filas por versión de llave, DESPUÉS del mantenimiento. */
  byVersion: Record<number, number>;
  rotated: number;
  /** Secretos en claro que se cifraron. */
  sealedPlain: number;
  /** Filas que no se pudieron abrir: su llave no está en el entorno. */
  keyUnavailable: number;
  /** Filas que no descifran con su llave (¿llave equivocada?). */
  decryptFailed: number;
};

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

type Row = Record<string, unknown>;

function columnKey(col: PgColumn): string {
  return col.name;
}

async function processTable(t: Target, current: number): Promise<TableReport> {
  const db = sys();
  const report: TableReport = { table: t.name, byVersion: {}, rotated: 0, sealedPlain: 0, keyUnavailable: 0, decryptFailed: 0 };

  const cols: Record<string, PgColumn> = { id: t.id, key_version: t.keyVersion };
  for (const s of t.secrets) for (const c of [s.cipher, s.iv, s.tag]) cols[columnKey(c)] = c;
  if (t.plain) cols[columnKey(t.plain.column)] = t.plain.column;

  const pending: SQL | undefined = t.plain
    ? or(ne(t.keyVersion, current), isNotNull(t.plain.column))
    : ne(t.keyVersion, current);

  const rows = (await db.select(cols).from(t.table).where(pending)) as Row[];

  for (const row of rows) {
    const from = Number(row.key_version);
    const update: Record<string, unknown> = {};
    let failed: "key_unavailable" | "decrypt_failed" | null = null;

    // Los secretos cifrados: se abren con SU versión y se cierran con la actual.
    for (const s of t.secrets) {
      const cipher = row[columnKey(s.cipher)] as string | null;
      const iv = row[columnKey(s.iv)] as string | null;
      const tag = row[columnKey(s.tag)] as string | null;
      if (!cipher || !iv || !tag) continue; // secreto opcional vacío
      if (from === current) continue; // solo cambia el texto en claro (abajo)
      const opened = open(cipher, iv, tag, from);
      if (!opened.ok) {
        failed = opened.error;
        break;
      }
      const sealed = seal(opened.value);
      const check = open(sealed.cipher, sealed.iv, sealed.tag, sealed.keyVersion);
      if (!check.ok || check.value !== opened.value) {
        throw new Error(`${t.name}: lo re-cifrado no se descifra igual; no se escribe nada`);
      }
      update[s.cipher.name] = sealed.cipher;
      update[s.iv.name] = sealed.iv;
      update[s.tag.name] = sealed.tag;
    }
    if (failed) {
      if (failed === "key_unavailable") report.keyUnavailable++;
      else report.decryptFailed++;
      continue;
    }

    // El secreto en claro de Zernio: se cifra con la actual y se borra.
    let sealedPlain = false;
    if (t.plain) {
      const plain = row[columnKey(t.plain.column)] as string | null;
      if (plain) {
        const sealed = seal(plain);
        update[t.plain.to.cipher.name] = sealed.cipher;
        update[t.plain.to.iv.name] = sealed.iv;
        update[t.plain.to.tag.name] = sealed.tag;
        update[t.plain.column.name] = null;
        sealedPlain = true;
      }
    }

    // Toda la fila queda en la versión actual: un solo `key_version` por fila.
    // Si hay un secreto en claro en una fila de OTRA versión, los cifrados ya
    // se re-cifraron arriba; si no, la fila ya estaba en la actual.
    const set: Record<string, unknown> = { [t.keyVersion.name]: current };
    for (const [k, v] of Object.entries(update)) set[k] = v;

    const done = await db
      .update(t.table)
      .set(toProps(t.table, set))
      .where(and(eq(t.id, row.id as string), eq(t.keyVersion, from)))
      .returning({ id: t.id });
    if (done.length === 0) continue; // otro la cambió mientras tanto: la verá el próximo arranque
    if (from !== current) report.rotated++;
    if (sealedPlain) report.sealedPlain++;
  }

  const versions = (await db
    .select({ v: t.keyVersion, n: sql<number>`count(*)::int` })
    .from(t.table)
    .groupBy(t.keyVersion)) as { v: number; n: number }[];
  for (const { v, n } of versions) report.byVersion[v] = n;
  return report;
}

/** drizzle `.set()` recibe propiedades del modelo, no nombres de columna SQL. */
function toProps(table: PgTable, byColumn: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    if (col.name in byColumn) out[prop] = byColumn[col.name];
  }
  return out;
}

/**
 * Corre el mantenimiento. Devuelve el reporte por tabla, o `null` si otro
 * proceso tiene el candado (lo hace él).
 */
export async function runCredentialMaintenance(): Promise<TableReport[] | null> {
  const current = currentKeyVersion();
  const db = sys();
  return db.transaction(async (tx) => {
    // Candado de TRANSACCIÓN: se suelta solo al terminar, aunque algo lance.
    const [lock] = (await tx.execute(sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as ok`)) as unknown as { ok: boolean }[];
    if (!lock?.ok) return null;
    const reports: TableReport[] = [];
    for (const t of targets()) reports.push(await processTable(t, current));
    return reports;
  });
}

/** Al arrancar: corre y deja el resumen en el log. Nunca lanza. */
export async function credentialMaintenanceOnBoot(): Promise<void> {
  try {
    const reports = await runCredentialMaintenance();
    if (!reports) {
      log.info("mantenimiento de credenciales: otro proceso lo está haciendo; se omite aquí");
      return;
    }
    const current = currentKeyVersion();
    for (const r of reports) {
      const total = Object.values(r.byVersion).reduce((a, b) => a + b, 0);
      if (total === 0 && r.rotated === 0) continue;
      const versiones = Object.entries(r.byVersion)
        .map(([v, n]) => `versión ${v}: ${n}`)
        .join(", ");
      const linea = `${r.table}: ${total} fila(s) (${versiones}) · ${r.rotated} re-cifrada(s) a la versión ${current} · ${r.sealedPlain} secreto(s) en claro cifrado(s) · ${r.keyUnavailable} sin llave · ${r.decryptFailed} que no descifran`;
      if (r.keyUnavailable > 0 || r.decryptFailed > 0) log.error(linea);
      else log.info(linea);
    }
    const pendientes = reports.reduce((a, r) => a + r.keyUnavailable + r.decryptFailed, 0);
    log.info(`mantenimiento de credenciales: llave actual versión ${current}; ${pendientes} fila(s) con llaves no disponibles`);
  } catch (err) {
    log.error("el mantenimiento de credenciales falló; la app sigue y lo reintenta en el próximo arranque", { err });
  }
}
