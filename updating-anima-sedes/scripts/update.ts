#!/usr/bin/env bun
/**
 * Bring this machine's Anima checkout up to origin/main, safely.
 *
 * Runs ON the machine being updated (Anima Sedes today, driven over ssh from
 * vesuvius; Sedes herself later). Steps:
 *
 *   1. Find the repo, refuse if it has tracked changes or isn't on main.
 *   2. Fetch and report the incoming commits, flagging the ones that need more
 *      than a restart: migrations, watchdog changes, dependency changes, and
 *      config-shape changes.
 *   3. (--check stops here.)
 *   4. Fast-forward, `bun install` if dependencies moved, redeploy the compiled
 *      watchdog if its source moved, then restart the watchdog through launchd.
 *   5. Wait for every supervised service to come back healthy. If they don't,
 *      roll the code back to the previous commit and restart again.
 *
 * Also fast-forwards the skills repo when it is present, so skill scripts stay
 * in step with the platform that runs them.
 *
 * Usage: update.ts [--check]
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOME = homedir();
// Over ssh the PATH has neither bun nor Homebrew, and package scripts spawn
// `bun` themselves, so put both in front before running anything.
process.env.PATH = [dirname(process.execPath), "/opt/homebrew/bin", process.env.PATH].join(":");
const CHECK_ONLY = process.argv.includes("--check");
const PLIST = join(HOME, "Library/LaunchAgents/com.anima.watchdog.plist");
const HEALTH_TIMEOUT_MS = 120_000;

if (process.env.ANIMA_TASK_ID && !CHECK_ONLY) {
  // Restarting the watchdog kills the scheduler that is running this script,
  // so the health check and any rollback would never happen.
  fail(
    "Refusing to update from inside Anima's scheduler: the restart would kill this run " +
      "before it could verify or roll back. Run it from a terminal or over ssh, or use --check.",
  );
}

// ── helpers ──────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function run(cmd: string[], cwd?: string): string {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    fail(`${cmd.join(" ")} failed (exit ${result.exitCode}):\n${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function step(cmd: string[], cwd: string): void {
  console.log(`  $ ${cmd.join(" ")}`);
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) fail(`${cmd.join(" ")} failed (exit ${result.exitCode})`);
}

function findRepo(): string {
  const candidates = [
    process.env.ANIMA_REPO,
    join(HOME, "Projects/iamclaudia-ai/anima"),
    join(HOME, "Projects/anima"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    const pkg = join(dir, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      if (JSON.parse(readFileSync(pkg, "utf8")).name === "anima") return dir;
    } catch {
      // Not ours; keep looking.
    }
  }
  fail(`No Anima checkout found (tried ${candidates.join(", ")}). Set ANIMA_REPO.`);
}

/** Group changed files into the reasons an update needs more than a restart. */
function classify(files: string[]) {
  return {
    migrations: files.filter((f) => /^packages\/gateway\/migrations\/.+\.sql$/.test(f)),
    watchdog: files.some((f) => f.startsWith("packages/watchdog/") || f.startsWith("packages/shared/")),
    deps: files.some((f) => f === "bun.lock" || f.endsWith("package.json")),
    config: files.filter((f) => /packages\/shared\/src\/config\.ts$|anima\.example\.json$/.test(f)),
  };
}

function gatewayToken(): string {
  try {
    const cfg = JSON.parse(readFileSync(join(HOME, ".anima/anima.json"), "utf8"));
    return cfg.gateway?.token ?? "";
  } catch {
    return "";
  }
}

function restartWatchdog(): number {
  if (!existsSync(PLIST)) fail(`No watchdog launch agent at ${PLIST}`);
  const domain = `gui/${process.getuid?.() ?? run(["id", "-u"])}`;
  console.log(`  restarting watchdog (${domain})`);
  const startedAt = Date.now();
  // bootout fails harmlessly when the agent isn't loaded.
  Bun.spawnSync(["launchctl", "bootout", domain, PLIST], { stdout: "ignore", stderr: "ignore" });
  // bootout returns before launchd has fully let go; bootstrap too soon gets EIO.
  for (let attempt = 1; attempt <= 10; attempt++) {
    const result = Bun.spawnSync(["launchctl", "bootstrap", domain, PLIST], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) return startedAt;
    Bun.sleepSync(1000);
  }
  fail("launchctl bootstrap kept failing; the watchdog is NOT running. Bootstrap it by hand.");
}

type ServiceStatus = { healthy?: boolean; processAlive?: boolean; lastRestart?: string | null };

/** Wait until every supervised service is healthy and was (re)started after `since`. */
async function waitHealthy(since: number): Promise<{ ok: boolean; detail: string }> {
  const token = gatewayToken();
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let detail = "watchdog not answering";
  while (Date.now() < deadline) {
    await Bun.sleep(3000);
    try {
      const res = await fetch("http://127.0.0.1:30085/status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        detail = `watchdog /status returned ${res.status}`;
        continue;
      }
      const status = (await res.json()) as Record<string, ServiceStatus>;
      const services = Object.entries(status).filter(
        ([, s]) => s && typeof s === "object" && "healthy" in s,
      );
      const waiting = services.filter(
        ([, s]) =>
          !s.healthy ||
          !s.processAlive ||
          !s.lastRestart ||
          Date.parse(s.lastRestart) < since - 5000,
      );
      detail = waiting.length
        ? `waiting on ${waiting.map(([name]) => name).join(", ")}`
        : `${services.map(([name]) => name).join(", ")} healthy`;
      if (services.length > 0 && waiting.length === 0) return { ok: true, detail };
    } catch (err) {
      detail = `watchdog unreachable (${err instanceof Error ? err.message : err})`;
    }
  }
  return { ok: false, detail };
}

function pullSkills(): void {
  const dir = join(HOME, "Projects/iamclaudia-ai/skills");
  if (!existsSync(join(dir, ".git"))) return;
  const dirty = run(["git", "status", "--porcelain", "--untracked-files=no"], dir);
  if (dirty) {
    console.log("⚠️  skills repo has local changes; not pulling it");
    return;
  }
  const before = run(["git", "rev-parse", "--short", "HEAD"], dir);
  run(["git", "fetch", "-q", "origin"], dir);
  if (CHECK_ONLY) {
    const n = run(["git", "rev-list", "--count", "HEAD..origin/main"], dir);
    console.log(`skills: ${n} commit(s) behind`);
    return;
  }
  run(["git", "merge", "-q", "--ff-only", "origin/main"], dir);
  const after = run(["git", "rev-parse", "--short", "HEAD"], dir);
  console.log(before === after ? `skills: up to date (${after})` : `skills: ${before} → ${after}`);
}

// ── main ─────────────────────────────────────────────────────

const repo = findRepo();
console.log(`Anima checkout: ${repo}`);

const branch = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
if (branch !== "main") fail(`Checkout is on '${branch}', not main.`);
const dirty = run(["git", "status", "--porcelain", "--untracked-files=no"], repo);
if (dirty) fail(`Checkout has tracked changes; refusing to touch it:\n${dirty}`);

pullSkills();

run(["git", "fetch", "-q", "origin"], repo);
const prev = run(["git", "rev-parse", "HEAD"], repo);
const incoming = run(["git", "log", "--oneline", "--no-decorate", "HEAD..origin/main"], repo);
if (!incoming) {
  console.log(`✅ Anima is up to date at ${prev.slice(0, 8)}.`);
  process.exit(0);
}

const files = run(["git", "diff", "--name-only", "HEAD", "origin/main"], repo).split("\n");
const flags = classify(files);
const count = incoming.split("\n").length;
console.log(`\n${count} incoming commit(s):\n${incoming}\n`);
if (flags.migrations.length) console.log(`🗄️  migrations: ${flags.migrations.join(", ")}`);
if (flags.watchdog) console.log("🐕 watchdog source changed: will redeploy the compiled watchdog");
if (flags.deps) console.log("📦 dependencies changed: will run bun install");
if (flags.config.length) {
  console.log(
    `⚙️  config shape changed (${flags.config.join(", ")}): compare anima.json with config-diff`,
  );
}

if (CHECK_ONLY) process.exit(0);

console.log("\nUpdating:");
step(["git", "merge", "-q", "--ff-only", "origin/main"], repo);
if (flags.deps) step(["bun", "install"], repo);
if (flags.watchdog) step(["bun", "run", "watchdog:deploy"], repo);

const since = restartWatchdog();
const health = await waitHealthy(since);
if (health.ok) {
  const now = run(["git", "rev-parse", "--short", "HEAD"], repo);
  console.log(`\n✅ Updated ${prev.slice(0, 8)} → ${now}: ${health.detail}.`);
  if (flags.migrations.length) console.log("   Migrations applied on gateway start.");
  process.exit(0);
}

console.error(`\n⚠️  Unhealthy after update (${health.detail}). Rolling back to ${prev.slice(0, 8)}.`);
step(["git", "reset", "-q", "--hard", prev], repo);
if (flags.deps) step(["bun", "install"], repo);
if (flags.watchdog) step(["bun", "run", "watchdog:deploy"], repo);
const again = await waitHealthy(restartWatchdog());
fail(
  again.ok
    ? `Update failed and was rolled back; services are healthy on ${prev.slice(0, 8)}. ` +
        "Migrations from the new code (if any) stay applied; they are additive."
    : `Update failed AND the rollback is unhealthy (${again.detail}). Look at ~/.anima/logs now.`,
);
