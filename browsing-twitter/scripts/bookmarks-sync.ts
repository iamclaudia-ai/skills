#!/usr/bin/env bun
/**
 * Sync Michael's X bookmarks into a local archive, newest first, stopping at the first one already saved.
 *
 *   bun bookmarks-sync.ts [--dry-run] [--max-pages N] [--full] [--no-media]
 *
 * Auth: OAuth 2.0 user token from xurl (`xurl token` refreshes and persists it). Cost: $0.005 per post
 * returned, so a page of 100 is $0.50 even if only a few are new.
 *
 * Archive (X_BOOKMARKS_DIR, default ~/.anima/x-bookmarks):
 *   bookmarks.jsonl  one bookmark per line, in bookmark order (most recently bookmarked first)
 *   raw/             every API page as returned, kept so nothing is lost if the format changes
 *   media/           photos and videos, saved by bookmarks-media.ts after each sync
 *
 * Bookmarks come back in the order they were bookmarked, not by tweet id, so "already saved" is a
 * set lookup, never an id comparison (an old tweet bookmarked today has a low id).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const USER_ID = "14352244"; // @kiliman
export const ARCHIVE = process.env.X_BOOKMARKS_DIR ?? join(homedir(), ".anima", "x-bookmarks");
const FIELDS = [
  "tweet.fields=created_at,author_id,conversation_id,public_metrics,entities,attachments,note_tweet,referenced_tweets,lang",
  "expansions=author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id",
  "user.fields=username,name",
  "media.fields=type,url,preview_image_url,alt_text",
].join("&");

type Tweet = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  public_metrics?: Record<string, number>;
  entities?: { urls?: { expanded_url?: string; unwound_url?: string; title?: string }[] };
  attachments?: { media_keys?: string[] };
  note_tweet?: { text?: string };
  referenced_tweets?: { type: string; id: string }[];
};
type User = { id: string; username: string; name: string };
type Media = { media_key: string; type: string; url?: string; preview_image_url?: string; alt_text?: string };
type Page = {
  data?: Tweet[];
  includes?: { users?: User[]; media?: Media[]; tweets?: Tweet[] };
  meta?: { next_token?: string; result_count?: number };
  errors?: unknown[];
  title?: string;
  detail?: string;
};

export type Bookmark = {
  id: string;
  url: string;
  author: string | null; // username
  author_name: string | null;
  author_id: string | null;
  created_at: string | null;
  text: string; // long-form note_tweet text when present
  links: string[];
  media: { type: string; url: string; alt?: string }[];
  metrics: Record<string, number> | null;
  conversation_id: string | null;
  quoted: { id: string; author: string | null; text: string } | null;
  synced_at: string;
  source: string; // "x-api" or "x-cli-import"
};

export function toBookmark(t: Tweet, inc: Page["includes"], syncedAt: string, source: string): Bookmark {
  const users = new Map((inc?.users ?? []).map((u) => [u.id, u]));
  const media = new Map((inc?.media ?? []).map((m) => [m.media_key, m]));
  const tweets = new Map((inc?.tweets ?? []).map((x) => [x.id, x]));
  const user = t.author_id ? users.get(t.author_id) : undefined;
  const quotedRef = t.referenced_tweets?.find((r) => r.type === "quoted");
  const quotedTweet = quotedRef ? tweets.get(quotedRef.id) : undefined;
  const handle = user?.username ?? "i";
  return {
    id: t.id,
    url: `https://x.com/${handle}/status/${t.id}`,
    author: user?.username ?? null,
    author_name: user?.name ?? null,
    author_id: t.author_id ?? null,
    created_at: t.created_at ?? null,
    text: t.note_tweet?.text ?? t.text,
    links: (t.entities?.urls ?? [])
      .map((u) => u.unwound_url ?? u.expanded_url ?? "")
      .filter((u) => u && !/^https?:\/\/(x|twitter)\.com\/.+\/(photo|video)\//.test(u)),
    media: (t.attachments?.media_keys ?? [])
      .map((k) => media.get(k))
      .filter((m): m is Media => !!m)
      .map((m) => ({ type: m.type, url: m.url ?? m.preview_image_url ?? "", ...(m.alt_text ? { alt: m.alt_text } : {}) })),
    metrics: t.public_metrics ?? null,
    conversation_id: t.conversation_id ?? null,
    quoted: quotedTweet
      ? {
          id: quotedTweet.id,
          author: quotedTweet.author_id ? (users.get(quotedTweet.author_id)?.username ?? null) : null,
          text: quotedTweet.note_tweet?.text ?? quotedTweet.text,
        }
      : null,
    synced_at: syncedAt,
    source,
  };
}

export function readArchive(): Bookmark[] {
  const file = join(ARCHIVE, "bookmarks.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Bookmark);
}

export function writeArchive(items: Bookmark[]): void {
  mkdirSync(ARCHIVE, { recursive: true });
  writeFileSync(join(ARCHIVE, "bookmarks.jsonl"), items.map((b) => JSON.stringify(b)).join("\n") + "\n");
}

/**
 * X quirk (2026-11-07): a page that comes back short (a bookmarked tweet was deleted, so 98 of 100) has NO
 * next_token, which silently ends the feed. So a short page without a token is re-fetched from the same
 * starting token with a smaller page size, down to 5, before the feed is believed to have ended.
 */
const PAGE_SIZES = [50, 20, 5];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  // --full walks the whole feed (the API serves the newest 800) instead of stopping at the first saved
  // bookmark, and rebuilds the archive in feed order. Use it to fill gaps and refresh old records.
  const full = args.includes("--full");
  const maxPagesArg = args.indexOf("--max-pages");
  const maxPages = maxPagesArg >= 0 ? Number(args[maxPagesArg + 1]) : 60;

  const existing = readArchive();
  const byId = new Map(existing.map((b) => [b.id, b]));
  const token = (await $`xurl token`.quiet().text()).trim();
  if (!token) throw new Error("xurl token returned nothing; see the skill's xurl section");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const syncedAt = new Date().toISOString();
  const feed: Bookmark[] = []; // in feed order: new and (with --full) refreshed known ones
  const seen = new Set<string>();
  let fresh = 0;
  let start: string | undefined; // pagination token the current page started from
  let sizeIdx = 0;
  let pages = 0;
  let returned = 0;
  let reachedKnown = false;
  let ended = false;

  while (pages < maxPages) {
    // An incremental sync usually finds a handful: ask for 10 first so "nothing new" costs $0.05, not $0.25.
    const size = !full && pages === 0 ? 10 : PAGE_SIZES[sizeIdx];
    const url = `https://api.x.com/2/users/${USER_ID}/bookmarks?max_results=${size}&${FIELDS}${start ? `&pagination_token=${start}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const page = (await res.json()) as Page;
    if (!res.ok || (!page.data && page.meta?.result_count !== 0)) {
      throw new Error(`X API ${res.status}: ${page.title ?? ""} ${page.detail ?? JSON.stringify(page.errors ?? page)}`);
    }
    const data = page.data ?? [];
    pages++;
    returned += data.length;
    if (!dryRun) {
      mkdirSync(join(ARCHIVE, "raw"), { recursive: true });
      writeFileSync(join(ARCHIVE, "raw", `${stamp}-p${pages}.json`), JSON.stringify(page));
    }
    for (const t of data) {
      if (seen.has(t.id)) continue; // a retried page repeats what we already took
      seen.add(t.id);
      if (byId.has(t.id) && !full) {
        reachedKnown = true;
        break;
      }
      if (!byId.has(t.id)) fresh++;
      feed.push(toBookmark(t, page.includes, syncedAt, "x-api"));
    }
    if (reachedKnown) break;

    const next = page.meta?.next_token;
    if (next) {
      start = next;
      sizeIdx = 0;
    } else if (data.length < size && sizeIdx < PAGE_SIZES.length - 1) {
      sizeIdx++; // short page, no token: probably truncated, retry from the same start with smaller pages
    } else {
      ended = true;
      break;
    }
  }

  if (!dryRun && feed.length > 0) {
    const inFeed = new Set(feed.map((b) => b.id));
    // --full: the feed's order wins; anything no longer served (deleted, unbookmarked, past 800) keeps
    // its record, after the feed. Incremental: new ones go on top.
    const rest = existing.filter((b) => !inFeed.has(b.id));
    writeArchive(full ? [...feed, ...rest] : [...feed, ...existing]);
  }
  // Save the new bookmarks' photos and videos too (free, via fxtwitter), so they survive deletion.
  if (!dryRun && !args.includes("--no-media")) {
    const { pendingMedia, archiveMedia } = await import("./bookmarks-media");
    const todo = pendingMedia(readArchive());
    if (todo.length) {
      const { bytes, tally } = await archiveMedia(todo);
      console.log(`Media: ${todo.length} bookmark(s), ${(bytes / 1e6).toFixed(1)} MB saved ${JSON.stringify(tally)}.`);
    }
  }
  const total = full ? new Set([...existing.map((b) => b.id), ...seen]).size : existing.length + fresh;
  console.log(
    `${dryRun ? "[dry run] " : ""}${fresh} new bookmarks${full ? `, ${feed.length - fresh} refreshed` : ""} ` +
      `(${pages} page(s), ${returned} posts returned, ~$${(returned * 0.005).toFixed(2)}). ` +
      `Archive: ${dryRun ? existing.length : total} in ${ARCHIVE}. ` +
      (reachedKnown ? "Caught up." : ended ? "Reached the end of the feed." : `Stopped at --max-pages ${maxPages}; run again.`),
  );
}

if (import.meta.main) await main();
