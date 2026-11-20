# Respaldo Git completo y autocontenido · plan, no ejecutado

El paquete incremental de esta ejecución sigue necesitando los anteriores. Para eliminar esa dependencia se recomienda un bundle con **todas las referencias y toda la historia alcanzable**, verificado en un repositorio vacío. Esto conserva también las ramas locales del backend reservado sin arrancarlo ni modificar sus archivos. No requiere GitHub, servicios remotos ni pagos.

El almacén Git observado antes del nuevo commit ocupa aproximadamente 101 MiB entre objetos sueltos y packs (69,92 + 30,91 MiB). Eso no determina exactamente el tamaño de otro pack ni el espacio temporal. Con solo ~1 GiB libre, este plan **no se ejecutó aquí**. Usar un disco local/USB ya disponible o un entorno aislado con al menos 2 GiB de margen exclusivo para crear y verificar el respaldo; para desarrollo Android se necesita capacidad adicional. No solicitar automáticamente una instancia mayor ni contratar almacenamiento.

## Preparación y conservación

1. Elegir un destino local privado en otro volumen y verificar espacio/cuota. Obtener autorización antes de consumir almacenamiento adicional del entorno actual o copiar el paquete fuera de él.
2. Revisar `git worktree list --porcelain`, `git status --porcelain` en cada worktree y `git for-each-ref`. Registrar SHA completo de la rama móvil, main, rama del backend reservado y demás referencias que se conservarán. Un bundle conserva los objetos alcanzables desde las referencias incluidas; no es una copia forense de reflogs ni de objetos huérfanos. Revisar esa necesidad por separado y no ejecutar limpieza/prune. Trabajo no confirmado necesita conservación separada autorizada, sin hacer commits en el backend automáticamente.
3. Revisar datos sensibles del historial y las referencias antes de trasladarlo. Un `--all` incluye la historia del CRM, no solo apps/mobile. Mantenerlo privado, con acceso restringido y cifrado del volumen/archivo si corresponde. No subirlo a Drive/GitHub ni compartirlo bajo esta autorización.
4. Comprobar si hay Git LFS o submódulos. Sus objetos externos/repositorios requieren copia local adicional; no descargar nada automáticamente. Un bundle de Git por sí solo no contiene esos objetos externos.

## Comandos propuestos (no ejecutados)

Ejecutar desde la raíz del repositorio, con `/mnt/respaldo-dashfort` ya creado en el volumen adecuado. Los nombres son ejemplos; no sobrescribir paquetes existentes.

```sh
git bundle create --version=2 /mnt/respaldo-dashfort/dashfort-completo.bundle --all
git bundle verify /mnt/respaldo-dashfort/dashfort-completo.bundle
git bundle list-heads /mnt/respaldo-dashfort/dashfort-completo.bundle
sha256sum /mnt/respaldo-dashfort/dashfort-completo.bundle > /mnt/respaldo-dashfort/dashfort-completo.bundle.sha256
git clone --bare /mnt/respaldo-dashfort/dashfort-completo.bundle /mnt/respaldo-dashfort/verificacion.git
git -C /mnt/respaldo-dashfort/verificacion.git fsck --full
git -C /mnt/respaldo-dashfort/verificacion.git rev-parse refs/heads/codex/dashfort-mobile-b-continuation-20261119
```

No añadir `^commit`, rangos, filtros de historia ni prerrequisitos al crear ese bundle. Validar que su cabecera no enumera prerrequisitos y que el clon vacío puede leer el SHA móvil esperado y todos sus ancestros, incluida Offline f3f467a. Comparar ramas/tags con el inventario original, revisar salida completa de `fsck` y guardar un manifiesto con los SHA, tamaño, SHA-256 y resultados. Verificar también el checksum después de copiarlo al destino. Mantener los incrementales anteriores hasta comprobar esta restauración; no eliminarlos automáticamente después.

## Archivos que Git no cubre

APK anteriores, firma/certificados privados, dependencias, SDK, caches y otros artefactos ignorados o ubicados fuera del repositorio no quedan cubiertos por el bundle. Mantener los 26 artefactos protegidos y su manifiesto SHA-256. Cualquier copia adicional de claves debe ser local, cifrada y con autorización específica; no incluirlas en el ZIP de entrega. Los dos worktrees no deben borrarse para ganar espacio. La recuperación del código se prueba en el clon de verificación; no se ejecutan npm, Gradle, backend, PostgreSQL, workers, migraciones ni conexiones reales durante esta comprobación.
