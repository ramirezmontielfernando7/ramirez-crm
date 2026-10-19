/**
 * 041 — Núcleo de `scripts/reclasificar-campanas.mjs` (aparte para probarlo
 * contra una BD real en `tests/db/bandeja-campanas.test.ts`).
 *
 * Clasifica los chats que recibieron al menos un mensaje de campaña y que
 * todavía no llevan ninguna marca (ni `campaign_pending_id` ni
 * `campaign_replied_id`):
 *
 * - «pendiente»: el contacto NUNCA ha escrito → pasa a la pestaña
 *   «Campañas» con la campaña MÁS RECIENTE que le llegó.
 * - «respondió»: su primer mensaje llegó DESPUÉS del primer envío de
 *   campaña → se queda en la principal con «Respondió a campaña X» (la
 *   última campaña que recibió antes de ese primer mensaje).
 * - «activa»: ya había escrito antes de la primera campaña → NO se toca.
 *
 * Solo escribe en chats sin marca, así que correrlo otra vez cambia 0. No
 * borra nada ni toca mensajes, contactos o campañas.
 */

/** Los chats candidatos de UNA organización, ya clasificados (`tx` con `app.org_id` fijado). */
export async function planReclassify(tx, organizationId) {
  const rows = await tx`
    with camp as (
      select m.conversation_id, r.campaign_id, coalesce(m.wa_timestamp, m.created_at) as at
      from campaign_recipient r
      join message m on m.organization_id = r.organization_id and m.id = r.message_id
      where r.organization_id = ${organizationId}
    ),
    first_in as (
      select conversation_id, min(coalesce(wa_timestamp, created_at)) as at
      from message
      where organization_id = ${organizationId} and direction = 'in'
      group by conversation_id
    )
    select
      v.id,
      v.last_inbound_at,
      fi.at as first_in_at,
      (select min(c.at) from camp c where c.conversation_id = v.id) as first_campaign_at,
      (select c.campaign_id from camp c where c.conversation_id = v.id order by c.at desc limit 1) as latest_campaign_id,
      (select c.campaign_id from camp c where c.conversation_id = v.id and c.at <= fi.at order by c.at desc limit 1) as replied_campaign_id
    from conversation v
    left join first_in fi on fi.conversation_id = v.id
    where v.organization_id = ${organizationId}
      and v.is_test = false
      and v.campaign_pending_id is null
      and v.campaign_replied_id is null
      and exists (select 1 from camp c where c.conversation_id = v.id)
    order by v.created_at, v.id
  `;
  const pending = [];
  const replied = [];
  let active = 0;
  for (const r of rows) {
    if (r.last_inbound_at == null && r.first_in_at == null) {
      pending.push({ id: r.id, campaignId: r.latest_campaign_id });
    } else if (r.first_in_at != null && r.replied_campaign_id && r.first_in_at > r.first_campaign_at) {
      replied.push({ id: r.id, campaignId: r.replied_campaign_id });
    } else {
      active++;
    }
  }
  return { pending, replied, active };
}

/**
 * Aplica un plan dentro de `tx`. Cada UPDATE vuelve a exigir «sin marca» (y,
 * para pendientes, «nunca escribió»): si algo cambió desde el plan, esa fila
 * simplemente no se toca. Devuelve cuántas cambió de cada tipo.
 */
export async function applyReclassify(tx, organizationId, plan) {
  let pending = 0;
  let replied = 0;
  for (const p of plan.pending) {
    const r = await tx`
      update conversation set campaign_pending_id = ${p.campaignId}
      where organization_id = ${organizationId} and id = ${p.id}
        and campaign_pending_id is null and campaign_replied_id is null
        and last_inbound_at is null and is_test = false
      returning id
    `;
    pending += r.length;
  }
  for (const p of plan.replied) {
    const r = await tx`
      update conversation set campaign_replied_id = ${p.campaignId}
      where organization_id = ${organizationId} and id = ${p.id}
        and campaign_pending_id is null and campaign_replied_id is null
      returning id
    `;
    replied += r.length;
  }
  return { pending, replied };
}
