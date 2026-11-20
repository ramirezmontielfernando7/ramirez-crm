import type { TeamRepository } from "../team/core";
export type PlatformOrg = Readonly<{
  id: string;
  name: string;
  plan: string;
  modules: string;
  ai: number;
  people: number;
  storage: number;
  seats: number;
  state: "Activa";
  access: string;
}>;
/** Fixed, fictional metadata. This module cannot query tenant repositories. */
export const sampleOrganizations: readonly PlatformOrg[] = Object.freeze(
  [
    {
      id: "o1",
      name: "Demfort (plataforma)",
      plan: "Ultra",
      modules: "13/13",
      ai: 42,
      people: 5,
      storage: 18,
      seats: 8,
      state: "Activa" as const,
      access: "Administración de muestra",
    },
    {
      id: "o2",
      name: "Joyería Cristal",
      plan: "Pro",
      modules: "9/13",
      ai: 68,
      people: 3,
      storage: 23,
      seats: 5,
      state: "Activa" as const,
      access: "Acceso de muestra habilitado",
    },
    {
      id: "o3",
      name: "Unid Campus",
      plan: "Esencial",
      modules: "4/13",
      ai: 12,
      people: 3,
      storage: 9,
      seats: 3,
      state: "Activa" as const,
      access: "Acceso de muestra habilitado",
    },
    {
      id: "o4",
      name: "Pastelería Dulce Vida",
      plan: "Esencial",
      modules: "4/13",
      ai: 91,
      people: 3,
      storage: 21,
      seats: 3,
      state: "Activa" as const,
      access: "Acceso de muestra habilitado",
    },
  ].map((o) => Object.freeze(o)),
);
export class PlatformStore {
  private grant = false;
  private generation = 0;
  private boundRole: string;
  private listeners = new Set<() => void>();
  private state: Readonly<{
    allowed: boolean;
    ready: boolean;
    error: string;
    organizations: readonly PlatformOrg[];
  }> = Object.freeze({
    allowed: false,
    ready: false,
    error: "",
    organizations: [] as readonly PlatformOrg[],
  });
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    private load: () => Promise<readonly PlatformOrg[]> = async () =>
      sampleOrganizations,
  ) {
    this.boundRole = team.actor(actor).role;
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private patch(p: Partial<typeof this.state>) {
    this.state = Object.freeze({ ...this.state, ...p });
    for (const f of this.listeners)
      try {
        f();
      } catch {}
  }
  private authorized() {
    try {
      return this.grant && this.team.actor(this.actor).role === this.boundRole;
    } catch {
      return false;
    }
  }
  /** Explicit lab capability. Never inferred from a business role, never persisted or remote. */
  demoAccess(enabled: boolean, confirmation: string) {
    this.team.actor(this.actor);
    if (confirmation !== "SOLO METADATOS FICTICIOS")
      throw Error("Confirma el alcance de la simulación.");
    this.generation++;
    this.grant = enabled;
    this.patch({
      allowed: this.authorized(),
      ready: false,
      error: "",
      organizations: [],
    });
  }
  retain() {
    return this.team.subscribe(() => {
      if (!this.authorized()) {
        this.generation++;
        this.grant = false;
        this.patch({
          allowed: false,
          ready: false,
          organizations: [],
          error: "",
        });
      }
    });
  }
  async hydrate() {
    const g = ++this.generation;
    if (!this.authorized()) {
      this.patch({
        allowed: false,
        ready: false,
        organizations: [],
        error: "",
      });
      return;
    }
    this.patch({ allowed: true, ready: false, error: "" });
    try {
      const rows = await this.load();
      if (g !== this.generation || !this.authorized()) return;
      // Do not accept arbitrary payloads: only the approved static metadata is exposed.
      if (rows.some((o) => !sampleOrganizations.includes(o)))
        throw Error("Metadatos no válidos.");
      this.patch({ ready: true, organizations: Object.freeze([...rows]) });
    } catch {
      if (g === this.generation && this.authorized())
        this.patch({
          ready: false,
          error: "No se pudieron recuperar los metadatos ficticios.",
          organizations: [],
        });
    }
  }
  organization(id: string) {
    if (!this.authorized() || !this.state.ready)
      throw Error("Sin permiso de plataforma.");
    const o = this.state.organizations.find((o) => o.id === id);
    if (!o) throw Error("Organización ficticia no disponible.");
    return o;
  }
}
