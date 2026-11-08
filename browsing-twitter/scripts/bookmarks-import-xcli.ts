#!/usr/bin/env bun
/**
 * One-time import of the bookmark pages x-cli downloaded (2026-04, ~/Projects/oss/x-cli/bookmarks) into the
 * bookmarks archive. Those pages are bare tweet arrays with no user expansion, so author is unknown
 * (author_id is kept). Files are merged newest download first, which preserves bookmark order.
 * Already-archived ids are skipped, so it is safe to re-run. Imported bookmarks go after existing ones.
 *
 *   bun bookmarks-import-xcli.ts [dir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Bookmark, readArchive, toBookmark, writeArchive, ARCHIVE } from "./bookmarks-sync";

const dir = process.argv[2] ?? join(homedir(), "Projects", "oss", "x-cli", "bookmarks");
// download_bookmarks.sh names pages bookmarks_<YYYYMMDD_HHMMSS_frac>.json. A later download holds the
// newest bookmarks; within one download, page 1 came first.
const files = readdirSync(dir)
  .filter((f) => /^bookmarks_\d{8}_\d{6}.*\.json$/.test(f))
  .sort();
const downloads = new Map<string, string[]>();
for (const f of files) {
  const day = f.slice(10, 18) + f.slice(19, 21); // group by date + hour of the run
  downloads.set(day, [...(downloads.get(day) ?? []), f]);
}
const ordered = [...downloads.keys()].sort().reverse().flatMap((k) => downloads.get(k) ?? []);

const existing = readArchive();
const known = new Set(existing.map((b) => b.id));
const imported: Bookmark[] = [];
for (const f of ordered) {
  const tweets = JSON.parse(readFileSync(join(dir, f), "utf8")) as Parameters<typeof toBookmark>[0][];
  for (const t of tweets) {
    if (known.has(t.id)) continue;
    known.add(t.id);
    imported.push(toBookmark(t, undefined, new Date(0).toISOString(), "x-cli-import"));
  }
}
writeArchive([...existing, ...imported]);
console.log(`Imported ${imported.length} from ${ordered.length} file(s); archive now ${existing.length + imported.length} in ${ARCHIVE}.`);
