import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { sessionContext } from "@/lib/auth/session";
import {
  NewNumberError,
  openChat,
  registerContact,
  sendFirstTemplate,
} from "@/server/inbox/new-number";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError, sendText } from "@/server/inbox/send";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * «Número no registrado» contra Postgres real: registrar desde la búsqueda,
 * no duplicar con formatos distintos, escribir primero SOLO con plantilla
 * aprobada y con consentimiento, la baja (`opt_out`) y `consent_override`,
 * texto libre sin ventana, sandbox y aislamiento entre organizaciones.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

describe("número no registrado (Bandeja)", () => {
  let A: Org;
  let B: Org;
  let owner: string;
  let asesor1: string;
  let asesor2: string;
  let asesorB: string;
  let approved: string;
  let pending: string;
  let calls: { url: string; body: Record<string, unknown> }[];

  const inA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);
  const ownerS = () => sessionContext(owner, A.id, "owner");
  const asesor1S = () => sessionContext(asesor1, A.id, "asesor");
  const asesor2S = () => sessionContext(asesor2, A.id, "asesor");
  const coordS = () => sessionContext(owner, A.id, "coordinador");

  beforeAll(async () => {
    A = await crearOrganizacion("Num A");
    B = await crearOrganizacion("Num B");
    const sys = getSystemDb();
    const mkUser = async (org: string, role: string) => {
      const id = newId("user");
      await sys.insert(schema.user).values({ id, name: role, email: `${id}@x.test`, emailVerified: true });
      await sys.insert(schema.member).values({ id: newId("member"), organizationId: org, userId: id, role });
      return id;
    };
    owner = await mkUser(A.id, "owner");
    asesor1 = await mkUser(A.id, "asesor");
    asesor2 = await mkUser(A.id, "asesor");
    asesorB = await mkUser(B.id, "asesor");
    const tpl = (name: string, status: "approved" | "pending") =>
      inA(async () => {
        const id = newId("template");
        await getDb().insert(schema.template).values({
          id,
          organizationId: A.id,
          name,
          language: "es_MX",
          category: "UTILITY",
          body: "Hola {{1}}, te escribimos de la tienda",
          status,
        });
        return id;
      });
    approved = await tpl("saludo", "approved");
    pending = await tpl("en_revision", "pending");
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    const sys = getSystemDb();
    for (const id of [owner, asesor1, asesor2, asesorB]) {
      await sys.delete(schema.user).where(eq(schema.user.id, id));
    }
  });

  /** Meta falso: cuenta lo que SALDRÍA y responde como la Graph API. */
  function stubMeta() {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
        return new Response(JSON.stringify({ messages: [{ id: `wamid.${newId("message")}` }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  async function contactsWith(org: Org, phone: string) {
    return runWithOrganization(org.id, () =>
      getDb()
        .select()
        .from(schema.contact)
        .where(and(eq(schema.contact.organizationId, org.id), eq(schema.contact.waIdentity, phone)))
    );
  }

  it("registra desde la búsqueda: contacto + lead en la primera etapa; sin nombre, el nombre es el teléfono", async () => {
    const r = await inA(() => registerContact(ownerS(), { phone: "55 1111 2222" }));
    expect(r.created).toBe(true);
    expect(r.contact.waIdentity).toBe("525511112222");
    expect(r.contact.name).toBe("525511112222"); // jamás vacío
    expect(r.contact.waConsent).toBe("desconocido");
    const leads = await inA(() =>
      getDb().select().from(schema.lead).where(eq(schema.lead.contactId, r.contact.id))
    );
    expect(leads).toHaveLength(1);

    const conName = await inA(() =>
      registerContact(ownerS(), { phone: "+52 55 3333 4444", name: "  Lupita  " })
    );
    expect(conName.contact.name).toBe("Lupita");
  });

  it("un asesor se queda con el contacto que registra; quien reparte puede asignarlo", async () => {
    const mine = await inA(() => registerContact(asesor1S(), { phone: "5522220001", assignToUserId: asesor2 }));
    // El asesor no elige a quién: se lo queda aunque mande otro.
    expect(mine.contact.assignedUserId).toBe(asesor1);
    const given = await inA(() => registerContact(coordS(), { phone: "5522220002", assignToUserId: asesor2 }));
    expect(given.contact.assignedUserId).toBe(asesor2);
    await expect(
      inA(() => registerContact(coordS(), { phone: "5522220003", assignToUserId: asesorB }))
    ).rejects.toMatchObject({ code: "bad_assignee" });
  });

  it("no duplica con formatos distintos del mismo número (521…, 52…, +52, 10 dígitos)", async () => {
    const formatos = ["5215599990000", "525599990000", "+52 55 9999 0000", "(55) 9999-0000", "55 9999 0000"];
    const ids = new Set<string>();
    for (const f of formatos) {
      const r = await inA(() => registerContact(ownerS(), { phone: f }));
      ids.add(r.contact.id);
    }
    expect(ids.size).toBe(1);
    expect(await contactsWith(A, "525599990000")).toHaveLength(1);
    expect(await contactsWith(A, "5215599990000")).toHaveLength(0);
  });

  it("rechaza lo que no es un número de WhatsApp registrable", async () => {
    for (const bad of ["12345", "555 1234", "+52 55 1234", "1234567890123456"]) {
      await expect(inA(() => registerContact(ownerS(), { phone: bad }))).rejects.toMatchObject({
        code: "invalid_phone",
      });
    }
  });

  it("abrir chat: registra si hace falta y crea la conversación vacía (sin ventana); es idempotente", async () => {
    const a = await inA(() => openChat(asesor1S(), "55 4444 5555"));
    expect(a.created).toBe(true);
    const b = await inA(() => openChat(asesor1S(), "+525544445555"));
    expect(b.created).toBe(false);
    expect(b.conversationId).toBe(a.conversationId);
    const [conv] = await inA(() =>
      getDb().select().from(schema.conversation).where(eq(schema.conversation.id, a.conversationId))
    );
    expect(conv?.lastInboundAt).toBeNull();
    expect(conv?.isTest).toBe(false);
  });

  it("sin ventana abierta NO se puede enviar texto libre (solo plantilla)", async () => {
    stubMeta();
    const { conversationId } = await inA(() => openChat(ownerS(), "55 6666 7777"));
    await expect(
      inA(() => sendText({ conversationId, organizationId: A.id, text: "hola" }))
    ).rejects.toMatchObject({ code: "window_closed" });
    expect(calls).toHaveLength(0);
  });

  it("enviar: «No lo sé» no envía y no registra nada", async () => {
    stubMeta();
    await expect(
      inA(() =>
        sendFirstTemplate(ownerS(), {
          phone: "55 7777 8888",
          templateId: approved,
          variables: ["Ana"],
          consent: "unknown",
        })
      )
    ).rejects.toMatchObject({ code: "consent_required" });
    expect(calls).toHaveLength(0);
    expect(await contactsWith(A, "525577778888")).toHaveLength(0);
  });

  it("enviar: «Sí aceptó» registra el consentimiento (con bitácora) y manda la plantilla por Meta", async () => {
    stubMeta();
    const r = await inA(() =>
      sendFirstTemplate(asesor1S(), {
        phone: "+52 55 8888 9999",
        templateId: approved,
        variables: ["Ana"],
        consent: "yes",
      })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ type: "template", to: "525588889999" });
    expect(r.contact.waConsent).toBe("opt_in");
    expect(r.contact.waConsentSource).toMatch(/Bandeja/);
    const eventos = await inA(() =>
      getDb()
        .select()
        .from(schema.contactActivityEvent)
        .where(
          and(
            eq(schema.contactActivityEvent.contactId, r.contact.id),
            eq(schema.contactActivityEvent.kind, "consent_changed")
          )
        )
    );
    expect(eventos).toHaveLength(1);
    const msgs = await inA(() =>
      getDb().select().from(schema.message).where(eq(schema.message.conversationId, r.conversationId))
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.direction).toBe("out");
  });

  it("enviar: una plantilla que no está aprobada no sale", async () => {
    stubMeta();
    await expect(
      inA(() =>
        sendFirstTemplate(ownerS(), {
          phone: "55 1212 3434",
          templateId: pending,
          variables: ["Ana"],
          consent: "yes",
        })
      )
    ).rejects.toBeInstanceOf(TemplateError);
    expect(calls).toHaveLength(0);
  });

  it("opt_out: el asesor no envía (403); con contacts.consent_override sí, declarando «Sí», y queda en la bitácora", async () => {
    stubMeta();
    const phone = "525512125656";
    const { contact } = await inA(() => registerContact(coordS(), { phone, assignToUserId: asesor1 }));
    await inA(() =>
      getDb().update(schema.contact).set({ waConsent: "opt_out" }).where(eq(schema.contact.id, contact.id))
    );
    await expect(
      inA(() =>
        sendFirstTemplate(asesor1S(), { phone, templateId: approved, variables: ["Ana"], consent: "yes" })
      )
    ).rejects.toMatchObject({ code: "opted_out", status: 403 });
    expect(calls).toHaveLength(0);

    // Con permiso, pero sin declarar «Sí»: tampoco.
    await expect(
      inA(() =>
        sendFirstTemplate(coordS(), { phone, templateId: approved, variables: ["Ana"], consent: "unknown" })
      )
    ).rejects.toMatchObject({ code: "consent_required" });
    expect(calls).toHaveLength(0);

    const r = await inA(() =>
      sendFirstTemplate(coordS(), { phone, templateId: approved, variables: ["Ana"], consent: "yes" })
    );
    expect(calls).toHaveLength(1);
    expect(r.contact.waConsent).toBe("opt_in");
    const [ev] = await inA(() =>
      getDb()
        .select()
        .from(schema.contactActivityEvent)
        .where(eq(schema.contactActivityEvent.contactId, contact.id))
    );
    expect(ev?.detail).toMatchObject({ from: "opt_out", to: "opt_in" });
  });

  it("is_test: la conversación de prueba jamás sale a Meta, y este flujo no la usa", async () => {
    stubMeta();
    const { contact } = await inA(() => registerContact(ownerS(), { phone: "525534345656" }));
    const testConvId = newId("conversation");
    await inA(() =>
      getDb().insert(schema.conversation).values({
        id: testConvId,
        organizationId: A.id,
        contactId: contact.id,
        isTest: true,
      })
    );
    await expect(
      inA(() =>
        sendTemplate({ organizationId: A.id, conversationId: testConvId, templateId: approved, variables: ["Ana"] })
      )
    ).rejects.toBeInstanceOf(SendError);
    expect(calls).toHaveLength(0);

    const r = await inA(() =>
      sendFirstTemplate(ownerS(), {
        phone: "525534345656",
        templateId: approved,
        variables: ["Ana"],
        consent: "yes",
      })
    );
    expect(r.conversationId).not.toBe(testConvId);
    expect(calls).toHaveLength(1);
  });

  it("un asesor no ve (ni se entera de) el contacto de otro asesor", async () => {
    const phone = "525577001122";
    await inA(() => registerContact(asesor1S(), { phone }));
    const err = await inA(() => registerContact(asesor2S(), { phone })).catch((e) => e);
    expect(err).toBeInstanceOf(NewNumberError);
    expect(err.code).toBe("forbidden_contact");
    expect(err.message).not.toMatch(/existe/i);
    // Y tampoco puede mandarle una plantilla.
    stubMeta();
    await expect(
      inA(() =>
        sendFirstTemplate(asesor2S(), { phone, templateId: approved, variables: ["Ana"], consent: "yes" })
      )
    ).rejects.toBeInstanceOf(NewNumberError);
    expect(calls).toHaveLength(0);
  });

  it("aislamiento entre organizaciones (RLS): el mismo número en B es OTRO contacto y A no lo ve", async () => {
    const phone = "525500990011";
    const enA = await inA(() => registerContact(ownerS(), { phone }));
    const sB = sessionContext(asesorB, B.id, "asesor");
    const enB = await runWithOrganization(B.id, () => registerContact(sB, { phone }));
    expect(enB.created).toBe(true);
    expect(enB.contact.id).not.toBe(enA.contact.id);
    expect(await contactsWith(A, phone)).toHaveLength(1);
    expect(await contactsWith(B, phone)).toHaveLength(1);
    // B no puede usar la plantilla de A.
    stubMeta();
    await expect(
      runWithOrganization(B.id, () =>
        sendFirstTemplate(sB, { phone, templateId: approved, variables: ["Ana"], consent: "yes" })
      )
    ).rejects.toBeInstanceOf(TemplateError);
    expect(calls).toHaveLength(0);
    // Y las filas de A son invisibles desde el contexto de B.
    const vistas = await runWithOrganization(B.id, () =>
      getDb().select().from(schema.contact).where(eq(schema.contact.id, enA.contact.id))
    );
    expect(vistas).toHaveLength(0);
  });

  it("getOrCreateConversation no duplica la conversación", async () => {
    const { contact } = await inA(() => registerContact(ownerS(), { phone: "525500770088" }));
    const a = await inA(() => getOrCreateConversation(A.id, contact.id));
    const b = await inA(() => getOrCreateConversation(A.id, contact.id));
    expect(a.id).toBe(b.id);
  });
});
