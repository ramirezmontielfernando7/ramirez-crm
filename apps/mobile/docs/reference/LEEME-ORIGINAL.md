# Dashfort Mobile — Diseño maestro (versión final aprobada)

**Estado: aprobado por Fer el 10 de noviembre de 2026** (todas las decisiones, el pipeline por etapa y las 7 funciones nuevas). Falta solo implementarlo.

Es solo diseño. No se tocó el CRM web, ni el servidor, ni la app Android (TWA), ni el prototipo de React Native. No se hizo push, PR, fusión ni despliegue, y no se usó producción.

Hecho con **Sonnet 5.5, esfuerzo alto**.

## Qué trae este paquete

| Archivo | Qué es |
|---|---|
| `dashfort-mobile-prototipo.html` | Prototipo navegable (158 pantallas). Ábrelo con doble clic; funciona sin internet y no envía nada |
| `Dashfort-Mobile-Diseno-Maestro.pdf` | PDF de 14 secciones |
| `docs/01…07` | Auditoría, navegación, sistema de diseño, inventario (.md y .csv), especificación para React Native, funciones, calidad |
| `docs/08-tareas-para-codex.md` | La especificación dividida en tareas T-M1… listas para pasar a Codex |
| `capturas/` | Una captura por pantalla (claro y oscuro), estados, teléfono pequeño y flujos |
| `fuentes-prototipo/` | Código fuente del prototipo |

**Archivo aparte, solo lo nuevo:** `Dashfort-Mobile-Adicion-Conexion-del-chat.pdf` (elegir la conexión desde el chat).

## Cómo mirar el prototipo

1. Abre el HTML. A la izquierda está el índice de pantallas (busca por nombre o ID; `INB-11` es el chat, `INB-30` la conexión del chat).
2. Botones para cambiar tema, estado (normal, cargando, vacío, error), rol y tamaño.
3. Cada pantalla trae una etiqueta: **función actual del CRM**, **adaptada del CRM web** o **nueva en móvil · aprobada por Fer**.
4. Parámetros útiles: `?theme=dark`, `?state=empty`, `?role=asesor`, `?small=1`, y `#/INB-30` para abrir una pantalla directa.
