# US — Campañas v2 (PR 2): audiencias, asistente y cola por número

Automatizado en `scripts/e2e-campanas-v2.mjs` (`pnpm test:e2e:campanas-v2`).
App viva con los mocks y el módulo Campañas encendido para la organización.
El wa-mock decide por el final del número: `55500` tarda 700 ms, `13100`
responde 131000, `00000` 131026, `31049` 131049, `31050` 131050 (038), `42900`
130429 la primera vez.

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
7b. **Métricas (PR 3).** Ana responde a «Cupones» → cuenta como respuesta
   (ventana de 72 h de `campaign_settings`). Tras correr la sincronización
   (ruta de mocks): la campaña aparece en la tabla comparativa con 2
   enviados y costo Estimado 1; KPIs del periodo, fallidos con motivo en
   español, serie con todos los días; «Reportado por Meta» en MXN junto al
   estimado, con la diferencia; analíticas de plantillas al día. Otro
   número → 0; periodo inválido → 422; CSV con la campaña y el total. Con
   las analíticas de plantillas «no activas» en la WABA: se avisa y los KPIs
   y el costo reportado siguen.
7d. **Marketing (038, PR 6).** Las secciones 1–7c corren con el tope de
   frecuencia en 0 (mandan varias campañas a las mismas personas a
   propósito). Ajustes de envío: 7 días se guardan, 91 → 422, guardar sin el
   campo conserva el valor. Base de 3; campaña de marketing: 2 enviados y el
   que termina en `31050` falla con 131050 (respuesta del envío) → queda
   marcado sin tocar su `opt_in`. El estado `failed` 131050 por el webhook
   marca a otro y lo anota en la línea de tiempo. Otra campaña de marketing a
   la misma base: 0 recibirán (2 bajas 131050, 1 con marketing reciente) y
   lanzarla → 422 con el motivo. Una de UTILIDAD a la misma base: les llega a
   los 3. Tope en 0: el reciente entra, las bajas siguen fuera; quitar la
   marca a mano lo devuelve. Meta pausa la plantilla (webhook PAUSED,
   LOW_QUALITY) → la campaña programada queda en pausa automática con el
   nombre de la plantilla y el motivo, aparece en los avisos y no se puede
   crear otra con esa plantilla (422); Meta la reactiva → la campaña NO se
   reanuda sola.
8. **Interfaz.** Pestañas Campañas / Audiencias / Métricas; aviso de pausa
   de seguridad; Métricas con KPIs en %, costo «Estimado» junto a
   «Reportado por Meta», tabla de campañas, aviso de analíticas no activas,
   tarjeta «Salud del número» y descarga del CSV. Subir un .xlsx, asignar columnas,
   ver la inválida en rojo, declarar el consentimiento e importar. Asistente:
   paso 1 con el conteo, paso 2 con la burbuja de WhatsApp, paso 3 con costo
   «Estimado», margen del límite y prueba; programar, pausar a mano (con
   motivo) y cancelar. 038: «Frecuencia de marketing» en Ajustes de envío
   (7 días); en el panel del contacto, el aviso 131050 y «Volvió a aceptar
   promociones» lo quita.

Fuera del guion (cubierto por `tests/db/cola-campanas.test.ts`, BD real):
dos despachadores sobre el mismo número, reclamo atómico concurrente,
recuperación tras un reinicio sin reenviar lo incierto, y el programador.
038 (PR 6) en `tests/db/campanas-marketing.test.ts`: la re-verificación AL
ENVIAR (otra campaña de marketing llegó antes o Meta avisó 131050 desde el
lanzamiento → omitido sin llamar a Meta), un envío que Meta rechazó no cuenta
para la frecuencia, y la plantilla pausada contra campañas de otras
plantillas.

**Etiqueta para todos los contactos de la base** (`scripts/e2e-campanas-v2.mjs`,
secciones 7c y 8). En «Archivo nuevo», debajo de «Nombre de la base», el campo
opcional «Etiqueta para todos los contactos de esta base»: elegir una existente
o crear una nueva (nombre y color). Se SUMA a la etiqueta automática
«Import: archivo» y a las de la columna «etiquetas»; vacío = como siempre.
Contacto existente: solo gana la etiqueta (sin perder datos ni etiquetas, sin
duplicados). Filas inválidas o duplicadas no la reciben. Nombre repetido → 409,
color fuera de la paleta → 422, id ajeno → 404; crear una nueva exige
`tags.manage` (403 antes de la BD). Se ve en la cápsula de etiquetas de la
Bandeja.
