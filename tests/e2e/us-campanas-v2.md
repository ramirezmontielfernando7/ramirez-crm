# US — Campañas v2 (PR 2): audiencias, asistente y cola por número

Automatizado en `scripts/e2e-campanas-v2.mjs` (`pnpm test:e2e:campanas-v2`).
App viva con los mocks y el módulo Campañas encendido para la organización.
El wa-mock decide por el final del número: `55500` tarda 700 ms, `13100`
responde 131000, `00000` 131026, `31049` 131049, `42900` 130429 la primera vez.

1. **Audiencias.** Un .xlsx con encabezados que no se reconocen («Persona»,
   «Móvil 1») → la vista previa pide «¿qué es cada columna?». Con la
   asignación: 3 válidas, 1 inválida (marcada con motivo), 1 duplicada, y
   «Cupón» como columna para variables. Excel con macros, .xlsm u otro
   formato → 415. Sin declaración de consentimiento → 422. Con ella → 201,
   3 contactos `opt_in`, etiqueta de la importación. Las filas con error se
   descargan en CSV protegido contra fórmulas. Archivo de ejemplo .xlsx y
   .csv.
2. **Revisar.** Con la base y {{2}} = columna «Cupón»: recibirán 2;
   excluidos 1 sin valor de variable, 1 inválido, 1 duplicado. Sin tarifa no
   hay costo; con tarifa 0.5 MXN → 1 MXN «Estimado». Viaja la zona horaria.
3. **Prueba y envío.** Prueba a un número propio con las variables de un
   destinatario real; otra seguida → 429; no cuenta en la campaña. Enviar →
   2 enviados con {{1}} = nombre de pila y {{2}} = su cupón.
4. **Pausar a mitad.** Base de 8 números lentos; pausar a los 2 → en pausa
   no sale nada más; pausar otra vez → 409; reanudar → termina; cada número
   recibió exactamente UNA plantilla.
5. **Programar.** Mañana 09:30 (hora del negocio) → `scheduled`; en el
   pasado → 422; pausar y reanudar → vuelve a esperar su hora; cancelar → 2
   omitidos.
6. **Pausa de seguridad.** Tope 50 % sobre 10 intentos; 25 números que
   fallan → se pausa sola con el motivo en español sin quemar la base, y
   aparece en los avisos de la app.
7. **Asesor.** Sin acceso: 403 en campañas, audiencias, estado, ajustes y
   archivo de ejemplo.
8. **Interfaz.** Pestañas Campañas / Audiencias / Métricas; aviso de pausa
   de seguridad; Métricas con su aviso. Subir un .xlsx, asignar columnas,
   ver la inválida en rojo, declarar el consentimiento e importar. Asistente:
   paso 1 con el conteo, paso 2 con la burbuja de WhatsApp, paso 3 con costo
   «Estimado», margen del límite y prueba; programar, pausar a mano (con
   motivo) y cancelar.

Fuera del guion (cubierto por `tests/db/cola-campanas.test.ts`, BD real):
dos despachadores sobre el mismo número, reclamo atómico concurrente,
recuperación tras un reinicio sin reenviar lo incierto, y el programador.
