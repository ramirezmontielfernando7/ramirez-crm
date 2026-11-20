import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "./core";
const queues = new WeakMap<StoragePort, Map<string, Promise<unknown>>>();
/** A retired UI/store instance never acquires a new role's authority. */
export function guardedStorage(
  team: TeamRepository,
  id: string,
  storage: StoragePort,
): StoragePort {
  const role = team.actor(id).role;
  let quarantined = false;
  let queue: Promise<unknown> = Promise.resolve();
  let writes = queues.get(storage);
  if (!writes) {
    writes = new Map();
    queues.set(storage, writes);
  }
  const check = () => {
    if (quarantined)
      throw Error("Almacenamiento en cuarentena: recupera la sesión.");
    if (team.actor(id).role !== role)
      throw Error("Los permisos cambiaron. Recupera la sesión.");
  };
  const write = (key: string, value: string | null) => {
    const work = (writes!.get(key) ?? queue)
      .catch(() => {})
      .then(async () => {
        check();
        const previous = await storage.get(key);
        check();
        try {
          if (value === null) await storage.remove(key);
          else await storage.set(key, value);
          check();
        } catch (e) {
          try {
            if ((await storage.get(key)) !== previous) {
              if (previous === null) await storage.remove(key);
              else await storage.set(key, previous);
            }
          } catch {
            quarantined = true;
          }
          throw e;
        }
      });
    queue = work;
    writes!.set(key, work);
    return work;
  };
  return {
    get: async (key) => {
      check();
      const result = await storage.get(key);
      check();
      return result;
    },
    set: (k, v) => write(k, v),
    remove: (k) => write(k, null),
    keys: storage.keys
      ? async (prefix) => {
          check();
          const result = await storage.keys!(prefix);
          check();
          return result;
        }
      : undefined,
  };
}
