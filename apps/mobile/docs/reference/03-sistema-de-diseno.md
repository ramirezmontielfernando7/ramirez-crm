# 03 · Sistema de diseño de Dashfort Mobile (Fase 3)

Es el mismo sistema del CRM web (tokens de `src/app/globals.css`, tipografía Inter, acento white-label teal), pensado para el pulgar. En el prototipo puedes verlo vivo en las pantallas **DS-01 a DS-06** (menú del índice → «Sistema de diseño»).

## 1. Identidad que se conserva

- Marca de la casa **Dashfort by Demfort**: logo (burbuja de chat sobre mosaico teal), nombre y firma desde `src/lib/brand.ts`.
- **Acento white-label**: por defecto teal. En móvil el acento *relleno* (botones, interruptores, globos) es `#0e7c80` porque el blanco encima cumple contraste AA (4.98:1); el teal de marca `#12999d` queda solo para el logo. La organización puede cambiar el acento en Ajustes → Marca y todo el sistema lo sigue (los demás colores se derivan de `--accent`).
- Estilo por defecto **Clásico**, claro. (Demfort Premium no se usa en maquetas, según tu regla.)

## 2. Color (tokens)

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--surface` | #ffffff | #1c263c | Fondo de pantallas, hojas |
| `--surface-base` / `--surface-sunken` | #f5f5f7 | #10172a / #141c30 | Fondo detrás de tarjetas, buscador, segmentos |
| `--text` / `--text-2` / `--text-3` | #1d1d1f / #48484d / #6e6e73 | #e8eefc / #bac6e3 / #9aa9ca | Texto principal / secundario / ayuda y hora |
| `--border` / `--border-strong` | #e6e6eb / #d8d8de | #36476f / #4a5d8e | Divisores / bordes de campos |
| `--accent` | #0e7c80 | #12999d | Botón principal, interruptor, globos |
| `--accent-ink` | #0b6a6d | #63bcbe | Texto e íconos de acento, títulos de módulo |
| `--accent-wash` / `--accent-tint` | #e3f3f3 / #ebf6f6 | #1d4554 / #1a3f51 | Fondo de cápsula activa / fila abierta |
| Éxito / aviso / error / info | #1fb35b · #f2a71b · #d94a4a · #0d5bff (textos #157a41, #935f0b, #b73535, #0038d8) | #4fd07f · #f5b74a · #ef7373 · #7aa2ff | Estados |
| Burbuja entrante / equipo | #ffffff / #d7efef | #27324f / #1f5560 | Chat |
| Burbuja IA / IA conectada | #e9e4fb / #e3ecff | #2f2754 / #1e3566 | Chat (la IA siempre violeta; la IA conectada de una persona, azul con estrellitas) |
| Etiquetas de cliente | paleta `TAG_COLORS` del CRM | ídem | Cápsulas (el color nunca es el único indicador: lleva texto) |

**Modo oscuro**: claro/oscuro/automático (sigue el sistema). El oscuro no es negro puro: azul noche (#1c263c) para que las burbujas y tarjetas se distingan.

### Contraste medido (WCAG, texto normal exige 4.5:1)

| Par | Claro | Oscuro |
|---|---|---|
| Texto principal sobre superficie | 16.83:1 ✓ | 12.98:1 ✓ |
| Texto secundario sobre superficie | 9.09:1 ✓ | 8.82:1 ✓ |
| Texto terciario (hora, ayuda) sobre superficie | 5.07:1 ✓ | 6.40:1 ✓ |
| Texto del botón principal | 4.98:1 ✓ | 5.35:1 ✓ |
| Texto/ícono de acento sobre superficie | 6.37:1 ✓ | 6.80:1 ✓ |
| Texto de acento sobre cápsula activa | 5.58:1 ✓ | 4.66:1 ✓ |
| Éxito | 4.88:1 ✓ | 7.46:1 ✓ |
| Aviso | 5.03:1 ✓ | 8.65:1 ✓ |
| Error | 5.29:1 ✓ | 7.29:1 ✓ |
| Información | 7.26:1 ✓ | 7.95:1 ✓ |
| Burbuja del equipo | 10.27:1 ✓ | 7.15:1 ✓ |
| Burbuja de la IA | 11.71:1 ✓ | 11.33:1 ✓ |
| Burbuja de IA conectada | 10.66:1 ✓ | 9.55:1 ✓ |
| Etiqueta | 7.07:1 ✓ | 7.08:1 ✓ |

Se corrigió un par: en claro, el texto de acento sobre la cápsula activa daba 4.36:1; el móvil usa `--accent-ink #0b6a6d` (5.58:1).

## 3. Tipografía — Inter, 3 pesos (400, 500, 600)

| Rol | Tamaño/interlínea · peso |
|---|---|
| Título de módulo (Bandeja, CRM…) | 26/32 · 600, color acento |
| Título de pantalla | 17/22 · 600 |
| Nombre en lista | 16/22 · 500 |
| Cuerpo y chat | 15/21 · 400 |
| Secundario | 14/20 · 400 |
| Etiqueta / cápsula | 12.5/16 · 500 |
| Meta (hora, ticks) | 11–12 · 400 |
| Campos de texto | 16 (evita el zoom de iOS) |

Mínimo 11.5 px, solo en etiquetas de la barra inferior y metadatos. En la app real respeta el tamaño de letra del sistema (hasta 130 % sin romper; a partir de ahí las listas pasan a una línea de vista previa).

## 4. Espaciado, radios, sombras

- Cuadrícula de **4 pt**; márgenes laterales 16; separación entre tarjetas 12.
- Radios: control 12 · tarjeta 16 · hoja 22 · píldora 999.
- Sombras: tarjeta suave; flotante (barra inferior, FAB, menús) más marcada; en oscuro, sombra más densa.
- Áreas táctiles: **44×44 pt mínimo** (iOS) / 48 dp (Android). Los chips miden 36 y amplían su zona a 44.

## 5. Íconos

Lucide (la misma librería del CRM), trazo 1.8, tamaños 16 / 18 / 22 / 26 / 34. Cada ícono solo, sin texto, lleva `aria-label`. La barra inferior usa ícono + texto siempre.

## 6. Componentes

| Componente | Notas |
|---|---|
| Barra superior | 52 px; título 26 px de módulo o título de pantalla 17 px con flecha Atrás; acciones a la derecha (buscar, ⋮) |
| Segmentos / pestañas | Segmentos redondeados (hasta 3) · pestañas subrayadas desplazables (4+) |
| Chips de filtro | 36 px, activo = acento tenue; globo de conteo |
| Fila de lista | Avatar 50, nombre, vista previa, hora, globo de no leídos, cápsulas (etapa · etiquetas), punto de IA bajo el avatar |
| Avatar | Tono suave de marca; iniciales; silueta si no hay; ícono de bot debajo (verde = activa, naranja = en pausa) |
| Botones | Principal (relleno), secundario (borde), tonal, solo texto, peligro, deshabilitado; alto 48 |
| Campos | Etiqueta arriba, ayuda abajo, error en rojo con texto y ícono; selector = fila con valor que abre hoja |
| Interruptor, radio, casilla | Interruptor 50×30; filas completas tocables |
| Tarjeta, tarjeta con KPI | Borde fino, sin sombra en listas |
| Banner | Info, aviso, error, éxito; con acción opcional |
| Hoja inferior | Asa, título, contenido desplazable, pie con botones; máx. 88 % de alto |
| Diálogo | Centrado, hasta 2 botones (apilados si el texto es largo) |
| Menú emergente | Anclado a la esquina, ≤ 6 renglones, peligro al final tras divisor |
| Toast | 3 s, sobre la barra |
| Barra inferior flotante | 72 px (64 en teléfono pequeño), 5 pestañas con ícono + texto, globo de no leídos |
| Burbujas de chat | Entrante, equipo, IA, IA conectada, nota interna, sistema (cambio de etapa, asignación), estados ✓ ✓✓ ✓✓ azul, fallo con «Reintentar» |
| Compositor | Redondo; adjuntar, rápidas `/`, emoji, varita de redacción, enviar |
| Esqueletos / vacío / error | Esqueleto con la forma de la fila; vacío con ícono, frase y acción; error con «Reintentar» |

## 7. Movimiento

Nada dura más de 300 ms (hojas 240 ms). Todo se apaga con «reducir movimiento» del sistema. La animación de apertura (AUTH-01) dura < 1 s, solo la primera vez, y es una **propuesta** pendiente.

## 8. Accesibilidad

- Contraste AA en todos los pares (tabla arriba).
- Zonas táctiles ≥ 44; control automático en el QA del prototipo: 0 incumplimientos.
- Cada botón con solo ícono tiene etiqueta accesible; los estados no dependen solo del color (texto + ícono).
- Orden de foco lógico; las hojas atrapan el foco y se cierran con Atrás.
- Tamaño de letra del sistema respetado; sin texto dentro de imágenes.
- Idioma de interfaz: español (México) con tuteo y frases cortas.
