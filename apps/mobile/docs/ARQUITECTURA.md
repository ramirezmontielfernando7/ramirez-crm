# Arquitectura móvil · T-M1

Expo SDK 58 + React Native 0.88.1 + React 19.3 + TypeScript estricto. Versiones obtenidas del template oficial vigente y dependencias nativas resueltas con `expo install`; lockfile propio. No cambia el workspace, lockfile, scripts ni dependencias del CRM.

- `app/`: Expo Router. Stack de acceso, rutas por enlace, galerías y cinco raíces de pestañas. `Stack.Protected` separa sesión iniciada y acceso. Las raíces de módulos comprueban rol y módulo también en entrada directa.
- `src/domain/`: roles, permisos simulados, validación, duración de sesión y política de Atrás. Sin dependencias de UI ni de producción.
- `src/services/`: contrato `AuthRepository`, adaptador `DemoAuthRepository` y puertos de almacenamiento. Sin fetch, SSE, URLs de API ni clientes productivos. Activación/restablecimiento crean solo una sesión ficticia; no cambian contraseñas reales. La contraseña introducida no se persiste. Los enlaces demo se consumen en almacenamiento local.
- `src/state/`: hidratación, sesión, caducidad al volver al primer plano y comprobación periódica de un minuto; módulos desactivados solo en memoria para QA. Cerrar sesión borra la sesión de SecureStore. Web usa sessionStorage únicamente para QA ficticio. En integración futura toda operación y permiso debe validarse en servidor.
- `src/theme/`: tokens oficiales claros/oscuros, Inter 400/500/600 empaquetada, tema claro por defecto y opciones claro/oscuro/automático persistidas. Motion sigue accesibilidad del sistema; no hay animación de arranque en T-M1.
- `src/components/`: controles comunes, fila, cápsulas, burbujas, compositor de muestra, estados y barra flotante. `LayerProvider` ofrece hoja/diálogo/menú sin rutas, con Modal nativo, cierre visible, Atrás/Escape, teclado y asa con deslizamiento. No anida capas en esta etapa. Toast de tres segundos.
- `src/screens/`: formularios de acceso y shell con permisos. Las pantallas de módulos son **entradas pendientes**, no se contabilizan como Bandeja/CRM/Estudio/Marketing/Más terminados.
- `tests/`: lógica de sesión/roles/validación/Atrás y recorridos de Chromium sobre React Native Web.

## Decisiones registradas

1. Se crea `apps/mobile` porque ni main ni la rama visible `codex/t2-mobile-classic` contienen Expo recuperable. Nueva rama local desde main; no se importa código web como móvil.
2. Las instrucciones de esta ejecución prevalecen sobre los documentos de referencia antiguos: solo datos ficticios, ninguna API real, ningún backend, sin nueva aprobación visual, sin push/PR/despliegue. Las referencias originales se conservan sin reinterpretarlas como autorización operativa.
3. SDK 58 incluye su navegación en Expo Router. La barra utiliza los tipos públicos de `expo-router/js-tabs`, sin añadir una segunda versión de React Navigation.
4. Listas FlashList, caché de dominio, SSE y borradores pertenecen a T-M2/T-M3. No se añaden dependencias ni sincronización antes de tener listas y contratos simulados que las necesiten.
5. Hoja con Modal/PanResponder nativos en T-M1: suficiente para galerías y acciones sencillas sin añadir Reanimated/Gorhom. Si T-M2/T-M4 requieren gestos complejos, evaluar Gorhom con pruebas nativas. Animación de velo de hasta 300 ms; sin animación si el sistema reduce movimiento. Stack sin animación.
6. Acceso denegado y módulo apagado son estados diferentes. Ocultar la pestaña no es la única comprobación. Estos permisos siguen siendo de demostración y no sustituyen seguridad en un servidor.
7. La galería DS-04 envía solo a una lista en memoria acotada a 20 ejemplos; no representa el chat T-M3. No hay promesas de entrega, sincronización o notificaciones.
8. No hay EAS project ID, servicios pagados, secretos, OTA ni credenciales de producción. La compilación local experimental usa un ID y una clave independientes.

## Próxima etapa

T-M2: modelo Conversation + repositorio ficticio con 1,000 registros, scope por asesor, FlashList, búsqueda/filtros/selección, actualización local incremental, scroll y estados. Validar en Android antes de declarar rendimiento. T-M3 introduce chat, borradores y teclado; T-M4 acciones de contacto. T-M5 prepara contratos/simulaciones de notificaciones, sin token ni backend reales.

## Ajustes comprobados durante QA

- Para texto blanco de 15 pt en el botón de peligro se usa `#b73535`, ya presente en la paleta aprobada. El relleno `#d94a4a` de la captura daba 4.18:1; no alcanzaba AA. Los metadatos de las burbujas usan `text-2` para no bajar de 4.5:1 sobre fondos teñidos. Las pruebas cubren estos pares en ambos temas. Son diferencias explícitas de accesibilidad respecto a la captura, no un rediseño de la paleta.
- Las cápsulas conservan el fondo índigo del HTML aprobado y las etapas conservan su punto de color y nombre. El icono Android/iOS se copia del activo existente `public/icon-512.png` a Mobile, sin modificar el original.
- React Native Web 0.21 no traduce todos los campos de `accessibilityState`. Los controles declaran también las propiedades ARIA compatibles para exponer correctamente selección, pulsado y marcado en QA web, conservando los estados nativos.
- Las capas ocultan el contenido de fondo al árbol de accesibilidad; Escape cierra desde el inicio de la apertura en web. Android utiliza `Modal.onRequestClose`. La validación con TalkBack/VoiceOver y teclado físico sigue pendiente.

## Evolución T-M3
`src/features/chat` añade repositorio de historial lazy (1.000 por chat), almacén externo por conversación y transporte simulado idempotente por mensaje/fragmento. Caché LRU de ocho chats, con exclusión de envíos activos; listas FlashList paginan 20 iniciales y 40 anteriores. Objetos anteriores conservan identidad, Bubble es memo y los cambios de scroll quedan fuera de React. El adaptador de borradores serializa por perfil/chat y almacena borrador + marca de vaciado en un documento versionado. No se persisten envíos ni medios; no existe integración de red. Los límites de texto/archivos se copiaron como contratos puros dentro de Mobile; no se importa el CRM. La conexión con Bandeja solo actualiza su repositorio ficticio local. Ver tm3/IMPLEMENTACION.md para comportamiento y límites.

## Evolución T-M4
`src/features/contact` añade detalles, acciones e historial interno por actor/chat. ContactDirectory limita la caché a 64 almacenes; las notas no dependen del transporte de mensajes. Persistencia versionada mediante el puerto AsyncStorage existente; escrituras serializadas/idempotentes con validación de permisos, comparación del objeto base y rechazo de conflictos. FlashList virtualiza los eventos, las filas de Bandeja conservan identidad y la suscripción useConversation evita propagar todas las actualizaciones de filtros. ContactProvider permanece estable bajo InboxProvider y comparte el ChatProvider existente, sin reiniciarlo al abrir detalles. Nuevas rutas protegidas contact/history; sheets nativas reutilizan LayerProvider. Ver tm4/IMPLEMENTACION.md y tm4/RESULTADOS.md para límites de demo y QA nativo pendiente.
