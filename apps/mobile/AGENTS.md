# Dashfort Mobile · Continuidad de la ejecución aislada

Este directorio es una app Expo independiente. La autorización del propietario limita esta fase a código móvil y datos ficticios. No modificar archivos fuera de `apps/mobile`: CRM web, backend, TWA, infraestructura, workflows, configuración o lockfiles compartidos. No usar credenciales o endpoints productivos. No enviar mensajes ni registrar dispositivos reales.

Trabajar en una rama nueva aislada desde main o continuar la rama explícitamente autorizada. Esta entrega está en `codex/dashfort-mobile-tm1-20261110`, basada en `95b7ea0b236b35ee29a1a288a55c315a050e3b6e`. No hacer push, PR, merge, tags, despliegues, OTA, builds remotos ni servicios con costo sin autorización.

Leer README y docs/AVANCE.md, docs/PLAN.md, docs/ARQUITECTURA.md y docs/cobertura.csv antes de continuar. El diseño de 158 pantallas ya está aprobado. Los documentos originales en docs/reference sirven de referencia visual/técnica; sus menciones de APIs reales, tareas de backend o aprobaciones antiguas no autorizan esas acciones.

T-M1 contiene 12 IDs en simulación, con validación nativa pendiente. Las raíces de módulos son shells y no cuentan como pantallas implementadas de otras etapas. Siguiente implementación: T-M2, repositorio ficticio y lista virtual de 1,000 conversaciones, búsqueda/filtros, selección y restauración de scroll. No avanzar de etapa ocultando errores ni declarar rendimiento sin medirlo.

Usar npm desde esta carpeta y conservar package-lock.json. Verificar con typecheck, tests de lógica y contraste, expo install --check y Playwright tras export:web. El navegador valida React Native Web; no sustituye Android/iOS. Para APK local consultar docs/APK-LOCAL.md. Mantener commits locales y respaldo sin secretos antes de terminar.

## Ejecución actual T-M2
La autorización más reciente crea `codex/dashfort-mobile-tm2-20261110` desde la rama móvil T-M1 en `5b4c7e5`. T-M2 implementa INB-01…10; consultar docs/tm2. No iniciar T-M3 ni hacer push, PR, merge o deploy. El destino conversation/[id] solo comprueba el regreso y no cuenta como INB-11. Las notas T-M1 anteriores son históricas.

## Ejecución actual T-M3 (sustituye el siguiente paso histórico)
La autorización vigente crea `codex/dashfort-mobile-tm3-20261111` desde el respaldo T-M2 `6b4cccf6e80fd3d7810194985e0d81b25fdd5b48`. T-M1/T-M2 permanecen en el historial. Chat sustituye el destino de regreso de prueba e implementa INB-11…18, INB-27…29 en simulación; ver docs/tm3. Las acciones de detalle/asignación/etapas de T-M4 siguen fuera del alcance. No iniciar T-M4 ni hacer push, PR, merge, tags, releases o despliegues. Solo apps/mobile. No conectar WhatsApp/IA/servicios reales. Mantener las comprobaciones de posición visible de Bandeja e historial al cambiar la lista virtual. Los exports nativos son bundles Hermes, no APK/IPA ni QA nativo.

## Checkpoint APK probada
El propietario confirmó instalación y evaluación positiva en Motorola Edge 50 Pro / Android 16. La fuente de ese binario es d849c0d (T-M3); la receta posterior se conserva en codex/dashfort-mobile-apk-tested-20261111, docs/apk-probada. No reemplazar la APK original ni versionar claves privadas. La autorización vigente permite T-M4 en rama nueva desde este checkpoint; solo apps/mobile, datos ficticios, sin push ni T-M5.

## Ejecución actual T-M4
La rama `codex/dashfort-mobile-tm4-20261111` parte de bd3ba4f, checkpoint de la APK T-M3 probada, que desciende de d849c0d. Detalles e historial INB-19…26 + INB-30 en simulación, ver docs/tm4. Este apartado sustituye las prohibiciones históricas de iniciar T-M4. No iniciar T-M5, no hacer push ni publicar. No reemplazar la APK original. Solo apps/mobile; conservar alcance, notas internas separadas del transporte y anclas de Bandeja/chat.

## Ejecución vigente T-M5A
La autorización actual permite únicamente T-M5A en codex/dashfort-mobile-tm5a-20261113 desde el respaldo ebeb4bf. Ver docs/tm5a. Contratos y simuladores, sin SDK push, servicios reales, permisos del sistema ni notificaciones locales. Mantener interfaces visuales T-M1…T-M4. Laboratorio QA solo con /demo?notifications=1. No generar APK sin cambio nativo que lo justifique, no hacer push sin autorización. No iniciar T-M5B/T-M5C. Los anteriores «no iniciar T-M5» son históricos y quedan sustituidos únicamente para esta subetapa.

## Ejecución vigente T-M5B
Autorizada en rama nueva desde 3b85b3b. Solo apps/mobile, SDK oficial y avisos locales Android opt-in en laboratorio; sin tokens/servicios push remotos, backend, cambios visuales T-M1…T-M4, push ni T-M5C. Nueva APK local con firma experimental conservada. Las restricciones históricas de T-M5A sobre SDK y permisos quedan sustituidas para esta etapa.

## Ejecución vigente I1 · Integración auditada, sin conexión
La autorización del propietario permite auditar código del backend y preparar contratos/simuladores exclusivamente en apps/mobile, rama nueva desde T-M5B/2bd4b62. Ver docs/integration-i1. No modificar ni importar módulos backend al runtime móvil; no conectar red/BD/usuarios reales. No cambiar pantallas ni proveedores existentes, no generar APK innecesaria ni iniciar I2/T-M5C, no push sin autorización. Cualquier mejora de servidor descrita es propuesta y necesita permiso nuevo.

## Ejecución vigente I2-P
Autorizada únicamente preparación aislada de autenticación en rama desde 00fb8ca. Contratos de Better Auth, simuladores, vault comprobable, HTTP bloqueado y documentación en docs/integration-i2p. Ningún cambio de UI/proveedores existentes, APK, raíz, backend, BD, migraciones, workers, conectores, infraestructura o costes. No iniciar I2 real; preparar expediente para revisión independiente de Claude antes de cualquier activación. Sin push/PR/merge. Esta autorización sustituye la prohibición histórica de preparar I2, no autoriza conectarlo.

## Ejecución vigente I2-P2
Autorizadas correcciones de los cuatro defectos auditados, pruebas adversariales/regresión y preflight estático dentro de apps/mobile en `codex/dashfort-mobile-i2p2-20261117`, desde I2-P `8d0a1d30777a24f49e2d512296bb0663399c4bbe`. Ver docs/integration-i2p2: sustituye las conclusiones históricas de I2-P sobre esos defectos. HTTP permanece bloqueado; ningún módulo auth se conecta a UI. No backend/BD/migraciones/workers/red real, raíz, infraestructura, UI/APK o credenciales reales. El main backend de referencia es `3a91d507c535682136b31acefcf2ff63107a2dbd`; no confundirlo con la raíz histórica Mobile ni origin/main local. Solo commits/bundle locales; no push/PR/merge. Terminar en revisión independiente y autorización explícita antes de cualquier operación I2 real. El preflight válido devuelve readyToStart:false y no acredita aislamiento operativo.

## Autorización integral vigente (posterior a I2-P2)
El propietario autoriza desarrollo local por etapas A–H en rama nueva desde d0b27e2: correcciones, contratos/simuladores, pantallas documentadas y commits locales. Backend únicamente en worktree separado desde main vigente; se permiten allí cambios locales de preparación, nunca en la raíz móvil histórica ni main. Sin arranque de backend/QA/servicios de red/PostgreSQL/migraciones/contenedores, conexiones reales, push, proveedores o costes. Conservar diseño y APK. Esta autorización sustituye límites históricos que impedían preparar otras etapas; no autoriza operaciones externas. Terminar con expediente de revisión de Claude y autorización del propietario antes de cualquier activación.

## Autorización vigente B y continuación móvil
El propietario aprobó exactamente la B original del laboratorio 7f068da, desde Offline f3f467a. Se autoriza integrarla con alcance explícito, QA sin servidores, APK exclusivamente local si hay recursos y continuar lotes de las 97 pantallas con maquetas originales/datos ficticios. Rama nueva codex/dashfort-mobile-b-continuation-20261119. Ver docs/refinement-b/RESULTADOS.md. Esta autorización sustituye la congelación visual solo para B y las prohibiciones históricas de continuar pantallas. Backend separado 562a8b3 permanece intacto; no backend/BD/migraciones/red real, servicios, push/PR/merge/distribución/costes. Commits locales y checkpoints recuperables por lote. No iniciar operaciones I2 reales.

## Checkpoint B + espacio + Biblioteca
B original integrada y verificada en 33f1fc5/1fe5833. Cachés derivadas limpiadas por autorización expresa posterior; informe en docs/refinement-b/ESPACIO-Y-APK.md y commit ebe7583. No se fuerza Gradle con ~1,77 GiB libres. Biblioteca CRM-40/41/42 implementada con datos ficticios, 221 tests móviles y QA RN Web; inventario 64/158 y 94 pendientes. Ver docs/refinement-b/LOTE-01-BIBLIOTECA.md. Siguiente lote autónomo: Agenda CRM-20…25, después Tareas/Notas CRM-30…33. Mantener el backend 562a8b3 y todas las APK/firmas/bundles. No subir entregas a servicios externos bajo la restricción actual. No solicitar otra aprobación visual de B; no activar backend ni notificaciones remotas.

## Lote 02 · Agenda y navegación interna
Ver docs/refinement-b/LOTE-02-AGENDA.md. Agenda CRM-20…25 implementada; Biblioteca CRM-41 en ruta interna sin TabBar y con el mismo modelo del tab. Se preserva B; internos con Atrás mantienen 17/22. Inventario 70/158, 88 pendientes; 235 tests. Próximo lote autónomo: Tareas/Notas CRM-30…33 con fuente coherente para tareas vinculadas T-M4. Backend 562a8b3 intacto; APK sigue bloqueada por disco. Sin nuevas aprobaciones visuales ni conexiones reales/servidores/push/servicios externos.

## Lote 03 · Tareas/Notas
CRM-30…33 implementadas en WorkRepository compartido con ContactDirectory y TaskSheet T-M4/CRM. Ver docs/refinement-b/LOTE-03-TAREAS-NOTAS.md. 74/158 IDs, 84 pendientes, 254 pruebas. Conserva formato local anterior sin sobrescribirlo, aislamiento por actor/org, idempotencia y conflictos. Siguiente lote seguro: Resultados RES-01/RES-02, sin Meta/servicios reales. B, backend 562a8b3 y APK/firmas intactos. Sin Gradle con espacio insuficiente.

## Lote 04 · Resultados
RES-01/02 implementadas con hechos históricos ficticios, cálculos y filtros; docs/refinement-b/LOTE-04-RESULTADOS.md. 76/158 IDs, 82 pendientes, 266 pruebas. Scroll real de Work/Results comprobado en RN Web. Siguiente dependencia segura: Conocimiento LAB-10…12, compartiendo Biblioteca, sin RAG/indexación/agentes reales. Mantener límites, B y backend intactos.

## Lote 05 · Conocimiento y checkpoint 79
LAB-10/11/12 implementadas compartiendo LibraryStore. 79/158 IDs, 79 pendientes, 281 tests; docs/refinement-b/LOTE-05-CONOCIMIENTO.md. Más y otras pestañas de Estudio siguen pendientes, no sumarlas. Fuente atómica y compatibilidad de datos anteriores; indexación ficticia solo visible/activa, sin RAG/IA/servicios reales. Galerías anteriores corregidas tras esperar el portal Modal; originales recuperables en Git. Próximo: LAB-01/02/03/04/08/09/09A, luego versiones y asignación/pruebas. No activar agentes, publicar fuera de simulación, arrancar backend/BD ni compilar con disco insuficiente.

## Lote 06 · Agentes y pausa expresa del propietario
Desde 7ee7fd9 se implementan LAB-01/02/03/04/08/09/09A; 86/158 IDs, 72 pendientes, 303 tests. Ver docs/refinement-b/LOTE-06-AGENTES.md. Agentes y documentos comparten la escritura atómica de LibraryStore; lectores dinámicos de Conocimiento, borradores separados de versiones, preview determinista sin IA. No cambiar B, backend, APK ni firma.
El propietario pidió detenerse por cuota: cerrar comprobaciones, commit/bundle local y PAUSAR. No iniciar nuevos lotes hasta que avise. Al retomar: LAB-05/06/06C/07, después LAB-20/21 y LAB-30/31. Existen métodos/capas preparados pero esos IDs NO se contabilizan aún; requieren pruebas completas. Verificar especialmente snapshots de versiones y persistencia/recreación de identidades de etapas. Sin push/servicios/Gradle con espacio insuficiente.

## Reanudación autorizada · Lote 07
El propietario avisó «listo, retoma donde te quedaste»: sustituye la pausa anterior y permite continuar el plan autónomo seguro. LAB-05/06/06C/07 verificados, 90/158 IDs, 68 pendientes, 315 tests. Ver docs/refinement-b/LOTE-07-VERSIONES.md. No activar publicaciones/IA reales. Siguiente LAB-20/21, después LAB-30/31 y dependencias. Mantener B, backend, APK, firma y límites de almacenamiento/servicios.

## Lote 08 · Asignaciones
LAB-20/21 implementados desde 407f954: 92/158 IDs, 66 pendientes, 327 tests. docs/refinement-b/LOTE-08-ASIGNACIONES.md. Pipeline comparte identidades, orden y colores; etapas personalizadas conservan el límite de sesión y no reviven asignaciones de otra instancia. Cambios de catálogo tienen suscripción propia. Siguiente LAB-30/31 y su destino funcional del asistente; no IA real ni créditos. Mantener B, backend/firmas/APK, no Gradle ni push.

## Lote 09 · Evaluaciones y Asistente local
LAB-30/31 y AST-01/02/03 verificados desde 56a98a1: 97/158 IDs, 61 pendientes, 351 tests. docs/refinement-b/LOTE-09-EVALUACIONES-ASISTENTE.md. Pruebas deterministas sin IA/crédito; repeticiones conservan original y snapshots. Asistente usa mismo documento local de Estudio, propone antes de aplicar etiquetas ficticias canónicas; no envía mensajes reales. Etiquetas del repositorio Inbox/CRM siguen siendo de sesión, no fingir durabilidad. AST-04 pendiente. Próximo: MORE-06/07/09/10 + AST-04, después MORE-05 y SET-14; todo ficticio, sin billing/servicios/infraestructura. B, APK/firma y backend intactos; sin Gradle con disco insuficiente ni push.

## Lote 10 · Uso y plan
MORE-06/07/09/10 y AST-04: 102/158 IDs, 56 pendientes, 369 pruebas. Ver docs/refinement-b/LOTE-10-USO-PLAN.md. Cuotas ficticias compartidas, solicitudes locales sin cambio de plan/cobros, aviso semanal con posposición y reclamo atómico. No cambiar B ni activar facturación/IA/HTTP. Próximo MORE-05 + SET-14. Backend 562a8b3 y APK/firma conservados, sin Gradle ni push.

## Lote 11 · Avisos
MORE-05 + SET-14, 104/158 IDs, 54 pendientes, 385 pruebas. docs/refinement-b/LOTE-11-AVISOS.md. Avisos derivados de repos compartidos con destino exacto, preferencias por usuario/org; sonido es preferencia guardada sin audio en demo, T-M5B permanece silencioso y push remoto apagado. Próximo SET-06/06A con catálogo compartido Chat. Más/índice Ajustes siguen pendientes; no sumarlos por enlaces parciales. Mantener B, backend, APK/firma y restricciones.

## Lote 12 · Respuestas rápidas
SET-06/06A: 106/158 IDs, 52 pendientes, 400 pruebas. docs/refinement-b/LOTE-12-RESPUESTAS-RAPIDAS.md. Catálogo ficticio por organización compartido con selección por / y hoja de Chat, borrador sin enviar, owner/coordinator gestionan, advisor usa. Revisión por fila y cola por storage/org; restaurar y recargar ante conflictos. Entrada temporal por demo; SET-01 sigue pendiente. Próximo AUTH-01 sin nuevos permisos ni servicios.

## Lote 13 y checkpoint 107
AUTH-01 completada; 107/158 IDs, 51 pendientes, 407 pruebas. docs/refinement-b/CHECKPOINT-107.md y LOTE-13-APERTURA.md. Apertura solo primera vez, presupuesto 800 ms, omite reducir movimiento y no espera escrituras; QA estática web/temporización lógica, animación nativa pendiente. 60 capturas RN nuevas + 20 referencias y regresiones offline; 26 artefactos protegidos intactos. Próximo lote exacto SET-05/05A y SET-07, catálogos canónicos compartidos antes de contar índices. No modificar backend, APK/firma/B, no Gradle con ~1.4 GiB, servicios reales, push o costes. Conservar bundles incrementales y su base f3f467a; ZIP local nuevo, sin upload automático.

## Lote 14 · Catálogos
SET-05/05A/07: 110/158, 48 pendientes, 433 pruebas. Ver docs/refinement-b/LOTE-14-CATALOGOS.md. IDs/alias históricos, revisiones, fusiones y borrado/confirmación, motivos desactivados preservan historia, Otro fijo. Catálogo compartido por Inbox/CRM/Contactos/Chat; CatalogStore por organización, ContactDirectory conserva v1 default y separa otras org con v2. Asignaciones Inbox de sesión siguen con ese límite. Sin cambiar B/globales ni backend. Próximo SET-08 simulado; no proveedores, Gradle o push.

## Corrección posterior a lote 14
Bloquear mutaciones si catálogo no está recuperado y revalidar motivo activo tras escritura; revierte un alta de pérdida concurrente con desactivación. 3 pruebas adicionales, 436 antes de SET-08. Conteos memoizados, origen de contactos nuevos independiente de etiquetas, alias y automática más estrictos. Ver actualización LOTE-14.

## Lote 15 y checkpoint 111
SET-08 implementado: 111/158, 47 pendientes, 448 pruebas. Ver docs/refinement-b/CHECKPOINT-111.md y LOTE-15-AGENDA-CONECTORES.md. Agenda comparte conectores Zoom/Meet ficticios por org, candidatos respetan horario canónico; bloques privados previos se conservan. Sin OAuth/proveedores/URLs reales; Unirse solo toast. Próximo SET-03/03A/03B con personas canónicas antes de EQP y SET-09. Entradas temporales por demo; no sumar SET-01/MORE-01. Mantener B, backend, APK/firma, los 26 artefactos y base f3 de bundles. Sin Gradle, servicios, push o costes.
