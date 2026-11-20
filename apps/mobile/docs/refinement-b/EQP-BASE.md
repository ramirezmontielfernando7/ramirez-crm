# Base EQP · checkpoint parcial

Desde 4bfd3f68da9c01c7ca94ed1e61fcdc510e6588d0, misma rama B. **114/158 completos, 44 pendientes**. No se contabiliza ningún ID nuevo. Esta ejecución prepara el modelo; no completa pantallas EQP.

TeamChatStore reutiliza TeamRepository: conversaciones directas por pareja única, grupos creados por propietario, canal Avisos de solo lectura para asesores, acceso por pertenencia (sin excepción automática para propietarios), salida/retirada por creador, historial acotado a 500 mensajes y 100 conversaciones. Persistencia por organización, recibos acotados y deduplicación de envío; adjuntos solo como metadatos ficticios hasta 50 MB. No se lee ningún archivo real. Las referencias a clientes se guardan solo por ID, sin resolver ni almacenar nombres automáticamente.

477 pruebas de lógica aprobadas (8 nuevas); TypeScript/formato correctos. Casos: valores iniciales, directos únicos/restauración, membresía, restricciones de rol, idempotencia, límite de adjunto, salida sin borrar historia, fallo/reintento y scope ajeno. El modelo no está importado en el runtime: SET-03/03A/03B y demás pantallas no se modificaron. No hay capturas nuevas ni QA web EQP que acreditar.

## Reanudar sin reconstruir

1. Instanciar por sesión/organización con almacenamiento protegido de Equipo. Verificar explícitamente revocación de rol/membresía durante IO; el puerto de producción ficticia debe ser guardedStorage. La cola actual se coordina por identidad de adaptador; usar instancia/puerto compartido o reforzar el arbitraje entre actores, y probar acciones simultáneas antes de integrar.
2. Implementar EQP-01/02/03: selector Equipo real en Bandeja, búsqueda y estados, chat interno virtualizado, compositor/borrador, adjuntos con vista previa y errores, nuevos directos/grupos desde personas activas. No reutilizar las restricciones de WhatsApp para el chat interno.
3. Completar EQP-04/05: participantes, confirmaciones, quitar/salir; menciones de persona/cliente resueltas según permisos de cada lector, nunca revelar datos de clientes por texto insertado automáticamente. El campo client del modelo es solo referencia: todavía NO es la función Mencionar completa.
4. EQP-06 requiere permiso explícito, lectura sin envío y registro de acceso; no implementar una excepción implícita de propietario. Coordinarlo con SET-09 simulado.
5. QA RN Web claro/oscuro, navegación y regresiones; solo entonces actualizar cobertura. Los otros pendientes permanecen sin abordar, no se declaran bloqueados por integración real.

Sin cambios de UI, B, dependencias, backend, main, producción, worktree de Claude o configuración 0.1.3. Sin servicios/BD/migraciones, autenticación real, WhatsApp/IA/proveedores, push/PR/merge/despliegues o costes. Sin Gradle; conservar APK 0.1.2, firma y 26 artefactos. Bundle incremental desde 4bfd3f6: necesita esa revisión y la cadena previa completa hasta Offline f3f467a. No restaurar sobre main o trabajo pendiente.
