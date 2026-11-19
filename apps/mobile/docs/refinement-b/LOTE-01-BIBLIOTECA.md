# Lote 01 posterior a B · Biblioteca simulada

## Entrega funcional

IDs implementados: **CRM-40**, **CRM-41**, **CRM-42**. La app pasa de **61 a 64 IDs con implementación**; quedan **94 de 158** pendientes. No se suman nuevos IDs por contratos, menú de navegación o una captura aislada.

Desde CRM, la pestaña Biblioteca abre un catálogo real de componentes React Native. Mantiene las pestañas Pipeline/Contactos/Biblioteca, sin introducir Clientes/Equipo/Mi número. Se conserva el lenguaje B para encabezado, iconos de controles, filtros y nombres de filas. Las maquetas originales siguen definiendo su estructura específica: icono de archivo, título, metadatos/destinos y botón de agregar.

- Búsqueda por título/contenido sin distinguir acentos, carpeta, etiquetas y cambio lista/cuadrícula con lista virtualizada.
- Crear/editar/borrar entradas ficticias, con confirmación de borrado y de cambios sin guardar.
- Contenido o archivo de muestra (PDF, Word, texto, imagen), validación de 100 MB y al menos un destino Chat/IA.
- Nueva carpeta y filtrado por etiqueta desde el menú.
- Persistencia local por usuario/organización ficticios; recuperación tras remontar proveedores, errores de lectura/guardado y reintento conservando borrador.
- Propietario y Coordinador gestionan; Asesor solo consulta entradas habilitadas para chat y no puede escribir ni acceder directamente a las de uso exclusivo IA. Es una política de demostración, no autorización de servidor real.
- Estados cargando, vacío, error y sin conexión. No se abre un selector de archivos del sistema ni se lee ningún archivo del teléfono.

Los destinos son flags locales de elegibilidad. No se ingieren documentos ni se ejecuta IA; la hoja de Biblioteca del chat T-M3 conserva sus muestras previas, todavía no comparte este nuevo repositorio. Unificar esa fuente es un trabajo local posterior y no requiere producción; no se presenta como una integración ya hecha.

## Pruebas y evidencia

- Conjunto móvil completo: **221 pruebas pasan**, TypeScript y formato pasan.
- 12 nuevas pruebas de lógica: restauración, campos, destinos, límite de archivo, roles, aislamiento, caché corrupta, fallo parcial de escritura, versiones, concurrencia, filtros, reentrada de observadores, identidad inmutable, colisiones tras restauración y borrado atómico.
- 24 capturas reales RN Web: 12 de CRM-40/41/42 en ambos temas y ambos tamaños; 8 de regresión Pipeline/Contactos y 4 estados de Biblioteca.
- 6 capturas de referencia oficial: los tres IDs en ambos temas, conservando la maqueta original.
- Navegador sin servidor: búsqueda, edición, destinos inválidos, selección de muestra, fallo/reintento de guardado, restauración, volver/descartar, carpetas, filtro por etiqueta, cancelación/borrado, rol asesor y fallo/reintento de lectura.
- Sin errores JavaScript ni solicitudes de red en el recorrido final. No se declara QA nativo.

Regresión encontrada y corregida: al borrar, una notificación intermedia podía dejar el editor apuntando a una entrada ya eliminada. Ahora el catálogo y la navegación cambian en una única actualización tras persistir. La reproducción del navegador y una prueba específica pasan. Se comprobó que Pipeline/Contactos conservan la geometría de B; las diferencias de rasterización de los comparadores son de un nivel de color en unos pocos píxeles, sin nuevos tamaños ni desplazamientos.

El color/tamaño de las cápsulas de destino se adapta a los componentes y tokens reales (MessageCircle/Sparkles, superficies y burbuja IA), manteniendo la organización de la maqueta. Los metadatos de texto muestran el tamaño de las muestras locales y no simulan archivos descargados. Estas diferencias de datos están visibles en el comparador.

## Archivos principales

- `src/features/library/core.ts`: catálogo, almacenamiento, validación y permisos simulados.
- `src/features/library/LibraryView.tsx`: lista, editor, selector de muestras, menú, confirmaciones y estados.
- `src/features/crm/SectionTabs.tsx`: selector CRM extraído sin cambiar sus medidas; amplía la tolerancia táctil con hitSlop.
- `src/features/crm/CrmScreen.tsx` y `CrmView.tsx`: entrada funcional, vuelta y conservación del modelo por instancia de sesión demo.
- `tests/library.test.ts`, `scripts/library-qa.mjs` y modo `--library` del harness existente: pruebas y evidencias sin servidor.

## Conservación y límites

Commit local por lote, en `codex/dashfort-mobile-b-continuation-20261119`, sin push ni merge. Los archivos se limitan a `apps/mobile`. El backend de auditoría conserva su commit y su árbol limpio. Los únicos borrados fuera de Mobile son las cuatro cachés autorizadas y documentadas en ESPACIO-Y-APK.md.

No hay nueva APK: la compilación sigue bloqueada por almacenamiento y no se fuerza Gradle. Android/iOS, teclado nativo, escalado 130–200%, gestos, accesibilidad nativa, scroll tras matar proceso y comportamiento real de las notificaciones quedan pendientes. No se importó ni activó autenticación I2, HTTP, FCM, APNs o Expo Push Service.

## Siguiente lote exacto y checkpoint

Siguiente bloque local autorizado: **Agenda CRM-20…CRM-25**, con sus seis maquetas, calendario día/mes, detalle, bloqueo, movimiento y menú; usuarios y citas ficticios, pruebas de colisión/roles, estados, capturas y commit independiente. Después, Tareas/Notas CRM-30…CRM-33. No requieren una nueva aprobación visual ni activar el backend.

Este checkpoint conserva B, el diagnóstico/limpieza y el primer lote funcional. No se declara completada la continuación de las 94 pantallas restantes. Si se retoma en otra ejecución, partir del tip de esta rama y del manifiesto del ZIP, no de la APK 0.1.2 ni de main. El backend para Claude no se toca.
