/**
 * Excepciones justificadas del guardarraíl `tenant-query-guard.test.ts`:
 * consultas a tablas de dominio SIN `scoped()` en la misma sentencia.
 *
 * `max` es exacto (ni una de holgura). Cada motivo dice por qué hoy es seguro;
 * casi todas son "por id interno ya resuelto dentro de la organización": el id
 * no llega del usuario sin validarse antes contra su organización. En el PR 3
 * de la Fase 1 esas rutas corren dentro de `withTenant(org)` y en el PR 4 RLS
 * las acota en la BD aunque el id viniera de otra organización.
 *
 * Solo el ruteo de webhooks y el arranque son GLOBALES a propósito: ahí la
 * organización todavía no se conoce.
 */
export const TENANT_QUERY_EXCEPTIONS: Record<string, { max: number; motivo: string }> = {
  // --- Globales a propósito: aún no hay organización -------------------------
  "server/credentials/resolve.ts": {
    max: 10,
    motivo:
      "Fase 3, PR 1 — Ruteo de webhooks: phone_number_id / waba_id (únicos), IG_ID, página y cuenta de Zernio → organización (DESCUBRE la organización, sin descifrar tokens); H25: ¿ese número o WABA ya son de OTRA organización? (excluye la propia por id).",
  },
  "server/platform-admin/organizations.ts": {
    max: 6,
    motivo:
      "Fase 3, PR 2 — El administrador de plataforma gestiona organizaciones (está POR ENCIMA de ellas): cuántas personas tiene cada una, sus Propietarios, si tiene WhatsApp conectado, sus miembros (nombre, correo, rol) y cerrar sus sesiones al suspender. Solo metadatos, nunca contenido; detrás de withPlatformAdmin (404 a todos los demás) y con el pool de sistema.",
  },
  "server/meta-sync/daily.ts": {
    max: 2,
    motivo:
      "Campañas v2 — Sincronización diaria con Meta: lista las organizaciones ACTIVAS con número conectado y sin la lectura de hoy (salud) o sin el intento de hoy de las analíticas (PR 3); cruza organizaciones a propósito, pool de sistema. El trabajo de cada una corre después a nombre de la suya.",
  },
  "server/modules/store.ts": {
    max: 1,
    motivo:
      "Fase 3, PR 3 — Relleno al arrancar: a TODA organización sin fila de módulos le pone los de las variables de entorno (insert … select de organization where not exists). Pool de sistema, una vez por arranque, nunca pisa una fila existente.",
  },
  "server/platform-admin/links.ts": {
    max: 1,
    motivo:
      "Fase 3, PR 2 — Al usar un enlace de un solo uso: de qué organización es la persona (para la bitácora y el aviso). Aún no hay sesión; el usuario lo dice el token.",
  },
  "server/instagram/credentials.ts": {
    max: 1,
    motivo:
      "Un update por el id de la fila recién leída (con scoped) de la propia organización.",
  },
  "server/messenger/credentials.ts": {
    max: 1,
    motivo:
      "Un update por el id de la fila recién leída (con scoped) de la propia organización.",
  },
  "server/bot/keys.ts": {
    max: 5,
    motivo:
      "Ruteo del cerebro externo: el hash de la llave (único) DESCUBRE la organización; y el arranque liga la BOT_API_KEY a PLATFORM_ORG_ID (filas source='env', de la plataforma).",
  },
  "server/auth/on-signup.ts": {
    max: 1,
    motivo:
      "resolveMembership: la membresía del usuario de la sesión se busca por user_id antes de conocer su organización (es lo que la determina, H4).",
  },
  "instrumentation-node.ts": {
    max: 1,
    motivo:
      "Arranque (cleanupOrphanRuns): marca como fallidas las corridas del Laboratorio que quedaron 'running' en TODAS las organizaciones; una réplica (H24).",
  },
  "server/kb-docs/store.ts": {
    max: 1,
    motivo:
      "035 — Al arrancar (documentsToResume): ids de los documentos del agente por (re)indexar en TODAS las organizaciones, pool de sistema. El indexado de cada uno corre luego a nombre de la suya con scoped().",
  },
  "server/usage/storage.ts": {
    max: 5,
    motivo:
      "036 PR 2 — getAllOrgsStorageUsage: el administrador de plataforma ve el almacenamiento (aprox.) de TODAS las organizaciones, una suma agrupada por organization_id en cada tabla de archivos (media_asset, knowledge_entry, team_chat_attachment, kb_document, kb_chunk). Pool de sistema; solo totales, nunca contenido. La de UNA organización (getOrgStorageUsage) sí va con scoped().",
  },
  "server/campaigns/dispatcher.ts": {
    max: 1,
    motivo:
      "Campañas v2: el programador (campaignSchedulerTick) lista las organizaciones con campañas enviando, programadas o con pausa por límite vencida, en TODAS las organizaciones (pool de sistema); el trabajo de cada una corre luego a nombre de la suya con scoped().",
  },
  "app/api/dev/wa-mock/status/route.ts": {
    max: 1,
    motivo:
      "Mock de desarrollo (404 en producción por dev-guard): busca el mensaje por wa_message_id, que es UNIQUE global, para simular el acuse de Meta.",
  },

  // --- Constructores de consulta: el llamador agrega scoped() ----------------
  "server/agenda/queries.ts": {
    max: 1,
    motivo:
      "baseQuery() devuelve el select sin where; todos sus llamadores le agregan scoped(schema.booking.organizationId, …).",
  },
  "server/team-chat/messages.ts": {
    max: 1,
    motivo:
      "selectMessages() devuelve el select sin where; todos sus llamadores le agregan scoped(schema.teamChatMessage.organizationId, …).",
  },
  "server/analytics/bot.ts": {
    max: 2,
    motivo:
      "El where es cohorte(), que devuelve scopedContacts(conversation.organizationId, …): el detector no ve dentro de la función.",
  },
  "server/bot/ficha.ts": {
    max: 2,
    motivo:
      "El where es la variable `alcance`, construida arriba con scoped(contact.organizationId, …, eq(contact.id)).",
  },

  // --- Por id interno ya resuelto dentro de la organización -------------------
  "server/ai/pipeline.ts": {
    max: 4,
    motivo:
      "Turno del agente: carga la conversación por id (lo encoló la ingesta de esa organización) y DERIVA la organización de la fila; lo demás va por ese id.",
  },
  "server/lab/runner.ts": {
    max: 9,
    motivo:
      "Laboratorio: corre sobre la corrida/casos/conversaciones de prueba que el propio runner creó con la organización del Propietario que la lanzó.",
  },
  "server/inbox/ingest.ts": {
    max: 5,
    motivo:
      "Ingesta: updates por el id de la conversación/mensaje que la misma ingesta acaba de leer o crear con la organización ruteada.",
  },
  "server/inbox/identity.ts": {
    max: 2,
    motivo:
      "Updates por el id del contacto que se acaba de leer con scoped() en la misma función.",
  },
  "server/inbox/send.ts": {
    max: 3,
    motivo:
      "El envío lee la conversación por id y COMPARA su organización con la del llamador antes de seguir; los updates van por ese id.",
  },
  "server/inbox/lead-activity.ts": {
    max: 1,
    motivo:
      "Update del lead por el id que se acaba de leer con scoped() en la misma función.",
  },
  "server/inbox/handoff-notice.ts": {
    max: 1,
    motivo:
      "Conversación por el id que le pasa el handoff (ya validado en la organización del turno) para avisar al asignado.",
  },
  "server/agenda/service.ts": {
    max: 4,
    motivo:
      "Updates de la cita por el id de la fila leída antes con scoped() en la misma operación.",
  },
  "server/attribution/conversions.ts": {
    max: 3,
    motivo:
      "Updates del evento de conversión por el id de la fila que la función acaba de insertar para su organización.",
  },
  "server/attribution/creativo.ts": {
    max: 3,
    motivo:
      "Update/borrado del media_asset del creativo por el id que la función acaba de insertar para su organización.",
  },
  "server/whatsapp/media.ts": {
    max: 3,
    motivo:
      "Descarga de adjuntos: lee/actualiza el media_asset por el id que la ingesta creó con la organización ruteada.",
  },
  "server/whatsapp/templates.ts": {
    max: 1,
    motivo:
      "Update de la conversación por el id validado por el envío (leída antes con scoped()).",
  },
  "server/campaigns/service.ts": {
    max: 1,
    motivo:
      "Conteo de destinatarios por campaign_id de campañas que se acaban de listar con scoped() de la organización.",
  },
  "app/api/bot/handoff/route.ts": {
    max: 1,
    motivo:
      "Update por el id de la conversación leída con scoped() de la organización de la llave del cerebro externo.",
  },
  "app/api/bot/reset/route.ts": {
    max: 1,
    motivo:
      "Update por el id de la conversación leída con scoped() de la organización de la llave del cerebro externo.",
  },
};
