import assert from "node:assert/strict";
import { test } from "node:test";
import { businessDate } from "../src/integration/remote-crm-contract";
import {
  allowsRemoteRequest,
  RemoteAuthRepository,
  RemoteHttpError,
  requiresRemoteLogin,
} from "../src/integration/remote-http";

const iso = "2026-11-23T20:00:00.000Z";
const day = "/api/bookings?from=2026-11-23&to=2026-11-23";
const contact = {
  id: "ct_1",
  name: "Contacto ficticio",
  phone: null,
  assignedUserId: "usr_1",
  tags: [{ id: "tag_system", name: "Importación", system: true }],
  ficha: { extra: "No se utiliza" },
};
const tags = { tags: [{ id: "tag_1", name: "Consulta" }] };
const team = {
  members: [
    {
      userId: "usr_1",
      name: "Persona ficticia",
      email: "fixture@example.test",
    },
  ],
};
const task = {
  id: "tsk_1",
  title: "Revisar",
  description: null,
  assignee: null,
  doneAt: null,
  canEdit: true,
};
const booking = {
  id: "bk_1",
  kind: "session",
  status: "agendada",
  date: "2026-11-23",
  time: "15:00",
  scheduledAtUtc: iso,
  contact: null,
};
const note = {
  id: "act_1",
  kind: "note",
  at: iso,
  detail: { text: "Texto ficticio" },
};

type Call = readonly [method: string, path: string, body?: unknown];
type Outcome = { status: number; payload?: unknown };
async function setup(
  writable = true,
  responder: (call: Call) => Outcome | Promise<Outcome> = () => ({
    status: 200,
    payload: {},
  }),
) {
  const calls: Call[] = [];
  let secure: string | null = null;
  const repo = new RemoteAuthRepository(
    "staging",
    "http://127.0.0.1:1",
    {
      get: async () => secure,
      set: async (_key, value) => {
        secure = value;
      },
      remove: async () => {
        secure = null;
      },
    },
    async (url, init) => {
      const path = url.replace("http://127.0.0.1:1", "");
      const headers = new Headers(init.headers);
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(headers.has("cookie"), false);
      if (path === "/api/mobile/session")
        return Response.json({
          token: "fixture.signature",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      if (path === "/api/mobile/session/revoke")
        return Response.json({ ok: true });
      assert.equal(headers.get("authorization"), "Bearer fixture.signature");
      const call = [
        init.method!,
        path,
        init.body ? JSON.parse(String(init.body)) : undefined,
      ] as const;
      calls.push(call);
      const { status, payload } = await responder(call);
      if (!status) throw new Error("offline fixture");
      return Response.json(payload ?? {}, { status });
    },
    () => 1_000,
    writable,
  );
  await repo.signIn("fixture@example.test", "fixture");
  return { repo, calls, saved: () => secure !== null };
}

const routes: Call[] = [
  ["GET", "/api/contacts/ct_1"],
  ["GET", "/api/contacts/ct_1/timeline"],
  ["GET", "/api/contact-tags"],
  ["GET", "/api/settings/team"],
  ["GET", "/api/work/tasks?filter=all"],
  ["GET", day],
  ["GET", "/api/calendar/availability"],
  ["POST", "/api/contacts/ct_1/notes"],
  ["PUT", "/api/contacts/ct_1/tags"],
  ["POST", "/api/assignments"],
  ["POST", "/api/work/tasks"],
  ["PATCH", "/api/work/tasks/tsk_1"],
  ["POST", "/api/bookings"],
  ["PATCH", "/api/bookings/bk_1"],
];
const methods = ["GET", "POST", "PUT", "PATCH", "HEAD", "DELETE", "OPTIONS"];
test("C4+C5 allowlist matches only the exact method, ID and query; read-only still gates writes", () => {
  for (const [, path] of routes) {
    for (const method of methods) {
      const expected = routes.some(([m, p]) => m === method && p === path);
      assert.equal(
        allowsRemoteRequest(method, path, true),
        expected,
        method + " " + path,
      );
      assert.equal(
        allowsRemoteRequest(method, path),
        expected && method === "GET" && !path.endsWith("/availability"),
      );
    }
  }
  for (const path of [
    "/api/contacts",
    "/api/contacts/other%2Fid",
    "/api/contacts/ct_1/notes/extra",
    "/api/contacts/ct_1/../notes",
    "/api/contacts/ct_1#secret",
    "/api/contacts/ct_1/timeline?type=note",
    "/api/contact-tags?system=include",
    "/api/settings/team?extra=1",
    "/api/assignments/bulk",
    "/api/work/notes",
    "/api/work/tasks?filter=mine",
    "/api/work/tasks?filter=all&contactId=ct_1",
    "/api/work/tasks/tsk_1?done=true",
    "/api/bookings/",
    "/api/bookings?from=2026-11-23",
    "/api/bookings?from=2026-02-30&to=2026-03-01",
    "/api/bookings?from=2026-11-23&to=2026-11-30",
    "/api/bookings?from=2026-11-23&to=2026-11-22",
    "/api/bookings?from=2026-11-23&to=2026-11-24#",
    "/api/calendar/availability?from=2026-11-23",
    "//example.test/api/contacts/ct_1",
    "/api/pipeline/leads",
    "/api/campaigns",
    "/api/ai/conversations",
  ]) {
    for (const method of methods)
      assert.equal(
        allowsRemoteRequest(method, path, true),
        false,
        method + " " + path,
      );
  }
});

const operations = {
  ficha: (r: RemoteAuthRepository) => r.contact("ct_1"),
  notas: (r: RemoteAuthRepository) => r.notes("ct_1"),
  crearNota: (r: RemoteAuthRepository) => r.addNote("ct_1", " Texto ficticio "),
  catalogo: (r: RemoteAuthRepository) => r.tags(),
  ponerEtiqueta: (r: RemoteAuthRepository) =>
    r.changeTag("ct_1", "tag_1", true),
  equipo: (r: RemoteAuthRepository) => r.team(),
  reasignar: (r: RemoteAuthRepository) => r.assign("ct_1", "usr_1"),
  tareas: (r: RemoteAuthRepository) => r.tasks(),
  crearTarea: (r: RemoteAuthRepository) => r.addTask(" Revisar ", ""),
  completarTarea: (r: RemoteAuthRepository) => r.setTaskDone("tsk_1", true),
  reabrirTarea: (r: RemoteAuthRepository) => r.setTaskDone("tsk_1", false),
  agenda: (r: RemoteAuthRepository) => r.calendar("2026-11-23", "2026-11-23"),
  horarios: (r: RemoteAuthRepository) => r.slots(),
  crearCita: (r: RemoteAuthRepository) => r.addBooking("ct_1", iso),
  moverCita: (r: RemoteAuthRepository) => r.moveBooking("bk_1", iso),
};

function success([method, path]: Call): Outcome {
  if (method === "POST") {
    if (path.endsWith("/notes"))
      return { status: 201, payload: { id: "act_1" } };
    if (path === "/api/work/tasks") return { status: 201, payload: { task } };
    if (path === "/api/bookings") return { status: 201, payload: { booking } };
    return { status: 200, payload: { changed: 1 } };
  }
  if (method === "PATCH") return { status: 200, payload: { task, ok: true } };
  if (method === "PUT") return { status: 200, payload: tags };
  if (path.endsWith("/timeline"))
    return {
      status: 200,
      payload: {
        items: [
          note,
          { ...note, id: "initial_ct_1", kind: "initial_note" },
          { kind: "stage", detail: {} },
        ],
      },
    };
  if (path === "/api/contacts/ct_1")
    return { status: 200, payload: { contact } };
  if (path === "/api/contact-tags") return { status: 200, payload: tags };
  if (path === "/api/settings/team") return { status: 200, payload: team };
  if (path.includes("/work/tasks?"))
    return { status: 200, payload: { tasks: [task] } };
  if (path.includes("/bookings?"))
    return {
      status: 200,
      payload: {
        timezone: "America/Cancun",
        bookings: [booking, { ...booking, id: "bk_test", isTest: true }],
      },
    };
  return {
    status: 200,
    payload: {
      slots: [{ startUtc: iso, dayIso: "2026-11-23", time: "15:00" }],
    },
  };
}

test("real reads retain only display fields, support BSUID, separate lab bookings and use business days", async () => {
  const { repo } = await setup(true, success);
  const ficha = await repo.contact("ct_1");
  assert.equal(ficha.phone, null);
  assert.equal(ficha.assignedUserId, "usr_1");
  assert.equal(Object.hasOwn(ficha, "ficha"), false);
  assert.deepEqual(await repo.team(), [
    { id: "usr_1", name: "Persona ficticia" },
  ]);
  assert.deepEqual(
    (await repo.notes("ct_1")).map(({ initial }) => initial),
    [false, true],
  );
  assert.deepEqual(
    (await repo.calendar("2026-11-23", "2026-11-23")).bookings.map(
      ({ id }) => id,
    ),
    ["bk_1"],
  );
  assert.equal(
    businessDate("America/Cancun", new Date("2026-11-23T02:00:00Z")),
    "2026-11-22",
  );
});

test("production-shaped mutations submit only the UI-owned payload, preserving existing system tags", async () => {
  const { repo, calls } = await setup(true, success);
  for (const action of Object.values(operations)) await action(repo);
  await repo.assign("ct_1", null);
  await repo.changeTag("ct_1", "tag_1", false); // already absent: no PUT
  assert.deepEqual(
    calls.filter(([method]) => method !== "GET"),
    [
      ["POST", "/api/contacts/ct_1/notes", { text: "Texto ficticio" }],
      ["PUT", "/api/contacts/ct_1/tags", { tagIds: ["tag_system", "tag_1"] }],
      ["POST", "/api/assignments", { contactIds: ["ct_1"], userId: "usr_1" }],
      ["POST", "/api/work/tasks", { title: "Revisar" }],
      ["PATCH", "/api/work/tasks/tsk_1", { done: true }],
      ["PATCH", "/api/work/tasks/tsk_1", { done: false }],
      [
        "POST",
        "/api/bookings",
        { contactId: "ct_1", kind: "session", startUtc: iso },
      ],
      ["PATCH", "/api/bookings/bk_1", { action: "reschedule", startUtc: iso }],
      ["POST", "/api/assignments", { contactIds: ["ct_1"], userId: null }],
    ],
  );
  const removal = await setup(true, (call) =>
    call[1] === "/api/contacts/ct_1"
      ? {
          status: 200,
          payload: {
            contact: { ...contact, tags: [...contact.tags, ...tags.tags] },
          },
        }
      : success(call),
  );
  await removal.repo.changeTag("ct_1", "tag_1", false);
  assert.deepEqual(removal.calls.at(-1)?.[2], { tagIds: ["tag_system"] });
});

const writes = [
  operations.crearNota,
  operations.ponerEtiqueta,
  operations.reasignar,
  operations.crearTarea,
  operations.completarTarea,
  operations.crearCita,
  operations.moverCita,
];
test("read-only builds cannot prepare or issue a CRM mutation", async () => {
  const { repo, calls } = await setup(false, success);
  for (const write of writes)
    await assert.rejects(() => write(repo), { status: 403 });
  assert.equal(calls.length, 0);
});

for (const [name, action] of Object.entries(operations)) {
  test(`${name} reports offline, rate limit, missing, denied and session invalidation safely`, async () => {
    for (const [status, code, message, ends] of [
      [0, "", /Sin conexión/, false],
      [401, "unauthorized", /Vuelve a iniciar sesión/, true],
      [403, "forbidden", /No tienes acceso/, false],
      [403, "organization_suspended", /negocio está suspendido/, true],
      [404, "not_found", /ya no está disponible/, false],
      [429, "rate_limited", /Demasiados intentos/, false],
    ] as const) {
      const { repo, saved } = await setup(true, ([method, path, body]) => {
        const preparatory =
          method === "GET" &&
          ((name === "ponerEtiqueta" &&
            (path === "/api/contacts/ct_1" || path === "/api/contact-tags")) ||
            (name === "reasignar" && path === "/api/settings/team"));
        return preparatory
          ? success([method, path, body])
          : {
              status,
              payload: { error: { code, message: "Fixture privada" } },
            };
      });
      await assert.rejects(
        () => action(repo),
        (error: unknown) =>
          error instanceof RemoteHttpError &&
          error.status === status &&
          message.test(error.message) &&
          !error.message.includes("Fixture privada") &&
          requiresRemoteLogin(error) === ends,
      );
      assert.equal(saved(), !ends);
    }
  });
}

for (const name of [
  "crearNota",
  "crearTarea",
  "ponerEtiqueta",
  "crearCita",
] as const) {
  test(`${name} issues a single write for simultaneous taps`, async () => {
    const deferred = Promise.withResolvers<void>();
    const { repo, calls } = await setup(true, async (call) => {
      if (call[0] !== "GET") await deferred.promise;
      return success(call);
    });
    const first = operations[name](repo);
    assert.equal(await operations[name](repo), null);
    deferred.resolve();
    assert.ok(await first);
    assert.equal(calls.filter(([method]) => method !== "GET").length, 1);
  });
}

test("pending preparatory reads cannot finish writing after logout and new login", async () => {
  const deferred = Promise.withResolvers<void>();
  const { repo, calls } = await setup(true, async (call) => {
    await deferred.promise;
    return success(call);
  });
  const old = repo.changeTag("ct_1", "tag_1", true);
  await repo.signOut();
  await repo.signIn("other@example.test", "fixture");
  deferred.resolve();
  await assert.rejects(old, { status: 401 });
  assert.equal(calls.filter(([method]) => method !== "GET").length, 0);
  assert.ok(await repo.contact("ct_1"));
});
