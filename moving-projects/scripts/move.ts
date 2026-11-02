#!/usr/bin/env bun
/**
 * Move a project checkout to a new folder without losing anything attached to it.
 *
 *   move.ts --from <abs> --to <abs> [--name <workspace name>] [--dry-run] [--no-notify]
 *
 * What moves with it:
 *   - the checkout itself, and every linked git worktree (to <to>.worktrees/<branch>, the
 *     same place `--worktree` puts new ones), via `git worktree move` + `git worktree repair`
 *   - broken worktree leftovers (a .git file pointing at nothing) go to the Trash
 *   - the Anima workspace: every folder is moved with `update_workspace --moveFolder`, so
 *     sessions follow, transcripts and auto memory stay put and are linked at the new path
 *   - Claude Code's per-folder settings in ~/.claude.json (trust, allowed tools, MCP)
 *   - the old path written in the project's auto memory, ~/.anima/tasks scripts and
 *     runbooks (not logs or dated run output), and scheduler task actions
 *   - open sessions in the workspace are told the new path (a user_notification)
 * What it only reports: other mentions (skills, dotfiles, anima.json, the repo's own files,
 * ~/memory history), for a human to judge.
 *
 * Refuses while a session in any of the folders is mid-turn. Idle live sessions are
 * closed first (their process would keep the old path); the reconciler revives the rows.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const HOME = homedir();
const ANIMA = Bun.which("anima") ?? join(HOME, ".bun", "bin", "anima");

// ── Args ──────────────────────────────────────────────────────────────────────

interface Options {
  from: string;
  to: string;
  name?: string;
  dryRun: boolean;
  notify: boolean;
}

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    "Usage: move --from <abs-path> --to <abs-path> [--name <workspace name>] [--dry-run] [--no-notify]",
  );
  process.exit(2);
}

function expand(path: string): string {
  return resolve(path === "~" || path.startsWith("~/") ? join(HOME, path.slice(1)) : path);
}

function parseArgs(argv: string[]): Options {
  const opts: Partial<Options> = { dryRun: false, notify: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => argv[++i] ?? usage(`${arg} needs a value`);
    if (arg === "--from") opts.from = expand(value());
    else if (arg === "--to") opts.to = expand(value());
    else if (arg === "--name") opts.name = value();
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-notify") opts.notify = false;
    else usage(`unknown argument ${arg}`);
  }
  if (!opts.from || !opts.to) usage("--from and --to are required");
  return opts as Options;
}

// ── Shell + Anima ─────────────────────────────────────────────────────────────

function run(cmd: string[], cwd?: string): { code: number; out: string; err: string } {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
}

function must(cmd: string[], cwd?: string): string {
  const r = run(cmd, cwd);
  if (r.code !== 0) throw new Error(`${cmd.join(" ")} failed: ${r.err || r.out}`);
  return r.out;
}

function anima<T = Record<string, unknown>>(...args: string[]): T {
  const out = must([ANIMA, ...args]);
  return JSON.parse(out) as T;
}

/** Claude Code's project folder name for a path. */
const slug = (path: string) => path.replace(/[^a-zA-Z0-9]/g, "-");

// ── Discovery ─────────────────────────────────────────────────────────────────

interface Worktree {
  path: string;
  branch: string | null;
  to: string;
}

function linkedWorktrees(repo: string, to: string): Worktree[] {
  const out = must(["git", "-C", repo, "worktree", "list", "--porcelain"]);
  const list: Worktree[] = [];
  for (const block of out.split("\n\n").slice(1)) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path || !existsSync(path)) continue; // prunable: `git worktree prune` drops it
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null;
    list.push({ path, branch, to: `${to}.worktrees/${branch ?? basename(path)}` });
  }
  return list;
}

/** Folders under <from>.worktrees whose .git file points at nothing. */
function brokenLeftovers(from: string): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      const dotGit = join(path, ".git");
      if (existsSync(dotGit) && statSync(dotGit).isFile()) {
        if (run(["git", "-C", path, "rev-parse", "--git-dir"]).code !== 0) found.push(path);
      } else if (!existsSync(dotGit) && depth < 2) {
        visit(path, depth + 1);
      }
    }
  };
  visit(`${from}.worktrees`, 0);
  return found;
}

// ── Path rewriting ────────────────────────────────────────────────────────────

type Mapping = [from: string, to: string];

/** Each absolute path also as it's commonly written: ~/…, $HOME/…, ${HOME}/…. */
function spellings(path: string): string[] {
  if (!path.startsWith(`${HOME}/`)) return [path];
  const rest = path.slice(HOME.length);
  return [path, `~${rest}`, `$HOME${rest}`, `\${HOME}${rest}`];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace each mapped path (longest first), only where the path ends (not tnh → tnh-legacy). */
function rewrite(text: string, mappings: Mapping[]): string {
  const pairs = mappings
    .flatMap(([a, b]) => spellings(a).map((s, i) => [s, spellings(b)[i] ?? b] as Mapping))
    .sort((x, y) => y[0].length - x[0].length);
  for (const [a, b] of pairs) {
    text = text.replace(new RegExp(`${escape(a)}(?![A-Za-z0-9._-])`, "g"), b);
  }
  return text;
}

const TEXT_EXT = /\.(sh|bash|zsh|md|txt|json|jsonc|ts|js|mjs|py|ya?ml|toml|env)$/;

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && keep(path)) out.push(path);
    }
  };
  visit(dir);
  return out;
}

function mentions(text: string, mappings: Mapping[]): boolean {
  return rewrite(text, mappings) !== text;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const opts = parseArgs(Bun.argv.slice(2));
const { from, to } = opts;
const say = (line: string) => console.log(line);
const step = (title: string) => console.log(`\n── ${title}`);

if (!isAbsolute(from) || !existsSync(from) || !statSync(from).isDirectory()) usage(`not a folder: ${from}`);
if (existsSync(to)) usage(`already exists: ${to}`);
if (!existsSync(dirname(to))) usage(`parent folder doesn't exist: ${dirname(to)}`);
const isGit = existsSync(join(from, ".git"));
if (isGit && statSync(join(from, ".git")).isFile()) {
  usage(`${from} is itself a linked worktree; move its main checkout instead`);
}

const worktrees = isGit ? linkedWorktrees(from, to) : [];
for (const wt of worktrees) {
  if (existsSync(wt.to)) usage(`worktree target already exists: ${wt.to}`);
}
const leftovers = brokenLeftovers(from);

const workspaces = anima<{ workspaces: Array<{ id: string; name: string; cwd: string }> }>(
  "session",
  "list_workspaces",
).workspaces;
const workspace = workspaces.find((w) => w.cwd === from) ?? null;

const folders = [from, ...worktrees.map((w) => w.path)];
const mappings: Mapping[] = [
  ...worktrees.map((w) => [w.path, w.to] as Mapping),
  [`${from}.worktrees`, `${to}.worktrees`],
  [from, to],
];

// Sessions: none may be mid-turn; idle live ones get closed before the move.
const health = anima<{ items?: Array<{ id: string; label: string; details?: { running?: string } }> }>(
  "session",
  "health_check",
);
const inFolders = (cwd: string) => folders.some((f) => cwd === f || cwd.startsWith(`${f}/`));
const live = (health.items ?? []).filter((item) => inFolders(item.label));
const sessions = workspace
  ? anima<{ sessions: Array<{ sessionId: string; runtimeStatus: string; disposition: string; title: string | null; cwd: string }> }>(
      "session",
      "list_sessions",
      "--cwd",
      from,
      "--limit",
      "500",
    ).sessions
  : [];
const busy = sessions.filter((s) => ["running", "awaiting_input", "awaiting_approval"].includes(s.runtimeStatus));

// References.
const memoryDir = join(HOME, ".claude", "projects", slug(from), "memory");
const memoryFiles = filesUnder(memoryDir, (p) => p.endsWith(".md")).filter((p) =>
  mentions(readFileSync(p, "utf8"), mappings),
);
const tasksDir = join(HOME, ".anima", "tasks");
const taskFiles = filesUnder(
  tasksDir,
  (p) => TEXT_EXT.test(p) && !/\/\d{4}-\d{2}-\d{2}(\/|$)/.test(relative(tasksDir, p)),
).filter((p) => mentions(readFileSync(p, "utf8"), mappings));
const tasks = anima<{ tasks: Array<{ id: string; name: string; action: unknown }> }>("scheduler", "list_tasks").tasks;
const taskActions = tasks.filter((t) => mentions(JSON.stringify(t.action), mappings));
const claudeJson = join(HOME, ".claude.json");
const claudeConfig = JSON.parse(readFileSync(claudeJson, "utf8")) as { projects?: Record<string, unknown> };
const claudeKeys = Object.keys(claudeConfig.projects ?? {}).filter((k) => folders.includes(k));

const reportRoots = [
  join(HOME, ".anima", "anima.json"),
  join(HOME, ".claude", "CLAUDE.md"),
  join(HOME, "Projects", "iamclaudia-ai", "skills"),
  join(HOME, "dotfiles", "scripts"),
  join(HOME, ".local", "bin"),
];
const reportOnly = reportRoots
  .flatMap((root) =>
    !existsSync(root)
      ? []
      : statSync(root).isDirectory()
        ? filesUnder(root, (p) => !p.includes("/.git/") && !p.includes("/node_modules/"))
        : [root],
  )
  .filter((p) => {
    try {
      return lstatSync(p).size < 2_000_000 && mentions(readFileSync(p, "utf8"), mappings);
    } catch {
      return false;
    }
  });

// ── Plan ──────────────────────────────────────────────────────────────────────

step(`Plan: ${from} → ${to}${opts.dryRun ? " (dry run)" : ""}`);
say(`workspace: ${workspace ? `${workspace.name} (${workspace.id})` : "none"}${opts.name ? ` → rename to "${opts.name}"` : ""}`);
for (const wt of worktrees) say(`worktree: ${wt.path} → ${wt.to}${wt.branch ? "" : " (detached)"}`);
for (const path of leftovers) say(`broken leftover → Trash: ${path}`);
for (const item of live) say(`live session to close first: ${item.id} (${item.label})`);
for (const s of busy) say(`MID-TURN: ${s.sessionId} "${s.title ?? ""}" (${s.runtimeStatus})`);
say(`auto memory notes to update: ${memoryFiles.length}`);
for (const p of taskFiles) say(`task file to update: ${p}`);
for (const t of taskActions) say(`scheduler task to update: ${t.name} (${t.id})`);
for (const k of claudeKeys) say(`~/.claude.json project entry to re-key: ${k}`);
const openSessions = sessions.filter((s) => !["resolved", "archived"].includes(s.disposition));
say(`open sessions to notify: ${opts.notify ? openSessions.length : "skipped (--no-notify)"}`);
for (const p of reportOnly) say(`mentions the old path (review by hand): ${p}`);

if (busy.length > 0) {
  console.error("\nRefusing: a session in these folders is mid-turn. Let it finish, then rerun.");
  process.exit(1);
}
if (opts.dryRun) process.exit(0);

// ── Execute ───────────────────────────────────────────────────────────────────

step("Stopping live sessions and CodeGraph daemons");
for (const item of live) {
  anima("session", "close_session", "--sessionId", item.id);
  say(`closed ${item.id}`);
}
for (const folder of folders) {
  const pidFile = join(folder, ".codegraph", "daemon.pid");
  if (!existsSync(pidFile)) continue;
  const raw = readFileSync(pidFile, "utf8");
  const pid = Number(raw.match(/\d+/)?.[0]);
  if (pid) {
    run(["kill", "-TERM", String(pid)]);
    say(`stopped CodeGraph daemon ${pid} (${folder})`);
  }
}

step("Recording worktrees as workspace folders");
if (workspace) {
  for (const wt of worktrees) {
    run([ANIMA, "session", "update_workspace", "--id", workspace.id, "--addFolder", wt.path]);
  }
}

step("Moving files");
for (const wt of worktrees) {
  mkdirSync(dirname(wt.to), { recursive: true });
  must(["git", "-C", from, "worktree", "move", wt.path, wt.to]);
  say(`git worktree move ${wt.path} → ${wt.to}`);
}
for (const path of leftovers) {
  const trash = join(HOME, ".Trash", `${basename(path)}-${Date.now()}`);
  renameSync(path, trash);
  say(`trashed ${path}`);
}
if (isGit) run(["git", "-C", from, "worktree", "prune"]);
renameSync(from, to);
say(`moved ${from} → ${to}`);
if (isGit && worktrees.length > 0) {
  must(["git", "-C", to, "worktree", "repair", ...worktrees.map((w) => w.to)]);
  say("git worktree repair: done");
}
// Remove the old .worktrees tree if moving left it empty.
const removeEmpty = (dir: string): boolean => {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  const empty = readdirSync(dir).every((name) => name === ".DS_Store" ? true : removeEmpty(join(dir, name)));
  if (!empty) return false;
  for (const name of readdirSync(dir)) if (name === ".DS_Store") renameSync(join(dir, name), join(HOME, ".Trash", `DS_Store-${Date.now()}`));
  rmdirSync(dir);
  return true;
};
if (removeEmpty(`${from}.worktrees`)) say(`removed empty ${from}.worktrees`);

step("Anima workspace");
if (workspace) {
  const move = (a: string, b: string) => {
    const result = anima<{ notes: string[] }>(
      "session",
      "update_workspace",
      "--id",
      workspace.id,
      "--moveFolder",
      JSON.stringify({ from: a, to: b }),
    );
    for (const note of result.notes) say(`  ${note}`);
  };
  move(from, to);
  for (const wt of worktrees) move(wt.path, wt.to);
  if (opts.name) {
    anima("session", "update_workspace", "--id", workspace.id, "--name", opts.name);
    say(`renamed workspace to ${opts.name}`);
  }
} else {
  say("no workspace for this folder; nothing to record");
}

step("Claude Code settings (~/.claude.json)");
if (claudeKeys.length > 0) {
  // Re-read: Claude Code rewrites this file constantly.
  const fresh = JSON.parse(readFileSync(claudeJson, "utf8")) as { projects: Record<string, unknown> };
  for (const key of claudeKeys) {
    const target = rewrite(key, mappings);
    fresh.projects[target] = { ...(fresh.projects[key] as object), ...(fresh.projects[target] as object) };
    delete fresh.projects[key];
    say(`${key} → ${target}`);
  }
  const temp = `${claudeJson}.move-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(fresh, null, 2)}\n`);
  renameSync(temp, claudeJson);
}

step("Rewriting the old path");
for (const path of [...memoryFiles, ...taskFiles]) {
  writeFileSync(path, rewrite(readFileSync(path, "utf8"), mappings));
  say(`updated ${path}`);
}
for (const task of taskActions) {
  const action = JSON.parse(rewrite(JSON.stringify(task.action), mappings));
  anima("scheduler", "update_task", "--taskId", task.id, "--action", JSON.stringify(action));
  say(`updated scheduler task ${task.name}`);
}

step("CodeGraph");
for (const folder of [to, ...worktrees.map((w) => w.to)]) {
  if (!existsSync(join(folder, ".codegraph", "codegraph.db")) || !Bun.which("codegraph")) continue;
  const r = run(["codegraph", "sync"], folder);
  say(`${folder}: ${r.code === 0 ? "synced" : `sync failed: ${r.err.split("\n").at(-1)}`}`);
}

step("Telling open sessions");
if (opts.notify && workspace && openSessions.length > 0) {
  const moved = worktrees.map((w) => `\n- worktree ${w.path} → ${w.to}`).join("");
  const text =
    `This project moved: ${from} → ${to}.${moved}\n` +
    `Your session now runs from the new folder. Any path you remember under the old one is stale: ` +
    `use the new paths from here on, and update notes or scripts of yours that name the old one. ` +
    `A one-line acknowledgement is enough.`;
  for (const s of openSessions) {
    const r = run([ANIMA, "session", "send_notification", "--sessionId", s.sessionId, "--text", text]);
    say(`${r.code === 0 ? "told" : "FAILED to tell"} ${s.sessionId} "${s.title ?? ""}"${r.code === 0 ? "" : `: ${r.err}`}`);
  }
} else {
  say("none");
}

step("Check");
if (isGit) say(must(["git", "-C", to, "worktree", "list"]));
if (workspace) {
  const after = anima<{ sessions: Array<{ cwd: string }> }>("session", "list_sessions", "--cwd", to, "--limit", "500").sessions;
  const stale = after.filter((s) => folders.some((f) => s.cwd === f || s.cwd.startsWith(`${f}/`)));
  say(`sessions listed under the new path: ${after.length}; still on an old path: ${stale.length}`);
}
if (isGit) {
  // The project's own tracked files: a commit for whoever works on it, not for this script.
  const patterns = mappings.flatMap(([a]) => spellings(a)).flatMap((s) => ["-e", s]);
  const tracked = run(["git", "-C", to, "grep", "-l", "-F", ...patterns]).out;
  const hits = tracked
    .split("\n")
    .filter(Boolean)
    .filter((p) => mentions(readFileSync(join(to, p), "utf8"), mappings));
  for (const p of hits) reportOnly.push(join(to, p));
}
if (reportOnly.length > 0) say(`\nStill mentioning the old path (review by hand):\n  ${reportOnly.join("\n  ")}`);
say("\nDone.");
