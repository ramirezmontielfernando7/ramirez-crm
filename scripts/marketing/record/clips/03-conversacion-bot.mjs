/**
 * 03 — El bot atiende y pasa el chat a un asesor. Se ve desde la pantalla
 * de Diego (asesor): el chat de la clienta ya es suyo (asignado antes de
 * grabar), el bot contesta, la clienta pide un asesor, llega el aviso y
 * Diego responde.
 */
import { BASE, SEED, login, settle, step, readAlong, clickOn, hover, moveTo, typeText, holdUntil, drift, inbound, phone, apiClient, sleep } from "../lib.mjs";

export const meta = { title: "Bot con paso a asesor", subs: 175, startPos: { x: 1080, y: 640 } };
const CLIENTA = { from: phone(74), name: "Mariela Poot" };

export async function prepare({ page }) {
  // Antes de grabar: la clienta saluda, el bot contesta y el chat se asigna a Diego.
  await inbound({ ...CLIENTA, text: "Hola, buenas tardes" });
  const carlos = await apiClient("carlos", "10.64.0.10");
  let conv;
  for (let i = 0; i < 40 && !conv; i++) {
    const { conversations } = await carlos.call("/api/conversations");
    conv = conversations.find((c) => c.contact.name === "Mariela Poot");
    if (!conv) await sleep(250);
  }
  const diegoId = SEED().uid.diego;
  await carlos.call("/api/assignments", "POST", { contactIds: [conv.contact.id], userId: diegoId });
  for (let i = 0; i < 40; i++) {
    const { messages } = await carlos.call(`/api/conversations/${conv.id}/messages`);
    if (messages?.some((m) => m.direction === "out")) break;
    await sleep(250);
  }
  await login(page, "diego");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 800);
  await page.locator("button", { hasText: "Mariela Poot" }).first().click();
  await settle(page, 1200);
}

const THREAD = { x: 1080, y: 700 };
const lastBubble = (page, text) => page.getByText(text).last().waitFor({ timeout: 20000 });

export async function run({ page }) {
  step("La clienta pregunta un precio");
  await moveTo(page, THREAD.x, THREAD.y, 800);
  await inbound({ ...CLIENTA, text: "¿Cuánto cuesta el bulto de cemento?" });
  await holdUntil(page, lastBubble(page, "¿Cuánto cuesta el bulto de cemento?"), { x: 700, y: 640 });
  step("El bot responde al instante");
  await holdUntil(page, lastBubble(page, "bulto de cemento gris de 50 kg"), { x: 1240, y: 700 });
  await settle(page, 300);
  await readAlong(page, page.getByText("bulto de cemento gris de 50 kg").last(), 1500);

  step("También resuelve horarios");
  await inbound({ ...CLIENTA, text: "¿Y abren el domingo?" });
  await holdUntil(page, lastBubble(page, "¿Y abren el domingo?"), { x: 700, y: 760 });
  await holdUntil(page, lastBubble(page, "domingos de 9:00 a 14:00"), { x: 1240, y: 780 });
  await settle(page, 300);
  await readAlong(page, page.getByText("domingos de 9:00 a 14:00").last(), 1400);

  step("La clienta pide hablar con un asesor");
  await inbound({ ...CLIENTA, text: "¿Me atiende un asesor? Necesito factura" });
  await holdUntil(page, lastBubble(page, "Necesito factura"), { x: 720, y: 820 });
  await holdUntil(page, lastBubble(page, "te comunico con una persona"), { x: 1240, y: 850 });
  await settle(page, 300);
  await readAlong(page, page.getByText("te comunico con una persona").last(), 1000);

  step("Diego recibe el aviso de atención humana", { read: true });
  await holdUntil(page, page.getByText("Atención humana: Mariela Poot").first().waitFor({ timeout: 15000 }), { x: 1700, y: 960 });
  await hover(page, page.getByText("Atención humana: Mariela Poot").first(), { dx: 0.3 });
  await sleep(700);
  await hover(page, page.getByText("te toca a ti").first(), { dx: 0.3 });
  await sleep(600);

  step("El asesor toma el chat y responde");
  await clickOn(page, page.getByPlaceholder("Escribe una respuesta…"), { after: 200 });
  await typeText(page, "¡Hola Mariela! Soy Diego, te ayudo con tu factura. ¿Me compartes tu RFC?", 62);
  await clickOn(page, "button[aria-label='Enviar']", { after: 700 });
  await holdUntil(page, lastBubble(page, "Soy Diego, te ayudo"), { x: 1250, y: 880 });
  await inbound({ ...CLIENTA, text: "Claro: POMM900101XXX. ¡Gracias, Diego!" });
  step("Listo: atendida por una persona", { read: true });
  await holdUntil(page, lastBubble(page, "¡Gracias, Diego!"), { x: 760, y: 700 });
  await settle(page, 300);
  await hover(page, page.getByText("Soy Diego, te ayudo").last(), { dx: 0.8 });
  await sleep(1500);
}
