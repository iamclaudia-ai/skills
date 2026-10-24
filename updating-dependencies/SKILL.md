---
name: updating-dependencies
description: "MUST be used for the weekly dependency sweep, and whenever a session is started to update a repo's dependencies from a sweep report. Discovers Michael's active personal repos (never beehiiv work repos), scans each lockfile on the remote default branch for advisories and outdated packages, and opens PRs: one batch PR of security fixes and safe (patch/minor) updates first, then one PR per breaking upgrade group, last and separately. Closing a breaking PR unmerged defers it. Triggers on: weekly dependency sweep, deps sweep, dependency sweep report, update dependencies weekly, scheduled dependency updates, dependency PRs, breaking upgrade PR, major version upgrade, safe updates batch, renovate, dependabot alternative, defer an upgrade, refresh dependency PR, sweep all repos."
---

# Updating Dependencies

The weekly routine for keeping Michael's personal repos current. A scheduled
scan finds the work; one Anima session per repo does it and opens PRs for
Michael to review. Security triage techniques live in the
`auditing-dependencies` skill. Load it alongside this one.

## When to Use

- You were started by the sweep with a report path (the usual case)
- Michael asks to run the sweep, or to sweep one repo now
- Refreshing or rebasing an open `deps/*` PR

## Available Commands

- **`sweep [--dry-run] [--only <substring>]`**: discover repos, scan, write
  reports to `~/.anima/tasks/deps-sweep/<date>/` (one `.md` + `.json` per repo,
  plus `SUMMARY.md`), and start one session per actionable repo, at most
  `maxConcurrentSessions` at a time. `--dry-run` writes reports and starts
  nothing. `--only` matches the GitHub slug (`owner/name`) or the local path.

```bash
anima skills run updating-dependencies sweep --dry-run
anima skills run updating-dependencies sweep --only iamclaudia-ai/ripply
```

Config: `~/.anima/deps-sweep.json` (created with defaults on first run):
`roots`, `exclude` (beehiiv is excluded: work repos belong to the security
team), `owners`, `activeWithinDays`, `include`/`skip` (absolute paths),
`windowDays`, `maxConcurrentSessions`, `maxBreakingPrsPerRun`.

A repo is swept when its GitHub origin belongs to one of `owners`, it is not
a fork or archived, and it had a commit within `activeWithinDays`. PRs need
iamclaudia-ai to have write access. Otherwise the repo is report-only.

## The Session Playbook

You are unattended. Never ask questions: take the conservative option and
explain it in the PR body. Follow the repo's own CLAUDE.md conventions.

### Rules that never bend

- **Never touch the main working copy.** It may hold Michael's uncommitted
  work. Work only in a worktree.
- **Never push to the default branch, and never force-push.** To refresh a PR
  branch, merge the base into it instead of rebasing.
- **Branch names are the contract.** Breaking PRs use the exact `branch` from
  the report: deferral works by matching closed-PR branch names.
- **Respect the release-age window.** Do not exempt anything except a
  security fix, by exact version, as `auditing-dependencies` describes.

### 1. Set up

1. Read the report (`.md` for you, `.json` for exact values).
2. `git -C <repo> fetch origin`
3. Safe branch: if the report lists an open `deps/sweep-*` PR, reuse its
   branch and merge `origin/<default>` into it. Otherwise create
   `deps/sweep-<date>`:
   `git -C <repo> worktree add <repo>.worktrees/deps-<date> -b deps/sweep-<date> origin/<default>`
4. Install in the worktree with the repo's package manager (`bun install`,
   `pnpm install --frozen-lockfile`, `npm ci`). It must pass before you change
   anything. If it doesn't, stop and report why in your final message.

### 2. Safe batch PR (first)

1. **No release-age window in the repo?** Add one as the first commit
   (see `auditing-dependencies` step 2).
2. **Security:** fix the report's advisories (`bun audit fix`, parent
   upgrades, overrides with a reachability check), as in `auditing-dependencies`
   steps 3 to 5.
3. **Safe updates:** apply the report's safe list. Skip anything still
   cooling: the package manager enforces the window, so let it.
4. **Verify** with everything the repo has: install, typecheck, lint, the full
   test suite, and the build. Smoke-test native packages.
5. **An update breaks something?** Drop that one update (revert it), keep the
   rest, and list it under "Held back" with the reason. Never ship red.
6. Commit with conventional messages, push, and open the PR:
   - Title: `chore(deps): weekly dependency sweep <date>`
   - Body: a table of security fixes (package, from → to, GHSA, severity),
     safe updates, anything held back with reasons, what is cooling until next
     week, and the exact verification commands you ran.

### 3. Breaking PRs (last, one per group)

Take the report's breaking groups with status `new` that are not cooling, at
most `maxBreakingPrsPerRun`. Order: groups that fix an advisory first, then
runtime dependencies over dev tooling, then older releases (more mature)
first. Skip `open-pr` groups (refresh them instead, step 4) and `deferred` ones.

For each group:

1. Branch `<report branch>` from the safe branch, so the PR stacks on the
   safe batch (base = the safe branch; if no safe PR was opened this run, base
   = the default branch). Use its own worktree.
2. Read the breaking changes: GitHub releases (`gh release list/view -R
   owner/repo`), the CHANGELOG or migration guide in the package, or the docs.
3. Upgrade every member of the group together, migrate the code, verify fully.
4. Can't get it green in reasonable effort? Push it anyway and open it as a
   **draft**, saying what's done and what's left.
5. PR title `chore(deps)!: upgrade <family> to v<line>`. Body: the breaking
   changes that matter here, the code changes made, verification, risk, and
   this line: _"Close this PR without merging to defer <family> v<line>. The
   sweep skips it until a newer line ships."_

### 4. Refresh open sweep PRs

For each open `deps/*` PR in the report: `gh pr view <n> --json mergeable`. If
it conflicts, merge its base into it, resolve lockfile conflicts by taking the
base lockfile and reinstalling the PR's target versions, verify, and push. Note
the refresh in a PR comment.

### 5. Finish

- `git -C <repo> worktree remove <worktree>` for each worktree (branches stay
  on the remote).
- Final message: one short list of PR links (safe batch first), what was held
  back or deferred, and anything Michael needs to decide. Michael reads this in
  the session, so make it the summary he'd want with his coffee.

## Ecosystem notes

- **Expo:** never bump `expo-*` packages one by one. An SDK upgrade is one PR
  (`expo` group): `npx expo install expo@^<line>` then `npx expo install --fix`
  and `npx expo-doctor`. Put `jest-expo` in the same PR even though it has its
  own group in the report.
- **`@types/vscode`** must not exceed the `engines.vscode` range, or packaging
  the extension fails. Hold it back and say why.
- **`@types/node`** should match the Node major the project runs on
  (`.tool-versions`, `.nvmrc`, `engines`). Hold back a newer major.
- **Formatter or linter bumps** reformat files. Keep that diff in its own
  commit, so the review stays readable.
- **Monorepos with catalogs** (Bun): bump the catalog entry, not each workspace.

## Notes

- The sweep scans `origin/<default>` with `git show`, so it sees what is
  merged, not local work in progress.
- Advisories come from the npm bulk advisory endpoint, the same source as
  `bun audit`, so they cover transitive packages too.
- "Breaking" is semver's definition: a new major, or a new minor on 0.x.
- Grouping: a scope is a family (`@jest/globals` joins `jest`). An unscoped
  name joins its prefix only when the prefix itself is moving to the same line
  (`expo` anchors `expo-router`).
- Non-JS ecosystems (CocoaPods, Gradle, Go, Cargo, Python, Ruby) are listed in
  the report under "Not covered". Audit those by hand with `auditing-dependencies`.
- The scheduled task: Sunday 07:00, so the PRs are waiting by 10. See
  `anima scheduler list_tasks --tags deps`.
