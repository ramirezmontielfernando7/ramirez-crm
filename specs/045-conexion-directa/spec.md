# 045 — Conexión directa (dispositivo vinculado)

Plan completo y decisiones de Fer (21 oct 2026): documento «Modo no oficial de
WhatsApp en el chat (plan)» del proyecto. En pantalla nunca se dice «no
oficial»: se dice «Conexión directa» y «Dispositivo vinculado».

Un complemento OCULTO por organización que permite contestar un chat de
WhatsApp por un dispositivo vinculado (servidor propio) además de la API de
Meta, en el mismo hilo. Tres modos por chat: Meta (verde), Directa (azul) y
Automática (morado = Directa con «Recibir por Meta»). La IA y las campañas
nunca usan la conexión directa (salvo IA en organizaciones sin Meta, si la
plataforma lo enciende, PR 6).

## PR 1 — Módulo y datos (este PR; nada visible para las organizaciones)

- `organization_module.conexion_directa` (DEFAULT false). Interruptor en
  /platform → «Complementos ocultos». No es uno de los 13 ni cuenta para el
  plan. Sin él: `conexionDirectaOff(org)` = 404 y sin delegaciones.
- Migración `0055_conexion_directa` (aditiva, idempotente; reversa opcional en
  `scripts/sql/0055-reversa.sql`):
  - `evolution_server` (plataforma, solo pool de sistema, llave cifrada).
  - `direct_connection` (una por organización por ahora; llave de instancia
    cifrada; hash del token del webhook; estado; freno de emergencia).
  - `direct_connection_settings` (modo por defecto, límites 8 s / 5 por
    minuto por chat / 60 por hora, ventana, regreso automático, IA, permisos
    delegados, aviso aceptado).
  - `conversation.connection_mode` (+ `connection_mode_changed_at`),
    `message.transport` / `alt_message_id` / `queued_until`, `contact.wa_lid`.
- Credenciales: `src/server/credentials/direct.ts` (cifra con ENCRYPTION_KEY,
  rota con `maintenance.ts`, solo últimos 4 hacia afuera).
- Permisos `direct_connection.mode|link|limits`: del Propietario; delegables a
  Coordinador y Asesor por organización (`*_roles`). De fábrica el Coordinador
  cambia el modo.
- API de plataforma: `GET/POST /api/platform/direct-servers`,
  `PATCH/DELETE /api/platform/direct-servers/[id]` (404 a todos los demás).
- Reglas puras y textos discretos: `src/lib/direct-connection.ts`.

## PR 2 — Vincular por QR

- /platform → «Conexión directa»: registrar servidores (llave cifrada, solo
  últimos 4), probar, capacidad y estado; en la ficha de cada empresa con el
  complemento, elegir su servidor (sin elegir, el que tenga más lugar).
- Ajustes → «Conexión directa» (solo con el complemento y el permiso
  `direct_connection.link`; si no, 404/sin pestaña): vincular por QR, estado,
  reconectar, desvincular. Dashfort crea la instancia y su webhook
  (`src/server/direct-connection/link.ts`, cliente en `evolution-api.ts`).
- Webhook de estado `POST /api/webhooks/direct/[token]` (token por empresa,
  solo su hash en la base) y revisión cada 5 min. Dos desconexiones en 24 h
  pausan la conexión directa 24 h. Aviso discreto en la app si se desconecta.
- Sin migración nueva.

## PR 3 — Envío directo (sin migración)

- Por dónde sale (`routeFor`, `src/lib/direct-send.ts`): SOLO un envío de una
  persona desde la Bandeja (`allowDirect` en las rutas de texto y de
  archivos) en un chat Directa o Automática sale por el dispositivo. Meta,
  como siempre, si: no hay módulo, el chat (o la organización) está en Meta,
  nunca se vinculó un dispositivo, o «Usar Meta mientras la ventana esté
  abierta» (de fábrica) y la ventana está abierta. La IA (`aiGenerated`), las
  campañas, las plantillas, el cerebro externo y las bajas automáticas nunca
  (guardarraíl `tests/unit/conexion-directa-envio.test.ts`).
- En pausa o desconectado: falla con el texto discreto, sin caer a Meta.
- `src/server/inbox/send.ts` solo decide la vía; el envío vive en
  `src/server/direct-connection/send.ts`: bajo el candado de la
  organización calcula la hora de salida (`nextSlot`: 1 cada 8 s, 5 por
  minuto por chat, 60 por hora; editables en
  `GET/PUT /api/settings/direct-connection/limits`, permiso
  `direct_connection.limits`), guarda el mensaje (`transport = 'directa'`) y,
  si le toca después, lo deja «En cola» (`queued_until`) con un timer. Al
  arrancar se retoma la fila; lo que un reinicio dejó a medias se da por
  fallido sin reenviar.
- «escribiendo…» de 1 a 3 s antes de cada mensaje (`chat/sendPresence`).
- Bien: `sent` y el ID del dispositivo en `alt_message_id`. Mal: el texto no
  se queda en el hilo (como por Meta); el archivo queda `failed`.
- Freno de emergencia (`brake.ts`): 2 fallos del dispositivo en 24 h (o uno
  que parece bloqueo) → `paused_until` = +24 h. Mismas columnas y regla que
  las desconexiones del PR 2. Un número sin WhatsApp o un archivo rechazado
  no cuentan.
- Cliente de mensajes: `src/lib/evolution/client.ts` (texto, archivo, audio
  como nota de voz, «escribiendo…»). Llave: la de la instancia
  (`src/server/credentials/direct-instance.ts`).
- Gancho para el PR 4: el eco de Meta de lo enviado llega con otro
  `wa_message_id` y por ahora se ve también como «Celular»; el PR 4 lo une
  por `alt_message_id`.
- Fuera de este PR: cambiar el modo de un chat (PR 5), la marca «Directo» y
  «En cola» en la burbuja (PR 5), Conocimientos por la directa.

## PR 4 — Unir ecos de Meta y palomitas (sin migración)

- Lo que sale por la directa regresa de Meta como eco (`smb_message_echoes`)
  con otro `wa_message_id`. Fase 0 (Evolution 2.3.7, 3 de 3): ese
  `wamid` decodificado termina con el `key.id` del dispositivo. La unión es
  EXACTA por ese ID (`directIdFromWamid`, `src/lib/direct-echo.ts`) contra
  `alt_message_id`; texto y hora solo de respaldo.
- `src/server/direct-connection/echo.ts` (`joinDirectEcho`, llamado por
  `ingestManualEcho` ANTES de registrar el eco): unido = sin otra burbuja, sin
  lead y sin pausar la IA; la fila del envío se queda con el `wa_message_id`
  del eco (un reintento de Meta no hace nada).
- Orden: si el eco llega antes de que el dispositivo conteste, espera a que
  termine ese envío del mismo chat (máx. 30 s) y vuelve a buscar por ID.
- Respaldo (`pickEchoFallback`): ID ilegible, o envío que se agotó sin saber
  su ID: mismo chat, tipo y texto, a menos de 2 min; nunca contradice al ID.
  Un envío «no se sabe si salió» pasa a «enviado» con su eco.
- Lo escrito en el celular entra como siempre y guarda el ID del dispositivo
  en `alt_message_id` (para sus palomitas). Sin el complemento, nada cambia.
- Palomitas: el webhook del dispositivo pide también `MESSAGES_UPDATE`;
  `POST /api/webhooks/direct/[token]` las aplica por `alt_message_id`
  (`src/server/direct-connection/status.ts`) con las reglas de Meta
  (`ALLOWED_FROM`: nunca retrocede). Una instancia vinculada antes se pone al
  día en la revisión de 5 min (`ensureWebhookEvents`, token nuevo).

## PR 6 — Empresa sin Meta (sin migración)

- «Sin Meta» no es un ajuste: es una empresa con el complemento y SIN número
  de WhatsApp de Meta guardado (`isOrgWithoutMeta`,
  `src/server/direct-connection/without-meta.ts`; la existencia de la fila la
  dice `orgHasWhatsAppConnection` en `src/server/credentials/`, sin abrir
  secretos). Si conecta Meta, vuelve a ser una empresa normal.
- ENTRADA: el webhook del dispositivo pide también `MESSAGES_UPSERT` (las
  instancias viejas se ponen al día en la revisión de 5 min). Lectura pura en
  `src/lib/direct-inbound.ts` (`parseDeviceMessages`: solo chats uno a uno;
  texto, archivos, ubicación, contactos y respuestas a botones; teléfono
  `521…` → `52…`; `@lid` con su teléfono alterno o, si no viene, el del
  contacto que ya lo tenía). Registro en
  `src/server/direct-connection/inbound.ts` con la ingesta de siempre (lead,
  no leídos, bajas, IA). `wa_message_id` = `direct.<key.id>` (idempotente),
  `transport = 'directa'`, `alt_message_id` = `key.id`; el `@lid` se guarda
  en `contact.wa_lid`. Con Meta el aviso se ignora (ya entra por Meta).
- Lo que manda el negocio (`fromMe`): la copia de un envío de Dashfort se une
  por ID (`joinDirectEcho` con `directId`); lo escrito en el celular entra
  como «Celular» y pausa la IA (`ingestDeviceEcho`).
- Archivos: `wa_media_id` = `direct:<key.id>`; `ensureAssetAvailable` los
  descarga del dispositivo (`inbound-media.ts` →
  `chat/getBase64FromMediaMessage`), no de Meta.
- SALIDA (`routeFor` con `hasMeta: false`): todo chat es Directa, sin
  ventana de 24 h; una persona desde la Bandeja sale por el dispositivo; sin
  dispositivo, falla claro (no hay Meta a dónde caer). La IA solo con «IA
  por conexión directa» (`ai_via_direct`, /platform → ficha de la empresa,
  apagado de fábrica); con Meta la IA sale siempre por Meta. Campañas,
  plantillas, cerebro externo, bajas automáticas y Conocimientos siguen sin
  conocer la vía directa (en una empresa sin Meta fallan como hoy).
- Pantalla: sin punto de color ni selector de modo; Avanzado solo muestra
  los límites. El compositor deja escribir con la ventana cerrada cuando el
  mensaje sale por el dispositivo (empresa sin Meta, o chat Directa/
  Automática con el dispositivo listo; `freeTextOutsideWindow`).
- Fuera de este PR: entrar por el dispositivo en una empresa CON Meta (modo
  Directa sin «Recibir por Meta»), marcar como leído en el celular del
  contacto, grupos, varios números por empresa.
