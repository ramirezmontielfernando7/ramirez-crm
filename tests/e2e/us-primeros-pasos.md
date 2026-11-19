# Guion E2E — Onboarding guiado («Primeros pasos» + Tutoriales)

Automatizado en `scripts/e2e-primeros-pasos.mjs` (CI, fila «agentes, navegación y trabajo»).

Contexto: una empresa nueva debe poder arrancar sola. «Primeros pasos» (en la
Bandeja, solo para el Propietario) lleva el avance de lo obligatorio
(cuenta, WhatsApp y, con agente, armarlo, publicarlo y encender la IA) y
además una lista **opcional** que se palomea sola: equipo, etapas/etiquetas,
contactos y, con el complemento, el conector de IA (ChatGPT/Claude). Ruta:
`GET /api/onboarding` (cualquier sesión; la guía solo se enseña con
`settings.manage`).

1. Empresa recién creada: `extras` = `team`, `pipeline`, `contacts`, todos sin
   hacer. Lo opcional no cuenta en el avance (solo «Activa tu cuenta» listo).
2. La dueña invita a alguien (`POST /api/settings/team`) → `team` listo.
3. Crea una etiqueta (`POST /api/contact-tags`) → `pipeline` listo. Renombrar o
   agregar etapas también cuenta (los nombres dejan de ser los de fábrica).
4. Da de alta un contacto (`POST /api/contacts`) → `contacts` listo. Los de la
   demo y los simulados del Laboratorio (archivados) no cuentan.
5. Con `organization_module.conector_ia` aparece `aiConnector`; con el conector
   aún apagado su enlace es `/settings/conector-ia` (encenderlo primero), y
   `/settings/mi-ia` cuando ya está encendido.
6. Navegador, Bandeja: la tarjeta enseña 4 renglones opcionales, el de equipo
   palomeado, y «Ocultar guía».
7. Tutoriales (`/ayuda`): «Tu avance» con la misma tarjeta (sin «Ocultar
   guía»), el tutorial «Conecta un número nuevo» (dice que el código de 6
   dígitos llega por SMS o llamada a ESE número nuevo) y el de «Conecta ChatGPT
   o Claude» solo si la empresa tiene el complemento.
8. Ajustes → WhatsApp → «Quiero un número nuevo»: aparecen los pasos («Así
   funciona»): el PIN lo inventa la persona y el código llega al número nuevo.
9. Teléfono (390 px): Tutoriales sin scroll de lado.

Con `SCREENSHOTS_DIR=<carpeta>` el guion guarda las capturas de cada pantalla.
