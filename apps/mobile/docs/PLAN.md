# Plan aprobado T-M1 → T-M13

El alcance global sigue siendo 158 IDs del inventario oficial. El CSV `cobertura.csv` conserva cada ID y su etapa; que exista una entrada de navegación no significa que el módulo esté implementado. T-M3 se ejecuta en una rama derivada del respaldo T-M2; ver tm3/RESULTADOS.md.

| Etapa | Contenido aprobado | Estado de esta entrega |
|---|---|---|
| T-M1 | Base, acceso AUTH-02…06, DS-01…06, cierre MORE-08, navegación por rol | Base funcional con datos ficticios; QA navegador; validación nativa pendiente |
| T-M2 | Bandeja, búsqueda, filtros, selección INB-01…10 | Implementada en simulación; pendiente QA nativo |
| T-M3 | Chat, adjuntos, plantillas, ventana 24 h, fallos | Implementada en simulación; pendiente QA nativo |
| T-M4 | Detalles, etapas, asignación, etiquetas, conexión INB-30 | Pendiente |
| T-M5 | Arquitectura y simulación de notificaciones SET-14 | Pendiente; sin backend, tokens ni push reales |
| T-M6 | Equipo, Mi número, privacidad y complemento | Pendiente |
| T-M7 | Pipeline y Contactos | Pendiente |
| T-M8 | Más completo, ajustes esenciales y cuenta | Pendiente; shell mínimo no se contabiliza |
| T-M9 | Agenda, Tareas, notas y Biblioteca | Pendiente |
| T-M10 | Estudio IA | Pendiente |
| T-M11 | Marketing | Pendiente |
| T-M12 | Asistente, Resultados, Uso y plan | Pendiente |
| T-M13 | Resto de Ajustes, arranque, Plataforma | Pendiente |

Las instrucciones prioritarias de la nueva ejecución sustituyen cualquier obligación de conectar APIs, pedir aprobación visual otra vez, modificar servidor o publicar que aparezca en los documentos antiguos. El diseño aprobado se conserva como referencia; su implementación se valida por etapa.

T-M3 se documenta en tm3/RESULTADOS.md. La validación de dispositivo sigue pendiente. No iniciar T-M4 ni publicar la rama T-M3 sin una nueva autorización.
