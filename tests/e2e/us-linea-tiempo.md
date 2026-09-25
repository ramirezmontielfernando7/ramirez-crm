# Guion E2E — Menú colapsable, panel de Detalles y línea de tiempo

> Automatizado en `scripts/e2e-linea-tiempo.mjs` (`pnpm test:e2e:linea`, app
> viva en `pnpm dev` con los mocks, después de `pnpm test:e2e` y
> `pnpm test:e2e:roles`). Spec: [022](../../specs/022-linea-de-tiempo/spec.md).
> Re-ejecutable: cada corrida usa un teléfono nuevo y deja las preferencias
> del menú en su default.

Tres personas a la vez: propietario, asesor A y asesor B.

1. **Un chat y su historia.** Entra un lead por el wa-mock. El propietario
   anota (una nota larga), una nota vacía → 422, lo asigna a A, pausa y
   reactiva la IA, marca leído, marca el consentimiento y mueve la etapa. La
   línea de tiempo trae nota, asignación, pausa, reactivación, consentimiento
   y etapa, lo más reciente primero, con autor; marcar leído no deja rastro.
2. **Quién ve qué.** A (asignado) → 200 y ve también la nota de ANTES de que
   el chat fuera suyo. B → 404 al leerla y al anotar.
3. **Resultados.** A → `/api/analytics/sales` 403; el propietario 200.
4. **Preferencia del menú.** Sin guardar → `null`; se guarda por usuario (no
   se le cambia a otro); un valor inválido → 422. `navMode: "hidden"` se
   guarda y deja `navCollapsed: true`; un modo que no existe → 422.
5. **Navegador — propietario.** Menú abierto con Resultados; su animación no
   pasa de 300 ms. Colapsar → íconos; recargar → sigue colapsado (persistió);
   el avatar abre la tarjeta con nombre y rol; tercer clic → oculto: el menú
   desaparece, "Mostrar el menú" va en la fila del título "Bandeja"
   (mismo centro vertical, a su izquierda) y la columna empieza en el borde; recargar →
   sigue oculto; cuarto clic → expandido y el botón flotante se va. Filtros
   de la Bandeja: una cápsula ("Todas 26") y "Seleccionar varios" en la fila
   del título, sin fila de cápsulas; la cápsula despliega Mostrar, Etapa y
   Quién atiende; elegir "No leídas" cierra el panel y la cápsula lo dice;
   "Quitar filtros" vuelve a Todas. Panel en orden
   Asignación → Etapa → Más detalles → Actividad; "Más detalles" plegado y,
   abierto, Mensajes masivos → Etiquetas → Ficha. "Ver historial de
   asignación" existe y abre el historial. Actividad: "Nota añadida por…",
   "Asignado a … por…", "IA pausada en esta conversación por…"; la nota larga
   en una línea y "ver más" la abre en su lugar. Añadir nota desde el panel:
   aparece arriba sin recargar y el campo se vacía. **Camino infeliz:** la API
   de notas responde 500 → se muestra el error y el borrador se conserva. Sin
   errores de JS.
6. **Navegador — asesor.** Menú colapsado de entrada, sin Resultados; el
   ciclo sigue (íconos → oculto → expandido) y expandido tampoco hay
   Resultados. Sin "Ver historial de asignación", pero su Actividad
   trae la asignación y la nota de antes. El switch de IA sigue ahí.
   `/results` → Bandeja. Sin errores de JS.
