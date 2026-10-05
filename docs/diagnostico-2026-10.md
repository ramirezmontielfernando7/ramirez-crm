# Diagnóstico general de Dashfort (octubre 2026)

- Fecha: 2026-10-05 · Base: `main` en `e3203fc` (merge del PR #39).
- Alcance: revisar que todo esté en orden antes de seguir construyendo, con
  pruebas reales (no solo lectura de código), y listar lo que hay que saber
  para el objetivo de negocio: vender Dashfort como CRM para negocios y
  convertir a Demfort en Tech Provider de Meta.
- Método: los cuatro gates del proyecto, las pruebas con Postgres real, todas
  las E2E de `scripts/e2e-*.mjs` contra la app viva con los mocks, y un
  recorrido manual con navegador por cada pantalla.

## 1. Veredicto

El proyecto está sano. Compila, pasa sus pruebas y la arquitectura es sólida
(multi-organización con RLS, credenciales cifradas, permisos en servidor,
módulos por organización). En el recorrido salieron dos defectos reales y
quedaron corregidos en esta rama (sección 3). Lo que falta para venderlo como
servicio y para ser Tech Provider es producto nuevo, no reparaciones
(sección 4).

## 2. Pruebas corridas

| Prueba | Resultado |
|---|---|
| `pnpm typecheck` | OK |
| `pnpm lint` | OK |
| `pnpm test` (unitarias) | 1401 OK · 1 omitida a propósito (pide `TEST_DB`) |
| `pnpm test:db` (Postgres real, migraciones ×2, aislamiento, RLS) | 159/159 OK |
| `pnpm build` | OK |
| E2E: ver el detalle en la ficha técnica publicada | Todas en verde salvo lo explicado abajo |

Fallos de E2E que **no** son defectos del producto:

- `e2e-selftest`: 5 comprobaciones del conector Zoom fallaron porque el `.env`
  de la prueba no apuntaba `ZOOM_BASE_URL`/`ZOOM_OAUTH_BASE_URL` al mock y la
  app intentó hablar con zoom.us. Con las variables del quickstart de la spec
  015 pasan. Mejora sugerida: que el guion omita esos checks si las variables
  no apuntan al mock, igual que ya hace cuando el mock no responde.
- `e2e-modulos`: un `socket hang up` a mitad del guion. Es el reinicio por
  memoria de `next dev` que el CI ya documenta (por eso el CI arranca un
  servidor nuevo por grupo). Con servidor recién arrancado pasa.

## 3. Corregido en esta rama

1. **Selector de asignación del panel de Detalles** (`src/components/assignment/assignment-card.tsx`,
   `src/components/inbox/contact-panel.tsx`, `src/components/pipeline/lead-drawer.tsx`).
   - Mientras cargaba la lista del equipo, un chat asignado se veía como
     «Sin asignar» (y se quedaba así si esa petición fallaba).
   - Al cambiar de chat, las tarjetas del panel conservaban los datos del chat
     anterior hasta que llegaban los nuevos, y una respuesta lenta del chat
     anterior podía pintarse sobre el actual. Se vio en vivo: Carlos (de Sofía)
     apareció asignado a Diego. En Etiquetas el riesgo era mayor, porque
     guardar etiquetas manda el conjunto completo.
   - Arreglo: las tarjetas que cargan datos del contacto (asignación,
     participantes, etiquetas y consentimiento, actividad) se montan de nuevo
     por contacto, y el selector muestra «Cargando…» o el nombre del asignado
     en lugar de «Sin asignar» mientras llega la lista.
2. **`docker-compose.yml` (Ruta B) no pasaba variables al contenedor**:
   `CAMPAIGNS`, `CAMPAIGN_SEND_RATE`, `META_APP_ID`, `AI_DEFAULT_MONTHLY_*` y,
   lo más importante, `ENCRYPTION_KEY_VERSION`/`ENCRYPTION_KEY_OLD`/
   `ENCRYPTION_KEY_OLD_VERSION`. Sin estas últimas, la rotación de la llave de
   cifrado que describe `docs/credenciales.md` no funcionaba con docker
   compose. Coolify (Ruta A) no estaba afectado.

## 4. Lo que hay que saber antes de continuar

Ordenado por impacto en el objetivo de negocio.

1. **Tech Provider: falta el Embedded Signup dentro del producto.** Hoy el
   token de WhatsApp se pega a mano (modo directo o «modo agencia»). Para que
   un cliente conecte su número solo hace falta: negocio verificado en Meta,
   App Review con acceso avanzado a `whatsapp_business_management` y
   `whatsapp_business_messaging`, el flujo `FB.login` con `config_id`, el
   canje del código por token, suscribir la app a la WABA y registrar el
   número. La base ya ayuda: credenciales por organización y cifradas, ruteo
   de webhooks por número y WABA, una sola app de Meta para todos. Ver la
   sección 3.11 de `docs/diagnostico-multitenant.md` y las skills
   `whatsapp-saas-meta-infra` y `whatsapp-meta-app-review`.
2. **No hay páginas públicas** (landing, privacidad, términos, instrucciones de
   borrado de datos) ni callback de deauthorize/data-deletion. Meta las pide
   para la revisión de la app. `/` solo redirige a `/inbox`. Existe el
   subagente `public-site-builder` para esto.
3. **Una organización = un número de WhatsApp** (índice único
   `meta_credentials_org_uq`). Si un cliente tiene varios números en su WABA,
   hay que decidir el modelo antes del Embedded Signup.
4. **Sin correo electrónico.** No hay «olvidé mi contraseña» ni invitaciones:
   las cuentas se crean con contraseña temporal y los restablecimientos los
   genera el administrador de plataforma. Es una decisión de la constitución
   (soberanía); para un SaaS con muchos clientes conviene un conector de
   correo opcional.
5. **Sin cobro.** La facturación está fuera del núcleo por diseño. Para vender
   suscripciones, el cobro (Stripe, Mercado Pago…) va como conector opcional o
   fuera del CRM, con la suspensión de organizaciones de `/platform` como
   palanca.
6. **Una sola réplica.** El bus de tiempo real (SSE), el agrupado de turnos del
   agente, el Laboratorio y los límites de peticiones viven en memoria. Un
   servidor de 16 GB alcanza para unas ~100 organizaciones; no levantes dos
   réplicas de la app sin antes mover el bus a `LISTEN/NOTIFY` de Postgres.
   Las campañas sí están listas para varias réplicas (concesión por número).
7. **Herramientas sin pantalla**: la cuota de IA por organización y las llaves
   del bot externo solo se manejan por scripts (`scripts/ai-quota.mjs`,
   `scripts/bot-key.mjs`); Instagram no tiene pestaña en Ajustes (solo API).
8. **Huecos de producto menores**: no se graban notas de voz (el audio solo se
   adjunta como archivo); Contactos importa CSV pero no `.xlsx` (Audiencias de
   Campañas sí); las citas manuales solo se crean por API (la pantalla crea
   bloqueos).
9. **Origen del código**: es un fork de Vocero CRM (MIT, © Kevin Belier).
   Puedes rebautizarlo y venderlo, siempre que conserves el aviso de
   copyright de `LICENSE`. El README, la insignia de CI y los enlaces aún
   apuntan a `kevinrivm/vocero-crm`; los nombres internos (`vocero_app`,
   cookies `vocero-*`) conviene dejarlos como están.
10. **Dependencias**: `pnpm audit` reporta 8 avisos (1 crítico), todos en
    herramientas de desarrollo (vitest, vite, esbuild) que no viajan en la
    imagen de producción. Conviene actualizar vitest a 4.x en una tarea
    aparte.
11. **Endurecer al salir a producción**: HSTS está en 1 día y la CSP solo en
    modo reporte. Súbelos cuando la instancia esté estable (`src/lib/security/headers.ts`).
12. **Detalles**: el compose usa `postgres:16` y el CI `postgres:18` (conviene
    alinearlos); los botones del selector de emojis no tienen nombre
    accesible (`aria-label=""`); en Resultados, un trato cargado directo en la
    etapa «Cliente» (sin moverlo) no cuenta como ganado, porque se mide el
    cambio de etapa. Tenlo en cuenta al importar históricos.
