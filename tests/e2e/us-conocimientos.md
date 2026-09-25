# Guion E2E — Conocimientos

> Automatizado en `scripts/e2e-conocimientos.mjs` (`pnpm test:e2e:conocimientos`,
> app viva en `pnpm dev` con los mocks, después de `pnpm test:e2e` y
> `pnpm test:e2e:roles`). Con `SHOTS_DIR=<carpeta>` guarda capturas.
> Spec: [024](../../specs/024-conocimientos/spec.md). Re-ejecutable.

Tres personas: propietario, coordinadora y asesor A.

1. **Crear y permisos.** El propietario crea una entrada de texto (JSON) y
   otra solo con imagen; la coordinadora una con PDF (multipart). Sin texto
   ni archivo → 422. El asesor: crear, editar y borrar → 403.
2. **Ver y buscar.** El asesor lista (200), encuentra por contenido, por
   título sin acentos y por etiqueta, y descarga el PDF. Un `.html` subido se
   sirve como `octet-stream` + `attachment` + `nosniff`.
3. **Editar.** La coordinadora edita etiquetas (200); quitar el único
   contenido → 422.
4. **Enviar (API).** Al chat ajeno el asesor → 404; asignado → 201 y el
   texto aparece en el hilo. Una entrada sin texto en modo texto → 422.
5. **Navegador.** Conocimientos justo después de Contactos; la lista; crear
   con PDF desde el diálogo; la búsqueda filtra. El asesor ve la página sin
   crear/editar/borrar. En el chat: `/` abre el buscador (sin escribir el
   `/`), "Enviar archivo" manda el PDF con el pie; el libro + "Insertar"
   pone el texto en el editor; "Enviar texto" llega al hilo; Esc cierra.
6. **Borrar.** Desde la UI (con confirmación) y por API (204); el archivo
   borrado ya no se sirve (404). Sin errores de página.
