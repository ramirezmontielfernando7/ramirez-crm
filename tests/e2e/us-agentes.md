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

## PR A2 (pantallas) — pendiente

Lista de agentes, editor de dos columnas con la vista previa, diálogo de
publicar, historial, `/lab/evaluaciones` con selector y `/agent` con el
formulario compartido.

## PR B (por etapa) — pendiente

Crear agente sin nombre → vista previa → publicar en «Interesado» → un lead
en «Interesado» recibe respuesta de ese agente → moverlo a «Nuevo» → responde
el general → la línea de tiempo registra el relevo → apagar `lab` desde
`/platform` → responde el general.
