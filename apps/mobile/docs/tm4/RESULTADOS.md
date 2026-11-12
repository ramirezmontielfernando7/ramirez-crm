# T-M4 · Resultados y pendientes

T-M4 implementada con datos ficticios: **INB-19, INB-20, INB-21, INB-22, INB-23, INB-24, INB-25, INB-26 e INB-30**. T-M1/T-M2/T-M3 se conservan en el historial y en los recorridos de regresión. Cobertura acumulada: 42 de 158 IDs en simulación; 116 pendientes. No se inició T-M5.

Rama de trabajo: `codex/dashfort-mobile-tm4-20261111`.

## Versión probada conservada

- APK que el propietario instaló y probó en Motorola Edge 50 Pro, Android 16 / ARM64: T-M3, 0.1.0, versionCode 1, ID `com.demfort.dashfort.dev`.
- Fuente exacta: `codex/dashfort-mobile-tm3-20261111`, `d849c0dcfbb1fe2a426d1f9a79af817922e0d068`. No se confunde con el commit posterior de receta.
- SHA-256 original: `65f933d9721b7bcac2a5c957e175cb7e3da517875282f306e738bee42dc85c2f`. Archivo original y archivo privado ya entregado en Drive sin reemplazar.
- Checkpoint local de procedencia/receta: `codex/dashfort-mobile-apk-tested-20261111`, `bd3ba4f55f45d0daa1d630815156feca28bfd6c4`. Ver [VERSION.md](../apk-probada/VERSION.md).
- Se corrigió en el script la ruta de SDK `platforms;android-37.0`, se documentaron JDK 17 completo y flags locales, y se añadió protección contra reemplazo de APK/salida y contra prebuild con configuración distinta. Bash y la protección de salida existente se comprobaron.
- T-M3 fuente ya estaba remota; el checkpoint nuevo y T-M4 se conservan localmente, pendientes de autorización nueva de push. No hay secretos ni claves privadas en los respaldos publicables. La firma experimental permanece fuera de Git; sin ella una futura compilación con otra firma necesitaría desinstalar la demo anterior.

## Pruebas automáticas

| Comprobación | Resultado |
|---|---|
| TypeScript estricto | Pasa |
| Lógica/almacenamiento/permisos/navegación/contraste | 59 pasan; incluye 22 pruebas nuevas de dominio T-M4 |
| Dependencias `expo install --check` | Compatibles con Expo 58 |
| Prettier | Pasa |
| T-M4 Chromium / React Native Web | 11 recorridos pasan: matriz 4, acciones, INB-30, notas, tareas, roles, estados y anclas |
| Regresión T-M1/T-M2/T-M3 | 27 casos únicos pasan; corrida final completa T-M1…T-M4: **38/38**, 0 omitidos |
| Android local | APK 0.1.1/código 2 compilada, firma/ID/ARM64/Hermes/alineación 16 KB correctos; instalación T-M4 pendiente |
| iOS Hermes | Bundle de 5.501.046 bytes exportado; no IPA ni ejecución nativa |
| Capturas T-M4 | 36 de los nueve IDs + 8 de estados; 18 capturas oficiales incluidas en comparador |
| Ancla Bandeja tras chat → detalles → historial → regreso | Y=274 antes y después; diferencia 0 px en QA web |
| Ancla chat tras detalles/historial | Y=213 antes y después; diferencia 0 px en QA web |
| Interacción visual | Sin errores JavaScript/red externa en las cuatro matrices; sin desborde horizontal; controles visibles con blancos >=44 |

Primera corrida completa: 37/38, con un fallo del test T-M3 de Enter tras respuesta rápida. La traza y el comportamiento de RN Web mostraron que el test pulsaba mientras seguía la animación/finalización de foco del Modal. Se corrigió el test para esperar que desaparezca el modal antes de escribir. El caso entero (respuesta, Enter, emoji, reescritura, deshacer) pasó después tres veces consecutivas. La corrida completa final pasó **38/38** después de ese ajuste y de las correcciones de concurrencia/caché/rendimiento. No se cambió el comportamiento del compositor para ocultar el fallo. Se conserva el log inicial y la repetición; no se presenta la primera corrida como totalmente verde.

Se repitió además el recorrido de los ocho estados a 390×844 (1/1 pasa), después de corregir el tamaño de captura de ese caso de prueba. Las 44 capturas finales tienen dimensiones verificadas.

Los tests de dominio cubren pérdida atómica y validación, alcance revocado, equipo activo, etiquetas protegidas, IA/tomar, todas las condiciones de conexión, fallos sin selección optimista, reintentos sin duplicación, notas sin transporte, texto escrito durante guardado, tareas/fecha/monto, datos corruptos, cambios concurrentes y caché acotada. El contraste incluye texto/placeholder sobre el fondo de nota en ambos temas.

## Revisión visual

Abrir [comparacion.html](comparacion.html), que funciona sin servicios externos y muestra oficial/implementación por ID, tema y tamaño. Las capturas son React Native Web a 390×844 y 360×640, no del teléfono. La referencia incluye marco/barras de sistema; web muestra contenido de la app. Nombres asignados y horas son ficticios y pueden variar; la conexión se habilita mediante QA para visualizar INB-30.

Se mantienen paleta, Inter, estructura de detalles, cápsulas, puntos de etapa, radios a la derecha, tres modos, formularios y separación de temas. Se quitó texto duplicado en etiquetas y se usaron campos de selección para tarea como en el diseño. El ancho mínimo del filtro IA se ajustó por accesibilidad. Las hojas largas se desplazan internamente a 360×640; la captura inicial puede no mostrar sus botones inferiores, accesibles mediante scroll. La pantalla de notas explicita «Solo tu equipo · No se envía al cliente» para hacer comprensible su efecto.

Diferencias técnicas explícitas: la fecha/hora de tareas se edita con campos nativos validados desplegados dentro del selector, sin calendario del sistema; la ficha de contacto y conexión directa son vistas de muestra sin implementar los módulos futuros. No se declara igualdad píxel a píxel ni aprobación visual nueva.

## Compilación experimental

La actualización usa 0.1.1, versionCode 2, ID `com.demfort.dashfort.dev`, misma firma experimental y ARM64. Se compiló localmente desde una copia del commit `bba69dff11d748ed68b23a666268e1842c1101af`, sin EAS, Actions, cuotas o servicio de pago. APK generada y verificada: ver [APK-TM4.md](APK-TM4.md), hash y evidencia estática. No se sustituye la APK T-M3.

## Pendiente en dispositivo

La evaluación positiva del propietario corresponde a **T-M3**. No se atribuye a T-M4. No hay emulador Android, /dev/kvm, teléfono conectado ni Xcode en este entorno. TypeScript, Node, Chromium, bundles y Lint no sustituyen ejecución nativa.

En Motorola: instalar la actualización sobre Dashfort Dev y comprobar que preserva el borrador de mensajes T-M3; probar arranque en modo avión, claro/oscuro, barras/gestos, cerrar hojas con Atrás, notas/tareas/pérdida con teclado abierto, desplazamiento de hojas largas, regreso exacto a Bandeja/chat, y reapertura de los detalles guardados. Confirmar que una nota no aparece como mensaje y que los controles de conexión nunca vinculan dispositivos reales.

Probar TalkBack, fuente al 130%, orientación/barras/áreas seguras y reanudación desde segundo plano. Medir en dispositivo apertura, tirones, memoria y batería antes de afirmar rendimiento nativo. En iOS faltan compilación/instalación, teclado, VoiceOver y gesto de regreso.

Límites intencionales de simulación: Bandeja y envíos de chat siguen en memoria; los datos T-M4 confirmados son locales por perfil/chat, sin sincronización entre personas. Borrador de nota/filtro/scroll conservados al navegar durante la sesión; el borrador de mensajes mantiene su persistencia previa. No hay recuperación de envíos reales ni servicios de red.

## Conservación y siguiente paso

Commits locales organizados: `bd3ba4f` conserva receta de APK probada; `4b32df4` dominio/pruebas T-M4; `89b7a2c` pantallas nativas, navegación y versión 0.1.1; `9e2238f` corrige concurrencia durante carga/guardado; `5f1c437` hace recuperable el límite de caché sin perder notas; `bba69df` evita renders del chat oculto al escribir notas; documentación/evidencias en el commit posterior. Ver CONSERVACION.md.

No hubo push, PR, merge, tags, releases, despliegue, OTA ni modificación de main, CRM, backend, TWA, Coolify o Hetzner. Solo apps/mobile. Siguiente paso recomendado: validar T-M4 en el Motorola y conservar el respaldo remoto con autorización expresa. Después se puede planificar T-M5; no se inició.
