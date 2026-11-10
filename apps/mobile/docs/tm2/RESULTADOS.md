# Resultados T-M2 · 10 de noviembre de 2026

Implementación simulada de **INB-01 a INB-10** (10 IDs). T-M1 conservada (12 IDs), cobertura global: 22 de 158 en simulación; quedan 136. No se inició T-M3. La pantalla de conversación es solo un destino de prueba de apertura/regreso.

## Verificación realizada

- TypeScript estricto, formato y compatibilidad de dependencias con Expo: pasan.
- **18 pruebas de código**: 10 de T-M1 y 8 de Bandeja, incluidas consultas, permisos, mutaciones masivas atómicas, actualización incremental, creación ficticia, scroll sin notificaciones a React, caché offline y catch-up local.
- **15 recorridos de navegador**: 8 de T-M1 y 7 de T-M2 pasan. Se repitieron los 7 de Bandeja sobre el bundle web final y se comprobó además el scroll móvil incluyendo filas DOM ocultas. No se suman estas repeticiones como pruebas independientes.
- **45 capturas de implementación**: matriz de 10 IDs × 2 temas × 2 tamaños (40), variante offline (4) y regreso tras scroll (1). Comparación con 20 capturas oficiales en comparacion.html.
- Temas claro/oscuro y tamaños 390×844 / 360×640. Sin desborde horizontal del documento en los recorridos de Bandeja. Los tests de T-M1 conservan sus comprobaciones de blancos táctiles, errores JS y solicitudes externas. Las matrices de Bandeja no detectaron errores JavaScript.
- Filtros combinados, archivo, asignación, selección al cambiar de pestaña, Asesor restringido, enlace directo prohibido, validación de contacto, búsqueda conservada al regresar y pulsación de la pestaña activa para volver arriba: pasan.
- Exports Hermes de Android e iOS: generados. **No son APK/IPA ni pruebas de ejecución nativa.** Logs en evidence/export-native.log. No se usó EAS ni un build remoto.

## Rendimiento disponible

- Dataset de la app: 2.000 conversaciones ficticias.
- Recorrido Chromium 390×844: **17 filas DOM**, incluyendo ocultas, frente a 2.000 registros. Se verificó un límite inferior a 120 filas para detectar pérdida de virtualización.
- Tras desplazar 3000 px, abrir conversación y regresar, la misma fila aparece a **274 px antes / 274 px después**. El criterio es la posición visible de la fila, no un desplazamiento interno que el reciclador puede corregir.
- Consulta pura sobre 10.000 registros, 60 muestras en Node/Linux: p50 **1.125 ms**, p95 **7.522 ms**. Son medidas de CPU del entorno de desarrollo, variables con la carga del host; no describen un teléfono.
- No se midieron FPS, memoria nativa, batería ni rendimiento en dispositivo. No se afirma equivalencia con WhatsApp.

## Correcciones durante la verificación

1. En 360×640, la barra flotante tapaba un control de carga de demo. El estado de carga ahora se desplaza y reserva espacio para la barra.
2. La navegación web restablecía físicamente el scroll después del foco, aunque el almacén conservaba 3.000 px. Se capturan ID, índice y desplazamiento de fila y se reconstruye la ventana visible usando las APIs iniciales de FlashList. La prueba de posición visible y retorno con búsqueda pasa.
3. Las pruebas antiguas de navegación contaban también los nuevos segmentos Clientes/Equipo/Mi número como pestañas principales. Se etiquetó la navegación principal y las comprobaciones se limitaron a esa barra; los perfiles siguen teniendo 5/4/3 entradas.
4. Se restringió el botón de asignación al rol autorizado, se ajustó el contraste del FAB y se descartaron eventos de scroll de vistas inactivas o filtros anteriores.

## Pendiente / límites

- Probar en Android e iOS reales o emulador: teclado, safe areas, Back, TalkBack/VoiceOver, fuente del sistema a 130% y comportamiento tras terminar proceso. El entorno carece de SDK Android/emulador y de Xcode; no se generó APK en esta etapa.
- Los datos, recepción y reconexión son simulados, sin SSE/WhatsApp/backend real. Ningún dispositivo se registra y no se envía nada.
- Filtros/selección conservados al navegar dentro de la sesión; no se promete persistirlos tras recarga web o terminación del proceso.
- Equipo y Mi número corresponden a T-M6; el chat completo corresponde a T-M3. No se presentan como implementados.
- Las diferencias visuales de marco, áreas del sistema, cantidades y controles de demo están registradas en IMPLEMENTACION.md. Hace falta comparación nativa; no se declara identidad píxel por píxel ni se solicita nueva aprobación del diseño.

## Conservación y aislamiento

Rama local: codex/dashfort-mobile-tm2-20261110, derivada de 5b4c7e5. Commits de código: d251e22 (modelo/repositorio/estado) y f51d13a (UI, rutas, restauración y pruebas), más el commit de documentación/evidencia de cierre. Solo apps/mobile; sin cambios a web, backend, TWA, main, Coolify, Hetzner o producción. No se hizo push de T-M2, PR, merge, despliegue ni workflow manual. No se activaron servicios de pago.

El ZIP y bundle locales se conservan separadamente del respaldo T-M1 en /workspace/work/entrega-dashfort-tm2. El directorio de descargas indicado por la sesión sigue sin estar disponible; no se inventa un enlace de descarga ni se publica la rama para resolverlo.
