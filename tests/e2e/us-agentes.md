# Guion E2E — 031: Laboratorio como Centro de Agentes

> Automatizado: `pnpm test:e2e:agentes` (`scripts/e2e-agentes.mjs`), contra la
> app viva con los mocks (wa-mock + ai-mock). Corre también en CI (job
> `e2e · dos organizaciones`, paso «e2e de agentes»). El ai-mock contesta
> «¿quién eres?» con la identidad que le dio el prompt: así se sabe QUÉ agente
> respondió.

## PR A1 (API; las pantallas llegan en A2)

1. **El general de siempre.** `GET /api/lab/agents` → exactamente un agente
   general, publicado. `GET /api/agent/profile` conserva su forma (y suma
   `displayName` y `hasUnpublishedDraft`).
2. **Agente nuevo sin nombre.** `POST /api/lab/agents {internalName}` → 201,
   borrador, `displayName: null`.
3. **Vista previa con el formulario sin guardar.**
   - «¿quién eres?» → «…sin nombre propio».
   - «lo compro» → chip «Movería a Interesado» + burbuja; «Por qué respondió
     así» trae la acción y las entradas de KB.
   - «quiero hablar con un asesor» → escalaría, sin gastar IA.
   - ✅ El outbox del wa-mock sigue VACÍO; mensajes, leads y conversaciones
     no cambian; el borrador no se guardó.
4. **Borrador vs. publicado.** Guardar → «Borrador»; publicar → versión en
   el historial; editar → «Cambios sin publicar»; restaurar la versión → al
   BORRADOR (producción no cambia). El general no se archiva (409).
5. **Evaluar este agente (borrador).** `POST /api/lab/runs {agentId,
   source: "draft"}` → 202; al terminar, el historial dice qué agente y qué
   versión se evaluó, y la tarjeta muestra su última evaluación. `POST
   /api/lab/runs` sin cuerpo sigue evaluando al general publicado.
6. **Producción idéntica.** Con el agente encendido, un mensaje real
   («¿quién eres?») lo contesta el GENERAL con su nombre de siempre, no el
   agente del Laboratorio.
7. **Límite** de la vista previa: la petición 31 del minuto → 429
   `preview_rate_limited`. Archivar el agente de prueba → ya no aparece.

## PR A2 (pantallas) — hecho

Con navegador real (`scripts/e2e-agentes.mjs`, sección 5b):

1. **Menú.** Con Laboratorio encendido y permiso, «Agente» sale del menú
   lateral; `/agent` sigue editando al general y trae «Gestionar todos los
   agentes → Laboratorio». Sin Laboratorio (apagado, sin permiso u oculto por
   el Propietario) «Agente» se queda.
2. **Lista** (`/lab`, pestaña Agentes): el general fijo arriba con su insignia;
   «Crear agente» pide el nombre interno y abre el editor.
3. **Editor** (`/lab/agents/[id]`): formulario a la izquierda y vista previa
   tipo chat a la derecha (en el teléfono, pestañas Configurar / Probar). La
   vista previa usa lo que hay en el formulario aunque no esté guardado, muestra
   chips y «Por qué respondió así», y no manda nada a WhatsApp.
4. **Borrador / publicar:** guardar no publica; publicar abre un resumen;
   renombrar; «Cargar al borrador» (D8) no toca lo publicado.
5. **Hacer general:** el diálogo advierte que cambia lo que recibe el cerebro
   externo (`/api/bot/profile`); cancelar no cambia nada.
6. **Evaluaciones** (`/lab/evaluaciones`): selector de agente y de versión
   (borrador / publicada); el historial dice qué se evaluó.
7. **Archivar** desde la lista (el general no se archiva).

Sin migraciones; Bandeja y Campañas se ven igual (capturas antes/después).

## PR B (por etapa) — `scripts/e2e-agentes.mjs`, sección 7

1. Un borrador no se puede asignar (409 `not_published`) ni aparece en el
   selector.
2. `/lab/asignacion`: asignar un agente publicado a «Interesado» desde la
   pantalla; cambiarla pide confirmación (la API responde 409 `stage_taken`
   con quién la atiende) y cancelar no cambia nada.
3. Un lead nuevo (primera etapa) lo contesta el general → moverlo a
   «Interesado» → contesta el agente de la etapa → la Bandeja muestra
   «Atiende: …» → de vuelta a la primera etapa contesta el general → la línea
   de tiempo registra los dos relevos (uno por cambio).
4. Con el módulo `lab` apagado contesta el general aunque la etapa tenga
   agente (se apaga directo en `organization_module`; `/platform` hace lo
   mismo y lo prueba `e2e-modulos`).
5. Archivar el agente asignado: la pantalla avisa que la etapa vuelve al
   general y contesta el general.
