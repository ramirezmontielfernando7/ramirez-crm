# Lote 04 · Resultados ficticios

Desde el lote Tareas/Notas `f86fe39548c81f9c28784459b14f1ba43be11339`, misma rama B. **RES-01/RES-02 implementadas; 76/158 IDs, 82 pendientes**. No se cuenta Más por añadir un acceso.

## Comportamiento

Ventas y embudo, Atención, Origen: cálculos sobre un registro de hechos históricos ficticios e inmutables, no tarjetas con números independientes. Ventanas de 7/30 días y mes actual; rango personalizado inclusivo y asesor activo; validación de fechas, orden y máximo de 366 días. Zona del negocio de demo: America/Cancun, explícita y separada del huso del teléfono.

Los totales de 30 días reproducen las muestras aprobadas: $26.200 ganados, 9 tratos, 24% de cierre, ticket $2.911, $63.900 abiertos, 38 prospectos, 174 respuestas del agente, 38 handoffs y 2 min de respuesta. Se calculan por hechos y cambian al filtrar. Asistencia: 19 asistentes de 22 citas programadas (86%, canceladas incluidas en el denominador). Dinero en centavos enteros; división sin datos produce cero o «—», nunca NaN ni promedios inventados. La variación respecto al periodo anterior solo aparece si existe base comparable; no se finge el +18% de la captura cuando no hay historia previa.

Este historial simulado no es un registro financiero sincronizado del Pipeline actual ni envía eventos a Meta. No existe conexión con atribución, campañas, proveedores, telemetría o producción. Los filtros y la pestaña se conservan al salir y volver durante la sesión. Propietario/Coordinador pueden consultar; Asesor tiene denegación por ruta y por operaciones del modelo.

La ruta `results` es interna, sin TabBar. Mantiene encabezado interno y controles B autorizados; mismas paletas y fuentes. Los campos de fechas se despliegan en la hoja utilizando controles ya existentes. Sin nueva dependencia.

## Verificación

- **266 pruebas de lógica aprobadas**, 12 nuevas de Resultados y las 254 anteriores.
- TypeScript y formato aprobados.
- **20 capturas de implementación**: dos IDs (8), Atención/Origen (8) y cuatro estados (4). **4 referencias oficiales**, ambos temas; 390×844 y 360×640.
- Siete comprobaciones agrupadas en RN Web offline: tres secciones, Más→Resultados, recálculo de periodos, fechas inválidas/borrador, asesor, conservación al visitar Tareas, scroll real por sección, denegación a asesor/acceso coordinador y estados/reintento. Cero errores y solicitudes de red.
- Regresión ampliada de Tareas: navegación desde y hacia Resultados con 30 tareas adicionales, comprobando `scrollTop` real y creación en TaskSheet de contacto. Diez comprobaciones agrupadas, cero errores/red. La restauración usa dos frames y bloquea eventos de arranque para no reemplazar el offset guardado por cero. No se añaden timers permanentes.
- Galería comparativa: `evidence/results/comparacion.html`. La comparación señala diferencias funcionales de datos/periodos; no declara igualdad de píxeles con un prototipo estático.

QA de navegador con UI/proveedores/capas reales y dobles de sesión/router/almacenamiento. No prueba Expo Router completo, Android/iOS, teclado nativo ni FPS. Pendiente validar texto ampliado, screen readers y scroll nativo después de instalar una APK nueva.

## Seguridad y conservación

Solo `apps/mobile`; sin cambio de backend reservado, APK, certificados, lockfile o dependencias. No Gradle por almacenamiento insuficiente. Sin push, servicios reales, arranque de backend/BD, conexión Android, migraciones, despliegues ni costos.

Siguiente dependencia segura para continuar: **Conocimiento LAB-10…12** sobre la Biblioteca local existente, compartiendo la fuente de los documentos marcados Lectura IA. No activar RAG real, agentes, indexadores, red ni trabajos del backend.
