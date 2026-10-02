# E2E — 026 Participantes y menciones

Automatizado en `scripts/e2e-participantes-menciones.mjs`
(`pnpm test:e2e:participantes`) con la app viva (`next dev`,
`WA_MOCK_ENABLED=true`, `BOT_API_KEY`) y el servidor recién reiniciado.

1. Llegan dos chats (X, Y) por wa-mock; X se asigna a la asesora A.
2. **Participantes**: B no ve X (404); un asesor no agrega (403); la
   coordinadora suma a B (201; otra vez 200; al asignado 409; alguien de
   fuera 422); B recibe `participants.changed`, C no. B ve X (no Y), lo lee,
   responde y recibe su `message.new`; C no. La asignación sigue siendo de A.
   La línea de tiempo registra la entrada.
3. **Aviso de handoff** (por `/api/bot/handoff`): en X lo reciben A,
   coordinadora y propietario; B (participante) recibe el cambio de estado
   pero NO el aviso; C tampoco. En Y (sin asignar) lo recibe la coordinadora
   y ningún asesor.
4. **Menciones** en un grupo A·B·C: A no puede mencionar Y (422); menciona
   X; el SSE no trae id ni nombre; C la ve sin acceso y sin rastro de X
   (mensaje, historial, lista); B (participante) la ve resuelta.
   **Compañeros**: A no puede mencionar a la coordinadora (no está en el
   grupo → 422); menciona a B y a X en un mensaje: la del compañero sale con
   su nombre y en orden; a B le sube el globo de no leídos; C ve el nombre de
   B pero no el chat X; la vista previa no lleva el id de B.
5. **Navegador**: B ve la pastilla con el nombre y al presionarla abre el
   chat en la Bandeja; C ve «chat sin acceso» y la página no contiene el
   nombre; el botón @ de C abre el selector con **Compañeros** (A y B, sin la
   coordinadora ni C) arriba de **Chats de clientes**; elegir a A escribe
   `@{Nombre}`, se envía y A lo ve como mención (la suya no es enlace); al
   presionar la mención de A, C llega al **directo con A** en el chat de
   equipo (nunca a la Bandeja); a la asignada le aparece el aviso de
   atención humana.
6. **Quitar** a B: 404 en X, la mención ya le sale sin acceso y la línea de
   tiempo registra la salida.
