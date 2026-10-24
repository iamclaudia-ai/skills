#!/usr/bin/env bun
// Weekly dependency sweep. Discovers Michael's active personal repos, scans
// each one's lockfile on the remote default branch (never the working copy),
// writes a report, and starts one named Anima session per repo that has work,
// a few at a time. The sessions follow the updating-dependencies skill.
//
// Usage: sweep.ts [--dry-run] [--only <substring>]
//   --dry-run   scan and write reports, start no sessions
//   --only      limit to repos whose path contains <substring>

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { LOCKFILES, parseLockfile, type PackageManager } from "../lib/lockfiles";
import { findAdvisories, findUpdates, type Advisory, type Update } from "../lib/registry";

// ── Config ───────────────────────────────────────────────────

interface Config {
  roots: string[];
  exclude: string[];
  owners: string[];
  activeWithinDays: number;
  include: string[];
  skip: string[];
  windowDays: number;
  maxConcurrentSessions: number;
  maxBreakingPrsPerRun: number;
}

const CONFIG_PATH = join(homedir(), ".anima", "deps-sweep.json");
const DEFAULT_CONFIG: Config = {
  roots: ["~/Projects"],
  exclude: ["~/Projects/beehiiv"],
  owners: ["kiliman", "iamclaudia-ai", "3votech", "onezerone"],
  activeWithinDays: 90,
  include: [],
  skip: [],
  windowDays: 3,
  maxConcurrentSessions: 2,
  maxBreakingPrsPerRun: 3,
};

const expand = (p: string) => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
    console.log(`created ${CONFIG_PATH} with defaults`);
  }
  const raw = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) } as Config;
  return {
    ...raw,
    roots: raw.roots.map(expand),
    exclude: raw.exclude.map(expand),
    include: raw.include.map(expand),
    skip: raw.skip.map(expand),
    owners: raw.owners.map((o) => o.toLowerCase()),
  };
}

// ── Shell helpers ────────────────────────────────────────────

function run(cmd: string[], cwd?: string, timeoutMs = 120_000): { ok: boolean; out: string } {
  const res = Bun.spawnSync(cmd, { cwd, stderr: "pipe", timeout: timeoutMs });
  return {
    ok: res.success,
    out: (res.success ? res.stdout : res.stderr).toString().trim(),
  };
}
const git = (repo: string, ...args: string[]) => run(["git", "-C", repo, ...args]);
const ANIMA = Bun.which("anima") ?? join(homedir(), ".bun", "bin", "anima");

// ── Discovery ────────────────────────────────────────────────

interface Repo {
  path: string;
  slug: string; // owner/name
  lastCommitDays: number;
}

function findGitRepos(dir: string, cfg: Config, depth = 0): string[] {
  if (depth > 3 || cfg.exclude.some((e) => dir === e || dir.startsWith(`${e}/`))) return [];
  const found = existsSync(join(dir, ".git")) ? [dir] : [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.name.endsWith(".worktrees")) continue;
    found.push(...findGitRepos(join(dir, entry.name), cfg, depth + 1));
  }
  return found;
}

function githubSlug(url: string): string | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function discover(cfg: Config): { repos: Repo[]; skipped: string[] } {
  const skipped: string[] = [];
  const repos: Repo[] = [];
  const seen = new Set<string>();
  const candidates = [...new Set([...cfg.roots.flatMap((r) => findGitRepos(r, cfg)), ...cfg.include])];
  for (const path of candidates) {
    if (cfg.skip.includes(path)) continue;
    const forced = cfg.include.includes(path);
    const origin = git(path, "remote", "get-url", "origin");
    const slug = origin.ok ? githubSlug(origin.out) : null;
    const last = Number(git(path, "log", "-1", "--format=%ct").out) * 1000;
    const lastCommitDays = last ? (Date.now() - last) / 864e5 : Number.POSITIVE_INFINITY;
    if (!forced) {
      if (lastCommitDays > cfg.activeWithinDays) continue;
      if (!slug || !cfg.owners.includes(slug.split("/")[0].toLowerCase())) {
        if (!slug) skipped.push(`${path}: active but no GitHub origin`);
        continue;
      }
    }
    if (!slug) {
      skipped.push(`${path}: no GitHub origin`);
      continue;
    }
    repos.push({ path, slug, lastCommitDays });
  }
  // Two clones of one repo (an old copy, say): sweep the most recent.
  const unique = repos
    .sort((a, b) => a.lastCommitDays - b.lastCommitDays)
    .filter((repo) => {
      if (!seen.has(repo.slug)) return seen.add(repo.slug);
      skipped.push(`${repo.path}: older clone of ${repo.slug}`);
      return false;
    });
  return { repos: unique, skipped };
}

// ── Scan ─────────────────────────────────────────────────────

interface SweepPr {
  number: number;
  title: string;
  branch: string;
  state: string;
  url: string;
  merged: boolean;
}

interface RepoReport {
  slug: string;
  path: string;
  branch: string;
  manager: PackageManager | null;
  canOpenPrs: boolean;
  access: string;
  windowDays: number;
  advisories: Advisory[];
  safe: Update[];
  cooling: Update[];
  breaking: BreakingGroup[];
  maxBreakingPrs: number;
  openSweepPrs: SweepPr[];
  notCovered: string[];
  actionable: boolean;
  error?: string;
}

/**
 * Breaking updates that ship together and so belong in one PR: the same
 * family (scope, or name prefix: `expo-*`, `react`/`react-dom`) moving to the
 * same version line.
 */
interface BreakingGroup {
  family: string;
  line: string;
  /** Branch for the PR. Closing that PR unmerged defers this family+line. */
  branch: string;
  status: "new" | "open-pr" | "deferred";
  /** True while any member is younger than the window. */
  cooling: boolean;
  members: Update[];
}

/** Version line a breaking change targets: the major, or 0.minor on 0.x. */
function versionLine(version: string): string {
  const [major, minor] = version.split(".");
  return major === "0" ? `0.${minor}` : major;
}

/**
 * Family key for grouping. A scope is a family (`@jest/globals` joins `jest`).
 * An unscoped name joins its first-dash prefix only when that prefix is itself
 * a package moving to the same line: `expo` anchors `expo-router`, `dockview`
 * anchors `dockview-react`, but `react-native-pager-view` stays alone.
 */
function family(update: Update, sameLine: Set<string>): string {
  if (update.name.startsWith("@types/")) {
    const base = update.name.slice("@types/".length);
    const prefix = base.split("-")[0];
    return `types-${sameLine.has(`@types/${prefix}`) ? prefix : base}`;
  }
  if (update.name.startsWith("@")) return update.name.slice(1).split("/")[0];
  const prefix = update.name.split("-")[0];
  return sameLine.has(prefix) ? prefix : update.name;
}

function groupBreaking(
  updates: Update[],
  deferred: Set<string>,
  open: Set<string>,
): BreakingGroup[] {
  const namesByLine = new Map<string, Set<string>>();
  for (const update of updates) {
    const line = versionLine(update.to);
    if (!namesByLine.has(line)) namesByLine.set(line, new Set());
    namesByLine.get(line)?.add(update.name);
  }
  const groups = new Map<string, BreakingGroup>();
  for (const update of updates) {
    const line = versionLine(update.to);
    const fam = family(update, namesByLine.get(line) ?? new Set());
    const key = `${fam}@${line}`;
    let group = groups.get(key);
    if (!group) {
      const branch = `deps/${fam.replace(/\//g, "-")}-v${line}`;
      const status = deferred.has(branch) ? "deferred" : open.has(branch) ? "open-pr" : "new";
      group = { family: fam, line, branch, status, cooling: false, members: [] };
      groups.set(key, group);
    }
    group.members.push(update);
    group.cooling ||= update.cooling;
  }
  return [...groups.values()];
}

const OTHER_ECOSYSTEMS: Array<[RegExp, string]> = [
  [/(^|\/)Podfile\.lock$/, "CocoaPods"],
  [/(^|\/)Package\.resolved$/, "Swift PM"],
  [/(^|\/)build\.gradle(\.kts)?$/, "Gradle"],
  [/(^|\/)go\.sum$/, "Go"],
  [/(^|\/)Cargo\.lock$/, "Cargo"],
  [/(^|\/)(uv\.lock|poetry\.lock|requirements\.txt)$/, "Python"],
  [/(^|\/)Gemfile\.lock$/, "Ruby"],
  [/(^|\/)(bun\.lock|pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/, "JS (nested)"],
];

function repoWindowDays(repo: string, ref: string, fallback: number): number {
  const bunfig = git(repo, "show", `${ref}:bunfig.toml`);
  const bunMatch = bunfig.ok && bunfig.out.match(/minimumReleaseAge\s*=\s*(\d+)/);
  if (bunMatch) return Number(bunMatch[1]) / 86400;
  const pnpm = git(repo, "show", `${ref}:pnpm-workspace.yaml`);
  const pnpmMatch = pnpm.ok && pnpm.out.match(/minimumReleaseAge:\s*(\d+)/);
  if (pnpmMatch) return Number(pnpmMatch[1]) / 1440;
  return fallback;
}

async function scan(repo: Repo, cfg: Config): Promise<RepoReport> {
  const report: RepoReport = {
    slug: repo.slug,
    path: repo.path,
    branch: "main",
    manager: null,
    canOpenPrs: false,
    access: "",
    windowDays: cfg.windowDays,
    advisories: [],
    safe: [],
    cooling: [],
    breaking: [],
    maxBreakingPrs: cfg.maxBreakingPrsPerRun,
    openSweepPrs: [],
    notCovered: [],
    actionable: false,
  };

  const view = run(["gh", "repo", "view", repo.slug, "--json", "isFork,isArchived,viewerPermission,defaultBranchRef"]);
  if (view.ok) {
    const info = JSON.parse(view.out) as {
      isFork: boolean;
      isArchived: boolean;
      viewerPermission: string;
      defaultBranchRef: { name: string } | null;
    };
    report.branch = info.defaultBranchRef?.name ?? "main";
    if (info.isFork || info.isArchived) {
      report.access = info.isFork ? "fork (skipped)" : "archived (skipped)";
      return report;
    }
    report.canOpenPrs = ["ADMIN", "MAINTAIN", "WRITE"].includes(info.viewerPermission);
    report.access = report.canOpenPrs ? "PRs" : `report only (gh permission: ${info.viewerPermission})`;
  } else {
    report.access = "report only (gh cannot see this repo)";
    // Without gh, ask the remote itself which branch HEAD points at.
    const head = git(repo.path, "ls-remote", "--symref", "origin", "HEAD").out.match(/refs\/heads\/(\S+)\s+HEAD/);
    if (head) report.branch = head[1];
  }

  const fetched = git(repo.path, "fetch", "--quiet", "origin", report.branch);
  const ref = `origin/${report.branch}`;
  if (!fetched.ok) {
    report.error = `git fetch failed: ${fetched.out.split("\n")[0]}`;
    return report;
  }

  const files = git(repo.path, "ls-tree", "-r", "--name-only", ref).out.split("\n");
  const rootLock = LOCKFILES.find(([file]) => files.includes(file));
  for (const file of files) {
    if (file.includes("node_modules/") || (rootLock && file === rootLock[0])) continue;
    const eco = OTHER_ECOSYSTEMS.find(([pattern]) => pattern.test(file));
    if (eco && file.split("/").length <= 4) report.notCovered.push(`${eco[1]}: ${file}`);
  }
  if (!rootLock) return report;

  report.manager = rootLock[1];
  report.windowDays = repoWindowDays(repo.path, ref, cfg.windowDays);
  const lock = parseLockfile(rootLock[1], git(repo.path, "show", `${ref}:${rootLock[0]}`).out);
  const [advisories, updates] = await Promise.all([
    findAdvisories(lock.all),
    findUpdates(lock.direct, report.windowDays),
  ]);
  report.advisories = advisories;

  const deferred = new Set<string>();
  const open = new Set<string>();
  if (report.canOpenPrs) {
    const prs = run(["gh", "pr", "list", "--repo", repo.slug, "--state", "all", "--limit", "100",
      "--json", "number,title,headRefName,state,url,mergedAt"]);
    if (prs.ok) {
      const all = (JSON.parse(prs.out) as Array<{
        number: number; title: string; headRefName: string; state: string; url: string; mergedAt: string | null;
      }>).filter((pr) => pr.headRefName.startsWith("deps/"));
      report.openSweepPrs = all
        .filter((pr) => pr.state === "OPEN")
        .map((pr) => ({ number: pr.number, title: pr.title, branch: pr.headRefName, state: pr.state, url: pr.url, merged: false }));
      for (const pr of all) {
        if (pr.state === "CLOSED" && !pr.mergedAt) deferred.add(pr.headRefName);
      }
      for (const pr of report.openSweepPrs) open.add(pr.branch);
    }
  }
  report.breaking = groupBreaking(updates.filter((u) => u.kind === "breaking"), deferred, open);
  report.safe = updates.filter((u) => u.kind === "safe" && !u.cooling);
  report.cooling = updates.filter((u) => u.kind === "safe" && u.cooling);
  report.actionable =
    report.advisories.length > 0 ||
    report.safe.length > 0 ||
    report.breaking.some((b) => b.status === "new" && !b.cooling);
  return report;
}

// ── Reports ──────────────────────────────────────────────────

function renderReport(r: RepoReport, date: string): string {
  const lines = [`# Dependency sweep: ${r.slug} (${date})`, ""];
  lines.push(`- Path: \`${r.path}\``, `- Default branch: \`${r.branch}\``, `- Package manager: ${r.manager ?? "none at root"}`);
  lines.push(`- Access: ${r.access}`, `- Release-age window: ${r.windowDays} days`);
  if (r.error) lines.push(`- **Error:** ${r.error}`);
  lines.push("", `## Advisories (${r.advisories.length})`, "");
  if (r.advisories.length === 0) lines.push("None.");
  for (const a of r.advisories) {
    lines.push(`- **${a.severity}** \`${a.name}@${a.version}\`: ${a.title} ([${a.id}](${a.url}), affected ${a.vulnerableVersions})`);
  }
  const table = (title: string, rows: Update[], extra?: (u: Update) => string) => {
    lines.push("", `## ${title} (${rows.length})`, "");
    if (rows.length === 0) return void lines.push("None.");
    lines.push("| Package | From | To | Age | Where |" + (extra ? " Status |" : ""));
    lines.push("| --- | --- | --- | --- | --- |" + (extra ? " --- |" : ""));
    for (const u of rows) {
      lines.push(`| \`${u.name}\`${u.dev ? " (dev)" : ""} | ${u.from} | ${u.to} | ${u.ageDays}d | ${u.workspaces.join(", ")} |${extra ? ` ${extra(u)} |` : ""}`);
    }
  };
  table("Safe updates (patch/minor, past the window)", r.safe);
  lines.push("", `## Breaking updates (${r.breaking.length} groups, one PR each, at most ${r.maxBreakingPrs} new per run)`, "");
  if (r.breaking.length === 0) lines.push("None.");
  for (const g of r.breaking) {
    const members = g.members.map((u) => `\`${u.name}\` ${u.from} → ${u.to} (${u.ageDays}d${u.dev ? ", dev" : ""})`).join(", ");
    lines.push(`- **${g.family} v${g.line}**: ${g.status}${g.cooling ? ", cooling" : ""}, branch \`${g.branch}\`: ${members}`);
  }
  table("Cooling (too new for the window; next week)", r.cooling);
  lines.push("", `## Open sweep PRs (${r.openSweepPrs.length})`, "");
  if (r.openSweepPrs.length === 0) lines.push("None.");
  for (const pr of r.openSweepPrs) lines.push(`- #${pr.number} ${pr.title} (\`${pr.branch}\`) ${pr.url}`);
  if (r.notCovered.length > 0) {
    lines.push("", "## Not covered by this sweep", "", ...r.notCovered.map((n) => `- ${n}`));
  }
  return `${lines.join("\n")}\n`;
}

// ── Sessions ─────────────────────────────────────────────────

function sessionPrompt(r: RepoReport, mdPath: string, jsonPath: string, date: string): string {
  return [
    `Weekly dependency sweep for ${r.slug}. Follow the updating-dependencies skill.`,
    "",
    `Report: ${mdPath}`,
    `Machine-readable: ${jsonPath}`,
    `Repo: ${r.path} (default branch ${r.branch}, ${r.manager})`,
    `Date: ${date}. Release-age window: ${r.windowDays} days. Open at most ${r.maxBreakingPrs} new breaking PRs.`,
    "",
    "You are running unattended; Michael is not watching. Never ask questions. When a call is",
    "ambiguous, take the conservative option and explain it in the PR. Do not touch the working",
    `copy at ${r.path}; it may hold uncommitted work. Do everything in a worktree as the skill says.`,
  ].join("\n");
}

function startSession(r: RepoReport, prompt: string, date: string): string | null {
  const res = run([ANIMA, "session", "spawn_agent", "--parentSessionId", "NEW", "--cwd", r.path,
    "--name", `Deps sweep · ${basename(r.slug)} · ${date}`, "--prompt", prompt], undefined, 60_000);
  if (!res.ok) {
    console.error(`  failed to start session: ${res.out.split("\n")[0]}`);
    return null;
  }
  return (JSON.parse(res.out) as { sessionId: string }).sessionId;
}

function turnActive(sessionId: string): boolean {
  const res = run([ANIMA, "session", "get_info", "--sessionId", sessionId], undefined, 30_000);
  if (!res.ok) return false;
  return Boolean((JSON.parse(res.out) as { session?: { turnActive?: boolean } }).session?.turnActive);
}

// ── Main ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

const cfg = loadConfig();
const date = new Date().toLocaleDateString("en-CA");
const outDir = join(homedir(), ".anima", "tasks", "deps-sweep", date);
mkdirSync(outDir, { recursive: true });

const { repos, skipped } = discover(cfg);
const selected = only ? repos.filter((r) => r.path.includes(only) || r.slug.includes(only)) : repos;
console.log(`deps sweep ${date}: ${selected.length} repo(s)${dryRun ? " (dry run)" : ""}`);

const reports: RepoReport[] = [];
for (const repo of selected) {
  try {
    const report = await scan(repo, cfg);
    reports.push(report);
    const file = repo.slug.replace("/", "--");
    writeFileSync(join(outDir, `${file}.json`), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(outDir, `${file}.md`), renderReport(report, date));
    console.log(
      `- ${repo.slug}: ${report.advisories.length} advisories, ${report.safe.length} safe, ` +
        `${report.breaking.filter((b) => b.status === "new").length} breaking, ${report.cooling.length} cooling` +
        ` [${report.access}]${report.actionable ? " -> actionable" : ""}${report.error ? ` ERROR ${report.error}` : ""}`,
    );
  } catch (error) {
    console.error(`- ${repo.slug}: scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const summary = [`# Dependency sweep ${date}`, "", "| Repo | Advisories | Safe | Breaking | Cooling | Access | Session |", "| --- | --- | --- | --- | --- | --- | --- |"];
const queue = reports.filter((r) => r.actionable && r.canOpenPrs);
const sessions = new Map<string, string>();

if (!dryRun) {
  const running: string[] = [];
  for (const r of queue) {
    while (running.length >= cfg.maxConcurrentSessions) {
      await Bun.sleep(60_000);
      for (let i = running.length - 1; i >= 0; i--) if (!turnActive(running[i])) running.splice(i, 1);
    }
    const file = r.slug.replace("/", "--");
    const sessionId = startSession(r, sessionPrompt(r, join(outDir, `${file}.md`), join(outDir, `${file}.json`), date), date);
    if (sessionId) {
      console.log(`  started session ${sessionId} for ${r.slug}`);
      sessions.set(r.slug, sessionId);
      running.push(sessionId);
      // Give the new session time to report turnActive before the next check.
      await Bun.sleep(15_000);
    }
  }
}

for (const r of reports) {
  const breaking = r.breaking.filter((b) => b.status === "new").length;
  summary.push(`| ${r.slug} | ${r.advisories.length} | ${r.safe.length} | ${breaking} | ${r.cooling.length} | ${r.access} | ${sessions.get(r.slug) ?? (r.actionable ? (r.canOpenPrs ? (dryRun ? "dry run" : "failed") : "report only") : "nothing to do")} |`);
}
if (skipped.length > 0) summary.push("", "## Skipped", "", ...skipped.map((s) => `- ${s}`));
writeFileSync(join(outDir, "SUMMARY.md"), `${summary.join("\n")}\n`);
console.log(`reports: ${outDir}`);
