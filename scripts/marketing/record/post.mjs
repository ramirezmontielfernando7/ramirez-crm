/**
 * Posproducción y revisión automática de un clip (reglas v2).
 *
 *   maestro .mkv (sin pérdida) + línea de tiempo .json
 *     → sincronía por el marcador magenta del primer cuadro
 *     → cursor dibujado en ASS a 60 fps (encima de todo)
 *     → sin-subtitulos/NN.mp4 y con-subtitulos/NN.mp4 (tarjeta de título + subtítulos)
 *     → revisión: freezedetect, scdet, hojas de contactos y métricas
 *
 * Uso suelto: node scripts/marketing/record/post.mjs 02-bandeja [...]
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MASTERS, OUT, FPS } from "./lib.mjs";

const FONT = "DejaVu Sans";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

const run = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 });
const probeDur = (f) => Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`).toString());
const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};
const srtTime = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};

/** Primer cuadro con el marcador magenta en la esquina (segundos del maestro). */
function findMarker(master) {
  const out = execFileSync("ffmpeg", ["-hide_banner", "-t", "8", "-i", master, "-vf", "crop=16:16:16:16,signalstats,metadata=print:file=-", "-f", "null", "-"], { maxBuffer: 1 << 26 }).toString();
  let t = null;
  for (const block of out.split("frame:").slice(1)) {
    const pts = Number(block.match(/pts_time:([\d.]+)/)?.[1]);
    const u = Number(block.match(/UAVG=([\d.]+)/)?.[1]);
    const v = Number(block.match(/VAVG=([\d.]+)/)?.[1]);
    if (u > 185 && v > 200) { t = pts; break; }
  }
  if (t == null) throw new Error("no encontré el marcador de sincronía en " + master);
  return t;
}

/* ---------------- Cursor (ASS) ---------------- */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function cursorAt(tl, tNode) {
  let pos = tl.startPos ?? tl.cursor[0]?.from ?? { x: 1250, y: 560 };
  for (const s of tl.cursor) {
    if (tNode < s.a) break;
    if (tNode >= s.b) { pos = s.to; continue; }
    const u = ease((tNode - s.a) / (s.b - s.a));
    const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, arc = 4 * u * (1 - u) * (s.bend ?? 0);
    return { x: s.from.x + dx * u + nx * arc, y: s.from.y + dy * u + ny * arc };
  }
  return pos;
}
const ARROW = "m 0 0 l 0 21 l 5.8 15.6 l 9.8 24.4 l 13.4 22.8 l 9.4 14.2 l 17.4 14.2";
const circle = (r) => `m ${r} 0 b ${r * 1.55} 0 ${2 * r} ${r * 0.45} ${2 * r} ${r} b ${2 * r} ${r * 1.55} ${r * 1.55} ${2 * r} ${r} ${2 * r} b ${r * 0.45} ${2 * r} 0 ${r * 1.55} 0 ${r} b 0 ${r * 0.45} ${r * 0.45} 0 ${r} 0`;

function cursorAss(tl, dur) {
  const lines = [];
  const step = 1 / FPS;
  const clickAt = (tNode) => tl.clicks.some((c) => tNode >= c.t && tNode < c.t + 200);
  let prev = null, since = 0;
  const flush = (end) => {
    if (!prev) return;
    const { x, y, k } = prev;
    const r = k ? 17 : 22;
    lines.push(`Dialogue: 0,${assTime(since)},${assTime(end)},C,,0,0,0,,{\\an7\\pos(${(x - r).toFixed(1)},${(y - r).toFixed(1)})\\bord1.5\\shad0\\1c&H9D9912&\\1a&H${k ? "88" : "D0"}&\\3c&H9D9912&\\3a&H80&\\p1}${circle(r)}`);
    lines.push(`Dialogue: 1,${assTime(since)},${assTime(end)},C,,0,0,0,,{\\an7\\pos(${x.toFixed(1)},${y.toFixed(1)})\\bord1.6\\shad0.6\\4a&HA0&\\1c&H111111&\\3c&HFFFFFF&\\p1}${ARROW}`);
  };
  for (let t = 0; t <= dur + 1e-6; t += step) {
    const tNode = tl.contentStart + t * 1000;
    const p = cursorAt(tl, tNode);
    const cur = { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2, k: clickAt(tNode) };
    if (!prev || cur.x !== prev.x || cur.y !== prev.y || cur.k !== prev.k) {
      flush(t);
      prev = cur;
      since = t;
    }
  }
  flush(dur);
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: C,${FONT},20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

/* ---------------- Subtítulos ---------------- */
function subtitleCues(tl, dur) {
  const rel = (t) => (t - tl.contentStart) / 1000;
  return tl.steps.map((s, i) => {
    let start = Math.max(0, rel(s.start));
    let end = rel(s.end ?? tl.contentEnd);
    const next = tl.steps[i + 1];
    if (next) end = Math.min(end, rel(next.start) - 0.05);
    end = Math.min(end, dur - 0.1);
    if (end - start < 1.0) end = Math.min(start + 1.0, dur - 0.1);
    return { start, end, text: s.text, read: s.read };
  });
}
function srtOf(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}
function subsAss(cues, pos) {
  // pos: "top" | "bottom" | número (margen inferior en px, alineado abajo)
  const top = pos === "top";
  const marginV = typeof pos === "number" ? pos : top ? 84 : 72;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: S,${FONT},46,&H00FFFFFF,&H00FFFFFF,&H38101418,&H38101418,0,0,0,0,100,100,0,0,3,16,0,${top ? 8 : 2},120,120,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map((c) => `Dialogue: 2,${assTime(c.start)},${assTime(c.end)},S,,0,0,0,,{\\fad(150,150)}${c.text}`).join("\n")}
`;
}

/* ---------------- Revisión ---------------- */
function freezes(file) {
  const out = execFileSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", "freezedetect=n=-50dB:d=1.2", "-an", "-f", "null", "-"], { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }).toString();
  return out;
}
function runCapture(args) {
  try {
    return execFileSync("ffmpeg", args, { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    return (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
  }
}
function review(file, tl, cues) {
  const fz = runCapture(["-hide_banner", "-i", file, "-vf", "freezedetect=n=-50dB:d=1.2,metadata=print:file=-", "-an", "-f", "null", "-"]);
  const starts = [...fz.matchAll(/freeze_start=([\d.]+)/g)].map((m) => +m[1]);
  const durs = [...fz.matchAll(/freeze_duration=([\d.]+)/g)].map((m) => +m[1]);
  const frozen = starts.map((s, i) => ({ start: +s.toFixed(2), seconds: +(durs[i] ?? 0).toFixed(2) }));
  const reads = cues.filter((c) => c.read);
  const rel = (t) => (t - tl.contentStart) / 1000;
  // Cursor en movimiento o tecleo en curso = hay acción en pantalla.
  const moving = [...tl.cursor.map((c) => [rel(c.a), rel(c.b)]), ...(tl.typing ?? []).map((c) => [rel(c.a), rel(c.b ?? tl.contentEnd)])];
  const dur = (tl.contentEnd - tl.contentStart) / 1000;
  // Dentro de un tramo "congelado" (UI quieta), ¿cuánto dura lo más largo SIN cursor en movimiento?
  const deadIn = (a, b) => {
    const cuts = moving.filter(([x, y]) => y > a && x < b).map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).sort((p, q) => p[0] - q[0]);
    let longest = 0, cur = a;
    for (const [x, y] of cuts) { longest = Math.max(longest, x - cur); cur = Math.max(cur, y); }
    return Math.max(longest, b - cur);
  };
  for (const f of frozen) f.sin_cursor_s = +deadIn(f.start, f.start + f.seconds).toFixed(2);
  const planned = (f) =>
    (f.seconds <= 2.05 && reads.some((r) => f.start >= r.start - 0.5 && f.start <= r.end)) || f.start >= dur - 2.6;
  const unplanned = frozen.filter((f) => f.sin_cursor_s > 1.2 && !planned(f));
  const sc = runCapture(["-hide_banner", "-i", file, "-vf", "scdet=threshold=12,metadata=print:file=-", "-an", "-f", "null", "-"]);
  const cuts = [...sc.matchAll(/lavfi\.scd\.time=([\d.]+)/g)].map((m) => +(+m[1]).toFixed(2));
  const causes = [...tl.clicks.map((c) => rel(c.t)), ...tl.events.map((e) => rel(e.t))];
  const jumps = cuts.map((t) => ({ t, cause: causes.some((c) => t >= c - 0.15 && t <= c + 2.5) ? "prevista (clic/evento)" : "SIN CAUSA" }));
  return { frozen, unplannedFreezes: unplanned, jumps, unexplainedJumps: jumps.filter((j) => j.cause === "SIN CAUSA") };
}
function contactSheet(file, dst) {
  const d = probeDur(file);
  const n = Math.ceil(d / 2);
  const cols = 5, rows = Math.ceil(n / cols);
  run(["-i", file, "-vf", `fps=1/2,scale=384:-1,drawtext=fontfile=${FONT_REG}:text='%{pts\\:hms}':x=6:y=6:fontsize=13:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}:padding=4:color=white`, "-frames:v", "1", "-update", "1", dst]);
}

/* ---------------- Exportación ---------------- */
export async function post(name, clipMeta = {}) {
  const master = path.join(MASTERS, `${name}.mkv`);
  const tl = JSON.parse(readFileSync(path.join(MASTERS, `${name}.timeline.json`), "utf8"));
  const vm = findMarker(master);
  const S = vm + (tl.contentStart - tl.marker) / 1000;
  const dur = (tl.contentEnd - tl.contentStart) / 1000;

  const work = path.join(OUT, "logs", name);
  execSync(`mkdir -p "${work}"`);
  const cursorFile = path.join(work, "cursor.ass");
  writeFileSync(cursorFile, cursorAss(tl, dur));
  const cues = subtitleCues(tl, dur);
  writeFileSync(path.join(OUT, "subtitulos", `${name}.srt`), srtOf(cues));
  const subsFile = path.join(work, "subs.ass");
  writeFileSync(subsFile, subsAss(cues, clipMeta.subs ?? "bottom"));

  const esc = (p) => p.replace(/:/g, "\\:");
  const enc = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart"];
  const fade = `fade=t=in:st=0:d=0.5,fade=t=out:st=${(dur - 0.5).toFixed(3)}:d=0.5`;

  const clean = path.join(OUT, "videos/sin-subtitulos", `${name}.mp4`);
  run(["-ss", S.toFixed(3), "-t", dur.toFixed(3), "-i", master, "-vf", `ass=${esc(cursorFile)},${fade}`, ...enc, clean]);

  const subbed = path.join(OUT, "videos/con-subtitulos", `${name}.mp4`);
  const title = (clipMeta.title ?? name).replace(/'/g, "’").replace(/:/g, "\\:");
  const card = `color=c=0x0b5e61:s=1920x1080:r=${FPS}:d=1.2,format=yuv420p,` +
    `drawtext=fontfile=${FONT_BOLD}:text='${title}':fontcolor=white:fontsize=84:x=(w-text_w)/2:y=(h-text_h)/2-24,` +
    `drawtext=fontfile=${FONT_REG}:text='Dashfort by Demfort':fontcolor=0xcfe9ea:fontsize=32:x=(w-text_w)/2:y=(h/2)+56,` +
    `fade=t=in:st=0:d=0.3,fade=t=out:st=0.9:d=0.3`;
  run(["-f", "lavfi", "-i", card, "-ss", S.toFixed(3), "-t", dur.toFixed(3), "-i", master,
    "-filter_complex", `[1:v]ass=${esc(cursorFile)},ass=${esc(subsFile)},${fade},format=yuv420p,setsar=1[c];[0:v]setsar=1[t];[t][c]concat=n=2:v=1:a=0[v]`,
    "-map", "[v]", ...enc, subbed]);

  // Revisión automática sobre la versión limpia.
  const rv = review(clean, tl, cues);
  contactSheet(clean, path.join(OUT, "revision", `${name}-limpio.png`));
  contactSheet(subbed, path.join(OUT, "revision", `${name}-subtitulos.png`));
  const metrics = {
    clip: name,
    duracion_s: +probeDur(clean).toFixed(2),
    duracion_con_titulo_s: +probeDur(subbed).toFixed(2),
    fps: FPS,
    cuadros_perdidos: tl.capture,
    pausas_guion_mayores_1_2s: tl.idle.length,
    congelamientos_freezedetect: rv.frozen,
    tiempo_muerto_real: rv.unplannedFreezes,
    cortes_detectados: rv.jumps.length,
    saltos_sin_causa: rv.unexplainedJumps,
    subtitulos: cues.length,
    ok: tl.capture.lossPct <= 2 && rv.unplannedFreezes.length === 0 && rv.unexplainedJumps.length === 0,
  };
  const file = path.join(OUT, "logs", "metricas.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  all[name] = metrics;
  writeFileSync(file, JSON.stringify(all, null, 2));
  console.log("[post]", JSON.stringify(metrics));
  return metrics;
}

if (process.argv[1]?.endsWith("post.mjs")) {
  for (const n of process.argv.slice(2)) {
    const file = (await import("node:fs")).readdirSync(path.join(path.dirname(new URL(import.meta.url).pathname), "clips")).find((f) => f.startsWith(n));
    const mod = await import(path.join(path.dirname(new URL(import.meta.url).pathname), "clips", file));
    await post(file.replace(/\.mjs$/, ""), mod.meta ?? {});
  }
}
