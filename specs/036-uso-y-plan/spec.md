# 036 — Uso y plan (Plataforma reorganizada + panel de consumo del Propietario)

Estado: PR 1, 2 y 4 fusionados; PR 3a implementado (plan, topes, bloqueos y avisos; migración 0045). PR 3b (costos), 3c (historial), 5 y 6 pendientes; cada uno
arranca solo cuando el dueño lo indica, y solo hay una migración en curso a la
vez (el número se asigna al implementar, leyendo `drizzle/` en `main`).

## Objetivo

1. **Plataforma** (administrador de plataforma) con dos pestañas:
   - «Mi panel»: resumen personal (organizaciones por estado, IA del mes vs.
     lo asignado, almacenamiento total aprox., cerca del tope, más consumo,
     bitácora reciente). Solo metadatos.
   - «Organizaciones»: lista minimalista. Fila cerrada: nombre, plan, IA
     (asignado vs. consumido), almacenamiento (aprox.), módulos activos
     (x/12). Fila desplegada: plan, límites, módulos, consumo del mes,
     personas y estado.
2. **«Uso y plan»** del Propietario (permiso `usage.read`, SOLO Propietario),
   desde el menú de la cuenta abajo en la barra lateral (sin módulo nuevo):
   consumo de IA, almacenamiento y documentos contra sus límites; qué función
   consume más (agente, Laboratorio y vista previa, juez, redacción;
   embeddings aparte) y qué agente.
3. **Plan**: campo «Plan» = «Personalizado» (`plan_key = 'custom'`), diseñado
   para que después entren planes base con ajustes manuales encima.

## Decisiones del dueño

- «Uso y plan» solo para el Propietario.
- Los 12 interruptores actuales de /platform son la base del «x/12»
  (incluido «Menú personalizable»).
- Almacenamiento: interruptor por organización con dos modos — «Solo avisar»
  (por defecto) y «Bloquear subidas manuales» (rechaza subidas desde el CRM:
  documentos del RAG, archivos de Conocimientos, adjuntos del chat de
  equipo). La multimedia ENTRANTE de WhatsApp se recibe y guarda SIEMPRE.
- La organización de plataforma, sin tope por defecto.
- Bajar un límite por debajo del uso actual solo impide crecer.
- La pantalla dice «Almacenamiento (aprox.)» con nota de qué incluye.

## PRs

| PR | Contenido | Migración |
|---|---|---|
| 1 | Consumo de IA por agente (`ai_usage_agent`) | Sí — `0042_consumo_por_agente` |
| 2 | Medición de almacenamiento (`src/server/usage/storage.ts`) | No |
| 3 | Límites y plan (`organization_plan`, puerta `src/server/limits/`, modo de almacenamiento) | Sí (número al implementar) |
| 4 | Plataforma con pestañas: «Organizaciones» | No |
| 5 | Plataforma: «Mi panel» | No |
| 6 | «Uso y plan» del Propietario | No |

## PR 1 — Consumo por agente (hecho)

- Tabla `ai_usage_agent` (organización, mes UTC, agente, tipo ∈ {agent, lab,
  judge}; turnos y tokens). FK compuesta a `agent` (CASCADE), RLS forzado.
  Solo reporta: los topes siguen contra la fila `total` de `ai_usage`.
- `chatJsonForOrg(org, kind, schema, msgs, { agentId })`: tras contar el
  turno, lo anota también al agente. El `agentId` no viaja al proveedor. Solo
  turnos que se reservaron; el turno cuenta aunque el proveedor falle (igual
  que `ai_usage`). Un fallo al anotar se registra y el turno sigue.
- Quién pasa el agente: el turno real (`DecideInput.agentId`, el agente que
  resolvió `loadTurnContext`, incluido el de la etapa), las conversaciones del
  Laboratorio, la vista previa (el agente que se edita) y el juez (el agente
  del snapshot evaluado). La redacción y los embeddings: «sin agente».
- Sin relleno retroactivo: el desglose existe desde el despliegue.
- Lectura: `getAgentUsage(org)` (la usarán los PR 4 y 6).

## PR 2 — Medición de almacenamiento (hecho)

Sin migración, solo lectura. `src/server/usage/storage.ts`:

- `getOrgStorageUsage(org)`: UNA organización, pool de la app (RLS) y
  `scoped()` en cada consulta. Para «Uso y plan» (PR 6).
- `getAllOrgsStorageUsage()`: TODAS, una suma agrupada por tabla con el pool
  de sistema. Solo para la plataforma (PR 4 y 5). En `system-db-guard` (1 uso)
  y en `tenant-query-exceptions` (5 consultas), cada una con su motivo.

Qué cuenta (`src/lib/usage.ts`, la pantalla dice «Almacenamiento (aprox.)»
con su nota):

| Categoría | Fuente | Regla |
|---|---|---|
| Multimedia de WhatsApp | `media_asset` | `sum(file_size)` de los que están en disco (`storage_path` no nulo): entrantes, salientes, imagen del anuncio, encabezado de plantilla |
| Archivos de Conocimientos | `knowledge_entry` | `sum(file_size)` de las entradas con archivo |
| Adjuntos del chat de equipo | `team_chat_attachment` | `sum(file_size)` |
| Documentos del agente | `kb_document` + `kb_chunk` | `octet_length(text)` + `octet_length(content)` + 4 bytes × `cardinality(embedding)`; el original no se guarda, así que `byte_size` NO cuenta. Sin filtrar por agente ni grupo |

Los archivos en disco sin tamaño registrado no suman y se reportan aparte
(`filesWithoutSize`). No cuenta: mensajes, contactos y bitácoras en Postgres,
logo e ícono, archivos huérfanos, multimedia pendiente o fallida.

## PR 4 — Plataforma → Organizaciones (hecho, antes que el PR 3)

Sin migración. Lo que depende de límites nuevos (campo Plan, editar topes,
tope de almacenamiento y de módulos) queda para el PR 3: el almacenamiento se
muestra «sin tope».

- Pestañas: «Mi panel» (`/platform`, por ahora la bitácora; el resumen es el
  PR 5) y «Organizaciones» (`/platform/organizaciones`). El layout da 404 a
  quien no es administrador de plataforma; cada página y cada ruta lo vuelven
  a comprobar.
- Fila cerrada: punto de estado + nombre, IA del mes contra su tope
  (`ai_quota` o el del entorno; con dos topes, el que va más alto), «Almacenamiento
  (aprox.)» y módulos «x/12» (12 interruptores, `src/lib/platform-modules.ts`).
  Aviso desde 80 %, rojo al 100 %.
- Fila abierta: IA por función (embeddings aparte) y por agente (nombre
  interno; archivados marcados), almacenamiento por categoría con su nota, y
  lo de siempre: módulos, ritmo de campañas, Personas (enlaces de contraseña),
  Suspender/Reactivar, Borrar/Restaurar. «Nueva organización» y buscador
  arriba.
- Solo lectura. `GET /api/platform/organizations` suma `usage` en lecturas
  agrupadas (y los módulos en una sola consulta, `getManyOrgModules`): la
  lista no se hace más lenta con más organizaciones. El detalle se pide al
  abrir la fila: `GET /api/platform/organizations/[id]/usage`, leído a nombre
  de la organización (RLS); los nombres de agentes con `agentNames`, que no
  escribe nada.

## PR 3 — dividido en 3a, 3b y 3c (decisiones del dueño)

- Avisos SOLO para el Propietario dentro de la app (no en el chat de equipo);
  el administrador los ve en la fila de la organización.
- En «Bloquear subidas manuales» se rechaza la subida que PASARÍA el tope.
- Moneda configurable: precios en USD, tipo de cambio que captura el
  administrador; la pantalla muestra moneda local y USD.
- La migración 0045 (todas las tablas) entra solo en 3a; 3b y 3c sin
  migración.

### PR 3a — Plan, topes, bloqueos y avisos (hecho)

Migración `0045_limites_avisos_costos`: `organization_plan`, `usage_alert`,
`platform_ai_pricing` (plataforma), `ai_usage(.agent).cost_usd`,
`org_usage_monthly`. Aditiva, idempotente, RLS en las de dominio.

| Tope | Dónde vive | Dónde se aplica |
|---|---|---|
| IA turnos/tokens | `ai_quota` | `reserveTurn` (como siempre) |
| Embeddings | `organization_plan.embed_token_limit` o entorno | `embedForOrg` |
| Personas | `organization_plan.max_members` | `POST /api/settings/team` (409 `member_limit`) |
| Almacenamiento + modo | `organization_plan.storage_limit_bytes` / `storage_mode` | `POST /api/lab/documents` (≈ 2 × texto extraído), `POST`/`PATCH /api/knowledge` (lo que crece), `POST /api/team-chat/threads/[id]/messages` con archivo (413 `storage_limit`) |
| Módulos activos | `organization_plan.max_active_modules` | `changeOrganizationModules` (422 `module_limit`; apagar siempre se puede) |
| Documentos | `kb_document_limit` | kb-docs (como siempre) |

Avisos 80/100 %: `usage_alert` (uno por organización, mes, medida y umbral).
Se revisan donde crece cada medida y cada 6 horas (almacenamiento que crece
con la multimedia entrante). La Propietaria los ve en la app
(`UsageAlertBanner`, «Entendido» los marca vistos); el administrador, en la
fila y en «Plan y topes».
