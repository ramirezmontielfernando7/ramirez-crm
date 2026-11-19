# Lote 09 · Evaluaciones y destino funcional del asistente

Desde el lote Asignaciones `56a98a1`, misma rama B. **LAB-30/31 y AST-01/02/03 implementados: 97/158 IDs, 61 pendientes.** Primero se completó Evaluaciones y su enlace con contexto; después se verificaron los controles completos del asistente según las maquetas. AST-04 y el shell Más siguen pendientes, no se suman.

## Evaluaciones LAB-30/31

Seleccionar borrador o última versión publicada y 3/5/8 clientes. La simulación es determinista, local y explícita: no llama IA, proveedores o API ni consume crédito. Hay resultados Bien/Revisar/Falló; datos, transcript y calificación corresponden a la configuración elegida. No se inventan respuestas de un proveedor real.

Cada ejecución guarda un snapshot inmutable de configuración, revisión, origen y versión, y una lista de resultados. Cambios posteriores del agente no alteran la prueba original. Repetir usa el borrador guardado actual y conserva el intento original más los cuatro más recientes; se etiqueta como repetición de borrador. Cada intento conserva configuración, revisión, fecha, respuesta, decisión, calificación y hasta doce fuentes indexadas permitidas. Máximo 20 ejecuciones locales; no se presenta ese límite como historial ilimitado ni rendimiento nativo.

El arreglo propuesto se guarda **solo en el borrador**, con comprobación de revisión. El caso de descuento y el de disponibilidad de cita tienen reglas distintas; repetir permite comprobar el arreglo y conserva la evidencia del fallo previo. No altera ninguna publicación ni envía mensajes a clientes. Errores de almacenamiento mantienen resultado y borrador anteriores para reintentar.

«En el asistente» crea un hilo con el identificador de ejecución/resultado, resumen, agente y versión de origen. El destino responde preguntas locales usando ese contexto y permite regresar al mismo detalle. No es un enlace a un marcador pendiente. El creador también inicia un nuevo borrador si su propuesta anterior ya se publicó; nunca modifica una versión publicada al seguir conversando.

## Asistente AST-01/02/03

Interfaz y controles de las maquetas: encabezado interno con conversaciones y modo, bienvenida, sugerencias, compositor, propuestas Aplicar/Descartar, hilos y opciones Rápido/Normal/Profundo. Mantiene B, paleta, fuentes e iconos reales del proyecto. Las consultas se interpretan con reglas de demostración, sin IA ni crédito real.

- Lee los registros ficticios compartidos de Resultados y Agentes; no presenta una consulta de producción como realizada.
- Etiquetar propone hasta doce conversaciones elegibles del repositorio canónico. **Pedir la propuesta no cambia contactos.** Aplicar valida el conjunto y agrega Seguimiento en una sola actualización de memoria; la operación es idempotente. Un contacto archivado/grupo/campaña o inexistente invalida el conjunto antes de modificarlo. Descartar conserva la conversación y bloquea la aplicación de esa propuesta.
- El estado Aplicado se deriva del repositorio actual. **Las identidades y etiquetas del repositorio de conversaciones siguen siendo de sesión**, como los cambios previos de Inbox/CRM. Al reiniciar no se afirma falsamente que una etiqueta siga aplicada: el estado se recalcula y la propuesta puede volver a estar pendiente. No se representa esto como sincronización o persistencia de backend.
- Hilos propios por usuario/organización, general fijo, crear/seleccionar/archivar, historial local acotado a 20 hilos/40 turnos, ventana de lectura de 90 días para hilos no generales. El borrador de entrada se conserva durante navegación de sesión. Un guardado tardío no restaura como pendiente texto ya enviado.
- El modo se conserva como preferencia local; no cambia un modelo real. El 34% del crédito es una muestra aprobada, no consumo medido ni un cargo.
- Propietario solamente. Coordinador/Asesor rechazados en pantalla y operaciones; restauración de LibraryStore valida el scope del documento antes de exponerlo.

## Verificación

- **351 pruebas de lógica aprobadas**: 12 nuevas de Evaluaciones y 12 del asistente, más las 327 anteriores. TypeScript y formato aprobados.
- Evaluaciones: versión elegida, snapshots inmutables, 3/5/8, reintentos/restauración, validaciones, arreglos en borrador, regla de cita, repetición trazable/acotada, fallos, conflictos, historial y creador tras publicar.
- Asistente: lectura compartida, proponer sin escribir, Aplicar idempotente, Descartar, invalidación sin cambios parciales, hilos, modo, contexto, fallos/reintentos, retención, roles, compatibilidad con documentos anteriores y límites de persistencia de sesión.
- **13 capturas reales + 4 referencias** de LAB-30/31; ambos temas/tamaños y cuatro estados más error de arreglo. Cuatro comprobaciones agrupadas de navegación/comportamiento.
- **16 capturas reales + 6 referencias** de AST-01/02/03; ambos temas/tamaños, propuesta en ambos temas, error de lectura y escritura. Ocho comprobaciones agrupadas.
- Galerías `evidence/evaluations/comparacion.html` y `evidence/assistant/comparacion.html`. No se usan imágenes conceptuales.
- Regresión repetida de Agentes (ocho comprobaciones) y Conocimiento (seis), más CRM/Bandeja/Chat de este ciclo (cinco y 70 capturas). Cero errores de página/cero solicitudes de red. Los informes de regresión conservan los límites de su host.

Toda la QA visual es RN Web/Chromium offline con componentes, proveedores y capas reales y dobles de sesión/router/almacenamiento. No acredita Expo Router completo ni teclado/gestos/scroll/TalkBack/VoiceOver/áreas seguras Android/iOS. Deben probarse al disponer de la siguiente APK.

## Seguridad, APK y continuidad

Solo apps/mobile. Sin dependencias nuevas, modificaciones de tokens/componentes globales B o configuración de compilación. APK 0.1.2, firma y respaldos previos conservados. Configuración 0.1.3/versionCode 4/com.demfort.dashfort.dev preparada, **sin una APK nueva**: ~1,6 GiB libres no permiten el margen conservador de 15 GiB. No Gradle, builds externos, cuotas o costos.

Sin backend, PostgreSQL, workers, migraciones, infraestructura, autenticación/HTTP real, IA, WhatsApp, campañas o mensajes reales, push/PR/merge/despliegue. Backend reservado permanece en 562a8b3.

**Próximo lote exacto por dependencias:** Uso y plan MORE-06, Mejora tu plan MORE-07, solicitud ficticia MORE-09, aviso de ritmo MORE-10 y estado sin crédito AST-04. Debe conservar 42% IA/34% asistente como muestras coherentes, no activar billing, IA, correo o WhatsApp ni contratar recursos. Después Avisos MORE-05 y preferencias SET-14, respetando la separación de simulaciones/locales/push remoto. No se cuenta ninguno de esos IDs en este checkpoint.
