# Dashfort Mobile — laboratorio de refinamiento visual

Este laboratorio presenta propuestas. No cambia el diseño ni el funcionamiento del runtime aprobado. No se inició la implementación de las 97 pantallas pendientes.

## Abrir y comparar

Descomprime el ZIP y abre **index.html** con Chrome, Edge, Safari o Firefox. Es autónomo: las imágenes están incrustadas y no requiere servidor, cuenta ni conexión. Selecciona pantalla, tema, resolución, vista completa o encabezado y escala. Desliza horizontalmente para ver las cuatro columnas. Las imágenes sueltas están en `capturas/`; las hojas lado a lado en `comparaciones/`.

La referencia «Actual» usa la implementación local real de Bandeja. No es una reconstrucción de una maqueta anterior. Todas las versiones usan el mismo conjunto ficticio de 2.000 conversaciones, el mismo usuario demo y los mismos estados iniciales. El reloj visible de los mensajes procede del fixture existente.

## Origen conservado

- Rama de partida: `codex/dashfort-mobile-offline-20261119`.
- Commit verificado: `f3f467abb7640ec13ffba590bc5dad91bc5cfd77`, coincidente con `artifacts/offline-integral/conservation.json` del paquete Offline.
- Rama local del laboratorio: `codex/dashfort-mobile-visual-lab-20261119`.
- Backend independiente: `562a8b386b7f0d0df9292406167357aa988fd4d0`; no se modifica ni arranca.
- APK 0.1.2 anterior conservada: SHA-256 `36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a`. No se genera otra APK.
- Todos los archivos nuevos se encuentran en `apps/mobile/labs/visual-refinement`. No hay cambios en `app`, `src`, dependencias, configuración nativa ni backend. No hay push, PR, merge, despliegue ni cambios de infraestructura.

## Las cuatro opciones

**Actual.** Título Inter 600 de 26, selector de 56 de alto con radio 12, filtros de 36 de alto visual. Es la referencia aprobada.

**A — refinamiento mínimo.** Título de 25 e iconos de 21. Selector con radio exterior 16 e interior 12; filtros de 35. Mantiene colores, tipografía de las conversaciones, espacios entre filtros, alturas táctiles y distribución. Es la opción recomendada por su menor alcance.

**B — moderna y compacta.** Título de 24 con peso 500; selector de 52 de alto, radio exterior 26 e interior 24. Filtros de 32, padding horizontal 12 y separación 6. Nombres de 15.5 y vistas previas de 13.5, con las alturas de línea originales. Mantiene la paleta. Compacta la parte visual y conserva las áreas táctiles; no aumenta artificialmente el número de filas ni reduce su altura mínima.

**C — identidad refinada.** Título de 25, iconos originales de 22 con trazo 1.9; selector de 54 de alto con radios 20/16 y selección Inter 600. Turquesa ligeramente ajustado y más luminoso en oscuro; vistas previas con mayor contraste en ambos temas. Conserva el resto de la paleta y las medidas de las conversaciones.

No se cambian las cápsulas de etapa y etiquetas comerciales, avatares, burbujas de chat, pestañas inferiores ni botón flotante de conversación. Aquí «cápsulas» explora los filtros de Bandeja y el selector superior; las etiquetas de datos conservan su estilo aprobado.

## Medidas exactas y variables propuestas

Unidades lógicas de React Native, sin escalado de fuente del sistema en esta captura. La fuente sigue siendo Inter, con sus archivos reales 400/500/600. Los nombres de variables siguientes pertenecen exclusivamente al perfil del laboratorio, no a tokens nuevos publicados en la app.

| Variable del perfil                   | Actual        | A             | B             | C             |
| ------------------------------------- | ------------- | ------------- | ------------- | ------------- |
| `titleSize / titleLine / titleWeight` | 26 / 32 / 600 | 25 / 32 / 600 | 24 / 30 / 500 | 25 / 32 / 600 |
| `headerHeight` mínimo                 | 52            | 52            | 52            | 52            |
| `iconSize / iconStroke`               | 22 / 1.8      | 21 / 1.8      | 21 / 1.8      | 22 / 1.9      |
| `trackRadius / trackPadding`          | 12 / 4        | 16 / 4        | 26 / 2        | 20 / 3        |
| Alto total del selector               | 56            | 56            | 52            | 54            |
| `itemRadius / itemHeight`             | 10 / 48       | 12 / 48       | 24 / 48       | 16 / 48       |
| `labelSize`                           | 14            | 14            | 13.5          | 14            |
| Peso del selector activo              | 500           | 500           | 500           | 600           |
| `chipHeight / chipPadding / chipGap`  | 36 / 14 / 8   | 35 / 14 / 8   | 32 / 12 / 6   | 34 / 14 / 8   |
| `chipSize / chip radius`              | 12.5 / 999    | igual         | igual         | igual         |
| `nameSize / secondarySize`            | 16 / 14       | igual         | 15.5 / 13.5   | igual         |

Los iconos conservan controles de 48×48. Cada opción del selector tiene al menos 48 de alto. Los filtros conservan un área de 48 de alto y ancho mínimo 44 aunque la cápsula visible sea menor. El encabezado conserva el margen horizontal 16 y su alineación vertical central; se exploran escala y peso, no nuevos iconos ni una reorganización.

### Colores de C, aplicados solo en el laboratorio

| Uso                                   | Actual claro | C claro   | Actual oscuro | C oscuro  |
| ------------------------------------- | ------------ | --------- | ------------- | --------- |
| Acento de encabezado/iconos/selección | `#0b6a6d`    | `#0a7074` | `#63bcbe`     | `#78cfd0` |
| Fondo de filtro seleccionado          | `#e3f3f3`    | `#e1f1f1` | `#1d4554`     | `#204957` |
| Texto de vista previa                 | `#6e6e73`    | `#5d6268` | `#9aa9ca`     | `#aebdd7` |

No se modifica globalmente `accent`, `accentInk`, `wash` ni `text3` en los tokens de producción. El alcance de C en esta propuesta es explícito: iconos y encabezado compartidos, controles activos y texto `secondary` que ya utiliza `text3`. Avatares, horas, contadores, etiquetas y navegación inferior conservan sus colores originales.

Contraste calculado con luminancia relativa sRGB sobre los fondos concretos de estas capturas: título actual/C claro 6.37/5.86:1, oscuro 6.80/8.36:1; vista previa actual/C claro 5.07/6.15:1, oscuro 6.40/7.95:1. El texto del filtro activo C tiene 5.04:1 en claro y 5.41:1 en oscuro. C no aumenta todos los contrastes: su acento claro pierde algo de contraste y conserva más de 4.5:1 en estos fondos. Estos cálculos no sustituyen una revisión completa de accesibilidad.

## Archivos que habría que evaluar para aplicar una opción

Nada de esto está aplicado. Tras una aprobación visual, la implementación debería introducir variantes o tokens de componente con alcance controlado, evitando cambiar indiscriminadamente la paleta global.

| Componente real                   | Variable a introducir o ajustar                      | Alcance potencial                                                                                    |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/components/ui.tsx`: `AppBar` | tamaño, línea y peso del título de módulo            | Bandeja, CRM, Contactos y otros encabezados de módulo                                                |
| `IconButton`                      | tamaño y trazo del icono, color propuesto de C       | todas sus instancias si se aplica globalmente; mantener 48×48                                        |
| `SegmentedControl`                | radios, padding, letra y peso activo                 | Bandeja y otras pantallas que importen este componente                                               |
| `FilterChips`                     | alto visual, padding, gap y colores activos          | filtros compartidos que utilicen el componente                                                       |
| `Text` / estilos de fila          | nombre y vista previa, solo B; color secundario de C | Bandeja, CRM/Contactos y cualquier otra instancia con el mismo tipo; preferir alcance por componente |
| `src/theme/tokens.ts`             | solo si se aprueban tokens específicos de componente | no sustituir colores globales sin revisar todos sus consumidores                                     |

CRM y Contactos se muestran a 390×844 en ambos temas desde su `CrmView` real. Su selector local tiene su propia implementación: las propuestas no lo convierten automáticamente en el selector de Bandeja. El laboratorio permite ver este límite. Chat no se incluye en las capturas: el título no modular se mantiene en 17/22 y sus burbujas no cambian; los iconos compartidos podrían variar si se aprueba un cambio global. Habría que comparar Chat antes de extender el cambio. No se afirma haber revisado las 97 pantallas pendientes.

## Implementación aislada y reproducción

- `profiles.ts`: valores de las cuatro opciones, sin efectos sobre la app.
- `ui.tsx`: adaptadores de presentación para cinco componentes compartidos. «Actual» delega en los originales.
- `entry.tsx`: montaje de las pantallas reales con fixtures y navegación de demostración.
- `render.mjs`: compila solo el laboratorio con dependencias ya instaladas, monta React Native Web en Chromium y captura los estados. Sustituye proveedores de tema/sesión/capas/rutas por adaptadores en memoria. Usa **FlashList real**; no una lista dibujada ni una FlatList alternativa.
- `present.mjs`: ensambla los PNG originales en comparaciones y en el HTML autónomo. No retoca los píxeles de la app.
- `browser.d.ts`: declaración local para el montaje web.
- `evidence/`: capturas y resultados conservados localmente en Git.
- `output/`: resultados regenerables, excluidos de Git.

Desde `apps/mobile`, usando únicamente las dependencias ya instaladas:

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false
node labs/visual-refinement/render.mjs
node labs/visual-refinement/present.mjs
```

El script utiliza `/usr/bin/chromium`. No inicia Expo, Metro ni un servidor HTTP, no instala paquetes y no abre servicios. Los contextos de navegador están sin conexión; fuentes e imágenes se incrustan localmente. El código del laboratorio no se importa desde `app` o `src` y no forma parte del runtime de la APK aprobada.

## Verificación y límites

- 16 capturas de Bandeja: cuatro versiones × claro/oscuro × 390×844/360×640.
- 16 capturas adicionales: CRM y Contactos × cuatro versiones × claro/oscuro, a 390×844.
- 12 hojas comparativas: cuatro de Bandeja completa, cuatro de detalle de su encabezado y cuatro de CRM/Contactos.
- Búsqueda «Karla» y selección «Equipo» verificadas en las cuatro versiones dentro del laboratorio. La selección se entrega al adaptador de capas; no es una prueba de navegación nativa completa.
- En las 16 configuraciones de Bandeja se midieron las tres áreas del selector: todas tienen al menos 48 de alto y ancho mayor de 48.
- Cero errores de página y cero solicitudes de red durante la captura. TypeScript del proyecto incluido el laboratorio se verifica sin emitir código.
- El HTML autónomo se verifica cambiando tema, resolución, detalle y pantalla.
- Las pantallas aprobadas y la configuración original se comparan contra el commit de partida; el backend mantiene su árbol limpio y su SHA.

Estas son capturas de **React Native Web**, a escala CSS 1 y fuente normal. Los adaptadores usan áreas seguras de cero para comparar el contenido, sin inventar barras de estado. No hay emulador ni nueva validación Android/iOS en este laboratorio. Quedan pendientes las diferencias de métricas de texto nativo, render de SVG, escalado de accesibilidad, barras del sistema y comportamiento con teclado. No se reejecuta toda la batería funcional previa porque no se modifica el runtime principal.

## Riesgos de regresión visual antes de aplicar

1. **Fuente ampliada:** el selector de tres opciones y los filtros deben probarse con fuente 130–200%, especialmente a 360 de ancho. La compactación B puede exigir más espacio; conservar mínimo táctil no garantiza que todo el texto quepa.
2. **Componentes compartidos:** cambiar `Text`, `IconButton` o tokens globalmente afectaría pantallas fuera de Bandeja. Revisar CRM, Contactos, Chat, modales y estados vacíos antes de extenderlos.
3. **Altura y scroll:** B/C reducen la altura superior total en 4/2 unidades. La lista comienza antes; no se cambia su altura de fila ni su lógica. Si se aplicara, verificar restauración de scroll, selección y búsqueda con teclado en el teléfono.
4. **Contraste:** C mejora las vistas previas, pero los colores deben comprobarse en sus diferentes fondos. No extrapolar este resultado a deshabilitados, errores o superficies que no se capturaron.
5. **Nativo:** comparar de nuevo las opciones aprobadas en Motorola/Android e iOS antes de producir una nueva APK. El laboratorio no acredita el rendimiento nativo ni las notificaciones.

## Recomendación y punto de parada

Recomiendo **A** como primera opción para revisión: conserva el carácter actual y apenas toca medidas. B es una exploración válida si se prioriza una apariencia más compacta, con revisión especial de lectura y fuente ampliada. C ofrece una selección y vista previa con mayor contraste, pero tiene un alcance de color que conviene aprobar por componente.

No se aplica ninguna variante automáticamente. No se modifica la APK. No se inicia ninguna otra etapa. El siguiente paso es que el usuario revise Actual/A/B/C y elija una opción, una combinación concreta o mantener el diseño actual.
