// Lockfile parsing for the weekly sweep. Every reader takes the lockfile's
// *text* (read with `git show origin/<branch>:<file>`), so a scan never touches
// a working copy that might hold uncommitted work.

export type PackageManager = "bun" | "pnpm" | "npm";

export interface DirectDependency {
  name: string;
  /** Exact locked version. */
  version: string;
  /** Workspace path ("" for the root) that declares it. */
  workspace: string;
  dev: boolean;
}

export interface LockfileContents {
  manager: PackageManager;
  /** Every locked package, transitives included: name -> versions. */
  all: Map<string, Set<string>>;
  direct: DirectDependency[];
}

export const LOCKFILES: Array<[string, PackageManager]> = [
  ["bun.lock", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
];

/** Plain registry versions only; skips workspace:, link:, git and file deps. */
const REGISTRY_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function add(all: Map<string, Set<string>>, name: string, version: string): void {
  if (!REGISTRY_VERSION.test(version)) return;
  let versions = all.get(name);
  if (!versions) all.set(name, (versions = new Set()));
  versions.add(version);
}

/** `name@version` -> [name, version], scoped names included. */
function splitSpec(spec: string): [string, string] | null {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  return [spec.slice(0, at), spec.slice(at + 1)];
}

type Section = Record<string, Record<string, string> | undefined>;
const DEP_FIELDS: Array<[string, boolean]> = [
  ["dependencies", false],
  ["optionalDependencies", false],
  ["devDependencies", true],
];

// ── Bun ──────────────────────────────────────────────────────

function parseBun(text: string): LockfileContents {
  // bun.lock is JSON with trailing commas.
  const lock = JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as {
    workspaces: Record<string, Section & { name?: string }>;
    packages: Record<string, [string, ...unknown[]]>;
  };
  const all = new Map<string, Set<string>>();
  for (const entry of Object.values(lock.packages)) {
    const parsed = splitSpec(entry[0]);
    if (parsed) add(all, parsed[0], parsed[1]);
  }

  const direct: DirectDependency[] = [];
  for (const [workspace, ws] of Object.entries(lock.workspaces)) {
    for (const [field, dev] of DEP_FIELDS) {
      for (const name of Object.keys(ws[field] ?? {})) {
        // A workspace-specific resolution is keyed "<workspace name>/<dep>".
        const entry = lock.packages[`${ws.name}/${name}`] ?? lock.packages[name];
        const parsed = entry ? splitSpec(entry[0]) : null;
        if (parsed && REGISTRY_VERSION.test(parsed[1])) {
          direct.push({ name, version: parsed[1], workspace, dev });
        }
      }
    }
  }
  return { manager: "bun", all, direct };
}

// ── npm ──────────────────────────────────────────────────────

function parseNpm(text: string): LockfileContents {
  const lock = JSON.parse(text) as {
    packages: Record<string, { version?: string; link?: boolean; name?: string } & Section>;
  };
  const all = new Map<string, Set<string>>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.link || !entry.version) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    add(all, name, entry.version);
  }

  const direct: DirectDependency[] = [];
  for (const [workspace, entry] of Object.entries(lock.packages)) {
    // The root ("") and workspace members (no node_modules/ in the path).
    if (workspace.includes("node_modules/")) continue;
    for (const [field, dev] of DEP_FIELDS) {
      for (const name of Object.keys(entry[field] ?? {})) {
        const nested = workspace ? lock.packages[`${workspace}/node_modules/${name}`] : undefined;
        const version = (nested ?? lock.packages[`node_modules/${name}`])?.version;
        if (version && REGISTRY_VERSION.test(version)) {
          direct.push({ name, version, workspace, dev });
        }
      }
    }
  }
  return { manager: "npm", all, direct };
}

// ── pnpm ─────────────────────────────────────────────────────

function parsePnpm(text: string): LockfileContents {
  const lock = Bun.YAML.parse(text) as {
    importers?: Record<string, Record<string, Record<string, { version: string }> | undefined>>;
    packages?: Record<string, unknown>;
  };
  const all = new Map<string, Set<string>>();
  for (const key of Object.keys(lock.packages ?? {})) {
    // v9: "name@1.2.3"; v6: "/name@1.2.3". Peer suffixes "(react@19)" dropped.
    const parsed = splitSpec(key.replace(/^\//, "").replace(/\(.*$/, ""));
    if (parsed) add(all, parsed[0], parsed[1]);
  }

  const direct: DirectDependency[] = [];
  for (const [importer, sections] of Object.entries(lock.importers ?? {})) {
    for (const [field, dev] of DEP_FIELDS) {
      for (const [name, dep] of Object.entries(sections[field] ?? {})) {
        const version = dep.version.replace(/\(.*$/, "");
        if (REGISTRY_VERSION.test(version)) {
          direct.push({ name, version, workspace: importer === "." ? "" : importer, dev });
        }
      }
    }
  }
  return { manager: "pnpm", all, direct };
}

export function parseLockfile(manager: PackageManager, text: string): LockfileContents {
  if (manager === "bun") return parseBun(text);
  if (manager === "pnpm") return parsePnpm(text);
  return parseNpm(text);
}
