# 05 · Especificación técnica de UI para Codex (React Native + Expo)

> Estado: **diseño aprobado por Fer el 2026-11-10** (todas las decisiones y las 7 funciones nuevas). Las tareas por prioridad están en `08-tareas-para-codex.md`. Esta especificación no toca el backend: todo dato sale de las rutas que el CRM web ya usa.
> La fuente de verdad de pantallas es `04-inventario-pantallas.csv` (158 filas: ID, tipo, estado, ruta/componente, prioridad). Aquí van las reglas que se repiten.

## 1. Stack y estructura sugerida

- Expo (SDK vigente) + **expo-router** (rutas por archivos), TypeScript estricto como el repo.
- Hojas: `@gorhom/bottom-sheet`; listas virtuales: `@shopify/flash-list`; animación: `react-native-reanimated`; gestos: `react-native-gesture-handler`; íconos: `lucide-react-native`; almacenamiento seguro: `expo-secure-store` (sesión); caché: `@tanstack/react-query` con persistencia.
- Tiempo real: el CRM expone **SSE** en `/api/events` (heartbeat `: ping` ~25 s, catch-up con `since=`). En RN usar un cliente SSE (p. ej. `react-native-sse`) y, al reconectar, refrescar con `since=`. Sin WebSockets.
- Tema y tokens: `theme.ts` con los de `03-sistema-de-diseno.md` (claro/oscuro/automático).

```
app/
  (auth)/index.tsx, activar/[token].tsx, restablecer/[token].tsx
  (tabs)/_layout.tsx            ← barra flotante por rol
  (tabs)/inbox/index.tsx        ← INB-01  (segmentos Clientes · Equipo · Mi número)
  chat/[id].tsx                 ← INB-11  (sin barra)
  (tabs)/crm/index.tsx          ← CRM-01  (segmentos Pipeline · Contactos · Biblioteca)
  (tabs)/estudio-ia/…           ← solo owner
  (tabs)/marketing/…            ← owner · coordinador
  (tabs)/mas/index.tsx          ← MORE-01
  asistente/, resultados/, agenda/, tareas/, ajustes/…
components/ (ver §3)   theme/   api/   state/
```

Las hojas, diálogos y menús **no tienen ruta**: se abren por estado (`useLayer()`), para que Atrás los cierre antes de navegar.

## 2. Navegación: reglas

1. Barra inferior flotante personalizada (`tabBar`) con 5 pestañas; ocultar con `tabBarStyle: {display:'none'}` en el chat. Pestañas por rol: owner = Bandeja, CRM, Estudio IA, Marketing, Más · coordinator = sin Estudio IA · asesor = Bandeja, CRM, Más. Las deriva de `GET` de sesión + permisos de `src/lib/auth/permissions.ts` y módulos de la organización; **nunca** mostrar lo que el servidor negaría.
2. Android: `BackHandler` → cerrar capa superior → pop de pila → ir a Bandeja → armar «pulsa otra vez para salir» (2 s).
3. Teclado: `KeyboardAvoidingView` en compositor y hojas con formulario; el botón principal queda sobre el teclado.
4. Áreas seguras: `react-native-safe-area-context`; barra flotante a `bottom = inset + 4`.
5. Sesión de 30 días; al caducar, a AUTH-02 con mensaje.
6. Módulos apagados o permisos faltantes: la pantalla no se ofrece; si se llega por enlace, mostrar vacío «No disponible en tu plan».

## 3. Componentes reutilizables (a construir una vez)

`AppBar`, `SegmentedControl`, `UnderlineTabs`, `FilterChips`, `SearchBox`, `ListRow` (+ `Avatar`, `StageCapsule`, `TagCapsule`, `UnreadBadge`, `AiDot`), `Card`, `KpiCard`, `Banner`, `Button` (primary · secondary · tonal · ghost · danger · disabled), `Field` (+ `error`, `hint`), `PickerRow`, `Switch`, `Radio`, `Checkbox`, `Sheet`, `Dialog`, `PopMenu`, `Toast`, `TabBar`, `Fab`, `Skeleton*`, `EmptyState`, `ErrorState`, `MessageBubble` (variantes: in, team, ai, aiConnected, note, system), `Composer`, `ImageViewer`, `StatusPill`, `KeyValueRow`.
Los nombres y variantes son los de `src/ui.js` del prototipo (ver DS-03, DS-04, DS-05, DS-06).

## 4. Estados que toda pantalla de datos debe implementar

| Estado | Pintar | Cierra con |
|---|---|---|
| `loading` | Esqueleto con la forma final | datos o error |
| `empty` | `EmptyState` (ícono, frase, acción sugerida) | primer dato |
| `error` | `ErrorState` + «Reintentar» | éxito del reintento |
| `offline` | Banda fija bajo `AppBar`; datos en caché visibles | reconexión |
| `forbidden/off` | No se muestra la entrada | — |
| `refreshing` | Pull-to-refresh | — |

## 5. Eventos y reglas por pantalla clave

| ID | Eventos | Validaciones / reglas |
|---|---|---|
| AUTH-02 | enviar correo + contraseña | correo con formato; contraseña ≥ 1; error genérico sin revelar cuál falló; botón deshabilitado enviando |
| INB-01 | abrir chat, mantener = seleccionar, filtro, buscar, pull-to-refresh, nuevo chat | lista virtual; el filtro del Asesor lo aplica el servidor (`scopedContacts`) |
| INB-11 | enviar texto, adjuntar, `/atajo`, plantilla, tomar chat, IA on/off | **ventana 24 h**: si cerrada, el compositor se sustituye por «Enviar plantilla» (INB-17); texto ≤ 4,096 por mensaje de WhatsApp (el servidor lo divide; la UI permite hasta `CHAT_TEXT_MAX`); adjuntos con los topes por tipo de `src/lib/upload-limits.ts`; mensaje fallido → INB-29 con motivo |
| INB-30 | elegir conexión del chat (Meta / Directa / Híbrida) | solo con el complemento Conexión directa y permiso `direct_connection.mode`; salir de Meta exige dispositivo vinculado y sin pausa de emergencia; volver a Meta siempre; `PUT /api/conversations/[id]/mode` |
| INB-21/22/23 | cambiar etapa / asignar / etiquetas | «Perdido» exige motivo (INB-25); asignar solo con `assignment.manage` |
| CRM-01 | deslizar entre etapas, tocar trato, mover | sin arrastre; mover = hoja CRM-03 |
| CRM-17 | importar contactos | pregunta obligatoria «¿aceptaron recibir mensajes?» antes de importar |
| LAB-05 | publicar agente | diálogo de confirmación con resumen de cambios |
| MKT-03/04 | crear y confirmar campaña | solo audiencia `opt_in`; plantilla aprobada; **MKT-04 propuesta:** escribir el número de destinatarios para confirmar |
| AST-01 | preguntar, «Aplicar» propuestas | lo que cambia o envía solo corre con «Aplicar» y con la sesión de quien pulsa |
| SET-14 | permisos y tipos de aviso | push = **nueva (aprobada)** |

(El resto sigue las plantillas de la §6.)

## 6. Plantillas por tipo de pantalla

- **Lista**: `FlashList` + `RefreshControl`; paginación por cursor si la API la ofrece (si no, límite y «Ver más»); clave estable = ID del registro; fila ≥ 64 px.
- **Detalle (push)**: `AppBar` con Atrás; secciones en `Card`; acciones primarias abajo (pie fijo) si hay una principal.
- **Formulario (hoja)**: `Field`s controlados, validación al salir del campo y al enviar, error por campo + resumen, botón principal deshabilitado con envío en curso, descarte con confirmación si hay cambios.
- **Diálogo destructivo**: título con el nombre del objeto, texto de consecuencias, botón rojo a la derecha/abajo, «Cancelar» a la izquierda/arriba.
- **Menú ⋮**: renglones con ícono 18 + texto; peligro al final tras divisor.

## 7. Datos necesarios (del backend que ya existe)

Rutas citadas en la guía del repositorio (no se agrega ninguna): `/api/conversations` (+ `?view=campaigns`, `?ids=`), `/api/conversations/[id]/agent`, `PUT /api/conversations/[id]/mode` (conexión del chat), `/api/settings/direct-connection/*`, `/api/conversations/unread`, `/api/events` (SSE), `/api/pipeline/*` (leads, `loss-reasons`), `/api/quick-replies`, `/api/knowledge`, `/api/team-chat/*`, `/api/work/tasks*`, `/api/work/notes*`, `/api/lab/*` (agentes, documentos, asignaciones, evaluaciones, vista previa), `/api/assistant/*`, `/api/usage*`, `/api/agent/pause`, `/api/agent/brain-status`, `/api/number-health`, `/api/settings/*`, `/api/platform/*` (solo administrador). Los contratos exactos se leen del repo al implementar cada pantalla; **este diseño no define ni cambia ningún contrato.**

## 8. Relación con funciones existentes

Cada fila del CSV indica la función web de origen (columna «Pantalla/función web») y si es **actual**, **adaptada** o **PROPUESTA**. Lo marcado «nueva» fue aprobado por Fer el 2026-11-10; sigue necesitando su propia revisión visual al implementarse.

## 9. Prioridad de implementación

| Prioridad | Contenido |
|---|---|
| **P0** | Acceso, tema y componentes base, barra por rol, Bandeja (lista, chat, adjuntar, plantilla, detalles), Más, Cerrar sesión, estados |
| **P1** | Etapa/asignar/etiquetas/tareas desde el chat, Equipo, Mi número, Pipeline y Contactos esenciales, Notificaciones en Ajustes, Equipo y permisos, Canales |
| **P2** | Estudio de IA, Marketing, Agenda, Tareas y notas, Biblioteca, Resultados, Asistente, Uso y plan, resto de Ajustes |
| **P3** | Funciones nuevas (animación, confirmación reforzada de campaña, subir base, navegación personalizable, llamar, push; push pasa a P1 por ser clave en un chat, ver 08) y Plataforma |

## 10. Criterios de aceptación (por pantalla)

1. Se parece al prototipo (mismo ID) en claro y oscuro a 390×844 y 360×640, sin texto cortado ni desbordes.
2. Todas las zonas táctiles ≥ 44; contraste AA.
3. Cada control tiene destino o acción real; ninguno queda «muerto».
4. Los cuatro estados (cargando, vacío, error, sin conexión) funcionan.
5. Respeta permisos y módulos del usuario (probado con los tres roles).
6. Atrás cierra la capa superior; el foco no se pierde; el teclado no tapa el botón principal.
7. Respeta «reducir movimiento» y el tamaño de letra del sistema.
8. En chats: la ventana de 24 h, el límite de largo, los topes de archivo y los estados de entrega se comportan como en la web.
9. Ninguna acción de prueba (Laboratorio) envía a WhatsApp real.
10. Prueba end-to-end del flujo principal de la pantalla (Playwright/Detox contra los mocks del repo), sin pedirle la prueba a Fer.
