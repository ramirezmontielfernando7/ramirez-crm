# 037 — Grupos de documentos y fuentes por agente

**Carril**: ciclo completo. Tres PR, uno a la vez; solo el PR 1 lleva
migración. Plan aprobado por el dueño el 2026-10-08, con estas decisiones:

- **D1 (por defecto).** Un agente sin configurar lee **todos los documentos de
  la empresa, de todos los grupos**, menos los exclusivos de otros agentes.
  Etiqueta: «Todos los documentos de la empresa».
- **D2 (borrar un grupo con documentos).** El diálogo ofrece «Mover sus
  documentos a General» (por defecto) o «Eliminar también sus documentos»,
  con el aviso de cuántos documentos y cuántos agentes se ven afectados y una
  confirmación adicional si se elige eliminar. Solo eso es irreversible.
- **D3 (archivar un agente con exclusivos).** El diálogo ofrece «Eliminar sus
  documentos exclusivos» (por defecto) o «Conservarlos pasándolos a General»
  (aviso: los leerá cualquier agente con «Todos los documentos de la
  empresa»). Ambas en la MISMA transacción que archivar. Nada más del flujo
  de archivar cambia (ni el nombre del botón ni su comportamiento).
- «General» es `group_id IS NULL` (no es una fila): no se borra ni se
  renombra, y «General» es un nombre reservado.
- Los exclusivos no se versionan: aplican al momento (como el conocimiento
  propio del agente), con aviso en el editor.

## Problema

Hoy (035) todos los documentos de una organización los leen todos sus
agentes. Un negocio con agentes de ventas, cobranza o dirección necesita que
cada uno consulte solo lo suyo.

## Comportamiento observable

1. **Grupos (PR 1).** Laboratorio → Documentos se organiza en subpestañas:
   General (siempre, primera) y los grupos del negocio. El dueño
   (`agent.manage`) crea, renombra y elimina grupos (D2). Cada documento
   pertenece a un grupo y se puede mover a otro. Los documentos de antes de
   037 quedan en General sin tocar una fila. Tope: 20 grupos por
   organización; nombres de 1 a 40 caracteres, únicos sin distinguir
   mayúsculas, «General» reservado.
2. **Fuentes por agente (PR 2).** En el editor de cada agente, sección
   «Documentos»: «Todos los documentos de la empresa» (por defecto) o «Solo
   estos grupos» (varios). Es parte del borrador: se aplica al publicar, se
   versiona y se restaura. Un agente sin configurar se comporta EXACTAMENTE
   como hoy.
3. **Exclusivos (PR 3).** Desde el editor se suben documentos que solo ese
   agente lee, sea cual sea su selección. Aplican al momento.
4. **La recuperación filtra por las fuentes del agente** en el turno real
   (general y por etapa), las conversaciones del Laboratorio, la vista previa
   (con lo que hay en el formulario) y las evaluaciones (con lo congelado en
   el snapshot al empezar). Un agente jamás recupera documentos de grupos
   que no tiene ni exclusivos de otro agente; una organización jamás ve nada
   de otra.
5. **Límites** siguen por organización (documentos, fragmentos, MB por
   archivo); los exclusivos cuentan igual. El mismo contenido sigue sin
   poder subirse dos veces en la organización (el 409 dice dónde está).

## Fuera de alcance

El juez y sus personas (siguen sin ver los fragmentos, como en 035), la
Bandeja, campañas, plantillas, etiquetas, el cerebro externo (`/api/bot/*`),
cupos por agente, reordenar grupos y convertir un exclusivo en documento de
grupo.
