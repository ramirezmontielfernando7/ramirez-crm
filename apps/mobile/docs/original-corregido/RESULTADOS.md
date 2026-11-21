# Original corregido · P1 cancelado

Rama aislada `codex/dashfort-mobile-ux-keyboard-20261120`. Fuente del candidato `3bb90d690eaeb51af540eed8115c6b47b718c4b4`, descendiente de APK0.1.3/cd13180 y de los arreglos de teclado222a9a5/2c1d3eb. Se mantienen158/158 IDs en simulación; no se desarrollaron pantallas ni repositorios nuevos. P1 se conserva como archivo histórico, sin ruta ni importación en el runtime/harness activo.

## Cambios autorizados y límites

- Selector Clientes/Equipo/Mi número: tres posiciones iguales, control estable, indicador160ms con driver nativo y cancelación al cambiar rápido. Reduce movimiento elimina esa animación. `router.setParams` evita reemplazar la ruta. Se conservan vistas visitadas, búsquedas, filtros y scroll, sin interacción ni exposición accesible de paneles ocultos. Se monta cada área cuando se visita por primera vez, no las tres anticipadamente. El host se suscribe solo al estado de cabecera que necesita.
- Las tres secciones usan la posición original de Clientes: margen16, separación superior8, altura52, radio26, padding2, celdas48/radio24. Equipo antes tenía solo dos posiciones y margen superior16; Mi número tenía margen superior16. Se corrige esa diferencia, manteniendo la forma original. Áreas seguras respetadas.
- CRM comparte la implementación, conservando SUS dimensiones originales: track48/radio24, padding4, celda40/radio20, fuente13.5, márgenes originales. Los demás selectores mantienen su altura/ajuste automático de texto. No se transforman en selectores nuevos.
- Etiquetas y etapas comparten padding9×3/radio10; la etapa gana1px por lado para simetría. Filtros, paleta, tipografía, iconos e información no cambian.
- TabBar: solo radio exterior22→24. Se conserva distribución, selección, tamaños, colores, sombra y márgenes. Las listas de Equipo/Mi número dejan112px de espacio final.
- Se mantienen KeyboardViewport y KeyboardScrollView: oclusión medida, cero compensación si adjustResize ya redujo el área, foco visible en formularios/modales y TabBar oculta con IME. El stack usa transición nativa predeterminada y `none` con reducir movimiento; sin efectos nuevos ni demoras de contenido.

## Verificación

- TypeScript y formato: aprobados.
-610 pruebas de lógica aprobadas, cero fallos. Incluyen13 de geometría/visibilidad del foco y3 históricas del laboratorio P1; esas3 no autorizan ni integran P1.
-45 comprobaciones nuevas de comparación/comportamiento RN Web: geometría estable, mismo nodo del selector, indicador final alineado, paneles accesibles correctos, conservación de búsqueda/filtros/scroll, ida y vuelta de Chat, cambios rápidos, preferencia de movimiento y formulario/modal con viewport reducido.32 PNG reales claro/oscuro; Clientes/Chat/CRM en390×844 y360×640; Equipo/Mi número comparados en390×844 y selector probado también en360×640.
- Regresión real de19 IDs CRM, búsqueda de Bandeja→Chat, edición de Contactos, permisos advisor y objetivos táctiles: aprobada. Regresiones de Equipo y Mi número: aprobadas. Evidencias JSON en `evidence/`; capturas redundantes de regresión quedan fuera del paquete visual.
- Comparación RGB: Chat idéntico en las cuatro capturas. Títulos B conservan fuente, peso, color y rectángulo; track CRM y barra inferior conservan dimensiones. Las diferencias medidas de CRM se limitan al área inferior. No se editaron imágenes.
- Cero solicitudes de red en QA web. Fixtures de sesión, almacenamiento y router; UI, repositorios y capas reales. No es QA completo de Expo Router nativo ni IME físico. Sin nueva APK, no se afirma corregido en Motorola todavía.
-158 IDs siguen registrados; `verify-inventory.py` comprueba trazabilidad, no certifica por sí solo funcionalidad nativa.

## Conservación y siguiente paso

APK0.1.3 intacta: SHA256 `8300ec39e769ca33b5af4e933d30131f0aa7ec7a1aa9370b67445d437ac90813`.26 artefactos protegidos intactos, incluida APK0.1.2/firma. Backend reservado562a8b3 limpio. Solo archivos de apps/mobile; sin cambios de dependencias, backend, main, producción, workflows activos o servicios. Sin push ni operaciones externas.

Candidato0.1.4/versionCode5/package original listo para **preparación de compilación**, todavía NO compilado. El disco sigue insuficiente. Borrador local inactivo y autorización concreta en [COMPILACION-Y-PRUEBA.md](COMPILACION-Y-PRUEBA.md). Próximo paso: autorización de UN nuevo run gratuito y publicación controlada del workflow en esta rama; firma exclusivamente local, nunca en GitHub.

Abrir [COMPARADOR.html](COMPARADOR.html). Los documentos P1 anteriores son históricos y quedan expresamente cancelados.
