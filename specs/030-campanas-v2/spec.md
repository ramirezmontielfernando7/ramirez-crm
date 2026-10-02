# 030 — Campañas v2

Campañas simples de usar, con datos de la API oficial de Meta, y navegación
personalizable por organización. Cuatro PRs secuenciales; cada uno se fusiona
y despliega antes de empezar el siguiente.

| PR | Contenido | Migración |
|---|---|---|
| 1 | Fundamentos de datos de Meta (este documento, sección PR 1) | 0031 |
| 2 | Campañas v2: pestañas, audiencias .xlsx/.csv, asistente de 3 pasos, cola por número | 0032 |
| 3 | Métricas: KPIs, analíticas de Meta a la base propia, conciliación de costo | 0033 |
| 4 | Registro de módulos y navegación personalizable por rol; Plantillas pasa a Campañas | 0034 |

Decisiones del dueño (no se repreguntan): solo `opt_in` recibe campañas; los
costos son "Estimado" hasta conciliarse con lo que reporta Meta; un número de
WhatsApp por organización con el esquema listo para varios; nada de pruebas
A/B, secuencias, Flows, catálogos, consultas en vivo a Meta ni costo por
contacto. Precios, fechas de cambios de cobro y límites de Meta NUNCA en
código: se leen de Meta o son configuración editable.

Referencia de la API de Meta y lo NO VERIFICADO:
[docs/campanas-v2-meta.md](../../docs/campanas-v2-meta.md).

## PR 1 — Fundamentos de datos de Meta

### Historias

1. **Estados reales del mensaje.** Cada saliente guarda la hora de `sent`,
   `delivered`, `read` y `failed` (la que manda Meta, una sola vez cada una,
   aunque lleguen fuera de orden), el código de error con su traducción al
   español, y el objeto `pricing` tal cual (`billable`, modelo, categoría,
   tipo). El estado es monotónico y atómico (`UPDATE … WHERE status IN …`):
   un `delivered` tardío no pisa `read` y **un `failed` tardío no pisa un
   `delivered` ni un `read`**; `failed` es terminal.
2. **El destinatario de una campaña refleja la entrega real**, derivada del
   mensaje (`campaign_recipient.message_id → message`, FK compuesta), sin
   copiar datos: detalle de la campaña (entregados, leídos, no entregados) y
   CSV.
3. **Bajas por palabra clave (STOP/BAJA).** Si el mensaje COMPLETO del
   cliente (sin mayúsculas, acentos ni puntuación) es una palabra de baja de
   su organización, el contacto pasa a `opt_out`, queda en la línea de tiempo
   (una vez) y ninguna campaña futura le llega. No despierta al agente. Las
   palabras se configuran por organización (default en español e inglés, sin
   "cancelar" ni "alto", que un cliente usa para otra cosa); la respuesta
   automática es opcional y viene apagada. El toque de un botón de respuesta
   rápida de plantilla (`type: "button"`) entra a la bandeja como texto y
   cuenta como baja si coincide.
4. **Salud del número.** Historial diario (`wa_phone_health`) de calidad,
   límite, estado y rendimiento; sincronización diaria por organización
   (dentro del proceso, revisa cada hora) y botón "Actualizar" (máx. 1 por
   minuto por organización, vale entre contenedores). Los webhooks
   `phone_number_quality_update` y `account_update` actualizan el día.
   Alertas para Propietario y Coordinador (permiso `number_health.read`):
   calidad media o baja, caída de calidad, estado del número, aviso de cuenta
   y uso del día ≥ umbral configurable (80 % por defecto).
5. **Plantillas completas.** La sincronización (paginada) importa también las
   plantillas que existen en la WABA y no en el CRM, con componentes,
   estado crudo de Meta y calidad. Desde el CRM se crean con ejemplos por
   variable, encabezado de texto o imagen (subida reanudable; requiere
   `META_APP_ID`), pie y botones de respuesta rápida o URL. Pausada o
   desactivada por Meta = no enviable, con motivo; un estado de Meta que el
   CRM no conoce se guarda tal cual y no bloquea nada. El cambio de categoría
   se avisa en la interfaz hasta que alguien pulsa "Entendido", distinguiendo
   el cambio ya hecho (`previous_category` + `new_category`) del cambio
   próximo (`correct_category` = la futura, `new_category` = la actual,
   `category_update_timestamp`).
6. **wa-mock**: estados con `pricing` y hora, 131049, salud del número (y
   rechazo de campos nuevos), plantillas por WABA y paginadas, siembra de
   plantillas existentes, subida reanudable, analíticas y eventos a nivel
   WABA.

### Diseño

- Migración `0031_campanas_v2_datos_meta.sql`, aditiva e idempotente;
  reversa opcional `scripts/sql/0031-reversa.sql` (revertir = imagen anterior).
- Tablas nuevas de dominio con RLS forzado: `wa_phone_health`,
  `messaging_settings`.
- Trabajo diario: `src/server/meta-sync/daily.ts` (lista con el pool de
  sistema; cada organización a nombre de la suya; Meta fuera de toda
  transacción; escritura dentro de `withTenant`).
- Webhooks a nivel WABA: `src/server/whatsapp/waba-events.ts`.
- Bajas: `src/lib/opt-out.ts` (reglas puras) + `src/server/inbox/opt-out.ts`.
- Salud: `src/lib/phone-health.ts` + `src/server/whatsapp/health.ts`.
- Plantillas: `src/lib/templates.ts` (borrador, componentes, requisitos de
  envío) + `src/server/whatsapp/templates.ts` + `src/lib/meta/upload.ts`.

### Pruebas

- Unitarias: monotonía y pricing, catálogo de errores, palabras de baja,
  límite y alertas de salud, borrador y componentes de plantilla, permisos y
  guardarraíles (`scoped()`, pool de sistema).
- BD real: `tests/db/estados-mensaje.test.ts` (incluye concurrencia),
  `tests/db/bajas.test.ts`, RLS de las tablas nuevas.
- E2E: `scripts/e2e-datos-meta.mjs` (guion `tests/e2e/us-datos-meta.md`).

## PR 2 — Campañas v2

### Historias

1. **Pestañas** Campañas, Audiencias y Métricas (rutas; Métricas con un
   aviso hasta el PR 3) y Ajustes de envío.
2. **Audiencias.** Subir .xlsx o .csv (5 MB, 20 000 filas; sin macros;
   de una fórmula se usa el valor guardado). Columnas por nombre y sinónimos
   (nombre; numero/telefono/celular/whatsapp; correo/email; etiquetas/tags)
   o, si no se reconocen, el paso "¿qué es cada columna?". Vista previa con
   las inválidas en rojo y resumen (válidas, inválidas, duplicadas). La
   declaración del origen del consentimiento es obligatoria: deja `opt_in` a
   quien no trae columna de consentimiento (un `opt_out` no se revierte).
   Se reutiliza el importador de Contactos (`importValidated`), con su
   etiqueta automática. El correo se guarda en `contact.email` (opcional,
   sin pisar uno existente). Filas con error descargables (CSV protegido
   contra fórmulas) y archivo de ejemplo .xlsx/.csv. La base queda guardada
   con sus columnas extra.
3. **Asistente de 3 pasos.** (1) audiencia: base guardada, etiquetas o
   archivo nuevo; (2) mensaje: solo plantillas aprobadas y activas,
   variables desde texto, nombre o columna de la base, burbuja de WhatsApp;
   (3) revisar y enviar: cuántos recibirán y excluidos por motivo (sin
   opt_in, opt_out, inválidos, duplicados, archivados, sin valor de
   variable), costo ESTIMADO (tarifas que captura el negocio), margen frente
   al límite de 24 h leído de Meta, prueba a un número propio y enviar ya o
   programar en la zona horaria del negocio.
4. **Envío: cola POR NÚMERO.** Un despachador por (organización, número)
   atiende por turnos a todas sus campañas al ritmo de la organización. Solo
   la réplica con la concesión del número (`wa_send_lease`) despacha; cada
   destinatario se reclama con `FOR UPDATE SKIP LOCKED` (CTE). El mensaje se
   reserva ANTES de llamar a Meta: tras un reinicio, sin mensaje → vuelve a
   la fila; con wamid → enviado; sin wamid → fallido sin reenvío. Un reclamo
   cuyo dueño sigue vivo no se toca. Reintentos con espera creciente solo
   para errores transitorios (130429, 80007, 4, Meta caído); 131049 no se
   reintenta. Pausar, reanudar y cancelar.
5. **Pausa de seguridad automática** (umbrales en `campaign_settings`):
   tasa de fallos ≥ 20 % en los últimos 50 intentos (sin contar 131026,
   131049, 131050), calidad ROJA, aviso de restricción de la cuenta, y uso
   ≥ 95 % del límite de 24 h (se reintenta sola a los 30 min). Aviso en la
   app para Propietario y Coordinador.
6. **Detalle** con progreso en vivo (SSE), excluidos, costo estimado, motivo
   de pausa, programación y acciones.
7. **Permisos:** `campaigns.manage` (Propietario y Coordinador); subir
   audiencias pide además `contacts.import`. El Asesor recibe 403; con el
   módulo apagado, 404.

### Diseño

- Migración `0032_campanas_v2_envio.sql`, aditiva e idempotente; reversa
  opcional `scripts/sql/0032-reversa.sql` (revertir = imagen anterior).
- Tablas nuevas con RLS forzado: `audience_import`, `audience_member`,
  `campaign_settings`, `wa_send_lease`.
- `src/server/campaigns/`: `audiences.ts`, `audience.ts` (regla opt_in),
  `service.ts`, `dispatcher.ts` (despachador y programador), `queue.ts`
  (concesión, reclamo, recuperación), `lifecycle.ts` (transiciones
  condicionales), `outcome.ts` (errores), `safety.ts` (pausa de seguridad),
  `settings.ts`.
- `src/server/contacts-io/spreadsheet.ts` (`read-excel-file` + `fflate`) y
  `xlsx-write.ts` (archivo de ejemplo).

### Pruebas

- Unitarias: lectura de Excel (fórmulas, macros, tipos), sinónimos y
  asignación, vista previa, pausa de seguridad, costo estimado, errores.
- BD real: `tests/db/audiencias.test.ts`, `tests/db/cola-campanas.test.ts`
  (dos despachadores, reclamo concurrente, recuperación, programador).
- E2E: `scripts/e2e-campanas-v2.mjs` (guion `tests/e2e/us-campanas-v2.md`).

## PR 3 — Métricas

### Historias

1. **Analíticas de Meta en la base propia.** La sincronización diaria (el
   mismo temporizador del PR 1, una vez al día por organización con el
   módulo Campañas) copia `template_analytics` (enviados, entregados,
   leídos y clics por plantilla y día) y `pricing_analytics` (volumen y
   costo por día, número, país, categoría y tipo, con la moneda de la WABA).
   La primera vez trae 90 días de plantillas y 1 año de precios; después,
   desde 3 días antes de la última sincronización (Meta corrige días
   recientes). Upsert por llave: repetir no duplica. Ninguna pantalla
   consulta a Meta en vivo.
2. **Pestaña Métricas.** KPIs sencillos del periodo: enviados (aceptados
   por Meta), entregados (%), leídos (%), respondieron (%), fallidos con
   motivo en español, bajas y costo estimado. Gráfica por día (por mes en
   rangos de más de 92 días), tabla comparativa de campañas, filtros por
   periodo (zona del negocio) y por número, exportación CSV.
3. **Respuestas** = mensajes entrantes del contacto en esa conversación
   dentro de `campaign_settings.reply_window_hours` (72 h por defecto,
   editable en Ajustes de envío) tras el envío.
4. **Conciliación honesta.** Costo por campaña = "Estimado" (lo estimado al
   lanzar, prorrateado por lo enviado; o la tarifa de hoy si al lanzar no
   había). Los totales del periodo muestran "Estimado" junto a "Reportado
   por Meta" y la diferencia; si falta uno de los dos o las monedas no
   coinciden, no se resta y se dice por qué. Lo reportado incluye todos los
   mensajes cobrados del número (no solo campañas) y va en días UTC.
5. **Salud del número**: la misma tarjeta del PR 1.
6. **Analíticas no activas.** Si Meta responde que las analíticas de
   plantillas no están activas en la WABA, se anota (`not_enabled`), la
   tarjeta lo dice y lo demás (KPIs, costo reportado) funciona.

### Diseño

- Migración `0033_campanas_v2_metricas.sql`, solo aditiva e idempotente;
  reversa opcional `scripts/sql/0033-reversa.sql` (revertir = imagen
  anterior).
- Tablas nuevas de dominio con RLS forzado e índices que empiezan por
  organización: `wa_template_analytics_daily`, `wa_pricing_analytics_daily`
  y `wa_analytics_sync` (estado de la última sincronización de cada una;
  decide primera carga o diaria y guarda el "no activas").
- `src/lib/meta-analytics.ts` (ventana, tramos, lectura tolerante de las
  respuestas, detección de "no activas") · `src/server/meta-sync/analytics.ts`
  (Meta fuera de transacción, escritura en `withTenant`) · `daily.ts`
  (`runDailyAnalyticsSync`).
- `src/lib/campaign-metrics.ts` (contratos, porcentajes, conciliación, CSV)
  · `src/server/campaigns/metrics.ts` · `GET /api/campaigns/metrics` y
  `/export` (`campaigns.manage`) · UI `src/components/campaigns/metrics-client.tsx`.
- wa-mock: moneda y modo "analíticas no activas"; `POST
  /api/dev/wa-mock/analytics` corre la sincronización ya (solo con mocks).

### Pruebas

- Unitarias: `tests/unit/meta-analytics.test.ts` (ventana, lectura,
  no activas, costo, conciliación, CSV) y guardarraíles.
- BD real: `tests/db/metricas.test.ts` (primera carga y diaria, upsert,
  no activas, KPIs con respuestas en 72 h y bajas, filtro por número,
  aislamiento, una vez al día).
- E2E: sección 7b y la interfaz de `scripts/e2e-campanas-v2.mjs`.

## PR 4 — Módulos y navegación personalizable

### Historias

1. **Registro central de módulos** (`src/lib/modules/registry.ts`): clave,
   nombre, ruta, ícono, núcleo u opcional, roles por defecto y dependencias.
   Núcleo (no se apaga): Bandeja, Contactos, Pipeline y Ajustes. Laboratorio
   requiere Agente.
2. **Capa plataforma.** `organization_module` suma Conocimientos, Agente,
   Laboratorio, Chat de equipo y Resultados (encendidos por defecto: migrar
   no le quita nada a nadie) y `custom_nav` (apagado). Apagado, un módulo no
   existe para esa organización: sus rutas y pantallas responden 404 en el
   servidor (403 primero si falta el permiso) y no está en el menú; con el
   Agente apagado el agente incluido no contesta. Encender el Laboratorio sin
   Agente → 422; apagar el Agente apaga el Laboratorio. Perfiles Básico y
   Completo: solo plantilla del alta desde /platform.
3. **Capa organización (Ajustes → Navegación)**, solo Propietario y solo con
   `custom_nav`: reordenar y ocultar el menú de cada rol con arrastre
   (@dnd-kit) o teclado (manija + flechas, botones ↑ ↓), vista previa,
   «Restaurar valores por defecto» y cambios recientes. Ocultar es solo
   estético. Cada rol conserva al menos una entrada visible; el Propietario
   no se oculta Ajustes (y con él, Navegación). Igual en los tres estados del
   menú y en el teléfono.
4. **Plantillas en Campañas.** Con Campañas encendido, las plantillas viven
   en `/campaigns/templates` (pestaña junto a Campañas, Audiencias y
   Métricas) y `/settings/templates` redirige ahí. Sin Campañas, Ajustes →
   Plantillas sigue como antes: la Bandeja también las usa.
5. **White-label:** los textos de Ajustes de envío dicen el nombre de la
   marca de la organización (`branding.name`), no «Vocero».

### Diseño

- Migración `0034_modulos_y_navegacion.sql`, aditiva e idempotente; reversa
  opcional `scripts/sql/0034-reversa.sql` (revertir = imagen anterior).
- Tablas nuevas con RLS forzado: `nav_layout` (org + rol, `items` jsonb) y
  `nav_layout_event` (bitácora append-only: un disparador rechaza UPDATE salvo
  el `SET NULL` del autor borrado).
- `src/lib/modules/nav-layout.ts` (menú por rol, puro) · `src/server/modules/`
  (`moduleOff`, `requireModulePage`, dependencia, perfiles) ·
  `src/server/navigation/` (`store.ts` única puerta de `nav_layout`,
  `resolve.ts` el menú de quien pide) · `/api/settings/navigation`.

### Pruebas

- Unitarias: `modules-registry.test.ts`, `modules-routes-guard.test.ts`
  (vigilancia del 404 por módulo), matriz de permisos.
- BD real: `tests/db/navegacion.test.ts`.
- E2E: `scripts/e2e-navegacion.mjs` (guion `tests/e2e/us-navegacion.md`) y
  `e2e-modulos` con los módulos nuevos.
