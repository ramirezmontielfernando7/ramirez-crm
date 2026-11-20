# Cierre del inventario móvil: 158/158 en simulación

Base: `9e50c40bbb1436375c0611bb36d458c8f5989ead`, rama `codex/dashfort-mobile-b-continuation-20261119`. Se conservan los 150 IDs anteriores y se completan PLT-01/02/03, SET-01/15/16/17 y MORE-01. Son IDs del diseño: incluyen pantallas, estados, hojas y diálogos; no se afirman 158 rutas independientes ni 158 pruebas nativas.

## Implementación del último lote

- **Plataforma:** panel, organizaciones y ficha con Plan y módulos / IA y topes / Consumo / Accesos. Consulta exclusiva de un dataset fijo de metadatos ficticios; sin referencias a repositorios de mensajes de otros negocios. El propietario del negocio no obtiene acceso automáticamente. Se activa una capacidad explícita en el laboratorio, separada del rol, ligada a esa instancia de sesión simulada y no persistida. Revocar, cambiar de identidad o perder pertenencia elimina el acceso; las cargas tardías no lo restablecen. No hay API para altas, suspensiones, planes, sesiones o contraseñas reales.
- **Ajustes:** buscador con normalización de acentos, cuatro grupos oficiales y rutas funcionales existentes. Los enlaces respetan las facultades efectivas del destino: Marca, Navegación, Atribución, Conector del equipo, Uso y administración de chat interno se reservan al propietario. El asesor no administra el índice.
- **Apariencia:** claro/oscuro, Inter/Geist/DM Sans/Plus Jakarta y estilo clásico/WhatsApp del chat de clientes. Familias TrueType estáticas locales de 400/500/600, con licencias OFL y procedencia en assets/fonts/sources.json; no se descargan al ejecutar la app ni requieren dependencias nativas nuevas. Preferencia por actor/organización sobre defaults de la organización. El tema legado del dispositivo se conserva en la organización demo original si todavía no existe documento personal, sin sobrescribir sus bytes ni transferirlo a otra organización.
- **Marca:** nombre, acento y logo/ícono predefinido de muestra. Guardado protegido por organización, derivación de todos los tokens de marca y comprobación de contraste. Semántica de error/éxito/IA y colores neutrales conservados. No sube imágenes ni cambia el launcher Android/iOS; el ícono del sistema sigue siendo el original de la APK.
- **Navegación:** selección y orden por rol, máximo cuatro pilares y Más fijo al final. Reordenación en hoja accesible. Ocultar un acceso no altera autorizaciones: los módulos permitidos que no caben en la barra se encuentran en Más. Nunca permite añadir un módulo prohibido al rol.
- **Más:** identidad canónica del equipo, plan del repositorio de Uso, Trabajo / Asistente / Cuenta, Agenda, Tareas, Equipo, Mi número, Resultados, Avisos, Ajustes, Uso, tema y cierre de sesión confirmado con error/reintento. Plataforma aparece únicamente con la capacidad ficticia explícita.

Se mantiene B original de forma predeterminada: Inter, paleta original, tamaños, tokens y componentes existentes. Las modificaciones de apariencia y marca requieren una selección explícita del usuario en los controles previstos por el diseño. No se cambia automáticamente el estilo de otras pantallas. Las capturas de Más muestran la capacidad de plataforma activada para comparar la entrada; su ausencia por defecto también se prueba. Las fuentes, radios y acentos personalizados requieren QA nativo antes de distribuir 0.1.3.

## Validación

- **594 pruebas de lógica aprobadas**, ninguna fallida/omitida/cancelada; 22 nuevas en final-screens.test.ts. Permisos, restauración, revocación, respuestas tardías, limpieza de metadatos, aislamiento, scope estricto, concurrencia, reentrada, fallos de almacenamiento y rollback de una escritura durante pérdida de rol.
- TypeScript y formato aprobados.
- **46 comprobaciones RN Web del cierre**, con proveedores reales de personalización/tema y dobles de router, sesión y almacenamiento. Incluyen búsqueda/destinos, cuatro pestañas, id inexistente, fuentes reales, tema, radios reales de burbuja, marca, navegación, acceso oculto recuperable, 360×640, denegación por rol, restauración, error de lectura/reintento, error de escritura y logout/cancelación/reintento.
- Regresiones de Bandeja/Chat/CRM/Contactos: 70 capturas de trabajo y cinco recorridos documentados. Equipo, Marketing y Canales: recorridos aprobados. Sin errores JS ni solicitudes de red en esos QA.
- Evidencia final: **16 capturas nuevas** (8 IDs × claro/oscuro, 390×844), 16 referencias oficiales y comparador local en `evidence/final-screens/comparacion.html`. Los estados y la resolución compacta se prueban sin generar paquetes duplicados. Capturas de RN Web, no de un teléfono.
- `python3 scripts/verify-inventory.py` comprueba los 158 IDs únicos, su correspondencia exacta con las 158 definiciones oficiales y la existencia de archivos de implementación, entrada y pruebas. Trazabilidad: `INVENTARIO-158.json`. Es una comprobación estática, no ejecuta por sí misma cada interacción de los 158 IDs; los 150 anteriores conservan la evidencia de sus lotes y se ejecutan regresiones seleccionadas.

## Incidencias y límites explícitos

No quedan IDs pendientes de implementación simulada ni regresiones conocidas bloqueantes en los recorridos ejecutados. Esto **no significa integración o aplicación nativa terminadas**:

1. No hay validación Android/iOS de 0.1.3: fuentes nuevas, arranque, teclado, áreas seguras, retroceso físico, gestos, scroll largo, memoria, restauración física y accesibilidad del sistema requieren dispositivo/emulador.
2. Los proveedores, cargas, QR, campañas, cobros, IA, usuarios/organizaciones y mensajes son ficticios. HTTP/auth real siguen desconectados. No hay FCM/APNs/Expo Push Service remoto ni tokens reales.
3. Marca solo acepta imágenes locales de muestra. No implementa carga real, cambio de ícono del launcher ni persistencia de branding antes de conocer la organización de la sesión. Son límites de la simulación aprobada.
4. Preferencias y documentos ficticios usan AsyncStorage con controles lógicos y rollback, no cifrado de contenido ni una frontera de seguridad de servidor. El permiso de Plataforma se activa únicamente en un laboratorio de demo; no debe reutilizarse como autorización productiva.
5. La galería DS-06 conserva el texto histórico «integración pendiente de T-M3» en el ejemplo de una capa. El flujo real de adjuntos T-M3 está implementado y probado; es una rotulación antigua del showcase, no un nuevo bloqueo ni un conector real. El shell histórico ModuleScreen queda sin rutas consumidoras.
6. Los metadatos de Plataforma son un snapshot de muestra aprobado, no una consulta ni un reflejo en vivo del consumo de los negocios. No se deduce pertenencia administrativa de la propiedad de un negocio.

## Conservación y siguiente fase

Código en commit local de implementación y corrección de compatibilidad; cierre de evidencia/inventario en commit posterior. El manifiesto `artifacts/continuation-b/conservation-158.json` registra el SHA final, el incremental, su dependencia de `9e50c40`, hash/tamaño y verificación de recuperación. Se mantiene íntegro el bundle completo autocontenido `artifacts/full-backup/dashfort-completo-9e50c40.bundle` y su clon de verificación, además de toda la cadena Offline y los 26 protegidos. No se genera otro paquete completo ni ZIP redundante.

Configuración 0.1.3 / versionCode 4 / com.demfort.dashfort.dev preparada, sin generar APK ni ejecutar Gradle. La APK 0.1.2 y su firma se conservan. La siguiente fase es validación nativa en un entorno aislado con almacenamiento suficiente, conforme a CONTINUIDAD-VALIDACION-NATIVA.md. No activar backend, servicios o infraestructura sin revisión y autorización específicas.
