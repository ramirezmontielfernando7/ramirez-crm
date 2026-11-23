import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chatPageSize,
  chatStyle,
  dayLabel,
  followsSameSender,
  newestMessages,
  timelineWindow,
} from "../src/integration/chat-timeline";
import {
  areaHistory,
  connectedOwnNumber,
  inboxHistoryPath,
  ownNumberChats,
  teamThreads,
} from "../src/integration/remote-inbox-areas";
import {
  allowsRemoteRequest,
  RemoteAuthRepository,
  RemoteHttpError,
  requiresRemoteLogin,
} from "../src/integration/remote-http";
import { messagesResponse, type WireMessage } from "../src/integration/wire";

const at = (n: number) => new Date(Date.UTC(2026, 10, 22, 12, n)).toISOString();
const row = (n: number): WireMessage => ({
  id: "msg_" + n,
  conversationId: "cv_fixture",
  direction: "in",
  status: "read",
  text: "Mensaje ficticio",
  createdAt: at(n),
  aiGenerated: false,
});

test("opening 600 messages presents the latest, and older pages preserve the loaded window", () => {
  const history = Array.from({ length: 600 }, (_, index) => row(index));
  const newest = newestMessages([], history);
  const first = timelineWindow(newest, chatPageSize, undefined);
  assert.equal(first.rows[0]?.id, "msg_599");
  assert.equal(first.rows.length, 45);
  const older = timelineWindow(newest, chatPageSize * 2, "msg_599");
  assert.deepEqual(older.rows.slice(0, chatPageSize), first.rows);
  assert.equal(older.rows.at(-1)?.id, "msg_510");
});

test("incoming rows move the bottom only when following and keep references for unchanged bubbles", () => {
  const prior = newestMessages([], [row(1), row(2), row(3)]);
  const newest = newestMessages(prior, [
    row(1),
    row(2),
    row(3),
    row(4),
    row(4),
  ]);
  const reading = timelineWindow(newest, 45, "msg_3");
  assert.equal(reading.hidden, 1);
  assert.deepEqual(reading.rows, prior);
  assert.equal(reading.rows[0], prior[0]);
  const atBottom = timelineWindow(newest, 45, undefined);
  assert.equal(atBottom.rows[0]?.id, "msg_4");
  assert.equal(atBottom.hidden, 0);
  assert.equal(atBottom.rows[1], prior[0]);
});

test("message grouping, device dates, display preference and optional read-only content", () => {
  assert.equal(chatStyle(undefined), "whatsapp");
  assert.equal(chatStyle("dashfort"), "dashfort");
  assert.equal(
    dayLabel(
      new Date(2026, 10, 22, 10).toISOString(),
      new Date(2026, 10, 22, 19),
    ),
    "Hoy",
  );
  assert.equal(
    dayLabel(
      new Date(2026, 10, 21, 10).toISOString(),
      new Date(2026, 10, 22, 19),
    ),
    "Ayer",
  );
  assert.equal(followsSameSender(row(1), row(2)), true);
  assert.equal(
    followsSameSender(
      { ...row(1), senderKey: "a" },
      { ...row(2), senderKey: "b" },
    ),
    false,
  );
  const message = {
    ...row(1),
    text: null,
    type: "sticker",
    media: {
      assetId: "asset_demo",
      kind: "sticker",
      mimeType: "image/webp",
      fileName: "demo.webp",
      fileSize: 42,
      caption: "Pie ficticio",
    },
    quote: {
      messageId: "msg_2",
      title: "Cliente ficticio",
      preview: "Ejemplo",
    },
    reactions: [
      { emoji: "👍", count: 2 },
      { emoji: "<script>", count: 4 },
    ],
  };
  const [shown] = messagesResponse({ messages: [message] }, "cv_fixture");
  assert.equal(shown?.sticker, true);
  assert.equal(shown?.attachment?.kind, "image");
  assert.equal(shown?.text, "Pie ficticio");
  assert.equal(shown?.quote?.messageId, "msg_2");
  assert.deepEqual(shown?.reactions, [{ emoji: "👍", count: 2 }]);
  assert.equal(
    messagesResponse(
      {
        messages: [
          { ...message, quote: { ...message.quote, messageId: "../bad" } },
        ],
      },
      "cv_fixture",
    )[0]?.quote,
    undefined,
  );
});

test("the extended allowlist accepts only the scoped read paths and gated team text", () => {
  const team = inboxHistoryPath("team", "tct_demo");
  const own = inboxHistoryPath("number", "cv_demo", "msg_6");
  for (const path of [
    team,
    own,
    "/api/team-chat/threads",
    "/api/my-number/chats",
    "/api/settings/my-number",
  ]) {
    assert.equal(allowsRemoteRequest("GET", path), true, path);
    assert.equal(allowsRemoteRequest("POST", path), false, path);
    assert.equal(allowsRemoteRequest("PATCH", path, true), false, path);
    assert.equal(allowsRemoteRequest("DELETE", path, true), false, path);
  }
  assert.equal(allowsRemoteRequest("POST", team, true), true);
  for (const path of [
    team + "?before=msg_1",
    own,
    "/api/my-number/chats/cv_demo/messages",
    "/api/settings/my-number",
    "/api/team-chat/threads",
    "/api/team-chat/messages/msg_1/reactions",
  ])
    assert.equal(allowsRemoteRequest("POST", path, true), false, path);
  for (const path of [
    team + "/",
    team + "?limit=42",
    own + "&before=msg_2",
    own + "#fragment",
    "/api/my-number/team/cv_demo/messages",
    "/api/my-number/shared/cv_demo/messages",
    "/api/settings/my-number/link",
    "/api/team-chat/threads/a%2fb/messages",
  ])
    assert.equal(allowsRemoteRequest("GET", path, true), false, path);
});

test("number visibility requires the user's connected number and foreign responses are rejected", () => {
  assert.equal(connectedOwnNumber({ number: null }), null);
  assert.equal(
    connectedOwnNumber({
      number: { id: "dn_a", connection: { status: "disconnected" } },
    }),
    null,
  );
  assert.equal(
    connectedOwnNumber({
      number: { id: "dn_a", connection: { status: "connected" } },
    }),
    "dn_a",
  );
  assert.throws(() => ownNumberChats({ numberId: "dn_b", chats: [] }, "dn_a"));
  assert.throws(() =>
    areaHistory({ messages: [row(2)] }, "number", "cv_other"),
  );
  assert.deepEqual(
    ownNumberChats(
      {
        numberId: "dn_a",
        chats: [{ id: "cv_fixture", contact: { name: "Cliente ficticio" } }],
      },
      "dn_a",
    ),
    [{ id: "cv_fixture", name: "Cliente ficticio", preview: "", unread: 0 }],
  );
});

test("team reactions are counted without exposing author IDs and supervision remains read-only", () => {
  const threads = teamThreads({
    threads: [{ id: "tct_a", relation: "oversight" }],
  });
  assert.equal(threads[0]?.supervised, true);
  const message = {
    id: "tcm_a",
    threadId: "tct_a",
    author: { id: "u_a", name: "Compañero ficticio" },
    body: "Hola",
    createdAt: at(1),
    reactions: [{ emoji: "👍", userIds: ["u_b", "u_b", "u_c"] }],
  };
  const scope = areaHistory(
    {
      messages: [message],
      relation: "oversight",
      canPost: true,
      hasMore: true,
    },
    "team",
    "tct_a",
  );
  assert.equal(scope.canPost, false);
  assert.equal(scope.more, true);
  assert.deepEqual(scope.messages[0]?.reactions, [{ emoji: "👍", count: 2 }]);
  assert.equal(
    areaHistory(
      { messages: [], relation: "member", canPost: true },
      "team",
      "tct_a",
    ).canPost,
    true,
  );
  assert.throws(() => areaHistory({ messages: [message] }, "team", "tct_b"));
});

test("team and own-number requests use Bearer and report 401, 403, 404, 429 and offline", async () => {
  const routes = [
    "/api/team-chat/threads",
    inboxHistoryPath("team", "tct_a"),
    "/api/settings/my-number",
    "/api/my-number/chats",
    inboxHistoryPath("number", "cv_a"),
  ];
  for (const route of routes) {
    for (const status of [200, 401, 403, 404, 429, 0]) {
      let saved: string | null = null;
      const requested: string[] = [];
      const repo = new RemoteAuthRepository(
        "staging",
        "https://crm.example.test",
        {
          async get() {
            return saved;
          },
          async set(_key, value) {
            saved = value;
          },
          async remove() {
            saved = null;
          },
        },
        async (url, init) => {
          const path = new URL(String(url)).pathname;
          if (path === "/api/mobile/session")
            return Response.json({
              token: "fixture.signature",
              expiresAt: "2100-01-01T00:00:00Z",
            });
          requested.push(path);
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer fixture.signature",
          );
          assert.equal(init?.credentials, "omit");
          if (!status) throw Error("offline");
          return Response.json({ ok: status === 200 }, { status });
        },
      );
      await repo.signIn("fixture@example.test", "fixture");
      const result = repo.read(route);
      if (status === 200) assert.deepEqual(await result, { ok: true });
      else
        await assert.rejects(
          result,
          (error) =>
            error instanceof RemoteHttpError &&
            error.status === status &&
            requiresRemoteLogin(error) === (status === 401),
        );
      assert.deepEqual(requested, [route]);
    }
  }
});

test("team text requires the send flag and concurrent taps submit only one write", async () => {
  for (const allowSend of [false, true]) {
    const writes: object[] = [];
    let complete: (() => void) | undefined;
    const repo = new RemoteAuthRepository(
      "staging",
      "https://crm.example.test",
      {
        async get() {
          return null;
        },
        async set() {},
        async remove() {},
      },
      async (url, init) => {
        const { pathname } = new URL(String(url));
        if (pathname === "/api/mobile/session")
          return Response.json({
            token: "fixture.signature",
            expiresAt: "2100-01-01T00:00:00Z",
          });
        assert.equal(pathname, "/api/team-chat/threads/tct_a/messages");
        assert.equal(init?.method, "POST");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer fixture.signature",
        );
        writes.push(JSON.parse(String(init?.body)));
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
        return Response.json(
          { message: { id: "msg_fixture" } },
          { status: 201 },
        );
      },
      Date.now,
      allowSend,
    );
    await repo.signIn("fixture@example.test", "fixture");
    if (!allowSend) {
      await assert.rejects(
        repo.sendTeamText("tct_a", "Hola"),
        (e) => e instanceof RemoteHttpError && e.status === 403,
      );
      assert.deepEqual(writes, []);
      continue;
    }
    const writing = repo.sendTeamText("tct_a", " Hola ");
    assert.equal(await repo.sendTeamText("tct_a", "Hola"), null);
    assert.deepEqual(writes, [{ body: "Hola" }]);
    assert.ok(complete);
    complete();
    assert.deepEqual(await writing, { message: { id: "msg_fixture" } });
  }
});
