# I1 · Diagnóstico del CRM y posibilidades de integración

## Alcance y procedencia

**Confirmado mediante código**, no mediante acceso a producción. Backend auditado: `origin/main` en `834806ec8616375fd8acb7961ac0d830ac9d0066`, descargado solo con fetch y leído en una copia temporal. No se cambió main, el checkout web/backend, una BD o configuración de infraestructura. La rama móvil sigue basada en T-M5B, no se fusionó main. Existen 463 archivos `src` distintos entre la base móvil histórica y este main: no se usó la copia antigua como si fuera el backend actual.

Código de la APK 0.1.2: `d3bd5825b529e4da14189210b25919ac1f42207f`. Checkpoint de documentación: `2bd4b626dddd9310791aaeb05e4eab0f5d4e93cf`. Ambos se conservan bajo `codex/dashfort-mobile-tm5b-20261114`. `git ls-remote` confirma T-M5A `3b85b3b`; no devuelve una rama remota T-M5B. El binario se conserva y se entregó privadamente en Drive; eso no equivale a respaldo Git de sus fuentes. SHA-256 APK: `36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a`.

**No verificado:** qué commit está ejecutando actualmente dash.demfort.com, configuración viva de cookies/proxy, réplicas, roles/RLS de la BD instalada, configuración actual de Coolify, accesos/instalaciones externas y funcionamiento Android/iOS real de autenticación o push. No se visitó la aplicación productiva ni se usaron credenciales reales.

## Tecnologías verificadas

| Componente | Declarado / resuelto en referencia auditada |
|---|---|
| CRM | vocero-crm 1.4.0; Next.js ^15.5.27 → **15.5.28**, React ^19.0.0 → **19.2.7** |
| Autenticación | Better Auth ^1.7.19 → **1.7.19**, adaptador Drizzle/PostgreSQL |
| Datos | drizzle-orm ^0.45.2 → **0.45.3**, postgres ^3.4.5 → **3.4.9** |
| Herramientas web | pnpm 11.5.0, Node >=20 declarado, TypeScript **5.9.3** resuelto |
| Mobile | Expo **58.0.25**, RN **0.88.1**, React **19.3.0**, expo-notifications **58.1.9**, TS **6.0.3** (lockfile móvil) |

Fuentes: package.json y pnpm-lock.yaml del commit auditado; apps/mobile/package-lock.json del checkpoint. No se deducen versiones desplegadas de estos archivos.

## Hallazgos determinantes

1. **Se puede reutilizar el dominio y gran parte de las APIs JSON**, previa autenticación compatible. No hace falta duplicar CRM, BD ni infraestructura. Los Route Handlers Next se ejecutan en el servidor; React Native no debe importar servicios server-side, SQL, `next/headers` o el cliente React de Better Auth.
2. **Las rutas CRM normales usan sesión Better Auth, no un bearer móvil existente.** `withAuth` resuelve sesión, permisos, organización y contexto de consulta. La expiración configurada es 30 días, con actualización diaria. No se encontró un endpoint móvil independiente de refresh ni debe inventarse uno como disponible.
3. **El cambio de organización NO está disponible simplemente por instalar organizationClient.** Todas las rutas `/api/auth/organization/*` están bloqueadas expresamente. El servidor elige la membresía más antigua al crear sesión; valida la activa y puede caer a otra membresía si ya no es válida. Hoy el modelo de uso documenta una organización por usuario. Mobile debe detectar cualquier cambio devuelto por autoridad, limpiar su ámbito y exigir revalidación; nunca enviar un header de organización y confiar en él.
4. **OAuth existente no es la solución automática para Mobile.** `/api/oauth/{authorize,token,register,revoke}` y PKCE/rotación pertenecen al conector IA cuyo recurso es `/api/mcp`. `requireMcpToken` valida alcances, módulo y rol del conector. No convierte esa llave en sesión para `/api/conversations`; no se reutilizarán llaves bot/MCP como credenciales de usuario móvil.
5. **SSE es efímero.** EventEmitter en memoria por organización, sin replay persistente ni cursor durable; `id: Date.now()` no es identificador estable, exclusivo ni posición recuperable. Reinicio, otra réplica, pérdida de conexión o transición inicial pueden perder eventos. SSE debe invalidar/refrescar datos; no es la fuente de verdad ni un sistema push de segundo plano.
6. **Bandeja sí tiene paginación por cursor.** GET conversations con limit 1…500 (recomendado 50), filtros q/status/stage/tag/assigned/channel/number y nextCursor. Sin limit devuelve toda la lista. `ids`/`contactIds` permiten refresco de subconjunto; lo ausente puede significar pérdida de visibilidad o salida del filtro, no necesariamente borrado. El orden por último mensaje es mutable: deduplicar por ID y refrescar la cabeza; un cursor de lista no acredita snapshot transaccional ni feed de cambios.
7. **Historial no está paginado en la API actual.** GET messages devuelve todo o `createdAt > since`, ascendente. No hay before/limit/cursor de historial. Su DTO muestra `waTimestamp ?? createdAt`; no puede usarse esa fecha presentada como watermark exacto del filtro BD. El mensaje no expone revisión de actualización; cambios de estado de mensajes antiguos no se recuperan con since de creación.
8. **Idempotencia entrante no equivale a idempotencia de envío móvil.** Hay unicidad wa_message_id y transacción mensaje+conversación; POST texto no acepta clave de operación del cliente. Una petición repetida puede reservar y enviar otro mensaje. El servicio evita repetir automáticamente ante respuesta incierta de Meta y contempla textos divididos. Tras timeout móvil: estado incierto y reconciliación, nunca reenvío automático.
9. **Sí existe recepción durable de webhooks.** `src/server/webhooks/inbox.ts` guarda payload cifrado antes de confirmar, reintenta con backoff y deduplica. Se reutiliza esta base operativa. Sus filas se borran al procesar: NO son un changelog para Mobile ni un outbox push. Campañas también tienen su propio estado/worker; no implica un servicio push móvil listo.
10. **No se observan rutas de registro de dispositivos/tokens push ni feed durable móvil** en el inventario auditado. La solución T-M5A/B sigue siendo simulación/locales. Cualquier nuevo outbox, registro de instalaciones, credenciales o proveedor remoto requiere una etapa y autorización separadas.

## Seguridad y organización

`src/lib/auth/session.ts` relee membresía vigente, suspensión y delegaciones. Roles backend: **owner / coordinador / asesor**, frente a **owner / coordinator / advisor** en la demo móvil: el mapeo debe ser explícito y fallar ante roles desconocidos. `withAuth` puede exigir permisos por operación; además las consultas restringen registros por organización, asignación, participantes y chatView. `scope.all` no debe usarse como permiso universal: chat de equipo y «Mi número» tienen audiencias separadas; contactos privados se excluyen del CRM común.

`src/lib/db/tenant.ts`, request-context y pools de BD aplican ámbito; las migraciones contienen ENABLE/FORCE RLS y claves compuestas de organización. Esto confirma el diseño del código, no que la BD productiva haya aplicado las migraciones ni que use los roles correctos. El cliente nunca reemplaza esa validación.

SSE revalida sesión/membresía aproximadamente cada 60 s, heartbeat 25 s. Ante error de BD la revalidación registra fallo y reintenta; no se cierra inmediatamente. Existe una ventana de revocación, y los filtros de visibilidad dependen del acceso vigente en el stream. En móvil futuro no mostrar contenido sensible de un evento sin reconsulta si la sesión/ámbito está pendiente o cambió. Un 403/404 obliga a invalidar datos; 404 no distingue ajeno de inexistente.

La API devuelve `{error:{code,message}}` en rutas normales; Better Auth y OAuth tienen formatos propios, no un decoder universal. 409 window_closed/no conexión, 422 validación/Meta, 429 límites, 503 indisponibilidad y errores de red tienen tratamiento distinto. No registrar cuerpos de mensajes, cookies, enlaces de recuperación, números o credenciales en telemetría.

## Flujos funcionales confirmados

- **Entrante:** webhook WhatsApp/directo → guardado durable → identidad/contacto/conversación → transacción mensaje+chat y dedup → publicación SSE; estados pasan por `status.ts`, con transiciones monotónicas que permiten failed → delivered/read sin retroceder a sent. Instagram/Messenger tienen rutas de webhook propias; no se extrapola la misma durabilidad sin revisar su ruta concreta.
- **Saliente:** ruta authenticated + conversación visible → validación Zod → ventana/canal/credenciales/límites → reserva de mensaje → Meta u otra vía habilitada → confirmación o estado incierto → SSE. Plantilla/medio/ubicación/contactos tienen contratos separados. No se invocó ninguno.
- **Contactos:** GET/PATCH, notas, etiquetas, participantes e historial con alcance; lead/etapa se editan por pipeline y asignación por su servicio. Campos financieros en centavos; no mezclar con la representación monetaria de la demo.
- **Adjuntos:** multipart con límites y tipos; descarga privada GET media por alcance y 410 si expiró. Una lectura puede descargar de Meta bajo demanda. GET contacto puede disparar reparación de imagen de anuncio. Por eso ni siquiera se hicieron GET autenticados contra producción durante la auditoría. En Mobile una URI de imagen no hereda necesariamente la cookie de fetch: diseñar descarga autenticada y caché privada purgable, sin URL pública inventada.
- **Preferencias:** `/api/preferences` guarda navegación por usuario/organización; apariencia de organización tiene otra ruta y permiso. Algunas preferencias personales viven en cookie del navegador. No sobrescribir el diseño aprobado móvil con la apariencia web por defecto.
- **IA:** perfil/agentes/Laboratorio, redacción y asistente usan módulos y permisos; pueden consumir proveedores externos. No se probaron ni se simula que estén gratis. Primero lectura y contratos, luego acciones autorizadas.

## Inventario y alcance de sus conclusiones

[api-inventory.csv](api-inventory.csv) enumera las 262 rutas del commit auditado, métodos exportados, marcadores de autenticación y permisos encontrados **a nivel de archivo**, ruta fuente y SHA-256. La extracción no atribuye todos los permisos del archivo a cada verbo ni demuestra ausencia de permisos cuando la celda está vacía: puede haber validación en servicios/helpers. Las rutas dinámicas Better Auth se documentan por su biblioteca/configuración; el CSV muestra su catch-all. No es un catálogo de operaciones habilitadas para Mobile: webhooks, bot, plataforma, OAuth, mocks y envíos quedan fuera hasta autorización específica.

[MODULOS.md](MODULOS.md) interpreta los módulos y [ARQUITECTURA.md](ARQUITECTURA.md) describe la solución propuesta. No se inventaron endpoints HTTP para cursores durables, idempotencia, refresh móvil o registro push: esas capacidades se etiquetan como propuestas y se ejercitan solo en memoria.
