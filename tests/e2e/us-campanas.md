# Guion E2E — Etiquetas, consentimiento, CSV y campañas

> Automatizado en `scripts/e2e-campanas.mjs` (`pnpm test:e2e:campanas`, app
> viva con los mocks y `CAMPAIGNS=on`). Spec: [021](../../specs/021-campanas/spec.md).
> Re-ejecutable: cada corrida usa etiquetas, plantilla y teléfonos nuevos.

Con `CAMPAIGN_BACKOFF_SCALE=0.01` la pausa por límite de Meta dura
milisegundos en vez de segundos.

1. **Etiquetas.** Crear, renombrar, duplicado → 409, nombre vacío → 422.
2. **Importar CSV.** Un archivo con `;`, encabezados en español, BOM, una
   fila vacía, un teléfono de 10 dígitos y uno repetido. Resumen: 5 creados,
   2 no importados con su línea y motivo, 1 fila vacía; todos con la etiqueta
   `Import: <archivo>` y las de su columna `etiquetas`. Sin columna de
   consentimiento → `desconocido`.
3. **Errores de archivo, específicos.** Sin columna `phone` → 422 que nombra
   la columna; un .xlsx → 415; extensión no CSV → 415; más de 5 MB → 413.
4. **Re-importar.** Un `opt_out` que el CSV marca `opt_in` sigue `opt_out`
   (aviso en el resumen); el nombre existente no se pisa.
5. **Filtrar y exportar.** La lista por etiqueta y por consentimiento; el CSV
   exportado con esos filtros trae exactamente esos contactos, con etiquetas y
   `waConsent`, y se puede volver a importar.
6. **Plantilla no aprobada.** Crear una campaña con ella → 422.
7. **Público.** El resumen dice 3 elegibles (opt_in) y 2 fuera por
   consentimiento (1 de ellos opt_out). El cliente no puede pedir otro
   consentimiento (422).
8. **Enviar.** Variables mal contadas → 422. Lanzar → 202 y el envío corre en
   segundo plano; lanzar dos veces → 409.
9. **Resultado.** 2 enviados y 1 fallido «no tiene WhatsApp (131026)». El
   número con límite de Meta (130429) se reintentó y SÍ se envió. El wa-mock
   recibió exactamente 2 plantillas, con `{{1}}` = nombre de pila; ninguna a
   los `desconocido` ni `opt_out`. Los mensajes aparecen en la Bandeja.
10. **Log.** `?status=failed` trae al fallido con su motivo; el CSV descarga.
11. **Sin consentimiento, sin envío.** Una campaña cuyo público no tiene
    ningún opt_in → 422 `no_recipients` y queda en borrador; se puede borrar.
    Una campaña enviada no se borra (409).
12. **Borrar etiqueta.** Sus contactos siguen existiendo, sin esa etiqueta.
