import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertQuickReply,
  reviewTemplate,
  templatesResponse,
} from "../src/integration/remote-composer";
import {
  allowsRemoteRequest,
  RemoteAuthRepository,
  requiresRemoteLogin,
  RemoteHttpError,
} from "../src/integration/remote-http";
import {
  maintainLiveUpdates,
  readEventHints,
  StreamingUnavailable,
} from "../src/integration/remote-live";
import { createReadOnlyConversationClient } from "../src/integration/conversation-client";
import type { WireConversation } from "../src/integration/wire";

const chat: WireConversation = {
  id: "cv_demo",
  contact: { id: "ct_demo", name: "Fer Ficticio", phone: null },
  channel: "whatsapp",
  waNumberId: "123456789",
  isGroup: false,
  unreadCount: 0,
  createdAt: "2026-11-20T00:00:00Z",
};
const catalogRow = {
  id: "tpl_demo",
  name: "Bienvenida",
  language: "es_MX",
  body: "Hola {{nombre}}, cita {{fecha}} para {{nombre}}",
  status: "approved",
  sendable: true,
};
const catalog = { templates: [catalogRow] };
const selected = templatesResponse(catalog)[0]!;
const path = "/api/conversations/cv_demo/messages/template";

async function fixture(
  send = true,
  reply: (path: string, options: RequestInit) => Promise<Response> = async () =>
    Response.json(catalog),
) {
  const calls: { path: string; options: RequestInit }[] = [];
  let saved: string | null = null;
  const repo = new RemoteAuthRepository(
    "staging",
    "http://127.0.0.1:1",
    {
      get: async () => saved,
      set: async (_, value) => {
        saved = value;
      },
      remove: async () => {
        saved = null;
      },
    },
    async (url, options) => {
      const target = url.replace("http://127.0.0.1:1", "");
      if (target === "/api/mobile/session")
        return Response.json({
          token: "fixture.signature",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      calls.push({ path: target, options });
      const headers = new Headers(options.headers);
      assert.equal(headers.get("Authorization"), "Bearer fixture.signature");
      assert.equal(headers.has("Cookie"), false);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      if (target === "/api/whatsapp-numbers")
        return Response.json({
          numbers: [{ id: "123456789", isPrimary: true }],
        });
      return reply(target, options);
    },
    () => 1_000,
    send,
  );
  await repo.signIn("fixture@example.test", "fixture");
  return { repo, calls, saved: () => saved !== null };
}

test("C6 allows only exact new routes and the template write requires the build flag", () => {
  for (const read of [
    "/api/templates",
    "/api/quick-replies",
    "/api/whatsapp-numbers",
    "/api/events",
    "/api/conversations?ids=cv_demo",
  ]) {
    assert.equal(allowsRemoteRequest("GET", read), true);
    assert.equal(allowsRemoteRequest("POST", read, true), false);
    assert.equal(allowsRemoteRequest("PATCH", read, true), false);
    assert.equal(allowsRemoteRequest("DELETE", read, true), false);
  }
  assert.equal(allowsRemoteRequest("POST", path, true), true);
  assert.equal(allowsRemoteRequest("POST", path), false);
  assert.equal(allowsRemoteRequest("GET", path, true), false);
  for (const invalid of [
    "/api/templates/sync",
    "/api/templates?status=approved",
    "/api/quick-replies/qr_a",
    "/api/events/",
    "/api/events?token=fixture",
    "/api/events?since=now",
    "/api/events#x",
    "/api/conversations?ids=a,b",
    "/api/conversations?ids=a&limit=1",
    "/api/conversations?ids=../x",
    path + "?x=1",
    path + "/extra",
    path.replace("cv_demo", "%2e%2e"),
  ])
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        allowsRemoteRequest(method, invalid, true),
        false,
        method + " " + invalid,
      );
    }
});

test("approval, named/numbered variables and preview use the web order", () => {
  assert.equal(
    templatesResponse({
      templates: [
        catalogRow,
        { ...catalogRow, status: "pending" },
        { ...catalogRow, sendable: false },
        { ...catalogRow, body: "Mal {{3}}" },
        { ...catalogRow, body: "Mal {{9999999999}}" },
      ],
    }).length,
    1,
  );
  assert.equal(reviewTemplate(selected, ["Fer", ""]), null);
  assert.equal(reviewTemplate(selected, ["Fer"]), null);
  assert.equal(reviewTemplate(selected, ["a".repeat(501), "hoy"]), null);
  assert.deepEqual(reviewTemplate(selected, [" Fer ", " hoy "]), {
    text: "Hola Fer, cita hoy para Fer",
    variables: ["Fer", "hoy"],
  });
  const numbered = templatesResponse({
    templates: [{ ...catalogRow, body: "{{2}} y {{1}}" }],
  })[0]!;
  assert.equal(reviewTemplate(numbered, ["uno", "dos"])?.text, "dos y uno");
  assert.equal(
    insertQuickReply("Hola {nombre}", "Fer Ficticio", "/h", 4096),
    "Hola Fer",
  );
  assert.equal(
    insertQuickReply("Hola {nombre},", "555550000", "Pendiente", 4096),
    "Pendiente\nHola,",
  );
});

test("template does not post for missing values, unsupported channels, revoked approval or read-only builds", async () => {
  const { repo, calls } = await fixture(true, async () =>
    Response.json({ templates: [{ ...catalogRow, status: "pending" }] }),
  );
  await assert.rejects(repo.sendTemplate(chat, selected, []), { status: 422 });
  await assert.rejects(
    repo.sendTemplate({ ...chat, channel: "instagram" }, selected, [
      "Fer",
      "hoy",
    ]),
    { status: 403 },
  );
  await assert.rejects(
    repo.sendTemplate({ ...chat, isGroup: true }, selected, ["Fer", "hoy"]),
    { status: 403 },
  );
  await assert.rejects(repo.sendTemplate(chat, selected, ["Fer", "hoy"]), {
    status: 422,
    code: "template_changed",
  });
  assert.deepEqual(
    calls.map(({ path }) => path),
    ["/api/templates", "/api/whatsapp-numbers"],
  );
  const ro = await fixture(false);
  assert.equal((await ro.repo.templates()).length, 1);
  await assert.rejects(ro.repo.sendTemplate(chat, selected, ["Fer", "hoy"]), {
    status: 403,
  });
  assert.equal(ro.calls.length, 1);
});

test("one template POST for rapid taps, sharing the lock with text", async () => {
  const pending = Promise.withResolvers<Response>();
  const { repo, calls } = await fixture(true, async (p) =>
    p === path ? pending.promise : Response.json(catalog),
  );
  const first = repo.sendTemplate(chat, selected, [" Fer ", "hoy"]);
  assert.equal(await repo.sendTemplate(chat, selected, ["Fer", "hoy"]), null);
  assert.equal(await repo.sendText(chat.id, "texto ficticio"), null);
  pending.resolve(Response.json({ messageId: "msg_demo" }));
  assert.equal(await first, true);
  const sends = calls.filter(({ options }) => options.method === "POST");
  assert.equal(sends.length, 1);
  assert.deepEqual(JSON.parse(String(sends[0]!.options.body)), {
    templateId: "tpl_demo",
    variables: ["Fer", "hoy"],
  });
});

for (const [status, code, login] of [
  [401, "unauthorized", true],
  [403, "forbidden", false],
  [403, "organization_suspended", true],
  [404, "not_found", false],
  [429, "rate_limited", false],
  [0, "", false],
  [503, "meta_unavailable", false],
  [403, "meta_unavailable", false],
] as const)
  test(`template status ${status}/${code} has safe session and retry semantics`, async () => {
    const { repo, saved, calls } = await fixture(true, async (p) => {
      if (p !== path) return Response.json(catalog);
      if (!status) throw new Error("fixture network");
      return Response.json(
        { error: { code, message: "private fixture" } },
        { status },
      );
    });
    await assert.rejects(
      repo.sendTemplate(chat, selected, ["Fer", "hoy"]),
      (reason: unknown) =>
        reason instanceof RemoteHttpError &&
        reason.status === status &&
        requiresRemoteLogin(reason) === login &&
        !reason.message.includes("private fixture"),
    );
    assert.equal(saved(), !login);
    const uncertain = status === 0 || code === "meta_unavailable";
    assert.equal(repo.templateIsUncertain(chat.id), uncertain);
    if (uncertain) {
      await assert.rejects(repo.sendTemplate(chat, selected, ["Fer", "hoy"]), {
        status: 403,
      });
      assert.equal(calls.filter(({ path: p }) => p === path).length, 1);
    }
  });

test("SSE is Bearer only; a 401 clears storage and a forbidden stream may fall back", async () => {
  const controller = new AbortController();
  for (const status of [401, 403, 404]) {
    const { repo, calls, saved } = await fixture(false, async () =>
      Response.json({}, { status }),
    );
    await assert.rejects(
      repo.liveEvents(
        controller.signal,
        () => {},
        () => {},
      ),
      status === 401 ? RemoteHttpError : StreamingUnavailable,
    );
    assert.equal(calls[0]?.path, "/api/events");
    assert.equal(
      new Headers(calls[0]?.options.headers).get("accept"),
      "text/event-stream",
    );
    assert.equal(saved(), status !== 401);
  }
});

test("SSE parser accepts split heartbeats and hints, canonical history deduplicates IDs", async () => {
  const chunks = [
    "event: message.new\r\nda",
    'ta: {"conversationId":"cv_demo","message":{"text":"fixture"}}\r\n\r\n: ping\n\n',
    'event: assignment.changed\ndata: {"contactIds":["ct_demo"]}\n\n',
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });
  const seen: unknown[] = [];
  await readEventHints(
    stream,
    new AbortController().signal,
    (hint) => seen.push(hint),
    () => {},
  );
  assert.deepEqual(seen, [
    { conversationId: "cv_demo", contactIds: undefined },
    { conversationId: undefined, contactIds: ["ct_demo"] },
  ]);
  const msg = {
    id: "msg_demo",
    conversationId: chat.id,
    direction: "out",
    text: "fixture",
    createdAt: chat.createdAt,
    aiGenerated: false,
    status: "sent",
  };
  const client = createReadOnlyConversationClient(async () => ({
    messages: [msg, { ...msg, status: "delivered" }],
  }));
  const result = await client.history(chat.id);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.status, "delivered");
});

test("live reconnect backs off, reconciles and cancels; nonstreaming polls at 25 s", async () => {
  for (const fallback of [false, true]) {
    const abort = new AbortController();
    const waits: number[] = [];
    let connections = 0,
      reads = 0;
    await maintainLiveUpdates({
      signal: abort.signal,
      connect: async () => {
        connections++;
        if (fallback) throw new StreamingUnavailable();
        throw new Error("fixture");
      },
      onError: () => false,
      wait: async (ms) => {
        waits.push(ms);
        if (waits.length === 4) abort.abort();
      },
      refresh: async () => {
        reads++;
      },
    });
    assert.deepEqual(
      waits,
      fallback ? [25000, 25000, 25000, 25000] : [5000, 10000, 20000, 40000],
    );
    assert.equal(connections, fallback ? 1 : 4);
    assert.equal(reads, 3);
  }
});

test("a secondary Meta line cannot send from the primary identity", async () => {
  const { repo, calls } = await fixture();
  await assert.rejects(
    repo.sendTemplate({ ...chat, waNumberId: "secondary" }, selected, [
      "Fer",
      "hoy",
    ]),
    { status: 403, code: "template_line_unsupported" },
  );
  assert.equal(
    calls.some(({ options }) => options.method === "POST"),
    false,
  );
});
