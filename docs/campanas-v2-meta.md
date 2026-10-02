# Campañas v2 — Datos de la API oficial de Meta

Qué usa Vocero de la WhatsApp Cloud API y la Business Management API para
Campañas v2, en qué PR, y **qué NO está verificado** contra la documentación
oficial.

> **Estado de la verificación (2026-10-02).** El proxy del entorno donde se
> construyó esto bloquea `developers.facebook.com` (`EGRESS_BLOCKED`), así
> que **ningún punto de esta página se leyó en la documentación oficial**.
> Todo sale de resultados de búsqueda que citan las páginas de Meta y de
> documentación de terceros (ver "Fuentes"). Cada punto marcado
> **NO VERIFICADO** se confirma antes de fusionar el PR 1 con la lista de
> "Qué confirmar a mano", al final.

## Tabla de endpoints

| Endpoint / webhook | Qué devuelve (lo que lee Vocero) | Permiso | Límites | PR |
|---|---|---|---|---|
| Webhook `messages` → `statuses[]` | `id`, `status` (sent, delivered, read, failed), `timestamp` (segundos Unix), `recipient_id`, `errors[]` (`code`, `title`, `message`, `error_data.details`), `pricing` {`billable`, `pricing_model` "PMP", `category`, `type`} | `whatsapp_business_messaging` | — | 1 |
| Webhook `message_template_status_update` | `event` (APPROVED, REJECTED, PAUSED, DISABLED, IN_APPEAL…), `reason`, `message_template_id`, nombre, idioma | `whatsapp_business_management` | — | 1 |
| Webhook `template_category_update` | Dos avisos: **cambio hecho** (`previous_category` + `new_category` = la nueva real) y **cambio próximo** (`correct_category` = la que tendrá, `new_category` = la ACTUAL, `category_update_timestamp`). Más `message_template_id`, nombre, idioma. No existe `old_category` | management | — | 1 |
| Webhook `phone_number_quality_update` | `display_phone_number`, `event` (UPGRADE, DOWNGRADE, FLAGGED…), `current_limit` | management | — | 1 |
| Webhook `account_update` | `event` (ACCOUNT_VIOLATION, ACCOUNT_RESTRICTION…), `violation_info` / `restriction_info` | management | — | 1 (alerta), 2 (pausa) |
| `GET {waba}/message_templates?fields=…&limit=…&after=…` | `id`, `name`, `language`, `status`, `category`, `components`, `quality_score`, `rejected_reason`; paginado con `paging.cursors.after` / `paging.next` | management | Rate limit de Business Management (por app y WABA) | 1 |
| `POST {waba}/message_templates` | Alta y envío a revisión: `{id, status, category}` | management | Tope de creaciones por hora por WABA | 1 |
| `POST {app-id}/uploads?file_length&file_type` → `POST {upload-id}` (cabecera `file_offset: 0`, `Authorization: OAuth …`) | `{id: "upload:…"}` y luego `{h}` = `header_handle` del ejemplo de imagen | token del sistema + **`META_APP_ID`** | — | 1 |
| `GET {phone-number-id}?fields=quality_rating,status,throughput,name_status,messaging_limit_tier,whatsapp_business_manager_messaging_limit` | calidad (GREEN, YELLOW, RED, UNKNOWN; `NA` es sinónimo de UNKNOWN), estado, rendimiento, estado del nombre y límite (TIER_250…UNLIMITED). Si Meta rechaza un campo (código 100), Vocero reintenta con `quality_rating,status,name_status,messaging_limit_tier` | management | — | 1 |
| `POST {phone-number-id}/media` | `id` del archivo (la imagen del encabezado al ENVIAR la plantilla) | messaging | — | 1 |
| `GET {waba}?fields=template_analytics…` | enviados, entregados, leídos y clics de botón por plantilla y día; **retención 90 días** | management | Puede requerir activar las analíticas de plantillas en la WABA | 3 |
| `GET {waba}?fields=pricing_analytics…` | volumen y costo por día, país, categoría y tipo; **retención 1 año** (desde el 1-dic-2025; antes 10 años) | management | — | 3 |
| `conversation_analytics` | Sigue existiendo, pero describe el cobro por conversación, reemplazado por el cobro por mensaje el 1-jul-2025 | — | — | **No se usa** |
| Error **131049** | Meta no entregó un mensaje de marketing para "cuidar el ecosistema" (límite de marketing por usuario, sumando a todas las empresas). Reintentar antes de 24 h no sirve | — | aprox. 2 plantillas de marketing por usuario al día; utility y authentication exentas (las cifras NO se usan en el código) | 1 (traducción), 2 (no reintentar), 3 (motivo) |

## Decisiones que salen de esta tabla

- **El límite de mensajería es por portafolio de negocio** (desde octubre de
  2025) y cuenta usuarios únicos contactados fuera de la ventana de servicio
  en 24 h móviles. El rendimiento (mensajes por segundo) es por número.
  Vocero lee el límite de Meta y **nunca lo fija en código**; el "uso del
  día" es una estimación propia (destinatarios únicos de plantillas en 24 h).
- **`messaging_limit_tier` está marcado como obsoleto**: se prefiere
  `whatsapp_business_manager_messaging_limit` cuando viene.
- **El cobro cambió el 1-oct-2026**: los mensajes de servicio que pasan el
  nivel gratuito llegan como `billable: true, type: "regular"`. Por eso
  Vocero guarda `pricing` tal cual lo manda Meta y **no deduce** si un
  mensaje se cobra. Ninguna fecha de cambio de cobro ni precio está en el
  código: los precios serán configuración editable (PR 2) y el costo se
  mostrará como "Estimado" hasta conciliarlo con `pricing_analytics` (PR 3).

## Qué confirmar a mano antes de fusionar el PR 1

Desde tu sesión local, en la documentación oficial (Meta for Developers →
WhatsApp Business Platform). Si algo no coincide, avísame qué dice y lo
ajusto antes de fusionar:

1. **Webhook de estados** (Webhooks → `messages` → objeto `statuses`): que el
   objeto `pricing` traiga `billable`, `pricing_model`, `category` y `type`,
   y que `errors[]` traiga `code`, `title`, `message` y
   `error_data.details`.
2. ~~**Webhook `template_category_update`**~~ **Confirmado por el dueño
   (2026-10-02)**: no existe `old_category`. Cambio hecho = `previous_category`
   + `new_category`; cambio próximo = `correct_category` + `new_category` (la
   actual) + `category_update_timestamp`. Vocero distingue los dos.
3. **Webhook `phone_number_quality_update`**: que traiga `current_limit` con
   valores tipo `TIER_1K`.
4. **Webhook `account_update`**: valores de `event` para violaciones y
   restricciones.
5. **Campos del número** (Phone Numbers API) — `quality_rating = "NA"`
   confirmado como sinónimo de `UNKNOWN` (Vocero acepta los dos). Que existan `quality_rating`,
   `status`, `throughput.level`, `name_status`, `messaging_limit_tier` y
   `whatsapp_business_manager_messaging_limit`, y en qué nodo vive este
   último (¿número o WABA/portafolio?).
6. **Plantillas** (Message Templates API): que la lista se pagine con
   `paging.cursors.after`, que admita `limit` y que devuelva
   `quality_score.score` y `rejected_reason`.
7. **Estados de plantilla**: lista completa de `status` / `event`
   (APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL,
   PENDING_DELETION, LIMIT_EXCEEDED…). Confirmado que existen otros
   (UNARCHIVED, FLAGGED, LOCKED, REINSTATED…): Vocero guarda cualquier
   estado desconocido tal cual en `meta_status`, sin cambiar el estado local
   ni bloquear el envío.
8. **Subida reanudable** (Resumable Upload API): ruta `{app-id}/uploads`,
   parámetros `file_length` y `file_type`, cabecera `file_offset: 0` y
   `Authorization: OAuth {token}`, y que la respuesta final traiga `h`.
9. **Botón de baja de marketing**: el texto o `payload` con el que llega el
   toque del botón "Detener promociones" / "Stop promotions" (Vocero lo
   recibe como `type: "button"` y lo trata como texto).
10. **Error 131049**: texto y si llega síncrono (respuesta del envío) o
    asíncrono (estado `failed` en el webhook). Vocero maneja ambos.
11. **Permisos**: que todo lo anterior funcione con
    `whatsapp_business_management` + `whatsapp_business_messaging` sobre el
    token del sistema que ya usa tu instancia.
12. **Límites de uso**: el rate limit de Business Management API para
    `message_templates` y para el nodo del número (la sincronización diaria
    hace 1 lectura por número y N/100 páginas de plantillas al día).

## Fuentes (secundarias)

- [Pricing on the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) (citada por búsqueda, no leída)
- [Analytics – Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/analytics/) (citada por búsqueda, no leída)
- [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) (citada por búsqueda, no leída)
- [Per-user marketing template message limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/) (citada por búsqueda, no leída)
- [WhatsApp webhooks overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview/) (citada por búsqueda, no leída)
- [YCloud — cambio de precios del 1-oct-2026](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [dev.to — el objeto pricing](https://dev.to/dineshstack/whatsapp-cloud-api-sends-you-no-invoice-until-it-is-too-late-12lj)
- [Wati — error 131049](https://www.wati.io/en/blog/whatsapp-error-131049/)
- [Chatarmin — límites de mensajería 2026](https://chatarmin.com/en/blog/whats-app-messaging-limits)
- [Dualhook — webhooks de gestión](https://dualhook.com/docs/webhook-events)
