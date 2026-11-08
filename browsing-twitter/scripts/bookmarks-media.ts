#!/usr/bin/env bun
/**
 * Download the photos, videos and GIFs of archived bookmarks (and of the tweets they quote), so they
 * survive the tweet being deleted. Free: media URLs come from api.fxtwitter.com, files from X's CDN.
 *
 *   bun bookmarks-media.ts [--limit N] [--ids id,id] [--quality 720|best] [--refresh] [--dry-run]
 *
 * Layout (in X_BOOKMARKS_DIR, default ~/.anima/x-bookmarks):
 *   media/<tweet id>/manifest.json   what was found and saved (status, files, sizes, durations)
 *   media/<tweet id>/1-photo.jpg     the bookmarked tweet's media, in order
 *   media/<tweet id>/q1-video.mp4    media of the quoted tweet
 *
 * A bookmark with a manifest is skipped unless --refresh. Videos default to the best MP4 at or under
 * ~2.5 Mbps (720p-ish, ~16 MB a minute); --quality best takes the top variant (~75 MB a minute).
 * When fxtwitter can't see the tweet (deleted, protected), photos fall back to the URLs the sync saved.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ARCHIVE, readArchive, type Bookmark } from "./bookmarks-sync";

export const MEDIA_DIR = join(ARCHIVE, "media");
const QUALITY_CAP = 2_500_000;

type FxVariant = { bitrate?: number; url: string; content_type?: string };
type FxMedia = {
  type: string; // photo | video | gif
  url: string;
  width?: number;
  height?: number;
  duration?: number;
  variants?: FxVariant[];
};
type FxTweet = { media?: { all?: FxMedia[] }; quote?: FxTweet };

export type SavedFile = {
  file: string;
  type: string;
  source: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
};
export type Manifest = {
  id: string;
  fetched_at: string;
  status: "ok" | "partial" | "unavailable" | "none";
  note?: string;
  files: SavedFile[];
};

function pickVideo(m: FxMedia, best: boolean): string {
  const mp4 = (m.variants ?? []).filter((v) => v.content_type === "video/mp4" || /\.mp4/.test(v.url));
  if (mp4.length === 0) return m.url;
  mp4.sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  if (best) return mp4[mp4.length - 1].url;
  const capped = mp4.filter((v) => (v.bitrate ?? 0) <= QUALITY_CAP);
  return (capped.length ? capped[capped.length - 1] : mp4[0]).url;
}

function photoUrl(url: string): string {
  const base = url.split("?")[0];
  return base.includes("pbs.twimg.com/media/") ? `${base}?name=orig` : url;
}

function extOf(url: string, type: string): string {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp|gif|mp4)$/i);
  return m ? m[1].toLowerCase() : type === "photo" ? "jpg" : "mp4";
}

async function fetchFx(id: string): Promise<FxTweet | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fxtwitter ${res.status} for ${id}`);
  const body = (await res.json()) as { tweet?: FxTweet };
  return body.tweet ?? null;
}

async function download(url: string, path: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bytes = await Bun.write(path, res);
  return bytes;
}

export function readManifest(id: string): Manifest | null {
  const p = join(MEDIA_DIR, id, "manifest.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Manifest) : null;
}

/** Download one bookmark's media. Returns the manifest written. */
export async function archiveBookmarkMedia(b: Bookmark, opts: { best?: boolean } = {}): Promise<Manifest> {
  const dir = join(MEDIA_DIR, b.id);
  const fx = await fetchFx(b.id);
  const wanted: { prefix: string; m: FxMedia }[] = [];
  if (fx) {
    (fx.media?.all ?? []).forEach((m) => wanted.push({ prefix: "", m }));
    (fx.quote?.media?.all ?? []).forEach((m) => wanted.push({ prefix: "q", m }));
  } else {
    // Gone from fxtwitter: the sync's photo URLs often still work. Video URLs saved are thumbnails only.
    b.media.forEach((m) => wanted.push({ prefix: "", m: { type: m.type === "photo" ? "photo" : "thumbnail", url: m.url } }));
  }

  const files: SavedFile[] = [];
  const failures: string[] = [];
  const counters: Record<string, number> = {};
  for (const { prefix, m } of wanted) {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const isVideo = m.type === "video" || m.type === "gif";
    const source = isVideo ? pickVideo(m, opts.best ?? false) : photoUrl(m.url);
    const file = `${prefix}${counters[prefix]}-${m.type}.${extOf(source, m.type)}`;
    try {
      mkdirSync(dir, { recursive: true });
      const bytes = await download(source, join(dir, file));
      files.push({ file, type: m.type, source, bytes, width: m.width, height: m.height, duration: m.duration });
    } catch (e) {
      failures.push(`${file}: ${(e as Error).message}`);
    }
  }

  const status: Manifest["status"] =
    wanted.length === 0 ? "none" : failures.length === 0 ? (fx ? "ok" : "partial") : files.length ? "partial" : "unavailable";
  const note = [fx ? null : "tweet not visible on fxtwitter (deleted or protected)", ...failures].filter(Boolean).join("; ");
  const manifest: Manifest = { id: b.id, fetched_at: new Date().toISOString(), status, ...(note ? { note } : {}), files };
  // Always written, even with nothing to save, so the bookmark isn't fetched again next run.
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Bookmarks whose media we haven't saved yet (only those with media or a quoted tweet). */
export function pendingMedia(items: Bookmark[], refresh = false): Bookmark[] {
  return items.filter((b) => (b.media.length > 0 || b.quoted) && (refresh || !readManifest(b.id)));
}

export async function archiveMedia(items: Bookmark[], opts: { best?: boolean; log?: boolean } = {}) {
  let bytes = 0;
  const tally: Record<string, number> = {};
  for (const [i, b] of items.entries()) {
    try {
      const m = await archiveBookmarkMedia(b, opts);
      tally[m.status] = (tally[m.status] ?? 0) + 1;
      const sum = m.files.reduce((s, f) => s + f.bytes, 0);
      bytes += sum;
      if (opts.log) console.log(`${i + 1}/${items.length} ${b.id} @${b.author}: ${m.status}, ${m.files.length} file(s), ${(sum / 1e6).toFixed(1)} MB${m.note ? ` (${m.note})` : ""}`);
    } catch (e) {
      tally.error = (tally.error ?? 0) + 1;
      if (opts.log) console.log(`${i + 1}/${items.length} ${b.id}: error ${(e as Error).message}`);
    }
    await Bun.sleep(250); // be gentle with fxtwitter
  }
  return { bytes, tally };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const all = readArchive();
  const ids = opt("--ids")?.split(",");
  let items = ids ? all.filter((b) => ids.includes(b.id)) : pendingMedia(all, args.includes("--refresh"));
  if (ids && !args.includes("--refresh")) items = items.filter((b) => !readManifest(b.id));
  const limit = Number(opt("--limit") ?? Infinity);
  items = items.slice(0, limit);
  if (args.includes("--dry-run")) {
    console.log(`${items.length} bookmark(s) would be fetched.`);
    return;
  }
  const { bytes, tally } = await archiveMedia(items, { best: opt("--quality") === "best", log: true });
  console.log(`Done: ${items.length} bookmark(s), ${(bytes / 1e6).toFixed(1)} MB saved. ${JSON.stringify(tally)}. In ${MEDIA_DIR}`);
}

if (import.meta.main) await main();
