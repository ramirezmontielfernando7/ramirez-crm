/** No AppState/network listener is installed. Caller must supply explicit foreground/online transitions. */
export class PreparedLifecycle {
  private revision = 0;
  private active = false;
  private online = false;
  private task: Promise<void> | null = null;
  constructor(
    private sync: () => Promise<void>,
    private clear: () => void,
  ) {}
  transition(active: boolean, online: boolean) {
    const changed = active !== this.active || online !== this.online;
    this.active = active;
    this.online = online;
    if (!changed || !active || !online) return this.task ?? Promise.resolve();
    if (this.task) return this.task;
    const revision = this.revision;
    const p = Promise.resolve().then(() => {
      if (revision === this.revision && this.active && this.online)
        return this.sync();
    });
    this.task = p;
    void p
      .finally(() => {
        if (this.task === p) this.task = null;
      })
      .catch(() => {});
    return p;
  }
  logout() {
    this.revision++;
    this.active = false;
    this.online = false;
    this.clear();
  }
}
