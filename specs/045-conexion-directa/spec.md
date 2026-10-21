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

## Siguientes PRs

2. Vincular por QR (pantalla de servidores en /platform, Ajustes › WhatsApp,
   webhook de estado, revisión cada 5 min). 3. Envío directo (nueva vía en
   `send.ts`, fila con límites, freno de emergencia). 4. Unir ecos de Meta.
   5. Modos y pantalla. 6. Organización sin Meta.
