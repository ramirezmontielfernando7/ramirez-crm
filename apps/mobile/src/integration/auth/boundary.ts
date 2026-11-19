import {
  AuthFault,
  type AuthContext,
  type SessionBoundary,
  type CleanupFailure,
} from "./model";
export type BoundaryPart = Readonly<{
  name: "cache" | "drafts" | "media" | "notifications";
  detach(): void;
  attach(context: AuthContext): void;
}>;
/** No approved store is wired here. Each independent participant is attempted even when another throws. */
export class CompositeSessionBoundary implements SessionBoundary {
  private failures: readonly CleanupFailure[] = [];
  private parts: readonly BoundaryPart[];
  private revision = 0;
  private owner: AuthContext | null = null;
  constructor(parts: readonly BoundaryPart[]) {
    if (
      parts.length > 4 ||
      new Set(parts.map((p) => p.name)).size !== parts.length ||
      parts.some(
        (p) => !["cache", "drafts", "media", "notifications"].includes(p.name),
      )
    )
      throw new AuthFault("invalid");
    this.parts = Object.freeze([...parts]);
  }
  cleanupFailures = () => this.failures;
  detach() {
    this.revision++;
    this.owner = null;
    const failures: CleanupFailure[] = [];
    for (const part of this.parts) {
      try {
        part.detach();
      } catch {
        failures.push(part.name);
      }
    }
    this.failures = Object.freeze(failures);
    if (failures.length) throw new AuthFault("cleanup");
  }
  attach(context: AuthContext, current: () => boolean = () => true) {
    const revision = ++this.revision;
    this.owner = context;
    const check = () => {
      if (!current() || revision !== this.revision)
        throw new AuthFault("stale");
    };
    try {
      for (const part of this.parts) {
        check();
        part.attach(context);
        check();
      }
    } catch (error) {
      // Logout may already have detached. Never erase a newer installed owner.
      if (this.owner === context || this.owner === null) {
        try {
          this.detach();
        } catch {
          /* all participants were attempted */
        }
      }
      throw error instanceof AuthFault && error.code === "stale"
        ? error
        : new AuthFault("cleanup");
    }
  }
}
