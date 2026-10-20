# 043 — Operación 1, PR 2: apagado limpio

**Carril**: ligero. **Sin migraciones.** Diagnóstico (Fase 1) y respuestas
del dueño aprobados el 2026-10-20. El PR 1 (respaldos) está en `spec.md` de
esta carpeta.

## Problema (lo que pasaba antes)

Un despliegue de Coolify detiene el contenedor viejo con SIGTERM y, si no sale
a tiempo, lo mata con SIGKILL.

1. **La señal no llegaba a Node.** El PID 1 era la shell de
   `sh -c "node migrate.mjs && node server.js"`; una shell en PID 1 no
   reenvía SIGTERM. El contenedor siempre moría por SIGKILL.
2. **Aunque llegara, Next se colgaba**: su manejador espera a que se cierren
   TODAS las conexiones, y las SSE de `/api/events` nunca se cierran solas.
3. Consecuencias del corte brusco:
   - **Campañas**: un destinatario a media llamada a Meta quedaba «fallido,
     interrumpido» (no se reintenta para no duplicar). Y si el despachador
     nuevo arrancaba antes de 2 min (lo normal), ese reclamo NO se recuperaba
     nunca: la campaña se quedaba `sending` para siempre y el despachador
     giraba en vacío (demostrado con `tests/db/apagado-campanas.test.ts`
     antes del arreglo: se cuelga).
   - **Webhooks**: se acusa 200 a Meta y se procesa después (`after()`); si
     el corte caía en medio, el mensaje se perdía (Meta no lo reenvía).
   - **Turnos del agente**: el que esperaba su ventana de 6 s o corría se
     perdía; el cliente no recibía respuesta.
   - **Llamadas a Meta sin tope**: una colgada bloqueaba al despachador.

## Comportamiento observable

1. **La señal llega**: `tini -g` es el PID 1 y `exec node server.js`
   reemplaza a la shell. `NEXT_MANUAL_SIG_HANDLE=true` (en la imagen) apaga el
   manejador de Next; el nuestro (`src/server/shutdown.ts`) se instala al
   arrancar (`instrumentation.ts`). Sin la variable nada cambia
   (`next dev`, `next start` a mano).
2. **Al recibir SIGTERM** (tope `SHUTDOWN_GRACE_MS`, 25 s, dentro del «Stop
   grace period» de Coolify, 30 s por defecto):
   - `/api/health` responde 503 `shutting_down`;
   - el programador de campañas se detiene y no arranca despachadores; cada
     despachador termina SOLO el envío en curso, cierra su reclamo y suelta la
     concesión del número (el contenedor nuevo sigue de inmediato);
   - los webhooks se siguen aceptando y su procesamiento se espera
     (`beginTask`); con menos de 10 s de tope por delante responden **503**
     (Meta reintenta y le llega al contenedor nuevo): nunca un 200 sin
     procesar;
   - los turnos del agente que esperaban su ventana se ADELANTAN (se corre ya
     el callback del temporizador, leyendo el mapa de `globalThis` sin tocar
     `pipeline.ts`) y se espera a que terminen;
   - espera un mínimo de 3 s (peticiones HTTP en vuelo), cierra los dos pools
     de la base y sale con 0.
   Lo que no alcance lo retoma el contenedor nuevo como antes.
3. **Reclamos abandonados** (corte brusco, OOM): el despachador también los
   busca mientras espera (cada 60 s), no solo al arrancar.
4. **Tope de 20 s por llamada a Meta** (`graphRequest`, `META_TIMEOUT_MS`).
   Un tiempo agotado NO es «Meta caído»: el mensaje pudo salir. En campañas
   se trata como «interrumpido»: destinatario fallido, SIN reintento, y la
   reserva del mensaje se conserva fallida («no se sabe si llegó») en vez de
   borrarse. En la Bandeja el envío responde 503 con ese mismo texto.
5. Healthcheck de la imagen: `start-period` 90 s (migraciones pesadas).
   docker compose (Ruta B): `stop_grace_period: 40s`.

## Pruebas

- Unitarias `tests/unit/apagado.test.ts`: orden detener → esperar → cerrar
  pools → salir 0; mínimo de espera; tope con lo pendiente nombrado; señal
  repetida; corte de webhooks; adelantar turnos; espera del mapa de turnos;
  instalación solo con la variable; tope de Meta (servidor que nunca
  responde) vs. error de red; clasificación sin reintento; la reserva no se
  borra; el Dockerfile (tini, exec, variable).
- BD real `tests/db/apagado-campanas.test.ts`: SIGTERM a media llamada →
  3 enviados, 9 pendientes, nada `sending`, concesión libre; el nuevo termina
  los 12 sin duplicar. Reclamo «joven» abandonado → se recupera esperando y
  la campaña termina (sin el arreglo, la prueba se cuelga).
- E2E `scripts/e2e-apagado.mjs` (CI, job e2e): `server.js` standalone,
  SIGTERM real a mitad de una campaña (wa-mock lento), 503 en salud, webhook
  durante el apagado acusado Y guardado, salida 0 en ~3 s, retoma sin
  duplicados, y Meta colgado 25 s → fallido sin reintento (el mock lo recibió
  una vez).
- Imagen (`imagen.yml`, job `apagado`): con la imagen real, PID 1 = tini,
  Node hijo directo, `docker stop` → código 0 en < 26 s y el log
  «apagado limpio terminado».

## Para el operador (Coolify)

- **Stop grace period**: app → **Advanced** → «Stop grace period (seconds)».
  Por defecto 30; recomendado **40** para tener margen sobre los 25 s de la
  app. Si lo bajas, baja también `SHUTDOWN_GRACE_MS` (siempre unos 5 s menos).
- En los logs del contenedor viejo, al desplegar, debe aparecer
  `[apagado] apagado limpio terminado … a_tiempo=true`.

## Riesgos y límites

- Las conexiones SSE se cortan al salir; el navegador se reconecta solo y se
  pone al día (`since=`). No se tocó el bus ni la ruta de eventos.
- Adelantar turnos usa `_onTimeout` del temporizador de Node (interno pero
  estable desde siempre). Si no existiera, el turno vence solo (≤ 6 s).
- Durante un despliegue con dos contenedores, el arranque del nuevo marca
  como fallidas las corridas del Laboratorio que el viejo aún termina
  (`cleanupOrphanRuns`). Menor; queda anotado.

## Pendientes

- **Retoma duradera de los turnos del agente al arrancar** (de `spec.md`):
  exige tocar `src/server/ai/pipeline.ts`; va en un PR aparte cuando la otra
  sesión termine.
