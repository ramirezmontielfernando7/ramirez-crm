import { z } from "zod";
import { parseBody } from "@/lib/api";
import { BROADCAST_MAX, KILL_SWITCH_KEYS } from "@/lib/platform-controls";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { endBroadcast, listBroadcasts, listKillSwitches, setKillSwitch, startBroadcast } from "@/server/platform-controls/store";

export const dynamic = "force-dynamic";

/**
 * 048 — Controles de TODA la plataforma: interruptores de emergencia por
 * función (IA, campañas, envíos por conexión directa) y el aviso a todos los
 * clientes. Solo el administrador de plataforma (404 a los demás); cada
 * cambio queda en la bitácora.
 */
const respuesta = async () => Response.json({ switches: await listKillSwitches(), broadcasts: await listBroadcasts() });

export const GET = withPlatformAdmin(async () => respuesta());

const schema = z.union([
  z.object({ killSwitch: z.object({ key: z.enum(KILL_SWITCH_KEYS), active: z.boolean(), reason: z.string().max(300).nullable().optional() }).strict() }).strict(),
  z
    .object({
      broadcast: z
        .object({
          message: z.string().trim().min(1).max(BROADCAST_MAX),
          level: z.enum(["info", "warning"]),
          endsAt: z.string().datetime({ offset: true }).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ endBroadcast: z.literal(true) }).strict(),
]);

export const PUT = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const d = body.data;
  if ("killSwitch" in d) await setKillSwitch(d.killSwitch.key, d.killSwitch.active, d.killSwitch.reason ?? null, actorOf(admin), ip);
  else if ("broadcast" in d) {
    await startBroadcast({ message: d.broadcast.message, level: d.broadcast.level, endsAt: d.broadcast.endsAt ? new Date(d.broadcast.endsAt) : null }, actorOf(admin), ip);
  } else await endBroadcast(actorOf(admin), ip);
  return respuesta();
});
