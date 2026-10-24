#!/usr/bin/env bun
// Homebrew security scan for this machine. Joins `brew vulns` (OSV.dev) with
// `brew outdated` so each finding says whether an upgrade exists, marks
// formulae that are exposed (a running brew service, or any running process
// launched from a Homebrew keg), checks brew Node kegs against Node's security
// releases, lists what OSV could not cover, and compares outdated casks with the
// version actually on disk (self-updating apps are usually ahead of brew's record).
//
// Read-only: it never upgrades anything. `brew update` refreshes metadata only.
//
// Usage: brew.ts [--out <dir>] [--no-update]
//   --out        also write homebrew.md and homebrew.json into <dir>
//   --no-update  skip `brew update` (use the metadata already on disk)

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined;
const skipUpdate = args.includes("--no-update");

if (!Bun.which("brew")) {
  console.error("brew not found on PATH");
  process.exit(2);
}

const env = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ENV_HINTS: "1" };
function brew(cmd: string[], timeoutMs = 300_000): { ok: boolean; out: string } {
  const res = Bun.spawnSync(["brew", ...cmd], { env, stderr: "pipe", timeout: timeoutMs });
  return { ok: res.success, out: res.stdout.toString() };
}
function json<T>(cmd: string[], fallback: T): T {
  const { out } = brew(cmd);
  try {
    return JSON.parse(out) as T;
  } catch {
    return fallback;
  }
}

// ── Versions ──────────────────────────────────────────────────
const parts = (v: string) => v.split(",")[0].split(/[^0-9]+/).filter(Boolean).map(Number);
function compareVersions(a: string, b: string): number {
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Gather ────────────────────────────────────────────────────
if (!skipUpdate) brew(["update", "--quiet"], 600_000);

interface Vulnerability { id: string; severity: string; summary: string; aliases: string[] }
interface VulnsReport {
  checked: number;
  complete: boolean;
  findings: Array<{ formula: string; version: string; vulnerabilities: Vulnerability[] }>;
  skipped_formulae: string[];
  unscanned_formulae: Record<string, string>;
  outdated_without_sbom: string[];
}
// brew vulns exits 1 when it finds anything, so parse stdout regardless.
const vulns = json<VulnsReport>(["vulns", "--json"], {
  checked: 0,
  complete: false,
  findings: [],
  skipped_formulae: [],
  unscanned_formulae: {},
  outdated_without_sbom: [],
});

interface Outdated {
  formulae: Array<{ name: string; installed_versions: string[]; current_version: string; pinned: boolean }>;
  casks: Array<{ name: string; installed_versions: string[]; current_version: string }>;
}
const outdated = json<Outdated>(["outdated", "--json=v2", "--greedy"], { formulae: [], casks: [] });
const latestFormula = new Map(outdated.formulae.map((f) => [f.name, f.current_version]));

const services = json<Array<{ name: string; status: string }>>(["services", "list", "--json"], []);
const runningServices = new Set(services.filter((s) => s.status === "started").map((s) => s.name));

// Any running process launched from a keg path counts as exposure
// (code-server runs on node@22 without being a brew service).
const inUse = new Set<string>();
const ps = Bun.spawnSync(["ps", "-axo", "command="]).stdout.toString();
for (const match of ps.matchAll(/\/opt\/homebrew\/(?:Cellar|opt)\/([^/\s]+)\//g)) inUse.add(match[1]);

// Old kegs linger until cleanup, so a formula can list several versions: take the newest.
const installed = new Map<string, string>();
for (const line of brew(["list", "--formula", "--versions"]).out.split("\n")) {
  const [name, ...versions] = line.trim().split(/\s+/);
  if (name && versions.length > 0) installed.set(name, versions.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b)));
}

// ── Formula findings ─────────────────────────────────────────
const count = (vs: Vulnerability[], severity: string) => vs.filter((v) => v.severity === severity).length;
const formulae = vulns.findings
  .map((f) => ({
    formula: f.formula,
    installed: f.version,
    latest: latestFormula.get(f.formula) ?? null,
    critical: count(f.vulnerabilities, "CRITICAL"),
    high: count(f.vulnerabilities, "HIGH"),
    medium: count(f.vulnerabilities, "MEDIUM"),
    total: f.vulnerabilities.length,
    exposure: runningServices.has(f.formula) ? "service" : inUse.has(f.formula) ? "process" : null,
    top: f.vulnerabilities
      .filter((v) => v.severity === "CRITICAL" || v.severity === "HIGH")
      .slice(0, 3)
      .map((v) => `${v.id}${v.summary ? `: ${v.summary}` : ""}`),
  }))
  .sort((a, b) => b.critical - a.critical || b.high - a.high || b.total - a.total);

// ── Node kegs vs Node security releases ──────────────────────
type NodeRelease = { version: string; date: string; security: boolean };
const nodeKegs = [...installed.entries()].filter(([name]) => /^node(@\d+)?$/.test(name));
const nodeSecurity: Array<{ keg: string; installed: string; releases: string[] }> = [];
if (nodeKegs.length > 0) {
  try {
    const index = (await (await fetch("https://nodejs.org/dist/index.json")).json()) as NodeRelease[];
    for (const [keg, version] of nodeKegs) {
      const major = version.split(".")[0];
      const releases = index
        .filter((r) => r.security && r.version.startsWith(`v${major}.`) && compareVersions(r.version.slice(1), version) > 0)
        .map((r) => `${r.version} (${r.date})`);
      if (releases.length > 0) nodeSecurity.push({ keg, installed: version, releases });
    }
  } catch {
    // Offline: the outdated list still shows the Node kegs.
  }
}

// ── Coverage gaps ────────────────────────────────────────────
const uncoveredOutdated = vulns.skipped_formulae
  .filter((name) => latestFormula.has(name))
  .map((name) => ({ name, installed: installed.get(name) ?? "?", latest: latestFormula.get(name) ?? "?" }))
  .sort((a, b) => a.name.localeCompare(b.name));
const untrusted = Object.entries(vulns.unscanned_formulae)
  .filter(([, reason]) => reason === "untrusted_tap")
  .map(([name]) => name);

// ── Casks: compare with the version on disk ───────────────────
interface CaskInfo { token: string; auto_updates: boolean | null; artifacts: Array<Record<string, unknown>> }
const caskInfo = new Map<string, CaskInfo>();
if (outdated.casks.length > 0) {
  const info = json<{ casks: CaskInfo[] }>(["info", "--cask", "--json=v2", ...outdated.casks.map((c) => c.name)], { casks: [] });
  for (const c of info.casks) caskInfo.set(c.token, c);
}
function onDiskVersion(token: string): string | null {
  const app = caskInfo.get(token)?.artifacts.find((a) => "app" in a)?.app;
  const name = Array.isArray(app) ? app.find((x): x is string => typeof x === "string") : undefined;
  if (!name) return null;
  const plist = join("/Applications", name, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const res = Bun.spawnSync(["plutil", "-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist]);
  return res.success ? res.stdout.toString().trim() : null;
}
const casks = outdated.casks
  .map((c) => {
    const disk = onDiskVersion(c.name);
    const current = disk ?? c.installed_versions[0] ?? "?";
    return {
      cask: c.name,
      installed: current,
      latest: c.current_version.split(",")[0],
      selfUpdates: caskInfo.get(c.name)?.auto_updates === true,
      stale: compareVersions(current, c.current_version) < 0,
    };
  })
  .filter((c) => c.stale);

// ── Verdict ──────────────────────────────────────────────────
const exposed = formulae.filter((f) => f.exposure);
const fixableSevere = formulae.filter((f) => f.latest && (f.critical > 0 || f.high > 0));
const actionable = exposed.length > 0 || fixableSevere.length > 0 || nodeSecurity.length > 0;

const report = {
  host: hostname(),
  scannedAt: new Date().toISOString(),
  actionable,
  coverage: { checked: vulns.checked, complete: vulns.complete, skipped: vulns.skipped_formulae.length, untrusted },
  outdatedFormulae: outdated.formulae.length,
  runningServices: [...runningServices],
  formulae,
  nodeSecurity,
  uncoveredOutdated,
  casks,
};

// ── Markdown ─────────────────────────────────────────────────
const md: string[] = [
  `# Homebrew security scan: ${report.host}, ${report.scannedAt.slice(0, 10)}`,
  "",
  `OSV checked ${vulns.checked} formulae${vulns.complete ? "" : " (incomplete coverage, see below)"}. ` +
    `${formulae.length} have findings, ${formulae.filter((f) => f.latest).length} of them fixable by upgrading. ` +
    `${outdated.formulae.length} formulae are outdated in total, and ${casks.length} casks are behind on disk. ` +
    `Running brew services: ${[...runningServices].join(", ") || "none"}.`,
  "",
  "Nothing was changed. See the auditing-dependencies skill (Homebrew section) before upgrading.",
];

if (exposed.length > 0 || nodeSecurity.length > 0) {
  md.push("", "## Fix first: running, or a runtime security release", "");
  for (const f of exposed) {
    md.push(`- **${f.formula}** ${f.installed} → ${f.latest ?? "no newer bottle"} (running as ${f.exposure}): ${f.critical} critical, ${f.high} high, ${f.total} total`);
  }
  for (const n of nodeSecurity) {
    md.push(`- **${n.keg}** ${n.installed}${inUse.has(n.keg) ? " (running)" : ""}: Node security release(s) since: ${n.releases.join(", ")}`);
  }
}

if (formulae.length > 0) {
  md.push("", "## Vulnerable formulae", "", "| Formula | Installed | Upgrade to | Crit | High | Med | Total | Exposure |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const f of formulae) {
    md.push(`| ${f.formula} | ${f.installed} | ${f.latest ?? "none yet"} | ${f.critical} | ${f.high} | ${f.medium} | ${f.total} | ${f.exposure ?? ""} |`);
  }
  const worst = formulae.filter((f) => f.top.length > 0).slice(0, 5);
  if (worst.length > 0) {
    md.push("", "Top critical/high findings:", "");
    for (const f of worst) for (const t of f.top) md.push(`- ${f.formula}: ${t}`);
  }
}

if (uncoveredOutdated.length > 0) {
  md.push("", "## Not covered by OSV, and outdated", "", "`brew vulns` cannot map these to a source repo, so check their release notes or just upgrade:", "");
  md.push(uncoveredOutdated.map((u) => `${u.name} ${u.installed} → ${u.latest}`).join(", "));
}

if (untrusted.length > 0) {
  md.push("", "## Not scanned (untrusted tap)", "", `${untrusted.join(", ")}. Trust a formula you use with \`brew trust --formula <tap>/<formula>\`, or uninstall it.`);
}

if (casks.length > 0) {
  const manual = casks.filter((c) => !c.selfUpdates);
  const auto = casks.filter((c) => c.selfUpdates);
  md.push("", "## Casks behind on disk", "", "OSV does not cover casks. Versions are read from the installed app, so apps that already updated themselves are not listed.");
  if (manual.length > 0) {
    md.push("", "Brew-managed (`brew upgrade --cask <name>`; a pkg cask asks for sudo), or uninstall if unused:", "");
    for (const c of manual) md.push(`- ${c.cask} ${c.installed} → ${c.latest}`);
  }
  if (auto.length > 0) {
    md.push("", `Self-updating, but not run lately (open them, or remove them if unused): ${auto.map((c) => `${c.cask} ${c.installed} → ${c.latest}`).join(", ")}`);
  }
}

const markdown = `${md.join("\n")}\n`;
console.log(markdown);

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "homebrew.md"), markdown);
  writeFileSync(join(outDir, "homebrew.json"), `${JSON.stringify(report, null, 2)}\n`);
}
