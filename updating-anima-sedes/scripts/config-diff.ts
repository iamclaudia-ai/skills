#!/usr/bin/env bun
/**
 * Compare this machine's anima.json with another machine's, by key path.
 *
 * Both sides run config-keys.ts (the remote one over ssh, from its own copy of
 * the skills repo), so no secret value ever crosses the wire or lands in a
 * transcript. Lines only here are `<`, lines only there are `>`.
 *
 * Usage: config-diff.ts <ssh-host>
 */

import { homedir } from "node:os";
import { join } from "node:path";

const host = process.argv[2];
if (!host) {
  console.error("Usage: config-diff <ssh-host>   (e.g. anima-sedes)");
  process.exit(1);
}

const script = join(import.meta.dir, "config-keys.ts");
const local = Bun.spawnSync(["bun", script], { stdout: "pipe", stderr: "pipe" });
if (local.exitCode !== 0) {
  console.error(local.stderr.toString());
  process.exit(1);
}

const remoteScript = "~/Projects/iamclaudia-ai/skills/updating-anima-sedes/scripts/config-keys.ts";
const remote = Bun.spawnSync(["ssh", host, `~/.bun/bin/bun ${remoteScript}`], {
  stdout: "pipe",
  stderr: "pipe",
});
if (remote.exitCode !== 0) {
  console.error(`ssh ${host} failed: ${remote.stderr.toString().trim()}`);
  console.error("Is the skills repo cloned there? Run the update on that host first.");
  process.exit(1);
}

const here = new Set(local.stdout.toString().trim().split("\n"));
const there = new Set(remote.stdout.toString().trim().split("\n"));
const onlyHere = [...here].filter((k) => !there.has(k));
const onlyThere = [...there].filter((k) => !here.has(k));

const me = homedir().split("/").pop();
console.log(`< ${me} (here)   > ${host}\n`);
if (!onlyHere.length && !onlyThere.length) {
  console.log("Identical key sets.");
  process.exit(0);
}
for (const k of onlyHere) console.log(`< ${k}`);
for (const k of onlyThere) console.log(`> ${k}`);
