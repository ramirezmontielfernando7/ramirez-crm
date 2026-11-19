import type { StoragePort } from "../../services/storage";
export const openingKey = "dashfort.demo.opening.v1";
export const openingDuration = 800;
export interface OpeningClock {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}
const clock: OpeningClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
/** First-install presentation only. Never gates authentication or waits for storage writes. */
export function startOpening(
  storage: Pick<StoragePort, "get" | "set">,
  reducedMotion: boolean,
  show: (visible: boolean) => void,
  done: () => void,
  time: OpeningClock = clock,
) {
  let active = true;
  const finish = () => {
    if (!active) return;
    active = false;
    time.clear(timer);
    show(false);
    done();
  };
  const timer = time.set(finish, openingDuration);
  void storage
    .get(openingKey)
    .then((seen) => {
      if (!active) return;
      if (seen === "seen" || reducedMotion) {
        if (seen !== "seen")
          void storage.set(openingKey, "seen").catch(() => {});
        finish();
        return;
      }
      show(true);
      void storage.set(openingKey, "seen").catch(() => {});
    })
    .catch(finish);
  return () => {
    if (active) {
      active = false;
      time.clear(timer);
    }
  };
}
