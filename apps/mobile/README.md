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
