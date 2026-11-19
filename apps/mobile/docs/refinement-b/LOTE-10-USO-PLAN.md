# Lote 10 · Uso y plan, solicitud y límites del asistente

Desde cec3612de3bed61682bb6906bb193155035a2cc5, rama B autorizada. MORE-06/07/09/10 y AST-04 implementados: **102/158 IDs, 56 pendientes**.

Uso y Plan comparte documento de Estudio: mantiene 42 % global y 34 % del asistente por defecto. Cinco escenarios de laboratorio permiten comprobar advertencia 80 %, límite personal, límite de organización y falta de tope; no son selectores añadidos al producto. El desglose suma el total; documentos, personas y almacenamiento se derivan de los repositorios ficticios existentes. Por ello muestra 3 documentos y ~3 MB, en lugar de inventar los 30 documentos/1.1 GB de la maqueta. Las consultas locales no consumen IA ni incrementan facturación.

Catálogo Esencial/Pro/Ultra con precios ficticios según referencia. Solicitar confirma, guarda solo una intención local por plan y permite cancelar o reintentar un fallo de escritura. Nunca cambia la suscripción ni contacta a Demfort, correo, WhatsApp o proveedor de pagos. El texto del modal explica esa diferencia respecto a la maqueta.

Aviso de ritmo: proyección por fecha empresarial de Cancún, solo al abrir Más o Uso con ritmo de agotamiento antes del fin del mes. Reclamo atómico para no duplicar entre navegaciones concurrentes; persistencia semanal, posposición explícita tres días, sin temporizador ni procesos de fondo. Fallo de guardado no consume la cadencia. Si se abandona la pantalla durante el guardado, se considera reclamado y no se vuelve a mostrar inmediatamente; se prioriza evitar avisos duplicados. El reinicio de mes vuelve a una muestra normal y conserva solicitudes. No representa métricas de producción.

AST-04 bloquea las respuestas del asistente al alcanzar el límite personal o global o no tener tope configurado. El límite global también evita respuestas automáticas de agentes de demostración; las pruebas deterministas siguen sin consumo. Renovación calculada para el mes siguiente, enlace funcional a Planes. Propietario exclusivamente; enlaces y operaciones de Coordinador/Asesor rechazados.

**Verificación:** 369 pruebas de lógica aprobadas (18 nuevas), TypeScript y formato aprobados. QA RN Web offline: 28 capturas reales, 10 referencias originales y 5 comprobaciones agrupadas; ambos temas y 390×844/360×640 para los cinco IDs. Prueba cancelación, solicitud local, error/reintento/idempotencia, estados de datos, límite, enlaces y roles. Galería en evidence/usage/comparacion.html. Sin solicitudes de red, servidor ni errores de página.

B original, fuentes, tokens e iconos compartidos conservados. Sin dependencias nuevas. Android/iOS pendientes: desplazamiento, accesibilidad nativa, gestos, áreas seguras y navegación con Expo Router real. La QA usa componentes RN y capas reales con dobles de router/sesión/almacenamiento; no acredita esos aspectos nativos.

APK 0.1.2 y firma intactas, configuración futura 0.1.3/versionCode 4 sin recompilar (~1.5 GiB libres). Sin backend, servicios, pagos, IA real, push/PR/merge/despliegues. Próximo lote seguro: MORE-05 Avisos y SET-14 preferencias, manteniendo silencio de las pruebas locales T-M5B y push remoto desactivado.
