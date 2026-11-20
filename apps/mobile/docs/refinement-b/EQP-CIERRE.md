# Equipo interno · 120/158

Base 58c90c588a1494fa04c62414657e54c155a368d9, rama B existente. EQP-01/02/03/04/05/06 completos en simulación local con QA RN Web; 38 IDs pendientes. No equivale a validación nativa ni mensajería real.

- EQP-01: Equipo accesible desde Bandeja, búsqueda, listado virtualizado, estados, identidad compartida y separación de Clientes.
- EQP-02: chat directo/grupo/Avisos, compositor móvil existente adaptado, borrador por actor/organización/sala, metadatos de adjunto ficticio con vista previa; envío idempotente y reintento. Avisos solo propietario/coordinador en esta revisión.
- EQP-03: personas activas del repositorio común, pareja directa única, nombre y selección de grupo; grupo solo propietario hasta implementar delegación en SET-09.
- EQP-04: participantes con nombres/roles canónicos, confirmación de salida/retirada; solo creador retira a otros. Salir revoca acceso y conserva historia.
- EQP-05: mención de compañero y referencia a cliente, resuelta con permisos de cada lector. Nunca se inserta automáticamente el nombre del cliente en el cuerpo compartido.
- EQP-06: permiso explícito por persona, sin excepción universal para propietario. Laboratorio separado configura la muestra. Lectura solo tras guardar auditoría; compositor/adjuntos/escrituras deshabilitados. Revocar invalida instancias abiertas y una carga atrasada no recupera permisos antiguos.

TeamChatStore usa el mismo TeamRepository y un puerto guardedStorage ligado al rol. Cola compartida por organización/roster entre actores, revisión del documento y difusión local; escritura revocada durante IO se revierte. Los datos son ficticios, el almacenamiento protegido aplica control lógico de acceso, no cifra una base de datos. Límite local explícito: 100 conversaciones, 500 mensajes y 100 entradas de auditoría; no representa retención definitiva del backend.

**489 pruebas de lógica**, TypeScript y formato aprobados. Se agregaron 12 pruebas sobre la base 477: simultaneidad entre actores, borradores aislados, títulos, retirada de miembro, supervisión explícita/lectura/auditoría/revocación, fallo de auditoría, restauración atrasada, revocación durante escritura, lectura atrasada de borrador y orden estable/recibos entre actores. Las ocho pruebas anteriores de chat interno siguen aprobadas, incluida restauración, errores, adjuntos y organización ajena.

QA RN Web: 24 capturas reales + 12 referencias oficiales, claro/oscuro a 390×844 y 360×640. Comparador `evidence/internal-chat/comparacion.html`. Recorridos de directos, grupo, cancelar/confirmar salida, fallo/reintento sin duplicados, adjunto/preview, borrador restaurado, mención restringida, Avisos y supervisión/revocación. Sin errores JS ni solicitudes de red. Regresión Bandeja/Chat/CRM/Contactos (70 capturas de trabajo) y Equipo SET-03 aprobadas. Host web usa dobles de router, sesión y almacenamiento: falta Expo Router/teclado/scroll nativos y prueba Android/iOS.

No se cambiaron tokens globales, diseño B, dependencias, APK/firma ni configuración 0.1.3. Los 26 artefactos protegidos siguen iguales por SHA-256. Sin Gradle, servicios, backend, producción, main, worktree de Claude, push, publicaciones ni costes. Próxima dependencia: SET-09, controles simulados del chat interno; no contar aún ese ID.
