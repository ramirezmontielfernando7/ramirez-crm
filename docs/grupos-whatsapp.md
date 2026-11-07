# Grupos de WhatsApp en la Bandeja

Los grupos pertenecen a la conexión directa del número de la empresa (Evolution
API). Meta no admite grupos. El chip **Grupos**, después de **Campañas**, aparece
cuando está habilitado el complemento de conexión directa y muestra cuántos
grupos tienen mensajes sin leer. También funciona en modo híbrido.

El grupo se identifica por su JID `@g.us`, separado del teléfono de sus
participantes. Evolution entrega el título del grupo; cada mensaje conserva el
nombre o número de su autor. Se admiten texto, imágenes, audio y documentos.
Los mensajes enviados desde el celular se registran sin duplicar los del CRM.

Se utiliza el compositor habitual: texto, respuestas rápidas, mejorar redacción,
conocimientos y adjuntos. Todo envío exige una acción manual. Los grupos nunca
activan agentes automáticos, aunque exista un turno antiguo en cola, ni son
público de campañas. Si el dispositivo está desconectado o pausado, el envío
falla con el aviso habitual; nunca intenta utilizar Meta.

La asignación y las etiquetas pertenecen al contacto del grupo y usan las mismas
puertas y permisos que un chat normal. Un asesor solo ve grupos asignados o en
los que participa. La migración `0074_grupos_whatsapp` amplía `contact` y `message`:
ambas conservan sus políticas de RLS forzado por organización. El número privado
de una persona y el chat interno de Equipo siguen usando sus propias bandejas;
los grupos de esos números privados no se importan a la Bandeja de la empresa.

Validación nueva: `pnpm exec vitest run tests/unit/whatsapp-groups.test.ts` y,
con una base aislada cuyo nombre termine en `_test`,
`pnpm exec vitest run -c vitest.db.config.ts tests/db/whatsapp-groups.test.ts`.
