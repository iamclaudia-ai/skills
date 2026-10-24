// npm registry lookups for the sweep: latest versions, publish ages, and
// advisories for every locked package. Results are cached for the whole run,
// so a dependency shared by several repos is fetched once.

import type { DirectDependency } from "./lockfiles";

export interface Advisory {
  name: string;
  version: string;
  id: string;
  title: string;
  severity: "critical" | "high" | "moderate" | "low" | "info";
  url: string;
  vulnerableVersions: string;
}

export type UpdateKind = "safe" | "breaking";

export interface Update {
  name: string;
  from: string;
  to: string;
  kind: UpdateKind;
  /** Days since `to` was published. */
  ageDays: number;
  /** True while `to` is younger than the release-age window. */
  cooling: boolean;
  workspaces: string[];
  dev: boolean;
}

type Packument = {
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
};

const packuments = new Map<string, Promise<Packument | null>>();

function packument(name: string): Promise<Packument | null> {
  let cached = packuments.get(name);
  if (!cached) {
    cached = fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, {
      // The abbreviated document omits `time`, so ask for the full one.
      headers: { accept: "application/json" },
    })
      .then((res) => (res.ok ? (res.json() as Promise<Packument>) : null))
      .catch(() => null);
    packuments.set(name, cached);
  }
  return cached;
}

const SEVERITY_RANK = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 } as const;

/** Every advisory affecting a locked version, most severe first. */
export async function findAdvisories(all: Map<string, Set<string>>): Promise<Advisory[]> {
  const body: Record<string, string[]> = {};
  for (const [name, versions] of all) body[name] = [...versions];

  const found: Advisory[] = [];
  const names = Object.keys(body);
  // The bulk endpoint takes the whole tree, but keep requests a sane size.
  for (let i = 0; i < names.length; i += 400) {
    const chunk = Object.fromEntries(names.slice(i, i + 400).map((n) => [n, body[n]]));
    const res = await fetch("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`advisory lookup failed: HTTP ${res.status}`);
    const result = (await res.json()) as Record<
      string,
      Array<{ url: string; title: string; severity: Advisory["severity"]; vulnerable_versions: string }>
    >;
    for (const [name, advisories] of Object.entries(result)) {
      for (const advisory of advisories) {
        for (const version of body[name]) {
          if (!Bun.semver.satisfies(version, advisory.vulnerable_versions)) continue;
          found.push({
            name,
            version,
            id: advisory.url.split("/").pop() ?? advisory.url,
            title: advisory.title,
            severity: advisory.severity,
            url: advisory.url,
            vulnerableVersions: advisory.vulnerable_versions,
          });
        }
      }
    }
  }
  return found.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Semver-breaking: a new major, or a new minor (patch) on 0.x (0.0.x). */
export function isBreaking(from: string, to: string): boolean {
  const [fMajor, fMinor, fPatch] = from.split(/[.-]/).map(Number);
  const [tMajor, tMinor, tPatch] = to.split(/[.-]/).map(Number);
  if (fMajor !== tMajor) return true;
  if (fMajor === 0 && fMinor !== tMinor) return true;
  if (fMajor === 0 && fMinor === 0 && fPatch !== tPatch) return true;
  return false;
}

/** Direct dependencies with a newer `latest`, one entry per name and locked version. */
export async function findUpdates(direct: DirectDependency[], windowDays: number): Promise<Update[]> {
  const grouped = new Map<string, { dep: DirectDependency; workspaces: Set<string>; dev: boolean }>();
  for (const dep of direct) {
    const key = `${dep.name}@${dep.version}`;
    const group = grouped.get(key);
    if (group) {
      group.workspaces.add(dep.workspace || ".");
      group.dev &&= dep.dev;
    } else {
      grouped.set(key, { dep, workspaces: new Set([dep.workspace || "."]), dev: dep.dev });
    }
  }

  const now = Date.now();
  const updates = await Promise.all(
    [...grouped.values()].map(async ({ dep, workspaces, dev }): Promise<Update | null> => {
      const doc = await packument(dep.name);
      const latest = doc?.["dist-tags"]?.latest;
      // Prerelease pins (nightlies, dev builds) track their own channel.
      if (!latest || dep.version.includes("-")) return null;
      if (Bun.semver.order(latest, dep.version) <= 0) return null;
      const published = doc?.time?.[latest];
      const ageDays = published ? (now - Date.parse(published)) / 864e5 : Number.POSITIVE_INFINITY;
      return {
        name: dep.name,
        from: dep.version,
        to: latest,
        kind: isBreaking(dep.version, latest) ? "breaking" : "safe",
        ageDays: Math.round(ageDays * 10) / 10,
        cooling: ageDays < windowDays,
        workspaces: [...workspaces].sort(),
        dev,
      };
    }),
  );
  return updates
    .filter((u): u is Update => u !== null)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
