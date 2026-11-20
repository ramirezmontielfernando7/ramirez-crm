# Equipo · integración parcial posterior a 00b497c

Rama codex/dashfort-mobile-b-continuation-20261119. Base 00b497c86d43568bc1a2a17ffaf89ea525b9ae01. Siguen **111/158 completos y 47 pendientes**. No se cuentan SET-03/03A/03B: todavía requieren integración y validación adicionales. Esta ejecución conserva un checkpoint parcial; no debe distribuirse como una APK terminada de Equipo.

## Avance concreto

Se reutiliza TeamRepository. Añadida reemisión local: revoca la invitación anterior y conserva identidad de persona/plazas. Consultas compartidas de personas activas, personas históricas conocidas, plazas y actor efectivo. Inbox incorpora el repositorio, revalida permisos de lectura/asignación y consulta el rol vigente. SessionProvider deriva acceso/rol del equipo y conserva identidad de sesión cuando no cambian los permisos, para evitar reactivar efectos de notificaciones innecesariamente. Inbox se recrea al cambiar rol.

Contactos valida personas históricas al restaurar y personas activas al asignar. Work consulta personas activas para nuevas asignaciones y conserva referencias históricas; su actor obtiene el rol vigente. Agenda comparte el mismo equipo y usa personas conocidas al validar registros; Uso cuenta personas/plazas desde el repositorio. Selectores de asignación/tarea de Contactos y editor Work consultan personas compartidas. No se reconstruyen cuentas de autenticación ni se crean sesiones para invitados nuevos.

Pantalla preliminar de Equipo, formulario de invitación y edición de persona accesibles desde Controles de demo. Roles, recibir chats, revocación/reemisión y desactivación operan localmente. La invitación exige @example.test; crear enlace muestra solo un ID local, no envía correo/WhatsApp ni abre una URL. No hay cambios de dependencias o de tokens B.

## Verificación y límites

463 pruebas de lógica aprobadas (3 nuevas: reemisión, asignación de nuevo miembro/restauración y pérdida de privilegios de una instancia Inbox existente). TypeScript/formato correctos. 12 capturas RN Web preliminares y 6 referencias; comparador evidence/team-partial/comparacion.html. No acreditan completitud visual ni funcional. Regresiones offline de Agenda y Work aprobadas, sin errores de página o solicitudes de red. No se ejecutó regresión completa de todos los módulos ni Android/iOS.

## Pendientes exactos para terminar los tres IDs

1. Sustituir listas/etiquetas estáticas restantes de CRM (CrmOverlay, líneas con demo-owner/demo-coordinator/demo-advisor), filtros de quién atiende de Inbox y funciones históricas personName de vistas. Mostrar nombres de personas nuevas/desactivadas sin ofrecerlas para asignaciones nuevas.
2. Completar disponibilidad de asignación de Agenda: conocido para historial no implica activo para nuevas acciones. Cubrir receiveNew donde corresponda al reparto automático, sin bloquear asignación manual legítima.
3. Revalidar permisos en operaciones diferidas de TODOS los repositorios (por ejemplo CatalogStore conserva actor capturado). El rol reactivo de la pantalla no basta para una escritura ya iniciada. Probar revocación/desactivación simultánea y aislamiento entre organizaciones en los proveedores de runtime.
4. Añadir confirmación y cancelación conservando estado al desactivar. Implementar restablecimiento de contraseña exclusivamente ficticio según SET-03B, sin prometer creación de credenciales reales. Completar laboratorio de aceptar/vencer invitaciones: el método existe pero no su control visual de pruebas.
5. Ajustar filas/avatares, estados de carga/error/vacío y footer a las maquetas; la UI actual es preliminar. Comprobar roles y límite de plazas por navegación real, escrituras fallidas, reintentos y accesibilidad. Añadir pruebas RN Web de acciones, no solo capturas.
6. Ejecutar regresión CRM/Bandeja/Chat/Work/Agenda/Uso y notificaciones de demo. Solo después marcar SET-03/03A/03B completos (114/158). Continuar EQP y SET-09 posteriormente.

Los demás 44 IDs pendientes no se abordaron en este checkpoint. El inventario original y sus motivos por dependencia permanecen en CHECKPOINT-111.md. No repetir base de Equipo ni integración ya existente.

Solo apps/mobile. Backend/worktree de Claude/main/producción no modificados. Sin servidores, BD, migraciones, workers, APIs, autenticación real, proveedores, envíos, push/PR/merge/despliegues o costos. Sin Gradle; APK 0.1.2/firma/configuración 0.1.3 intactas. Cadena: Offline f3f467a → bundle 111/2d3dee2 → preparación 00b497c → nuevo bundle incremental. Conservar todas las dependencias anteriores; no restaurar sobre main o trabajo pendiente.
