# Lote 02 · Agenda ficticia y navegación interna

## Estado de este checkpoint

Se implementan **CRM-20, CRM-21, CRM-22, CRM-23, CRM-24 y CRM-25**. Total: **70 de 158 IDs con código**, **88 pendientes**. Se conservan B original, Biblioteca y todas las etapas anteriores. No se suma MORE-01 por añadir un enlace: Más sigue siendo el shell anterior hasta completar su lote.

Rama: `codex/dashfort-mobile-b-continuation-20261119`, desde el checkpoint `e6dfde5476d2ed5232bf30a24acf1aa9197b5871`. El backend separado conserva `562a8b386b7f0d0df9292406167357aa988fd4d0`, sin cambios ni arranque.

## Funciones implementadas

- Lista diaria virtualizada, selección de día, citas y bloqueos diferenciados según las referencias originales.
- Detalle con cliente, horario, modalidad, enlace y notas. «Unirse» es una demostración: no abre Zoom, Meet ni otro proveedor.
- Bloqueo de horario con fecha, hora, duración y motivo; edición de bloqueos existentes. El formulario propone un horario libre si el de referencia ya está ocupado.
- Movimiento de citas con días/horarios disponibles, comprobación de colisiones y de versión. No agrega otra copia de la cita.
- Cancelación local idempotente. Menú para mostrar canceladas o pruebas del Laboratorio, ocultas inicialmente.
- Mes con puntos y selección de día. Se corrigió el calendario del prototipo: noviembre de 2026 necesita seis filas y debe incluir el día 30.
- Restauración de datos por usuario/organización ficticios y de posición de lista al cambiar día/mes o salir y regresar.
- Propietario y Coordinador gestionan el conjunto; Asesor solo consulta/modifica sus propias citas. Es simulación de permisos, no autorización del backend real.
- Estados cargando, vacío, error y sin conexión; errores de almacenamiento sin perder el horario anterior ni cerrar el formulario de reintento.

Agenda se abre desde el enlace en Más, mediante una ruta interna del Stack protegido. No lleva la barra inferior, como indica el prototipo. No se añadió el selector de Clientes/Equipo/Mi número ni se colocaron filtros artificiales en otras pantallas.

Los encabezados de Agenda y mes son **internos con Atrás**: conservan 17/22, como el perfil B original para títulos no modulares. Los iconos optan a 21/trazo 1.8; no se convierte cada título interno en el encabezado de módulo 24/30. Las tarjetas y el selector de días conservan su estructura específica de la maqueta, usando la paleta y los componentes reales.

## Corrección de navegación de Biblioteca

El editor CRM-41 estaba dentro del tab CRM y mostraba la barra inferior. Se mueve a `library/[id]` dentro del Stack protegido, compartiendo el modelo con la pestaña Biblioteca mediante una fábrica por instancia de Inbox. La lista raíz conserva la barra; el editor no. No se modifica el componente global TabBar.

Los recorridos de Biblioteca se repitieron: restauración, edición, descarte de borrador, errores/reintentos, borrado, menús, carpeta, etiquetas y permisos. Se añadió una prueba de entrada directa: un Asesor no puede acceder por ruta a una entrada exclusiva de IA. Las nuevas capturas están en `evidence/library-navigation`, conservando las anteriores en `evidence/library` y en Git.

## Pruebas y regresiones resueltas

- **235 pruebas de lógica móvil aprobadas**: 14 nuevas de Agenda, más las 221 anteriores. Cubren colisiones, intervalos adyacentes, versiones, cancelación repetida, caché inválida/superpuesta, escrituras fallidas, concurrencia, scope, calendario, reentrada y scroll sin emisiones por cada evento.
- TypeScript y formato del proyecto: ver evidencias de este lote.
- **28 capturas reales de Agenda**: seis IDs × dos temas × dos tamaños (24), más cuatro estados.
- **12 referencias oficiales** de los seis IDs en ambos temas.
- Biblioteca: 24 capturas de implementación/regresión/estados y seis referencias, después de corregir su ruta.
- QA con pantallas, proveedores, listas y capas reales en React Native Web. Sesión, almacenamiento y navegación del host son dobles; no es un arranque completo de Expo Router ni una prueba nativa.
- Cero errores de página y cero solicitudes de red en ambos recorridos finales. No se abre un servidor HTTP, Metro ni backend.

El test con 24 bloques detectó que guardar el offset no bastaba: `contentOffset` no restauraba el desplazamiento al remontar la lista. Se añadió restauración explícita con la referencia de FlatList durante el layout, se ignoran eventos de scroll de arranque y se cancelan los dos frames al desmontar. Al restaurar se renderizan inicialmente hasta 32 filas; en una apertura normal, 12. Se verificó el `scrollTop` real al volver del mes y de Más, no solo el valor en el modelo. Esto no acredita el scroll nativo ni FPS.

El host de navegación también se corrigió para distinguir push, replace y ausencia de historial al probar accesos directos. Esta corrección pertenece al QA: la app sigue usando Expo Router.

## Arquitectura y archivos

- `src/features/agenda/core.ts`: fechas/minutos locales de demostración, disponibilidad, validación, persistencia, permisos y estado.
- `src/features/agenda/AgendaScreen.tsx`, `app/agenda.tsx`: calendario, lista, formularios y capas. No hay procesos permanentes ni tareas nuevas en segundo plano.
- `src/features/library/state.ts`, `LibraryEntryScreen.tsx`, `app/library/[id].tsx`: modelo compartido y editor interno con controles de acceso.
- `src/screens/ModuleScreen.tsx`: únicamente enlace a Agenda; no se contabiliza como Más terminado.
- `app/_layout.tsx`: registra las dos rutas internas bajo la protección de sesión existente.
- `tests/agenda.test.ts`, `scripts/agenda-qa.mjs`, cambios en el harness y QA de Biblioteca: evidencia sin red.

## Límites y pendiente

No hay nueva APK. Se preservan la APK 0.1.2 y su firma; la configuración sigue preparando 0.1.3/versionCode 4. El disco aún no tiene el margen conservador de 15 GiB libres. Se inspeccionaron las capacidades habilitadas del entorno: no exponen una operación de ampliación de disco. No se modifica la instancia ni se activa un recurso con costo.

Pendiente en Android/iOS: teclado, texto 130–200%, TalkBack/VoiceOver, gestos, Atrás del sistema, áreas seguras y scroll al volver tras terminar el proceso. La zona horaria/calendario de la organización, permisos de servidor, concurrencia entre dispositivos y sincronización real pertenecen a la integración futura. Las fechas actuales son muestras de noviembre de 2026 y no hay recordatorios del sistema.

Siguiente lote local autorizado: **Tareas/Notas CRM-30…CRM-33**, comprobando antes cómo compartir las tareas vinculadas con T-M4 para evitar dos fuentes contradictorias. Después, continuar los módulos pendientes por lotes. No se requiere otra aprobación visual para B ni autorización de backend para ese trabajo simulado.

Sin push, PR, merge, releases, distribuciones, servicios externos, conexiones reales, migraciones o despliegues. No se envía nada a Claude. Conservar las entregas anteriores; el nuevo ZIP y bundle deben tener nombres nuevos.
