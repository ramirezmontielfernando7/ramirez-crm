import type { Permission, Identity } from "./model";
import type { NotificationBackend } from "./ports";
export class DemoRegistration {
  private version = 0;
  token: string | null = null;
  pendingRevocation = false;
  constructor(
    readonly installation: string,
    private backend: NotificationBackend,
  ) {}
  revoke(online: boolean) {
    this.token = null;
    this.pendingRevocation = true;
    if (online) {
      this.backend.revoke(this.installation);
      this.pendingRevocation = false;
    }
  }
  reconcile(
    i: Identity | null,
    permission: Permission,
    online: boolean,
    rotate = false,
  ) {
    if (!i || permission !== "granted") {
      this.revoke(online);
      return;
    }
    if (!online) return;
    if (this.pendingRevocation) {
      this.backend.revoke(this.installation);
      this.pendingRevocation = false;
    }
    this.backend.authorize(i);
    if (!this.token || rotate)
      this.token = `demo-token-${this.installation}-${++this.version}`;
    this.backend.register(i, this.installation, this.token);
  }
}
