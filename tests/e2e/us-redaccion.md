# Guion E2E — Asistente de redacción en el editor

> Automatizado en `scripts/e2e-redaccion.mjs` (`pnpm test:e2e:redaccion`, app
> viva en `pnpm dev` con los mocks, después de `pnpm test:e2e` y
> `pnpm test:e2e:roles`). Con `SHOTS_DIR=<carpeta>` guarda capturas.
> Spec: [023](../../specs/023-asistente-redaccion/spec.md).

1. **API.** `GET /api/writing-assist` → `available: true`. `improve` → 200
   con texto; tono sin `tone` → 422; borrador con `FALLA-IA` → 502 con
   mensaje; un Asesor también → 200.
2. **La varita.** En un chat con ventana abierta, justo a la derecha del
   clip; deshabilitada con el editor vacío; con texto se habilita.
3. **Menú.** Las cinco opciones; "Cambiar tono" despliega Formal, Casual y
   Empático.
4. **Carga.** Con la respuesta retrasada: editor en solo lectura, "La IA está
   reescribiendo…", Enviar deshabilitado.
5. **Resultado.** El texto se reemplaza (Empático) y aparece "Deshacer";
   Deshacer devuelve el original. "Mejorar redacción" también reescribe.
6. **Fallo.** Con `FALLA-IA`: error visible, el texto original intacto y el
   editor editable de nuevo.
7. **Nada se envía.** El chat no tiene salientes manuales; sin errores de página.
