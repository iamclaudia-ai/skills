#!/usr/bin/env bash
# Which workspace projects reach each package through PRODUCTION dependencies? Empty = dev/build/test only.
# Usage: prod-reach.sh <PR:package> [PR:package ...]     run from a pnpm workspace root with node_modules installed
# Coarse: apps that list build tools (e.g. @remix-run/dev) under dependencies show them as prod. Use it to
# sort a batch into groups, then confirm each package's real surface from the review facts.
set -u
for pair in "$@"; do
  number=${pair%%:*}; package=${pair#*:}
  projects=$(pnpm why "$package" -r --prod --json 2>/dev/null | node -e '
    let input = ""; process.stdin.on("data", chunk => input += chunk).on("end", () => {
      try {
        const data = JSON.parse(input || "[]");
        const names = new Set();
        const walk = node => { if (node.depField) names.add(node.name); (node.dependents || []).forEach(walk); };
        (Array.isArray(data) ? data : [data]).forEach(walk);
        console.log([...names].sort().join(","));
      } catch (error) { console.log("PARSE_ERROR"); }
    });')
  echo "$number $package prod:[${projects}]"
done
