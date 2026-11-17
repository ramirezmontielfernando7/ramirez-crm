import {
  AuthFault,
  decodeSession,
  revocationReference,
  type RevocationReference,
  type FixtureSession,
  type SecretStore,
  type CleanupFailure,
  type RevocationRecord,
} from "./model";
export function decodeRevocations(
  raw: string | null,
): readonly RevocationRecord[] {
  if (raw === null) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuthFault("invalid");
  }
  if (
    parsed?.version !== 1 ||
    !Array.isArray(parsed.records) ||
    parsed.records.length > 32
  )
    throw new AuthFault("invalid");
  return parsed.records.map((r: RevocationRecord) => {
    if (!r || !["pending", "failed", "unknown"].includes(r.outcome))
      throw new AuthFault("invalid");
    return Object.freeze({
      reference: revocationReference(r.reference),
      outcome: r.outcome,
    });
  });
}
/** One serialized queue for credential, durable logout barrier and fixture-only revocation journal. */
export class SessionVault {
  readonly key: string;
  readonly barrierKey: string;
  readonly revocationsKey: string;
  private queue: Promise<unknown> = Promise.resolve();
  private blocked = false;
  constructor(
    private store: SecretStore,
    installation: string,
    private now = Date.now,
  ) {
    if (!/^fixture-[\w-]{1,80}$/.test(installation))
      throw new AuthFault("invalid");
    this.key = `dashfort.i2p.fixture.${installation}`;
    this.barrierKey = this.key + ".barrier";
    this.revocationsKey = this.key + ".revocations";
  }
  private work<T>(fn: () => Promise<T>) {
    const p = this.queue.then(fn).catch((e) => {
      throw e instanceof AuthFault ? e : new AuthFault("storage");
    });
    this.queue = p.catch(() => {});
    return p;
  }
  fence() {
    this.blocked = true;
  }
  read() {
    return this.work(async () => {
      if (this.blocked || (await this.store.get(this.barrierKey)) !== null) {
        this.blocked = true;
        throw new AuthFault("blocked");
      }
      const raw = await this.store.get(this.key);
      if (raw === null) return null;
      try {
        return decodeSession(JSON.parse(raw), this.now());
      } catch {
        await this.store.remove(this.key);
        throw new AuthFault("invalid");
      }
    });
  }
  peekForRevocation() {
    return this.work(async () => {
      const raw = await this.store.get(this.key);
      if (raw === null) return null;
      try {
        return decodeSession(JSON.parse(raw), 0);
      } catch {
        throw new AuthFault("invalid");
      }
    });
  }
  quarantine(
    current: () => boolean = () => true,
  ): Promise<readonly CleanupFailure[]> {
    if (current()) this.blocked = true;
    return this.work(async () => {
      if (!current()) return [];
      const failures: CleanupFailure[] = [];
      try {
        await this.store.set(this.barrierKey, "blocked-v1");
      } catch {
        failures.push("restore-barrier");
      }
      // Independent: attempt removal even if writing the barrier failed.
      try {
        await this.store.remove(this.key);
      } catch {
        failures.push("credential-delete");
      }
      return failures;
    });
  }
  prepareLogin(current: () => boolean) {
    if (current()) this.blocked = true;
    return this.work(async () => {
      if (!current()) throw new AuthFault("stale");
      await this.store.set(this.barrierKey, "blocked-v1");
      await this.store.remove(this.key);
      if (!current()) throw new AuthFault("stale");
      await this.store.remove(this.barrierKey);
      if (!current()) throw new AuthFault("stale");
      this.blocked = false;
    });
  }
  save(session: FixtureSession, current: () => boolean) {
    return this.work(async () => {
      if (!current()) throw new AuthFault("stale");
      if (this.blocked || (await this.store.get(this.barrierKey)) !== null)
        throw new AuthFault("blocked");
      const value = JSON.stringify(decodeSession(session, this.now()));
      if (value.length > 12000) throw new AuthFault("invalid");
      await this.store.set(this.key, value);
      if (!current()) {
        await this.store.remove(this.key);
        throw new AuthFault("stale");
      }
    });
  }
  clear() {
    return this.quarantine().then((failures) => {
      if (failures.length) throw new AuthFault("storage");
    });
  }
  listRevocations() {
    return this.work(async () =>
      decodeRevocations(await this.store.get(this.revocationsKey)),
    );
  }
  recordRevocation(
    reference: RevocationReference,
    outcome: RevocationRecord["outcome"],
  ) {
    return this.work(async () => {
      const ref = revocationReference(reference);
      const list = decodeRevocations(await this.store.get(this.revocationsKey));
      const records = [
        ...list.filter((r) => r.reference.sessionId !== ref.sessionId),
        { reference: ref, outcome },
      ];
      if (records.length > 32) throw new AuthFault("blocked");
      await this.store.set(
        this.revocationsKey,
        JSON.stringify({ version: 1, records }),
      );
    });
  }
  confirmRevocation(reference: RevocationReference) {
    return this.work(async () => {
      const ref = revocationReference(reference);
      const records = decodeRevocations(
        await this.store.get(this.revocationsKey),
      ).filter((r) => r.reference.sessionId !== ref.sessionId);
      if (records.length)
        await this.store.set(
          this.revocationsKey,
          JSON.stringify({ version: 1, records }),
        );
      else await this.store.remove(this.revocationsKey);
    });
  }
}
