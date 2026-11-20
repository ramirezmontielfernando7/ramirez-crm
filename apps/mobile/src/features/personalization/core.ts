import type { Role, Module } from "../../domain/access";
import { roles, visibleModules } from "../../domain/access";
import type { ThemeMode } from "../../theme/tokens";
import type { StoragePort } from "../../services/storage";
import type { TeamRepository } from "../team/core";
import { guardedStorage } from "../team/guarded-storage";
export const accents = [
  "#0e7c80",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
] as const;
export const fonts = ["Inter", "Geist", "DMSans", "PlusJakarta"] as const;
export type Font = (typeof fonts)[number];
export type Appearance = Readonly<{
  theme: ThemeMode;
  font: Font;
  chat: "classic" | "whatsapp";
}>;
export type Personal = Readonly<{
  org: string;
  actor: string;
  revision: number;
  theme: ThemeMode | null;
  font: Font | null;
  chat: Appearance["chat"] | null;
}>;
export type Brand = Readonly<{
  org: string;
  revision: number;
  name: string;
  accent: (typeof accents)[number];
  asset: "original" | "sample";
  defaults: Appearance;
  menus: Readonly<Record<Role, readonly Module[]>>;
}>;
export const defaultAppearance: Appearance = Object.freeze({
  theme: "light",
  font: "Inter",
  chat: "classic",
});
export function resolveAppearance(b: Brand, p: Personal): Appearance {
  return {
    theme: p.theme ?? b.defaults.theme,
    font: p.font ?? b.defaults.font,
    chat: p.chat ?? b.defaults.chat,
  };
}
const queues = new WeakMap<TeamRepository, Map<string, Promise<unknown>>>();
const peers = new WeakMap<TeamRepository, Set<PersonalizationStore>>();
function exact(o: object, keys: readonly string[]) {
  return (
    Object.keys(o).length === keys.length &&
    Object.keys(o).every((k) => keys.includes(k))
  );
}
function appearance(v: Appearance, nullable = false) {
  return (
    v &&
    exact(v, ["theme", "font", "chat"]) &&
    (
      ["light", "dark", "system", ...(nullable ? [null] : [])] as unknown[]
    ).includes(v.theme) &&
    ([...fonts, ...(nullable ? [null] : [])] as unknown[]).includes(v.font) &&
    (
      ["classic", "whatsapp", ...(nullable ? [null] : [])] as unknown[]
    ).includes(v.chat)
  );
}
export class PersonalizationStore {
  readonly orgKey: string;
  readonly personalKey: string;
  private io: StoragePort;
  private boundRole: Role;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private state: Readonly<{
    ready: boolean;
    error: string;
    brand: Brand;
    personal: Personal;
  }>;
  constructor(
    readonly team: TeamRepository,
    readonly actor: string,
    io: StoragePort,
  ) {
    this.boundRole = team.actor(actor).role;
    this.io = guardedStorage(team, actor, io);
    this.orgKey = `dashfort.demo.brand.v1.${team.organizationId}`;
    this.personalKey = `dashfort.demo.appearance.v1.${team.organizationId}.${actor}`;
    this.state = Object.freeze({
      ready: false,
      error: "",
      brand: this.brandDecode({
        org: team.organizationId,
        revision: 0,
        name: "Dashfort",
        accent: accents[0],
        asset: "original",
        defaults: defaultAppearance,
        menus: Object.fromEntries(
          roles.map((r) => [r, visibleModules(r)]),
        ) as Record<Role, Module[]>,
      }),
      personal: this.personalDecode({
        org: team.organizationId,
        actor,
        revision: 0,
        theme: null,
        font: null,
        chat: null,
      }),
    });
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
  private check(owner = false) {
    const a = this.team.actor(this.actor);
    if (a.role !== this.boundRole || (owner && a.role !== "owner"))
      throw Error("Tu perfil no permite cambiar esta configuración.");
  }
  private brandDecode(v: Brand): Brand {
    if (
      !v ||
      !exact(v, [
        "org",
        "revision",
        "name",
        "accent",
        "asset",
        "defaults",
        "menus",
      ]) ||
      v.org !== this.team.organizationId ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 0 ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      v.name.length > 40 ||
      /[<>\u0000-\u001f]/.test(v.name) ||
      !accents.includes(v.accent) ||
      !["original", "sample"].includes(v.asset) ||
      !appearance(v.defaults) ||
      !v.menus ||
      !exact(v.menus, roles) ||
      roles.some(
        (r) =>
          !Array.isArray(v.menus[r]) ||
          v.menus[r].length > 5 ||
          v.menus[r].at(-1) !== "more" ||
          new Set(v.menus[r]).size !== v.menus[r].length ||
          v.menus[r].some((m) => !visibleModules(r).includes(m)),
      )
    )
      throw Error("Marca o navegación ficticia no válida.");
    return Object.freeze({
      ...v,
      defaults: Object.freeze({ ...v.defaults }),
      menus: Object.freeze(
        Object.fromEntries(
          roles.map((r) => [r, Object.freeze([...v.menus[r]])]),
        ) as Record<Role, readonly Module[]>,
      ),
    });
  }
  private personalDecode(v: Personal): Personal {
    if (
      !v ||
      !exact(v, ["org", "actor", "revision", "theme", "font", "chat"]) ||
      v.org !== this.team.organizationId ||
      v.actor !== this.actor ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 0 ||
      !appearance(
        { theme: v.theme, font: v.font, chat: v.chat } as Appearance,
        true,
      )
    )
      throw Error("Apariencia ficticia no válida.");
    return Object.freeze({ ...v });
  }
  private parse(raw: string) {
    if (raw.length > 20000) throw Error("Configuración demasiado grande.");
    return JSON.parse(raw);
  }
  retain() {
    let s = peers.get(this.team);
    if (!s) {
      s = new Set();
      peers.set(this.team, s);
    }
    s.add(this);
    return () => {
      s!.delete(this);
    };
  }
  hydrate = () => {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.check();
        const [b, p] = await Promise.all([
          this.io.get(this.orgKey),
          this.io.get(this.personalKey),
        ]);
        this.check();
        const brand = b ? this.brandDecode(this.parse(b)) : this.state.brand,
          personal = p
            ? this.personalDecode(this.parse(p))
            : this.state.personal;
        this.patch({
          ready: true,
          error: "",
          brand:
            brand.revision >= this.state.brand.revision
              ? brand
              : this.state.brand,
          personal:
            personal.revision >= this.state.personal.revision
              ? personal
              : this.state.personal,
        });
      } catch {
        this.patch({
          ready: false,
          error: "No se pudo recuperar la personalización local.",
        });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  private change(kind: "brand" | "personal", fn: (v: any) => unknown) {
    const key = kind === "brand" ? this.orgKey : this.personalKey;
    let q = queues.get(this.team);
    if (!q) {
      q = new Map();
      queues.set(this.team, q);
    }
    const work = (q.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.check(kind === "brand");
        if (!this.state.ready)
          throw Error("Recupera la configuración primero.");
        const raw = await this.io.get(key);
        this.check(kind === "brand");
        const current = raw
          ? kind === "brand"
            ? this.brandDecode(this.parse(raw))
            : this.personalDecode(this.parse(raw))
          : this.state[kind];
        const draft = {
          ...(fn(current) as object),
          revision: current.revision + 1,
        };
        const next =
          kind === "brand"
            ? this.brandDecode(draft as Brand)
            : this.personalDecode(draft as Personal);
        await this.io.set(key, JSON.stringify(next));
        this.check(kind === "brand");
        this.patch({ [kind]: next, error: "" });
        for (const p of peers.get(this.team) ?? [])
          if (
            (kind === "brand" || p.actor === this.actor) &&
            p.state[kind].revision <= next.revision
          )
            p.patch({ [kind]: next });
      });
    q.set(key, work);
    return work;
  }
  personal(patch: Partial<Pick<Personal, "theme" | "font" | "chat">>) {
    if (Object.keys(patch).some((k) => !["theme", "font", "chat"].includes(k)))
      return Promise.reject(Error("Campo personal no válido."));
    return this.change("personal", (v) => ({ ...v, ...patch }));
  }
  brand(patch: Partial<Pick<Brand, "name" | "accent" | "asset" | "defaults">>) {
    if (
      Object.keys(patch).some(
        (k) => !["name", "accent", "asset", "defaults"].includes(k),
      )
    )
      return Promise.reject(Error("Campo de marca no válido."));
    return this.change("brand", (v) => ({
      ...v,
      ...patch,
      name: patch.name?.trim() ?? v.name,
    }));
  }
  menu(role: Role, modules: readonly Module[]) {
    if (!roles.includes(role) || !Array.isArray(modules))
      return Promise.reject(Error("Rol no válido."));
    return this.change("brand", (v) => ({
      ...v,
      menus: { ...v.menus, [role]: [...modules] },
    }));
  }
  navigation(role: Role, disabled: readonly Module[] = []) {
    this.check();
    return this.state.brand.menus[role].filter(
      (m) => m === "more" || visibleModules(role, disabled).includes(m),
    );
  }
}
