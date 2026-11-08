#!/usr/bin/env bun
/**
 * Print bookmarks from the archive for reading, most recently bookmarked first. Free (no API calls).
 *
 *   bun bookmarks-show.ts [--limit 50] [--offset 0] [--grep <regex>] [--until <id>] [--count]
 *
 * --until <id>: only the bookmarks made after that one (it and everything older are left out); the weekly
 * digest passes the last digested id from digests/LAST. --count prints just how many would be shown.
 */
import { join } from "node:path";
import { MEDIA_DIR, readManifest } from "./bookmarks-media";
import { readArchive } from "./bookmarks-sync";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const limit = Number(opt("--limit", "50"));
const offset = Number(opt("--offset", "0"));
const grep = args.includes("--grep") ? new RegExp(opt("--grep", ""), "i") : null;

const archive = readArchive();
const untilId = args.includes("--until") ? opt("--until", "") : null;
const cut = untilId ? archive.findIndex((b) => b.id === untilId) : -1;
if (untilId && cut < 0) throw new Error(`--until ${untilId}: not in the archive`);
const all = untilId ? archive.slice(0, cut) : archive;
if (args.includes("--count")) {
  console.log((grep ? all.filter((b) => grep.test(`${b.author} ${b.text} ${b.links.join(" ")}`)) : all).length);
  process.exit(0);
}
const picked = (grep ? all.filter((b) => grep.test(`${b.author} ${b.text} ${b.links.join(" ")}`)) : all).slice(
  offset,
  offset + limit,
);
picked.forEach((b, i) => {
  const n = offset + i + 1;
  const m = b.metrics;
  console.log(`## ${n}. @${b.author ?? "?"} · ${b.created_at?.slice(0, 10) ?? "?"} · ${m?.like_count ?? "?"}♥ ${m?.bookmark_count ?? "?"}🔖`);
  console.log(b.url);
  console.log(b.text.replace(/https:\/\/t\.co\/\w+/g, "").trim());
  if (b.quoted) console.log(`> quoting @${b.quoted.author ?? "?"}: ${b.quoted.text.replace(/\n+/g, " ").slice(0, 400)}`);
  if (b.links.length) console.log(`links: ${b.links.join(" ")}`);
  const saved = readManifest(b.id);
  if (saved?.files.length) console.log(`saved: ${saved.files.map((f) => join(MEDIA_DIR, b.id, f.file)).join(" ")}`);
  else if (b.media.length) console.log(`media: ${b.media.map((x) => `${x.type} ${x.url}`).join(" ")}`);
  console.log();
});
console.error(`${picked.length} shown (${offset + 1}–${offset + picked.length} of ${all.length}${grep ? ", filtered" : ""})`);
