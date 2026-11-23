/** C11 · Bandeja real con PostgreSQL y wa-mock, en loopback. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = new URL(process.env.APP_BASE_URL ?? "http://localhost:3000");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname), "C11 solo corre en loopback");
assert.equal(process.env.WA_MOCK_ENABLED, "true");
const suffix = Math.random().toString(36).slice(2, 10);
const contact = "Cliente ficticio C11 " + suffix;
const waId = "wamid.c11.base." + suffix;
const quotedId = "wamid.c11.reply." + suffix;
const phoneNumberId = "PN-C11";
const fakePhone = "1555010" + String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
const screenshotDir = process.env.C11_SCREENSHOTS ?? "docs/mockups/citas-reacciones";
const browser = await chromium.launch({
  ...(existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {}),
});
const context = await browser.newContext({ viewport: { width: 1260, height: 850 } });
context.setDefaultNavigationTimeout(120_000);
context.setDefaultTimeout(45_000);
await context.route("**/*", (route) => {
  const target = new URL(route.request().url());
  return target.origin === base.origin ? route.continue() : route.abort();
});
const http = context.request;
const wait = async (check, label) => {
  const end = Date.now() + 20000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
};
const post = (path, data) => http.post(new URL(path, base).href, { data, headers: { origin: base.origin } });
const put = (path, data) => http.put(new URL(path, base).href, { data, headers: { origin: base.origin } });
const json = async (path) => {
  const result = await http.get(new URL(path, base).href);
  assert.ok(result.ok(), `GET ${path}: HTTP ${result.status()}`);
  return result.json();
};

try {
  const account = { email: "e2e-c11@fixture.test", password: "fixture-password-c11-local", name: "Operador ficticio" };
  let auth = await post("/api/auth/sign-up/email", account);
  if (!auth.ok()) auth = await post("/api/auth/sign-in/email", account);
  assert.ok(auth.ok(), "login ficticio");
  assert.ok((await put("/api/settings/whatsapp", { wabaId: "WABA-C11", phoneNumberId, token: "fixture-c11" })).ok());
  const inbound = (fields) => post("/api/dev/wa-mock/inbound", {
    phoneNumberId, from: fakePhone, name: contact, ...fields,
  });
  assert.ok((await inbound({ waMessageId: waId, text: "¿Tienen horarios el jueves?" })).ok());
  const conv = await wait(async () => (await json("/api/conversations")).conversations.find((c) => c.contact.phone === fakePhone), "chat inicial");
  const path = `/api/conversations/${conv.id}/messages`;
  const initial = (await json(path)).messages.find((m) => m.text === "¿Tienen horarios el jueves?");
  assert.ok(initial);
  assert.ok((await inbound({
    waMessageId: quotedId, text: "Me interesa el horario de la tarde.", context: { id: waId },
  })).ok());
  const reply = await wait(async () => (await json(path)).messages.find((m) => m.replyTo?.id === initial.id), "cita entrante");

  const page = await context.newPage();
  const streamReady = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/events" && response.ok(), { timeout: 120_000 });
  await page.goto(new URL("/inbox", base).href, { waitUntil: "domcontentloaded" });
  await streamReady;
  await page.getByText(contact, { exact: true }).first().click();
  const quoted = page.locator(`[data-message-id="${reply.id}"]`);
  await quoted.getByRole("button", { name: "Ir al mensaje citado" }).click();
  const original = page.locator(`[data-message-id="${initial.id}"]`);
  const before = (await json(path)).messages.length;
  assert.ok((await inbound({
    type: "reaction", waMessageId: "wamid.c11.reaction." + suffix, reaction: { message_id: waId, emoji: "👍" },
  })).ok());
  await original.getByText("👍", { exact: true }).waitFor();
  assert.equal((await json(path)).messages.length, before);

  await original.getByLabel("Acciones del mensaje", { exact: true }).click();
  await original.getByRole("button", { name: "Responder", exact: true }).click();
  await page.getByLabel("Cita seleccionada").waitFor();
  const composer = page.getByPlaceholder("Escribe un mensaje");
  await composer.fill("Sí, tenemos disponibilidad el jueves a las 16:00.");
  await composer.press("Enter");
  const sent = await wait(async () => (await json(path)).messages.find((m) => m.direction === "out" && m.replyTo?.id === initial.id), "cita saliente");
  await page.locator(`[data-message-id="${sent.id}"]`).getByRole("button", { name: "Ir al mensaje citado" }).waitFor();

  await original.getByLabel("Acciones del mensaje", { exact: true }).click();
  await original.getByRole("button", { name: "Reaccionar", exact: true }).click();
  await original.getByRole("button", { name: "Reaccionar con ❤️" }).click();
  await original.getByLabel("❤️ del equipo", { exact: true }).waitFor();
  const logs = (await json("/api/dev/wa-mock/outbox")).outbox;
  assert.equal(logs.filter((o) => o.body.context?.message_id === waId && o.type === "text").length, 1);
  assert.equal(logs.filter((o) => o.type === "reaction" && o.body.reaction?.message_id === waId).length, 1);

  mkdirSync(screenshotDir, { recursive: true });
  for (const mode of ["light", "dark"]) {
    await page.evaluate((color) => {
      document.documentElement.classList.toggle("dark", color === "dark");
      document.documentElement.setAttribute("data-theme", color);
    }, mode);
    await page.screenshot({ path: `${screenshotDir}/${mode === "light" ? "claro" : "oscuro"}.png`, animations: "disabled" });
  }
  await original.getByLabel("Acciones del mensaje", { exact: true }).click();
  await original.getByRole("button", { name: "Reaccionar", exact: true }).click();
  await original.getByRole("button", { name: "Quitar reacción" }).click();
  await original.getByLabel("❤️ del equipo", { exact: true }).waitFor({ state: "detached" });
  assert.equal((await put(path + "/msg_ficticio/reaction", { emoji: "👍" })).status(), 404);
  console.log("C11 E2E: cita y salto, reacción SSE, envío con cita, reacción saliente sin duplicados, retiro y destino 404. Capturas claro/oscuro.");
} finally {
  await browser.close();
}
