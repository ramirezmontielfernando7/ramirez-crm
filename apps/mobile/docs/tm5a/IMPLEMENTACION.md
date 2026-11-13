# T-M5A · Contratos y simulación de avisos

Rama `codex/dashfort-mobile-tm5a-20261113`, creada exactamente desde el respaldo T-M4 `ebeb4bf75c29e845c6732874f16a20ad7a096da6`. T-M1…T-M4 se conservan. Solo apps/mobile. Sin SDK nuevo, permisos reales, tokens reales, avisos locales del sistema, backend, FCM, APNs ni Expo Push Service.

## Contratos y módulos

| Archivo en src/features/notifications | Responsabilidad |
|---|---|
| model.ts | Identidad por usuario/organización/sesión, evento V1, destino, grupo y snapshot. Decodificador estricto exclusivo de IDs demo; descarta campos libres, texto y URLs. Eventos canónicos inmutables. |
| ports.ts | Puertos de almacenamiento, backend de simulación y proyección/navegación. Ninguna dependencia de proveedor nativo. |
| policy.ts | Elegibilidad temporal, copia genérica y supresión del aviso en el chat activo. |
| dedupe.ts | Registro acotado de eventos/aperturas y límites de grupos. |
| registration.ts | Registro de instalaciones/tokens ficticios, renovación y revocación. Reasignación atómica del vínculo en el servidor simulado; revocación offline pendiente. |
| routing.ts | Validación del destino, sesión, organización, permiso vigente, evento canónico, caducidad y disponibilidad de navegación. |
| sync.ts | Una sincronización concurrente por época de identidad, sin polling. |
| adapters/demo.ts | Servidor en memoria con usuarios, pertenencias, asignación, log de eventos, snapshots completos y registro de instalaciones ficticias. |
| core.ts | Coordinador: hidratación, identidad, permiso ficticio, conexión/primer plano, recibos, deduplicación, sincronización y destinos pendientes. |
| context.tsx | Puente no visual con sesión de demo, AppState, Bandeja, Chat y Expo Router. |
| Lab.tsx | Controles QA con componentes existentes; solo se muestra al solicitar expresamente /demo?notifications=1. |

Otros cambios de código:

- app/_layout.tsx: añade el proveedor no visual, conservando el Stack, rutas, opciones y presentación aprobados.
- app/demo.tsx: mantiene la pantalla original sin cambios visuales; el parámetro explícito activa el laboratorio. No hay entradas nuevas en pestañas o menús existentes.
- inbox/model.ts: actualización en lote de muestras entrantes; incoming original conserva el comportamiento de una entrada.
- inbox/store-core.ts: proyecta IDs nuevos una vez, sin incrementar contadores por repetición de snapshots.
- chat/core.ts: combina muestras canónicas entrantes con IDs estables, en orden temporal, conservando los objetos existentes y los borradores. No simula envío saliente ni cambia su transporte.
- chat/context.tsx: acceso opcional al directorio para el puente.
- tests/notifications.test.ts y tests/browser/notifications.spec.ts: dominio y recorridos completos.

## Flujo y garantías de esta simulación

El emisor ficticio crea un evento canónico con identificador estable, secuencia por organización y caducidad. Solo message.incoming y handoff autorizados pueden generar un grupo. No generan avisos los mensajes salientes, estados, notas, IA, eventos caducados, eventos desconocidos o de otra organización. No se interpreta una URL del payload.

La recepción es un indicio para sincronizar. En primer plano se recupera un snapshot simulado; en segundo plano ficticio o sin conexión se recupera al volver. Se conservan los mensajes perdidos aunque su aviso haya caducado; para avisar se elige solamente el evento nuevo vigente más reciente de cada conversación. No se suman ciegamente contadores por cada entrega de push.

Los grupos se identifican por organización/conversación y solo contienen «Dashfort / Tienes un aviso nuevo en Dashfort». No usan nombres, teléfonos, texto de mensajes ni adjuntos del evento. La pantalla del chat conserva sus muestras ficticias previas; las nuevas entradas proyectadas dicen «Mensaje entrante de prueba».

Se valida pertenencia y acceso antes de recibir, sincronizar y abrir. También se consulta el repositorio móvil vigente antes de navegar. Una respuesta tardía de otra cuenta/organización/época no puede aplicarse después de cerrar sesión. Antes de combinar mensajes tras una hidratación async se comprueba de nuevo el alcance.

Tocar un aviso conserva un destino con caducidad. Si falta sesión, organización, conexión o el Stack todavía no está listo, no se navega. La reanudación de identidad intenta resolver el destino; también existe reintento explícito en QA. Un destino no obtiene permisos por contener un ID. No puede cambiar conversación ni ampliar caducidad respecto al evento canónico. Logout y cambio de usuario retiran grupos y destinos anteriores; cambiar de organización mantiene un destino pendiente solo para revalidarlo. Las aperturas concurrentes del mismo evento se coalescen. Se guarda el consumo antes de llamar al router; un fallo del guardado conserva el destino para reintento.

La cola de escrituras combina una ráfaga en el último checkpoint, sin timers. El test de 300 eventos concurrentes conserva todos los IDs con un máximo de dos escrituras. Duplicados ya confirmados no escriben ni proyectan otra vez. La caché mantiene hasta 2.048 IDs por ámbito, 128 grupos y 12 ámbitos persistidos. El log del servidor demo tiene un máximo explícito de 2.000 eventos. No hay socket, tarea del sistema, servicio permanente ni sondeo nuevo.

## Persistencia y límites

AsyncStorage guarda un documento versionado por instalación ficticia: ámbitos de deduplicación/cursor/aperturas, destino pendiente y estado mínimo de revocación. No guarda credenciales, sessionId, tokens, contenido de mensajes o huellas del dispositivo. Datos corruptos se bloquean sin sobreescribirlos; el registro permanece inactivo hasta recuperar el almacenamiento. Un cliente reiniciado retira su vínculo ficticio previo antes de conceder un permiso nuevo.

Permisos, grupos, tokens y el servidor demo viven en memoria. El permiso vuelve a denegado al recrear el cliente: no se consulta ni modifica el permiso del teléfono. El servidor no es un outbox duradero real. Al recargar la aplicación, su log se reinicia; un cursor incompatible se recupera desde cero. Un destino cuyo evento ya no exista se deniega. Las pruebas de cliente recreado reutilizan un servidor de muestra para comprobar el contrato de recuperación.

Cerrar sesión offline retira inmediatamente el estado local; el servidor simulado conserva el vínculo hasta poder procesar la revocación o hasta reiniciar el cliente. No existe una garantía de retirada instantánea de avisos en tránsito; en esta etapa no hay ningún aviso de sistema ni envío real.

El identificador demo-install-local del puente es una fixture, no una identidad de teléfono real. El backend de prueba admite varias instalaciones independientes y las pruebas comprueban que revocar una no elimina otra. La validación de sesiones es una autoridad ficticia de prueba, no autenticación criptográfica ni un mecanismo listo para producción.

## Dos organizaciones sin mezclar Bandeja

El servidor/coordinador simulan organizaciones A/B, varios usuarios y permisos, con cursores aislados. El puente real de la aplicación se vincula solo a organización A: la Bandeja aprobada todavía no tiene identidad multiorganización real. Por seguridad, un destino B se rechaza antes de abrirlo sobre esa Bandeja. La navegación para ambos ámbitos se prueba con el puerto simulado; no se sustituyen datos, se añade un selector de organización a la app ni se presenta una sesión real inexistente.

Los controles de identidad del laboratorio cambian solo la identidad del simulador. Para cambiar el perfil de la aplicación se siguen usando los controles T-M1 de /demo. Los tres permisos ficticios no invocan requestPermission, SecureStore adicional de tokens, Notification, un service worker ni un SDK push.

## Diseño e inventario

No cambian temas, tokens, componentes comunes, iconos, estilos, pestañas, tamaños o pantallas de T-M1…T-M4. El laboratorio utiliza Screen, AppBar, Banner, Card, Button, Section y Text existentes y no se muestra en el flujo normal. Atrás desde un chat abierto en QA conserva el comportamiento del Stack y vuelve al origen QA.

Esta etapa no completa SET-14 ni aumenta los 42 IDs previamente implementados del inventario. SET-14 se implementará únicamente conforme a su maqueta y a una autorización posterior. Tampoco se toca el binario aprobado 0.1.1.

## Probar manualmente sin APK nueva

1. Desde apps/mobile: npm start o export:web + scripts/serve-web.py. Son herramientas locales, no EAS Build.
2. En /demo entrar con un perfil ficticio. Abrir /demo?notifications=1 en el mismo entorno web.
3. Conceder permiso ficticio y publicar dos mensajes. Ver un grupo; repetir no aumenta eventos. Tocar abre el chat con las muestras canónicas sin duplicados.
4. Denegar/revocar permiso: no hay grupos ni registro; los mensajes siguen disponibles para sincronizar.
5. Desconectar, crear muestras y reconectar. Probar fallo, reintento y regreso de primer plano. El laboratorio conserva un destino offline hasta reintentarlo.
6. Probar otro ámbito, pérdida de pertenencia y cierre de sesión de notificaciones. No debe abrir un chat no autorizado. Organización B no se proyecta en la Bandeja A.

Las pruebas web no representan ejecución en Android/iOS, Doze o procesos terminados por el SO.
