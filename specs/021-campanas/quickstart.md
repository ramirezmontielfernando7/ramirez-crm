# 021 — Quickstart: mandar una promoción a una base importada

1. **Encender Campañas** (una vez): variable `CAMPAIGNS=on` en la plataforma
   de hosting (runtime) y redesplegar. Opcional: `CAMPAIGN_SEND_RATE` (10 por
   defecto).
2. **Plantilla**: Configuración → Plantillas → crear (categoría MARKETING
   para promociones) y esperar a que Meta la apruebe (Sincronizar).
3. **Importar la base**: Contactos → Importar. Si el negocio tiene
   constancia de que sus clientes aceptaron mensajes, agrega la columna
   `waConsent` = `opt_in` y `waConsentSource` (de dónde). Sin ella entran
   como «Sin confirmar» y **no** recibirán la campaña.
4. **Campaña**: Campañas → Nueva → plantilla → etiqueta `Import: …` →
   variables → Revisar → Confirmar.
5. **Resultado**: el detalle muestra el avance en vivo; al final descarga el
   CSV de fallidos para el cliente.

Antes de mandar a una base grande revisa en el Administrador de WhatsApp el
**límite diario de destinatarios** del número (250 / 1K / 10K…): Meta lo
impone aparte del ritmo por segundo, y mandar a más gente de la que permite
frena el número.

Desarrollo / self-test: `WA_MOCK_ENABLED=true`, `CAMPAIGNS=on`,
`CAMPAIGN_BACKOFF_SCALE=0.01`, `pnpm dev`, luego `pnpm test:e2e:campanas`.
