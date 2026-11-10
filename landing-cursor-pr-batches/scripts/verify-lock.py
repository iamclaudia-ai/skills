#!/usr/bin/env python3
"""Check that the regenerated pnpm-lock.yaml still carries every merged PR's fix.

Usage: verify-lock.py <work> [PR ...]     (default: every PR in merged-heads.json that touched pnpm-lock.yaml)
For each PR, from its own lockfile diff (the base recorded at merge time .. the head we merged):
  - package@version keys it REMOVED must be absent from the final lockfile (the vulnerable copies stay gone);
  - keys it ADDED must be present, or the package must resolve to that version or higher.
LOCKFILE=path overrides the file checked. Mutation-test it once per batch: LOCKFILE=<main's lockfile> must
fail every PR, or the check is vacuous.
A "missing" for a package whose only consumer was deleted on main (an app removal) is expected.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import load_records, lock_package_keys, show, version_tuple

work = sys.argv[1]
wanted = {int(arg) for arg in sys.argv[2:]}
records = load_records(work)
final = lock_package_keys(open(os.environ.get("LOCKFILE", "pnpm-lock.yaml")).read())
final_by_name = {}
for name, version in final:
    final_by_name.setdefault(name, []).append(version)

problems = checked = 0
for number in sorted(wanted or records):
    if number not in records:
        sys.exit(f"#{number} has no record in merged-heads.json: merge it with merge-heads.py first")
    head, base = records[number]["head"], records[number]["base"]
    before, after = lock_package_keys(show(base, "pnpm-lock.yaml")), lock_package_keys(show(head, "pnpm-lock.yaml"))
    if before == after:
        continue
    checked += 1
    removed, added = before - after, after - before
    still_present = sorted(f"{name}@{version}" for name, version in removed if (name, version) in final)
    missing = [f"{name}@{version} (final has {sorted(final_by_name.get(name, []))})"
               for name, version in sorted(added)
               if (name, version) not in final
               and not any(version_tuple(other) >= version_tuple(version) for other in final_by_name.get(name, []))]
    status = "ok" if not still_present and not missing else "CHECK"
    problems += status != "ok"
    print(f"#{number} {status}: removed {len(removed)}, added {len(added)}")
    for entry in still_present:
        print(f"    still present (PR removed it): {entry}")
    for entry in missing:
        print(f"    missing (PR added it): {entry}")
print(f"\n{checked} lockfile PRs checked, {problems} need a look")
sys.exit(1 if problems else 0)
