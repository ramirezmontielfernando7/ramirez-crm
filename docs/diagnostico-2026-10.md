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
módulos por organización). En el recorrido salieron tres defectos reales y
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
| E2E (34 guiones de `scripts/e2e-*.mjs`, app viva con mocks) | 33 en verde, 1 con un fallo de diseño (abajo) |

Detalle de E2E (última corrida de cada guion):

| Guion | Resultado | Guion | Resultado |
|---|---|---|---|
| selftest (base limpia) | 241/241 | multiorg | 284/284 |
| credenciales | 23/23 | plataforma | 64/64 |
| módulos | 62/62 | datos-meta | 62/62 |
| campañas v2 | 100/100 | navegación | 59/59 |
| roles | 92/92 | calendario | 54/54 |
| resultados | 71/71 | campañas | 73/73 |
| chat de equipo | 89/89 | participantes y menciones | 74/74 |
| conocimientos | 43/43 | redacción | 30/30 |
| línea de tiempo | 78/78 | compositor | 29/29 |
| firma del webhook | 9/9 | panel perdido | 7/7 |
| alta manual | 14/14 | anuncio de origen | 30/30 |
| bitácora de etapas | 19/19 | envío instantáneo | 12/12 |
| favicon | 23/23 | ficha del lead | 13/13 |
| messenger | 42/42 | monto | 14/14 |
| prioridad | 13/13 | búsqueda y filtros | 31/31 |
| envío fallido | 16/16 | plantillas multivariable | 21/21 |
| sincronización de plantillas | 13/13 | responsive | 53/54 |

Lo que hubo que entender para llegar ahí (ninguno era un defecto del producto):

- **Variables del entorno de prueba**: los checks de Zoom necesitan
  `ZOOM_BASE_URL`/`ZOOM_OAUTH_BASE_URL` apuntando al mock (quickstart de la
  spec 015); sin ellas la app intenta hablar con zoom.us.
- **Límite de inicios de sesión** (10 cada 10 min por IP): correr muchos
  guiones seguidos contra el mismo servidor da 429. Es la protección
  funcionando; entre guiones hay que reiniciar el servidor.
- **`next dev` se reinicia al acercarse a su tope de memoria** (ya documentado
  en el CI): corta peticiones a mitad de guion.
- **Datos acumulados**: `e2e-selftest` reutiliza el mismo teléfono y en una base
  con corridas previas encuentra la cita de la corrida anterior. En base limpia
  pasa 241/241.
- **Guiones desactualizados** tras los cambios recientes (corregidos en esta
  rama): `e2e-linea-tiempo` (barra «Panel claro» por defecto, 360 ms de los
  paneles, paneles flotantes), `e2e-favicon` (orden de clases del mosaico),
  `e2e-messenger` (firma de Meta obligatoria desde la Fase 3),
  `e2e-responsive` (fija el tema «navy» que describe), `e2e-panel-perdido`
  (otro aviso con la misma etiqueta), `e2e-compositor` y
  `e2e-envio-instantaneo` (carreras y el agente de IA encendido por otro guion).
- **Mock de WhatsApp**: los ids de los entrantes y ecos simulados reiniciaban su
  numeración al reiniciar el servidor; sobre una base con historia chocaban con
  mensajes viejos y se descartaban como duplicados (sin lead ni ventana).
  Ahora llevan un sello por arranque, igual que ya llevaban los salientes.

Único pendiente real de E2E: en `e2e-responsive`, con el tema oscuro y la
barra «navy», la barra ya no es más oscura que la página (contraste 1.08:1;
la guía R8 pedía ≥ 1.25:1). Viene del rediseño de paneles flotantes. Es una
decisión de diseño: oscurecer el navy en oscuro o actualizar la guía.

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
2. **El Laboratorio decía «Corre tu primera evaluación» mientras cargaba**,
   aunque sí hubiera corridas (`src/components/lab/lab-client.tsx`). Ahora
   dice «Cargando el historial…» hasta que llegan.
3. **`docker-compose.yml` (Ruta B) no pasaba variables al contenedor**:
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
