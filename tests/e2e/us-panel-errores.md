# Guion E2E — El panel de la Bandeja no falla en silencio

> Automatizado en `scripts/e2e-panel-perdido.mjs` (`pnpm test:e2e:panel`,
> navegador real con Playwright, app viva con los mocks).

Antes, el panel de detalles de la Bandeja tragaba todo error de red o de la
API (`.catch(() => null)`). El caso visible: mover un lead a **Perdido**
desde el panel no hacía nada, porque la API exige el motivo de pérdida
(422 `loss_reason_required`) y el panel lo escondía.

1. En la Bandeja, con un contacto que tiene lead en etapa abierta, elegir la
   etapa perdida en «Etapa del pipeline» → se abre «¿Por qué se perdió?».
2. **Camino infeliz:** si el servidor falla al mover, el panel muestra
   «No se movió la etapa: …» y la etapa regresa a la anterior.
3. **Camino feliz:** con un motivo, el lead queda en Perdido en la BD y
   sigue así al recargar, sin avisos de error.

También se muestran (en vez de callarse) los fallos al cargar el contacto o
las etapas, al refrescar en vivo, al guardar la ficha, al guardar las notas
(y se confirma «Guardadas») y al consultar quién responde. Si el contacto no
se pudo cargar, las notas quedan deshabilitadas: guardar sobre un campo
vacío por error borraría las que había.
