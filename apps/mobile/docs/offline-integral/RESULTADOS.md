# Desarrollo integral aislado · entrega de preparación

## A. Resumen

Base móvil **d0b27e29ea89706cdc0fdc795338670c4e9c10b5**, preservada en su rama respaldada. Nueva rama `codex/dashfort-mobile-offline-20261119`. Backend preparado en `/workspace/work/dashfort-auth-offline`, rama `codex/dashfort-auth-offline-20261119`, desde main **0b611126717ede5dca0f4ea766f28b99befd648c** verificado en GitHub. La raíz histórica de la rama móvil no se usó para implementar backend.

Esta entrega **no completa las 158 pantallas ni conecta el CRM**. Consolida seguridad, prepara contratos y backend, y añade un bloque CRM. La construcción visual D sigue parcial; no se bloquean artificialmente sus 97 IDs pendientes por falta de servidor: aún requieren implementación y QA. No se les atribuye código por tener un contrato o maqueta.

## B. Funciones implementadas

- Correcciones de reentrada durante attach, restore concurrente con recuperación y fallo de lectura del registro. Las tres reproducciones fallan sobre d0b27e2 archivado y pasan después. Prueba adicional de login nuevo durante cleanup obsoleto; no borra sus cuatro almacenes.
- Catálogo CRM nativo de 19 IDs: Pipeline, detalle, mover, monto, pérdida, crear lead, buscar, menú, gestión/color/eliminación de etapas; Contactos, ficha, edición, menú, filtros, selección, menú general e importación de muestra. Ver [PANTALLAS.md](PANTALLAS.md) y CSV general.
- Búsqueda, filtros, selección, restauración de offset en el modelo, permisos por rol, cambio de identidad, asignación, etiquetas aprobadas y validación de montos/pérdida. Lista virtual y proyecciones reutilizadas para evitar búsquedas cuadráticas.
- La UI CRM usa el mismo repositorio ficticio de conversaciones que Bandeja; comparte IDs y cambios de etapa/asignación/nombre. No crea otro backend. Los metadatos de UI adicionales siguen siendo simulación local, no una capa de datos real del CRM.
- Compatibilidad con tareas T-M4 en una etapa nueva del catálogo de sesión, sin ampliar indiscriminadamente el decoder persistente; etiquetas limitadas al catálogo aprobado y una importación no levanta una baja previa.

No se modificaron los tokens globales, fuentes, navegación global, componentes aprobados, SDKs o lockfiles. Se reemplaza el shell CRM pendiente por el contenido autorizado y se amplían los validadores/repositorios necesarios. No se rediseñan pantallas T-M1–T-M4.

## C. Funciones simuladas

Autenticación: coordinador fixture con lifecycle/vault; planes HTTP deshabilitados y binding por instalación/usuario/org/sesión. Memoria de material solo fixture con copias y borrado de referencias. El adaptador SecureStore previo sigue sin montarse; no hay parser o cookie jar real ni conversión verificada de Better Auth a contexto móvil.

Bandeja/Chat preparados: lectura tipada, historial acotado/deduplicado, respuestas tardías de otras sesiones o búsquedas descartadas, clasificación 401/403/404, reconciliación al recuperar foco/red y marcadores SSE sin asumir replay durable. Una escritura incierta no se reenvía con el mismo intento. Límites: 10,000 conversaciones, 10,000 mensajes por historial, 20 historiales y 200 intentos por sesión; excederlos requiere conciliación/diseño servidor, no truncado silencioso ni reenvío automático.

Restantes: campañas solo generan preview (opt-in, bajas, deduplicación, plantilla aprobada); reservas simulan solapamiento/conflictos de versión; supervisión de Equipo es de solo lectura/auditable; versiones de agentes son publicaciones ficticias sin proveedor. Sus capacidades de versiones/CAS no se atribuyen al backend real.

T-M5A/B siguen conservadas. El nuevo lifecycle no instala listeners ni timers permanentes, no registra tokens ni permisos reales y no activa push remoto. El laboratorio nativo anterior solo cambia por acciones explícitas del usuario en una futura ejecución de la app, que aquí no ocurrió.

## D. Pendiente de servidor/dispositivo y de implementación

- **42 IDs previos conservados + 19 con código nuevo = 61; 97 sin implementar.** Los 19 nuevos tienen previews de componentes y pruebas de dominio; no se presentan como 19 recorridos integrados Expo/nativos aprobados.
- El prototipo oficial contiene referencias de los 158 IDs. Los módulos restantes tienen especificación disponible: Equipo/Mi número, Agenda, Biblioteca, Ajustes, Marketing, IA y administración siguen pendientes según inventario. No se inventa una ausencia de maquetas para declararlos bloqueados.
- La persistencia CRM nueva es de sesión/memoria: no se ha acreditado restauración después de matar el proceso. Los catálogos personalizados y metadatos CRM necesitan persistencia compartida antes de prometer recuperación completa; el catálogo de sesión sí conserva compatibilidad probada con T-M4. No se garantiza restaurar un catálogo desconocido desde almacenamiento viejo.
- Falta QA del módulo nuevo dentro de Expo completo y hardware: teclado, áreas seguras, modal/BackHandler, anclas de listas, TalkBack, gestos y consumos. Los previews usan un host de tema/capas ficticio y no incluyen la barra inferior global.
- Falta bridge Better Auth real/cookies/CSRF/TLS, bootstrap de permisos/membresía/suspensión, RLS, paginación histórica del servidor, replay durable, idempotencia y conflictos Web/Mobile. Los puertos permanecen desconectados de pantallas.
- El entorno tiene aproximadamente 200 MiB libres; no se instalaron dependencias backend ni se intentó una compilación Android que pueda agotar disco. No hay emulador iniciado ni teléfono conectado. Se conserva la APK 0.1.2 sin generar/reemplazar otra.

## E. Pruebas

| Evidencia | Resultado real |
|---|---|
| `a-before.txt` | Tres reproducciones rojas sobre d0b27e2; 29 pasan/3 fallan en ese archivo archivado |
| `h-logic.txt` | **207/207** Node, sin fallos/omitidas; regresiones anteriores y 31 nuevas respecto de 176 |
| `h-types.txt` | TypeScript móvil sin emisión aprobado |
| `h-format.txt` | Formato móvil aprobado |
| `fg-backend.txt` | **15/15** pruebas aisladas backend; dobles de identidad/auth y verificaciones estáticas, sin BD |
| `d-visual.txt`, `visual/results.json` | **38 previews** (19 IDs × claro/oscuro), **38 capturas oficiales**, 3 recorridos de componente: buscar/abrir, editar y alcance asesor |
| `h-performance.json` | 5,000 contactos × 100 consultas: mediana 2.4 ms y p95 13.7 ms en Node de esta máquina; heap observado sin GC, no prueba de fuga/FPS/batería |
| Backend TS adapters / migrador | Transpilación sintáctica de adapters y `node --check` de MJS; **no** typecheck/build completo del backend |
| 45 recorridos web históricos | Evidencia previa conservada; **no repetidos** porque abrir su servidor QA está prohibido en esta ejecución |
| Android/iOS y red real | No ejecutados |

[Comparaciones seleccionadas](comparacion.html). La totalidad de las 76 imágenes queda en `artifacts/offline-integral`, regenerable con `node scripts/offline-crm-visual.mjs` usando dependencias existentes. No arranca HTTP; Chromium usa `setContent`, red bloqueada e iconos/tokens reales con shims web de soporte. Esto no equivale a correr la app Expo ni sus proveedores de sesión/layers nativos. Se preservan doce imágenes seleccionadas en Git.

## F. Cambios de código

Móvil: `src/integration/auth/{model,controller,boundary,plans}.ts`, `src/integration/{conversation-client,lifecycle,module-simulations}.ts`, `src/features/crm/*`, ruta CRM, extensiones de repositorio/decoder de contacto, pruebas y evidencia. El transporte original sigue rechazando todas las ejecuciones.

Backend separado: `auth-only/{policy,handler}.mjs`, factories TS `existing-auth`/`prepare-node`, manifiestos no operativos, documentación/tests; guard puro `scripts/isolation-guard.mjs`, invocado antes del arranque Node completo y antes de crear cliente/DSN en el migrador; exclusiones de Mobile/auth-only en TS, ESLint y Docker context. No se modifica el Dockerfile, package/start, lockfile, SQL o los hooks Better Auth. Ver expediente para revisar este diff antes de cualquier uso.

## G. Ramas y conservación

Commits locales por etapa en las dos ramas, sin mezclar diffs. Los SHA finales, inventario y bundles incrementales verificados se registran en `artifacts/offline-integral/conservation.json` al cierre. La rama antigua d0b27e2 y main local permanecen sin cambios. Nuevas ramas **sin push**. El bundle móvil requiere d0b27e2; el de backend requiere main 0b61112. Un bundle en esta misma máquina no sustituye un respaldo remoto independiente.

## H. Riesgos

El cierre no puede persistir si fallan todos los writes/deletes y la red: la instancia actual queda bloqueada; se requiere cuarentena/recuperación y revocación autorizada antes de confiar tras reinicio. Las referencias de revocación no son credenciales ni endpoints existentes de Better Auth. No se promete borrar físicamente copias de bytes en un heap JavaScript.

Los manifiestos no acreditan aislamiento. Host/DNS/IPv6/firewall/mounts/roles y capacidad local siguen pendientes. El rol system usa BYPASSRLS en la instancia test nueva por compatibilidad con auth existente; jamás se autoriza apuntarlo a una instancia productiva. El migrador test necesita un procedimiento separado revisado para crear roles y políticas: los scripts originales quedan bloqueados ante marcadores test.

## I. Continuación local segura

Pueden continuar sin operaciones externas las 97 pantallas pendientes, sus modelos/dobles, QA de componentes, persistencia simulada y tests de contratos. No se les exige una autorización de backend como condición ficticia. La siguiente construcción debe preservar las verificaciones de T-M4/CRM y no prometer validación nativa. Esta entrega es un checkpoint sustancial y recuperable, no una afirmación de que ya se agotó toda programación local posible.

## J. Revisión independiente

Revisar [EXPEDIENTE-CLAUDE.md](EXPEDIENTE-CLAUDE.md), diffs de ambas ramas y evidencias. No se ha enviado a Claude ni se presume su aprobación. No hay autorización para push, servicios o costes.

## K. Operación posterior propuesta

Tras revisar el código y autorizar expresamente un host local no productivo: acreditar recursos, preparar aislamiento efectivo y crear exclusivamente la instancia PostgreSQL test. La creación de red/volumen/BD es el primer bloque operativo: **no se ejecuta aquí**. Migrar/seedar, iniciar auth-only, abrir loopback/TLS y conectar Motorola requieren decisiones posteriores explícitas. Ni una variable ni un preflight válido autorizan esos pasos.
