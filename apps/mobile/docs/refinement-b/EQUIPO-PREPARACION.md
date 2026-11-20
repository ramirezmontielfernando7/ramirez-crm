# Preparación de Equipo · checkpoint parcial, sin pantallas nuevas

Base 2d3dee2542dd7f4d86182b917d0165abc90382fb, rama codex/dashfort-mobile-b-continuation-20261119. Se mantiene **111/158, 47 pendientes**. SET-03/03A/03B NO están completados ni se contabilizan. Se cierra un checkpoint parcial por límite de ejecución.

Nuevo src/features/team/core.ts: repositorio aislado por organización, persistencia con validación, cola compartida por almacenamiento, revisiones e idempotencia. Conserva las tres identidades iniciales existentes. Invitaciones puramente ficticias pendientes/aceptadas/vencidas/revocadas, aceptación de un solo uso, caducidad a siete días, plazas reservadas dentro del límite ficticio de cinco personas. Correos exclusivamente @example.test. No genera enlaces externos, correo, contraseñas, tokens o sesiones reales.

Las operaciones administrativas de esta base se limitan al propietario activo del documento persistido; no confían en un rol proporcionado por el llamante. Protección del último propietario incluso con acciones simultáneas. No se reactiva un miembro inactivo desde la edición. El modelo aún no incluye reemisión de una invitación vencida/revocada ni restablecimiento ficticio de contraseña: ambos quedan pendientes antes de completar SET-03B.

12 pruebas nuevas: valores iniciales, aceptación/replay, caducidad, revocación/restauración, permisos, último propietario concurrente, duplicados concurrentes, límite de plazas, fallo/reintento, revisión obsoleta y aislamiento/corrupción de scope. Suite completa: **460 aprobadas**, TypeScript y formato correctos. No se importó el repositorio en el runtime. No hay nuevas capturas ni QA de navegación: las pantallas no existen todavía. No afirmar seguridad de permisos de toda la aplicación basada en estas pruebas aisladas.

## Reanudación exacta

1. Conectar una instancia por organización al runtime ficticio. Sustituir los catálogos estáticos de personas en Contactos, repositorio Inbox, Work, Agenda y Uso. Resolver registros históricos de personas desactivadas sin ofrecerlas para nuevas asignaciones.
2. Refrescar sesión/proveedores ficticios al cambiar rol o desactivar acceso; evitar que una instancia conservada mantenga permisos antiguos. Acordar en código el permiso users.manage por rol según diseño, sin ampliar privilegios automáticamente.
3. Añadir reemisión local con invalidación de invitación anterior y restablecimiento exclusivamente ficticio.
4. Implementar SET-03, SET-03A y SET-03B conforme a las maquetas; entrada de demostración, estados, conflictos y cancelación. Probar integración, roles y organización, capturas RN Web en ambos temas/tamaños y regresiones. Solo entonces subir el inventario a 114.
5. Continuar EQP y SET-09 por dependencias.

El inventario completo y motivos por módulo siguen en CHECKPOINT-111.md e inventory-111.json. Los 47 pendientes conservan su estado: tres de Equipo necesitan esta integración; EQP depende de personas/permisos; demás módulos continúan sin implementar, no bloqueados por una conexión real autorizada.

Sin cambios de UI/B, dependencias, APK 0.1.2, firma, backend, worktree de Claude, main o producción. Sin servidores, PostgreSQL, migraciones, workers, HTTP, IA/WhatsApp/autenticación reales, costes, push o despliegues. La configuración futura 0.1.3 sigue intacta; no Gradle con ~1.1 GiB libres tras respaldo.

Respaldo nuevo incremental desde el checkpoint 111, junto a la cadena anterior que necesita Offline f3f467abb7640ec13ffba590bc5dad91bc5cfd77. Conservar todos los bundles anteriores. SHA final y hashes de artefactos en el manifiesto local. Restaurar hacia rama nueva, nunca sobrescribir main o trabajo pendiente.
