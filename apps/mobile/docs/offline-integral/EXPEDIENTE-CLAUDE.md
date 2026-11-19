# Expediente de revisión · desarrollo integral aislado

**No enviado a Claude. Ninguna aprobación externa atribuida.** Esta entrega combina código de preparación con simulaciones; no es una integración real aprobada.

## 1–7. Estado móvil y pantallas

Ver RESULTADOS.md y PANTALLAS.md. 61 IDs tienen implementación (42 previos + 19 nuevos CRM), 97 siguen sin implementar. Los 19 tienen previews y pruebas de dominio/componente, no aceptación integrada/nativa. Las referencias de los 158 IDs siguen disponibles; no se declaran completas pantallas solo por crear contratos.

Autenticación: tres defectos adicionales corregidos; fixture authority/vault/barrera y registro sin cookies descartadas. Se separa observación de una sesión de intención de revocarla. `CompositeSessionBoundary` comprueba su lease antes/después de cada participante y no limpia un propietario más nuevo. Restore falla cerrado al no poder leer registro. Incluye prueba reentrante con login nuevo y cuatro almacenes.

Bandeja/Chat: los anteriores siguen montados en demo; la preparación de consultas y envíos nuevos no los reemplaza. Historial acotado, deduplicación y reconciliación simulados. No se implementó fetch, SSE real ni reintento automático de escrituras ambiguas. No afirmar idempotencia por tener un attemptId en el cliente.

Contactos/Pipeline: mismo repositorio de conversación y datos ficticios, 19 IDs; cambios de identidad/etapa/asignación llegan al repositorio. Catálogo de sesión compatible con tareas T-M4. Metadatos CRM y catálogos nuevos no tienen todavía recuperación completa entre procesos. Antes de integración real unificar esos campos con DTO/estado canónico, no exportar el modelo de demo como otro CRM.

Campañas/Agenda/Equipo/Agentes: simulaciones de dominio sin proveedores; previews sin envío, bajas, conflictos de versión/horario, supervisión auditada de solo lectura y versiones inmutables. Sin pantallas nuevas contabilizadas en esos módulos.

Notificaciones: T-M5A/B conservadas, no push remoto ni tokens/permisos solicitados. El lifecycle preparado recibe transiciones explícitas, no instala un servicio permanente ni promete entrega con proceso terminado/force-stop.

## 8–9. Backend y delta contra main

Referencia vigente consultada: **0b611126717ede5dca0f4ea766f28b99befd648c**. Worktree `/workspace/work/dashfort-auth-offline`, rama `codex/dashfort-auth-offline-20261119`. No usar los archivos web históricos de la rama móvil. Si main cambia, revisar el delta relevante antes de continuar.

Revisar:

- `auth-only/policy.mjs`: allowlist de entorno; tres roles separados en el plan, solo app/system en runtime; hosts/base/origen exactos, sin proveedores ni herencia/preload. No devuelve credenciales en su plan. Identidad real exigida por callbacks, no aceptar un JSON manual como evidencia.
- `auth-only/handler.mjs`: tres rutas/métodos; Origin estricto, cuerpo limitado, verificación de dos identidades antes de cargar auth, errores sin datos sensibles. Respuestas/cookies originales conservadas en tests con dobles; pendiente protocolo real.
- `auth-only/existing-auth.ts`: import diferido de DB/auth; consultas de identidad de ambas conexiones y reutilización de getAuth existente. No inventa bearer, JWT, OAuth refresh o selección de org. **No se invocó** contra una BD.
- `auth-only/prepare-node.ts`: fábrica de Node server usando better-auth/node; ni se invoca ni llama a listen. Requiere verificar tipos/versión con dependencias backend, hoy ausentes.
- `scripts/isolation-guard.mjs`, `scripts/migrate.mjs`, `src/instrumentation.ts`: impedir que configuración test use los caminos completos que migran o arrancan workers. Con marcadores ausentes el camino previo sigue igual; comprobar que no hay cambios no intencionados antes de considerar un merge. Nada se despliega.
- `tsconfig.json`, `eslint.config.mjs`, `.dockerignore`: Mobile y preparación auth fuera del build web futuro. Son propuestas en worktree, no cambios a main ni una validación de fusión/build completo.

El migrador original permanece bloqueado para la instancia test: falta un procedimiento dedicado de migración autorizado, con identidad verificada antes de mutar. No retirar el guard ni eliminar variables para saltarlo.

## 10. Pruebas y límites

207 pruebas de lógica móvil + 15 aisladas de backend; TypeScript y formato móvil aprobados. 38 previews de componentes, 38 referencias, tres recorridos UI sin HTTP. La comparación no incluye barra global, theme/storage providers reales ni Modal nativo. 45 recorridos anteriores se conservan como históricos y no se repitieron con servidor.

El backend solo tiene pruebas de política/fábrica con dobles, checks de sintaxis y aserciones de orden/exclusión. No se verificaron compilación web completa, grafo transitorio de todos los imports Better Auth, RLS, SQL, Node objetivo, TLS o cookies nativas. No se instalaron sus dependencias ante espacio libre reducido. No confundir análisis textual del arranque con una prueba de ausencia de efectos transitivos en servidor real.

## 11–12. Riesgos y mitigaciones

Mitigados en simulación: reentrada de login/logout/attach, resultados viejos tras cambio de org/consulta, observer exceptions, fallos independientes de limpieza, revocación incierta, propiedades arbitrarias de scope, bajas levantadas por importación y configuración de pruebas que alcance arranque/migrador completos.

Pendientes: pérdida total de almacenamiento más conectividad, sesiones servidor cuyo resultado nunca llegó al cliente, borrado físico de memoria, persistencia de catálogos/metadatos nuevos, bootstrap y rol/membresía canónicos, adaptación de cookies y revocación autorizada por referencia. No hay garantía de notificación Android/iOS en todos los estados.

## 13–16. Bloqueos, autorizaciones, PostgreSQL y red

Antes de crear recursos:

- Acreditar máquina local, disco/RAM, sin cuentas/mounts productivos. No Hetzner/Coolify productivos ni infraestructura contratada.
- Instancia PostgreSQL 18 completamente nueva; BD dashfort_auth_test; volumen nuevo identificado. Conservar nombres vocero_app/vocero_system en otro clúster no comparte cuentas o permisos con producción.
- App sin superuser/BYPASSRLS/CREATEROLE/CREATEDB; system con BYPASSRLS solo en clúster test nuevo; i2p_migrate administrativo solo en job test. Contraseñas independientes nuevas y fuera de Git, aún no generadas.
- Ambiente construido por allowlist desde vacío; runtime sin DSN migrador. No .env productivo, dumps, sesiones reales, host-home, .aws o Docker socket.
- Red interna; DB sin puerto publicado; cero acceso a host/gateway/metadata/producción/proveedores. Bloquear IPv4/IPv6 y DNS exterior. El plan JSON no aplica reglas ni acredita Docker/host/firewall: falta evidencia efectiva y negativas contra señuelos controlados, nunca producción.
- La entrada auth-only no expone campañas, signup, webhooks, OAuth o administración. No habilitar plugin org ni desactivar CSRF/TLS para hacer funcionar el cliente.
- Identidad de DB/rol/privilegios/versión/fingerprint de instancia comprobada por conexión test después de autorización, con errores que aborten, no warnings.

Autorizaciones separadas: recursos/red → PostgreSQL/roles → migración/seed test → arranque auth-only → protocolo/Android y una eventual APK nueva. No hay permiso implícito por terminar código o por pasar un preflight.

## 17–18. Coste y reversión

No se activó servicio de pago, build remoto ni cuota de proveedor. El objetivo es máquina local disponible con coste adicional no contratado; no inventamos un importe ni acreditamos capacidad de una máquina ajena.

No hay BD/contenedores/puertos creados en esta ejecución que revertir. Conservar commits/bundles; volver en checkout separado a d0b27e2 para demo y a main 0b61112 para comparar backend. La APK 0.1.2 sigue intacta. No usar reset destructivo ni borrar worktrees sin respaldo. Futuro rollback: detener solo el proyecto test, revocar sus credenciales, conservar evidencia redactada; destruir volúmenes exige IDs y autorización. Ninguna migración productiva forma parte del plan.

## 19–20. Ramas, commits y respaldo

Móvil: `codex/dashfort-mobile-offline-20261119`, desde d0b27e2. Backend: `codex/dashfort-auth-offline-20261119`, desde 0b61112. Commits locales por correcciones, preparación de integración, CRM, simulaciones y gates de backend. El inventario de SHA y mapas de archivos está en RAMAS.json; el HEAD final de documentación y hashes de bundles se conserva en `artifacts/offline-integral/conservation.json`.

No hubo push, PR, merge, tags ni releases. Para respaldo remoto futuro, revisar alcance/secrets/automatizaciones otra vez y solicitar permiso para la rama y SHA concretos. El permiso antiguo de push d0b27e2 no se reutiliza. GitHub Apps/webhooks/Coolify externos pueden no ser inspeccionables: no afirmar que están deshabilitados.

## 21. Siguiente operación concreta propuesta

Revisión del diff de guard/migrador/instrumentation y de las fábricas. Después, si el propietario autoriza y acredita una máquina local: preparar aislamiento efectivo y crear la instancia PostgreSQL test. No ejecutar aún migración o backend. El primer comando que cree red/volumen/DB ya cruza la puerta operativa.

La programación de las 97 pantallas restantes y el refuerzo de fixtures pueden seguir en paralelo en otra ejecución local sin esperar esa activación; no se presenta como trabajo bloqueado por autorización de producción.

## 22. Checklist para el revisor

- [ ] Tres reproducciones fallan antes y pasan ahora; cleanup obsoleto no borra sesión nueva.
- [ ] Auth/HTTP siguen separados de pantallas; no cookies reales aceptadas ni tokens push pedidos.
- [ ] Los 19 IDs nuevos corresponden al prototipo y se distinguen previews de QA integrado/nativo.
- [ ] No se prometen persistencia/consistencia global de todos los metadatos CRM ni idempotencia servidor.
- [ ] Ambos diffs están aislados y basados en los SHA correctos; main y APK intactos.
- [ ] Guard se ejecuta antes del trabajo operativo; no se activan migración/workers por error.
- [ ] Completar revisión de imports/transpilación/tipos backend antes del primer uso real.
- [ ] Entorno, roles, instancia, volúmenes, egress y capacidad acreditados operacionalmente.
- [ ] Secretos test nuevos fuera de Git, sin runtime de migrador o recursos Hetzner compartidos.
- [ ] Autorización explícita del propietario para la operación exacta, además del dictamen técnico.
