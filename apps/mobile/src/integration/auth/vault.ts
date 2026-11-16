import {
  AuthFault,
  decodeSession,
  type FixtureSession,
  type SecretStore,
} from "./model";
/** Serialized atomic-envelope writes; never a browser/AsyncStorage fallback. */
export class SessionVault {
  readonly key: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private store: SecretStore,
    installation: string,
    private now = Date.now,
  ) {
    if (!/^fixture-[\w-]{1,80}$/.test(installation))
      throw new AuthFault("invalid");
    this.key = `dashfort.i2p.fixture.${installation}`;
  }
  private work<T>(fn: () => Promise<T>) {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }
  read() {
    return this.work(async () => {
      let raw: string | null;
      try {
        raw = await this.store.get(this.key);
      } catch {
        throw new AuthFault("storage");
      }
      if (raw === null) return null;
      try {
        return decodeSession(JSON.parse(raw), this.now());
      } catch {
        try {
          await this.store.remove(this.key);
        } catch {
          throw new AuthFault("storage");
        }
        throw new AuthFault("invalid");
      }
    });
  }
  save(session: FixtureSession, current: () => boolean) {
    return this.work(async () => {
      if (!current()) throw new AuthFault("stale");
      const value = JSON.stringify(decodeSession(session, this.now()));
      if (value.length > 12000) throw new AuthFault("invalid");
      try {
        await this.store.set(this.key, value);
      } catch {
        throw new AuthFault("storage");
      }
      if (!current()) {
        try {
          await this.store.remove(this.key);
        } catch {
          throw new AuthFault("storage");
        }
        throw new AuthFault("stale");
      }
    });
  }
  clear() {
    return this.work(async () => {
      try {
        await this.store.remove(this.key);
      } catch {
        throw new AuthFault("storage");
      }
    });
  }
}
