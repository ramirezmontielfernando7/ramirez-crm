# E2E — 033 «Trabajo» (Citas + Tareas + Notas)

Automatizado: `pnpm test:e2e:trabajo` (`scripts/e2e-trabajo.mjs`), con la app
viva, los mocks y `PLATFORM_ORG_ID`. Lo corre el CI («e2e de Trabajo»).

1. Alta de un negocio con perfil **Completo**: nace con Citas (`agenda`) y
   Tareas y notas (`trabajo`).
2. El menú muestra **«Trabajo»** (no «Citas»). Tocarlo abre Citas en la vista
   **Lista** con las pestañas Citas y Tareas; «Trabajo» queda activo.
3. La Asesora escribe una tarea y presiona Enter: aparece en «Mis tareas».
   Toca el círculo: se tacha y sale de pendientes; está en «Hechas».
4. En la Bandeja, en el chat que tiene asignado: «Nueva tarea para este chat»
   abre el formulario ya ligado a la clienta; al guardar, «Abrir chat» vuelve
   a esa conversación.
4b. (PR 2) En ese mismo chat, «Notas de trabajo» muestra la línea de quién ve
   las notas; «Nueva nota» → la nota aparece en el chat, ligada. Tocarla la
   abre en Trabajo → Notas con la misma línea, y «Abrir chat» vuelve a la
   conversación. En Notas: una nota sin ligar dice «Solo tú ves esta nota»; se
   guarda amarilla y se fija arriba («Fijadas»). La Propietaria NO ve esa nota
   privada (404); la Coordinadora sí ve la del chat.
5. La Asesora no ve ni toca (404) la tarea de la Propietaria; la
   Coordinadora ve todas.
6. Ninguna de estas acciones (tareas ni notas) crea mensajes.
7. Sin `trabajo`: Tareas y Notas → 404 (API y página); «Trabajo» lleva a Citas, sin
   pestañas. Solo `trabajo`: «Trabajo» lleva a Tareas y Citas es 404. Sin
   ninguno: no hay «Trabajo» en el menú y `/trabajo` es 404.

Camino infeliz cubierto en `tests/db/trabajo.test.ts`: ligar a un chat
ajeno (422), responsable de otra organización (422), contacto oculto al
responsable que no lo ve, RLS y FK compuestas.
