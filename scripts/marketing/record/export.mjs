/**
 * Maestro sin pérdida → MP4 final (H.264 crf 14, yuv420p, 60 fps, faststart)
 * con fade in/out de 0.5 s y sin audio. Guarda las métricas por clip.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MASTERS, OUT, FPS } from "./lib.mjs";

export async function exportClip(name, stats, fps) {
  const src = path.join(MASTERS, `${name}.mkv`);
  const dst = path.join(OUT, "videos", `${name}.mp4`);
  const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${src}"`).toString());
  // El primer ~0.5 s del maestro es la entrada de ffmpeg: se recorta.
  const start = 0.5;
  const len = dur - start;
  const vf = `fade=t=in:st=0:d=0.5,fade=t=out:st=${(len - 0.5).toFixed(3)}:d=0.5`;
  const t0 = Date.now();
  execFileSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(start), "-i", src,
    "-vf", vf, "-an",
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-movflags", "+faststart", dst,
  ]);
  const probe = JSON.parse(
    execSync(`ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames,r_frame_rate,width,height:format=duration,size -of json "${dst}"`).toString()
  );
  const info = {
    clip: name,
    master: stats ? { seconds: stats.durationSeconds, frames: stats.frames, dup: stats.dup, drop: stats.drop, lossPct: stats.lossPct, bytes: stats.bytes } : undefined,
    browser: fps ?? undefined,
    mp4: {
      seconds: +Number(probe.format.duration).toFixed(2),
      frames: Number(probe.streams[0].nb_read_frames),
      rate: probe.streams[0].r_frame_rate,
      size: `${probe.streams[0].width}x${probe.streams[0].height}`,
      bytes: Number(probe.format.size),
    },
    encodeSeconds: Math.round((Date.now() - t0) / 1000),
  };
  const file = path.join(OUT, "logs", "export.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  all[name] = info;
  writeFileSync(file, JSON.stringify(all, null, 2));
  console.log("[export]", JSON.stringify(info));
  return info;
}

if (process.argv[1]?.endsWith("export.mjs")) {
  for (const n of process.argv.slice(2)) await exportClip(n);
}
