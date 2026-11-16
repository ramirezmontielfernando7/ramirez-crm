# Probar T-M5B en Motorola Edge 50 Pro / Android 16

1. Instalar la APK 0.1.2 como **actualización** de Dashfort Dev. Debe conservar el ID `com.demfort.dashfort.dev` y la firma experimental anterior. No desinstalar la TWA ni Dashfort Dev. Las APK anteriores se conservan.
2. Entrar con el perfil ficticio habitual. Ir a Más → Controles de la demo → Laboratorio de notificaciones. También sirve el enlace `dashfort-dev:///demo?notifications=1` si Android permite abrirlo.
3. En **Pruebas locales Android · T-M5B**, pulsar **Solicitar permiso Android**. Probar primero **No permitir**: Bandeja y Chat deben seguir funcionando. El permiso ficticio de T-M5A es independiente.
4. Conceder permiso en Ajustes de Android → Apps → Dashfort Dev → Notificaciones si ya no aparece el diálogo. Volver y pulsar **Consultar permiso Android**.
5. Pulsar **Probar aviso local ahora**. Revisar el panel de notificaciones: debe aparecer un aviso genérico y silencioso. Un banner emergente no está garantizado por el canal DEFAULT ni por Android. Tocarlo: abre el chat ficticio del perfil. No debe mostrar nombres ni contenido de mensajes en la pantalla bloqueada.
6. Volver al laboratorio, pulsar **Repetir aviso local**: no debe generar otra emisión del mismo evento. Crear dos muestras nuevas del mismo chat: deben reemplazar la anterior. Abrir el aviso varias veces no debe apilar rutas duplicadas.
7. Pulsar **Probar aviso local en 15 segundos** y enviar la app al fondo con Inicio. Esperar: Android puede retrasar el aviso. Tocarlo y comprobar chat, Atrás y regreso a la misma posición de Bandeja. Repetir con pantalla bloqueada.
8. Con un aviso ya visible, retirar la app de recientes y tocar el aviso. Comprobar restauración de sesión ficticia, destino correcto y apertura única. «Retirar de recientes» no equivale a «Forzar detención». Si se fuerza la detención desde Ajustes, no se garantiza entrega hasta abrir manualmente la app.
9. Antes de que venza una muestra, cambiar organización ficticia, cerrar sesión de notificaciones o simular pérdida de pertenencia. El aviso debe retirarse cuando la app procesa el cambio; un destino antiguo no debe abrirse. Organización B no dispone de Bandeja B y debe rechazarse.
10. Revocar permiso/canal en Ajustes, regresar y consultar. No deben programarse nuevas muestras. Recuperar permiso no debe reproducir todas las muestras antiguas. Usar **Limpiar avisos locales** para retirar pruebas.
11. Repetir con modo avión: son muestras locales, sin backend. Probar tema oscuro, texto grande, TalkBack, teclado, borradores, scroll largo de Chat y retorno a Bandeja.

Registrar versión instalada, estado de permiso/canal, batería, estado de app y resultado. Una alarma aproximada puede retrasarse por Doze; no cambiar permisos de batería ni conceder alarmas exactas para ocultarlo. No hay notificaciones push remotas en esta APK.
