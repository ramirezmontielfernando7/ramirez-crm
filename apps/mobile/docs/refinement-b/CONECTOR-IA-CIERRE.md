# Conector ficticio · 131/158

Base beb6cb36b58cd19d42784fa320faa727ca06e682, misma rama B. SET-12/11/11A completas en simulación local y QA RN Web; 27 pendientes.

SET-12: Propietario configura conector, roles permitidos, tope por usuario/día UTC (1–1000) y capacidades avanzadas. Confirmaciones al retirar permisos o conceder capacidades. SET-11: autorización explícita ficticia Claude/ChatGPT, nombre, renombrado, revocación y reautorización. Dirección example.invalid y copia solo simulada; sin OAuth, enlaces, clipboard nativo, tokens o red. SET-11A: actividad personal por organización con enum de acción y fecha, nunca mensajes ni datos de clientes.

Reutiliza TeamRepository y almacenamiento protegido ligado al rol. Política por organización, conexión por usuario/rol, revalidación al actuar; cambio de rol exige nueva autorización. Cola por organización, revisiones contra conflictos, difusión de revocación a instancias abiertas y snapshots inmutables. Cuota compartida entre proveedores, recibos idempotentes y registro acotado que se detiene al llenarse (200 conexiones/2000 acciones), sin eliminar historial para reiniciar cuotas. El laboratorio evalúa permisos y registra propuestas; no ejecuta funciones de Asistente, tareas, mensajes, campañas, exportaciones, IA ni créditos.

528 pruebas aprobadas (13 nuevas), TypeScript y formato correctos. Cubren roles/alcance, sesión/restauración, renombrado/revocación, roles cambiados, cuotas/UTC/reintentos, capacidades, instancias simultáneas, fallo de guardado y revocación durante IO con reversión. QA RN Web: 12 capturas y 6 referencias, ambos temas y tamaños; conectar/renombrar/revocar/cancelar, cuota, validación y fallo/reintento, Asesor denegado y actividad aislada. Sin errores JS ni solicitudes de red. Capturas/galería en evidence/ai-connector. Router, sesión y storage del host web son dobles; nativo e integración real pendientes.

Sin cambios a tokens/B, dependencias, APK/firma, backend, main o producción. Sin servicios, servidores, Gradle, push ni costes. Sigue el lote seguro MKT-20/21/22 con catálogo compartido con Chat; no campañas ni sincronización reales.
