# Evidencia visual y límites

La fuente de verdad es el paquete del propietario: PDF maestro, documentación/HTML y 410 capturas. Se conserva la documentación original y el HTML en `reference/`, con 24 capturas oficiales de T-M1 (12 IDs × claro/oscuro). Los SHA-256 de los cuatro adjuntos, incluido el máster prompt, están en `REFERENCIAS.json`.

Las capturas de `evidencias/actual/` se generan **ejecutando los componentes React Native con React Native Web en Chromium**, a 390×844 y 360×640. No son capturas del HTML del prototipo, de un emulador ni de un teléfono. Las imágenes oficiales de `reference/capturas/` son solo referencia. `evidencias/index.html` coloca ambas fuentes lado a lado y etiqueta su origen.

Comprobaciones automáticas: acceso y galerías en dos temas/dos tamaños, ausencia de desborde horizontal del documento, blancos táctiles de al menos 44×44 en los controles renderizados y ausencia de errores JavaScript o solicitudes HTTP externas durante los recorridos visuales. El mínimo de los controles propios es 48 dp; no se infiere el tamaño físico Android desde una captura web.

Comparación visual: se mantienen acento, superficies, Inter, pesos, escala, campos, radios y variantes de burbuja del sistema aprobado. No se afirma coincidencia píxel por píxel. Diferencias registradas:

- Las capturas oficiales incluyen marco de teléfono, barra de estado y zona de gestos simuladas. Chromium muestra el contenido de la app sin esas zonas del sistema; en nativo se utilizan safe-area-context y StatusBar, pendientes de prueba real.
- Hay controles de demo explícitos, un menú de galerías y avisos de simulación que no forman parte del producto conectado.
- Los formularios de enlaces se entregan vacíos para validar entrada real; las capturas de diseño incluyen ejemplos rellenados.
- Las galerías añaden interacciones comprobables, selección, búsqueda, fila y compositor de demostración. DS-04 incluye una imagen ficticia representada por un icono y un indicador de escritura estático. No se implementan cargas o cámara en esta etapa.
- El botón peligro y metadatos se ajustan usando tonos de la paleta para AA (ver ARQUITECTURA). No se inventan colores nuevos de marca.
- PickerRow se presenta como fila de selección accesible; el ejemplo DS-03 del HTML muestra además una caja con borde. Alinear esa variante durante QA nativo antes de considerar la galería visualmente cerrada.
- Más y las otras raíces son shells de navegación con estado pendiente. Su contenido definitivo pertenece a T-M8/T-M2/T-M7/T-M10/T-M11 y no se compara como pantalla final.

Falta comprobar: áreas seguras reales, teclado Android/iOS, restauración tras terminar proceso nativo, gestos del sistema, lectura de pantalla, texto del sistema al 130%, comportamiento con texto mayor, Android Back en ejecución nativa y rendimiento de listas. No se midieron FPS, memoria ni batería. No se declara paridad con una aplicación de mensajería existente.
