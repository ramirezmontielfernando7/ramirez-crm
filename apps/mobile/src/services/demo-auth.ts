import {
  type Role,
  type Session,
  SESSION_TTL,
  isSession,
} from "../domain/access";
import type { StoragePort } from "./storage";
export interface AuthRepository {
  restore(): Promise<Session | null>;
  signIn(email: string, password: string): Promise<Session>;
  redeem(
    token: string,
    password: string,
    purpose: "activate" | "reset",
  ): Promise<Session>;
  signOut(): Promise<void>;
}
const accounts: Record<string, Role> = {
  "fer@ejemplo.mx": "owner",
  "coordinador@ejemplo.mx": "coordinator",
  "asesor@ejemplo.mx": "advisor",
};
export const DEMO_PASSWORD = "Dashfort2026";
export class DemoAuthRepository implements AuthRepository {
  lastRestoreExpired = false;
  private redeeming = false;
  constructor(
    private storage: StoragePort,
    private now = () => Date.now(),
  ) {}
  private create(role: Role): Session {
    return {
      id: `demo-${role}`,
      name:
        role === "owner"
          ? "Fer"
          : role === "coordinator"
            ? "Ana López"
            : "Luis Pérez",
      role,
      expiresAt: this.now() + SESSION_TTL,
      source: "demo",
    };
  }
  private async save(session: Session) {
    await this.storage.set("dashfort.demo.session.v1", JSON.stringify(session));
    return session;
  }
  async restore() {
    this.lastRestoreExpired = false;
    const raw = await this.storage.get("dashfort.demo.session.v1");
    if (!raw) return null;
    try {
      const s: unknown = JSON.parse(raw);
      if (isSession(s, this.now())) return s;
      if (
        s &&
        typeof s === "object" &&
        "expiresAt" in s &&
        typeof s.expiresAt === "number" &&
        s.expiresAt <= this.now()
      )
        this.lastRestoreExpired = true;
    } catch {
      /* discard corrupt data, never grant access */
    }
    await this.signOut();
    return null;
  }
  async signIn(email: string, password: string) {
    const role = accounts[email.trim().toLowerCase()];
    if (!role || password !== DEMO_PASSWORD)
      throw new Error("Correo o contraseña incorrectos. Intenta de nuevo.");
    return this.save(this.create(role));
  }
  async redeem(token: string, password: string, purpose: "activate" | "reset") {
    if (password.length < 8) throw new Error("Usa al menos 8 caracteres.");
    const key = `dashfort.demo.link.${purpose}.${token}`;
    if (token !== `demo-${purpose}` || (await this.storage.get(key)))
      throw new Error("Este enlace ya se usó o venció. Pide uno nuevo.");
    if (this.redeeming) throw new Error("Este enlace se está procesando.");
    this.redeeming = true;
    try {
      await this.storage.set(key, "used");
      try {
        return await this.save(this.create("advisor"));
      } catch (error) {
        await this.storage.remove(key);
        throw error;
      }
    } finally {
      this.redeeming = false;
    }
  }

  async signOut() {
    await this.storage.remove("dashfort.demo.session.v1");
  }
}
