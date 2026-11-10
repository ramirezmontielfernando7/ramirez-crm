# Avance de Dashfort Mobile · 10 de noviembre de 2026

**Entrega: primera base funcional de T-M1, con simulación y verificación web. No se declara cierre de calidad nativa.**

Repositorio `ramirezmontielfernando7/ramirez-crm`, main base `95b7ea0b236b35ee29a1a288a55c315a050e3b6e`, rama exclusiva `codex/dashfort-mobile-tm1-20261110`. Código de base en commit `794c2a0` y commit posterior de documentación/evidencia. `main` no se modificó. Todos los cambios están en `apps/mobile`.

## Construido y probado con datos ficticios

- Proyecto independiente React Native + Expo + TypeScript estricto y lockfile propio.
- Tokens oficiales, temas claro/oscuro/automático, Inter 400/500/600 local y preferencias persistidas.
- Componentes reutilizables, capas sin rutas, galerías interactivas y estados cargando/vacío/error/sin conexión simulados.
- Sesión ficticia de 30 días: SecureStore en Android/iOS, sessionStorage para QA web, recuperación, caducidad y cierre. Sin contraseñas persistidas.
- Navegación flotante de 5/4/3 pestañas según Propietario/Coordinador/Asesor, comprobación en entrada directa, módulo apagado y acceso denegado.
- Formularios de acceso, invitación/restablecimiento ficticios de un solo uso, registro cerrado y recuperación orientada al administrador.
- Prebuild Android con ID independiente `com.demfort.dashfort.dev`, icono de la marca copiado del activo existente, OTA apagada y permisos innecesarios bloqueados.

## Cobertura honesta

12 IDs con implementación simulada: **AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, MORE-08**.

Los 146 IDs restantes no están implementados. Las raíces Bandeja/CRM/Estudio IA/Marketing/Más son soportes de navegación de T-M1, no entregas finales de sus módulos. La galería de mensajes permite enviar un ejemplo a memoria; no es INB-11 ni implementa el contrato de WhatsApp. Las diferencias visuales y las comprobaciones pendientes figuran en QA-VISUAL.md.

## Verificación

| Comprobación | Resultado |
|---|---|
| TypeScript estricto | Pasa |
| Expo install --check | Dependencias compatibles con SDK 58 |
| Formato de código | Pasa |
| Pruebas de lógica, sesión, roles, enlaces, errores de almacenamiento, concurrencia y contraste | 10 pasan |
| Chromium / React Native Web | 8 recorridos pasan; 0 fallos, 0 omitidos |
| Matriz visual | 390×844 y 360×640 × claro/oscuro |
| Capturas | 48 de los 12 IDs y 4 de navegación, todas de React Native Web; comparador con 24 referencias oficiales |
| Controles de los recorridos visuales | Sin desborde horizontal del documento; sin blancos táctiles bajo 44×44 |
| JavaScript/red durante recorridos visuales | Sin errores y sin solicitudes HTTP externas |
| Export Android Hermes | Generado; 5,220,289 bytes de bytecode, más activos |
| Export iOS Hermes | Generado; 5,234,498 bytes de bytecode, más activos |
| Prebuild Android | Generado; sin compilar ni instalar |
| APK local | No generada: falta SDK Android Platform 37; script sale con código 2 |
| Emulador / teléfono / iOS nativo | No disponibles / no probados |

Los tamaños de bytecode son métricas de artefacto, no memoria de ejecución. No se midieron FPS, RAM, batería ni rendimiento de listas grandes. No hay afirmación de equivalencia con WhatsApp.

Las primeras pruebas detectaron problemas de accesibilidad de capas, Escape durante apertura, traducción de estados ARIA en RN Web y dos pares de contraste. Se corrigieron y se repitieron los recorridos afectados antes de registrar los resultados finales.

## Pendiente y riesgo

- SDK Android ausente: instalar toolchain en un entorno apropiado y compilar con el procedimiento exacto de APK-LOCAL.md. No se utilizó EAS ni cuotas compartidas.
- Validar teclado, áreas seguras, gestos, Android Back real, TalkBack/VoiceOver, texto del sistema al 130% y restauración tras terminar proceso. Los tests de la política de Atrás no reemplazan un emulador.
- Sesión y permisos son simulados; una integración futura debe validarlos en servidor. No hay tokens productivos ni conexiones a APIs. El tema se guarda por instalación de demo; preferencias por persona se completan en T-M8.
- La simulación de enlaces no cambia la clave de las cuentas de demo: valida formulario/consumo y crea sesión ficticia de Asesor. Los enlaces se validarán atómicamente en un futuro servidor de pruebas.
- Verificar disparadores externos de Coolify/webhooks antes de solicitar autorización definitiva de push; los workflows del repo no reaccionan al push normal a esta rama.
- El directorio de salida `/codex/browser/projectless/0004-files-mentioned-by-the-user-uploaded-file-pointe/output` no existe en el executor y no se pudo crear por permisos del sistema. Se preparan ZIP y bundle como respaldo local dentro de `/workspace/work/entrega-dashfort-tm1`; no se inventa un enlace de descarga ni se publica para sortear este bloqueo.

## Conservación y siguiente acción

Código en `/workspace/work/ramirez-crm/apps/mobile`. ZIP móvil y bundle incremental verificados, sin secretos, node_modules, cachés o claves de firma. Ver CONSERVACION.md. No se realizó push, PR, merge, deploy, tag, cambios de producción ni uso de servicios pagados.

Siguiente etapa recomendada: T-M2, manteniendo T-M1 como checkpoint recuperable y cerrando primero el QA nativo cuando el SDK esté disponible. La matriz completa de 158 filas está en cobertura.csv. Los archivos modificados se obtienen con `git diff --name-only main..HEAD`; todos pertenecen a Mobile.
