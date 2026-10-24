#!/usr/bin/env bun
// Security posture of one project directory: which ecosystems it uses and the
// audit command for each, whether a release-age window is configured, floating
// version specifiers, `@latest` executions that bypass the window, and whether
// the local Bun/Node runtimes are behind (Node's index flags security releases).
//
// Usage: posture.ts <absolute-project-dir>

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const root = process.argv[2];
if (!root || !existsSync(root)) {
  console.error("usage: posture.ts <absolute-project-dir>");
  process.exit(2);
}

const has = (file: string) => existsSync(join(root, file));
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const section = (title: string) => console.log(`\n== ${title}`);

// ── Ecosystems ────────────────────────────────────────────────
section("Ecosystems → audit command");
const ecosystems: Array<[string, boolean, string]> = [
  ["bun", has("bun.lock") || has("bun.lockb"), "bun audit   (fix: bun audit fix --dry-run, then bun audit fix [--latest])"],
  ["pnpm", has("pnpm-lock.yaml"), "pnpm audit   (fix: pnpm audit --fix writes overrides)"],
  ["npm", has("package-lock.json"), "npm audit   (fix: npm audit fix)"],
  ["yarn", has("yarn.lock"), "yarn npm audit (berry) | yarn audit (classic)"],
  ["ruby", has("Gemfile.lock"), "bundle-audit check --update   (gem install bundler-audit)"],
  ["python", has("uv.lock") || has("requirements.txt") || has("poetry.lock"), "uvx pip-audit   (-r requirements.txt, or inside the venv)"],
  ["rust", has("Cargo.lock"), "cargo audit   (cargo install cargo-audit)"],
  ["swift", has("Package.resolved"), "osv-scanner scan source -r .   (brew install osv-scanner)"],
];
const found = ecosystems.filter(([, present]) => present);
if (found.length === 0) console.log("none detected at the top level");
for (const [name, , cmd] of found) console.log(`${name.padEnd(7)} ${cmd}`);
if (found.length > 1) console.log("tip: osv-scanner scan source -r . covers every lockfile in one pass");

// ── Release-age window ────────────────────────────────────────
// Exclude lists come as a TOML array (Bun) or an inline/block YAML list (pnpm).
// Comment lines are kept because they usually record why and until when.
function excludeEntries(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /minimumReleaseAgeExcludes?\s*[=:]/.test(l));
  if (start === -1) return [];
  const inline = lines[start].split(/[=:]/).slice(1).join(":").trim();
  if (inline.startsWith("[")) {
    let joined = inline;
    for (let i = start + 1; !joined.includes("]") && i < lines.length; i++) joined += lines[i];
    return [joined.replace(/\s+/g, " ")];
  }
  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    entries.push(line.trim());
  }
  return entries;
}

section("Release-age window (supply-chain cooling-off)");
const windows: Array<[string, RegExp]> = [
  [join(root, "bunfig.toml"), /minimumReleaseAge\s*=\s*(\d+)/],
  [join(homedir(), ".bunfig.toml"), /minimumReleaseAge\s*=\s*(\d+)/],
  [join(homedir(), ".config", ".bunfig.toml"), /minimumReleaseAge\s*=\s*(\d+)/],
  [join(root, "pnpm-workspace.yaml"), /minimumReleaseAge:\s*(\d+)/],
  [join(root, ".yarnrc.yml"), /npmMinimalAgeGate:\s*(\S+)/],
  [join(root, ".npmrc"), /^(?:min-release-age|before)\s*=\s*(.+)$/m],
];
let anyWindow = false;
for (const [file, pattern] of windows) {
  const match = read(file).match(pattern);
  if (!match) continue;
  anyWindow = true;
  const unit = file.endsWith(".toml") ? "s" : file.endsWith("pnpm-workspace.yaml") ? "min" : "";
  console.log(`${file}: ${match[1]}${unit}`);
  const excludes = excludeEntries(read(file));
  if (excludes.length > 0) {
    console.log(`  excludes (prune entries older than the window):`);
    for (const entry of excludes) console.log(`    ${entry}`);
  }
}
if (!anyWindow) console.log("NONE — every install can pull a release published minutes ago");

// ── Floating specifiers and @latest executions ────────────────
section("Floating specifiers / @latest executions (bypass the window)");
function manifests(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...manifests(full, depth + 1));
    else if (entry.name === "package.json") out.push(full);
  }
  return out;
}
const hookDir = join(root, ".husky");
const hookFiles = existsSync(hookDir)
  ? readdirSync(hookDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(hookDir, e.name))
  : [];
let flagged = 0;
for (const file of [...manifests(root), ...hookFiles]) {
  read(file)
    .split("\n")
    .forEach((line, i) => {
      const floating = /"[^"]+":\s*"(latest|\*|next)"/.test(line);
      const execLatest = /\b(npx|bunx|bun x|pnpm dlx|yarn dlx)\b[^"\n]*@latest/.test(line);
      if (!floating && !execLatest) return;
      flagged++;
      console.log(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
    });
}
if (flagged === 0) console.log("none");

// ── Credentials in git remotes ────────────────────────────────
section("Credentials in git remote URLs");
const remotes = Bun.spawnSync(["git", "-C", root, "remote", "-v"], { stderr: "ignore" });
const leaks = new Set<string>();
for (const line of remotes.stdout.toString().split("\n")) {
  const match = line.match(/^(\S+)\s+\w+:\/\/([^/@\s]+)@(\S+)/);
  // user@host alone is fine (ssh-style); a ':' before '@' means user:secret.
  if (match?.[2].includes(":")) {
    leaks.add(`${match[1]}: ${match[2].split(":")[0]}:****@${match[3]}  ← revoke the token, then git remote set-url`);
  }
}
console.log(leaks.size > 0 ? [...leaks].join("\n") : "none");

// ── Runtimes ──────────────────────────────────────────────────
section("Runtimes");
const local = (cmd: string[]) => {
  const run = Bun.spawnSync(cmd, { stderr: "ignore" });
  return run.success ? run.stdout.toString().trim().replace(/^v/, "") : null;
};
const bunLocal = local(["bun", "--version"]);
if (bunLocal) {
  const doc = (await (await fetch("https://registry.npmjs.org/bun")).json()) as {
    "dist-tags": { latest: string };
  };
  const latest = doc["dist-tags"].latest;
  console.log(`bun   ${bunLocal}  latest ${latest}${bunLocal === latest ? "" : "  ← upgrade: bun upgrade"}`);
}
const nodeLocal = local(["node", "--version"]);
if (nodeLocal) {
  type NodeRelease = { version: string; date: string; security: boolean; lts: string | false };
  const index = (await (await fetch("https://nodejs.org/dist/index.json")).json()) as NodeRelease[];
  const major = nodeLocal.split(".")[0];
  const sameMajor = index.filter((r) => r.version.startsWith(`v${major}.`));
  const newer = sameMajor.slice(0, sameMajor.findIndex((r) => r.version === `v${nodeLocal}`));
  const security = newer.filter((r) => r.security);
  const latest = sameMajor[0]?.version.slice(1) ?? "?";
  const status =
    newer.length === 0
      ? "current"
      : security.length > 0
        ? `SECURITY releases since: ${security.map((r) => `${r.version} (${r.date})`).join(", ")}`
        : `${newer.length} newer non-security release(s)`;
  console.log(`node  ${nodeLocal}  latest v${major}: ${latest}  → ${status}`);
}
