#!/usr/bin/env bun
/**
 * Delete Docker containers, images, volumes and networks I created for testing,
 * after checking that each one is mine and unused (dcg only stops `docker rm -f`).
 *
 * What I create carries the label `claudia.scratch=true` (`docker build --label`,
 * `docker run --label`; containers inherit their image's labels). Older leftovers
 * without the label can still be named or matched by prefix.
 *
 * Never touched, whatever the selection:
 *   - anything belonging to a compose project (Michael's stacks)
 *   - a running container, unless it carries my label and --stop is given
 *   - an image any surviving container uses
 *   - a pulled (registry) image, unless it carries my label or --pulled is given
 *   - volumes and networks without my label
 * Images are removed by tag, never forced, so a tag sharing the same image ID survives.
 *
 * Usage:
 *   delete.ts [--mine] [--prefix <p>]... [<name>...] [--stop] [--pulled] [--dry-run]
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LABEL = "claudia.scratch";
const COMPOSE = "com.docker.compose.project";
const LOG = join(homedir(), ".local", "state", "deleting-docker-resources", "deleted.txt");

interface Options {
  mine: boolean;
  prefixes: string[];
  names: string[];
  stop: boolean;
  pulled: boolean;
  dryRun: boolean;
}

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage: delete [--mine] [--prefix <p>]... [<name>...] [--stop] [--pulled] [--dry-run]",
      "",
      `  --mine          select every container, image, volume and network labelled ${LABEL}=true`,
      "  --prefix <p>    select containers whose name, and images whose repository, starts with <p>",
      "  <name>          a container name or ID, or an image repo:tag (repo alone means repo:latest)",
      "  --stop          stop running containers first (only ones carrying my label)",
      "  --pulled        allow deleting unlabelled images that came from a registry",
      "  --dry-run       report what would be deleted, delete nothing",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { mine: false, prefixes: [], names: [], stop: false, pulled: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--mine":
        opts.mine = true;
        break;
      case "--prefix": {
        const value = argv[++i];
        if (!value) usage("--prefix needs a value");
        opts.prefixes.push(value);
        break;
      }
      case "--stop":
        opts.stop = true;
        break;
      case "--pulled":
        opts.pulled = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        usage();
      default:
        if (arg.startsWith("-")) usage(`unknown option ${arg}`);
        opts.names.push(arg);
    }
  }
  if (!opts.mine && opts.prefixes.length === 0 && opts.names.length === 0) {
    usage("pass --mine, a --prefix, or at least one name");
  }
  if (opts.prefixes.some((p) => p.length < 3)) usage("a --prefix must be at least 3 characters");
  return opts;
}

function docker(args: string[]): { ok: boolean; out: string; err: string } {
  const proc = Bun.spawnSync(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: proc.exitCode === 0, out: proc.stdout.toString().trim(), err: proc.stderr.toString().trim() };
}

function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

function inspect<T>(kind: string, ids: string[]): T[] {
  if (ids.length === 0) return [];
  const result = docker([kind, "inspect", ...ids]);
  if (!result.ok) throw new Error(`docker ${kind} inspect failed: ${result.err}`);
  return JSON.parse(result.out) as T[];
}

type Labels = Record<string, string> | null;

interface Container {
  Id: string;
  Name: string;
  Image: string;
  Config: { Image: string; Labels: Labels };
  State: { Status: string };
}

interface Image {
  Id: string;
  RepoTags: string[] | null;
  RepoDigests: string[] | null;
  Config: { Labels: Labels } | null;
  Created: string;
  Size: number;
}

interface Volume {
  Name: string;
  Labels: Labels;
}

interface Network {
  Id: string;
  Name: string;
  Labels: Labels;
  Containers: Record<string, unknown> | null;
}

const mine = (labels: Labels) => labels?.[LABEL] === "true";
const compose = (labels: Labels) => labels?.[COMPOSE];

function listContainers(): Container[] {
  return inspect<Container>("container", lines(docker(["ps", "-aq", "--no-trunc"]).out));
}

function listImages(): Image[] {
  const ids = [...new Set(lines(docker(["image", "ls", "-q", "--no-trunc"]).out))];
  return inspect<Image>("image", ids);
}

function record(kind: string, name: string, id: string, reason: string, extra: string): void {
  const dir = dirname(LOG);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const fields = [kind, name, id, reason.replace(/\s+/g, "_"), extra.replace(/\s+/g, "_"), new Date().toISOString()];
  appendFileSync(LOG, `${fields.join(" ")}\n`);
}

function normalizeTag(name: string): string {
  const lastSegment = name.slice(name.lastIndexOf("/") + 1);
  return lastSegment.includes(":") ? name : `${name}:latest`;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!docker(["version", "--format", "{{.Server.Version}}"]).ok) {
    console.error("Error: the Docker daemon is not reachable");
    process.exit(1);
  }

  const prefix = opts.dryRun ? "[dry run] " : "";
  let deleted = 0;
  let skipped = 0;
  const skip = (what: string, why: string) => {
    console.log(`  skip    ${what}: ${why}`);
    skipped++;
  };
  const done = (what: string, reason: string) => {
    console.log(`  ${opts.dryRun ? "would delete" : "deleted"} ${what} (${reason})`);
    deleted++;
  };
  const named = new Set(opts.names);
  const matchedNames = new Set<string>();

  // Containers first, so the images they used can go in the same run.
  console.log(`${prefix}containers`);
  const containers = listContainers();
  const removedContainers = new Set<string>();
  for (const c of containers) {
    const name = c.Name.replace(/^\//, "");
    const byName = named.has(name) || named.has(c.Id) || [...named].some((n) => n.length >= 12 && c.Id.startsWith(n));
    const byPrefix = opts.prefixes.some((p) => name.startsWith(p));
    const labelled = mine(c.Config.Labels);
    if (!(byName || byPrefix || (opts.mine && labelled))) continue;
    if (byName) matchedNames.add(named.has(name) ? name : [...named].find((n) => c.Id.startsWith(n))!);

    const what = `container ${name} (${c.Config.Image})`;
    const project = compose(c.Config.Labels);
    if (project) {
      skip(what, `belongs to compose project "${project}"`);
      continue;
    }
    const active = ["running", "paused", "restarting"].includes(c.State.Status);
    if (active && !(labelled && opts.stop)) {
      skip(what, labelled ? `${c.State.Status} (--stop to stop it first)` : `${c.State.Status}, and not labelled ${LABEL}`);
      continue;
    }
    const reason = labelled ? `labelled ${LABEL}` : byName ? "named" : "prefix match";
    if (!opts.dryRun) {
      if (active) {
        const stopped = docker(["stop", c.Id]);
        if (!stopped.ok) {
          skip(what, `docker stop failed: ${stopped.err}`);
          continue;
        }
      }
      const result = docker(["container", "rm", c.Id]);
      if (!result.ok) {
        skip(what, `docker refused: ${result.err}`);
        continue;
      }
      record("container", name, c.Id, reason, c.Config.Image);
    }
    removedContainers.add(c.Id);
    done(what, reason);
  }

  console.log(`${prefix}images`);
  // Image IDs still used by a container that survives this run.
  const inUse = new Map<string, string>();
  for (const c of containers) {
    if (!removedContainers.has(c.Id)) inUse.set(c.Image, c.Name.replace(/^\//, ""));
  }
  for (const img of listImages()) {
    const labelled = mine(img.Config?.Labels ?? null);
    const tags = (img.RepoTags ?? []).filter((t) => t !== "<none>:<none>");
    const selected = tags.filter((tag) => {
      const repo = tag.slice(0, tag.lastIndexOf(":"));
      const hit = named.has(tag) || [...named].some((n) => normalizeTag(n) === tag);
      if (hit) matchedNames.add([...named].find((n) => n === tag || normalizeTag(n) === tag)!);
      return hit || opts.prefixes.some((p) => repo.startsWith(p)) || (opts.mine && labelled);
    });
    // A dangling image of mine has no tag to remove it by, so use its ID.
    const targets = selected.length > 0 ? selected : opts.mine && labelled && tags.length === 0 ? [img.Id] : [];
    if (targets.length === 0) continue;

    const short = img.Id.replace(/^sha256:/, "").slice(0, 12);
    const project = compose(img.Config?.Labels ?? null);
    const user = inUse.get(img.Id);
    const pulled = (img.RepoDigests ?? []).length > 0;
    for (const target of targets) {
      const what = `image ${target === img.Id ? `<none> ${short}` : target} (${short}, ${(img.Size / 1e6).toFixed(0)}MB)`;
      if (project) {
        skip(what, `belongs to compose project "${project}"`);
        continue;
      }
      if (user) {
        skip(what, `used by container ${user}`);
        continue;
      }
      if (pulled && !labelled && !opts.pulled) {
        skip(what, "pulled from a registry (--pulled to delete it anyway)");
        continue;
      }
      const reason = labelled ? `labelled ${LABEL}` : named.has(target) ? "named" : "prefix match";
      if (!opts.dryRun) {
        const result = docker(["image", "rm", target]);
        if (!result.ok) {
          skip(what, `docker refused: ${result.err}`);
          continue;
        }
        record("image", target, img.Id, reason, `created=${img.Created}`);
      }
      done(what, reason);
    }
  }

  // Volumes and networks hold state or wiring, so only labelled ones are ever selected.
  if (opts.mine) {
    console.log(`${prefix}volumes`);
    const volumeNames = lines(docker(["volume", "ls", "-q", "--filter", `label=${LABEL}=true`]).out);
    for (const v of inspect<Volume>("volume", volumeNames)) {
      const what = `volume ${v.Name}`;
      if (compose(v.Labels)) {
        skip(what, `belongs to compose project "${compose(v.Labels)}"`);
        continue;
      }
      const users = lines(docker(["ps", "-aq", "--filter", `volume=${v.Name}`]).out).filter(
        (id) => ![...removedContainers].some((removed) => removed.startsWith(id)),
      );
      if (users.length > 0) {
        skip(what, `used by ${users.length} container(s)`);
        continue;
      }
      if (!opts.dryRun) {
        const result = docker(["volume", "rm", v.Name]);
        if (!result.ok) {
          skip(what, `docker refused: ${result.err}`);
          continue;
        }
        record("volume", v.Name, v.Name, `labelled ${LABEL}`, "");
      }
      done(what, `labelled ${LABEL}`);
    }

    console.log(`${prefix}networks`);
    const networkIds = lines(docker(["network", "ls", "-q", "--filter", `label=${LABEL}=true`]).out);
    for (const n of inspect<Network>("network", networkIds)) {
      const what = `network ${n.Name}`;
      if (compose(n.Labels)) {
        skip(what, `belongs to compose project "${compose(n.Labels)}"`);
        continue;
      }
      if (!opts.dryRun) {
        const result = docker(["network", "rm", n.Id]);
        if (!result.ok) {
          skip(what, `docker refused: ${result.err}`);
          continue;
        }
        record("network", n.Name, n.Id, `labelled ${LABEL}`, "");
      }
      done(what, `labelled ${LABEL}`);
    }
  }

  for (const name of named) {
    if (!matchedNames.has(name)) skip(name, "no container or image by that name");
  }

  const verb = opts.dryRun ? "would delete" : "deleted";
  const logged = deleted && !opts.dryRun ? ` Logged in ${LOG}` : "";
  console.log(`\n${verb} ${deleted}, skipped ${skipped}.${logged}`);
}

main();
