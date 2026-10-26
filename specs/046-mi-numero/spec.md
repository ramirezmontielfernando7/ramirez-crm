# 046 — Mi número (el WhatsApp de cada persona)

Plan y decisiones de Fer (26 oct 2026): documento «Plan «Mi número»: un
WhatsApp por vendedor» del proyecto, con su maqueta aprobada (ajustes del
asesor, aviso en el chat y solicitud para ver un chat).

Además del número de la empresa, cada persona autorizada vincula SU WhatsApp
(conexión directa, QR) y atiende sus chats desde la Bandeja. Complemento
OCULTO sobre la conexión directa (045): solo /platform lo enciende y fija el
tope de números por organización.

## Reglas de producto

- **Chats separados por número, un solo contacto.** Un cliente que escribe al
  número de la empresa y al de Ana tiene dos chats, pero una sola ficha.
- **Aislado por defecto.** Un número `personal` es solo de su dueño: nadie
  más ve sus chats (ni el Coordinador, ni el Propietario, ni la plataforma) y
  solo el dueño cambia sus cuatro interruptores, que nacen APAGADOS:
  1. Compartir mis clientes con la empresa (botón «Es cliente»; solo lo
     marcado pasa al CRM).
  2. Avisar que también hablo con este cliente («También habla con…», sin
     contenido; solo en chats de cliente; parejo: apagado tampoco ve los de
     otros).
  3. Permitir solicitudes para ver mis chats (solo lectura, por chat, se
     retira cuando quiera; queda en «Quién ha visto tus chats»).
  4. La IA contesta mis chats (solo chats de cliente).
- Un número `empresa` (chip de la empresa): el dueño y los coordinadores ven
  sus chats; los ajustes los decide el Coordinador o el Propietario. Pasar de
  `personal` a `empresa` necesita el OK del dueño.
- Autoriza el Propietario o un Coordinador; la persona escanea su QR.
- Si la persona se va: los chats marcados como cliente se quedan con la
  empresa (se reasignan); los privados se borran de Dashfort. Lo acepta en el
  aviso al vincular.
- Campañas y plantillas nunca salen por un «Mi número». Grupos de WhatsApp no
  entran. Límites anti-bloqueo y freno de emergencia por número.

## PR 1 — Datos (este PR; nada visible)

Migración `0057_mi_numero` (idempotente; reversa `scripts/sql/0057-reversa.sql`):

- `direct_number`: el «Mi número» de una persona (`user_id`, `kind`
  personal/empresa, `label`, los cuatro interruptores en false,
  `notice_accepted_at`, `authorized_by`, `revoked_at`). Uno vivo por persona.
- `direct_connection.direct_number_id`: NULL = la conexión de la EMPRESA (una
  por organización: `direct_connection_org_company_uq`, antes
  `direct_connection_org_uq`); con valor, una por número.
- `conversation.direct_number_id`: NULL = chat del número de la empresa (uno
  por contacto: `conversation_org_contact_company_uq`, antes
  `conversation_org_contact_real_uq`); con valor, uno por número y contacto.
  `client_marked_at/_by` = «Es cliente».
- `contact.private_to_number_id`: el contacto nació en un chat privado (no es
  del CRM; solo lo ve el dueño del número).
- `conversation_access` (solicitudes y permisos para ver un chat ajeno) y
  `conversation_access_log` (quién vio qué). RLS en las tres tablas nuevas;
  FK compuestas con `organization_id`.
- `organization_module.mi_numero` (requiere `conexion_directa`) y
  `mi_numero_max` (0–200).

Código: lo de hoy queda blindado para que solo use lo de la EMPRESA:

- `companyChat()` (`src/lib/db/tenant.ts`) = `is_test = false` y sin número:
  reemplaza a `is_test = false` en listas, conteos, reportes, tablero y la
  búsqueda del chat de un contacto. `getConversation`/`updateConversation`
  no abren un chat de número.
- `src/server/credentials/direct.ts`, `direct-instance.ts`, `brake.ts` y el
  aviso de desconexión leen y escriben solo la conexión de la empresa; el
  webhook y la revisión de cada 5 minutos ignoran las de los números.
- Módulos: `miNumero`/`miNumeroMax` en `OrgModules`; `resolveMiNumero`
  (apagar la conexión directa apaga «Mi número»).

Riesgo conocido: la imagen ANTERIOR no puede vincular una conexión de empresa
nueva con este esquema (su ON CONFLICT buscaba el índice viejo). Si se
revierte el código, correr también la reversa.

## Siguientes PRs (sin migración)

2. /platform: interruptor, tope y capacidad de los servidores.
3. «Mi número»: autorizar personas (Coordinador/Propietario), QR, tipo,
   estado, desvincular, aviso aceptado, los cuatro interruptores con su
   explicación; pestaña «Mi número» en la Bandeja.
4. Entrada: lo que llega a un número va a su chat y a contactos privados;
   «Es cliente».
5. Salida: por el número correcto, límites y freno por número.
6. Privacidad: «También habla con…», solicitudes, bitácora; salida de una
   persona.
