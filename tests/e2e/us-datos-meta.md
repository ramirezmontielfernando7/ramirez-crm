# US — Datos de Meta (Campañas v2, PR 1)

Automatizado en `scripts/e2e-datos-meta.mjs` (`pnpm test:e2e:datos-meta`).
App viva con los mocks; con `META_APP_ID=<dígitos>` se recorre también el
camino de la imagen en el encabezado.

1. **Estados.** El CRM responde un mensaje; el mock manda `sent` (con
   `pricing`), `delivered` y un `failed` 131049 tardío → el mensaje queda
   `delivered`, con las horas de Meta y el `pricing` guardado. Otro mensaje
   `sent` → `failed` 131049 → queda fallido con código y motivo en español,
   visible en la bandeja.
2. **Bajas.** Respuesta automática apagada por defecto. «¡BAJA!» → opt_out,
   en la línea de tiempo, sin respuesta. «no me des de baja porfa» → nada.
   Con la respuesta encendida, «Stop» → opt_out y la respuesta sale. El
   botón «Detener promociones» de una plantilla → opt_out y entra a la
   bandeja como texto. Ajustes no deja guardar la función encendida sin
   palabras (422).
3. **Salud del número.** Número nuevo: sin lectura de hoy. «Actualizar» →
   GREEN, límite 1000. Otra vez antes de un minuto → 429. Meta rechaza los
   campos nuevos → se lee con el conjunto mínimo; calidad RED y número
   FLAGGED → alertas de calidad baja, caída y estado. Webhook de calidad →
   límite 250 sin borrar la calidad. Webhook de cuenta → alerta. Evento de
   una WABA ajena → guardado como sin ruta.
4. **Plantillas.** Cinco plantillas existentes en la WABA → las cinco se
   importan (páginas de 2) con componentes; la pausada no es enviable y
   enviarla da 422 con motivo; la de video tampoco; la segunda
   sincronización no cambia nada. Crear con encabezado, pie, botones y
   ejemplos → 201 con 4 componentes; sin ejemplo → 422; el contrato anterior
   (solo cuerpo) sigue funcionando. Con `META_APP_ID`: crear con imagen →
   aprobada → enviar lleva la imagen; sin ella, 422 con la explicación.
   Webhook PAUSED → no enviable con motivo. Webhook de categoría → aviso.
5. **Interfaz.** Ajustes → Plantillas muestra el aviso de categoría y
   «Entendido» lo quita; el formulario pide el ejemplo de {{1}}. Ajustes →
   WhatsApp muestra la salud del número y las bajas; el aviso global de
   salud aparece.
