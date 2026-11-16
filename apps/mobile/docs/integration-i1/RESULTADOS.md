# I1 · Resultado, conservación y siguiente decisión

## Entregado y probado

Auditoría de flujos prioritarios e inventario estático de **262 rutas** del backend en `834806ec8616375fd8acb7961ac0d830ac9d0066`; no se certifica que todas estén desplegadas ni una revisión manual exhaustiva de seguridad de cada ruta. Ver [AUDITORIA.md](AUDITORIA.md), [api-inventory.csv](api-inventory.csv), [MODULOS.md](MODULOS.md), [ARQUITECTURA.md](ARQUITECTURA.md) y [PLAN-I1-I7.md](PLAN-I1-I7.md).

Código de preparación I1 en commit local **155126101899821a75ca69db2ea98595b75106e2**. Archivos: `src/integration/contracts.ts` (entornos, sesión/vault, errores y política de reintentos), `services.ts` (puertos Bandeja/Chat/contactos/acciones), `wire.ts` (proyecciones JSON actuales y query builder sin requests), `simulation.ts` (autoridad/operaciones de pruebas en memoria), `sync.ts` (protocolo durable propuesto simulado) y `tests/integration-i1.test.ts`. Solo apps/mobile. Sin paquete nuevo, SDK adicional, adaptador HTTP o import desde el runtime aprobado. La configuración rechaza production y toda URL. El simulador limita sesiones a 64 y cambios/operaciones a 2.000; no pretende ser un servidor real.

| Verificación de esta entrega | Resultado |
|---|---|
| TypeScript estricto | Pasa |
| Tests Node | **119/119**, 0 omitidos, 0 fallos: 103 anteriores y 16 I1 |
| Formato | Pasa |
| Expo install --check | Compatible; dependencias sin cambios |
| Export web | Pasa |
| Regresión Chromium T-M1…T-M5B | **45/45**, 0 omitidos y 0 fallos |
| Preservación runtime aprobado | 72 archivos existentes idénticos a 2bd4b62; sin imports del harness I1 |
| Preservación APK 0.1.2 | Mismo SHA-256: 36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a |
| API/BD productiva | Ninguna llamada; ninguna conexión/ejecución de migraciones |

Las 16 pruebas cubren entorno bloqueado/URL prohibida; mapeo de roles; login incorrecto y offline; renovación simulada/expiración/falsificación; catch-up y duplicados; cambio de organización; respuesta tardía de sesión antigua; revisiones/tombstones fuera de orden; payload de otra empresa; reasignación; revocación/logout; concurrencia y errores servidor; clave idempotente de la **propuesta**; envío incierto en API **actual**; parámetros y parsers. No prueban cookies Better Auth reales, RLS real, SSE de servidor, migraciones, envío/recepción de WhatsApp, Android/iOS, batería o red nativa. Las pruebas del backend no se ejecutaron sin una BD de pruebas autorizada.

La regresión web usa el servidor estático de QA habitual en loopback; no se levantó un backend CRM ni una nueva base de datos/servicio externo. Las capturas de la corrida están en artifacts; la entrega T-M5B conserva sus evidencias visuales y no se pidieron nuevos diseños ni se cambió ninguno.

## Estado exacto de respaldo

- Rama base T-M5B local: `codex/dashfort-mobile-tm5b-20261114`, checkpoint `2bd4b62`. Fuente APK: `d3bd582`. Conservada, sin modificación de sus refs ni APK.
- Último remoto móvil confirmado: T-M5A `codex/dashfort-mobile-tm5a-20261113` en `3b85b3b`. Consulta remota no devolvió T-M5B. Drive contiene el APK privado, no un respaldo de código fuente.
- Rama nueva local: **codex/dashfort-mobile-i1-20261115**, descendiente de T-M5B; conserva todo T-M1…T-M5B. Incluye el commit de código I1 y el posterior de documentación/evidencias. Un respaldo de esta rama conservaría también el historial T-M5B.
- Bundle incremental local preparado en `artifacts/integration-i1/dashfort-mobile-i1.bundle`, dependiente de la base remota 3b85b3b. Ver manifest.json en el mismo directorio para head/hash/base; no incluye artefactos ignorados, APK, keystore o secretos de entorno. Su creación/verificación no hace push.
- No se modificó main local (95b7ea0b236b35ee29a1a288a55c315a050e3b6e). Fetch actualizó solo la referencia de seguimiento origin/main para leer el backend actual; no se fusionó esa referencia.

Se revisaron disparadores conocidos en la rama móvil y en main actual. CI: PR/push main; Imagen: PR/push main/tags v*; Android: manual; Seguridad: PR/push main/programación. Main incorpora además **revision-extra.yml**: PR/push main/programación; no feature-branch push. Ninguno de los disparadores revisados ejecuta por un push ordinario exclusivamente a esta rama I1. No se ejecutó ningún workflow ni se creó PR/tag. Las automatizaciones externas/Coolify no se inspeccionaron de forma exhaustiva y la revisión debe actualizarse justo antes de cualquier push autorizado; este resultado no es permiso de publicación ni garantía sobre servicios externos.

## Confirmado / propuesto / no verificado

**Confirmado en código:** cookies/sesión y matriz de permisos, plugin organización bloqueado, rutas/DTO actuales, paginación de Bandeja, ausencia de cursor histórico en messages, SSE efímero, recepción durable de webhooks, falta de clave de envío aceptada en la ruta actual. Las versiones reportadas son de lockfiles, no de producción ejecutándose.

**Probado en esta ejecución:** contratos/parsers y escenarios de autoridad/sync en memoria, pruebas previas de lógica, regresión web y preservación del código/APK. El mock de revisiones/delta/idempotencia es demostración de arquitectura, no capacidad implementada del servidor actual.

**Propuesto:** cookies nativas con manejo seguro/validado; bootstrap y cambio org de servidor; historial paginado, cursor durable/tombstones, CAS/idempotencia/outbox push y staging aislado. Las interfaces de servicios no están conectadas a las pantallas ni todas tienen un adaptador de datos implementado: ése será el trabajo progresivo I2/I3.

**No verificado:** servidor desplegado, credenciales reales, permisos/RLS instalados, sesiones nativas, proveedores, delivery push/WhatsApp, funcionamiento de notificaciones locales en Motorola, publicación iOS y automatizaciones externas. No se consumieron cuotas ni servicios de pago.

## Próximo paso y autorización

Primero conservar este avance: solicitar permiso para **un push de respaldo de codex/dashfort-mobile-i1-20261115**, sin PR/merge/publicación y tras reconfirmar disparadores. No se hace automáticamente. Después, autorización independiente para I2: acordar y crear un backend de pruebas con los requisitos de PLAN-I1-I7.md, aprobar por separado cualquier cambio fuera de apps/mobile y probar Better Auth con cuentas ficticias. No iniciar conexión productiva ni T-M5C por esta entrega.
