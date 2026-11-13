# Entrega T-M5A · Simulación verificada

Base exacta: T-M4 respaldada y aprobada, ebeb4bf75c29e845c6732874f16a20ad7a096da6. Rama nueva: codex/dashfort-mobile-tm5a-20261113. Solo apps/mobile. T-M5B y T-M5C no iniciadas.

## Implementado

Contratos V1, autoridad de usuarios/organizaciones/sesiones ficticias, instalaciones y tokens ficticios, permisos concedidos/denegados/revocados, registro/renovación/revocación, eventos canónicos, deduplicación persistida y agrupación lógica por conversación. Mensajes entrantes y handoffs elegibles; salientes/notas/IA/estados/avisos ajenos o caducados no alertan. La copia del aviso es genérica y no proviene del payload.

Destinos pendientes con caducidad; autorización canónica y del repositorio móvil; espera de sesión, organización, red y navegación; protección frente a callback inicial + pulsación repetidos, almacenamiento fallido y respuestas tardías tras logout. Sincronización simulada al reconectar, volver a primer plano o recibir un evento en primer plano; combinación idempotente de muestras en Bandeja/Chat. Un chat activo recibe datos sin generar otro aviso lógico. No hay sondeo ni tareas del SO.

El laboratorio se activa solo con /demo?notifications=1 y usa componentes aprobados. La pantalla normal /demo, las pestañas, las pantallas T-M1…T-M4, temas, iconos y componentes comunes conservan su diseño. No se contabiliza SET-14 como completada; permanecen 42 IDs previos del inventario.

## Pruebas y evidencia

| Comprobación | Resultado |
|---|---|
| TypeScript estricto | Pasa |
| Node: lógica, permisos, almacenamiento, aislamiento, navegación y regresión | 89/89 pasan: 59 previas + 30 nuevas |
| Chromium/React Native Web, corrida final sobre código congelado | 44/44 pasan: 38 previas + 6 T-M5A, sin omitidos |
| Prettier | Pasa |
| Capturas QA | qa-group-light-390.png; aviso genérico agrupado en el laboratorio, no una nueva maqueta de producto |
| Matrices y regresión T-M1…T-M4 | Ejecutadas por los tests previos, claro/oscuro, 390×844 y 360×640 |
| Red externa/errores JS en recorrido principal T-M5A | 0 solicitudes externas y 0 errores de página |
| Solicitudes de permiso del navegador en el recorrido de permisos | 0; el estado concedido/denegado de la demo es independiente del SO |
| Ráfaga de 300 eventos | Todos los IDs persistidos, <=2 escrituras, un grupo por conversación |
| Dependencias y configuración nativa | package.json, package-lock.json y app.json sin cambios; ninguna instalación nueva |
| expo install --check | Advertencia: el catálogo actual recomienda expo ~58.0.25 frente a 58.0.24 aprobado. No se actualizó. Revisar en T-M5B |
| APK nueva / registros de dispositivo / avisos del sistema | No generados / no realizados / no enviados |
| Android/iOS nativo, proceso terminado, Doze, APNs/FCM | Pendiente; no se deduce de Node o Chromium |

La primera corrida de navegador tuvo 42/44: fallaron dos expectativas de los tests nuevos. Un test esperaba regresar a Bandeja aunque la ruta de origen era el laboratorio; el Stack existente correctamente regresó al laboratorio. Otro suponía permiso de navegador «default», pero Chromium devolvía «denied». Se corrigieron los tests para preservar navegación y comprobar directamente cero llamadas a requestPermission, sin modificar la app aprobada para forzar esas expectativas. La corrida final completa pasa 44/44.

Las pruebas nuevas cubren: contrato estricto sin texto/URL libre; expiración/sesión falsa; dos instalaciones y revocación independiente; renovación; permiso revocado offline; grupos por conversación y secuencias fuera de orden; tipos excluidos; cursores por organización; alcance del Asesor/handoff; payload que intenta redirigir o extender vigencia; restauración de destino sin sesión; callback doble; navegación no preparada; desconexión; pérdida de membresía/asignación; respuesta tardía de cuenta anterior; fallo y reintento de sync; datos corruptos sin sobrescritura/registro; fallo al persistir el consumo; dedupe al recrear cliente; logout y limpieza; snapshots repetidos sin nuevas notificaciones React; agrupación de escrituras; chat activo sin alerta duplicada.

Ver evidence/*.txt y *.json, IMPLEMENTACION.md para los archivos y comportamiento, y T-M5B.md para el siguiente alcance no autorizado aún.

## Riesgos y límites explícitos

- Es una simulación, no una implementación de push reales. El servidor demo en memoria no es un outbox duradero; los tokens son strings demo y la autoridad no es autenticación productiva. IDs reales se rechazan deliberadamente.
- La Bandeja aprobada solo tiene el contexto A. El modelo/pruebas simulan A/B, pero el puente bloquea B antes de abrirlo sobre datos A. La identidad multiorganización real requiere integración futura; no se añadió navegación ni selector a la app.
- El permiso ficticio vuelve a denegado al recrear cliente. No se consultó el permiso real del teléfono. Al reiniciar se retira el vínculo ficticio anterior.
- Las escrituras fallidas se muestran como error; la persistencia local no puede garantizarse si el almacenamiento no funciona. La entrega exacta una sola vez y la retirada de un aviso ya mostrado no pueden prometerse para los futuros proveedores.
- El laboratorio simula segundo plano y desconexión; no ejecuta JavaScript con un proceso realmente terminado. No hay datos para afirmar FPS, batería o recepción nativa.
- La recomendación nueva de parche Expo es un pendiente de compatibilidad futura, no autorización para modificar la base aprobada.

## Conservación y aislamiento

Commits de implementación: 5ddc6a6 (contratos, seguridad, políticas, registro, sincronización y pruebas), f25965f (puente no visual, muestras canónicas, navegación y QA). El commit posterior conserva documentación y evidencia; el manifiesto de respaldo local registra su hash completo.

La APK T-M4 0.1.1 no se reemplazó ni recompiló. Su SHA-256 sigue siendo dda720189d6eb004f394dc147ebd4b29cdde85aa61382afc5162ce2e4ace68a1. No hubo cambios fuera de apps/mobile en Git, ni cambios a main, CRM, backend, TWA, Coolify, Hetzner, workflows o configuración productiva. No hay SDK push, permisos reales, proyectos cloud, costes adicionales, push, PR, merge, release, despliegue o subida de archivos.

El ZIP y bundle locales se preparan después del último commit y se verifican por recuperación sobre la base T-M4. No incluyen dependencias, SDK, APK, claves privadas o cachés. El respaldo nuevo todavía no está en GitHub: requiere autorización expresa y revisión de disparadores antes de subir únicamente esta rama.

Siguiente paso recomendado: autorizar la conservación remota de T-M5A. Después decidir el alcance nativo de T-M5B descrito en T-M5B.md; no se comienza automáticamente.
