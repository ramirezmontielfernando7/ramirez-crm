# Propuesta detallada para T-M5B · No iniciada

La siguiente etapa requiere autorización específica. Esta lista es planificación, no acciones ejecutadas.

## B0 · Congelar y conservar T-M5A

Confirmar el respaldo autorizado de la rama, mantener la referencia T-M4/0.1.1 y revisar los resultados de T-M5A. La APK T-M4 seguirá disponible sin reemplazarla. Identificar un alcance nativo de pruebas separado del backend.

## B1 · Compatibilidad y dependencias nativas

Revisar nuevamente la matriz real de Expo SDK 58 y los changelogs. La comprobación actual recomienda expo ~58.0.25 frente al 58.0.24 aprobado; no se actualizó. Decidir expresamente si incorporar ese parche y validar primero regresión. Las versiones candidatas verificadas en el análisis fueron expo-notifications ~58.1.9, expo-task-manager ~58.0.14 y expo-background-task ~58.0.13; volver a comprobarlas al ejecutar la etapa.

Instalar solo lo necesario después de justificar la nueva compilación y recibir autorización. TaskManager/BackgroundTask no son requisitos para un aviso visible ni deben añadirse por rutina. Separar adaptación de evento nativo del coordinador; sustituir la autoridad demo únicamente por contratos autenticados en una etapa autorizada. No basta quitar el prefijo demo y conectar una URL.

## B2 · Adaptador nativo sin servicios de envío

Añadir un NativeNotificationPort con lectura de permisos, canales Android, respuesta inicial/pulsación, baja de listeners y limpieza de avisos de esta app. Usar las APIs del SDK exacto (shouldShowBanner/shouldShowList, no depender de shouldShowAlert obsoleto). Mantener contenido genérico y destinos autorizados. Validar agrupación/identificadores nativos y sus límites sin confundir colapso con agrupación.

Solicitar permisos del sistema solo desde una acción prevista en SET-14 aprobada; no condicionar el acceso al CRM a concederlos. Definir opciones de privacidad del sistema y diagnósticos de canal bloqueado. Revisar permisos Android actuales: VIBRATE está bloqueado; no retirarlo por iniciativa propia para añadir vibración.

Incluso una notificación local de muestra y cualquier prompt real requerirán autorización de esa fase. No registrar tokens reales durante una fase que autorice únicamente permisos/locales. No activar auto-inicialización de FCM por accidente.

## B3 · Compilaciones y QA nativo autorizados

Nueva APK local con el ID de desarrollo, firma experimental y versionCode superior al 2, manteniendo la APK 0.1.1. Verificar manifiesto, firma, ABI, alineación de 16 KB, Hermes y fuentes con los scripts existentes. Sin EAS Build ni servicios remotos por defecto. Conservar suficiente disco: no repetir un build pesado con el espacio reducido de este entorno.

Para iOS se necesitarán macOS/Xcode, firma y dispositivo/provisión adecuados, o una alternativa remota expresamente autorizada. No contratar membresías ni usar cuotas de compilación compartidas sin permiso. Un bundle Hermes no equivale a una IPA o prueba nativa.

Probar Motorola Edge 50 Pro / Android 16: primer plano, segundo plano, recientes, fuerza de detención, reinicio, permiso/canal revocado, batería/Doze, red perdida y arranque desde aviso. Probar iPhone: permiso/provisional/denegación, Focus, ahorro de energía, cierre manual, cold start y VoiceOver. Añadir TalkBack, texto aumentado, teclado, scroll y todos los recorridos T-M1…T-M4.

## B4 · Puerta de autorización de servicios reales

Expo Push Service sigue siendo la recomendación inicial detrás de un adaptador intercambiable. Usarlo exigirá proyectos de desarrollo y gestión autorizada de credenciales Firebase/APNs/Expo; no implica contratar EAS Build. Identificar propietario, permisos mínimos y entornos de cada proyecto antes de crearlos o almacenar credenciales.

FCM/APNs directos son alternativa si privacidad/operación requiere evitar el intermediario. Expo obtiene token FCM en Android y APNs en iOS; para enviar iOS mediante FCM haría falta Firebase Messaging adicional. No reutilizar un token APNs como si fuera FCM. Mantener credenciales privadas fuera del móvil y de Git.

Ningún registro de dispositivo real o envío está autorizado por T-M5A. Las pruebas remotas con un emisor/backend de desarrollo requerirán permiso específico; no se presumirán incluidas en una autorización de compilación local.

## Dependencias de T-M5C · Backend futuro, no iniciado

Tarea separada: autenticación móvil real, contexto de organización, preferencias en servidor, instalaciones/vinculaciones, migraciones revisadas, outbox transaccional, worker con reintentos/TTL y adaptadores. No suscribirse solo al bus SSE en memoria. Validar auditoría, aislamiento, membresía/asignación vigente, deduplicación y métricas sin contenido sensible. Definir cursor durable/tombstones y cómo sincronizar pérdidas de acceso.

Distinguir aceptado por proveedor, entregado si puede observarse, abierto y leído. Ninguna aceptación de Expo/FCM/APNs garantiza recepción o ejecución de JavaScript. Sin prometer funcionamiento tras fuerza de detención ni usar un servicio permanente para eludir restricciones del SO.

## Criterio de cierre

Regresión intacta, privacidad y autorización verificadas, casos de cold start/duplicados/revocación probados en ambos sistemas y reporte explícito de fallos del SO. Decidir una nueva autorización antes de cualquier integración productiva, publicación, coste, push o despliegue.
