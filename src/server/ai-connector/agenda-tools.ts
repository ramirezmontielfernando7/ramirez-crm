import { z } from "zod";
import type { ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { contactOf } from "@/server/ai-connector/crm-tools";
import { computeAvailability } from "@/server/agenda/availability";
import { agendaEnabled } from "@/server/agenda/flag";
import { canTouchBooking, listBookingsInRange } from "@/server/agenda/queries";
import {
  BookingError,
  cancelBooking,
  createSessionBooking,
  markBookingStatus,
  rescheduleBooking,
} from "@/server/agenda/service";
import { getSettings } from "@/server/agenda/settings";
import { addDaysISO, todayInTz } from "@/lib/time/slots";

/**
 * 047 — La Agenda (citas) para la IA conectada, por las MISMAS puertas que la
 * pantalla (`/api/bookings`, `/api/calendar/availability`): solo con el
 * módulo Agenda de la organización, el asesor ve y toca solo las citas de
 * sus contactos (`listBookingsInRange`/`canTouchBooking` con su alcance; los
 * bloqueos de horario se ven, pero crearlos sigue siendo de la pantalla).
 * Las citas nacen como `manual`: la IA actúa como la persona, no como el
 * agente del negocio. Nunca se borran: cancelar deja la cita «cancelada».
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_SCHEMA = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const MAX_RANGE_DAYS = 62;

function fail(error: string, summary: string, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { data: { error }, summary, isError: true, ...extra };
}

/** El rango pedido (días del negocio, inclusivos) o el mensaje de por qué no sirve. */
function rangeOf(
  from: string | undefined,
  to: string | undefined,
  today: string,
  defaultDays: number
): { error: string } | { from: string; to: string } {
  const start = from ?? today;
  const end = to ?? addDaysISO(start, defaultDays);
  if (end < start) return { error: "«to» no puede ser antes de «from»" };
  if (end > addDaysISO(start, MAX_RANGE_DAYS)) return { error: `Pide como máximo ${MAX_RANGE_DAYS} días a la vez` };
  return { from: start, to: end };
}

function bookingFailure(err: unknown, ids: Partial<ToolOutcome>): ToolOutcome {
  if (!(err instanceof BookingError)) throw err;
  return {
    data: {
      error: err.message,
      ...(err.slots.length ? { alternatives: err.slots.map((s) => ({ start_utc: s.startUtc, label: s.label })) } : {}),
    },
    summary: `cita no guardada (${err.code})`,
    isError: true,
    ...ids,
  };
}

/* ============================== Ver citas ============================== */

const listArgs = z.object({
  from: z.string().regex(ISO_DAY).optional(),
  to: z.string().regex(ISO_DAY).optional(),
  include_cancelled: z.boolean().default(false),
});

const listBookingsTool: ToolSpec<z.infer<typeof listArgs>> = {
  name: "list_bookings",
  title: "Ver la agenda",
  description:
    "Las citas de la Agenda en la zona del negocio, en orden: fecha, hora, cliente (con su conversation_id), estado " +
    "(agendada, realizada, no_show, cancelada) y enlace de la reunión. from/to en AAAA-MM-DD; sin fechas, de hoy a 14 días. " +
    "Un asesor ve solo las citas de sus clientes.",
  inputSchema: {
    type: "object",
    properties: {
      from: DAY_SCHEMA,
      to: DAY_SCHEMA,
      include_cancelled: { type: "boolean", default: false },
    },
    additionalProperties: false,
  },
  parse: listArgs,
  scope: "read",
  available: agendaEnabled,
  run: async ({ session }, args) => {
    const settings = await getSettings(session.organizationId);
    const range = rangeOf(args.from, args.to, todayInTz(new Date(), settings.timezone), 14);
    if ("error" in range) return fail(range.error, "rango no válido");
    const { bookings, truncated } = await listBookingsInRange(session.access, range, settings);
    const rows = bookings.filter((b) => !b.isTest && (args.include_cancelled || b.status !== "cancelada"));
    return {
      data: {
        timezone: settings.timezone,
        range,
        bookings: rows.map((b) => ({
          booking_id: b.id,
          kind: b.kind === "block" ? "horario bloqueado" : "cita",
          date: b.date,
          weekday: b.weekday,
          time: b.time,
          start_utc: b.scheduledAtUtc,
          duration_minutes: b.durationMinutes,
          status: b.status,
          contact: b.contact,
          conversation_id: b.conversationId,
          meeting_link: b.meetingLink,
          notes: b.notes,
        })),
        ...(truncated ? { truncated: true } : {}),
      },
      summary: `${rows.length} citas`,
    };
  },
};

/* ============================== Huecos libres ============================== */

const slotsArgs = z.object({
  from: z.string().regex(ISO_DAY).optional(),
  to: z.string().regex(ISO_DAY).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

const findSlotsTool: ToolSpec<z.infer<typeof slotsArgs>> = {
  name: "find_free_slots",
  title: "Ver horarios libres",
  description:
    "Los horarios libres de la Agenda según el horario del negocio y las citas ya tomadas. from/to en AAAA-MM-DD; sin fechas, " +
    "los próximos 7 días. Para agendar, pasa el start_utc de uno de estos a book_appointment.",
  inputSchema: {
    type: "object",
    properties: {
      from: DAY_SCHEMA,
      to: DAY_SCHEMA,
      limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
    },
    additionalProperties: false,
  },
  parse: slotsArgs,
  scope: "read",
  available: agendaEnabled,
  run: async ({ session }, args) => {
    const settings = await getSettings(session.organizationId);
    const now = new Date();
    const range = rangeOf(args.from, args.to, todayInTz(now, settings.timezone), 7);
    if ("error" in range) return fail(range.error, "rango no válido");
    const slots = await computeAvailability(session.organizationId, {
      fromISO: range.from,
      toISO: range.to,
      settings,
      now,
    });
    return {
      data: {
        timezone: settings.timezone,
        slots: slots.slice(0, args.limit).map((s) => ({ start_utc: s.startUtc, end_utc: s.endUtc, label: s.label })),
        ...(slots.length > args.limit ? { more: slots.length - args.limit } : {}),
      },
      summary: `${Math.min(slots.length, args.limit)} horarios libres`,
    };
  },
};

/* ============================== Agendar ============================== */

const bookArgs = z
  .object({
    conversation_id: z.string().min(1).max(100).optional(),
    contact_id: z.string().min(1).max(100).optional(),
    start_utc: z.string().min(1).max(40),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((a) => Boolean(a.conversation_id || a.contact_id), "Manda conversation_id o contact_id");

const bookTool: ToolSpec<z.infer<typeof bookArgs>> = {
  name: "book_appointment",
  title: "Agendar una cita",
  description:
    "Agenda una cita para un cliente (por conversation_id o contact_id) en un horario libre (start_utc de find_free_slots), " +
    "igual que «Agendar» en la Agenda. Si el horario ya se ocupó, devuelve alternativas. No le avisa al cliente: " +
    "si quieres confirmarle, mándale un mensaje con send_message.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", description: "conversation_id de list_chats" },
      contact_id: { type: "string" },
      start_utc: { type: "string", format: "date-time", description: "start_utc de find_free_slots" },
      notes: { type: "string", maxLength: 1000 },
    },
    required: ["start_utc"],
    additionalProperties: false,
  },
  parse: bookArgs,
  scope: "write",
  available: agendaEnabled,
  run: async ({ session }, args) => {
    const found = await contactOf(session, args);
    if (!found) return fail("No existe o no tienes acceso a ese cliente", "contacto no encontrado");
    const ids = { conversationId: found.conversationId, contactId: found.contact.id };
    try {
      const result = await createSessionBooking({
        organizationId: session.organizationId,
        contactId: found.contact.id,
        conversationId: found.conversationId,
        startUtc: args.start_utc,
        notes: args.notes ?? null,
        source: "manual",
        requireOffer: false,
      });
      return {
        data: {
          ok: true,
          booking_id: result.booking.id,
          when: result.label,
          meeting_link: result.meetingLink,
          ...(result.linkPending ? { link_pending: true } : {}),
        },
        summary: "agendó una cita",
        ...ids,
      };
    } catch (err) {
      return bookingFailure(err, ids);
    }
  },
};

/* ============================== Cambiar una cita ============================== */

const updateArgs = z
  .object({
    booking_id: z.string().min(1).max(100),
    action: z.enum(["reschedule", "cancel", "done", "no_show"]),
    start_utc: z.string().min(1).max(40).optional(),
  })
  .refine((a) => a.action !== "reschedule" || Boolean(a.start_utc), "Para reprogramar manda start_utc");

const updateTool: ToolSpec<z.infer<typeof updateArgs>> = {
  name: "update_appointment",
  title: "Cambiar una cita",
  description:
    "Cambia una cita de list_bookings: reschedule (a otro start_utc libre), cancel (queda cancelada, no se borra), " +
    "done (se realizó) o no_show (el cliente no llegó). No le avisa al cliente.",
  inputSchema: {
    type: "object",
    properties: {
      booking_id: { type: "string", description: "booking_id de list_bookings" },
      action: { type: "string", enum: ["reschedule", "cancel", "done", "no_show"] },
      start_utc: { type: "string", format: "date-time", description: "Solo para reschedule" },
    },
    required: ["booking_id", "action"],
    additionalProperties: false,
  },
  parse: updateArgs,
  scope: "write",
  available: agendaEnabled,
  run: async ({ session }, args) => {
    const organizationId = session.organizationId;
    if (!(await canTouchBooking(session.access, args.booking_id))) {
      return fail("No existe o no tienes acceso a esa cita", "cita no encontrada");
    }
    try {
      switch (args.action) {
        case "reschedule": {
          const r = await rescheduleBooking({ organizationId, bookingId: args.booking_id, startUtc: args.start_utc! });
          return { data: { ok: true, when: r.label }, summary: "reprogramó una cita" };
        }
        case "cancel":
          await cancelBooking({ organizationId, bookingId: args.booking_id });
          return { data: { ok: true, status: "cancelada" }, summary: "canceló una cita" };
        case "done":
        case "no_show":
          await markBookingStatus({
            organizationId,
            bookingId: args.booking_id,
            status: args.action === "done" ? "realizada" : "no_show",
          });
          return {
            data: { ok: true, status: args.action === "done" ? "realizada" : "no_show" },
            summary: "marcó el estado de una cita",
          };
      }
    } catch (err) {
      return bookingFailure(err, {});
    }
  },
};

export const AGENDA_TOOLS = [listBookingsTool, findSlotsTool, bookTool, updateTool];
