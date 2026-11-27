import { buildCandidateSlots, computeAvailability } from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import { aLoLargoDelDia, armarHuecos, spreadByDay } from "@/server/agenda/spread";
import { addDaysISO, todayInTz } from "@/lib/time/slots";
import { replaceOffers } from "@/server/agenda/offers";
import { BookingError, createSessionBooking } from "@/server/agenda/service";

/**
 * 015 — Lo que el agente incluido puede hacer con la agenda.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de agendas: el
 * turno pide "ofrece" o "reserva" y recibe el texto que hay que mandar.
 *
 * Regla que atraviesa las dos operaciones: el modelo NO redacta horarios. Pide
 * ofrecer, y el motor pega las etiquetas reales. Si el modelo inventa un
 * instante al reservar, el motor lo rechaza y se re-ofrece — nunca se agenda
 * algo que el cliente no eligió.
 */

/** Cuántos huecos se le enseñan al cliente en un mensaje. */
const SHOWN = 3;
/** Cuántos se guardan como reservables: el catálogo es más ancho que el menú. */
const OFFERED = 12;

type AgendaTurn = {
  /** Lo que hay que enviarle al cliente. */
  text: string;
  /** false ⇒ el motor no pudo; el turno sigue, sin agendar. */
  ok: boolean;
};

/**
 * La fecha de hoy para el prompt del agente, en la zona del negocio.
 *
 * Sin ella el modelo no puede convertir «el martes» en un día, y offer_slots
 * caía siempre en el primer día libre. Así lo encontró el Laboratorio (nov
 * 2026): la clienta pidió el martes y el agente le repitió tres veces los
 * horarios del viernes.
 */
export async function lineaDeHoy(organizationId: string, now = new Date()): Promise<string> {
  const settings = await getSettings(organizationId);
  const hoy = todayInTz(now, settings.timezone);
  const dia = new Intl.DateTimeFormat("es-MX", {
    timeZone: settings.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return `Hoy es ${dia} (${hoy}) en la zona horaria del negocio. Usa esta fecha para calcular el "date" de offer_slots.`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function offerSlots(input: {
  organizationId: string;
  conversationId: string;
  intro?: string;
  /** Día que pidió el cliente (AAAA-MM-DD, zona del negocio). Opcional. */
  date?: string;
}): Promise<AgendaTurn> {
  const settings = await getSettings(input.organizationId);
  const now = new Date();
  const date = input.date && ISO_DAY.test(input.date) ? input.date : null;

  if (date) {
    const hoy = todayInTz(now, settings.timezone);
    const dentro = date >= hoy && date <= addDaysISO(hoy, settings.maxDaysAhead);
    const todos = dentro
      ? await computeAvailability(input.organizationId, { settings, now, fromISO: date, toISO: date })
      : [];
    const { slots } = armarHuecos({
      todos,
      timezone: settings.timezone,
      now,
      maxDaysAhead: settings.maxDaysAhead,
      limit: OFFERED,
      perDay: 3,
      date,
      candidatosDelDia: dentro ? buildCandidateSlots(settings, date, date).length : 0,
    });
    if (slots.length > 0) {
      await replaceOffers(
        input.organizationId,
        input.conversationId,
        slots.map((s) => ({ startUtc: s.startUtc, label: s.label }))
      );
      // Se enseñan tres repartidos a lo largo del día, no los tres primeros.
      const shown = aLoLargoDelDia(slots, SHOWN);
      const lista = shown.map((s) => `• ${s.dayLabel} a las ${s.time}`).join("\n");
      const intro = input.intro?.trim() || "Tengo estos horarios disponibles:";
      return { ok: true, text: `${intro}\n${lista}` };
    }
    // Ese día no hay nada (cerrado, lleno o fuera de rango): se dice claro y
    // se ofrecen los más cercanos DESPUÉS de ese día, nunca de otro como si
    // fueran del que pidió.
    const desde = dentro ? addDaysISO(date, 1) : undefined;
    const cercanos = await spreadFrom(input.organizationId, settings, now, desde);
    if (cercanos.length === 0) return agendaLlena(input.intro);
    await replaceOffers(
      input.organizationId,
      input.conversationId,
      cercanos.map((s) => ({ startUtc: s.startUtc, label: s.label }))
    );
    const lista = cercanos.slice(0, SHOWN).map((s) => `• ${s.dayLabel} a las ${s.time}`).join("\n");
    return { ok: true, text: `Ese día no me quedan horarios libres. Los más cercanos son:\n${lista}` };
  }

  const spread = await spreadFrom(input.organizationId, settings, now);
  if (spread.length === 0) return agendaLlena(input.intro);

  // Se REGISTRA todo el catálogo, no solo lo que se enseña: si el cliente pide
  // otro día, el agente tiene alternativas legítimas que aceptar.
  await replaceOffers(
    input.organizationId,
    input.conversationId,
    spread.map((s) => ({ startUtc: s.startUtc, label: s.label }))
  );

  const shown = spread.slice(0, SHOWN);
  const lista = shown.map((s) => `• ${s.dayLabel} a las ${s.time}`).join("\n");
  const intro = input.intro?.trim() || "Tengo estos horarios disponibles:";
  return { ok: true, text: `${intro}\n${lista}` };
}

/** Agenda llena no es un error: es una respuesta que el cliente entiende. */
function agendaLlena(intro?: string): AgendaTurn {
  return {
    ok: false,
    text: intro?.trim() || "Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso.",
  };
}

/** El reparto de siempre (3 por día), opcionalmente a partir de un día. */
async function spreadFrom(
  organizationId: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  now: Date,
  fromISO?: string
) {
  const all = await computeAvailability(organizationId, {
    settings,
    now,
    ...(fromISO ? { fromISO } : {}),
  });
  return spreadByDay(all, { timezone: settings.timezone, limit: OFFERED, perDay: 3, now });
}

export async function bookSlot(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  confirmation?: string;
}): Promise<AgendaTurn> {
  try {
    const result = await createSessionBooking({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startUtc: input.startUtc,
      source: "ai",
      requireOffer: true,
    });

    const base =
      input.confirmation?.trim() || `¡Listo! Te agendé para ${result.label}.`;
    if (result.meetingLink) {
      return { ok: true, text: `${base}\nEnlace: ${result.meetingLink}` };
    }
    if (result.linkPending) {
      // La cita existe; el enlace no. No se promete lo que no se tiene.
      return {
        ok: true,
        text: `${base}\nEn un momento te comparto el enlace por aquí.`,
      };
    }
    return { ok: true, text: base };
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;

    // Se ocupó o el modelo inventó la hora: en ambos casos se re-ofrece con
    // datos reales en vez de discutir con el cliente.
    if (err.slots.length > 0) {
      const lista = err.slots
        .slice(0, SHOWN)
        .map((s) => `• ${s.label}`)
        .join("\n");
      const disculpa =
        err.code === "slot_taken"
          ? "Se me acaba de ocupar ese horario, ¡perdón!"
          : "Déjame confirmarte los horarios que tengo:";
      return { ok: false, text: `${disculpa}\n${lista}` };
    }
    return {
      ok: false,
      text: "No pude agendarlo en este momento. Lo reviso con el equipo y te confirmo.",
    };
  }
}
