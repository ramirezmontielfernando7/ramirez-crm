# Desarrollo integral aislado

Base móvil d0b27e29ea89706cdc0fdc795338670c4e9c10b5; rama codex/dashfort-mobile-offline-20261119. Backend de referencia 0b611126717ede5dca0f4ea766f28b99befd648c, worktree independiente. No se autoriza arrancar servicios, QA HTTP, backend, BD, contenedores, migraciones o conexiones reales.

| Etapa | Trabajo en esta ejecución |
|---|---|
| A | Corregir tres reproducciones nuevas y ampliar regresión |
| B | Adaptadores/contratos de protocolo ficticio, seguridad de entorno y almacenamiento |
| C | Consultas, sincronización y escrituras sin reintentos ambiguos; contratos sin red |
| D | Construcción según referencias, priorizando Contactos/Pipeline; contabilizar solo IDs verificados |
| E | Mantener avisos locales y preparar coordinación de lifecycle sin activar push |
| F | Preparación auth-only en worktree main separado, no ejecutarlo |
| G | Separación TS/ESLint/contexto Docker, exclusivamente worktree backend |
| H | TypeScript, lógica, render/contraste sin servidor; nativo/HTTP pendientes |

El expediente final detallará límites, pruebas y commits. Los estados históricos de docs/integration-i2p2 anteriores al push no describen el respaldo actual: d0b27e2 sí quedó remoto.

A verificada: 180 pruebas completas aprobadas y TypeScript. Las tres nuevas reproducciones fallan sobre d0b27e2 archivado, y pasan después. Logout durante attach interrumpe y limpia sin tocar un propietario instalado más reciente; la recuperación solo revoca candidatas con intención de revocación; restore falla cerrado si no puede leer el registro. La pérdida simultánea de red/almacenamiento se mantiene bloqueada y permite completar el cierre al recuperar recursos; no se promete persistencia si todas las escrituras fueron rechazadas.
