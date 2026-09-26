/** Calibración: 15 s de Bandeja con mensajes entrando, grabado a 60 fps. */
import { launch, newContext, login, Recorder, settle, sleep, inbound, phone, moveTo, clickOn, fullscreen, trackNetwork, fpsMeterStart, fpsMeterStop, BASE } from "./lib.mjs";

const browser = await launch();
const ctx = await newContext(browser);
const page = await ctx.newPage();
await fullscreen(page);
trackNetwork(page);
await login(page, "carlos");
await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
await settle(page, 1500);
const rec = new Recorder("calibracion");
await fpsMeterStart(page);
await rec.start(page);
const t0 = Date.now();
const msgs = [
  [4, "Guadalupe Chan", "Mejor que sean 15 bultos, ¿me los mandan hoy?"],
  [10, "Patricia Vázquez", "¿El martes me lo pueden llevar?"],
  [17, "Alberto Jiménez", "¿Tienen también centro de carga de 4 polos?"],
  [23, "Luis Alfonso Kú", "Ya me decidí, mándame todo 👍"],
];
let i = 0;
while (Date.now() - t0 < 15000) {
  if (i < msgs.length && Date.now() - t0 > 1500 + i * 3200) {
    const [n, name, text] = msgs[i++];
    await inbound({ from: phone(n), name, text });
  }
  const el = Date.now() - t0;
  if (el > 5000 && !page.__s1) { page.__s1 = 1; await clickOn(page, "button[aria-label='Colapsar el menú']", { after: 300 }); continue; }
  if (el > 8000 && !page.__s2) { page.__s2 = 1; await clickOn(page, "button[aria-label='Ocultar el menú']", { after: 300 }); continue; }
  if (el > 11000 && !page.__s3) { page.__s3 = 1; await clickOn(page, "button[aria-label='Mostrar el menú']", { after: 300 }); continue; }
  await moveTo(page, 300 + Math.random() * 1400, 200 + Math.random() * 700, 900);
}
const fps = await fpsMeterStop(page);
const stats = await rec.stop();
console.log(JSON.stringify({ ...stats, ...fps }));
await browser.close();
