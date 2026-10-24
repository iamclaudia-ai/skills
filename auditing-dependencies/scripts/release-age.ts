#!/usr/bin/env bun
// Print how long ago each npm package version was published, whether it falls
// inside a release-age window, and (optionally) the ranges it declares for
// chosen dependencies — the quickest way to tell whether a newer parent
// release unblocks a vulnerable transitive.
//
// Usage: release-age.ts [--window-days N] [--deps a,b,c] <name@version|name@latest>...

type Packument = {
  "dist-tags": Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<string, { dependencies?: Record<string, string> }>;
};

const argv = process.argv.slice(2);
let windowDays = 3;
let watch = new Set<string>();
const specs: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--window-days") windowDays = Number(argv[++i]);
  else if (arg === "--deps") watch = new Set(argv[++i].split(",").filter(Boolean));
  else specs.push(arg);
}
if (specs.length === 0 || Number.isNaN(windowDays)) {
  console.error("usage: release-age.ts [--window-days N] [--deps a,b] <name@version|name@latest>...");
  process.exit(2);
}

const now = Date.now();
console.log(["package", "age", "window", "latest", "deps"].join("\t"));
for (const spec of specs) {
  const at = spec.lastIndexOf("@");
  if (at <= 0) {
    console.log(`${spec}\t?\tbad spec (expected name@version)`);
    continue;
  }
  const name = spec.slice(0, at);
  const requested = spec.slice(at + 1);
  const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
  if (!res.ok) {
    console.log(`${spec}\t?\tregistry ${res.status}`);
    continue;
  }
  const doc = (await res.json()) as Packument;
  const latest = doc["dist-tags"].latest;
  const version = doc["dist-tags"][requested] ?? requested;
  const published = doc.time?.[version];
  if (!published) {
    console.log(`${name}@${version}\t?\tno such version\t${latest}`);
    continue;
  }
  const days = (now - Date.parse(published)) / 864e5;
  const gate = days < windowDays ? `BLOCKED (<${windowDays}d)` : "ok";
  const deps = Object.entries(doc.versions?.[version]?.dependencies ?? {})
    .filter(([dep]) => watch.has(dep))
    .map(([dep, range]) => `${dep}@${range}`)
    .join(" ");
  console.log(`${name}@${version}\t${days.toFixed(1)}d\t${gate}\t${latest}\t${deps}`);
}
