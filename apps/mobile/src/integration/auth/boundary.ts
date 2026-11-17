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
  attach(context: AuthContext) {
    try {
      for (const part of this.parts) part.attach(context);
    } catch {
      try {
        this.detach();
      } catch {
        /* rollback already attempted every participant */
      }
      throw new AuthFault("cleanup");
    }
  }
}
