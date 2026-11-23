import { logger } from "@/lib/log";
import { deliverMobilePush } from "./delivery";
import { mobilePushProvider } from "./fcm";

const log = logger("mobile-push");
type Job = Parameters<typeof deliverMobilePush>[0];
const queued: Job[] = [];
const outstanding = new Set<string>();
let active = 0;

function pump() {
  while (active < 4 && queued.length) {
    const next = queued.shift()!;
    const key = next.organizationId + ":" + next.messageId;
    active++;
    void deliverMobilePush(next)
      .catch(() => log.warn("Un aviso móvil no pudo procesarse"))
      .finally(() => {
        active--;
        outstanding.delete(key);
        pump();
      });
  }
}

export function enqueueMobilePush(job: Job) {
  if (!mobilePushProvider()) return;
  const key = job.organizationId + ":" + job.messageId;
  if (outstanding.size >= 64 || outstanding.has(key)) return;
  outstanding.add(key);
  queued.push(job);
  setImmediate(pump);
}
