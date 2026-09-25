/**
 * Self-test E2E de 020 — roles y asignación de chats (tests/e2e/us-roles.md).
 *
 * Conduce la app REAL con cuatro sesiones a la vez (propietario, coordinador y
 * dos asesores) contra la BD de verdad: lo que en los unit tests es un SQL
 * inspeccionado, aquí es un 404 que regresa Postgres.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      OPENROUTER_BASE_URL → ai-mock y BD migrada
 *   2) node --env-file=.env scripts/e2e-roles.mjs
 *
 * Re-ejecutable: las cuentas del equipo se reutilizan (y se les devuelve su
 * rol) y cada corrida usa teléfonos nuevos. Sale con 1 si algo falla.
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-E2E-ROLES";
const RUN = Date.now().toString().slice(-7);

let failures = 0;
let checks = 0;

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Un cliente HTTP con su propia cookie: una persona distinta cada uno. */
function cliente(nombre) {
  let cookie = "";
  async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...opts,
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  }
  return { nombre, api, cookie: () => cookie };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const PASSWORD = "password-e2e-roles-123";
/** El propietario es el MISMO de `e2e-selftest.mjs`: comparten instancia. */
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };

async function entrar(c, email, name, password = PASSWORD) {
  let r = await c.api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!r.res.ok && name) {
    r = await c.api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
  }
  return r.res.ok;
}

/** Abre /api/events y junta lo que llegue. `cerrar()` devuelve los eventos. */
function escuchar(c) {
  const ctl = new AbortController();
  const eventos = [];
  const listo = (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, {
        headers: { cookie: c.cookie() },
        signal: ctl.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const bloque = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(bloque)?.[1];
          const data = /^data: (.+)$/m.exec(bloque)?.[1];
          if (type && data) eventos.push({ type, data: JSON.parse(data) });
        }
      }
    } catch {
      // abortado
    }
  })();
  return {
    eventos,
    cerrar: async () => {
      ctl.abort();
      await listo;
      return eventos;
    },
  };
}

async function entrante(c, from, name, text) {
  return c.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({
      phoneNumberId: PN,
      from,
      name,
      text,
      waMessageId: `wamid.roles.${from}.${Math.random().toString(36).slice(2)}`,
    }),
  });
}

async function conversaciones(c) {
  return (await c.api("/api/conversations")).json?.conversations ?? [];
}

async function main() {
  const owner = cliente("propietario");
  const coord = cliente("coordinador");
  const asesorA = cliente("asesor A");
  const asesorB = cliente("asesor B");

  console.log("== Setup: propietario, WhatsApp y agente ==");
  ok(
    "propietario entra (registro o login)",
    await entrar(owner, OWNER.email, OWNER.name, OWNER.password)
  );
  const conn = await owner.api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-ROLES", phoneNumberId: PN, token: "tok-roles" }),
  });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, JSON.stringify(conn.json));
  const agente = await owner.api("/api/agent/profile", {
    method: "PUT",
    body: JSON.stringify({ enabled: true }),
  });
  ok("agente encendido (para el handoff)", agente.res.ok, JSON.stringify(agente.json));

  console.log("\n== El propietario arma el equipo con roles ==");
  const equipo = [
    [coord, "coord.e2e@vocero.test", "Coordinadora E2E", "coordinador"],
    [asesorA, "asesor.a.e2e@vocero.test", "Asesor A E2E", "asesor"],
    [asesorB, "asesor.b.e2e@vocero.test", "Asesor B E2E", "asesor"],
  ];
  for (const [, email, name, role] of equipo) {
    const alta = await owner.api("/api/settings/team", {
      method: "POST",
      body: JSON.stringify({ name, email, password: PASSWORD, role }),
    });
    ok(`alta de ${name} como ${role}`, alta.res.status === 201 || alta.res.status === 409,
      `status=${alta.res.status}`);
  }
  let miembros = (await owner.api("/api/settings/team")).json?.members ?? [];
  // Re-corrida: devolver a cada quien su rol por si otra corrida lo cambió.
  for (const [, email, , role] of equipo) {
    const m = miembros.find((x) => x.email === email);
    if (m && m.role !== role) {
      await owner.api(`/api/settings/team/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    }
  }
  miembros = (await owner.api("/api/settings/team")).json?.members ?? [];
  const idDe = (email) => miembros.find((m) => m.email === email)?.userId;
  const ID_A = idDe("asesor.a.e2e@vocero.test");
  const ID_B = idDe("asesor.b.e2e@vocero.test");
  ok("el propietario sigue siendo propietario",
    miembros.find((m) => m.email === "e2e@vocero.test")?.role === "owner");
  ok("roles guardados", miembros.find((m) => m.userId === ID_A)?.role === "asesor" &&
    miembros.find((m) => m.email === "coord.e2e@vocero.test")?.role === "coordinador");
  for (const [c, email] of equipo) {
    ok(`${c.nombre} inicia sesión`, await entrar(c, email));
  }

  // Lo que el asesor A tuviera de corridas anteriores se libera, para que
  // cada corrida empiece con la bandeja de A y B vacías de lo viejo.
  await coord.api("/api/assignments/bulk", {
    method: "POST",
    body: JSON.stringify({ fromUserId: ID_A, toUserId: null }),
  });
  await coord.api("/api/assignments/bulk", {
    method: "POST",
    body: JSON.stringify({ fromUserId: ID_B, toUserId: null }),
  });

  console.log("\n== Un lead nuevo llega SIN ASIGNAR ==");
  const tel1 = `52155${RUN}01`;
  const nombre1 = `Cliente Roles ${RUN}`;
  // El asesor A escucha el canal en vivo desde antes de que llegue nada.
  const oidoA = escuchar(asesorA);
  await sleep(500);
  ok("mensaje entrante (wa-mock)", (await entrante(owner, tel1, nombre1, "hola, info por favor")).res.ok);
  let conv1 = null;
  await hasta(async () => {
    conv1 = (await conversaciones(owner)).find((c) => c.contact.name === nombre1);
    return !!conv1;
  });
  ok("el propietario ve la conversación", !!conv1);
  ok("llega sin asignar", conv1?.assignee === null, JSON.stringify(conv1?.assignee));
  ok("el asesor A NO la ve (no ve lo sin asignar)",
    !(await conversaciones(asesorA)).some((c) => c.id === conv1?.id));
  const contactId = conv1?.contact.id;

  console.log("\n== El coordinador la asigna al asesor A ==");
  const asig = await coord.api("/api/assignments", {
    method: "POST",
    body: JSON.stringify({ contactIds: [contactId], userId: ID_A }),
  });
  ok("coordinador asigna (200)", asig.res.ok && asig.json?.changed === 1, JSON.stringify(asig.json));
  await sleep(600);
  const eventosA = await oidoA.cerrar();
  ok(
    "por SSE, A NO recibió el mensaje mientras no era suyo",
    !eventosA.some((e) => e.type === "message.new" && e.data.conversationId === conv1?.id),
    JSON.stringify(eventosA.map((e) => e.type))
  );
  ok(
    "por SSE, A SÍ recibió que se lo asignaron",
    eventosA.some((e) => e.type === "assignment.changed" && e.data.toUserId === ID_A),
    JSON.stringify(eventosA.map((e) => e.type))
  );
  const deA = await conversaciones(asesorA);
  ok("A ahora la ve", deA.some((c) => c.id === conv1?.id));
  ok("…marcada como suya", deA.find((c) => c.id === conv1?.id)?.assignee?.id === ID_A);
  ok("B no la ve", !(await conversaciones(asesorB)).some((c) => c.id === conv1?.id));

  console.log("\n== B no puede leer ni tocar el lead de A (404 de la BD real) ==");
  const boardA = (await asesorA.api("/api/pipeline/board")).json;
  const leadA = boardA?.leads?.find((l) => l.contact.id === contactId);
  ok("el lead está en el tablero de A", !!leadA);
  const boardB = (await asesorB.api("/api/pipeline/board")).json;
  ok("…y no en el de B", !boardB?.leads?.some((l) => l.contact.id === contactId));
  const intentosB = [
    ["ficha del contacto", `/api/contacts/${contactId}`, "GET"],
    ["historial de asignación", `/api/contacts/${contactId}/assignments`, "GET"],
    ["mensajes", `/api/conversations/${conv1?.id}/messages`, "GET"],
    ["escribir en el chat", `/api/conversations/${conv1?.id}/messages`, "POST", { text: "hola" }],
    ["marcar leído", `/api/conversations/${conv1?.id}`, "PATCH", { markRead: true }],
    ["mover el lead", `/api/pipeline/leads/${leadA?.id}`, "PATCH", { priority: "alta" }],
    ["editar notas", `/api/contacts/${contactId}`, "PATCH", { notes: "de B" }],
  ];
  for (const [nombre, path, method, body] of intentosB) {
    const r = await asesorB.api(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    ok(`B → ${nombre}: 404`, r.res.status === 404, `status=${r.res.status}`);
  }
  const busquedaB = (await asesorB.api(`/api/contacts?q=${encodeURIComponent(nombre1)}`)).json;
  ok("B no lo encuentra en Contactos", (busquedaB?.contacts ?? []).length === 0);
  // Dar de alta el mismo teléfono tampoco le confirma que existe…
  const altaB = await asesorB.api("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Intento de B", phone: tel1 }),
  });
  ok(
    "B da de alta ese teléfono → error genérico (422, sin «ya existe»)",
    altaB.res.status === 422 && altaB.json?.error?.code === "invalid" &&
      !/existe|duplic/i.test(JSON.stringify(altaB.json)),
    `status=${altaB.res.status} ${JSON.stringify(altaB.json)}`
  );
  // …pero a quien sí lo ve (A, su asesor) se le dice que es un duplicado.
  const altaA = await asesorA.api("/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: "Intento de A", phone: tel1 }),
  });
  ok(
    "A (su asesor) da de alta ese teléfono → 409 duplicado",
    altaA.res.status === 409 && altaA.json?.error?.code === "duplicate",
    `status=${altaA.res.status} ${JSON.stringify(altaA.json)}`
  );

  console.log("\n== A trabaja SU lead, pero no configura nada ==");
  const etapas = (await asesorA.api("/api/pipeline/stages")).json?.stages ?? [];
  const abierta = etapas.filter((s) => s.kind === "open")[1];
  const mover = await asesorA.api(`/api/pipeline/leads/${leadA?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ stageId: abierta?.id, position: 0 }),
  });
  ok("A mueve su lead de etapa (200)", mover.res.ok, JSON.stringify(mover.json));
  const prohibidas = [
    ["crear etapa", "/api/pipeline/stages", "POST", { name: "Etapa de A" }],
    ["editar etapa", `/api/pipeline/stages/${abierta?.id}`, "PATCH", { name: "x" }],
    ["sincronizar plantillas", "/api/templates/sync", "POST", {}],
    ["subir plantilla", "/api/templates", "POST", { name: "x" }],
    ["cambiar marca", "/api/settings/branding", "PUT", { businessName: "x" }],
    ["ver WhatsApp", "/api/settings/whatsapp", "GET"],
    ["ver webhook", "/api/settings/webhook", "GET"],
    ["cambiar agente", "/api/agent/profile", "PUT", { enabled: false }],
    ["ver usuarios", "/api/settings/team", "GET"],
    ["crear usuarios", "/api/settings/team", "POST", { name: "x", email: "x@x.mx", password: "12345678" }],
    ["asignar", "/api/assignments", "POST", { contactIds: [contactId], userId: ID_B }],
    ["reasignar en lote", "/api/assignments/bulk", "POST", { fromUserId: ID_A, toUserId: ID_B }],
    ["resultados de B", `/api/analytics/sales?userId=${ID_B}`, "GET"],
  ];
  for (const [nombre, path, method, body] of prohibidas) {
    const r = await asesorA.api(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    ok(`A → ${nombre}: 403`, r.res.status === 403, `status=${r.res.status}`);
  }
  // 022: el Asesor ya no entra a Resultados, ni a los suyos.
  const propios = await asesorA.api("/api/analytics/sales");
  ok("A → sus propios resultados: 403 (022)", propios.res.status === 403, `status=${propios.res.status}`);
  const paginaResultados = await asesorA.api("/results", { headers: { accept: "text/html" } });
  ok(
    "A abre /results → de vuelta a la Bandeja (022)",
    [302, 303, 307, 308].includes(paginaResultados.res.status) &&
      (paginaResultados.res.headers.get("location") ?? "").includes("/inbox"),
    `status=${paginaResultados.res.status} location=${paginaResultados.res.headers.get("location")}`
  );
  const pagina = await asesorA.api("/settings/whatsapp", { headers: { accept: "text/html" } });
  ok(
    "A abre /settings/whatsapp → de vuelta a la Bandeja",
    pagina.res.status >= 300 && pagina.res.status < 400 &&
      (pagina.res.headers.get("location") ?? "").includes("/inbox"),
    `status=${pagina.res.status} location=${pagina.res.headers.get("location")}`
  );

  console.log("\n== El coordinador: opera, pero no configura ==");
  const etapaNueva = await coord.api("/api/pipeline/stages", {
    method: "POST",
    body: JSON.stringify({ name: `Temporal ${RUN}` }),
  });
  ok("coordinador crea una etapa", etapaNueva.res.ok, `status=${etapaNueva.res.status}`);
  const idEtapa = etapaNueva.json?.stage?.id;
  if (idEtapa) {
    const borrar = await coord.api(`/api/pipeline/stages/${idEtapa}`, { method: "DELETE" });
    ok("…y la borra", borrar.res.ok, `status=${borrar.res.status}`);
  }
  for (const [nombre, path, method, body] of [
    ["cambiar marca", "/api/settings/branding", "PUT", { businessName: "x" }],
    ["ver WhatsApp", "/api/settings/whatsapp", "GET"],
    ["cambiar agente", "/api/agent/profile", "PUT", { enabled: false }],
    ["crear usuarios", "/api/settings/team", "POST", { name: "x", email: "x@x.mx", password: "12345678" }],
  ]) {
    const r = await coord.api(path, { method, body: body ? JSON.stringify(body) : undefined });
    ok(`coordinador → ${nombre}: 403`, r.res.status === 403, `status=${r.res.status}`);
  }
  const resA = await coord.api(`/api/analytics/sales?userId=${ID_A}`);
  ok("coordinador ve los resultados de A", resA.res.ok);
  ok("coordinador ve a todo el equipo", (await coord.api("/api/settings/team")).res.ok);

  console.log("\n== 021: exportar contactos y campañas por rol ==");
  const expCoord = await coord.api("/api/contacts/export");
  ok(
    "el coordinador exporta contactos (CSV)",
    expCoord.res.status === 200 &&
      /text\/csv/.test(expCoord.res.headers.get("content-type") ?? ""),
    `status=${expCoord.res.status}`
  );
  const expAsesor = await asesorA.api("/api/contacts/export");
  ok("el asesor NO exporta (403)", expAsesor.res.status === 403, `status=${expAsesor.res.status}`);
  const campAsesor = await asesorA.api("/api/campaigns");
  ok(
    "el asesor NO ve campañas (403: el permiso se valida antes que la bandera)",
    campAsesor.res.status === 403,
    `status=${campAsesor.res.status}`
  );

  console.log("\n== Handoff de la IA en un chat asignado ==");
  await entrante(owner, tel1, nombre1, "prefiero hablar con un humano");
  let enHandoff = null;
  const llego = await hasta(async () => {
    enHandoff = (await conversaciones(asesorA)).find((c) => c.id === conv1?.id);
    return !!enHandoff?.handoffAt;
  }, 20000);
  ok("la IA pasó el chat a humano", llego, JSON.stringify(enHandoff));
  ok("…y es del asesor A (a él le toca)", enHandoff?.assignee?.id === ID_A);

  console.log("\n== Reasignación en lote (A se va de vacaciones) ==");
  const tel2 = `52155${RUN}02`;
  const nombre2 = `Cliente Roles B ${RUN}`;
  await entrante(owner, tel2, nombre2, "hola");
  let conv2 = null;
  await hasta(async () => {
    conv2 = (await conversaciones(owner)).find((c) => c.contact.name === nombre2);
    return !!conv2;
  });
  await coord.api("/api/assignments", {
    method: "POST",
    body: JSON.stringify({ contactIds: [conv2?.contact.id], userId: ID_A }),
  });
  const lote = await coord.api("/api/assignments/bulk", {
    method: "POST",
    body: JSON.stringify({ fromUserId: ID_A, toUserId: ID_B, reason: "Vacaciones" }),
  });
  ok("lote A → B", lote.res.ok && lote.json?.changed === 2, JSON.stringify(lote.json));
  const deA2 = await conversaciones(asesorA);
  const deB2 = await conversaciones(asesorB);
  ok("A ya no ve sus chats", !deA2.some((c) => c.id === conv1?.id || c.id === conv2?.id));
  ok("B ahora los ve", deB2.some((c) => c.id === conv1?.id) && deB2.some((c) => c.id === conv2?.id));
  ok("A ya no puede leer el que era suyo (404)",
    (await asesorA.api(`/api/contacts/${contactId}`)).res.status === 404);

  const hist = (await owner.api(`/api/contacts/${contactId}/assignments`)).json;
  const eventos = hist?.history ?? [];
  ok("historial con los dos movimientos", eventos.length === 2, JSON.stringify(eventos));
  ok("1º: el coordinador lo asignó a A (desde sin asignar)",
    eventos[0]?.fromUser === null && eventos[0]?.toUser?.id === ID_A &&
      eventos[0]?.actor?.name === "Coordinadora E2E" && eventos[0]?.source === "manual");
  ok("2º: en lote de A a B, con el motivo",
    eventos[1]?.fromUser?.id === ID_A && eventos[1]?.toUser?.id === ID_B &&
      eventos[1]?.source === "lote" && eventos[1]?.reason === "Vacaciones");
  const histB = await asesorB.api(`/api/contacts/${contactId}/assignments`);
  ok("B (ahora dueño) puede leer el historial", histB.res.ok);

  console.log("\n== Propietario: roles del equipo ==");
  // Un lead sin asignar: el asesor no lo ve; como coordinador, sí.
  const tel3 = `52155${RUN}03`;
  const nombre3 = `Cliente Roles C ${RUN}`;
  await entrante(owner, tel3, nombre3, "hola");
  let conv3 = null;
  await hasta(async () => {
    conv3 = (await conversaciones(owner)).find((c) => c.contact.name === nombre3);
    return !!conv3;
  });
  ok("B (asesor) no ve el lead sin asignar",
    !(await conversaciones(asesorB)).some((c) => c.id === conv3?.id));
  const mB = miembros.find((m) => m.userId === ID_B);
  const sube = await owner.api(`/api/settings/team/${mB?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "coordinador" }),
  });
  ok("propietario sube a B a coordinador", sube.res.ok);
  ok("…y B, ya coordinador, ve lo sin asignar (el rol se lee en cada petición)",
    (await conversaciones(asesorB)).some((c) => c.id === conv3?.id));
  await owner.api(`/api/settings/team/${mB?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "asesor" }),
  });
  ok("de vuelta a asesor, deja de verlo",
    !(await conversaciones(asesorB)).some((c) => c.id === conv3?.id));
  const mOwner = miembros.find((m) => m.role === "owner");
  const degradar = await owner.api(`/api/settings/team/${mOwner?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "asesor" }),
  });
  ok("el propietario no se puede degradar", degradar.res.status === 422);
  const coordRoles = await coord.api(`/api/settings/team/${mB?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "coordinador" }),
  });
  ok("el coordinador no cambia roles (403)", coordRoles.res.status === 403);

  console.log(`\n===== ${checks - failures}/${checks} checks OK, ${failures} fallos =====`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
