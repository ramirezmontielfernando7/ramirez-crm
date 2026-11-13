import {
  ORG_A,
  ORG_B,
  users,
  decodeEvent,
  eligible,
  scopedKey,
  type Identity,
  type Event,
  type Kind,
  type SyncPage,
} from "../model";
import type { NotificationBackend } from "../ports";
export class DemoNotificationBackend implements NotificationBackend {
  private events: Event[] = [];
  private sequences = new Map<string, number>();
  private access = new Map<string, string | null>([
    [scopedKey(ORG_A, "demo-conv-1"), "demo-owner"],
    [scopedKey(ORG_A, "demo-conv-2"), "demo-coordinator"],
    [scopedKey(ORG_A, "demo-conv-3"), "demo-advisor"],
    [scopedKey(ORG_B, "demo-b-conv-1"), "demo-owner"],
  ]);
  private members = new Set(
    Object.entries(users).flatMap(([id, u]) =>
      u.organizations.map((o) => scopedKey(o, id)),
    ),
  );
  readonly registrations = new Map<
    string,
    { identity: Identity; token: string }
  >();
  failNextSync = false;
  constructor(private now: () => number = Date.now) {}
  authorize = (i: Identity, id?: string) => {
    if (
      !i ||
      !Object.hasOwn(users, i.userId) ||
      ![ORG_A, ORG_B].includes(i.organizationId) ||
      !Number.isSafeInteger(i.expiresAt) ||
      typeof i.sessionId !== "string" ||
      i.sessionId.length > 140 ||
      !/^demo-session-[\w-]+$/.test(i.sessionId) ||
      i.expiresAt <= this.now() ||
      !this.members.has(scopedKey(i.organizationId, i.userId))
    )
      throw Error("Sesión o pertenencia ficticia no válida.");
    if (id) {
      const key = scopedKey(i.organizationId, id);
      if (
        !this.access.has(key) ||
        (users[i.userId]!.role === "advisor" &&
          this.access.get(key) !== i.userId)
      )
        throw Error("Conversación fuera de tu alcance.");
    }
  };
  visible = (i: Identity, e: Event) => {
    try {
      this.authorize(i, e.conversationId);
      return (
        e.organizationId === i.organizationId &&
        eligible(e) &&
        (e.kind !== "handoff" ||
          users[i.userId]!.role !== "advisor" ||
          this.access.get(scopedKey(e.organizationId, e.conversationId)) ===
            i.userId)
      );
    } catch {
      return false;
    }
  };
  known = (i: Identity, id: string) => {
    this.authorize(i);
    const e = this.events.find((e) => e.eventId === id);
    if (!e || !this.visible(i, e))
      throw Error("Aviso no disponible para este perfil.");
    return e;
  };
  publish = (input: {
    eventId: string;
    organizationId?: string;
    conversationId?: string;
    kind?: Kind;
    occurredAt?: number;
    expiresAt?: number;
  }) => {
    const e = decodeEvent({
      version: 1,
      sequence: (this.sequences.get(input.organizationId ?? ORG_A) ?? 0) + 1,
      organizationId: input.organizationId ?? ORG_A,
      conversationId: input.conversationId ?? "demo-conv-1",
      kind: input.kind ?? "message.incoming",
      occurredAt: input.occurredAt ?? this.now(),
      expiresAt: input.expiresAt ?? this.now() + 3600000,
      ...input,
    });
    if (!this.access.has(scopedKey(e.organizationId, e.conversationId)))
      throw Error("Conversación ficticia inexistente.");
    const previous = this.events.find((p) => p.eventId === e.eventId);
    if (previous) {
      const same = { ...e, sequence: previous.sequence };
      if (JSON.stringify(same) !== JSON.stringify(previous))
        throw Error("Identificador de evento reutilizado con otro contenido.");
      return previous;
    }
    if (this.events.length >= 2000)
      throw Error("Límite de 2.000 eventos de esta simulación.");
    this.sequences.set(e.organizationId, e.sequence);
    this.events.push(e);
    return e;
  };
  register = (identity: Identity, installation: string, token: string) => {
    this.authorize(identity);
    if (
      !/^demo-install-[\w-]+$/.test(installation) ||
      !/^demo-token-[\w-]+$/.test(token)
    )
      throw Error("Solo se admiten instalaciones y tokens ficticios.");
    this.registrations.set(installation, { identity: { ...identity }, token });
  };
  revoke = (installation: string) => {
    this.registrations.delete(installation);
  };
  setMembership = (org: string, user: string, enabled: boolean) => {
    const k = scopedKey(org, user);
    enabled ? this.members.add(k) : this.members.delete(k);
  };
  assign = (org: string, id: string, person: string | null) => {
    const k = scopedKey(org, id);
    if (!this.access.has(k) || (person !== null && !users[person]))
      throw Error("Asignación ficticia no válida.");
    this.access.set(k, person);
  };
  sync = async (i: Identity, cursor: number): Promise<SyncPage> => {
    this.authorize(i);
    if (this.failNextSync) {
      this.failNextSync = false;
      throw Error("Falló la sincronización ficticia. Reintenta.");
    }
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > (this.sequences.get(i.organizationId) ?? 0)
    )
      throw Error("Cursor ficticio no válido.");
    const visible = this.events.filter((e) => this.visible(i, e));
    const conversations = [
      ...new Set(visible.map((e) => e.conversationId)),
    ].map((id) => {
      const rows = visible.filter(
        (e) => e.conversationId === id && e.kind === "message.incoming",
      );
      return {
        id,
        sequence: Math.max(0, ...rows.map((e) => e.sequence)),
        messages: rows
          .map((e) => ({ id: e.eventId, time: e.occurredAt }))
          .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
      };
    });
    return {
      cursor: this.sequences.get(i.organizationId) ?? 0,
      events: visible.filter((e) => e.sequence > cursor),
      conversations,
    };
  };
}
