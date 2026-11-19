# Recuperación segura de espacio y decisión de compilación

## Medición y resultado

El volumen completo tiene 8.417.406.976 bytes (7,84 GiB). Antes de limpiar: 7.822.610.432 bytes usados (7,29 GiB) y 148.525.056 disponibles (141,6 MiB). Después: 6.066.368.512 usados (5,65 GiB) y 1.904.766.976 disponibles (1,77 GiB). La diferencia entre total, usado y disponible corresponde a espacio reservado por el sistema de archivos, no a capacidad utilizable por el proceso.

Se recuperaron **1.756.241.920 bytes: 1,64 GiB** de espacio disponible. Son medidas inmediatamente antes/después de la limpieza; las capturas y el desarrollo posterior consumen algo del margen recuperado. Evidencia exacta: `evidence/disk-recovery.json`.

## Qué ocupaba el entorno

| Categoría                                      | Medición inicial aproximada    | Decisión                                                                                      |
| ---------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| Gradle completo en `work/apk-tm3/gradle-cache` | 3,21 GiB                       | Conservar originales Maven, wrapper, JDK y metadatos; limpiar solo transformaciones derivadas |
| Transformaciones Gradle 9.4.1                  | 1,74 GiB según du              | Regenerables; borradas tras comprobar ausencia de APK, bundles, claves y repositorios         |
| SDK/NDK Android                                | 1,39 GiB                       | Conservar Platform 37, Build Tools 36/37, NDK, CMake y platform-tools                         |
| `node_modules` móvil                           | ~1.006 MiB lógicos             | Conservar: dependencias instaladas necesarias para continuar sin reinstalar                   |
| Copia/build T-M3                               | ~1,04 GiB con sus dependencias | Conservar código, resultados y APK anteriores                                                 |
| Copia/build T-M4                               | ~518 MiB                       | Conservar íntegra; contiene salidas y respaldos anteriores                                    |
| Artefactos móviles                             | ~130 MiB                       | Conservar APK, bundles, capturas e informes                                                   |
| Documentación móvil                            | ~22 MiB                        | Conservar evidencia única y documentación                                                     |
| Laboratorio visual                             | ~12 MiB                        | Conservar código, capturas y comparador                                                       |
| Git móvil compartido                           | ~57 MiB                        | Conservar todos los commits y referencias                                                     |
| Worktree backend de auditoría                  | ~28 MiB                        | Conservar íntegro, sin arranque ni cambios                                                    |
| Metro/npm/bundler temporal                     | ~100 MiB                       | Limpiar caché transformada de Metro, tarballs npm y un temporal antiguo del bundler           |

Hay archivos enlazados físicamente entre copias y cachés. Los tamaños lógicos de carpetas no deben sumarse como si todos fueran bloques distintos. La recuperación acreditada es el aumento real del espacio disponible, no la suma de tamaños calculados por carpeta.

## Acciones realizadas

Se retiraron exclusivamente estas cuatro rutas de caché, sin procesos Gradle/Metro/npm activos:

1. `/workspace/work/apk-tm3/gradle-cache/caches/9.4.1/transforms`
2. `/tmp/metro-cache`
3. `/tmp/dashfort-npm/_cacache`
4. `/tmp/expo-bundler-0.7011155347268281-1794419179555`

Son transformaciones regenerables, tarballs descargados y un temporal del bundler. No se tocaron `caches/modules-2`, wrapper, JDK, SDK/NDK, `node_modules`, salidas antiguas de build, logs históricos ni carpetas de entrega. La próxima compilación deberá regenerar sus transformaciones Gradle a partir de los originales conservados; esta limpieza no convierte el entorno en uno listo para compilar.

Antes y después se calcularon hashes de los **26 archivos protegidos encontrados** (APK, bundles Git y almacenes de firma), y se compararon ramas, commits y estado de ambos worktrees. Los 26 hashes y ambos estados coinciden. No se borró ningún archivo protegido ni evidencia sin respaldo. La clave privada permanece fuera de Git; el informe solo conserva su hash de integridad, nunca sus bytes.

El procedimiento queda en `scripts/recover-build-space.py`: por defecto solo inspecciona; `--apply` borra únicamente la lista fija, rechaza artefactos protegidos y verifica conservación. No usa red ni servicios externos.

## ¿Se puede intentar la APK ahora?

**No con un margen acreditado. No se fuerza Gradle.** Los 1,77 GiB disponibles son insuficientes para garantizar la regeneración de ~1,7 GiB de transformaciones más intermediarios C++/Java, Hermes, R8, empaquetado y sus picos temporales. No se desactivará R8 ni se reducirá la seguridad de la receta para hacerlo caber. Los 15 GiB libres de la receta son un presupuesto conservador para una compilación aislada; no son una medición exacta del pico de esta versión, que todavía no se ha compilado.

El volumen completo actual es menor que ese presupuesto. Destruir respaldos o dependencias para liberar algo más no soluciona de forma profesional esa limitación. Se conserva la APK 0.1.2 y la firma compatible. No se generó otra APK ni se inició Gradle, EAS o GitHub Actions.

## Mejor alternativa de costo mínimo

**Un equipo o entorno de desarrollo local con 25–30 GB de almacenamiento disponible para el workspace**, dejando al menos 15 GB libres al iniciar el build, JDK completo compatible, Node, SDK Platform 37/Build Tools 37, NDK y CMake de la receta. Conservar 8 GB de RAM como punto de partida y compilar ARM64 con un worker; confirmar recursos antes del intento.

- Puede seguir usándose Codex si se amplía este volumen o se le proporciona otro entorno/montaje local escribible con esa capacidad. Desde este contenedor no hay una herramienta habilitada para ampliar la cuota del volumen. Cambiar `/workspace` por `/tmp` no sirve: ambos están en el mismo volumen.
- Si la plataforma de Codex no permite ampliarlo, usar Codex CLI/IDE en un PC propio con Android Studio/SDK y espacio suficiente. No exige EAS ni un servicio de build de pago. Transferir el código mediante el bundle Git local verificado; no es necesario hacer push.
- Se detectó `/dev/shm` con 4,9 GiB, pero es memoria RAM temporal, no disco persistente. Compite con Gradle, R8 y C++ dentro de los ~10 GB de RAM del entorno; no garantiza el margen de compilación ni conserva datos tras reinicio. No se trasladan respaldos ni dependencias a ese tmpfs y no se usa para forzar el build. El JDK 17 completo ya está presente en el caché de toolchains conservado, además de Java 21 por defecto.
- La firma experimental debe conservarse y ponerse a disposición del nuevo entorno de forma privada. No subir la clave al ZIP de evidencias, Drive, repositorio o un servicio de build. Si el nuevo entorno no tiene esa firma, detener el build; una firma distinta no actualizaría 0.1.2.
- Un disco/VM externo contratado o un servicio remoto de compilación necesitaría una autorización nueva por sus posibles costos. No se inicia ninguno automáticamente. No usar el Hetzner productivo para esta alternativa.

## Trabajo móvil que puede continuar

Con el margen recuperado siguen siendo viables React Native, TypeScript, modelos locales, pruebas de lógica, Chromium sin servidor y capturas. La continuación autorizada implementa Biblioteca como primer lote tras B y el QA de los 19 IDs de CRM. No depende de activar autenticación real ni de compilar la APK. El backend para Claude sigue en `562a8b386b7f0d0df9292406167357aa988fd4d0`, sin modificar ni arrancar.
