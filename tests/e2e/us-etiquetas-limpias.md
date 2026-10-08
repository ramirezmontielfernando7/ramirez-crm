# US — Etiquetas limpias

Guion automatizado: `scripts/e2e-etiquetas-limpias.mjs` (`pnpm test:e2e:etiquetas`).

1. **La automática es de sistema.** Importar una base en Campañas → Audiencias
   con una etiqueta propia. El catálogo público (`GET /api/contact-tags`) trae
   solo la propia; `?system=only` trae la automática «Import: archivo» marcada;
   Audiencias sigue mostrándola.
2. **Contacto.** Muestra solo la etiqueta elegida. Guardar sus etiquetas (aunque
   sea vacías) NO borra la automática. El CSV de contactos la sigue llevando.
3. **Fusión (reglas).** Destino de sistema → 409; origen = destino → 422; destino
   inexistente o de otra organización → 404; el Asesor → 403 (también el GET del
   impacto).
4. **Interfaz.** Bandeja: la cápsula muestra la elegida (no «Import: …») y sin
   «+1». Ajustes → Etiquetas: la lista pública no trae la automática; la sección
   plegada «Automáticas de importación (N)» al abrirse muestra la automática
   sin renombrar; «Fusionar» pide el destino (solo etiquetas normales) y muestra
   la confirmación (contactos que pasan, los que ya la tenían, bases de
   Audiencias que cambian, «No se puede deshacer»); tras «Sí, fusionar» la
   automática desaparece, el destino suma los contactos y Audiencias muestra el
   destino.

Fuera del guion (BD real, `tests/db/etiquetas-limpias.test.ts`): relleno de la
migración 0041 (solo las enlazadas por `audience_import.tag_id`, idempotente),
fusión sin duplicados con línea de tiempo y aislamiento entre organizaciones.
