# 07 · Control de calidad (Fase 7) y confirmación de producción

## Pruebas automáticas del prototipo (Playwright, navegador real)

Se recorren **las 158 pantallas** en claro y oscuro (390×844) y en claro a 360×640 (teléfono pequeño), con la página renderizada de verdad:

| Revisión | Resultado |
|---|---|
| Elementos que se salen del marco (desborde horizontal) | 0 |
| Texto cortado en botones, chips y cápsulas | 0 |
| Botones sin destino ni acción («muertos») | 0 |
| Zonas táctiles menores de 40 px en botones/filas | 0 |
| Errores de JavaScript en consola | 0 |
| Destinos inexistentes (`data-go`, hojas, acciones) en los 4 estados (normal, cargando, vacío, error) | 0 |

Además se revisaron a ojo capturas de pantalla de las pantallas principales en claro, oscuro, 360 px y modo celular real, contra las maquetas que ya habías aprobado (barra flotante, encabezados, chat, Más, apertura).

## Lista de coherencia

- Navegación: misma barra en todas las pestañas; Atrás y «pulsa otra vez para salir» funcionan; el rol cambia la barra.
- Todo menú ⋮ abre y cierra; las hojas se cierran con Atrás o con el velo.
- Cada pantalla trae su etiqueta *actual / adaptada / propuesta*; las propuestas están marcadas «pendiente de aprobación».
- Estados de carga, vacío y error existen para las listas principales (capturas en `capturas/estados/`).
- Identidad Dashfort: logo, acento teal white-label, Inter, tono en español sencillo.
- Contraste AA en todos los pares de color (claro y oscuro), ver documento 03.

## Límites honestos de esta revisión

- Es un **prototipo en navegador**: simula, no se probó en un teléfono físico ni con lector de pantalla (TalkBack/VoiceOver). Eso debe hacerse en la app real.
- Los datos son ficticios; la fidelidad con los datos reales (nombres largos, muchos chats) se prueba al implementar.
- No se midió rendimiento (60/120 fps): es tema de implementación en React Native.

## Confirmación: producción y repositorio intactos

- Todo el trabajo se hizo en una carpeta aparte de la sesión; no se escribió dentro del repositorio.
- Al terminar se verificó `git status` del repositorio `ramirez-crm`: sin archivos modificados y sin commits nuevos.
- No se hizo push, PR, fusión ni despliegue. No se tocó el CRM web, el backend, la app Android (TWA) ni el prototipo de React Native existente.
- No se usó producción ni ninguna credencial; no se generaron costos (el prototipo funciona sin internet).
