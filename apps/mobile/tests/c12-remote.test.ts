import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowsRemoteRequest,
  isReactionEmoji,
  RemoteAuthRepository,
  RemoteHttpError,
  remoteSendEnabled,
} from "../src/integration/remote-http";
import { areaHistory } from "../src/integration/remote-inbox-areas";
import { messagesResponse } from "../src/integration/wire";
import { ownReaction, reactionFailure } from "../src/integration/reactions";

const cv = "cv_fixture";
const base = {
  conversationId: cv,
  direction: "in",
  status: "delivered",
  text: "Hola",
  createdAt: "2026-11-27T10:00:00.000Z",
  aiGenerated: false,
};

function fixture(flag?: string) {
  const calls: { method?: string; path: string; body: unknown }[] = [];
  const responses: (() => Promise<Response>)[] = [];
  let stored: string | null = null;
  const auth = new RemoteAuthRepository(
    "production",
    "https://dash.demfort.com",
    {
      get: async () => stored,
      set: async (_k, v) => {
        stored = v;
      },
      remove: async () => {
        stored = null;
      },
    },
    async (url, init) => {
      calls.push({
        method: init.method,
        path: new URL(url).pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = responses.shift();
      if (!next) throw new Error("network fixture");
      return next();
    },
    () => 1_000,
    remoteSendEnabled(flag),
  );
  const signIn = async () => {
    responses.push(async () =>
      Response.json({
        token: "fixture.signature",
        expiresAt: "2100-01-01T00:00:00Z",
      }),
    );
    await auth.signIn("fixture@example.test", "fixture");
  };
  return { auth, calls, responses, signIn };
}

test("C12 parses server reactions and replyTo, tolerating absence and garbage", () => {
  const [full, none, bad] = messagesResponse(
    {
      messages: [
        {
          ...base,
          id: "msg_1",
          reactions: [
            { direction: "in", emoji: "👍" },
            { direction: "out", emoji: "❤️" },
            { direction: "x", emoji: "👍" },
            { direction: "in", emoji: "no-emoji" },
          ],
          replyTo: {
            id: "msg_0",
            direction: "out",
            type: "text",
            preview: "Texto ficticio",
          },
        },
        { ...base, id: "msg_2" },
        {
          ...base,
          id: "msg_3",
          reactions: "nope",
          replyTo: { id: "../x", direction: "in", preview: "x" },
        },
      ],
    },
    cv,
  );
  assert.deepEqual(full?.reactions, [
    { emoji: "👍", count: 1, from: "in" },
    { emoji: "❤️", count: 1, from: "out" },
  ]);
  assert.deepEqual(full?.quote, {
    messageId: "msg_0",
    title: "Equipo",
    preview: "Texto ficticio",
  });
  assert.equal(none?.reactions, undefined);
  assert.equal(none?.quote, undefined);
  assert.equal(bad?.reactions, undefined);
  assert.equal(bad?.quote, undefined);
  assert.equal(ownReaction(full!), "❤️");
  assert.equal(ownReaction(none!), undefined);
});

test("C12 allowlist grows by exactly the reaction PUT and the Mi número POST", () => {
  const react = `/api/conversations/${cv}/messages/msg_1/reaction`;
  const number = "/api/my-number/chats/cv_own/messages";
  assert.equal(allowsRemoteRequest("PUT", react, true), true);
  assert.equal(allowsRemoteRequest("POST", number, true), true);
  assert.equal(allowsRemoteRequest("PUT", react, false), false);
  assert.equal(allowsRemoteRequest("POST", number, false), false);
  for (const method of ["GET", "POST", "PATCH", "DELETE"])
    assert.equal(allowsRemoteRequest(method, react, true), false, method);
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.equal(allowsRemoteRequest(method, number, true), false, method);
  for (const path of [
    react + "/",
    react + "?x=1",
    `/api/conversations/${cv}/messages/${"a".repeat(65)}/reaction`,
    `/api/conversations/${cv}/messages/a%2fb/reaction`,
    `/api/conversations/${cv}/messages//reaction`,
    "/api/my-number/chats/cv_own/messages/media",
    "/api/my-number/chats/cv_own/messages?before=x",
    "/api/my-number/chats/" + "a".repeat(65) + "/messages",
    "/api/my-number/chats/a b/messages",
  ]) {
    assert.equal(allowsRemoteRequest("PUT", path, true), false, path);
    assert.equal(allowsRemoteRequest("POST", path, true), false, path);
  }
});

test("C12 emoji validation allows one emoji or empty only", () => {
  for (const ok of ["", "👍", "❤️", "🇲🇽", "👍🏽", "👨‍👩‍👧", "1️⃣"])
    assert.equal(isReactionEmoji(ok), true, ok);
  for (const bad of ["a", "👍👍", "👍 ", " ", "hola", "👍a", "<b>"])
    assert.equal(isReactionEmoji(bad), false, bad);
});

test("C12 reactions need the flag, send one PUT, and share one lock", async () => {
  const off = fixture();
  await off.signIn();
  await assert.rejects(() => off.auth.reactToMessage(cv, "msg_1", "👍"), {
    status: 403,
  });
  assert.equal(off.calls.length, 1);

  const { auth, calls, responses, signIn } = fixture("true");
  await signIn();
  const pair = Promise.withResolvers<Response>();
  responses.push(() => pair.promise);
  const first = auth.reactToMessage(cv, "msg_1", "👍");
  assert.equal(await auth.reactToMessage(cv, "msg_1", "❤️"), null);
  pair.resolve(Response.json({ ok: true, changed: true }));
  assert.deepEqual(await first, { changed: true });
  assert.deepEqual(calls[1], {
    method: "PUT",
    path: `/api/conversations/${cv}/messages/msg_1/reaction`,
    body: { emoji: "👍" },
  });
  responses.push(async () => Response.json({ ok: true, changed: false }));
  assert.deepEqual(await auth.reactToMessage(cv, "msg_1", ""), {
    changed: false,
  });
  assert.deepEqual(calls[2]?.body, { emoji: "" });
  await assert.rejects(() => auth.reactToMessage(cv, "msg_1", "abc"), {
    status: 422,
  });
  await assert.rejects(() => auth.reactToMessage(cv, "a/b", "👍"));
  assert.equal(calls.length, 3);
  responses.push(async () => Response.json({ ok: false }));
  await assert.rejects(() => auth.reactToMessage(cv, "msg_1", "👍"), {
    status: 502,
  });
});

test("C12 reaction errors: 409 pending and network are uncertain, 403/404 are not", async () => {
  const { auth, responses, signIn } = fixture("true");
  await signIn();
  const failures = [];
  for (const status of [409, 403, 404, 429, 500]) {
    responses.push(async () =>
      Response.json(
        { error: { code: status === 409 ? "reaction_pending" : "other" } },
        { status },
      ),
    );
    try {
      await auth.reactToMessage(cv, "msg_1", "👍");
    } catch (reason) {
      failures.push(reactionFailure(reason).uncertain);
    }
  }
  assert.deepEqual(failures, [true, false, false, false, true]);
  assert.equal(reactionFailure(new Error("network")).uncertain, true);
});

test("C12 quoted send adds only replyToMessageId and reports replyApplied", async () => {
  const { auth, calls, responses, signIn } = fixture("true");
  await signIn();
  responses.push(async () =>
    Response.json({ messageId: "msg_9", replyApplied: false }),
  );
  assert.deepEqual(await auth.sendText(cv, " Hola ", "msg_1"), {
    queued: false,
    replyApplied: false,
  });
  assert.deepEqual(calls[1]?.body, { text: "Hola", replyToMessageId: "msg_1" });
  responses.push(async () => Response.json({ messageId: "msg_10" }));
  assert.deepEqual(await auth.sendText(cv, "Sin cita"), { queued: false });
  assert.deepEqual(calls[2]?.body, { text: "Sin cita" });
  await assert.rejects(() => auth.sendText(cv, "x", "a b"), { status: 422 });
  await assert.rejects(() => auth.sendText(cv, "x", "../msg"), {
    status: 422,
  });
  assert.equal(calls.length, 3);
  responses.push(async () =>
    Response.json({ error: { code: "window_closed" } }, { status: 409 }),
  );
  await assert.rejects(() => auth.sendText(cv, "x", "msg_1"), {
    status: 409,
    code: "window_closed",
  });
});

test("C12 Mi número text uses the existing route only with the flag", async () => {
  const off = fixture();
  await off.signIn();
  await assert.rejects(() => off.auth.sendNumberText("cv_own", "Hola"), {
    status: 403,
  });
  const { auth, calls, responses, signIn } = fixture("true");
  await signIn();
  responses.push(async () =>
    Response.json({ messageId: "msg_7" }, { status: 201 }),
  );
  assert.deepEqual(await auth.sendNumberText("cv_own", " Hola "), {
    queued: false,
  });
  assert.deepEqual(calls[1], {
    method: "POST",
    path: "/api/my-number/chats/cv_own/messages",
    body: { text: "Hola" },
  });
  await assert.rejects(() => auth.sendNumberText("cv_own", "   "), {
    status: 422,
  });
  for (const status of [403, 404, 429, 401]) {
    responses.push(async () => Response.json({}, { status }));
    await assert.rejects(() => auth.sendNumberText("cv_own", "Hola"), {
      status,
    });
  }
  responses.push(async () => {
    throw new Error("network");
  });
  await assert.rejects(() => auth.sendNumberText("cv_own", "Hola"));
  assert.ok(RemoteHttpError);
});

test("C12 Mi número history can post, with foreign chats still rejected", () => {
  assert.equal(
    areaHistory({ messages: [{ ...base, id: "msg_1" }] }, "number", cv).canPost,
    true,
  );
  assert.throws(() =>
    areaHistory({ messages: [{ ...base, id: "msg_1" }] }, "number", "cv_other"),
  );
});
