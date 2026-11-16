# Plan progresivo y autorizaciones

## I1 · Auditoría y contratos (esta entrega)

Objetivo: fijar fuente backend actual, inventariar rutas, separar capacidades existentes de propuestas y preparar interfaces/simuladores. Dependencias: solo repositorio y toolchain móvil ya disponibles. Archivos: `src/integration/{contracts,wire,services,simulation,sync}.ts`, `tests/integration-i1.test.ts` y documentación de esta carpeta. Cambios: ninguno en pantallas, proveedores existentes, dependencias o servidor. Riesgo: confundir el mock propuesto con un backend implementado; comentarios/tipos/tablas lo distinguen.

Pruebas: typecheck, toda la lógica móvil (incluye casos I1), formato, matriz/regresión de navegador y ausencia de imports del módulo nuevo desde runtime aprobado. Aceptación: sin conexión posible, roles desconocidos rechazados, aislamiento, invalidación, generaciones, duplicados/reintentos y parsing comprobados; APK preservada. Reversión: volver a `2bd4b62` o retirar archivos I1, sin migraciones/OTA. Respaldo remoto: requiere autorización explícita; no ejecutado. No iniciar I2 por aprobar I1.

## I2 · Autenticación en pruebas

Objetivo: probar las mismas cuentas con un backend aislado, sin usuarios reales. Dependencias: entorno de pruebas autorizado descrito abajo, decisión cookies/adaptador oficial, bootstrap seguro y política de organización. Archivos móviles propuestos: `src/integration/adapters/auth-test.ts`, vault SecureStore, config allowlist y pruebas nativas de sesión. Fuera de mobile: solo si se aprueba, configuración auth/orígenes y bootstrap/contexto; rutas de selección org si se decide soportar multiempresa. No abrir plugin org bloqueado como atajo.

Pruebas: login válido/inválido/429, vencimiento, refresh single-flight y cookies rotadas, logout offline/online, reinicio, revocación, suspensión, perdido/robado, cambio de org y restauración con respuestas tardías; Android e iOS. Aceptación: ni URL productiva ni datos reales, secretos seguros, autoridad de servidor y aislamiento comprobados en BD real. Riesgo: cookie jar/Origin/CSRF, múltiples cookies y renovación no reflejada en respuesta. Reversión: deshabilitar factory test y revocar sesiones de pruebas; demo sigue siendo default. **Autorización nueva para backend, entorno y cambios nativos si necesarios.**

## I3 · Bandeja y Chat en pruebas

Objetivo: listar/buscar/filtrar, leer historia paginada, recibir sintéticos y responder solo a un emisor mock autorizado. Dependencias: I2; mejora backend de paginación de historial y contrato fiable de reintentos/delta según criterios de producto. Archivos móviles: adapters/inbox-test, chat-test, mappings DTO→modelo, repositorios detrás de puertos, coordinador de revalidación/SSE de primer plano. Fuera: rutas messages/query cursor; journal/tombstones/retención y claves idempotentes; tests servidor/BD. Los nombres nuevos de endpoints se decidirán y versionarán en esa implementación, no se anuncian como ya existentes.

Pruebas: miles de chats, mensajes de igual timestamp, estados actualizados sin mensajes nuevos, páginas concurrentes, duplicados/reordenados, pérdida y recuperación de red, SSE entre snapshots/reinicios/réplicas, reasignación/revocación offline, conflicto y respuesta perdida después de aceptación; accesibilidad, teclado, scroll, LRU y baterías físicas. Aceptación: no saltos/duplicados visibles, no reapertura entre empresas, no autosend incierto, cursor durable seguro o límites del modo legacy expresamente aceptados. Reversión: feature flag test → demo, limpiar caché aislada, mantener schema aditivo/journal con retención; rollback servidor revisado. **Requiere autorización para modificar backend/migraciones y conectar pruebas.**

## I4 · Contactos y Pipeline

Objetivo: ficha, notas internas, etiquetas, asignaciones, montos y etapas sobre datos sintéticos. Dependencias: I3, reglas de conversión monetaria y conflictos/precondiciones. Archivos móviles: adapters contacts/pipeline y pruebas de proyecciones; servidor: compare-and-swap si se aprueba, sin duplicar dominio. Pruebas: asesor pierde/accede a contacto, monto/currency/prioridad, transiciones perdidas con motivo, notas concurrentes, consentimientos y auditoría. Aceptación: servidor valida permisos, cambios compartidos reconciliados y sin enviar notas al cliente. Riesgo: último escritor/mezcla de ficha entre dispositivos. Reversión: apagar módulos de integración test y preservar el estado del servidor de pruebas para diagnóstico. **Autorización separada de escritura y cambios de servidor.**

## I5 · Campañas y demás módulos

Objetivo: integrar progresivamente módulos de MODULOS.md, uno por entrega; comenzar lectura. Dependencias: I2–I4 estables, permisos/módulos y límites explícitos. Archivos: un adapter/servicio/test por módulo; usar APIs existentes, actualizar documentación por capacidad. Cambios fuera: solo carencias concretas aprobadas. Pruebas: permiso por verbo, privados de equipo/Mi número, fechas/UTC, uploads/memoria, límites/consentimientos y acciones repetidas. Aceptación: cada módulo tiene casos y reversión, sin gasto ni envíos reales por default. Riesgos: campañas, IA, calendarios y conectores pueden causar costes o efectos externos. Reversión: flags por módulo, suspensión de jobs de prueba y limpieza controlada sin tocar producción. **Autorizar cada módulo y cualquier llamada a proveedor/coste.**

## I6 · Push remoto completo de pruebas

Objetivo: evento sintético durable → audiencia autorizada → proveedor de desarrollo → teléfono → reautorización y sync. Dependencias: I3 y diseño T-M5A/B; propietarios de proyectos/credenciales de desarrollo autorizados. Archivos: notification remote port, registro de instalaciones, preferencias y response coordinator; servidor: outbox, worker, revocación/TTL/receipts, permisos y métricas. No depender únicamente de EventEmitter.

Pruebas: foreground/background/cold start, denegación/revocación, duplicados, token renovado/inválido, logout/cambio de org, caducidad, Focus/Doze/cierre forzado, proveedor sin respuesta. Aceptación: no contenido sensible, no envío a instalaciones ajenas, consumo medido y límites del SO documentados. Riesgo: no garantía de entrega en todos los estados; cuotas/credenciales/proveedor. Reversión: apagar worker de pruebas, revocar instalaciones y credenciales de desarrollo, conservar locales. **Autorización expresa antes de registrar dispositivos reales, enviar push, crear proyectos o consumir cuotas.**

## I7 · Integración productiva controlada

Objetivo: habilitar un cliente real gradualmente tras pruebas de seguridad y aceptación. Dependencias: I2–I6, revisión operacional, backups/restore y aprobación del propietario. Archivos: configuración de build productivo separada, release plan, métricas y flags de servidor aprobados. Riesgos: migraciones, privacidad, acceso cruzado, mensajes duplicados y proveedores.

Pruebas: tenant/RLS con rol app, matriz completa de permisos, revocación, carga/latencia/recuperación, pentest acotado autorizado, QA Android/iOS, rollback ensayado. Aceptación: criterios objetivos acordados, primer grupo autorizado, logs sin PII, soporte y alertas. Reversión: desactivar acceso móvil/credenciales/flags del servidor, volver al build anterior, operaciones idempotentes y esquema compatible. Las operaciones ya enviadas al exterior no se «deshacen» reinstalando APK. **Autorización productiva específica para cada modificación, migración, despliegue, publicación y proveedor.**

## Requisitos del backend de pruebas (no levantado)

El repositorio ya trae tests de BD, docker-compose.dev.yml y mocks guardados por dev-guard. Son piezas reutilizables, **no un staging móvil listo y desplegado**. No se ejecutaron scripts raíz: `start`/test:db/otros pueden migrar o conectar BD. No se leyó .env ni se ejecutaron migraciones/seed reales.

Antes de I2 aprobar: máquina/capacidad local sin coste o presupuesto explícito; checkout separado del backend; BD/roles/volumen nuevos, nombre terminado en `_test` para el harness de tests, sin copiar dumps productivos. Secretos aleatorios de pruebas fuera de Git y sin reutilizar producción. Dos organizaciones y tres roles ficticios, sesiones y contactos sintéticos; seeds revisados. Configurar APP_BASE_URL de pruebas y orígenes seguros, TLS confiable en teléfonos; localhost del Motorola no es localhost del servidor, no abrir puertos públicos por improvisación.

Bloquear salida de red a Meta, proveedores IA, calendarios y conectores; configurar cada stub y verificar egress antes de probar envíos. WA_MOCK_ENABLED=true solo en entorno aislado no productivo; el modo compilado de CI exige además ALLOW_CI_MOCKS=true y loopback. Esa excepción no se copiará a un dominio externo ni a producción. No habilitar registro público salvo el bootstrap ficticio revisado. Las rutas mock 404 en producción no sustituyen un firewall de salida del entorno test.

Pruebas de RLS reales con vocero_app sin privilegios, tests de aislamiento/migraciones únicamente sobre BD de pruebas autorizada, mismo commit de contrato en web/test mobile, control de workers automáticos y reinicios, logs sin mensajes/secretos y procedimiento de destrucción del entorno. No contratar VPS, EAS, túneles, proyectos push o servicios adicionales automáticamente.
