import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import type { Access } from "@/lib/db/tenant";
import type { ConversationDto } from "@/lib/types";
import { countConversations, listConversations, listConversationsPage } from "@/server/inbox/queries";
import { DEFAULT_FILTERS, matchesListQuery, type ListQuery } from "@/lib/inbox-list";
import { CHANNEL_ORDER } from "@/lib/channels";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fluidez PR 3 — La Bandeja paginada contra Postgres real:
 *
 * - Bajar página por página da EXACTAMENTE la lista completa (mismo orden,
 *   sin repetir ni saltar), también con empates en la hora y chats sin
 *   mensajes.
 * - Cada filtro del servidor trae lo mismo que la regla del navegador
 *   (`matchesListQuery`) sobre la lista completa: los dos lados no se separan.
 * - Los contadores son los que antes contaba el navegador.
 * - El asesor solo ve lo suyo, también por páginas y en los contadores.
 * - Un chat que sube a la cima mientras se baja no se repite.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

describe("bandeja paginada: páginas = lista completa, filtros y contadores", () => {
  let A: Org;
  const owner = newId("user");
  const asesor = newId("user");
  const otro = newId("user");
  const ownerA = (): Access => ({ organizationId: A.id, userId: owner, seesAll: true });
  const asesorA = (): Access => ({ organizationId: A.id, userId: asesor, seesAll: false });
  const conv: Record<string, string> = {};
  let etapas: { id: string; name: string }[] = [];
  let tagVip = "";
  let tagSistema = "";
  /** Una hora fija para los empates (la misma en varios chats). */
  const empate = new Date(Date.now() - 30 * 60_000);

  async function chat(
    clave: string,
    o: {
      nombre?: string;
      tel?: string;
      minutos?: number;
      cuando?: Date;
      sinMensajes?: boolean;
      archivado?: boolean;
      noLeidos?: number;
      humano?: boolean;
      anuncio?: boolean;
      etapa?: number;
      vip?: boolean;
      sistema?: boolean;
      asignado?: string;
      campana?: boolean;
      canal?: "whatsapp" | "messenger";
    } = {}
  ) {
    const contactId = newId("contact");
    const conversationId = newId("conversation");
    const tel = o.tel ?? `5255${Math.floor(1e7 + Math.random() * 9e7)}`;
    const cuando = o.cuando ?? new Date(Date.now() - (o.minutos ?? 1) * 60_000);
    await runWithOrganization(A.id, async () => {
      const db = getDb();
      await db.insert(schema.contact).values({
        id: contactId,
        organizationId: A.id,
        channel: o.canal ?? "whatsapp",
        waIdentity: tel,
        phone: tel,
        name: o.nombre ?? `Cliente ${clave}`,
        assignedUserId: o.asignado ?? null,
      });
      await db.insert(schema.conversation).values({
        id: conversationId,
        organizationId: A.id,
        contactId,
        channel: o.canal ?? "whatsapp",
        unreadCount: o.noLeidos ?? 0,
        lastInboundAt: cuando,
        lastMessageAt: o.sinMensajes ? null : cuando,
        createdAt: o.sinMensajes ? cuando : new Date(cuando.getTime() - 86_400_000),
        archivedAt: o.archivado ? new Date() : null,
        handoffAt: o.humano ? cuando : null,
        handoffReason: o.humano ? "cliente" : null,
        campaignPendingId: o.campana ? "cmp_x" : null,
      });
      if (o.etapa !== undefined) {
        await db.insert(schema.lead).values({ id: newId("lead"), organizationId: A.id, contactId, stageId: etapas[o.etapa]!.id });
      }
      if (o.vip) await db.insert(schema.contactTagAssignment).values({ organizationId: A.id, contactId, tagId: tagVip });
      if (o.sistema) await db.insert(schema.contactTagAssignment).values({ organizationId: A.id, contactId, tagId: tagSistema });
      if (o.anuncio) {
        await db.insert(schema.adAttribution).values({
          id: newId("adAttribution"),
          organizationId: A.id,
          contactId,
          conversationId,
          headline: "Promo",
          sourceId: "ad_1",
          sourceType: "ad",
          raw: {},
        });
      }
    });
    conv[clave] = conversationId;
  }

  beforeAll(async () => {
    A = await crearOrganizacion("Paginada A");
    const sys = getSystemDb();
    for (const id of [owner, asesor, otro]) {
      await sys.insert(schema.user).values({ id, name: `Persona ${id}`, email: `${id}@x.test`, emailVerified: true });
    }
    await runWithOrganization(A.id, async () => {
      const db = getDb();
      etapas = await db
        .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
        .from(schema.pipelineStage)
        .where(eq(schema.pipelineStage.organizationId, A.id))
        .orderBy(schema.pipelineStage.position);
      tagVip = newId("contactTag");
      tagSistema = newId("contactTag");
      await db.insert(schema.contactTag).values([
        { id: tagVip, organizationId: A.id, name: "VIP", color: "azul" },
        { id: tagSistema, organizationId: A.id, name: "Importados", color: "gris", systemOrigin: "import" },
      ]);
    });
    await chat("jose", { nombre: "José Núñez", tel: "524621349768", minutos: 1, noLeidos: 2, etapa: 0, vip: true });
    await chat("maria", { nombre: "MARÍA López", minutos: 2, etapa: 1, asignado: asesor, anuncio: true });
    await chat("arch", { nombre: "Ana Archivada", minutos: 3, archivado: true, noLeidos: 1, etapa: 0, asignado: asesor });
    await chat("humano", { minutos: 4, humano: true, asignado: otro, vip: true });
    await chat("msgr", { nombre: "Pedro Messenger", minutos: 5, canal: "messenger", noLeidos: 3 });
    await chat("sistema", { minutos: 6, sistema: true });
    await chat("camp", { nombre: "Juan Campaña", minutos: 7, campana: true, vip: true });
    await chat("camp2", { minutos: 8, campana: true, canal: "messenger", asignado: asesor });
    // Empates exactos en la hora: el id decide.
    for (let i = 0; i < 5; i++) await chat(`empate${i}`, { cuando: empate, noLeidos: i % 2, asignado: i % 2 ? asesor : undefined });
    await chat("sin-mensajes", { cuando: new Date(Date.now() - 40 * 60_000), sinMensajes: true, etapa: 1 });
    for (let i = 0; i < 12; i++) await chat(`relleno${i}`, { minutos: 50 + i, anuncio: i % 4 === 0, humano: i % 5 === 0, etapa: i % 3 === 0 ? 0 : undefined });
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    const sys = getSystemDb();
    for (const id of [owner, asesor, otro]) await sys.delete(schema.user).where(eq(schema.user.id, id));
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const enA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);

  async function todasLasPaginas(access: Access, q: ListQuery, limit: number) {
    const filas: ConversationDto[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const { decodeCursor } = await import("@/server/inbox/cursor");
      const c = decodeCursor(cursor);
      if (c === "invalid") throw new Error("cursor inválido");
      const page = await enA(() => listConversationsPage(access, q.view, q, { limit, cursor: c }));
      expect(page.conversations.length).toBeLessThanOrEqual(limit);
      filas.push(...page.conversations);
      cursor = page.nextCursor;
      if (++paginas > 100) throw new Error("no termina");
    } while (cursor);
    return filas;
  }

  const q = (over: Partial<ListQuery> = {}): ListQuery => ({ view: "main", status: "all", ...DEFAULT_FILTERS, ...over });

  const CASOS: [string, Partial<ListQuery>][] = [
    ["Todas", {}],
    ["No leídas", { status: "unread" }],
    ["Archivados", { status: "archived" }],
    ["Atención humana", { status: "humano" }],
    ["Anuncios", { status: "anuncios" }],
    ["Campañas", { view: "campaigns" }],
    ["búsqueda sin acentos ni mayúsculas", { q: "jose nunez" }],
    ["búsqueda con acentos", { q: "María" }],
    ["búsqueda por teléfono como se ve", { q: "+52 462 134 9768" }],
    ["búsqueda de 2 dígitos (no es teléfono)", { q: "46" }],
    ["etapa", { stage: "Etapa 0" }],
    ["etiqueta visible", { tag: "" }],
    ["etiqueta de sistema (no filtra por ella)", { tag: "" }],
    ["mías", { owner: "mine" }],
    ["sin asignar", { owner: "unassigned" }],
    ["de un asesor", { owner: "" }],
    ["bandeja Messenger", { channel: "messenger" }],
    ["Campañas en Messenger", { view: "campaigns", channel: "messenger" }],
    ["varios a la vez", { status: "unread", stage: "Etapa 0", channel: "whatsapp" }],
  ];

  /** Los valores que dependen de lo sembrado (ids de etiqueta y de persona). */
  function caso(nombre: string, over: Partial<ListQuery>): ListQuery {
    if (nombre === "etiqueta visible") return q({ tag: tagVip });
    if (nombre === "etiqueta de sistema (no filtra por ella)") return q({ tag: tagSistema });
    if (nombre === "de un asesor") return q({ owner: asesor });
    return q(over);
  }

  it.each(CASOS)("Propietario · %s: las páginas = la regla del navegador sobre la lista completa", async (nombre, over) => {
    const consulta = caso(nombre, over);
    const completa = await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, consulta.view));
    const esperada = completa.filter((c) => matchesListQuery(c, consulta, owner));
    for (const limit of [1, 4, 50]) {
      const paginas = await todasLasPaginas(ownerA(), consulta, limit);
      expect(paginas.map((c) => c.id)).toEqual(esperada.map((c) => c.id));
    }
    // Y las filas paginadas son idénticas a las de la lista completa.
    const una = await todasLasPaginas(ownerA(), consulta, 4);
    expect(una).toEqual(esperada);
  });

  it("sin filtros, las páginas recorren la principal entera (con empates y sin mensajes)", async () => {
    const completa = await enA(() => listConversations(ownerA()));
    const paginas = await todasLasPaginas(ownerA(), q({ status: "all" }), 3);
    // «Todas» deja fuera los archivados; la lista completa los trae.
    expect(paginas.map((c) => c.id)).toEqual(completa.filter((c) => !c.archivedAt).map((c) => c.id));
    expect(new Set(paginas.map((c) => c.id)).size).toBe(paginas.length);
    expect(paginas.some((c) => c.id === conv["sin-mensajes"])).toBe(true);
    const empates = paginas.filter((c) => c.lastMessageAt === empate.toISOString()).map((c) => c.id);
    expect(empates.length).toBe(5);
    expect(empates).toEqual([...empates].sort().reverse());
  });

  it("asesor: por páginas solo lo suyo, igual que su lista completa", async () => {
    for (const [nombre, over] of CASOS) {
      const consulta = caso(nombre, over);
      const completa = await enA(() => listConversations(asesorA(), undefined, { kind: "all" }, consulta.view));
      // El asesor no filtra por persona: su servidor ya le manda lo suyo.
      const regla = { ...consulta, owner: "all" };
      const paginas = await todasLasPaginas(asesorA(), consulta, 2);
      expect(paginas.map((c) => c.id), nombre).toEqual(completa.filter((c) => matchesListQuery(c, regla, asesor)).map((c) => c.id));
    }
    const suyas = await todasLasPaginas(asesorA(), q(), 50);
    expect(suyas.every((c) => c.assignee?.id === asesor)).toBe(true);
  });

  it("un chat que sube a la cima mientras se baja no se repite", async () => {
    const primera = await enA(() => listConversationsPage(ownerA(), "main", q(), { limit: 5, cursor: null }));
    const { decodeCursor } = await import("@/server/inbox/cursor");
    const resto: ConversationDto[] = [];
    // Uno de MÁS ABAJO recibe un mensaje: pasa a ser el primero.
    const sube = conv["relleno5"]!;
    await enA(() =>
      getDb()
        .update(schema.conversation)
        .set({ lastMessageAt: new Date(Date.now() + 60_000) })
        .where(and(eq(schema.conversation.organizationId, A.id), eq(schema.conversation.id, sube)))
    );
    let cursor = primera.nextCursor;
    while (cursor) {
      const c = decodeCursor(cursor);
      if (c === "invalid" || c === null) throw new Error("cursor");
      const page = await enA(() => listConversationsPage(ownerA(), "main", q(), { limit: 5, cursor: c }));
      resto.push(...page.conversations);
      cursor = page.nextCursor;
    }
    const ids = [...primera.conversations, ...resto].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // No vuelve más abajo: el refresco por chat lo pone arriba.
    expect(resto.some((c) => c.id === sube)).toBe(false);
    // Lo devuelve a su lugar para las demás pruebas.
    await enA(() =>
      getDb()
        .update(schema.conversation)
        .set({ lastMessageAt: new Date(Date.now() - 55 * 60_000) })
        .where(and(eq(schema.conversation.organizationId, A.id), eq(schema.conversation.id, sube)))
    );
  });

  /** Lo que antes contaba el navegador con la lista completa (conversation-list.tsx). */
  function contarComoAntes(principal: ConversationDto[], campanas: ConversationDto[], f: ListQuery, viewerId: string) {
    const cuenta = (lista: ConversationDto[], over: Partial<ListQuery>) =>
      lista.filter((c) => matchesListQuery(c, { ...f, ...over }, viewerId)).length;
    const channels: Record<string, number> = {};
    for (const ch of CHANNEL_ORDER) channels[ch] = cuenta(principal, { status: "all", channel: ch });
    return {
      total: principal.length,
      all: cuenta(principal, { status: "all" }),
      unread: cuenta(principal, { status: "unread" }),
      archived: cuenta(principal, { status: "archived" }),
      humano: cuenta(principal, { status: "humano" }),
      anuncios: cuenta(principal, { status: "anuncios" }),
      campaigns: cuenta(campanas, { view: "campaigns" }),
      campaignPending: campanas.length,
      channels,
    };
  }

  it.each([
    ["sin filtros", {}],
    ["búsqueda", { q: "maria" }],
    ["etapa", { stage: "Etapa 0" }],
    ["bandeja Messenger", { channel: "messenger" as const }],
    ["mías", { owner: "mine" }],
  ] as [string, Partial<ListQuery>][])("contadores (%s) = los de la lista completa", async (_n, over) => {
    for (const [access, viewer] of [
      [ownerA(), owner],
      [asesorA(), asesor],
    ] as const) {
      const f = q(access.seesAll ? over : { ...over, owner: "all" });
      const principal = await enA(() => listConversations(access));
      const campanas = await enA(() => listConversations(access, undefined, { kind: "all" }, "campaigns"));
      const counts = await enA(() => countConversations(access, f));
      expect(counts).toMatchObject(contarComoAntes(principal, campanas, f, viewer));
    }
  });

  it("contadores: lo que ofrecen los selectores y el «número no registrado»", async () => {
    const principal = await enA(() => listConversations(ownerA()));
    const counts = await enA(() => countConversations(ownerA(), q({ q: "4621349768" })));
    // Etapas presentes en el orden en que aparecen en la lista.
    const etapasEnLista: string[] = [];
    for (const c of principal) if (c.stageName && !etapasEnLista.includes(c.stageName)) etapasEnLista.push(c.stageName);
    expect(counts.stages).toEqual(etapasEnLista);
    // Solo la etiqueta visible (la de sistema no sale en la fila).
    expect(counts.tags).toEqual([[tagVip, "VIP"]]);
    expect(new Map(counts.owners)).toEqual(
      new Map(principal.filter((c) => c.assignee).map((c) => [c.assignee!.id, c.assignee!.name]))
    );
    expect(counts.queryHits).toBe(1);
    const nadie = await enA(() => countConversations(ownerA(), q({ q: "5599 0000 1111" })));
    expect(nadie.queryHits).toBe(0);
  });
});
