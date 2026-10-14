# 039 — Tareas (Fase 1)

- [x] Registro: pilares con `sections` (`src/lib/modules/registry.ts`); módulos absorbidos sin renglón.
- [x] Menú puro: `availableSections`, `activeSection`, `pillarOfPath`, `entryHref`; `resolveNav` devuelve `hrefs` (`src/lib/modules/nav-layout.ts`).
- [x] Menú lateral: renglón → primera pestaña; activo en todas sus rutas; Bandeja con los dos globos (`app-nav.tsx`, íconos en `nav-icons.ts`).
- [x] `PageShell` en UNA barra de 56 px (pestañas `pill` dentro; sub-secciones `segmented`); la Bandeja y el Chat de equipo sin `PageShell`, con el selector «Bandeja ▾»; se conserva la franja móvil de `AppShell`.
- [x] Migrar pantallas: Bandeja, Equipo, Pipeline, Contactos, Agenda, Tareas y notas, Biblioteca, Laboratorio, Agente, Campañas (lista, audiencias, plantillas, métricas, nueva, detalle, ajustes de envío), Resultados, Asistente, Ajustes, Plataforma.
- [x] Ajustes en 5 pestañas; `/settings/uso` (y `/uso` redirige); `uso` en `SETTINGS_TAB_PERMISSION`.
- [x] Planes Esencial/Pro/Ultra/Personalizado (`MODULE_PROFILES`, `PLAN_OPTIONS`, `profileOfPlan`), canales del plan en `profileRow`, API y formulario de /platform, `planOfModules` y pilar de cada interruptor (`src/lib/platform-modules.ts`).
- [x] Pruebas unitarias, de BD y guiones E2E actualizados.
- [ ] Fase 2: Diagnóstico de conversaciones; límite de agentes por plan; persistir el plan.
