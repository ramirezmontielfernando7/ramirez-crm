# Dashfort Mobile · T-M1 + T-M2

Avance actual: T-M2 (Bandeja). Ver `docs/tm2/IMPLEMENTACION.md` y `docs/tm2/RESULTADOS.md`. T-M1 se conserva como base; su informe histórico está en `docs/AVANCE.md`.

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

La versión web sirve solo para QA del código React Native; no es evidencia de ejecución en Android/iOS. Ver `docs/AVANCE.md`, `docs/ARQUITECTURA.md`, `docs/APK-LOCAL.md`, `docs/PLAN.md` y `docs/cobertura.csv`. La APK aún depende de completar el entorno Android y sus pruebas.

Trabajar solo dentro de esta carpeta, en la rama `codex/dashfort-mobile-tm2-20261110`. No lanzar los workflows existentes ni publicar OTA. Antes de push: autorización del propietario y verificación de disparadores externos, según `docs/CONSERVACION.md`.
