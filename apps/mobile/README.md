# Checkpoint B · Agenda y Biblioteca

B original preservada; Agenda CRM-20…25 y editor de Biblioteca con navegación interna verificados. 70/158 IDs implementados, 88 pendientes. 235 pruebas de lógica aprobadas. APK pendiente por margen de disco insuficiente; sin servicios reales ni cambios de backend. Ver [lote 02](docs/refinement-b/LOTE-02-AGENDA.md). Próximo lote autónomo: Tareas/Notas CRM-30…33, unificando tareas vinculadas con T-M4. Informes siguientes históricos.

# Continuación B · Biblioteca y recuperación de espacio

B original implementada; Biblioteca CRM-40/41/42 funcional en simulación. 64/158 IDs con código, 94 pendientes. Se recuperaron 1,64 GiB de cachés conservando ambos worktrees, APK y firmas. Compilación Android aún bloqueada por margen insuficiente; no se fuerza Gradle. Ver [espacio y APK](docs/refinement-b/ESPACIO-Y-APK.md) y [lote 01](docs/refinement-b/LOTE-01-BIBLIOTECA.md). Próximo lote autorizado: Agenda CRM-20…25, sin backend ni nueva aprobación visual. Informes siguientes históricos.

# B original integrada · continuación móvil autorizada

B aplicada con alcance explícito en componentes reales; comparación exacta de Bandeja, 70 capturas y QA de módulo de los 19 IDs CRM. 209 pruebas de lógica aprobadas. Configuración preparada 0.1.3/4; APK no compilada por espacio local insuficiente. Sin cambios de backend ni conexiones reales. Ver [resultados](docs/refinement-b/RESULTADOS.md). Los apartados siguientes conservan el historial.

# Preparación integral aislada · checkpoint posterior a I2-P2

Nueva rama `codex/dashfort-mobile-offline-20261119`. 207 pruebas de lógica móvil y 15 de preparación backend; 19 IDs CRM nuevos con previews, sin validar Expo/nativo completo. 61 IDs con código y 97 pendientes: no se declara terminada la app ni una integración real. HTTP cerrado, UI previa conservada, APK 0.1.2 intacta. Backend en worktree separado de main daccd873; no arrancado. Ver [resultados](docs/offline-integral/RESULTADOS.md), [pantallas](docs/offline-integral/PANTALLAS.md), [comparación](docs/offline-integral/comparacion.html) y [expediente para Claude](docs/offline-integral/EXPEDIENTE-CLAUDE.md). Ningún push/servicio/migración autorizado en esta entrega. Informes siguientes históricos.

# I2-P2 · Correcciones de seguridad aisladas

Rama `codex/dashfort-mobile-i2p2-20261117`, desde I2-P/8d0a1d3. Corregidos reentrada de login/logout, limpieza parcial, estado de revocación offline y allowlist de scope; 176 pruebas de lógica y 45 recorridos web aprobados. HTTP sigue bloqueado, sin cambiar UI, dependencias ni APK 0.1.2. Ver [resultados](docs/integration-i2p2/RESULTADOS.md), [implementación](docs/integration-i2p2/IMPLEMENTACION.md), [controles futuros](docs/integration-i2p2/CONTROLES-I2.md) y [expediente para Claude](docs/integration-i2p2/REVISION-CLAUDE.md). No arrancar backend/BD ni hacer push sin autorización nueva. Los informes siguientes son históricos.

# I2-P · Preparación aislada de autenticación

Rama `codex/dashfort-mobile-i2p-20261116`, desde I1/00fb8ca. Contratos, lifecycle/vault, SecureStore opt-in de fixtures y transporte bloqueado, sin conexión ni cambios de UI o APK. Ver [resultados](docs/integration-i2p/RESULTADOS.md), [implementación](docs/integration-i2p/IMPLEMENTACION.md), [plan de activación](docs/integration-i2p/ENTORNO-Y-ACTIVACION.md) y [expediente para Claude](docs/integration-i2p/REVISION-CLAUDE.md). No activar I2 real ni hacer push sin autorización. Se conservan los informes anteriores como históricos.

# I1 · Auditoría y preparación de integración (sin conexión)

Rama `codex/dashfort-mobile-i1-20261115`, desde el checkpoint T-M5B `2bd4b62`. La APK 0.1.2 y la UI siguen intactas. Contratos y simuladores sin transporte HTTP, sin dependencias nuevas y sin conexión a producción. Ver [diagnóstico](docs/integration-i1/AUDITORIA.md), [arquitectura](docs/integration-i1/ARQUITECTURA.md), [matriz de módulos](docs/integration-i1/MODULOS.md), [plan I1–I7](docs/integration-i1/PLAN-I1-I7.md) y [resultados](docs/integration-i1/RESULTADOS.md). No iniciar I2 ni publicar sin autorización nueva.

# T-M5B · Pruebas locales Android

Etapa actual en `codex/dashfort-mobile-tm5b-20261114`, desde T-M5A `3b85b3b`. Expo 58.0.25, notificaciones locales opt-in, sin tokens ni servicios remotos. APK 0.1.2 generada y verificada estáticamente; ejecución Android pendiente. Ver [APK](docs/tm5b/APK-VERIFICADA.md), [implementación](docs/tm5b/IMPLEMENTACION.md), [resultados](docs/tm5b/RESULTADOS.md) y [prueba Motorola](docs/tm5b/PRUEBA-MOTOROLA.md). Se conservan los informes históricos siguientes. Sin push ni T-M5C.

# Dashfort Mobile · T-M1 a T-M4 + T-M5A simulada

T-M5A añade contratos, aislamiento ficticio, registro/renovación/revocación simulados, agrupación, deduplicación, sincronización y apertura segura. Ver `docs/tm5a/IMPLEMENTACION.md`, `docs/tm5a/RESULTADOS.md` y `docs/tm5a/T-M5B.md`. No se instaló ningún SDK nativo ni se generó APK nueva; la 0.1.1 probada por el propietario permanece intacta.

Base aprobada: T-M4 (detalles y acciones de conversaciones). Ver `docs/tm4/RESULTADOS.md`, `docs/tm4/IMPLEMENTACION.md` y `docs/tm4/comparacion.html`. La primera APK T-M3 fue instalada y probada por el propietario; su versión exacta y receta están en `docs/apk-probada/VERSION.md`. Los informes previos se conservan como históricos.

App nativa Android/iOS con React Native + Expo + TypeScript. Demo **ficticia**, aislada del CRM, backend y TWA. No contiene WebView, APIs productivas ni servicios de pago.

```bash
cd apps/mobile  # En el ZIP descargable, entrar directamente a dashfort-mobile
npm ci
npm run typecheck
npm test
npm start
```

Credenciales ficticias: `fer@ejemplo.mx` (Propietario), `coordinador@ejemplo.mx` (Coordinador), `asesor@ejemplo.mx` (Asesor). Contraseña de todos: `Dashfort2026`. No introducir credenciales reales.

En «Demo aislada · T-M1» se cambia el rol, tema, módulo disponible y sesión caducada, se prueban enlaces de acceso y se abren las seis galerías de componentes. Los tokens `demo-activate` y `demo-reset` son de un uso por instalación; un enlace arbitrario muestra el error de vencimiento al enviar. El restablecimiento no modifica credenciales ficticias: es una demostración de UI y consumo de enlace.

```bash
npm run export:web
npm run test:browser     # Requiere Chromium; CHROMIUM_PATH permite indicar otro ejecutable
npm run export:android  # Bundle JavaScript, no APK
npm run export:ios      # Bundle JavaScript, no IPA
npm run apk:local       # Requiere SDK Android; no llama a EAS
```

La versión web sirve solo para QA del código React Native; no es evidencia de ejecución en Android/iOS. Ver `docs/AVANCE.md`, `docs/ARQUITECTURA.md`, `docs/APK-LOCAL.md`, `docs/PLAN.md` y `docs/cobertura.csv`. La APK T-M3 ya fue compilada localmente y probada en Android 16. El QA nativo de T-M4 se distingue del realizado en navegador.

Trabajar solo dentro de esta carpeta, en la rama `codex/dashfort-mobile-tm5a-20261113`. No lanzar los workflows existentes ni publicar OTA. Antes de push: autorización del propietario y verificación de disparadores externos, según `docs/CONSERVACION.md`.

Chat: abrir una conversación desde Bandeja. El menú «Pruebas de chat» permite simular recepción, pérdida de confirmación, offline, paginación fallida y ventana cerrada. Cámara, adjuntos, ubicación, contacto, redacción IA y compartir usan muestras locales: no acceden a servicios ni archivos reales. Los borradores y el vaciado del historial persisten localmente por perfil/chat; los envíos de demostración se mantienen en memoria. T-M4 incorpora detalles e historial desde el nombre o menú del chat. Las notas internas nunca se envían al cliente. La conexión por chat solo aparece al habilitar complemento/permisos ficticios en «Pruebas de detalles». No iniciar T-M5B/T-M5C ni hacer push sin autorización.

QA opt-in: después de entrar con un perfil ficticio en `/demo`, abrir `/demo?notifications=1`. La pantalla normal no cambia. Los controles solo afectan al simulador: no solicitan permisos reales ni emiten avisos del sistema. No iniciar T-M5B/T-M5C ni hacer push sin autorización.
