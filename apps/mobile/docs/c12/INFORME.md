# Dashfort Mobile · C12

Versión 0.2.3, versionCode 14, paquete `com.demfort.dashfort.dev`. Base C10
`877646e5`. Solo `apps/mobile`; sin cambios de servidor ni migraciones.

## Qué cambió

- **Ver (sin bandera):** el historial de Clientes se lee con `reactions`
  (`direction`, `emoji`) y `replyTo` (`id`, `direction`, `type`, `preview`).
  Si faltan o vienen mal, quedan vacíos y el chat no se rompe. La cita se
  muestra sobre la burbuja y sigue saltando al mensaje original si está
  cargado. Las reacciones se muestran bajo la burbuja con «Cliente» o
  «Equipo». `message.reaction` se añadió a los eventos que recargan el chat
  abierto (`message.new` ya recargaba).
- **Citar (exige `EXPO_PUBLIC_ALLOW_SEND=true`):** mantener pulsado un mensaje
  abre «Responder» y el selector de reacciones. La cita aparece sobre el
  campo de texto y se puede quitar. El envío usa la misma ruta y el mismo
  bloqueo de siempre con `{ text, replyToMessageId }`. `replyApplied: false`
  muestra «Enviado sin cita». El 409 `window_closed` conserva «Enviar
  plantilla».
- **Reaccionar (exige la bandera):** 👍 ❤️ 😂 😮 😢 🙏 y «Más»; «Quitar mi
  reacción» envía emoji vacío. Un toque es una petición. Con 409
  `reaction_pending`, error de red o 5xx el historial se recarga y se avisa
  que se revise antes de reintentar.
- **Mi número (exige la bandera):** ya se puede contestar texto con la ruta
  web existente `POST /api/my-number/chats/{id}/messages` (`{ text }`). La
  app usa Bearer, que el servidor ya convierte a sesión. No hay adjuntos.

## Lista blanca (crece exactamente en dos rutas, con la bandera)

| Método | Ruta |
| --- | --- |
| PUT | `/api/conversations/{id}/messages/{messageId}/reaction` |
| POST | `/api/my-number/chats/{id}/messages` |

IDs de 1 a 64 caracteres `[A-Za-z0-9_-]`. El POST de Clientes solo añade el
campo opcional `replyToMessageId` con la misma forma.

## Pruebas

`npm run typecheck`, `format:check`, 713 pruebas (8 nuevas en
`tests/c12-remote.test.ts`) e inventario 158/158. Dos pruebas anteriores se
actualizaron porque afirmaban que Mi número era solo lectura.

## Qué NO se probó

- Nada contra el servidor real ni WhatsApp real. No hay prueba física.
- Las capturas son de los componentes reales (`RemoteTimeline`,
  `RemoteMessageActions`, `ReplyQuoteBar`) con datos ficticios en
  React Native Web. En web la lista invertida sale de cabeza por una rareza
  conocida de RN Web; en las capturas se corrigió solo esa inversión con
  una línea de estilo del navegador, no del código.
- La pantalla completa remota no corre en web, así que no hay captura de ella.

## Riesgos

- La reacción necesita un mensaje con identificador de Meta; si no lo tiene, el
  servidor la rechaza y se muestra su mensaje.
- Mantener pulsado puede chocar con la selección de texto en algunos
  teléfonos; por eso hay acción accesible «Responder o reaccionar».

## Cómo revertir

Quitar este commit. No hay migración ni cambio de servidor.

## Checklist de prueba física para Fer

1. Con un cliente de prueba, enviar una reacción y una cita desde WhatsApp y
   ver que aparecen en la app.
2. Mantener pulsado un mensaje del cliente → Responder → enviar: llega citado.
3. Reaccionar con 👍, cambiar a ❤️ y quitarla.
4. Abrir Mi número, contestar un chat propio y ver el mensaje en WhatsApp.
