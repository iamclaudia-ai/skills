#!/usr/bin/env bun
/**
 * Grab one frame at full resolution, optionally cropped and enlarged, to read small text
 * (a prompt in an editor pane, code, a slide's footnote) that the WATCH.md frames are too small for.
 *
 *   bun frame.ts <video> <seconds | mm:ss> [--crop x,y,w,h] [--scale 2] [--out file.png]
 *
 * --crop takes fractions of the frame (0–1): left, top, width, height. "0,0,0.5,0.5" = top-left quarter.
 * Prints the output path; open it with Read. Download the video with `watch.ts --quality best` first:
 * the default 720p cap halves the resolution of a screen recording.
 */
import { $ } from "bun";
import { basename, dirname, extname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const [video, at] = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
if (!video || !at) {
  console.error("usage: bun frame.ts <video> <seconds | mm:ss> [--crop x,y,w,h] [--scale 2] [--out file.png]");
  process.exit(2);
}
const seconds = at.includes(":") ? at.split(":").reduce((s, p) => s * 60 + Number(p), 0) : Number(at);
const filters: string[] = [];
const crop = opt("--crop")?.split(",").map(Number);
if (crop) {
  if (crop.length !== 4 || crop.some((n) => !(n >= 0 && n <= 1))) throw new Error("--crop wants four fractions 0–1: x,y,w,h");
  const [x, y, w, h] = crop;
  filters.push(`crop=iw*${w}:ih*${h}:iw*${x}:ih*${y}`);
}
const scale = Number(opt("--scale") ?? "1");
if (scale !== 1) filters.push(`scale=iw*${scale}:-2:flags=lanczos`);
const tag = `${String(seconds).replace(".", "_")}s${crop ? "-crop" : ""}`;
const out = opt("--out") ?? join(dirname(video), `${basename(video, extname(video))}-${tag}.png`);
await $`ffmpeg -hide_banner -loglevel error -y -ss ${seconds} -i ${video} -frames:v 1 ${filters.length ? ["-vf", filters.join(",")] : []} ${out}`;
console.log(out);
