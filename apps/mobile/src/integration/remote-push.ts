import { isRemoteId } from "./remote-crm-contract";

export const pushRoutes = {
  register: "/api/mobile/push/register",
  unregister: "/api/mobile/push/unregister",
} as const;

export function isPushToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9:_.-]{16,4096}$/.test(value) &&
    !/\s/.test(value)
  );
}

export function conversationFromPush(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { type, conversationId } = raw as Record<string, unknown>;
  if (type !== "message.new" || !isRemoteId(conversationId)) return null;
  return conversationId;
}

export type PushTap = { id: string; conversationId: string };
export type PushPort = {
  available: boolean;
  permission(request: boolean): Promise<boolean>;
  token(): Promise<string>;
  onToken(received: (value: string) => void): () => void;
  onTap(received: (tap: PushTap) => void): () => void;
  resetTaps(): Promise<void>;
};

export class PushRegistration {
  private queue: Promise<void> = Promise.resolve();
  private tokenValue: string | undefined;
  private registeredAt = -Infinity;
  private oldTokens = new Set<string>();

  constructor(
    private readonly native: PushPort,
    private readonly send: (token: string, register: boolean) => Promise<void>,
    private readonly now = Date.now,
  ) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  sync(requestPermission: boolean, replacement?: string) {
    return this.serialize(async () => {
      if (
        !this.native.available ||
        !(await this.native.permission(requestPermission))
      )
        return false;
      const token =
        replacement ??
        (this.now() - this.registeredAt < 86_400_000
          ? this.tokenValue
          : undefined) ??
        (await this.native.token());
      if (!isPushToken(token))
        throw new Error("No se pudo obtener un token de notificaciones.");
      if (
        token !== this.tokenValue ||
        this.now() - this.registeredAt >= 86_400_000
      ) {
        await this.send(token, true);
        if (this.tokenValue && this.tokenValue !== token)
          this.oldTokens.add(this.tokenValue);
        this.tokenValue = token;
        this.oldTokens.delete(token);
        this.registeredAt = this.now();
      }
      await this.releaseOld();
      return true;
    });
  }

  private async releaseOld() {
    for (const token of this.oldTokens) {
      await this.send(token, false);
      this.oldTokens.delete(token);
    }
  }

  disable(lookup: boolean) {
    return this.serialize(async () => {
      if (!this.native.available) return;
      const token =
        this.tokenValue ?? (lookup ? await this.native.token() : undefined);
      if (token) await this.send(token, false);
      await this.releaseOld();
      this.tokenValue = undefined;
      this.registeredAt = -Infinity;
    });
  }

  reset() {
    this.tokenValue = undefined;
    this.registeredAt = -Infinity;
    this.oldTokens.clear();
  }
}
