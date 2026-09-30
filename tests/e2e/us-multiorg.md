# Guion E2E — Dos organizaciones en una instancia (Fase 1 multitenant)

Automatizado en `scripts/e2e-multiorg.mjs` (`pnpm test:e2e:multiorg`). En CI
corre en cada PR hacia `main` (job `e2e-multiorg`), dos veces: sin y con
`PLATFORM_ORG_ID`.

## Preparación
1. App viva con mocks (`WA_MOCK_ENABLED=true`, wa-mock y ai-mock), `CAMPAIGNS=on`, `AGENDA=on`.
2. Organización A = la de `e2e@vocero.test`. La organización B la crea el
   script por SQL (slug `e2e-multiorg-b`); las cuentas de ambas se dan de alta
   con la API del equipo y el script mueve las de B a B.

## Historia
1. B siembra un recurso de cada tipo: contacto, conversación, mensaje,
   adjunto, lead, etapa, etiqueta, conocimiento, base del agente, plantilla,
   campaña, cita, grupo y mensaje del chat de equipo, miembro.
2. **SSE**: el Propietario, el Coordinador y el Asesor de A escuchan
   `/api/events` mientras B recibe un mensaje, escribe en su chat de equipo y
   anota una nota. A no recibe ni un id de B (y B sí, para que el detector
   no esté ciego).
3. **API**: cada rol de A pide, edita, borra y envía sobre los ids de B →
   `404` (o `403` si su rol no tiene el permiso, antes de buscar), sin ningún
   dato de B en el cuerpo. **Cruces**: colgarle a un recurso de A algo de B
   (etiqueta, plantilla, conocimiento, etapa, participante, contacto de una
   cita, miembro de un grupo) → 4xx.
4. **Enumeración**: todos los listados, búsquedas, export y analíticas de A
   sin un solo id ni texto de B.
5. **Integridad**: la huella (conteo + md5 de cada tabla con
   `organization_id`) de B es idéntica antes y después de todos los ataques.
6. **Webhook**: un entrante al número de B con el teléfono de un cliente de A
   no cambia nada de A y sí queda en B.
7. **H2**: una llave del cerebro externo creada para B (script de operador)
   ve B y da 404 con A; revocada, 401. La `BOT_API_KEY` de la plataforma
   jamás ve B.
8. **H4**: un usuario con una membresía extra más nueva sigue en su
   organización original.
9. **H7**: el Propietario de B no recibe el token del webhook
   (`managedByPlatform: true`); solo la organización `PLATFORM_ORG_ID` lo ve.
   Sin la variable, nadie lo ve y la pantalla avisa (`platformConfigMissing`).
10. **H11**: `/login` y `GET /api/settings/branding` sin sesión no muestran la
    marca de ningún cliente; con sesión, cada quien ve la suya.
11. **H13**: dar de alta el correo de alguien de otra organización → `422`
    genérico (sin "existe"); de alguien de mi equipo → `409`.
