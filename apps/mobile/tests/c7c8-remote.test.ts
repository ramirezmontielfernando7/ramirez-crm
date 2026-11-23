import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowsRemoteRequest,
  RemoteAuthRepository,
  RemoteHttpError,
  requiresRemoteLogin,
} from "../src/integration/remote-http";
import {
  attachmentFromWire,
  MEDIA_LIMIT,
  uploadMediaKind,
  type RemoteAttachment,
} from "../src/integration/remote-media";
import {
  analyticsResponse,
  campaignsResponse,
  agentsResponse,
  validReportRange,
} from "../src/integration/remote-workspace";

const readMedia = "/api/media/ma_fixture";
const chat = "/api/conversations/cv_fixture";
const sendMedia = chat + "/messages/media";
const attachment: RemoteAttachment = {
  id: "ma_fixture",
  kind: "document",
  name: "fixture.pdf",
  mime: "application/pdf",
  size: 4,
};
const file = {
  chunks: async function* () {
    yield new Uint8Array([1, 2]);
    yield new Uint8Array([3, 4]);
  },
  name: "fixture.pdf",
  mime: "application/pdf",
  size: 4,
};
const windowMessage =
  "La ventana de 24 horas está cerrada; usa una plantilla aprobada";

async function fixture(
  writable = true,
  responder: (
    path: string,
    init: RequestInit,
  ) => Promise<Response> = async () => Response.json({}),
) {
  let saved: string | null = null;
  const calls: { path: string; options: RequestInit }[] = [];
  const repository = new RemoteAuthRepository(
    "staging",
    "http://127.0.0.1:1",
    {
      get: async () => saved,
      set: async (_key, value) => {
        saved = value;
      },
      remove: async () => {
        saved = null;
      },
    },
    async (url, options) => {
      const path = url.replace("http://127.0.0.1:1", "");
      if (path === "/api/mobile/session")
        return Response.json({
          token: "fixture.signature",
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      calls.push({ path, options });
      const headers = new Headers(options.headers);
      assert.equal(options.redirect, "error");
      assert.equal(options.credentials, "omit");
      assert.equal(headers.get("authorization"), "Bearer fixture.signature");
      assert.equal(headers.has("cookie"), false);
      return responder(path, options);
    },
    () => 1000,
    writable,
  );
  await repository.signIn("fixture@example.test", "fixture");
  return { repository, calls, saved: () => saved !== null };
}

const readRoutes = [
  readMedia,
  "/api/pipeline/board?take=50",
  "/api/pipeline/board?take=50&stageId=stg_fixture&offset=50",
  "/api/pipeline/loss-reasons",
  "/api/writing-assist",
  "/api/lab/agents",
  "/api/analytics/sales",
  "/api/analytics/bot?from=2026-01-01&to=2026-01-05",
  "/api/analytics/hygiene",
  "/api/analytics/team",
  "/api/analytics/ads",
  "/api/campaigns",
  "/api/campaigns/metrics?from=2026-01-01&to=2026-01-05",
];
const writeRoutes: readonly (readonly [string, string])[] = [
  ["POST", sendMedia],
  ["PATCH", "/api/pipeline/leads/ld_fixture"],
  ["POST", "/api/writing-assist"],
  ["PATCH", chat],
];
test("C7+C8 widens the allowlist only to exact reads and flag-gated mutations", () => {
  for (const route of readRoutes)
    assert.equal(allowsRemoteRequest("GET", route), true, route);
  for (const [method, path] of writeRoutes) {
    assert.equal(allowsRemoteRequest(method, path, false), false);
    assert.equal(allowsRemoteRequest(method, path, true), true);
  }
  for (const route of new Set([
    ...readRoutes,
    ...writeRoutes.map(([, path]) => path),
  ]))
    for (const method of [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ]) {
      assert.equal(
        allowsRemoteRequest(method, route, true),
        (method === "GET" && readRoutes.includes(route)) ||
          writeRoutes.some(([verb, path]) => method === verb && route === path),
        method + " " + route,
      );
    }
  for (const path of [
    readMedia + "?token=fixture",
    readMedia + "/",
    readMedia.replace("ma_fixture", "%2e%2e"),
    sendMedia + "?caption=x",
    "/api/pipeline/leads/ld_fixture/extra",
    "/api/pipeline/board",
    "/api/pipeline/board?take=49",
    "/api/pipeline/board?take=50&stageId=stg_fixture&offset=-1",
    "/api/pipeline/stages",
    "/api/analytics/sales?userId=other",
    "/api/analytics/sales?from=2026-02-30&to=2026-03-01",
    "/api/analytics/hygiene?from=2026-01-01&to=2026-01-01",
    "/api/analytics/team?from=2020-01-01&to=2026-01-01",
    "/api/lab/agents/agent_fixture",
    "/api/campaigns/cmp_fixture/send",
    "/api/campaigns/cmp_fixture",
    "/api/campaigns/metrics?phone=123",
    "/api/auth/get-session",
    "/api/auth/update-user",
    "/api/preferences",
  ])
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"])
      assert.equal(
        allowsRemoteRequest(method, path, true),
        false,
        method + " " + path,
      );
});

test("validates media names, limits and kind exactly where needed", () => {
  assert.equal(
    uploadMediaKind("image/jpeg", "fixture.jpg", 5 * 1024 * 1024),
    "image",
  );
  assert.equal(
    uploadMediaKind("image/jpeg", "fixture.jpg", 5 * 1024 * 1024 + 1),
    "document",
  );
  assert.equal(
    uploadMediaKind("video/mp4", "fixture.mp4", 16 * 1024 * 1024),
    "video",
  );
  assert.equal(
    uploadMediaKind("audio/mpeg", "fixture.mp3", 16 * 1024 * 1024),
    "audio",
  );
  assert.equal(
    uploadMediaKind("application/pdf", "fixture.pdf", MEDIA_LIMIT),
    "document",
  );
  assert.equal(
    uploadMediaKind("application/pdf", "fixture.pdf", MEDIA_LIMIT + 1),
    null,
  );
  assert.equal(uploadMediaKind("image/svg+xml", "fixture.png", 2), null);
  assert.equal(
    uploadMediaKind("application/octet-stream", "fixture.apk", 2),
    null,
  );
  assert.equal(
    attachmentFromWire({
      assetId: "ma_fixture",
      kind: "image",
      mimeType: "image/svg+xml",
    }),
    undefined,
  );
  assert.equal(
    attachmentFromWire({
      assetId: "../a",
      kind: "document",
      mimeType: "application/pdf",
    }),
    undefined,
  );
});

for (const [kind, mime] of [
  ["image", "image/jpeg"],
  ["document", "application/pdf"],
  ["audio", "audio/mpeg"],
  ["video", "video/mp4"],
] as const)
  test(`downloads ${kind} from the exact authenticated path with a bounded writer`, async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { repository, calls } = await fixture(
      false,
      async () =>
        new Response(bytes, {
          headers: { "content-type": mime, "content-length": "4" },
        }),
    );
    const item = attachmentFromWire({
      assetId: "ma_fixture",
      kind,
      mimeType: mime,
      fileSize: 4,
    })!;
    const received: number[] = [];
    await repository.downloadMedia(
      item,
      new AbortController().signal,
      async (chunk) => {
        received.push(...chunk);
      },
    );
    assert.deepEqual(received, [1, 2, 3, 4]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, readMedia);
    assert.equal(calls[0]?.options.cache, "no-store");
  });

test("a raster photo sent as a document still opens as an image", () => {
  assert.equal(
    attachmentFromWire({
      assetId: "ma_fixture",
      kind: "document",
      mimeType: "image/jpeg",
    })?.kind,
    "image",
  );
});

test("unstated size remains bounded and wrong MIME is rejected before writing", async () => {
  const few = { ...attachment, size: null };
  const over = await fixture(
    false,
    async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "application/pdf" },
      }),
  );
  await assert.rejects(
    over.repository.downloadMedia(
      few,
      new AbortController().signal,
      async () => {
        assert.fail("should not write");
      },
      3,
    ),
    { status: 413 },
  );
  const wrong = await fixture(
    false,
    async () =>
      new Response("not allowed", { headers: { "content-type": "text/html" } }),
  );
  await assert.rejects(
    wrong.repository.downloadMedia(
      few,
      new AbortController().signal,
      async () => {
        assert.fail("should not write");
      },
    ),
    { status: 415 },
  );
});

test("upload is written once and passed as multipart with a bounded cancellation signal", async () => {
  const hold = Promise.withResolvers<Response>();
  const { repository, calls } = await fixture(true, async () => hold.promise);
  const abort = new AbortController();
  const first = repository.sendMedia("cv_fixture", file, abort.signal);
  assert.equal(
    await repository.sendMedia(
      "cv_fixture",
      file,
      new AbortController().signal,
    ),
    null,
  );
  assert.equal(await repository.sendText("cv_fixture", "Texto ficticio"), null);
  hold.resolve(Response.json({ messageId: "msg_fixture" }, { status: 201 }));
  assert.deepEqual(await first, { queued: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, sendMedia);
  const outgoing = calls[0]!.options;
  const sent = (await new Request(
    "http://localhost/upload-fixture",
    outgoing,
  ).formData()) as unknown as {
    keys: () => IterableIterator<string>;
    get: (key: string) => unknown;
  };
  assert.deepEqual([...sent.keys()], ["file"]);
  const part = sent.get("file");
  assert.ok(part instanceof File);
  assert.equal(part.name, "fixture.pdf");
  assert.equal(part.type, "application/pdf");
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [1, 2, 3, 4]);
});

test("cancelled upload requires reconciliation and read-only cannot stage a network write", async () => {
  const { repository, calls } = await fixture(
    true,
    async (_, options) =>
      new Promise((_resolve, reject) => {
        if (options.signal?.aborted) reject(Error("fixture abort"));
        else
          options.signal?.addEventListener(
            "abort",
            () => reject(Error("fixture abort")),
            { once: true },
          );
      }),
  );
  const abort = new AbortController();
  const result = repository.sendMedia("cv_fixture", file, abort.signal);
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(result, { status: 0 });
  assert.equal(repository.mediaNeedsRefresh("cv_fixture"), true);
  await assert.rejects(
    repository.sendMedia("cv_fixture", file, new AbortController().signal),
    { status: 403 },
  );
  assert.equal(calls.length, 1);
  const readonly = await fixture(false);
  for (const write of [
    () =>
      readonly.repository.sendMedia(
        "cv_fixture",
        file,
        new AbortController().signal,
      ),
    () => readonly.repository.moveLead("ld_fixture", "stg_fixture"),
    () => readonly.repository.suggestDraft("Texto ficticio"),
    () => readonly.repository.setConversationAI("cv_fixture", "pause"),
  ])
    await assert.rejects(write(), { status: 403 });
  assert.equal(readonly.calls.length, 0);
});

for (const [status, code, expected, expires] of [
  [401, "unauthorized", /inicia|iniciar sesión/, true],
  [403, "forbidden", /No tienes acceso/, false],
  [403, "organization_suspended", /está suspendido/, true],
  [404, "not_found", /disponible/, false],
  [429, "rate_limited", /Demasiados intentos/, false],
  [409, "window_closed", /ventana de 24 horas/, false],
  [507, "storage_quota", /límite de almacenamiento/, false],
  [0, "", /Sin conexión/, false],
] as const)
  test(`attachment reports ${status} ${code} and preserves session only when valid`, async () => {
    for (const action of [sendMedia, readMedia]) {
      if (action === readMedia && (status === 409 || status === 507)) continue;
      const { repository, saved } = await fixture(true, async () => {
        if (!status) throw Error("fixture network");
        return Response.json(
          {
            error: {
              code,
              message:
                status === 409 ? windowMessage : "texto privado de prueba",
            },
          },
          { status },
        );
      });
      const signal = new AbortController().signal;
      await assert.rejects(
        action === sendMedia
          ? repository.sendMedia("cv_fixture", file, signal)
          : repository.downloadMedia(attachment, signal, async () => {}),
        (error: unknown) =>
          error instanceof RemoteHttpError &&
          error.status === status &&
          expected.test(error.message) &&
          requiresRemoteLogin(error) === expires &&
          !error.message.includes("texto privado"),
      );
      assert.equal(saved(), !expires);
    }
  });

test("lead mutation, AI and writing build only distinct authorized bodies; draft response does not send", async () => {
  const { repository, calls } = await fixture(true, async (path) => {
    if (path === "/api/writing-assist")
      return Response.json({ text: "Borrador ficticio" });
    if (path === chat)
      return Response.json({ conversation: { id: "cv_fixture" } });
    return Response.json({ lead: { id: "ld_fixture" } });
  });
  assert.equal(
    await repository.moveLead("ld_fixture", "stg_lost", "otro"),
    true,
  );
  assert.equal(await repository.setConversationAI("cv_fixture", "pause"), true);
  assert.equal(
    await repository.setConversationAI("cv_fixture", "reactivate"),
    true,
  );
  assert.equal(
    await repository.suggestDraft(" Texto ficticio "),
    "Borrador ficticio",
  );
  assert.deepEqual(
    calls.map(({ path, options }) => [path, JSON.parse(String(options.body))]),
    [
      [
        "/api/pipeline/leads/ld_fixture",
        { stageId: "stg_lost", lossReason: "otro" },
      ],
      [chat, { aiEnabled: false }],
      [chat, { reactivate: true }],
      ["/api/writing-assist", { action: "improve", text: "Texto ficticio" }],
    ],
  );
});

test("workspace report renders known values and date range, ignores private response fields", () => {
  assert.equal(
    validReportRange({ from: "2024-01-01", to: "2024-12-31" }),
    true,
  );
  assert.equal(
    validReportRange({ from: "2024-01-01", to: "2025-01-01" }),
    false,
  );
  const report = analyticsResponse("sales", {
    kpis: { won: { current: 2 } },
    period: {
      from: "2026-11-01",
      to: "2026-11-05",
      timezone: "America/Cancun",
    },
  });
  assert.equal(
    report.metrics.find(({ label }) => label === "Ganados")?.value,
    "2",
  );
  assert.match(report.period, /America\/Cancun/);
  const campaign = campaignsResponse({
    campaigns: [
      {
        id: "cmp_1",
        name: "Fixture",
        status: "paused",
        variables: ["dato privado"],
        delivery: { delivered: 7 },
      },
    ],
  })[0]!;
  assert.equal(campaign.state, "En pausa");
  assert.equal(
    campaign.values.find(({ label }) => label === "Entregados")?.value,
    "7",
  );
  assert.equal(Object.hasOwn(campaign, "variables"), false);
  const agent = agentsResponse({
    agents: [
      {
        id: "agt_1",
        internalName: "Fixture",
        paused: true,
        prompt: "dato privado",
      },
    ],
  })[0]!;
  assert.deepEqual(agent, { id: "agt_1", name: "Fixture", state: "En pausa" });
});

for (const [status, code, expires] of [
  [0, "", false],
  [401, "unauthorized", true],
  [403, "forbidden", false],
  [403, "organization_suspended", true],
  [404, "not_found", false],
  [429, "rate_limited", false],
] as const) {
  test(`workspace read/write status ${status} ${code} respects scope and session`, async () => {
    const operations = [
      (r: RemoteAuthRepository) => r.pipeline(),
      (r: RemoteAuthRepository) => r.moveLead("ld_fixture", "stg_fixture"),
      (r: RemoteAuthRepository) => r.setConversationAI("cv_fixture", "enable"),
      (r: RemoteAuthRepository) => r.suggestDraft("Texto ficticio"),
      (r: RemoteAuthRepository) => r.agents(),
      (r: RemoteAuthRepository) => r.analytics("sales"),
      (r: RemoteAuthRepository) => r.campaigns(),
      (r: RemoteAuthRepository) => r.campaignMetrics(),
      (r: RemoteAuthRepository) => r.team(),
    ];
    for (const call of operations) {
      const { repository, saved } = await fixture(true, async () => {
        if (!status) throw Error("fixture network");
        return Response.json({ error: { code } }, { status });
      });
      await assert.rejects(
        call(repository),
        (error: unknown) =>
          error instanceof RemoteHttpError &&
          error.status === status &&
          requiresRemoteLogin(error) === expires,
      );
      assert.equal(saved(), !expires);
    }
  });
}

test("cancelling while the file is prepared never submits and its size cannot change", async () => {
  const { repository, calls } = await fixture();
  const cancel = new AbortController();
  await assert.rejects(
    repository.sendMedia("cv_fixture", file, cancel.signal, (percent) => {
      if (percent < 100) cancel.abort();
    }),
    { status: 0 },
  );
  await assert.rejects(
    repository.sendMedia(
      "cv_fixture",
      { ...file, size: 3 },
      new AbortController().signal,
    ),
    { status: 422 },
  );
  assert.equal(calls.length, 0);
  assert.equal(repository.mediaNeedsRefresh("cv_fixture"), false);
});
