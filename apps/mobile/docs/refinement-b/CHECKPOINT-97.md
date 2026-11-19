# Checkpoint 97 · continuación desde la pausa

Rama: `codex/dashfort-mobile-b-continuation-20261119`.
Base: `a4268bf7608bd84fa034b7b5698aadae7bed78af`. La reanudación fue autorizada por el propietario.

| Lote completado | IDs nuevos | Lógica acumulada | Capturas reales / referencias |
|---|---|---:|---:|
| 07 · Versiones y pausa | LAB-05/06/06C/07 | 315 | 20 / 8 |
| 08 · Asignaciones | LAB-20/21 | 327 | 14 / 4 |
| 09 · Evaluaciones + Asistente | LAB-30/31; AST-01/02/03 | 351 | 29 / 10 |

**97/158 implementados, 61 pendientes. Once IDs nuevos en esta reanudación. Todos los 18 IDs LAB del inventario tienen código y QA web en simulación.** No se repitió la implementación de los siete IDs de Agentes ni Conocimiento. El inventario es `docs/cobertura.csv`; no se suman shells ni enlaces pendientes.

## Evidencia

TypeScript, formato y las 351 pruebas de lógica pasan. 63 capturas nuevas reales RN Web y 22 referencias oficiales, en claro/oscuro a 390×844 y 360×640. Galerías en evidence/versions, assignments, evaluations, assistant. Se verificaron navegación, guardados, conflictos, fallos/reintentos, idempotencia, scopes, trazabilidad de intentos y separación borrador/publicado.

Regresiones de Agentes, Conocimiento y 19 IDs CRM, más búsquedas, Bandeja→Chat y roles, sin errores de página ni solicitudes de red. Se usa Chromium offline sin listener HTTP/Metro; los proveedores/capas/UI son reales y el host de sesión/router/almacenamiento usa dobles. No sustituye Expo Router completo ni pruebas Android/iOS.

Commits de código: `407f954` versiones, `56a98a1` asignaciones, `0f1e8d5` evaluaciones/asistente. El commit que añade el paquete/documentación no cambia código de la app; su SHA exacto se registra en el manifiesto final. Cada lote conserva un bundle local en artifacts/continuation-b. El bundle acumulativo final requiere Offline f3f467abb7640ec13ffba590bc5dad91bc5cfd77; conservar el paquete previo y verificar con git bundle verify antes de restaurar hacia una rama nueva.

## Correcciones y límites reales

- Cargar una versión no borra texto introducido durante el guardado ni descarta un búfer posterior al reintentar una carga completada.
- Etapas recreadas/instancias nuevas no heredan asignaciones antiguas. El catálogo personalizado de CRM sigue siendo de sesión; se explican referencias históricas ignoradas en el informe 08.
- Repetir pruebas conserva el intento inicial y snapshots de cada intento; los arreglos solo cambian el borrador.
- El asistente conserva contexto y hilos. Los cambios canónicos de etiquetas de Inbox/CRM son de sesión; el estado de la propuesta se deriva del repositorio actual y no finge persistencia de backend.
- Asistente es determinista: no es IA real. 42% IA/34% asistente son muestras aprobadas, no crédito consumido. Límite de 20 hilos/40 turnos; retención de lectura de 90 días para hilos no generales.
- Quedan por probar teclado, gestos, restauración tras terminar proceso, texto ampliado, áreas seguras, TalkBack/VoiceOver, scroll y rendimiento en dispositivo.

## APK y aislamiento

APK 0.1.2, firma y respaldos anteriores intactos. Configuración preparada 0.1.3/versionCode 4/com.demfort.dashfort.dev sin cambios. No se produjo una APK nueva: ~1,5 GiB libres no permiten el umbral conservador de 15 GiB. No se fuerza Gradle, elimina respaldo ni contrata build externo.

Cambios solo en apps/mobile. Paleta/tokens/componentes globales B y dependencias conservados. Backend reservado para Claude limpio en 562a8b386b7f0d0df9292406167357aa988fd4d0, sin modificaciones/arranque. No se activaron servidores, PostgreSQL, migraciones, workers, HTTP/autenticación real, WhatsApp, IA ni proveedores; sin push/PR/merge/despliegue o costos. El ZIP final es local; no se actualiza automáticamente el archivo Drive anterior.

## Reanudación exacta

Siguiente lote por dependencias: **MORE-06, MORE-07, MORE-09, MORE-10 y AST-04**. Uso/plan, mejora/solicitud y avisos de ritmo deben ser ficticios, coherentes con 42%/34%; sin billing, correo, IA, WhatsApp, cobros o servicios externos. Después MORE-05 y SET-14, sin activar push remoto ni cambiar la arquitectura de notificaciones. MORE-01 permanece pendiente hasta completar su navegación/operaciones, no contarlo por tener enlaces.

Se entrega este checkpoint al cerrar el límite de la ejecución; el trabajo pendiente queda explícito y recuperable. No hace falta una aprobación visual nueva de B para continuar simulaciones. Operaciones reales siguen sujetas a revisión de Claude y autorización del propietario.
