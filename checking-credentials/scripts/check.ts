#!/usr/bin/env bun
/**
 * Check the credentials Anima depends on and tell Michael about any that are
 * invalid or close to expiring.
 *
 * Runs on each host (scheduled daily). Every check skips itself when it
 * doesn't apply there, so the same command works on vesuvius and Anima Sedes:
 *
 *   github  `gh api -i user`: 401 means invalid; an expiry header, when the
 *           token has one, gives the date (OAuth tokens from `gh auth login`
 *           don't expire).
 *   claude  a one-line `claude -p` with user settings off (no hooks), because
 *           the subscription token has no expiry API: working is the test.
 *   mail    `anima mail health_check` (the Zoho refresh token), where mail runs.
 *   certs   every /opt/certs/<domain>/fullchain.cer, by its notAfter date.
 *
 * Problems go to Michael through `anima notify send`. The exit code is 0 even
 * when something needs attention, because the notification is the report: a
 * non-zero exit would make the scheduler send a second "task failed" message.
 *
 * Usage: check.ts [--no-notify]
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WARN_DAYS = 21;
const URGENT_DAYS = 7;
const NOTIFY = !process.argv.includes("--no-notify");
const HOME = homedir();

type Status = "ok" | "warn" | "bad" | "skip";
interface Result {
  name: string;
  status: Status;
  detail: string;
}

function sh(cmd: string[], opts: { cwd?: string; timeoutMs?: number } = {}) {
  try {
    const r = Bun.spawnSync(cmd, {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeoutMs ?? 60_000,
    });
    return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
  } catch (error) {
    // Bun throws when the executable isn't on PATH.
    return { code: -1, out: "", err: error instanceof Error ? error.message : String(error) };
  }
}

const has = (bin: string) => sh(["which", bin]).code === 0;

function daysUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / 86_400_000);
}

function byDays(name: string, what: string, expires: Date): Result {
  const days = daysUntil(expires);
  const when = expires.toISOString().slice(0, 10);
  if (days < 0) return { name, status: "bad", detail: `${what} EXPIRED on ${when}` };
  if (days <= URGENT_DAYS)
    return { name, status: "bad", detail: `${what} expires in ${days} days (${when})` };
  if (days <= WARN_DAYS)
    return { name, status: "warn", detail: `${what} expires in ${days} days (${when})` };
  return { name, status: "ok", detail: `${what} valid until ${when} (${days} days)` };
}

function checkGithub(): Result {
  if (!has("gh")) return { name: "github", status: "skip", detail: "gh not installed" };
  const r = sh(["gh", "api", "-i", "user"]);
  const status = r.out.match(/^HTTP\/[\d.]+ (\d+)/m)?.[1];
  if (status !== "200") {
    return {
      name: "github",
      status: "bad",
      detail: `GitHub token rejected (HTTP ${status ?? "?"}): run gh auth login`,
    };
  }
  const login = r.out.match(/"login":\s*"([^"]+)"/)?.[1] ?? "?";
  const expiry = r.out.match(/^github-authentication-token-expiration:\s*(.+)$/im)?.[1];
  if (!expiry)
    return { name: "github", status: "ok", detail: `GitHub token valid (${login}, no expiry)` };
  return byDays(
    "github",
    `GitHub token (${login})`,
    new Date(expiry.trim().replace(" UTC", "Z").replace(" ", "T")),
  );
}

function checkClaude(): Result {
  if (!has("claude")) return { name: "claude", status: "skip", detail: "claude not installed" };
  // An empty folder and project-only settings: none of the user's hooks run,
  // but the subscription login (keychain or CLAUDE_CODE_OAUTH_TOKEN) does.
  const cwd = join(HOME, ".anima/tasks/credentials-check");
  mkdirSync(cwd, { recursive: true });
  const r = sh(
    [
      "claude",
      "-p",
      "--setting-sources",
      "project",
      "--model",
      "haiku",
      "--max-turns",
      "1",
      "Reply with exactly: OK",
    ],
    { cwd, timeoutMs: 90_000 },
  );
  if (r.code === 0 && r.out.includes("OK")) {
    return { name: "claude", status: "ok", detail: "Claude subscription login works" };
  }
  const why = (r.err || r.out).trim().split("\n")[0]?.slice(0, 160) || `exit ${r.code}`;
  return {
    name: "claude",
    status: "bad",
    detail: `Claude login failed (${why}): run claude and /login`,
  };
}

function checkMail(): Result {
  const r = sh(["anima", "mail", "health_check"], { timeoutMs: 30_000 });
  if (r.code !== 0)
    return { name: "mail", status: "skip", detail: "mail extension not running here" };
  const json = r.out.slice(r.out.indexOf("{"));
  try {
    const health = JSON.parse(json) as {
      status?: string;
      metrics?: Array<{ label: string; value: unknown }>;
    };
    const lastError = health.metrics?.find((m) => m.label === "Last error")?.value;
    if (health.status === "healthy" && (lastError === undefined || lastError === "none")) {
      return { name: "mail", status: "ok", detail: "Zoho mail token works" };
    }
    return {
      name: "mail",
      status: "bad",
      detail: `Zoho mail unhealthy (${String(lastError ?? health.status)})`,
    };
  } catch {
    return { name: "mail", status: "bad", detail: "Couldn't read mail health" };
  }
}

function checkCerts(): Result[] {
  const root = "/opt/certs";
  if (!existsSync(root)) return [];
  const results: Result[] = [];
  for (const domain of readdirSync(root)) {
    const file = join(root, domain, "fullchain.cer");
    if (!existsSync(file)) continue;
    const r = sh(["openssl", "x509", "-enddate", "-noout", "-in", file]);
    const end = r.out.match(/notAfter=(.+)/)?.[1];
    if (!end) {
      results.push({
        name: `cert:${domain}`,
        status: "bad",
        detail: `Couldn't read *.${domain} certificate`,
      });
      continue;
    }
    results.push(byDays(`cert:${domain}`, `*.${domain} certificate`, new Date(end)));
  }
  return results;
}

const results = [checkGithub(), checkClaude(), checkMail(), ...checkCerts()];
const ICON: Record<Status, string> = { ok: "✅", warn: "⚠️", bad: "❌", skip: "–" };
for (const r of results) console.log(`${ICON[r.status]} ${r.name.padEnd(22)} ${r.detail}`);

const problems = results.filter((r) => r.status === "warn" || r.status === "bad");
if (problems.length === 0) {
  console.log("\nAll credentials OK.");
  process.exit(0);
}

const message = problems.map((p) => `${ICON[p.status]} ${p.detail}`).join("\n");
if (!NOTIFY) {
  console.log(`\n${problems.length} need attention (not notifying).`);
  process.exit(0);
}
const sent = sh(
  [
    "anima",
    "notify",
    "send",
    "--title",
    "Credentials need attention",
    "--message",
    message,
    "--source",
    "credentials check",
  ],
  { timeoutMs: 30_000 },
);
console.log(
  sent.code === 0 ? "\nNotified Michael." : `\nNotify failed: ${sent.err.trim().split("\n").pop()}`,
);
// Notify failing is the one case that must not be silent: exit non-zero so
// the scheduler records it (and tries notify itself).
process.exit(sent.code === 0 ? 0 : 1);
