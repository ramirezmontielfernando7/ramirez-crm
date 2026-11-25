# Auditoría adversarial de la firma móvil

| Amenaza | Control implementado | Condición o límite pendiente |
| --- | --- | --- |
| Inyección por argumentos, nombres de archivos o ref | Entradas en env o JSON, listas de campos estrictas, SHA/ref/IDs validados, llamadas parametrizadas, miembro ZIP único y sin extracción general. Resúmenes escritos solo después de validar. | Parámetros suministrados a GitHub son visibles en este repositorio. |
| Artefacto de otro workflow, fork, ref, repo o reintento | El firmante coteja los metadatos de ejecución de la API y la asociación del artefacto. Exige intento 1, ruta exacta y commit idéntico del control. | El job de build ejecuta código y dependencias de la app. El hash y la procedencia no prueban inocuidad. Revisar el SHA fuente. |
| Sustitución de ZIP o APK luego de la revisión | La API vincula ID y SHA del ZIP. Se coteja la APK con el SHA de la solicitud antes y después de que el usuario apruebe y justo antes de alinear. | Depende de GitHub Actions y de la integridad del runner. |
| Secreto en logs o artefactos y APK ya firmada | Los builds no referencian secretos. Validación de miembros/certificados, env mínimo, tmp privado y limpieza por trap. Solo se publican APK y checksum. | Los nombres de archivo se chequean como defensa adicional. No es un análisis exhaustivo del contenido de la aplicación. |
| Ejecución de TWA por IA con token amplio | Las IA solo usan herramientas MCP estructuradas. El host que guarda el token fija repo, operación, ref y dos workflows. Roles, autenticación individual y revocación por cliente. | El host necesita TLS y credenciales separadas. Su compromiso expondría el token de Actions de todo el repositorio. El host está implementado, no instalado. |
| Usuario o agente se autoaprueba | Identidad del propietario fijada por ID, solicitante distinto, gate de revisores, sin bypass y segundo control con historial de aprobación. | Verificar política y comportamiento en GitHub antes de subir material real. |
| Rama o workflow no autorizado referencia el entorno | Selección exacta de rama del entorno. La rama de control debe protegerse contra cambios no revisados. No hay trigger de fork, PR, tags, main ni despliegue. | La política de ambiente por sí sola no restringe el nombre del workflow. El ruleset de control y la revisión de cualquier cambio en esa rama son imprescindibles. |
| Extracción de la clave en tiempo de ejecución | El paso que firma corre en namespace sin red, con privilegios normales y sin ejecutar código Expo. Herramientas y acciones externas fijadas, certificado de salida obligatorio. | El GitHub runner, kernel y binaries son parte de la frontera. El keystore es exportable. El aislamiento de red pasó con una APK sintética hospedada. Falta el ensayo que recorre también la aprobación. |
| Actualización Android incompatible o downgrade | Paquete y ABI estrictos, versionCode de salida mayor al mínimo definido, certificado histórico exacto y v2/v3, APK firmada distinta en laboratorio. | La instalación sobre la 0.2.2 en el Motorola queda para Fer tras la activación. |
| Pública una APK destinada a distribución privada | El flujo real exige bandera explícita de distribución pública en build y firma. Producción sigue desactivada. Los únicos artefactos de prueba hospedados son demo. | Si Fer elige distribución privada, preparar la entrega privada y verificarla antes de firmar. |
| Pérdida o indisponibilidad futura de Codex | Cifrado para destinatario independiente, muestra de recuperación probada con clave desechable, procedimiento para dos copias y passphrase separada. | Falta el destinatario verificado, permiso de transferencia y restauración real. |
| Despliegue productivo accidental | Workflows existentes intactos. Rama aislada, registro por push inocuo, entorno con `deployment: false`, sin Release. | GitHub devuelve 403 para listar webhooks externos. Verificar integraciones con el propietario antes de activar. |

| Confundir el laboratorio automático con un permiso de firma real | `automatic_lab` se rechaza si el modo no es `lab`. El job desechable no referencia entorno ni secretos, verifica otra vez el fixture fijo y requiere una huella nueva. | La aprobación nativa se prueba en otra corrida, separada del funcionamiento del runner. |
| Entorno mal configurado por una credencial administrativa amplia | Aprovisionador de solo lectura por defecto, alcance fijo de repositorio, ref y entornos. Rechaza cambios sobre políticas ajenas y comprueba la rama antes/después. | Se necesita autorización administrativa temporal, separada del despachador. La credencial actual solo permitió inspección. |

## Desactivación y recuperación

Deshabilitar la variable `DASHFORT_SIGNING_LIVE`, retirar permisos del
despachador, cancelar todas las ejecuciones activas y retirar los secretos
del entorno. Deshabilitar las credenciales individuales que se deban revocar.
Conservar APK y respaldo cifrado existente. Una APK ya firmada conserva
su validez de Android. Si la clave privada se extrae, estos pasos limitan
operaciones futuras del sistema, pero no invalidan las firmas del atacante.

Para restaurar, seguir el capítulo de respaldo de [README](README.md).
La huella pública y el paquete se cotejan con la APK histórica antes de
reenrolar la clave. La autenticación y cualquier nuevo método de distribución
se verifican en laboratorio antes de reabrir el flujo real.
