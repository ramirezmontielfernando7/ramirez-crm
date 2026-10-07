# 033 — Trabajo: Citas + Tareas + Notas en un solo ítem del menú

**Carril**: ciclo completo (toca el modelo de datos). Decisiones del dueño
tomadas antes de programar (2026-10-07). Se entrega en **dos PRs**:

- **PR 1** (este): ítem «Trabajo», Citas como primera pestaña abriendo en
  Lista, y **Tareas**.
- **PR 2**: **Notas** tipo Keep, con el enlace al chat de la Bandeja.

## Problema

Citas, recordatorios del equipo y apuntes viven hoy en lugares distintos (o
en ninguno). El equipo quiere un solo lugar de «lo que hay que hacer».

## Comportamiento observable (PR 1)

1. **Un solo ítem «Trabajo»** en el menú, en el lugar donde estaba «Citas».
   Aparece si la organización tiene encendido `agenda` (Citas) **o**
   `trabajo` (Tareas y notas). Subpestañas (componente `SectionTabs`): Citas
   y Tareas; cada una solo con su módulo. Con una sola, no se pintan
   pestañas: solo el título «Trabajo».
2. **Citas no cambia**: misma clave de módulo (`agenda`), mismos datos, misma
   dirección (`/bookings`, ahora con la cabecera de Trabajo). La vista por
   defecto es la **Lista** (también en el celular); si la persona eligió otra
   vista, se le recuerda como antes. `/trabajo` lleva a la primera pestaña
   encendida.
3. **Tareas** (como los Recordatorios del iPhone): lista con alta rápida
   (escribir y Enter), círculo para marcar hecha **de un toque**, filtros
   *Mis tareas* / *Todas* / *Vencidas* / *Hechas*, y panel de detalle con
   título, descripción opcional, fecha límite opcional (con hora opcional;
   sin hora vence al final del día), responsable (persona del negocio) y
   ligadura opcional a un contacto (con «Abrir chat»).
4. Desde el panel del chat de la Bandeja: **«Nueva tarea para este chat»**
   abre el formulario ya ligado a esa conversación.
5. **Permisos**: cualquiera crea tareas y las asigna a cualquier persona del
   equipo. Cada quien ve lo que creó o tiene a su cargo; con `work.manage`
   (Propietario y Coordinador) se ven y editan **todas**. Editar/marcar:
   creador, responsable o `work.manage`. Borrar: creador o `work.manage`.
   Ligar solo a un contacto/chat que la persona puede ver; al leer, el nombre
   del contacto solo lo ve quien puede ver ese contacto.
6. **Interno**: una tarea nunca envía nada a WhatsApp/Meta, tampoco en
   conversaciones de prueba (`is_test`).
7. **/platform**: interruptor «Tareas y notas» por organización.

### Valores por defecto

- Organizaciones existentes: `trabajo` **apagado** (columna `DEFAULT false`).
  Las que no usan Citas no ven ningún cambio. Las que usan Citas ven el menú
  «Trabajo» (antes «Citas»), solo con la pestaña Citas, abriendo en Lista.
- Organizaciones nuevas con perfil **Básico** o **Completo**: encendido (no
  gasta Meta ni IA). Sin perfil (variables de entorno): apagado.

### Criterios de aceptación (verificables)

- Sin `agenda` ni `trabajo`: no hay «Trabajo» en el menú; `/trabajo` → 404.
- Sin `trabajo`: `/api/work/*` → 404 y `/trabajo/tareas` → 404; Citas igual.
- Un asesor no ve ni puede tocar (404) la tarea de otro; el Coordinador sí.
- Una tarea de la organización A es invisible para B (RLS, FK compuestas).
- Crear/editar/marcar tareas no crea mensajes ni llama a Meta.
- La migración se aplica dos veces seguidas sin error.

## Qué NO se hace (y por qué)

- No se renombra la clave `agenda` ni se migran citas: evitar tocar datos de
  organizaciones existentes.
- Sin recordatorios por WhatsApp/notificaciones de vencidas, sin tareas
  repetitivas ni subtareas: mantenerlo simple (lista tipo recordatorios).
- Sin tiempo real (SSE) en Tareas: la lista se refresca al volver a la
  pestaña; suficiente para una lista de pendientes.
- Notas: en el PR 2.
