# 038 — Asistente interno (y campañas listas para reciclar leads)

**Carril**: ciclo completo, siete PR, uno a la vez. Plan aprobado por el
dueño el 2026-10-12. Se empezó por el **PR 6** (campañas), que no depende del
asistente.

## Decisiones del dueño

- El asistente es un **módulo premium** (13.º interruptor de /platform),
  **solo para el Propietario**, con su propio tope de tokens que **cuenta
  también en el tope total** de IA. Siempre por `chatJsonForOrg` con un
  `AiKind` nuevo (`assistant`).
- **Solo lectura y catálogo cerrado** de funciones; RLS siempre; nunca
  consultas libres a la BD. El texto de los clientes entra solo a un
  analizador en cuarentena (sin herramientas, salida con categorías fijas) y
  **enmascarado** (teléfonos y nombres) antes de ir al proveedor de IA.
- **Análisis guardado por conversación** (objeción, motivo de pérdida,
  resultado, etapa, desempeño del asesor), con confianza, «inferido» frente a
  «etiquetado», categoría «no se sabe», validación del dueño y diagnóstico de
  la base. Se analiza una vez; se reanaliza solo con mensajes nuevos. Primera
  pasada de lo más reciente a lo más viejo, con costo estimado y
  confirmación. Sin embeddings ni RAG en esta fase.
- **Reportes pesados** en segundo plano, con costo estimado y confirmación;
  aviso fijo de que el asistente consume muchos recursos de IA.
- **Visibilidad del consumo** por organización (la fija el administrador):
  porcentaje del tope (por defecto), tokens (si el administrador lo habilita)
  u oculto. El cliente nunca ve USD. Aplica a «Uso y plan», a los avisos y al
  texto del asistente. «Créditos» queda como mejora posterior.
- «Personas» = asesores (miembros del equipo). Retención de 90 días.
- **Reciclaje de leads**: el asistente devuelve listas o segmentos, pero
  **nunca envía**. El envío es una campaña aparte, confirmada por una
  persona, con las reglas de Campañas.

## PR

| PR | Contenido | Migración | Estado |
|---|---|---|---|
| **1** | **Interruptor 13, permiso `assistant.use`, `AiKind` + tope propio + avisos, visibilidad del consumo, aviso antes de usarlo** | **0047** | **en curso** |
| 2 | Motor mínimo, funciones de uso y plan, pantalla /asistente | — | pendiente |
| 3 | Análisis por conversación, trabajos en segundo plano, enmascarado, primera pasada | siguiente libre | pendiente |
| 4 | Bucle de herramientas, preguntas agregadas, muestras, asesores, reportes pesados | siguiente libre | pendiente |
| 5 | Diagnóstico de la base, validar y corregir casos | — | pendiente |
| 6 | Campañas: baja de marketing 131050, frecuencia por contacto, plantilla pausada | 0046 | fusionado (#64) |
| 7 | Segmentos de reciclaje (sin envío) y paso a Audiencias | siguiente libre | pendiente |

En el PR 3 se mide y reporta el **costo real por conversación analizada** y
se evalúa si el análisis puede usar un modelo más barato que el del
asistente.

## PR 1 — Base del asistente interno

### Comportamiento observable

1. **Módulo premium.** `organization_module.asistente`, apagado en toda
   organización (sin variable de entorno ni perfil de alta). Solo el
   administrador de plataforma lo enciende (13.º interruptor, «x/13»). Sin él,
   `/asistente` y `/api/assistant/*` → 404 y no hay entrada en el menú.
2. **Solo el Propietario** (`assistant.use`): Coordinador y Asesor → 403 en la
   API; la página los regresa a la Bandeja; sin entrada en su menú.
3. **Solo lectura y una puerta.** El asistente nunca envía mensajes ni toca
   campañas; el modelo, solo por `chatJsonForOrg(org, "assistant", …)`.
   Guardarraíl `tests/unit/assistant-gate.test.ts`.
4. **Tope propio.** `ai_quota.assistant_monthly_token_limit` (o
   `AI_DEFAULT_MONTHLY_ASSISTANT_TOKENS`). Se revisa ANTES del total; sus
   turnos y tokens cuentan también en el total (decisión del dueño); su tope
   no frena los demás usos. **Sin tope, el asistente no responde** (nunca
   corre sin tope). Agotado (o el total agotado): se detiene y lo dice, con
   la fecha en que vuelve. Avisos 80/100 % (`assistant_tokens`).
5. **Visibilidad del consumo** (`organization_plan.usage_visibility`, la fija
   el administrador): `percent` por defecto (porcentaje del tope), `status`
   (solo «Disponible» / «Agotado», sin desglose) o `tokens` (las cifras). El
   cliente nunca ve dólares. Aplica a «Uso y plan», los avisos (texto y
   cifras) y el asistente; se recorta en el servidor. La plataforma ve todo,
   dólares incluidos (Costos suma la función «Asistente interno»).
6. **Aviso antes de usarlo.** Banner fijo en `/asistente` («Cada pregunta
   consume bastante crédito de IA… se puede agotar rápido…») y una
   confirmación la primera vez (por persona, `user_preference.assistant_notice_accepted_at`).
   Las preguntas llegan con el motor (PR 2); mientras, la pantalla muestra el
   aviso y el estado del crédito.

### Migración 0047 (aditiva, idempotente)

Columnas `organization_module.asistente`, `ai_quota.assistant_monthly_token_limit`
(CHECK ≥ 0), `organization_plan.usage_visibility` (CHECK), 
`user_preference.assistant_notice_accepted_at`; tablas `assistant_thread` y
`assistant_message` con RLS forzado; amplía `organization_plan_modules_chk`
(0–13) y `usage_alert_metric_chk` (+ `assistant_tokens`). Reversa opcional:
`scripts/sql/0047-reversa.sql`.

## PR 6 — Campañas listas para reciclar leads

### Problema

Antes de reciclar leads viejos con campañas: (1) el error **131050** de Meta
(«dejó de recibir marketing de esta empresa») solo marcaba ese envío como
fallido y la siguiente campaña lo volvía a intentar; (2) no había **tope de
frecuencia** por contacto entre campañas, y reciclar lo hace probable; (3) una
plantilla que Meta **pausa por calidad** ya se bloqueaba al crear, lanzar y
enviar (`templateSendability`), pero una campaña programada solo se enteraba
al enviar su primer mensaje, con un motivo genérico.

### Comportamiento observable

1. **131050.** Por la respuesta del envío o por el estado `failed` del
   webhook, el contacto queda con `wa_marketing_opt_out_at` (una sola vez,
   con paso en la línea de tiempo). NO cambia `wa_consent`: utilidad y
   autenticación le siguen llegando. Las campañas de MARKETING lo omiten
   (excluido «Dejaron de recibir promociones en WhatsApp (131050)»). En el
   panel del contacto se ve el aviso y una persona lo quita con «Volvió a
   aceptar promociones» (si Meta vuelve a responder 131050, la marca vuelve).
2. **Frecuencia.** `campaign_settings.marketing_min_days`, **7 días por
   defecto** (0 = sin tope, máximo 90), en Ajustes de envío → «Frecuencia de
   marketing». Una campaña de marketing omite a quien recibió OTRA campaña de
   marketing en esos días (excluido «Recibieron otra campaña de marketing
   hace poco»). Cuenta lo enviado que Meta no rechazó después; utilidad y
   autenticación no cuentan ni se limitan. Aplica también a las
   organizaciones existentes desde el despliegue.
3. **Las dos reglas al lanzar y al enviar.** El público congelado al lanzar
   las aplica; justo antes de cada envío se vuelven a revisar (otra campaña
   pudo llegar antes, o Meta pudo avisar 131050): el destinatario queda
   `skipped` con el motivo y no se llama a Meta. Si nadie del público puede
   recibir la campaña de marketing, lanzar responde 422 con ese motivo.
4. **Plantilla pausada o desactivada por Meta.** Por el webhook de estado o
   la sincronización, sus campañas programadas o enviando se pausan YA, en
   pausa automática SIN reanudación sola, con el nombre de la plantilla y el
   motivo de Meta, y aparecen en los avisos de la app. Si Meta la reactiva,
   una persona reanuda la campaña. El motivo al pausar desde un envío también
   dice el motivo concreto.

### Migración 0046 (solo aditiva, idempotente)

`contact.wa_marketing_opt_out_at` (timestamp NULL),
`campaign_settings.marketing_min_days` (integer NOT NULL DEFAULT 7, CHECK 0–90)
e índice `campaign_recipient (organization_id, contact_id, sent_at)`. Sin
tablas nuevas. Reversa opcional: `scripts/sql/0046-reversa.sql`. El tipo de
línea de tiempo `marketing_opt_out` no necesita migración
(`contact_activity_event.kind` es texto sin CHECK).

### Pruebas

`tests/unit/campanas-marketing.test.ts` (reglas puras y SQL),
`tests/db/campanas-marketing.test.ts` (Postgres real: webhook, lanzar,
enviar, quitar la marca, plantilla pausada) y la sección 7d + interfaz de
`scripts/e2e-campanas-v2.mjs` (`tests/e2e/us-campanas-v2.md`).

### Fuera de alcance

Las plantillas enviadas a mano desde la Bandeja (no cuentan para la
frecuencia ni se bloquean por 131050; Meta las rechaza igual), reanudar sola
una campaña cuando Meta reactiva su plantilla, y la verificación del
consentimiento (sigue siendo lo que declara el negocio, 021).
