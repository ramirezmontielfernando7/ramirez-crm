# 02 · Arquitectura de navegación (Fase 2)

## Principios

1. **La Bandeja es la casa.** Se abre ahí; Atrás desde cualquier pestaña regresa a la Bandeja; Atrás en la Bandeja pide «pulsa otra vez para salir».
2. **Una barra inferior flotante, 5 pestañas** (la aprobada en la maqueta): Bandeja · CRM · Estudio IA · Marketing · Más. Las pestañas siguen siendo los pilares del CRM web, así los nombres no cambian entre web y móvil.
3. **La barra se adapta al rol:** Propietario 5 pestañas; Coordinador 4 (sin Estudio IA); Asesor 3 (Bandeja, CRM, Más). Lo que un rol no ve, no aparece (nunca un botón que dé 403).
4. **Dentro de cada pestaña, sub-secciones como en la web**, con el control que mejor funciona en móvil:
   - Segmentos redondeados (Clientes · Equipo · Mi número; Pipeline · Contactos · Biblioteca).
   - Pestañas subrayadas desplazables (Estudio IA: Agentes · Conocimiento · Asignación · Pruebas; Marketing: Campañas · Audiencias · Plantillas · Métricas).
5. **Paneles laterales de la web → hojas inferiores.** Detalle del trato, detalles de cita, filtros, asignar, etiquetas: se abren desde abajo, se cierran deslizando o con Atrás.
6. **Acciones destructivas o irreversibles → diálogo centrado** (eliminar chat, publicar agente, confirmar envío de campaña).
7. **Menús ⋮ → menú emergente** anclado arriba a la derecha; máximo 6 renglones.
8. **«Más»** concentra lo que no cabe en la barra: Asistente, Resultados, Agenda, Tareas y notas, Ajustes, Uso y plan, cuenta y cerrar sesión, además de Avisos.

## Mapa

```
Acceso ── AUTH-01 apertura → AUTH-02 iniciar sesión → (AUTH-03 activar / AUTH-04 restablecer por enlace)

[Barra inferior flotante]
├─ Bandeja
│   ├─ Clientes (INB-01) ─ búsqueda INB-02 · selección INB-03 · filtros INB-05 · Campañas INB-09 · nuevo chat INB-10
│   │    └─ Chat INB-11 ─ menú INB-12 · adjuntar INB-13 · rápidas INB-14 · biblioteca INB-15 · emojis INB-16
│   │         · plantilla INB-17 · redacción INB-18 · Detalles INB-19 → historial INB-20 · etapa INB-21 · asignar INB-22
│   │         · etiquetas INB-23 · IA INB-24 · pérdida INB-25 · tarea INB-26 · imagen INB-27 · eliminar INB-28 · fallo INB-29
│   ├─ Equipo (EQP-01) → chat EQP-02 · nuevo EQP-03 · grupo EQP-04 · mención EQP-05 · supervisión EQP-06
│   └─ Mi número (NUM-01) → chat NUM-02 · opciones NUM-03 · nuevo NUM-04
├─ CRM
│   ├─ Pipeline (CRM-01) → trato CRM-02 · mover CRM-03 · monto CRM-04 · pérdida CRM-05 · nuevo CRM-06 · etapas CRM-07
│   ├─ Contactos (CRM-10) → ficha CRM-11 · editar CRM-12 · filtros CRM-14 · masivas CRM-15 · importar CRM-17
│   ├─ Biblioteca (CRM-40) → entrada CRM-41
│   (Agenda CRM-20 · mes CRM-24 · Tareas CRM-30 · Notas CRM-32 viven dentro de «Más», aunque en la web son del CRM Comercial)
├─ Estudio IA (propietario)
│   Agentes LAB-01 → creador LAB-02 · editor LAB-03 · vista previa LAB-04 · publicar LAB-05 · versiones LAB-06
│   Conocimiento LAB-10 · Asignación LAB-20 · Pruebas LAB-30 → detalle LAB-31
├─ Marketing (propietario/coordinador)
│   Campañas MKT-01 → detalle MKT-02 · nueva MKT-03 → confirmar MKT-04
│   Audiencias MKT-10 · Plantillas MKT-20 · Métricas MKT-30 · Ajustes MKT-31
└─ Más (MORE-01)
    Asistente AST-01 · Resultados RES-01 · Avisos MORE-05 · Uso y plan MORE-06 → Mejora tu plan MORE-07
    Ajustes SET-01 → 17 apartados · (admin de plataforma) PLT-01…03 · Cerrar sesión MORE-08
```

El mapa visual con flechas está en la sección 3 del PDF.

## Reglas de navegación

| Situación | Comportamiento |
|---|---|
| Tocar la pestaña activa | Vuelve a la raíz de esa pestaña; si ya está en la raíz, sube la lista al inicio |
| Atrás (botón o gesto) | Cierra la capa superior (hoja/menú/diálogo); si no hay, sube un nivel de la pila; en la raíz de otra pestaña va a Bandeja; en la Bandeja arma «pulsa otra vez para salir» (2 s) |
| Chat abierto | Sin barra inferior (el compositor ocupa su lugar); Atrás regresa a la lista conservando posición y filtro |
| Teclado | El compositor sube con el teclado; las hojas con formulario se elevan y el botón principal queda visible; Enter no envía en el compositor (el botón enviar sí) |
| Áreas seguras | Superior 44 px (barra de estado), inferior 20 px (indicador de gestos); la barra flotante se separa del borde y respeta ambas |
| Gestos | Deslizar hoja hacia abajo = cerrar; mantener presionada una fila = seleccionar; deslizar el pipeline = cambiar de etapa; nada depende de un gesto sin alternativa visible |
| Avisos (toast) | 3 s, abajo sobre la barra; nunca tapan el compositor |
| Estados globales | Sin conexión: banda fija bajo el encabezado; sesión caducada: AUTH-02 con el mensaje |

## Profundidad máxima

Ninguna función está a más de **3 toques** desde la Bandeja (Más → Ajustes → apartado), salvo las acciones dentro de un chat (hoja dentro de Detalles), que se alcanzan en 2.
