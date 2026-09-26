# Vocero — piezas de marketing: plan, guion y calibración (Fase 0)

Estado: **pendiente de aprobación**. Nada se graba hasta tu visto bueno.

Negocio demo: **Ferretería El Martillo** (Cancún). Todo es ficticio y local:
build de producción (`next build` + `next start`), Postgres local en el puerto
5433 (`vocero_marketing`), sidecar de mocks (WhatsApp + IA) en el 4010,
`WA_MOCK_ENABLED=true`, `CAMPAIGNS=on`, secretos generados al azar solo para
esta instancia. Teléfonos `+52 998 555 01XX`.

---

## 1. Calibración de captura (números reales, medidos hoy en este equipo)

Equipo: 4 CPU, 15 GB, sin GPU. Prueba: 15 s de Bandeja con 4 mensajes
entrando por el webhook simulado y el menú lateral pasando por sus tres
estados (expandido → íconos → oculto → expandido).

| | Método A — cuadro por cuadro | Método B — Xvfb + x11grab en tiempo real |
|---|---|---|
| Cómo | `chrome-headless-shell --deterministic-mode`; cada cuadro = avanzar el **tiempo virtual** 16,667 ms + `HeadlessExperimental.beginFrame` con captura PNG | Chromium en Xvfb, ffmpeg x11grab a 60 fps, maestro sin pérdida |
| Cuadros | 925 (15,42 s) | 984 |
| Cuadros perdidos | **0** (por construcción: el video no avanza hasta que el cuadro está pintado) | ffmpeg dice `dup=0 drop=0`, **pero es engañoso** (ver abajo) |
| Cuadros repetidos durante las animaciones del menú | **0 de 51** | **28 de 68 (41 %)**, con un tirón de **6 cuadros seguidos (100 ms)** |
| Intervalo de rAF durante la grabación | **16,67 ms en el 100 % de los cuadros** (128/128 medidos) | 58,8 fps promedio en la página, 1,3 % de cuadros largos |
| Desfase reloj JS ↔ reloj de cuadros | 0,0 ms tras alinear (17,7 ms antes) | n/a |
| Costo | 176 ms reales por cuadro (≈ 10,6× más lento que tiempo real): 1 min de video ≈ 11 min de render | tiempo real |

Por qué B engaña: x11grab siempre entrega 60 cuadros por segundo, pero
Chromium sin GPU no pinta 60 cuando hay animación; ffmpeg copia la pantalla
vieja y no lo cuenta como duplicado. Lo medí comparando cada cuadro con el
anterior: en B, durante el deslizamiento del menú, 4 de cada 10 cuadros son
idénticos al previo (la animación va "a saltos").

En A verifiqué además:
- **CSS transitions** (una caja a 1000 px/s avanza 16,7 px exactos por cuadro).
- **WAAPI / `motion`**: el deslizamiento de la columna al mostrar el menú
  baja −156,6 → −114,3 → −79,9 → … → −0,1 px, monótono, sin tropiezos.
- **SSE en vivo y webhook simulado**: los 4 mensajes entran y la fila sube
  sola en la Bandeja.
- El menú lateral **cambia de ancho de golpe por diseño** (lo dice
  `src/components/app-shell.tsx`: "El menú cambia de ancho de golpe… lo que
  se mueve es la columna de contenido"). Eso se ve igual en el video: no es un
  salto de la captura.

Muestra: `marketing/revision/calibracion-metodo-A.mp4` (15 s, 60 fps, con
cursor dibujado en posproducción; se envía aparte).

**Decisión propuesta: Método A para todos los clips.** B queda descartado
(41 % de cuadros repetidos en animaciones) y C (30 fps) no hace falta.

### Lo que el Método A rompe o cambia (y cómo lo resuelvo)

1. **`<select>` nativos** (filtro "Quién atiende", "Asignar a", "Agregar
   etiqueta", roles, plantilla, "Resultados de"…). En headless la lista
   desplegable es una ventana del sistema que no se puede pintar bajo control
   de cuadros: al abrirla, la captura se congela (lo reproduje).
   **Solución probada**: el cursor va al select y hace clic (la lista se abre y
   se cierra en el mismo cuadro, sin colgar); el campo queda enfocado con su
   anillo y **las flechas del teclado cambian el valor visiblemente**, opción
   por opción ("Todo el equipo" → "Míos" → "Sin asignar"), con el resultado
   aplicándose en vivo. **No se ve la lista desplegable abierta.** No es
   `selectOption()`: son teclas reales. → *Necesito tu OK.*
2. **Importar CSV**: el cursor hace clic en el botón de archivo; el diálogo
   del sistema operativo no existe en headless, así que el archivo se entrega
   por el evento `filechooser` de Playwright (no `setInputFiles` directo) y se
   ve aparecer su nombre. → *Necesito tu OK.*
3. **Horas del servidor**: el render es ~10× más lento que el tiempo real y
   el servidor/BD sellan los mensajes con la hora real. En un clip de 50 s
   (≈ 9 min de render) la hora de los mensajes nuevos puede avanzar unos
   minutos (p. ej. la clienta escribe 11:02 y el asesor responde 11:08).
   Mitigación: los mensajes en vivo de un mismo intercambio se disparan
   seguidos en tiempo real. Si te molesta, puedo intentar ralentizar el reloj
   del servidor con libfaketime (riesgoso; no lo haría sin probarlo aparte).
4. **Tiempos del bot y del handoff**: el servidor responde en tiempo real,
   así que en el video la respuesta del bot saldría "instantánea". El sidecar
   de mocks (código de `scripts/marketing/`, no de la app) retendrá la
   respuesta de la IA hasta el instante del guion (≈ 1,8 s de video después
   del mensaje de la clienta), para que el ritmo sea creíble.
5. **Navegación completa en cámara** (login visible en 01 y 06): el paso a
   tiempo virtual se hace después de cargar la página. Si el login provoca
   una recarga completa, esa parte se graba como segmento aparte y se une con
   un corte limpio en el instante del clic en "Entrar". Lo confirmo al grabar
   01 y te aviso.

---

## 2. Reglas comunes a todos los clips

- **Cursor**: flecha oscura con borde blanco y un halo teal sutil que late al
  hacer clic, dibujado en posproducción a 60 fps exactos sobre la posición
  real del mouse (el mouse real de la página sigue la misma trayectoria, así
  que hover y focus son reales). Trayectorias de 500–800 ms, ≥ 30 cuadros,
  con aceleración y frenado, pausa 150–250 ms antes de cada clic.
- **Escribir**: clic en el campo y tecla por tecla a 60–90 ms.
- **Pausas**: ninguna > 1,2 s sin movimiento; 1–2 pausas de lectura de ≤ 2 s
  por clip; 700–900 ms tras cada resultado visible; **1,5 s final** mostrando
  el resultado.
- **Fuera de cámara**: restaurar la BD, login y abrir la pantalla inicial.
- **Personajes fijos**: Carlos Martínez (Propietario), Sofía Ramírez y
  Marcela Cruz (Coordinadoras), Diego López, Paola Núñez, Iván Salazar,
  Andrea Vega, Héctor Molina y Lucía Ortega (Asesores); agente de IA
  "Martillito"; clienta del bot **Mariela Poot** (+52 998 555 0174).
- **Snapshot**: `base.dump` para todos los clips; `mariela.dump` (base +
  lo que pasa en el clip 03, generado fuera de cámara) para el clip 04, así
  la clienta que entra en 03 es la misma que se etiqueta en 04.

---

## 3. Guion por clip

Formato de cada paso: **acción** → *lo que se ve* — «subtítulo».

### 01 · Inicio de sesión (≈ 30 s)
Historia: Carlos entra a Vocero y aterriza en su bandeja con todo al día.
Estado inicial: `/login` vacío, tema claro, 1920×1080. Usuario: Carlos.
1. Cursor al correo, clic, escribe `carlos@elmartillo.demo` → *el campo se
   llena letra a letra* — «Entra con tu correo de trabajo».
2. Clic en contraseña, escribe (puntos) → *campo con puntos* — «Tu contraseña,
   cifrada y en tu servidor».
3. Clic en "Entrar" → *aterriza en la Bandeja con badges* — «Entra directo a
   tu bandeja».
4. Cursor recorre el menú: Bandeja (18), Chat de equipo (7) → — «Sin leer y
   avisos del equipo, a la vista».
5. Final 1,5 s sobre la Bandeja.

### 02 · Bandeja (≈ 45 s)
Historia: todos los chats de WhatsApp en un lugar, con filtros y mensajes en vivo.
Estado inicial: `/inbox` como Carlos, sin chat abierto.
1. Scroll suave de la lista con la rueda y regreso → *32 chats con etapa,
   asesor y anuncio de origen* — «Todos tus chats de WhatsApp juntos».
2. Clic en el chip de filtro → "No leídas" → *la lista se reduce a 10* —
   «Filtra los chats sin leer».
3. Clic en "Todas" → *vuelven los 32* — «Vuelve a ver todas».
4. Clic en "Quién atiende" + flechas hasta "Sin asignar" → *6 chats* —
   «Filtra por quién atiende».
5. Flechas de regreso a "Todo el equipo", Escape.
6. Clic en la lupa, escribe "Ramos" → *queda Ing. Alejandro Ramos* — «Busca
   un cliente por su nombre»; borra con Backspace.
7. Entra un mensaje de Hugo Sánchez → *su fila sube arriba con contador* —
   «Llega un mensaje en vivo».
8. Entra una clienta nueva (Karina Pech) y Martillito responde → — «Un
   cliente nuevo; el bot contesta».
9. Cursor al badge de Bandeja en el menú → *el número sumó* — «El contador
   del menú suma solo». Final 1,5 s.

### 03 · Conversación con el bot, handoff y asesor (≈ 55 s)
Historia: el bot atiende a Mariela, ella pide un humano y Diego toma el chat.
Estado inicial: Diego logueado; chat de Mariela Poot abierto (ya asignado a
Diego, con su saludo y la bienvenida de Martillito); bot activo.
1. Mariela: "¿Cuánto cuesta el bulto de cemento?" → *burbuja entrante* —
   «La clienta pregunta un precio».
2. ~1,8 s después Martillito responde con el precio → — «El bot responde al
   instante».
3. Mariela: "¿Y abren el domingo?" → bot da el horario → — «También resuelve
   horarios».
4. Mariela: "¿Me atiende un asesor? Necesito factura" → *el bot se pausa,
   aparece el aviso de atención humana* — «Pide hablar con una persona».
5. Pausa de lectura sobre el aviso (≤ 2 s) — «Diego recibe el aviso».
6. Diego clic en el editor, escribe "¡Hola, Mariela! Soy Diego. Pásame tu RFC
   y te la hago", Enter → *burbuja saliente con palomitas* — «El asesor toma el
   chat».
7. Mariela responde con su RFC → — «Atendida por una persona». Final 1,5 s.

### 04 · Panel del contacto (≈ 50 s)
Historia: la ficha de Mariela reúne todo: origen, etapa, etiquetas, notas y
su historia.
Estado inicial: `mariela.dump`; Carlos en `/inbox` con el chat de Mariela abierto.
1. Cursor recorre la ficha (anuncio de origen, teléfono, asesor Diego) —
   «Toda la ficha a un lado del chat».
2. Clic en la etapa "Interesado" → *la etapa avanza en el embudo* — «Avanza la
   etapa del embudo».
3. Clic en "Agregar etiqueta" + flechas hasta "Cotización pendiente" → *la
   etiqueta aparece* — «Etiqueta al cliente».
4. Muestra el consentimiento "Acepta mensajes" — «Consentimiento siempre
   visible».
5. Clic en "Nueva nota", escribe "Factura a nombre de su empresa; entrega el
   viernes 9 am", "Añadir nota" — «Deja notas para el equipo».
6. Scroll a la línea de tiempo → *handoff, etapa, etiqueta y nota en orden* —
   «Toda la historia en una línea». Final 1,5 s.

### 05 · Asignación (≈ 45 s)
Historia: Carlos reparte el trabajo y cada quien ve lo suyo.
Estado inicial: `/inbox` como Carlos.
1. Abre "Juan Pablo Herrera" (sin asignar) — «Un chat sin asignar».
2. "Asignar a" + flechas hasta Paola Núñez → *el chip cambia* — «Asígnalo con
   un clic».
3. Reasigna a Iván Salazar → — «Reasigna cuando haga falta».
4. Clic en "Ver historial de asignación" → *bitácora con quién y cuándo* —
   «Queda registro de cada cambio».
5. "Seleccionar varios" → marca Guadalupe Chan, Ricardo Pérez, Javier Cruz Pat
   → "Asignar seleccionados a" Andrea Vega → — «Asigna varios de una vez».
6. Filtro "Quién atiende" = Andrea Vega → *sus chats* — «Filtra los de cada
   asesor». Final 1,5 s.

### 06 · Roles (≈ 55 s)
Historia: cada rol ve lo que le toca.
Estado inicial: `/inbox` como Carlos (Propietario).
1. Carlos: lista completa (32) y Ajustes visible — «El Propietario ve todo».
2. Cierra sesión; login visible de Diego → *solo sus chats, sin Ajustes* —
   «El asesor ve solo lo suyo».
3. Cierra sesión; login visible de Sofía → filtro por Diego López — «La
   Coordinadora supervisa al equipo».
4. Vuelve Carlos — «Permisos en el servidor, no solo en pantalla». Final 1,5 s.

### 07 · Plantillas (≈ 45 s)
Historia: con la ventana de 24 h cerrada, se reabre la charla con una
plantilla aprobada.
Estado inicial: `/settings/templates` como Carlos.
1. Recorre Bienvenida y Promoción (Aprobada), Recordatorio (Pendiente de
   Meta), Oferta relámpago (Rechazada) — «Tus plantillas y su estado en Meta».
2. Ir a Bandeja → chat de Norma Canché → aviso "La ventana de 24 horas está
   cerrada" — «Pasadas 24 h, solo plantillas».
3. Select de plantilla + flechas hasta "promocion" → variables: "Norma",
   "impermeabilizante acrílico 5 años" — «Llena las variables».
4. "Enviar plantilla" → *burbuja de plantilla enviada* — «Enviada y
   registrada en el chat». Final 1,5 s.

### 08 · Campañas (≈ 55 s)
Historia: una promoción solo a quien aceptó recibir mensajes.
Estado inicial: `/campaigns` como Carlos.
1. "Nueva campaña", escribe el nombre — «Crea una campaña nueva».
2. Plantilla "promocion" (flechas) — «Elige una plantilla aprobada».
3. Público: etiquetas "Cliente frecuente" y "Mayoreo" → *"Le llegará a N"* —
   «Solo a quien aceptó mensajes».
4. Variables: {{1}} = Nombre del contacto; {{2}} escrito — «Personaliza cada
   mensaje».
5. "Revisar envío" → vista previa → "Confirmar y enviar" — «Revisa y envía».
6. Avance en vivo: enviados / entregados — «Mira el avance en vivo». Final 1,5 s.

### 09 · Importar y exportar (≈ 45 s)
Historia: 12 clientes de un CSV entran etiquetados y se exportan filtrados.
Estado inicial: `/contacts` como Carlos.
1. "Importar" → clic en el archivo → aparece `clientes-septiembre.csv` —
   «Importa tus clientes desde CSV».
2. Etiqueta automática "Import: clientes-septiembre.csv" → "Importar" →
   *resumen: 12 nuevos* — «Cada importación queda etiquetada».
3. Filtro por esa etiqueta y por "Acepta mensajes" (flechas) — «Filtra por
   etiqueta y consentimiento».
4. "Exportar" → *se descarga el CSV filtrado* — «Exporta exactamente lo
   filtrado». Final 1,5 s.

### 10 · Chat de equipo (≈ 60 s)
Historia: el equipo se coordina adentro de Vocero, en vivo.
Estado inicial: `/chat` como Carlos; Sofía y Diego conectados en un segundo
navegador invisible.
1. Abre "Avisos" (los 9) — «El canal de avisos del equipo».
2. Recorre el PDF adjunto y las reacciones — «Archivos y reacciones de todos».
3. Reacciona 👍 — «Reacciona a los avisos».
4. Escribe y publica "Mañana llega el pedido de Comex 🎨 ¡A vender!" —
   «Publica un aviso para todos».
5. Abre "Equipo de ventas": mención de un chat de cliente — «Menciona chats
   de clientes».
6. Diego escribe en vivo en el grupo → aparece sin recargar — «Llega sin
   recargar».
7. Sofía manda un directo → sube el contador del hilo y del menú — «Un directo
   suma al contador».
8. Carlos contesta "Va, te veo a las 11:30 👍"; Sofía: "¡Perfecto! 🙌" —
   «Conversación en tiempo real». Final 1,5 s.

### 11 · Conocimientos (≈ 45 s)
Historia: el material del equipo, a un "/" de distancia en cualquier chat.
Estado inicial: `/knowledge` como Carlos.
1. Recorre las 5 entradas (horarios, devoluciones, catálogo PDF, formas de
   pago, zona de entrega) — «El material que tu equipo envía».
2. Busca "entrega" — «Encuéntralo al instante».
3. Bandeja → Patricia Vázquez → en el editor escribe "/zona" → envía — «Escribe
   / en cualquier chat».
4. Botón Conocimientos → "catálogo" → envía el PDF — «Manda el catálogo en
   PDF». Final 1,5 s.

### 12 · Resultados (≈ 50 s)
Historia: cuánto vendiste, qué resolvió el bot y de dónde llegan los clientes.
Estado inicial: `/results` como Carlos, 30 días.
1. Lectura de "Dinero ganado" y "Tratos ganados" (≤ 2 s) — «Cuánto vendió tu
   equipo».
2. Periodos 7 días → Este mes → 90 días → 30 días — «Cambia el periodo».
3. "Resultados de" + flechas → Diego López y regreso — «Resultados por
   persona».
4. Scroll por agente, origen y anuncios, higiene — «Bot, anuncios y
   pendientes». Final 1,5 s.

### 13 · Ajustes y marca (≈ 50 s)
Historia: el dueño adapta Vocero a su equipo y a su marca.
Estado inicial: `/settings/team` como Carlos.
1. Recorre los 9 usuarios y sus roles; cambia Iván a Coordinador (flechas) y
   regresa — «Tu equipo y sus roles».
2. Ajustes → Chat de equipo: activa supervisión y delegación — «Reglas del
   chat de equipo».
3. Ajustes → Marca: prueba acentos y tono del menú → vuelve a Teal Dashfort —
   «Tu marca, tus colores». Final 1,5 s.

### 14 · Menú lateral y diseño (≈ 40 s)
Historia: la interfaz se adapta a cómo trabajas.
Estado inicial: `/inbox` como Carlos, menú expandido.
1. Menú a íconos → oculto → expandido — «El menú en tres tamaños».
2. Resultados, tema oscuro — «Tema claro u oscuro».
3. Bandeja en oscuro, chat abierto; colapsa y oculta el menú — «Más espacio
   para conversar».
4. Regresa a claro — «Todo con animaciones suaves». Final 1,5 s.

---

## 4. Video completo: 00-vocero-completo (≈ 10–11 min)

Orden narrativo ("un día en la Ferretería El Martillo"), fundido de 0,5 s
entre clips:

1. **01 Inicio de sesión** — Carlos abre Vocero.
2. **02 Bandeja** — todo WhatsApp en un lugar; llegan mensajes.
3. **03 Bot + handoff** — Martillito atiende a Mariela; ella pide un humano;
   Diego toma el chat.
4. **04 Panel del contacto** — Mariela avanza de etapa, se etiqueta y queda
   una nota.
5. **05 Asignación** — Carlos reparte los chats sin dueño.
6. **07 Plantillas** — se reabre un chat de más de 24 h con una plantilla.
7. **08 Campañas** — promoción masiva solo a quien aceptó mensajes.
8. **09 Importar/exportar** — entran 12 clientes nuevos del CSV.
9. **11 Conocimientos** — el equipo responde con material listo.
10. **10 Chat de equipo** — coordinación interna en vivo.
11. **06 Roles** — cada quien ve lo suyo.
12. **13 Ajustes y marca** y **14 Menú y diseño** — Vocero se adapta.
13. **12 Resultados** — cierre: lo que todo eso produjo.

---

## 5. Orden de trabajo y entregas

1. Con tu OK: completar la siembra que falte (ver abajo), `base.dump` y
   `mariela.dump`, grabador de Método A con el cursor y los subtítulos en
   posproducción.
2. Lote 1: **02, 03 y 10** → revisión automática (freezedetect, diferencias
   cuadro a cuadro, hoja de contactos, métricas) → te los envío con métricas.
3. Tras tu OK: los otros 11, uno por uno conforme salgan; luego 00 y las
   capturas PNG.

Siembra actual (rama `1hb7pi`, reutilizada; corre en 5 s): 9 usuarios, 72
contactos, 32 chats (8 sin leer, 5 con bot activo, 2 en handoff, 2
archivados, 6 sin asignar), 2 chats largos (24 y 21 mensajes), 3 imágenes,
30 contactos con opt-in, 5 etiquetas, 4 plantillas (2 aprobadas, 1 pendiente,
1 rechazada), 5 conocimientos, chat de equipo con Avisos, 3 grupos y 4
directos (53 mensajes, 48 reacciones), CSV de 12 contactos. Revisaré contra
tu lista (etapa "Perdido", 6–8 avisos de Carlos y Sofía, adjunto en grupo)
antes de grabar y completaré lo que falte.
