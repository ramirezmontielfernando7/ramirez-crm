import assert from "node:assert/strict";
import { test } from "node:test";
import { DemoConversationRepository } from "../src/features/inbox/model";
import {
  ChatStore,
  DraftRepository,
  type LocalStoragePort,
} from "../src/features/chat/core";
import {
  DemoHistoryRepository,
  DemoTransport,
  fillTemplate,
  libraryEntry,
  samples,
  textParts,
  validateAttachment,
  WINDOW_MS,
  windowOpen,
  type MessageTransport,
} from "../src/features/chat/model";
const owner = { id: "demo-owner", role: "owner" } as const,
  advisor = { id: "demo-advisor", role: "advisor" } as const;
function memory() {
  const data = new Map<string, string>();
  let fail = false;
  return {
    data,
    setFail: (v: boolean) => {
      fail = v;
    },
    async get(key: string) {
      if (fail) throw new Error("storage unavailable");
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      if (fail) throw new Error("storage unavailable");
      data.set(key, value);
    },
    async remove(key: string) {
      data.delete(key);
    },
  };
}
function fixture({
  id = "demo-conv-1",
  actor = owner,
  storage = memory(),
  transport = new DemoTransport(async () => {}),
}: {
  id?: string;
  actor?: typeof owner | typeof advisor;
  storage?: ReturnType<typeof memory>;
  transport?: MessageTransport;
} = {}) {
  let time = 2_000_000_000_000;
  const repo = new DemoConversationRepository();
  const drafts = new DraftRepository(storage);
  const history = new DemoHistoryRepository(repo, () => time);
  const store = new ChatStore(
    actor,
    id,
    repo,
    history,
    transport,
    drafts,
    () => {},
    () => time,
  );
  return {
    store,
    repo,
    drafts,
    history,
    storage,
    transport,
    time: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
test("24h window is checked at the exact boundary and cannot be opened by sending a template or IA", async () => {
  assert.equal(windowOpen(100, 100 + WINDOW_MS - 1), true);
  assert.equal(windowOpen(100, 100 + WINDOW_MS), false);
  assert.equal(windowOpen(100, 99), false);
  const f = fixture({ id: "demo-conv-7" });
  await f.store.hydrate();
  assert.throws(() => f.store.send({ text: "Hola" }), /24 horas/);
  const template = await f.store.send({
    text: "",
    templateId: "recordatorio_cita",
    variables: ["Unid", "martes", "10:00"],
  });
  assert.equal(template.status, "read");
  assert.equal(f.store.isOpen(), false);
  f.store.receive("ai");
  assert.equal(f.store.isOpen(), false);
  f.store.receive();
  assert.equal(f.store.isOpen(), true);
});
test("templates require approval and every variable; library forbids knowledge-only material", () => {
  assert.throws(() => fillTemplate("te_extrañamos", ["Ana"]), /aprobada/);
  assert.throws(
    () => fillTemplate("recordatorio_cita", ["Ana", "", "10:00"]),
    /variables/,
  );
  assert.ok(
    fillTemplate("recordatorio_cita", ["Ana", "martes", "10:00"]).includes(
      "Ana",
    ),
  );
  assert.throws(() => libraryEntry("faq"), /no está disponible/);
  assert.ok(libraryEntry("catalog").attachment);
});
test("history pages are bounded, chronological, scoped and non-overlapping", () => {
  const f = fixture();
  const first = f.history.page(owner, "demo-conv-1", undefined, 20);
  const second = f.history.page(owner, "demo-conv-1", first.before, 40);
  assert.equal(first.messages.length, 20);
  assert.equal(second.messages.length, 40);
  assert.equal(
    new Set([...second.messages, ...first.messages].map((m) => m.id)).size,
    60,
  );
  assert.ok(second.messages.at(-1)!.time < first.messages[0]!.time);
  assert.throws(() => f.history.page(advisor, "demo-conv-1", 1000));
  assert.throws(() => f.history.page(owner, "demo-conv-1", -1));
  assert.throws(() => f.history.page(owner, "demo-conv-1", 1000, 101));
  const closed = f.history.page(owner, "demo-conv-7", undefined, 1);
  assert.ok(f.time() - closed.messages[0]!.time > WINDOW_MS);
});
test("loading older pages retains identity, serializes concurrent requests and retries the same cursor after error", async () => {
  const f = fixture();
  await f.store.hydrate();
  const recent = f.store.snapshot().messages.at(-1)!;
  const a = f.store.loadOlder(),
    b = f.store.loadOlder();
  assert.equal(a, b);
  await a;
  assert.equal(f.store.snapshot().messages.length, 60);
  assert.equal(f.store.snapshot().messages.at(-1), recent);
  const before = f.store.snapshot().before;
  f.store.failNextPage = true;
  await f.store.loadOlder();
  assert.equal(f.store.snapshot().before, before);
  assert.ok(f.store.snapshot().pageError);
  await f.store.loadOlder();
  assert.equal(f.store.snapshot().messages.length, 100);
  assert.equal(f.store.snapshot().pageError, "");
  await f.store.hydrate();
  assert.equal(f.store.snapshot().messages.length, 100);
});
test("persistent drafts serialize fast edits and survive a new store without leaking across profiles", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.setDraft("H");
  f.store.setDraft("Hola");
  f.store.setDraft("Hola persistente");
  await f.store.flushDraft();
  const next = new ChatStore(
    owner,
    "demo-conv-1",
    f.repo,
    f.history,
    new DemoTransport(async () => {}),
    f.drafts,
  );
  await next.hydrate();
  assert.equal(next.snapshot().draft, "Hola persistente");
  const other = new ChatStore(
    advisor,
    "demo-conv-3",
    f.repo,
    f.history,
    new DemoTransport(async () => {}),
    f.drafts,
  );
  await other.hydrate();
  assert.equal(other.snapshot().draft, "");
});
test("storage failures remain visible and retry restores a usable draft; corrupt data is not overwritten", async () => {
  const f = fixture();
  f.storage.setFail(true);
  await f.store.hydrate();
  assert.equal(f.store.snapshot().ready, false);
  assert.ok(f.store.snapshot().error);
  assert.throws(() => f.store.setDraft("overwrite"));
  f.storage.setFail(false);
  await f.store.hydrate();
  f.storage.setFail(true);
  f.store.setDraft("No perder");
  await assert.rejects(f.store.flushDraft());
  assert.ok(f.store.snapshot().draftError);
  f.storage.setFail(false);
  await f.store.retryDraft();
  assert.equal(f.store.snapshot().draftError, "");
  const corrupted = fixture();
  corrupted.storage.data.set(corrupted.store.storageKey, "{broken");
  await corrupted.store.hydrate();
  assert.equal(corrupted.store.snapshot().ready, false);
  assert.equal(
    corrupted.storage.data.get(corrupted.store.storageKey),
    "{broken",
  );
});
test("delivery transitions pending → sent → delivered → read with no duplicate for the same key", async () => {
  const f = fixture();
  await f.store.hydrate();
  const states: string[] = [];
  f.store.subscribe(() => {
    const m = f.store.snapshot().messages.find((m) => m.id.includes(":out:"));
    if (m && states.at(-1) !== m.status) states.push(m.status);
  });
  const a = f.store.send({ key: "stable", text: "Hola" }),
    b = f.store.send({ key: "stable", text: "Hola" });
  assert.equal(a, b);
  const result = await a;
  assert.deepEqual(states, ["pending", "sent", "delivered", "read"]);
  assert.equal(result.status, "read");
  assert.equal(
    f.store.snapshot().messages.filter((m) => m.id === result.id).length,
    1,
  );
  assert.throws(
    () => f.store.send({ key: "stable", text: "otro contenido" }),
    /otro mensaje/,
  );
});
test("lost ACK and multipart retries reuse the same message and transport part IDs", async () => {
  const transport = new DemoTransport(async () => {});
  const f = fixture({ transport });
  await f.store.hydrate();
  transport.nextFailure = "ack";
  const text = "a".repeat(9000);
  const failed = await f.store.send({ text });
  assert.equal(failed.status, "failed");
  assert.equal(transport.accepted.size, 1);
  const a = f.store.retry(failed.id),
    b = f.store.retry(failed.id);
  assert.equal(a, b);
  const read = await a;
  assert.equal(read.id, failed.id);
  assert.equal(read.status, "read");
  assert.equal(transport.accepted.size, 3);
  await f.store.retry(read.id);
  assert.equal(transport.accepted.size, 3);
  assert.equal(
    f.store.snapshot().messages.filter((m) => m.id === read.id).length,
    1,
  );
});
test("expiry after enqueue but before transport is not masked as a successful send", async () => {
  const f = fixture();
  await f.store.hydrate();
  const pending = f.store.send({ text: "Justo al vencer" });
  f.advance(WINDOW_MS);
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.match(result.failure!, /24 horas/);
  assert.equal((f.transport as DemoTransport).accepted.size, 0);
  assert.throws(() => f.store.retry(result.id), /24 horas/);
});
test("text splitting obeys the mobile/web contract, preserves emoji and rejects over-limit text", () => {
  const emoji = "🙂".repeat(3000);
  const parts = textParts(emoji);
  assert.equal(parts.join(""), emoji);
  assert.ok(parts.every((p) => p.length <= 4096));
  assert.ok(textParts("a".repeat(65536)).length >= 16);
  assert.throws(() => textParts("a".repeat(65537)));
  assert.throws(() => textParts("   "));
});
test("attachment metadata validates limits, active content, readable samples and caption length", async () => {
  assert.doesNotThrow(() => validateAttachment(samples[0]!));
  assert.throws(
    () => validateAttachment(samples.find((s) => s.id === "large")!),
    /5 MB/,
  );
  assert.throws(
    () => validateAttachment(samples.find((s) => s.id === "broken")!),
    /leer/,
  );
  assert.throws(
    () => validateAttachment({ ...samples[2]!, bytes: 101 * 1024 * 1024 }),
    /100 MB/,
  );
  assert.throws(
    () =>
      validateAttachment({
        ...samples[0]!,
        name: "unsafe.SVG",
        mime: "image/svg+xml",
      }),
    /SVG/,
  );
  const f = fixture();
  await f.store.hydrate();
  assert.throws(
    () => f.store.send({ text: "a".repeat(1025), attachment: samples[0] }),
    /1.024/,
  );
});
test("sending clears the old draft without overwriting newly typed text", async () => {
  let release!: () => void;
  const transport: MessageTransport = {
    send: (_, report) =>
      new Promise<void>((resolve) => {
        release = () => {
          report("read");
          resolve();
        };
      }),
  };
  const f = fixture({ transport });
  await f.store.hydrate();
  f.store.setDraft("Primer mensaje");
  const pending = f.store.sendDraft();
  await Promise.resolve();
  assert.equal(f.store.snapshot().draft, "");
  f.store.setDraft("Siguiente borrador");
  release();
  await pending;
  await f.store.flushDraft();
  assert.equal(f.store.snapshot().draft, "Siguiente borrador");
  assert.equal(
    (await f.drafts.read(f.store.storageKey)).draft,
    "Siguiente borrador",
  );
});
test("deletion is role-protected, retains the contact and persists a local history tombstone", async () => {
  const adviser = fixture({ actor: advisor, id: "demo-conv-3" });
  await adviser.store.hydrate();
  await assert.rejects(adviser.store.remove(), /perfil/);
  const f = fixture();
  await f.store.hydrate();
  f.store.setDraft("Borrar borrador ficticio");
  await f.store.remove();
  assert.equal(f.store.snapshot().messages.length, 0);
  assert.ok(f.repo.get(owner, "demo-conv-1"));
  const next = new ChatStore(
    owner,
    "demo-conv-1",
    f.repo,
    f.history,
    new DemoTransport(async () => {}),
    f.drafts,
  );
  await next.hydrate();
  assert.equal(next.snapshot().messages.length, 0);
  assert.equal(next.snapshot().draft, "");
  assert.equal(next.snapshot().historyDeleted, true);
});
test("offline receipt queues until reconnect and opens the window only for a customer", async () => {
  const f = fixture({ id: "demo-conv-7" });
  await f.store.hydrate();
  f.store.setView("offline");
  const count = f.store.snapshot().messages.length;
  f.store.receive();
  assert.equal(f.store.snapshot().messages.length, count);
  assert.equal(f.store.isOpen(), false);
  f.store.reconnect();
  assert.equal(f.store.snapshot().messages.length, count + 1);
  assert.equal(f.store.isOpen(), true);
  f.store.reconnect();
  assert.equal(f.store.snapshot().messages.length, count + 1);
});
test("transport failure reports and missing acknowledgement never leave a false pending success", async () => {
  for (const transport of [
    {
      async send(_m, report) {
        report("failed");
      },
    },
    { async send() {} },
  ] satisfies MessageTransport[]) {
    const f = fixture({ transport });
    await f.store.hydrate();
    const result = await f.store.send({ text: "Confirmación obligatoria" });
    assert.equal(result.status, "failed");
    assert.match(result.failure!, /No se confirmó/);
    assert.equal(f.store.snapshot().busy, 0);
  }
});
test("sending the first message restores an empty demo view", async () => {
  const f = fixture();
  await f.store.hydrate();
  f.store.setView("empty");
  await f.store.send({ text: "Primer mensaje" });
  assert.equal(f.store.snapshot().view, "normal");
});
test("all 1,000 history items page without gaps, duplication or allocating another conversation", async () => {
  const f = fixture();
  const start = performance.now();
  await f.store.hydrate();
  while (f.store.snapshot().hasMore) await f.store.loadOlder();
  const messages = f.store.snapshot().messages;
  assert.equal(messages.length, 1000);
  assert.equal(new Set(messages.map((m) => m.id)).size, 1000);
  assert.ok(
    messages.every((m, i) => i === 0 || m.time >= messages[i - 1]!.time),
  );
  console.log(
    JSON.stringify({
      chatMessages: 1000,
      pageSize: 40,
      localLogicMs: +(performance.now() - start).toFixed(3),
    }),
  );
});
test("history timestamps stay stable when an older page is loaded hours later", () => {
  const f = fixture();
  const first = f.history.page(owner, "demo-conv-1", undefined);
  f.advance(12 * 3600_000);
  const older = f.history.page(owner, "demo-conv-1", first.before);
  assert.ok(older.messages.at(-1)!.time < first.messages[0]!.time);
  assert.deepEqual(f.history.page(owner, "demo-conv-1", undefined), first);
});
test("a newly created demo contact begins empty and requires a template", async () => {
  const f = fixture();
  const c = f.repo.create(owner, "Nuevo contacto ficticio", "+52 55 5555 9988");
  assert.deepEqual(f.history.page(owner, c.id, undefined), {
    messages: [],
    before: 0,
    hasMore: false,
  });
  const store = new ChatStore(
    owner,
    c.id,
    f.repo,
    f.history,
    f.transport,
    f.drafts,
  );
  await store.hydrate();
  assert.equal(store.snapshot().messages.length, 0);
  assert.equal(store.isOpen(), false);
});
