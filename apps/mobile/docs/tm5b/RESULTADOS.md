# T-M5B · Resultados

Implementación Android local en `codex/dashfort-mobile-tm5b-20261114`, desde T-M5A `3b85b3b`. Código fuente en `d3bd5825b529e4da14189210b25919ac1f42207f`. Conserva T-M1…T-M4; solo cambia `apps/mobile`. Producción, CRM web, backend, TWA e infraestructura permanecen intactos. No se hizo push, PR, merge, tag, release, despliegue ni activación de servicios de pago. No se inició T-M5C.

## Implementado

Permiso Android explícito y opcional, canal privado/silencioso, muestras locales de 1/15 segundos aproximados, ID nativo estable por conversación, registro persistente acotado, emisión serializada/idempotente, reconstrucción de eventos canónicos tras reinicio, apertura por contrato T-M5A, TTL, aislamiento de cuenta/organización/rol, cancelación tras pérdida de acceso y limpieza manual. Laboratorio accesible desde Controles de la demo. No cambian pantallas, colores, tipografías, iconos ni distribución T-M1…T-M4.

Los permisos, tokens y avisos ficticios T-M5A permanecen separados de los locales. Las APIs de tokens, FCM/APNs y Expo Push Service no se invocan. No existen mensajes ni usuarios productivos. Ver IMPLEMENTACION.md.

## Validación

| Prueba | Resultado |
|---|---|
| TypeScript | Pasa |
| Lógica total | 103 pasan, 0 fallos: 89 previas + 14 locales |
| Expo install --check | Compatible con SDK 58; Expo 58.0.25, notifications 58.1.9, RN 0.88.1 |
| Prettier | Pasa |
| Regresión Chromium T-M1…T-M5A + laboratorio local | 45/45 pasan |
| Puerto nativo falso | Permisos concedidos/denegados/bloqueados, duplicados concurrentes, ID por chat, payload fabricado, cold restart lógico, cuentas/organizaciones, caducidad, salientes, pérdida de acceso, revocación, error de programación, corrupción/recuperación y cambio de sesión durante espera |
| Android/iOS en dispositivo | No ejecutado: sin emulador, USB o Xcode |

La primera ejecución de navegador terminó 43/44 por un error de copia de trazas: se lanzó otra ejecución antes de que finalizara y ambas compartieron outputDir. Se corrigió el procedimiento, no la aplicación para ocultarlo. La ejecución completa secuencial terminó 45/45. Se conserva el resumen inicial como evidencia del problema de herramientas. Una comprobación posterior dirigida del export actual y laboratorio terminó 7/7; se capturó también el laboratorio oscuro.

Las pruebas de permisos y notificaciones con puerto falso son de lógica, no permisos concedidos realmente en Android. Las pruebas de cold restart reconstruyen almacenes y backend ficticios; no acreditan arranque desde una pulsación real. Ningún resultado web acredita segundo plano del SO, entrega, instalación o batería.

## Evidencia y archivos

Abrir [evidencias.html](evidencias.html). Incluye laboratorio web y muestras de Bandeja, Chat, detalles e INB-30 en claro/oscuro. Las referencias oficiales/comparación previa se conservan enlazadas. No se crean nuevos IDs de pantalla aprobada ni se contabiliza SET-14 como implementada. La UI de pruebas utiliza los componentes existentes.

Archivos de código: `src/features/notifications/local.ts`, `local-port.ts`, `local-port.native.ts`, `LocalContext.tsx`; ajustes a `context.tsx` y `Lab.tsx`; acceso en `app/demo.tsx`; plugin `plugins/with-local-notifications.js`; `app.json`, `package.json`, `package-lock.json`, `AGENTS.md`; pruebas `tests/local-notifications.test.ts` y `tests/browser/local-notifications.spec.ts`. Documentación en README y este directorio. Los proyectos nativos generados, claves, cachés y APK se excluyen de Git.

## Pendiente y prueba física

Ver [PRUEBA-MOTOROLA.md](PRUEBA-MOTOROLA.md). Pendientes: permiso/canal real concedido/denegado, aviso nativo en primer plano, pantalla bloqueada, segundo plano, arranque desde aviso tras retirar recientes, fuerza de detención, reinicio, Doze, revocación, teclado, anclas, TalkBack y batería. La APK existente pasó firma/ABI/manifiesto, alineación y comprobación de inclusión T-M5B; ver [APK-VERIFICADA.md](APK-VERIFICADA.md). La compilación anterior terminó correctamente después de la espera interrumpida; no se recompiló en esta continuación. Instalar y ejecutar en Android sigue pendiente.

No puede garantizarse entrega en todos los estados. Android puede retrasar la alarma aproximada; no se piden alarmas exactas ni exclusiones de batería. En un proceso terminado no se retira un aviso inmediatamente al cambiar permisos en otra parte: se usa contenido genérico y se reautoriza antes de navegar. La Bandeja B sigue sin implementarse y los destinos B se rechazan. El laboratorio conserva un máximo de 128 muestras; «Limpiar avisos locales» permite continuar. iOS no se declara validado ni habilitado para estos avisos.

La conservación remota requiere autorización nueva después de probar la APK; no se realiza automáticamente.
