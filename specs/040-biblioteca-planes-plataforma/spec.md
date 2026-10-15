# 040 — Biblioteca unificada, plan comercial guardado y /platform ejecutiva

**Carril**: ciclo completo, FASE 2 de la navegación en pilares (039). Una
migración aditiva e idempotente (`drizzle/0050_biblioteca_planes.sql`).
Pedido por el dueño el 2026-10-15.

## Problema

1. Un negocio que quería que un catálogo `.pdf` lo enviaran sus asesores Y lo
   leyera el agente tenía que subirlo dos veces: en CRM Comercial → Biblioteca
   (`knowledge_entry`, guarda el archivo, la IA no lo lee) y en Estudio de IA →
   Documentos (`kb_document` + `kb_chunk`, la IA lo lee, el archivo se
   descarta).
2. `organization_plan.plan_key` solo admitía `custom`: «Uso y plan» y
   /platform decían «Personalizado» aunque la organización naciera Pro.
3. /platform era una lista con todo apilado al abrir cada fila (consumo,
   topes, módulos, personas y estado en una sola pantalla larga).

## Comportamiento observable

### 1. Biblioteca unificada: un archivo, dos destinos

- **Destinos** (insignias en las tarjetas de Biblioteca y en las filas de
  Documentos): **«💬 Envío en chat»** (la entrada aparece en el
  `KnowledgePicker` de la Bandeja y del chat de equipo) y **«🤖 Lectura IA
  (RAG)»** (su documento del agente con fragmentos y vectores).
- **Estudio de IA → Documentos**: con el módulo Biblioteca y
  `knowledge.manage`, el interruptor **«Disponible en Bandeja para envío rápido
  de asesores»** (encendido por defecto) guarda también el archivo original
  en la Biblioteca, atado al documento. Sin módulo/permiso no aparece y la API
  responde 403. Cada fila enciende o apaga «Envío en chat» sin volver a subir.
- **CRM Comercial → Biblioteca**: con Documentos del agente en la
  organización (`KB_DOCS` + módulo Laboratorio) y `agent.manage` +
  `knowledge.manage`, al crear una entrada aparece **«Entrenar también al
  Agente de IA con este documento (RAG)»** con su grupo (General por
  defecto). Lee el texto del `.pdf`/`.txt`/`.md` o, si no hay, el título y el
  contenido escrito. Cada tarjeta enciende o apaga los dos destinos.
- Reglas:
  - Un destino al menos (apagar el último: 422 `last_destination`; para
    quitarlo de todos lados, se borra).
  - Apagar «Envío en chat» CONSERVA el archivo (`show_in_chat = false`): no
    sale en la Bandeja, no se puede enviar (las rutas de envío usan
    `getKnowledgeForChat`) y quien administra lo sigue viendo en la
    Biblioteca (`?scope=library`).
  - Apagar «Lectura IA» borra el documento y sus fragmentos; encenderla de
    nuevo vuelve a leer el archivo guardado.
  - Un documento subido solo para la IA (antes del 040 o sin el
    interruptor) no tiene el original: «Envío en chat» responde 409
    `no_original` («vuelve a subirlo»).
  - Borrar en la Biblioteca deja el documento como «solo IA» (FK
    `ON DELETE SET NULL (knowledge_entry_id)`); borrar en Documentos un
    documento cuyo original estaba oculto borra también el original.
  - Editar el archivo o el texto de una entrada que alimenta a la IA rehace
    su documento (mismo grupo).
  - Todo pasa por las dos puertas (`server/knowledge/store.ts`,
    `server/kb-docs/store.ts`): límites de documentos y fragmentos con el
    candado de la organización, duplicados (409, la entrada se queda y la
    respuesta trae `ragError`), `assertCanUpload` y RLS. El puente
    (`src/server/library/`) no consulta tablas (guardarraíl
    `tests/unit/library-gate.test.ts`).
- `.md` en la Biblioteca se guarda como `text/plain` (lo que WhatsApp abre).

### 2. Plan comercial guardado

- `organization_plan.plan_key ∈ {esencial, pro, ultra, custom}`. Es el
  **reflejo** de los 13 interruptores (`planKeyOfModules`): si coinciden
  exactamente con Esencial, Pro o Ultra, esa clave; si no, `custom`.
- Se sincroniza (`syncPlanKey`, `src/server/limits/`) al crear la
  organización, en cada cambio de módulos y al guardar topes desde
  /platform. El cambio de plan queda en la bitácora (`detail.plan`).
- La migración rellena el plan de cada organización con módulos guardados.
- Etiquetas: **«Plan Esencial»**, **«Plan Pro»**, **«Plan Ultra»**,
  **«Personalizado»** — en Ajustes → Uso y plan, la tabla de /platform, el
  encabezado de la ficha y «Topes y visibilidad». El plan ya no se elige en
  el formulario de topes (lo deciden los módulos); `planKey` salió del PUT de
  topes.

### 3. /platform ejecutiva

- Pestañas (rutas, en la barra de 56 px de `PageShell`):
  **Organizaciones y Planes** (`/platform/organizaciones`; `/platform`
  redirige aquí) · **Costos y Precios IA** (`/platform/costos`) ·
  **Webhooks sin ruta** (`/platform/webhooks`) · **Administradores y
  auditoría** (`/platform/admin`).
- **Organizaciones y Planes**: tabla con nombre, estado, plan, módulos
  «x/13», IA del mes y almacenamiento aproximado; filtros rápidos Todas /
  Activas / Suspendidas / Borradas (con su cuenta) y por plan; búsqueda sin
  acentos por nombre o Propietario; alta con plan. Cada fila abre la ficha.
- **Ficha** `/platform/organizaciones/[id]` (volver + cuatro pestañas):
  A. **Plan y módulos** (plantillas rápidas Esencial / Pro / Ultra con
  confirmación; Personalizado = a mano; los 13 agrupados por pilar; ritmo de
  campañas) · B. **Topes y visibilidad** (`limits-form.tsx`) · C. **Consumo y
  almacenamiento** · D. **Accesos y estado** (personas, enlace de
  contraseña, suspender/reactivar/borrar/restaurar).
- **Webhooks sin ruta**: `webhook_unrouted` agrupado por llave (fuente, tipo,
  llave, motivo, campos, eventos, último). Solo metadatos: el contenido
  cifrado no sale.
- **Administradores y auditoría**: los administradores (solo lectura; se dan
  con `scripts/platform-admin.mjs`) y la bitácora.
- Geometría: el estándar del 039 — UNA barra de 56 px con las pestañas en
  píldora dentro (cada píldora ≤ 40 px); nunca una segunda barra.

## Fuera de alcance

- Alta de personas en otra organización desde /platform (la invita su
  Propietario; /platform solo genera enlaces de contraseña).
- Dar o quitar administradores desde la pantalla (sigue en el script del
  operador: necesita acceso al servidor).
- Recuperar el original de un PDF subido solo para la IA antes del 040.

## Criterios de aceptación

- Unitarias: `plan-key.test.ts`, `platform-orgs.test.ts`,
  `library-gate.test.ts`, `permissions-routes.test.ts` (rutas nuevas).
- BD: `tests/db/plan-comercial.test.ts`, `tests/db/biblioteca-unificada.test.ts`.
- E2E: `e2e-plataforma` (pestañas, geometría 56 px, filtros, ficha,
  planes guardados), `e2e-modulos`, `e2e-documentos` (§ 11),
  `e2e-conocimientos` (§ 5b).
