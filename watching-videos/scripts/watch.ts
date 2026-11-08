#!/usr/bin/env bun
/**
 * Turn a video into something Claude can "watch": key frames plus a timestamped transcript.
 *
 *   bun watch.ts <url | file> [--out DIR] [--frames 12] [--scene 0.3] [--stt parakeet|whisper|none]
 *                [--from SEC] [--to SEC] [--width 768] [--quality best]
 *
 * URL: downloaded with yt-dlp (X, YouTube, most sites) at ≤720p (--quality best for screen recordings
 * with small text), with captions when the site has them.
 * Frames: scene changes (ffmpeg scene score > --scene) merged with an even grid, so a static talking
 * head still gets coverage and a fast montage doesn't flood; then spread evenly down to --frames.
 * Transcript: the site's captions if any, else local speech-to-text: parakeet-mlx (English and 24
 * European languages, fast) or --stt whisper (any language, e.g. Korean; mlx-whisper via uvx, first
 * run downloads the model).
 *
 * Output folder (default: ./tmp/videos/<name> for a URL, <file>.watch/ beside a local file):
 *   WATCH.md     read this first: source, duration, transcript as [mm:ss] lines, frame list
 *   sheet.jpg    every frame on one contact sheet, numbered left to right, top to bottom
 *   frames/      01-00m12s.jpg … one image per key frame
 *   video.mp4, audio.wav, transcript.srt, info.json (when downloaded)
 */
import { $ } from "bun";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const input = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!input) {
  console.error("usage: bun watch.ts <url | file> [--out DIR] [--frames 12] [--scene 0.3] [--stt parakeet|whisper|none]");
  process.exit(2);
}
const isUrl = /^https?:\/\//.test(input);
const maxFrames = Number(opt("--frames", "12"));
const sceneThreshold = Number(opt("--scene", "0.3"));
const stt = opt("--stt", "parakeet") as "parakeet" | "whisper" | "none";
const width = Number(opt("--width", "768"));
const best = opt("--quality") === "best"; // screen recordings: small text needs the full resolution
const from = opt("--from") ? Number(opt("--from")) : undefined;
const to = opt("--to") ? Number(opt("--to")) : undefined;

function slug(s: string): string {
  const id = s.match(/status\/(\d+)/)?.[1] ?? s.match(/[?&]v=([\w-]+)/)?.[1] ?? s.match(/youtu\.be\/([\w-]+)/)?.[1];
  return id ?? s.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
}
const out = resolve(
  opt("--out") ?? (isUrl ? join("tmp", "videos", slug(input)) : join(dirname(input), `${basename(input, extname(input))}.watch`)),
);
mkdirSync(join(out, "frames"), { recursive: true });

const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// 1. Get the video.
let video = resolve(input);
let info: Record<string, unknown> = {};
if (isUrl) {
  const existing = readdirSync(out).find((f) => f.startsWith("video."));
  if (!existing) {
    console.error("Downloading…");
    await $`yt-dlp -q --no-warnings --no-playlist -f ${best ? "bv*+ba/b" : "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b"} --merge-output-format mp4 --write-info-json --write-subs --write-auto-subs --sub-langs ${"en.*,en"} --convert-subs srt -o ${join(out, "video.%(ext)s")} ${input}`;
  }
  video = join(out, readdirSync(out).find((f) => /^video\.(mp4|mkv|webm|mov)$/.test(f)) ?? "video.mp4");
  const infoFile = readdirSync(out).find((f) => f.endsWith(".info.json"));
  if (infoFile) info = JSON.parse(readFileSync(join(out, infoFile), "utf8"));
}
if (!existsSync(video)) throw new Error(`No video at ${video}`);

// 2. Probe.
const probe = JSON.parse(await $`ffprobe -v error -print_format json -show_format -show_streams ${video}`.text()) as {
  format: { duration?: string };
  streams: { codec_type: string; width?: number; height?: number }[];
};
const duration = Number(probe.format.duration ?? 0);
const v = probe.streams.find((s) => s.codec_type === "video");
const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
const start = from ?? 0;
const end = Math.min(to ?? duration, duration);
const span = Math.max(end - start, 0.1);

// 3. Pick frame times: scene changes + an even grid, merged, then thinned evenly.
console.error("Finding scene changes…");
const scan = await $`ffmpeg -hide_banner -nostats -ss ${start} -to ${end} -i ${video} -vf ${`select='gt(scene,${sceneThreshold})',metadata=print`} -an -f null -`
  .quiet()
  .nothrow();
const scenes = [...scan.stderr.toString().matchAll(/pts_time:([\d.]+)/g)].map((m) => start + Number(m[1]));
// Even grid from just after the start (title cards) to just before the end.
const pad = Math.min(0.5, span / (maxFrames * 2));
const grid = Array.from({ length: maxFrames }, (_, i) => start + pad + ((span - 2 * pad) * i) / Math.max(maxFrames - 1, 1));
const minGap = span / (maxFrames * 3);
const merged: { t: number; scene: boolean }[] = [];
const candidates = [...scenes.map((t) => ({ t, scene: true })), ...grid.map((t) => ({ t, scene: false }))];
for (const c of candidates.sort((a, b) => a.t - b.t)) {
  const last = merged[merged.length - 1];
  if (last && c.t - last.t < minGap) {
    if (c.scene && !last.scene) merged[merged.length - 1] = c; // prefer the real cut
    continue;
  }
  merged.push(c);
}
const picked =
  merged.length <= maxFrames
    ? merged
    : Array.from({ length: maxFrames }, (_, i) => merged[Math.round((i * (merged.length - 1)) / (maxFrames - 1))]);

// 4. Extract frames.
rmSync(join(out, "frames"), { recursive: true, force: true });
mkdirSync(join(out, "frames"));
const frames: { file: string; t: number; scene: boolean }[] = [];
for (const [i, p] of picked.entries()) {
  const file = `${String(i + 1).padStart(2, "0")}-${fmt(p.t).replace(":", "m")}s.jpg`;
  await $`ffmpeg -hide_banner -loglevel error -y -ss ${p.t} -i ${video} -frames:v 1 -vf ${`scale=${width}:-2`} -q:v 3 ${join(out, "frames", file)}`;
  frames.push({ file, t: p.t, scene: p.scene });
}
const cols = Math.min(4, frames.length);
const rows = Math.ceil(frames.length / cols);
writeFileSync(join(out, "frames.txt"), frames.map((f) => `file '${join(out, "frames", f.file)}'`).join("\n"));
await $`ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i ${join(out, "frames.txt")} -vf ${`scale=480:-2,tile=${cols}x${rows}:padding=6:color=white`} -frames:v 1 ${join(out, "sheet.jpg")}`;
rmSync(join(out, "frames.txt"));

// 5. Transcript: site captions, else local STT.
let srtFile = readdirSync(out).find((f) => f.endsWith(".srt") && f !== "transcript.srt");
let transcriptSource = srtFile ? `captions (${srtFile})` : "";
if (srtFile) {
  writeFileSync(join(out, "transcript.srt"), readFileSync(join(out, srtFile)));
} else if (hasAudio && stt !== "none") {
  console.error(`Transcribing with ${stt}…`);
  const wav = join(out, "audio.wav");
  await $`ffmpeg -hide_banner -loglevel error -y -ss ${start} -to ${end} -i ${video} -vn -ac 1 -ar 16000 ${wav}`;
  if (stt === "parakeet") {
    await $`parakeet-mlx ${wav} --output-format srt --output-dir ${out}`.quiet();
    writeFileSync(join(out, "transcript.srt"), readFileSync(join(out, "audio.srt")));
    rmSync(join(out, "audio.srt"));
  } else {
    await $`uvx --from mlx-whisper mlx_whisper ${wav} --model mlx-community/whisper-large-v3-turbo --output-format srt --output-dir ${out}`.quiet();
    writeFileSync(join(out, "transcript.srt"), readFileSync(join(out, "audio.srt")));
    rmSync(join(out, "audio.srt"));
  }
  transcriptSource = stt === "parakeet" ? "parakeet-mlx (local)" : "mlx-whisper large-v3-turbo (local)";
}
const offset = srtFile ? 0 : start; // local STT times are relative to the clip
const lines: string[] = [];
if (existsSync(join(out, "transcript.srt"))) {
  for (const block of readFileSync(join(out, "transcript.srt"), "utf8").split(/\r?\n\r?\n/)) {
    const m = block.match(/(\d+):(\d+):(\d+)[,.]\d+\s+-->.*\r?\n([\s\S]+)/);
    if (!m) continue;
    const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + offset;
    const text = m[4].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text && lines[lines.length - 1]?.endsWith(text) !== true) lines.push(`[${fmt(t)}] ${text}`);
  }
}

// 6. WATCH.md
const title = (info.title as string) ?? basename(video);
const md = [
  `# ${title}`,
  "",
  `- Source: ${isUrl ? input : video}`,
  info.uploader ? `- Uploader: ${info.uploader}` : null,
  `- Duration: ${fmt(duration)}${from !== undefined || to !== undefined ? ` (watched ${fmt(start)}–${fmt(end)})` : ""} · ${v?.width ?? "?"}×${v?.height ?? "?"} · audio: ${hasAudio ? "yes" : "no"}`,
  info.description ? `- Description: ${String(info.description).replace(/\s+/g, " ").slice(0, 600)}` : null,
  "",
  "## How to read this",
  "",
  "Open `sheet.jpg` first (frames numbered left to right, top to bottom), then any frame in `frames/` at full size.",
  "Screen text, code and slides are usually readable in the single frames, not in the sheet.",
  "",
  `## Frames (${frames.length}; ${scenes.length} scene changes found at threshold ${sceneThreshold})`,
  "",
  ...frames.map((f, i) => `${i + 1}. \`frames/${f.file}\` at ${fmt(f.t)}${f.scene ? " (scene change)" : ""}`),
  "",
  `## Transcript${transcriptSource ? ` (${transcriptSource})` : ""}`,
  "",
  ...(lines.length ? lines : [hasAudio ? (stt === "none" ? "(skipped: --stt none)" : "(no speech recognised)") : "(no audio track)"]),
  "",
]
  .filter((l) => l !== null)
  .join("\n");
writeFileSync(join(out, "WATCH.md"), md);
console.log(`${out}/WATCH.md · ${frames.length} frames · ${lines.length} transcript lines`);
