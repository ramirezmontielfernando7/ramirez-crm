# Conservación local y recuperación

La referencia del binario probado es T-M3 `d849c0dcfbb1fe2a426d1f9a79af817922e0d068`, rama ya respaldada `codex/dashfort-mobile-tm3-20261111`. La receta y procedencia añadidas después están en el checkpoint **local** `codex/dashfort-mobile-apk-tested-20261111`, `bd3ba4f55f45d0daa1d630815156feca28bfd6c4`.

T-M4 está en **`codex/dashfort-mobile-tm4-20261111`**, derivada del checkpoint. Commits de implementación: `4b32df4` (dominio y lógica) `89b7a2c` (pantallas, navegación y versión 0.1.1) y `9e2238f` (concurrencia al cargar/guardar) `5f1c437` (caché ocupada recuperable) y `bba69df` (suscripción del chat oculto). El commit de documentación posterior completa capturas/resultados sin cambiar la fuente del APK T-M4.

## Respaldos preparados

- `/workspace/work/entrega-dashfort-apk-probada/apk-probada-receta.bundle`: incremento del checkpoint desde T-M3, verificado.
- `/workspace/work/entrega-dashfort-apk-probada/fuentes-checkpoint.zip`: fuente completa móvil del checkpoint, sin claves ni dependencias.
- `/workspace/work/entrega-dashfort-tm4/dashfort-mobile-tm4.bundle`: incremento desde T-M3, con referencias de checkpoint y T-M4.
- `/workspace/work/entrega-dashfort-tm4/dashfort-mobile-tm4-fuentes.zip`: archivo completo del subárbol móvil, con documentación y comparador.
- `/workspace/work/entrega-dashfort-tm4/manifest.json`: commits completos, hashes y tamaños de archivos; permite identificar el commit final sin referencias autorreferenciales dentro de su propio árbol.

Los archivos T-M4 se generan después de confirmar el último commit y se comprueban por recuperación. El bundle incremental necesita el historial T-M3, disponible en GitHub; el ZIP es independiente del historial. No contienen node_modules, android generado, SDK, caches, APK ni firmas privadas. Las APK se conservan por separado, en sus carpetas de entrega.

Para recuperar el historial en una máquina nueva, sin modificar main:

```bash
git clone --single-branch --branch codex/dashfort-mobile-tm3-20261111 \
  https://github.com/ramirezmontielfernando7/ramirez-crm.git recuperacion-mobile
cd recuperacion-mobile
git bundle verify /ruta/dashfort-mobile-tm4.bundle
git fetch /ruta/dashfort-mobile-tm4.bundle \
  codex/dashfort-mobile-tm4-20261111:refs/remotes/respaldo/tm4
git switch -c recuperar-tm4 refs/remotes/respaldo/tm4
cd apps/mobile
npm ci
npm run typecheck
npm test
```

El ZIP fuente permite abrir la app y reproducir la compilación local con el lockfile, SDK/JDK y script descritos en docs/APK-LOCAL.md. No garantiza igualdad binaria byte a byte por timestamps/rutas/firma; para la referencia exacta se conserva cada APK con SHA-256.

## Firma y material sensible

La clave experimental original permanece únicamente en el área privada de compilación `/workspace/work/apk-tm3/signing/dashfort-experimental.keystore` y las copias nativas temporales necesarias. No está en Git, el ZIP, el bundle, las capturas ni los informes. Solo se registra la huella del certificado público. No se tocaron claves de la TWA ni certificados productivos.

Para actualizar la app instalada debe conservarse esa firma de forma privada. Los respaldos de fuente públicos no bastan para conservarla. Si el entorno se pierde sin guardar la firma en un lugar privado del propietario, se podrá reconstruir con otra clave, pero Android exigirá desinstalar la demo anterior. No se sube una clave privada para resolverlo.

## Estado remoto

T-M3 ya estaba respaldada. **No se hizo push del checkpoint nuevo ni de T-M4.** Los respaldos locales no se presentan como conservación remota permanente. Subir una rama requiere autorización expresa nueva y revisión de disparadores aplicables antes del único push autorizado. No se crearon PR, tags, releases, merges ni publicaciones. Tampoco se reemplazó la APK original privada de Drive.

Las verificaciones de aislamiento y patrones de secretos están en evidence/isolation-audit.json; son evidencia del alcance revisado, no una garantía sobre automatizaciones externas que no se inspeccionaron en esta fase.
