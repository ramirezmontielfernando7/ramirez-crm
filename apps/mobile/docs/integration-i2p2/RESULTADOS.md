# I2-P2 · Resultado y puerta de seguridad

**Cuatro defectos corregidos y verificados con simulación. Conexión real todavía bloqueada.**

Rama `codex/dashfort-mobile-i2p2-20261117`, creada desde `8d0a1d30777a24f49e2d512296bb0663399c4bbe`. Commit de implementación: **f15ee228b38544452224c85d19bfb2724f95f96f**. Documentación/evidencias en el commit local siguiente; el HEAD final y hash del bundle figuran en el manifest de conservación local. No se modificó ninguna ref main.

## Comprobaciones y resultados

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Reproducción de los cuatro defectos sobre fuente I2-P archivada | **4/4 fallan**, como corresponde al antes | [before.txt](evidence/before.txt) |
| Mismas cuatro pruebas contra I2-P2 | **4/4 pasan** | [after.txt](evidence/after.txt) |
| Lógica completa | **176/176**, cero fallos/canceladas/omitidas: 136 anteriores + 40 nuevas | [logic.txt](evidence/logic.txt) |
| TypeScript | Pasa, incluidos tipos del adapter nativo | [typecheck.txt](evidence/typecheck.txt) |
| Formato | Pasa | [format.txt](evidence/format.txt) |
| Dependencias | Ninguna instalación/cambio de package o lock; check offline compatible con advertencia de fiabilidad limitada | [dependencies-offline.txt](evidence/dependencies-offline.txt) |
| Exportación web | Pasa, modo offline/sin telemetría de Expo | [export-web.txt](evidence/export-web.txt) |
| Chromium / RN Web | **45/45**, cero fallos/omitidas: regresión T-M1–T-M5B, Bandeja, Chat, detalles, simulación y lab local | [browser.txt](evidence/browser.txt), [JSON](evidence/browser.json) |
| Preservación | 82 archivos existentes del runtime/config/dependencias idénticos a I2-P, excluyendo cinco módulos auth corregidos | [isolation.json](evidence/isolation.json) |
| APK aprobada 0.1.2 | Existe y mantiene SHA256 `36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a` | Mismo audit; no se construyó/reemplazó APK |
| Ref main y respaldo existente | Main `3a91d507c535682136b31acefcf2ff63107a2dbd`; I1 remota; I2-P/I2-P2 ausentes en consulta | [remote-refs.txt](evidence/remote-refs.txt) |
| Backend, PostgreSQL, migraciones, workers, Better Auth real, hardware Android/iOS | **No ejecutados** | Pendientes de revisión/autorización y entorno |

El navegador usa exclusivamente el servidor estático de QA local. Los cambios finales adicionales solo afectan auth no importado por esa demo y sus pruebas Node; las pantallas/configuración son idénticas. No se presentan los 45 recorridos como pruebas de autenticación I2 real, nativa o de aislamiento de infraestructura. Las capturas generadas por esa regresión están en `artifacts/screenshots`; no se alteró el diseño ni se produjo una nueva comparativa visual porque no hay cambio visual.

Las 40 pruebas nuevas se distribuyen en cuatro reproducciones, 28 adversariales y ocho de preflight. Se cubren logins simultáneos/reentrantes, cierre desde suscriptor, excepciones de observadores, fallos independientes de cada participante de limpieza y del vault, éxito tardío ignorando AbortSignal en login/renew/switch, peticiones de organización anterior, restore offline/reinicio/recovery, revocación rechazada/ambigua y referencias sin credenciales. Los límites y semántica están en [IMPLEMENTACION.md](IMPLEMENTACION.md).

## Archivos

Modificados: `src/integration/auth/controller.ts`, `model.ts`, `vault.ts`, `fixture.ts`, `secure-store.native.ts`, `tests/integration-i2p.test.ts`, `AGENTS.md`, `README.md`.

Nuevos: `src/integration/auth/boundary.ts`, `src/integration/preflight.ts`, tres pruebas `tests/integration-i2p2*.test.ts`, esta carpeta con informe, controles, plan JSON, expediente de revisión y evidencias seleccionadas. Ningún archivo de pantalla/ruta, tema, icono, configuración nativa, dependencias, backend, CRM, TWA, workflows o infraestructura cambió.

`transport.ts` permanece idéntico y siempre rechaza. No se conectó PreparedAuth ni SecureStore a SessionProvider o a las pantallas. No se utilizaron credenciales/datos reales; revisión del diff y escaneo de patrones no encontraron secretos, certificados o claves privadas en lo destinado a Git. Los nombres de usuario, contraseñas y cookies de las pruebas son exclusivamente fixtures.

## Conservación y recuperación

Se conservan en el historial T-M1, T-M2, T-M3, T-M4, T-M5A, T-M5B e I1; I2-P sigue recuperable en su rama y SHA originales. La rama nueva contiene además los commits I2-P y las correcciones I2-P2. Árbol limpio al cierre, con dos commits locales organizados (código/pruebas y documentación/evidencias).

**I2-P e I2-P2 no están respaldadas remotamente a la fecha de esta consulta.** El bundle incremental `artifacts/integration-i2p2/dashfort-mobile-i2p2.bundle` y su manifest se preparan localmente e incluyen todos sus commits desde I1 `00fb8caad3e61beef0d7a802ee87e17cfb53df8c`. Requiere ese ancestro para recuperar; comprobar con `git bundle verify` en el clon de destino que tenga I1, inspeccionar sus refs y recuperar en una rama nueva. No incluye APK, cachés, claves o ficheros ignorados. Una copia en la misma máquina no sustituye un respaldo externo duradero.

Plan remoto: tras revisión y autorización explícita, volver a comprobar árbol, SHA, alcance/secrets y disparadores conocidos; subir solo la rama acordada y verificar SHA remoto/automatizaciones. No se ha hecho push, PR, merge, tag, release ni despliegue. Las limitaciones de acceso a automatizaciones externas siguen siendo pendientes; no se presume autorización antigua para un push nuevo.

## Pendientes y siguiente paso

Revisar [REVISION-CLAUDE.md](REVISION-CLAUDE.md) junto con el código. La revisión no se envió ni se presume aprobada. Después, decidir una autorización concreta para preparar gates del backend en un checkout independiente del main actualizado, siguiendo [CONTROLES-I2.md](CONTROLES-I2.md), **antes de autorizar su arranque**.

Permanecen pendientes los controles operativos, protocolo Better Auth real/bridge, autorización de revocación por referencia, RLS y SecureStore/dispositivo. Cuando todas las escrituras/borrados fallan y no hay red, se bloquea la instancia actual pero no se promete persistir lo que el almacenamiento rechazó: exigir cuarentena y recuperación antes de confiar de nuevo. No se contrató infraestructura, no hubo servicios remotos de compilación/gasto ni acceso productivo. No se inició I2 real ni otra etapa.
