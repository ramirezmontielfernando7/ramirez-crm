# 039 — Navegación en 5 pilares, `PageShell` de 56 px y planes comerciales

**Carril**: ciclo completo, FASE 1. Sin migración: ninguna ruta cambia de
dirección y ningún dato se mueve. Pedido por el dueño el 2026-10-14.

## Problema

El menú lateral creció a once renglones (Bandeja, Chat de equipo, Trabajo,
Pipeline, Contactos, Conocimientos, Campañas, Resultados, Laboratorio,
Asistente…), cada pantalla dibujaba su propio encabezado (alturas de 52 a
~76 px, títulos de 17 px bold, a veces con subtítulo) y /platform solo ofrecía
dos perfiles de alta (Básico y Completo) que no corresponden a los planes que
vende Demfort.

## Comportamiento observable

1. **Menú de 5 pilares + Ajustes** (+ Plataforma para su administrador). Cada
   pilar agrupa pantallas que ya existían como PESTAÑAS (rutas: se comparten y
   Atrás funciona):

   | Pilar | Ícono | Pestañas (ruta · módulo) |
   |---|---|---|
   | Bandeja | `Inbox` | Clientes `/inbox` · Equipo `/chat` (`team_chat`) |
   | CRM Comercial | `Kanban` | Pipeline `/pipeline` · Contactos `/contacts` · Agenda `/bookings` (`agenda`) · Tareas y notas `/trabajo/*` (`trabajo`) · Biblioteca `/knowledge` (`knowledge`) |
   | Estudio de IA | `FlaskConical` | Mis agentes `/lab` · Mi agente `/agent` (solo sin Laboratorio) · Conocimiento y documentos `/lab/documentos` (con `KB_DOCS`) · Asignación por etapa · Evaluaciones |
   | Marketing | `Megaphone` | Campañas · Audiencias · Plantillas WhatsApp (`templates.manage`) · Métricas y costos Meta |
   | Inteligencia | `ChartColumn` | Resultados y embudo `/results` (`results.read`) · Asistente de negocio ✨ `/asistente` (`asistente`, `assistant.use`) |
   | Ajustes | `Settings` | Canales y Meta · Equipo y permisos · Operación CRM · Marca y apariencia · Uso y plan |

   - Una pestaña existe si su módulo está encendido para la organización y la
     persona tiene su permiso (el servidor lo valida igual en cada ruta). Un
     pilar existe si al menos una de sus pestañas existe; su renglón lleva a
     la PRIMERA (p. ej. Inteligencia solo con el Asistente → `/asistente`;
     Estudio de IA sin Laboratorio → `/agent`).
   - El renglón se pinta activo en todas las rutas de sus pestañas.
   - Bandeja lleva los dos globos: no leídos de clientes y del chat de equipo.
   - El menú que un Propietario ya guardó en Ajustes → Navegación sigue
     valiendo: los pilares conservan la clave de un módulo que ya existía
     (`inbox`, `pipeline`, `lab`, `campaigns`, `results`); las claves que ya
     no tienen renglón se descartan al normalizar.
2. **`PageShell`** (`src/components/ui/page-shell.tsx`) en CRM Comercial,
   Estudio de IA, Marketing, Inteligencia, Ajustes y Plataforma: **UNA sola
   barra de 56 px** (`h-14`, alineada con la fila del logo del menú). A la
   izquierda, el botón que reabre el menú oculto, el ícono y el título del
   pilar (`text-[15px] font-semibold`); tras un divisor vertical
   (`h-4 w-px bg-border`), las pestañas del pilar en píldora
   (`rounded-md px-2.5 py-1.5 text-[13px]`, la activa `bg-brand-tint
   text-brand-text` como el renglón del menú); a la derecha, las acciones
   (`h-8`). Nunca una segunda barra de pestañas en escritorio; en el teléfono,
   si no caben, las pestañas bajan a una tira compacta con scroll horizontal.
   Variantes `fluid` y `contained` (`max-w-6xl`). Los filtros de cada
   pantalla van en su fila dentro del contenido. El área principal conserva
   el panel flotante de `AppShell` (radio, borde, sombra y separación del
   menú); `PageShell` no pinta fondo propio. En el teléfono sigue la franja
   superior de `AppShell` con el botón del cajón.
   - **La Bandeja (`/inbox`) y el Chat de equipo (`/chat`) NO usan
     `PageShell`**: conservan sus columnas a altura completa con su
     encabezado compacto. Su título es un selector (`InboxModeSwitch`):
     «Bandeja ▾» / «Chat de equipo ▾» abre un menú con «Bandeja de clientes»
     y «Chat de equipo», cada una con sus no leídos; un punto junto al título
     avisa de actividad en el OTRO modo. Sin el módulo `team_chat`, el
     título es texto fijo. Los no leídos de clientes salen de un almacén
     compartido con el globo del menú (`components/inbox/unread-store.ts`).
3. **Ajustes en 5 pestañas**; cuando una tiene varias páginas, van como
   control segmentado dentro del contenido (igual Tareas / Notas). «Uso y plan» pasa a `/settings/uso`
   (`/uso` redirige).
4. **Planes comerciales** (plantillas de los 13 interruptores al crear la
   organización en /platform; no se guardan):
   - **Esencial**: Bandeja (con chat de equipo), CRM Comercial (Tareas, Notas
     y Biblioteca) y Resultados. Sin IA.
   - **Pro**: + Agente y Laboratorio, Agenda, Atribución (Meta CAPI),
     Instagram, Messenger y menú personalizable.
   - **Ultra**: + Campañas masivas y el Asistente interno del dueño (13.º).
   - **Personalizado**: sin plantilla (valen las variables de entorno) y los
     13 se mueven a mano en el detalle de la organización.
   El detalle de cada organización en /platform dice a qué plan corresponden
   HOY sus 13 interruptores («Personalizado» si alguien movió uno a mano) y
   en qué pilar vive cada uno.

## Fuera de alcance (Fase 1) y pendientes

- **Diagnóstico de conversaciones** (pestaña de Inteligencia): no existe una
  pantalla todavía (el análisis guardado vive dentro del asistente, 038 PR 3).
  Se agrega cuando tenga pantalla propia; el registro solo necesita una
  sección nueva.
- **«Múltiples agentes» como límite del plan**: hoy no hay un interruptor que
  limite cuántos agentes; Pro y Ultra traen el Laboratorio (varios agentes).
- **Guardar el plan**: `organization_plan.plan_key` sigue solo en `custom`
  (lo de los topes). Persistir Esencial/Pro/Ultra pide migración y decidir
  cómo conviven plan y topes.
- **Etapas en Ajustes → Operación CRM**: se siguen gestionando desde el
  Pipeline («Gestionar etapas»).

## Criterios de aceptación

- `tests/unit/modules-registry.test.ts` (pilares, pestañas, primera pestaña,
  pestaña activa, planes), `tests/unit/page-shell.test.ts` (geometría y
  guardarraíl: nadie fuera de `PageShell` pinta su título con el botón del
  menú), `tests/unit/platform-usage.test.ts` (plan de los 13).
- `tests/db/navegacion.test.ts` (planes al crear, menú guardado con pilares),
  `tests/db/trabajo.test.ts`.
- E2E: `scripts/e2e-navegacion.mjs`, `e2e-modulos.mjs`, `e2e-trabajo.mjs`,
  `e2e-plataforma.mjs` (Uso y plan en Ajustes), y los que leen pestañas.
