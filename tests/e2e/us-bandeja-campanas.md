# Chats de campaña fuera de la Bandeja principal (041)

Automatizado: `node --env-file=.env scripts/e2e-bandeja-campanas.mjs` (app con
mocks y el módulo Campañas encendido). Spec: [041](../../specs/041-bandeja-campanas/spec.md).

## Criterios de aceptación

1. Un contacto que ya había escrito y dos nuevos reciben una campaña real.
   - Los dos nuevos NO están en la Bandeja principal; están en «Campañas» con
     el nombre de la campaña y sin no leídos.
   - El que ya escribía sigue en la principal, sin marca.
2. Con el canal SSE abierto durante el envío y los 9 ticks de estado:
   - ningún `message.status`;
   - ningún evento de los chats pendientes;
   - un solo `message.new` (el del chat activo);
   - la BD guarda «leído».
3. Uno de los nuevos responde: pasa a la principal con «Respondió a campaña
   X», con 1 no leído y su `message.new` en vivo; ya no está en «Campañas».
4. En el navegador: el filtro «Campañas» aparece junto a «Archivados»; la
   pestaña muestra al que no respondió («Campaña X · sin respuesta») y no al
   que respondió; la principal muestra la marca «Respondió a campaña X».
