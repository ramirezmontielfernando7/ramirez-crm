# Resultados T-M3 · 11 de noviembre de 2026

T-M3 implementada con datos y transporte ficticios. **INB-11…18, INB-27, INB-28 e INB-29**: 11 IDs. T-M1 (12 IDs) y T-M2 (10 IDs) se conservan; cobertura global de simulación: **33/158**, quedan 125. No se inició T-M4. El cierre de calidad nativa necesita dispositivo/emulador.

## Comprobaciones

| Comprobación | Resultado |
|---|---|
| TypeScript estricto | Pasa |
| Pruebas de código | 37 pasan: 18 de base y 19 de chat |
| Formato | Pasa |
| Dependencias Expo 58 | Compatibles tras actualizar los parches recomendados; lockfile independiente |
| Chromium / React Native Web | 27 pruebas únicas pasan; 12 de Chat repetidas tras los últimos ajustes visuales, sin sumarlas otra vez |
| Capturas | 49 RN Web: 44 de matriz, 4 estados y 1 ancla; comparadas con 22 referencias oficiales |
| Bundles Hermes Android/iOS | Generados: Android 5,409,485 bytes; iOS 5,420,966 bytes. No son APK/IPA ni ejecución nativa |
| APK local | No generada: el script sale con código 2; falta Android SDK Platform 37 |
| Emulador / dispositivo / iOS | No disponibles; no probados |

Las pruebas de chat cubren límite exacto de 24 h, cierre durante encolado, plantillas/variables, biblioteca restringida, páginas concurrentes, cursor recuperable, identidad de objetos, fechas estables horas después, 1.000 mensajes ordenados, alcance del asesor, borradores serializados, fallo/corrupción de almacenamiento, estados de entrega, confirmación perdida, reintentos multipartes con Unicode, límites de texto/archivos, borrador escrito durante el envío, eliminación por rol y reconexión sin duplicar eventos. También se verifica que un contacto nuevo empiece sin mensajes y con ventana cerrada.

Los recorridos web conservan las 15 pruebas anteriores y añaden 12 de T-M3: matriz visual (4), borrador/reintento (1), ventana/plantilla (1), adjuntos/visor/regreso (1), respuestas rápidas/redacción (1), paginación/error/virtualización (1), roles/eliminación persistente (1), ancla de historial (1) y estados de carga/vacío/error/offline (1). La matriz registra errores JavaScript y solicitudes HTTP externas; se comprueba ausencia de desborde horizontal. Las comprobaciones táctiles de T-M1 se conservan.

## Rendimiento y desplazamiento

- Repositorio de Bandeja: 2.000 conversaciones ficticias, sin reemplazar la arquitectura T-M2.
- Historial por chat: 1.000 registros generados bajo demanda, 20 iniciales + páginas de 40. La prueba pura carga todos sin huecos ni duplicados. El tiempo de CPU local está en `evidence/unit.log`; no mide un teléfono.
- En Chromium 390×844, 25 nodos de mensaje montados (incluidos los ocultos) para 100 mensajes cargados; umbral de regresión <80. No se dibujan los 1.000 registros de golpe.
- La misma fila del historial queda a 191,80 px antes, después de anteponer una página y después de recibir un mensaje. Las medidas exactas están en `evidence/scroll-metrics.json`.
- Bandeja: 17 filas montadas de 2.000; tras scroll de 3.000 px, la misma conversación vuelve a 274 px antes / 274 px después. Filtros, búsqueda y selección siguen conservándose.
- Regresar del visor conserva la posición de su imagen. El historial ofrece «mensajes nuevos» sin saltar al final cuando se está leyendo arriba; pulsar el aviso sí lleva al final.
- No se midieron FPS, memoria nativa, batería ni rendimiento con teclado real. No se afirma equivalencia con WhatsApp.

## Correcciones y diferencias durante QA

Se ajustaron el contraste de etiquetas IA, los separadores de fecha, los indicadores de IA/etapa en cabecera y la hoja de redacción para acercarla a la referencia. El borrador no se modifica al seleccionar un tono hasta aplicar; su vista previa se puede editar y deshacer. Una prueba que intentaba acceder al compositor desde el árbol de accesibilidad mientras estaba abierto un modal se corrigió para comprobar su valor DOM: el fondo está correctamente oculto. La prueba de Enter coloca explícitamente el cursor al final del texto.

Las compilaciones y las pruebas de navegador se separaron tras detectar contención del host al ejecutarlas simultáneamente. Los intentos interrumpidos o con tiempos de espera no se cuentan como pruebas aprobadas. La regresión de las 27 pruebas pasó con los parches de Expo actuales. Se repitieron las 12 de Chat sobre el bundle web final tras ajustar las hojas y el contraste del error; los últimos cambios afectaron a la presentación de las hojas y del mensaje fallido de Chat. Los dos informes se conservan por separado en evidence. La comparación visual, incluidas las diferencias del menú T-M4 y las muestras, se explica en `IMPLEMENTACION.md` y `comparacion.html`.

## Pendientes

- Android/iOS: teclado abierto/cerrado, rotación/insets, Back/gestos reales, pinch/pan, TalkBack/VoiceOver, texto del sistema al 130%, rendimiento y terminación/restauración del proceso. Las pruebas web no sustituyen esto.
- Para APK: checkout limpio T-M3 + Node 24 + JDK 17 + SDK/Platform/Build-tools 37, platform-tools, NDK y CMake indicados en `../APK-LOCAL.md`. Ejecutar `npm ci`, comprobaciones y `npm run apk:local`; inspeccionar identidad/firma antes de instalar. No se usó EAS.
- Historial saliente en memoria, caché de ocho chats y máximo 128 envíos por chat/sesión. Borradores y vaciado sí persisten; no hay outbox duradero ni entrega real. Adjuntos, cámara, contacto, GPS, redacción y compartir siguen siendo muestras locales.
- T-M4 permanece pendiente. No se implementaron detalles, asignación, etapas, etiquetas ni conexión de otros números desde el Chat.

## Aislamiento y conservación

Rama `codex/dashfort-mobile-tm3-20261111` desde `6b4cccf6e80fd3d7810194985e0d81b25fdd5b48`. Historial T-M1 y T-M2 conservado como ancestro. Solo `apps/mobile`; ningún cambio en main, CRM web, backend, TWA, infraestructura, Coolify, Hetzner o producción. Sin secretos, datos reales, mensajes externos, push, PR, merge, tag, release, workflow manual, despliegue ni servicios con costo. Los nombres/contactos de las capturas son muestras del diseño/repositorio de demo.

Commits de núcleo: `dd1c1bb`, `4e9186e`; dependencias/APK: `a7919dd`. UI, navegación y pruebas de interfaz: `c487070`. La documentación y evidencia se guardan en el commit final de cierre. Ver `CONSERVACION.md` para respaldo local y restauración.
