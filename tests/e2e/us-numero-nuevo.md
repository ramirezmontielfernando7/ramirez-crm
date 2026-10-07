# US — «Número no registrado» en la búsqueda de la Bandeja

Automatizado en `scripts/e2e-numero-nuevo.mjs` (`pnpm test:e2e:numero-nuevo`,
paso «e2e de número no registrado» del CI). Pruebas contra Postgres real:
`tests/db/numero-nuevo.test.ts`.

## Guion (a mano)

1. Bandeja → buscar un texto que no es teléfono («Juan»): sale el mensaje de
   siempre. Buscar un teléfono que nadie tiene (`55 1234 5678`): sale la
   tarjeta «Este número no está registrado» con `+52 55 1234 5678`.
2. **Registrar contacto**: popup corto (teléfono, nombre opcional, etapa,
   asignación solo para quien reparte). Sin nombre, el contacto se ve con su
   teléfono. Buscar el mismo número con otro formato (`+52 1 55…`) NO lo
   duplica: abre el que ya existe.
3. **Abrir chat**: conversación vacía; el cuadro de escribir muestra «La
   ventana de 24 horas está cerrada» y solo ofrece plantillas.
4. **Enviar mensaje**: aviso de WhatsApp; «No lo sé» no deja enviar; «Sí,
   aceptó» deja elegir una plantilla APROBADA (con vista previa y variables).
   Al enviar, abre el chat. El contacto queda con consentimiento
   «acepta mensajes» y la línea de tiempo lo anota.
5. Quien pidió la baja (`opt_out`): solo Propietario o Coordinador
   (`contacts.consent_override`) pueden enviarle, y queda registrado.
6. En celular el popup sube desde abajo y cabe en la pantalla.
