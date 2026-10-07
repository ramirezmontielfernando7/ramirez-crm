# US — Módulos y navegación personalizable (030, Campañas v2 PR 4)

Automatizado: `pnpm test:e2e:navegacion` (`scripts/e2e-navegacion.mjs`), con
la app viva, los mocks y `PLATFORM_ORG_ID` = la organización de
`e2e@vocero.test`.

## Guion

1. **Alta con perfil.** El administrador crea N con «Completo» (todo
   encendido y menú personalizable) y M con «Básico» (sin Agente,
   Laboratorio, Campañas ni menú personalizable). Encender el Laboratorio sin
   el Agente → 422. Un perfil desconocido → 400/422. La Propietaria de N da de
   alta a una Coordinadora y a un Asesor.
2. **Sin `custom_nav` no existe.** Apagado: `/api/settings/navigation` → 404,
   `/settings/navigation` → redirige a Ajustes → Personalización → Navegación, que responde 200 con el aviso «Disponible cuando el módulo «Menú personalizable» está encendido» y sin editor. Encendido: la
   Propietaria entra (200); Coordinadora y Asesor → 403.
3. **Editor (navegador).** Pestaña Asesor: Contactos sube al primer lugar con
   el TECLADO (manija, Espacio, flechas, Espacio); Pipeline sube con el botón
   ↑; se oculta «Chat de equipo»; la vista previa lo refleja; Resultados sale
   como «no puede abrirlo». Guardar → fila en `nav_layout`. El interruptor de
   Ajustes del Propietario está bloqueado y la API lo rechaza (422); dejar a
   un rol sin nada → 422 y la interfaz avisa y no deja guardar.
4. **Lo que ve cada rol.** El Asesor ve el menú nuevo expandido y en íconos
   (mismo orden), y con el menú oculto el cajón del teléfono trae la misma
   lista. Lo oculto sigue respondiendo (API y página del chat de equipo →
   200); Resultados sigue en 403. La Coordinadora no cambia.
5. **Módulo apagado.** La plataforma apaga Conocimientos en N: desaparece del
   menú aunque lo guardado lo muestre, la API → 404 y el editor lo marca no
   disponible. Encendido otra vez → 200.
6. **Restaurar.** «Restaurar valores por defecto» (con confirmación) borra la
   fila, la bitácora muestra «restauró» y el Asesor vuelve al menú de fábrica
   (`nav_layout_event`: saved, reset).
7. **Aislamiento.** La organización del operador: sin `custom_nav` → 404; con
   él, no ve el menú ni la bitácora de N.
8. **Plantillas.** Con Campañas encendido, `/settings/templates` redirige a
   `/campaigns/templates` (pestaña «Plantillas» junto a Campañas, Audiencias
   y Métricas) y Ajustes ya no la muestra; el Asesor no entra. En el negocio
   Básico (sin Campañas), Ajustes → Plantillas sigue igual (200) y
   `/campaigns/templates` → 404.
