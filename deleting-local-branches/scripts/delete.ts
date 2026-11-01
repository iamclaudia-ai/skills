#!/usr/bin/env bun
/**
 * Delete local branches I created myself (reviews, scratch, experiments, finished
 * deps branches), with the safety checks that dcg's blanket "no git branch -d"
 * rule stands in for.
 *
 * A branch is deleted only when nothing would be lost:
 *   - it is not the default branch, the current branch, or checked out in a worktree
 *   - every commit on it is reachable from another ref (a remote branch, another
 *     local branch, a tag), or each of its commits has an identical patch on the
 *     default branch (rebased or cherry-picked in), or its PR was merged (squash
 *     merges leave the original commits unreachable, but their content is on the
 *     default branch)
 * --force skips the commit check, never the branch checks.
 *
 * Every deletion is logged with its SHA, and the restore command is printed.
 *
 * Usage:
 *   delete.ts --repo <abs-path> [--dry-run] [--force] [--prefix <p>]... [<branch>...]
 */
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";

interface Options {
  repo: string;
  dryRun: boolean;
  force: boolean;
  prefixes: string[];
  names: string[];
}

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage: delete --repo <abs-path> [--dry-run] [--force] [--prefix <p>]... [<branch>...]",
      "",
      "  --repo <path>    the repository (required under the skills runner, which runs from the skill dir)",
      "  --prefix <p>     also select every local branch starting with <p> (e.g. review/)",
      "  --dry-run        report what would be deleted, delete nothing",
      "  --force          delete even when the branch has commits nowhere else (they stay in the reflog)",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { repo: "", dryRun: false, force: false, prefixes: [], names: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--repo":
        opts.repo = argv[++i] ?? usage("--repo needs a path");
        break;
      case "--prefix":
        opts.prefixes.push(argv[++i] ?? usage("--prefix needs a value"));
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "-h":
      case "--help":
        usage();
      default:
        if (arg.startsWith("-")) usage(`unknown option ${arg}`);
        opts.names.push(arg);
    }
  }
  if (!opts.repo) {
    // Run directly from a repo: use it. Under the runner cwd is the skill dir, so insist.
    if (process.env.SKILL_DIR) usage("--repo is required when run through `anima skills run`");
    opts.repo = process.cwd();
  }
  if (!isAbsolute(opts.repo)) usage("--repo must be an absolute path");
  if (opts.names.length === 0 && opts.prefixes.length === 0) {
    usage("name at least one branch or --prefix");
  }
  return opts;
}

function git(repo: string, args: string[]): { ok: boolean; out: string; err: string } {
  const proc = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    ok: proc.exitCode === 0,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
  };
}

function defaultBranch(repo: string): string {
  const head = git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok && head.out) return head.out.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if (git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).ok) {
      return candidate;
    }
  }
  return "main";
}

/** branch name -> worktree path, for every branch checked out in any worktree. */
function worktreeBranches(repo: string): Map<string, string> {
  const map = new Map<string, string>();
  let path = "";
  for (const line of git(repo, ["worktree", "list", "--porcelain"]).out.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line.startsWith("branch refs/heads/")) map.set(line.slice("branch refs/heads/".length), path);
  }
  return map;
}

/** Commits on `branch` that no other ref (local, remote, tag) reaches. */
function uniqueCommitCount(repo: string, branch: string): number {
  const refs = git(repo, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])
    .out.split("\n")
    .filter((ref) => ref && ref !== `refs/heads/${branch}` && !ref.endsWith("/HEAD"));
  // --not does not reach revisions read from stdin, so negate each one explicitly.
  const proc = Bun.spawnSync(["git", "-C", repo, "rev-list", "--count", `refs/heads/${branch}`, "--stdin"], {
    stdin: new TextEncoder().encode(refs.map((ref) => `^${ref}`).join("\n") + "\n"),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString().trim());
  return Number(proc.stdout.toString().trim());
}

/**
 * True when every commit on `branch` that `trunk` lacks has an identical patch on
 * `trunk` (`git cherry` marks it "-"): the branch was rebased or cherry-picked in,
 * so its commits are unreachable but nothing in them is missing.
 */
function patchesUpstream(repo: string, trunk: string, branch: string): boolean {
  const cherry = git(repo, ["cherry", `refs/heads/${trunk}`, `refs/heads/${branch}`]);
  if (!cherry.ok) return false;
  const lines = cherry.out.split("\n").filter(Boolean);
  return lines.length > 0 && lines.every((line) => line.startsWith("- "));
}

interface PrInfo {
  number: number;
  state: string;
}

/** The PR whose head is this branch, if gh is available and one exists. */
function prFor(repo: string, branch: string): PrInfo | null {
  const proc = Bun.spawnSync(["gh", "pr", "view", branch, "--json", "number,state"], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return null;
  try {
    return JSON.parse(proc.stdout.toString()) as PrInfo;
  } catch {
    return null;
  }
}

/** Log next to the existing cleanup-local-branches log when tmp/ is ignored, else globally. */
function logPath(repo: string): string {
  const inRepo = join(repo, "tmp", "deleted-branches.txt");
  if (git(repo, ["check-ignore", "-q", "tmp/deleted-branches.txt"]).ok) return inRepo;
  return join(homedir(), ".local", "state", "deleting-local-branches", "deleted-branches.txt");
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const repo = opts.repo;
  if (!git(repo, ["rev-parse", "--git-dir"]).ok) usage(`${repo} is not a git repository`);

  const local = git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).out.split("\n").filter(Boolean);
  const selected = new Set<string>();
  for (const name of opts.names) selected.add(name);
  for (const prefix of opts.prefixes) {
    for (const branch of local) if (branch.startsWith(prefix)) selected.add(branch);
  }

  const trunk = defaultBranch(repo);
  const current = git(repo, ["branch", "--show-current"]).out;
  const worktrees = worktreeBranches(repo);
  const log = logPath(repo);

  let deleted = 0;
  let skipped = 0;
  const skip = (branch: string, why: string) => {
    console.log(`  skip    ${branch}: ${why}`);
    skipped++;
  };

  console.log(`${opts.dryRun ? "[dry run] " : ""}${repo} (default branch ${trunk})`);
  for (const branch of [...selected].sort()) {
    if (!local.includes(branch)) {
      skip(branch, "no such local branch");
      continue;
    }
    if (branch === trunk || branch === "main" || branch === "master") {
      skip(branch, "default branch");
      continue;
    }
    if (branch === current) {
      skip(branch, "currently checked out");
      continue;
    }
    const worktree = worktrees.get(branch);
    if (worktree) {
      skip(branch, `checked out in worktree ${worktree}`);
      continue;
    }

    const sha = git(repo, ["rev-parse", `refs/heads/${branch}`]).out;
    const unique = uniqueCommitCount(repo, branch);
    let reason = unique === 0 ? "all commits reachable elsewhere" : "";
    if (unique > 0 && patchesUpstream(repo, trunk, branch)) {
      reason = `all ${unique} commit(s) already on ${trunk} as identical patches`;
    } else if (unique > 0) {
      const pr = prFor(repo, branch);
      if (pr?.state === "MERGED") {
        reason = `PR #${pr.number} merged`;
      } else if (opts.force) {
        reason = `forced, ${unique} commit(s) only in this branch (reflog keeps them)`;
      } else {
        const prNote = pr ? `PR #${pr.number} is ${pr.state.toLowerCase()}` : "no PR";
        skip(branch, `${unique} commit(s) exist only here, ${prNote} (--force to delete anyway)`);
        continue;
      }
    }

    if (opts.dryRun) {
      console.log(`  would delete ${branch} ${sha.slice(0, 10)} (${reason})`);
      deleted++;
      continue;
    }
    const result = git(repo, ["branch", "-D", branch]);
    if (!result.ok) {
      skip(branch, `git refused: ${result.err}`);
      continue;
    }
    const dir = join(log, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(log, `${branch} ${sha} ${reason.replace(/\s+/g, "_")} ${new Date().toISOString()} ${repo}\n`);
    console.log(`  deleted ${branch} ${sha.slice(0, 10)} (${reason})  restore: git branch ${branch} ${sha}`);
    deleted++;
  }

  const verb = opts.dryRun ? "would delete" : "deleted";
  console.log(`\n${verb} ${deleted}, skipped ${skipped}.${deleted && !opts.dryRun ? ` Logged in ${log}` : ""}`);
}

main();
