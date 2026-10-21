/**
 * Fluidez PR 3 — Un servidor FALSO de la Bandeja para los guiones que miden
 * o prueban la lista con miles de chats sin sembrar la BD
 * (`scripts/medir-fluidez.mjs`, `scripts/e2e-bandeja-virtual.mjs`).
 *
 * El navegador intercepta `GET /api/conversations` y `/counts` y esto
 * responde como el servidor de verdad: por páginas con cursor (`limit`,
 * `cursor`, `nextCursor`), con los filtros de la pantalla (`status`, `q`,
 * `stage`, `tag`, `assigned`, `channel`, `view`), el refresco por chat
 * (`ids`, `contactIds`) y los contadores. Las reglas son las de
 * `src/lib/inbox-list.ts` (`matchesListQuery`), en JS a secas.
 */

const DIACRITICS = /[̀-ͯ]/g;
const norm = (v) => v.toLowerCase().normalize("NFD").replace(DIACRITICS, "");
const digits = (v) => v.replace(/\D/g, "");

function matchesQuery(q, c) {
  const t = norm(q.trim());
  if (!t) return true;
  if (c.contact.name && norm(c.contact.name).includes(t)) return true;
  const d = digits(q);
  return d.length >= 3 && !!c.contact.phone && digits(c.contact.phone).includes(d);
}

function matches(c, p, viewerId) {
  const view = p.get("view") === "campaigns" ? "campaigns" : "main";
  const pending = c.campaign?.state === "pending";
  if (view === "campaigns" ? !pending : pending) return false;
  if (!matchesQuery(p.get("q") ?? "", c)) return false;
  const stage = p.get("stage");
  if (stage && c.stageName !== stage) return false;
  const tag = p.get("tag");
  if (tag && !c.tags.some((t) => t.id === tag)) return false;
  const owner = p.get("assigned");
  if (owner) {
    const ok = owner === "mine" ? c.assignee?.id === viewerId : owner === "unassigned" ? !c.assignee : c.assignee?.id === owner;
    if (!ok) return false;
  }
  const ch = p.get("channel");
  if (ch && c.channel !== ch) return false;
  if (view === "campaigns") return true;
  const status = p.get("status") ?? "all";
  if (status === "archived") return !!c.archivedAt;
  if (c.archivedAt) return false;
  if (status === "unread") return c.unreadCount > 0;
  if (status === "humano") return c.handoffAt !== null;
  if (status === "anuncios") return c.anuncio !== null;
  return true;
}

const key = (c) => c.lastMessageAt ?? c.createdAt;
const cmp = (a, b) => (key(a) !== key(b) ? (key(a) < key(b) ? 1 : -1) : a.id === b.id ? 0 : a.id < b.id ? 1 : -1);

/**
 * Instala la Bandeja falsa en un contexto de Playwright. `chats` en la forma
 * de `ConversationDto`. Devuelve cuántas peticiones de lista respondió (para
 * medir).
 */
export async function bandejaFalsa(ctx, chats, { viewerId = "" } = {}) {
  const todos = [...chats].sort(cmp);
  const porId = new Map(todos.map((c) => [c.id, c]));
  const stats = { paginas: 0, bytes: 0 };
  const fulfill = (route, json) => {
    const body = JSON.stringify(json);
    stats.bytes += body.length;
    return route.fulfill({ body, contentType: "application/json" });
  };
  await ctx.route(
    (u) => u.pathname === "/api/conversations/counts",
    (route) => {
      const p = new URL(route.request().url()).searchParams;
      const cuenta = (over) => {
        const q = new URLSearchParams(p);
        for (const [k, v] of Object.entries(over)) v === null ? q.delete(k) : q.set(k, v);
        return todos.filter((c) => matches(c, q, viewerId)).length;
      };
      const principal = todos.filter((c) => c.campaign?.state !== "pending");
      const channels = {};
      for (const ch of ["whatsapp", "instagram", "messenger"]) channels[ch] = cuenta({ channel: ch, status: null });
      const stages = [];
      for (const c of principal) if (c.stageName && !stages.includes(c.stageName)) stages.push(c.stageName);
      const tags = new Map();
      const owners = new Map();
      for (const c of principal) {
        for (const t of c.tags) tags.set(t.id, t.name);
        if (c.assignee) owners.set(c.assignee.id, c.assignee.name);
      }
      const q = (p.get("q") ?? "").trim();
      return fulfill(route, {
        q,
        total: principal.length,
        all: cuenta({ status: null }),
        unread: cuenta({ status: "unread" }),
        archived: cuenta({ status: "archived" }),
        humano: cuenta({ status: "humano" }),
        anuncios: cuenta({ status: "anuncios" }),
        campaigns: cuenta({ view: "campaigns" }),
        campaignPending: todos.length - principal.length,
        channels,
        queryHits: q ? principal.filter((c) => matchesQuery(q, c)).length : 0,
        stages,
        tags: [...tags],
        owners: [...owners],
      });
    }
  );
  await ctx.route(
    (u) => u.pathname === "/api/conversations",
    (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const p = new URL(route.request().url()).searchParams;
      const ids = p.get("ids")?.split(",");
      const contactIds = p.get("contactIds")?.split(",");
      const campanas = p.get("view") === "campaigns";
      const enVista = (c) => (c.campaign?.state === "pending") === campanas;
      if (ids || contactIds) {
        const solo = todos.filter((c) => enVista(c) && (ids?.includes(c.id) || contactIds?.includes(c.contact.id)));
        return fulfill(route, { conversations: solo, campaignPending: 0 });
      }
      const limit = Number(p.get("limit"));
      if (!limit) return fulfill(route, { conversations: todos.filter(enVista), campaignPending: 0 });
      stats.paginas++;
      const filtradas = todos.filter((c) => matches(c, p, viewerId));
      const cursor = p.get("cursor");
      const desde = cursor ? filtradas.findIndex((c) => c.id === cursor) + 1 : 0;
      const pagina = filtradas.slice(desde, desde + limit);
      const more = desde + limit < filtradas.length;
      return fulfill(route, { conversations: pagina, nextCursor: more ? pagina[pagina.length - 1].id : null });
    }
  );
  // Abrir un chat falso no debe pegarle a la BD.
  await ctx.route(
    (u) => /^\/api\/conversations\/[^/]+/.test(u.pathname) && porId.has(u.pathname.split("/")[3]),
    (route) => route.fulfill({ json: { messages: [] } })
  );
  return stats;
}
