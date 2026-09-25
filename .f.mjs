import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [SP, V] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1300, height: 1400 } });
const data = readFileSync(V).toString("base64");
await p.setContent(`<body style="margin:0;background:#222"><video id=v muted src="data:video/webm;base64,${data}"></video><canvas id=c width=1280 height=1380></canvas></body>`);
const dur = await p.evaluate(async () => { const v = document.getElementById("v"); await new Promise(r => v.readyState >= 1 ? r() : v.onloadedmetadata = r); if (v.duration === Infinity) { v.currentTime = 1e9; await new Promise(r => v.ontimeupdate = r); } return v.duration; });
console.log("duración", dur);
const times = JSON.parse(process.argv[4] || "[]");
await p.evaluate(async (times) => {
  const v = document.getElementById("v"), c = document.getElementById("c").getContext("2d");
  const cols = 3, w = 1280 / cols, h = w * 720 / 1280;
  for (let i = 0; i < times.length; i++) {
    v.currentTime = times[i]; await new Promise(r => v.onseeked = r);
    c.drawImage(v, 224, 0, 420, 140, (i % cols) * w, Math.floor(i / cols) * (h + 22), w, w * 140 / 420);
    c.fillStyle = "#ff0"; c.font = "16px sans-serif"; c.fillText(times[i].toFixed(2) + "s", (i % cols) * w + 6, Math.floor(i / cols) * (h + 22) + h + 17);
  }
}, times);
await p.locator("#c").screenshot({ path: `${SP}/video/hoja.png` });
await b.close();
