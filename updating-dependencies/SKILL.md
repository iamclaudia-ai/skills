---
name: updating-dependencies
description: "MUST be used for the weekly dependency sweep, and whenever a session is started to update a repo's dependencies from a sweep report. Discovers Michael's active personal repos (never beehiiv work repos), scans each lockfile on the remote default branch for advisories and outdated packages, and opens PRs: one batch PR of security fixes and safe (patch/minor) updates first, then one PR per breaking upgrade group, each stacked on the batch with gh-stack. Closing a breaking PR unmerged defers it. Triggers on: weekly dependency sweep, deps sweep, dependency sweep report, update dependencies weekly, scheduled dependency updates, dependency PRs, breaking upgrade PR, major version upgrade, safe updates batch, renovate, dependabot alternative, defer an upgrade, refresh dependency PR, stacked dependency PRs, sweep all repos, merge the dependency PRs, land the sweep, merge deps PRs."
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
- Merging (landing) a sweep's stacked PRs (step 6)

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
`windowDays`, `maxConcurrentSessions`, `maxBreakingPrsPerRun`, `homebrew`.

**Homebrew** (`homebrew: true`, skipped with `--only`): the sweep also runs
`auditing-dependencies brew` on this machine, writes `homebrew.md`/`.json`,
adds a Homebrew section to `SUMMARY.md`, and when something is actionable
starts a read-only "Deps sweep · homebrew" session that writes Michael an
upgrade plan. It never upgrades brew itself: that is machine-wide, and
code-server (his only remote terminal) runs on brew node@22.

A repo is swept when its GitHub origin belongs to one of `owners`, it is not
a fork or archived, and it had a commit within `activeWithinDays`. PRs need
iamclaudia-ai to have write access. Otherwise the repo is report-only.

## The Session Playbook

You are unattended. Never ask questions: take the conservative option and
explain it in the PR body. Follow the repo's own CLAUDE.md conventions.

### Rules that never bend

- **Never touch the main working copy.** It may hold Michael's uncommitted
  work. Work only in a worktree. The exceptions are step 5's `gh-stack add` and
  step 6's `gh-stack delete --keep-branch` cleanup, which only write stack
  metadata under `.git/` and check nothing out.
- **Stack the PRs with `gh-stack`** (load `using-gh-stack`). The safe batch is
  the bottom of the stack, and each breaking PR is a child of it. The repos
  squash merge, so a branch built on a merged PR has to be moved with
  `gh-stack sync`. A plain `git rebase origin/<default>` replays the merged
  PR's original commits, and they conflict with their own squashed copy
  (evolution-mobile #172, 2026-10-25). Landing siblings has its own order
  (step 6).
- **Never push to the default branch, and never force-push by hand.** The
  only force-pushes allowed are the `--force-with-lease` pushes that `gh-stack
  submit`/`sync` make to this sweep's own `deps/*` branches. Never merge the
  base into a branch either: repos like evolution-mobile forbid merge commits.
- **Branch names are the contract.** Breaking PRs use the exact `branch` from
  the report: deferral works by matching closed-PR branch names.
- **Respect the release-age window.** Do not exempt anything except a
  security fix, by exact version, as `auditing-dependencies` describes.

### 1. Set up

1. Read the report (`.md` for you, `.json` for exact values).
2. `git -C <repo> fetch origin`, and `export GH_STACK_YES=1` (gh-stack's
   non-interactive mode).
3. **Look for open PRs that already make these bumps.** The report lists only
   `deps/*` branches, so a hand-made bump (another session's `chore/expo-…`
   branch, say) is invisible to it. Run `gh pr list --state open --json
   number,title,headRefName,files --jq '.[] | select(any(.files[];
   .path|test("package.json|lock"))) | "\(.number) \(.headRefName) \(.title)"'`
   and read each hit's `package.json` diff. Leave out of the safe batch
   anything an open PR already covers, and say so in the body. If an open PR
   covers the whole safe list, open no safe PR at all, and base the breaking
   PRs on the default branch (`gh-stack init --parent <default>`). On
   2026-11-08 evolution-mobile's sweep opened #407, an exact duplicate of
   #394 from the night before, closed it, and had to rebase #408 off it.
   This is a courtesy check, not a gate: deps work normally merges before
   Sunday, and Michael says an occasional duplicate is no big deal. Don't
   spend long on fuzzy overlaps; when unsure, open the PR and name the other
   one in the body.
4. **One worktree for the whole run.** gh-stack keeps its metadata in the
   worktree's own git dir (`.git/worktrees/<name>/.gh-stack`), so every branch
   of the stack has to live in the same worktree. Switch branches inside it.
5. Safe branch: if the report lists an open `deps/sweep-*` PR, reuse its
   branch: `git -C <repo> worktree add <repo>.worktrees/deps-<date>
   <branch>`, then `gh-stack add` and `gh-stack sync` to move it onto the
   default branch. Otherwise create `deps/sweep-<date>`:
   `git -C <repo> worktree add <repo>.worktrees/deps-<date> -b deps/sweep-<date> origin/<default>`,
   then `gh-stack init --parent <default>` inside it.
6. Install in the worktree with the repo's package manager (`bun install`,
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
6. Commit with conventional messages, then push and open the PR with
   `gh-stack submit -t "<title>" --body-file <body>` (add labels afterwards
   with `gh pr edit --add-label`):
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

1. Check out the safe branch, then `gh-stack create <report branch>`. The new
   branch is a child of the safe branch, and of nothing else: every breaking
   PR is a sibling, so closing one to defer it never strands another. (If no
   safe PR was opened this run, `gh-stack init --parent <default>` on the
   new branch instead.) Reinstall after switching branches: `node_modules`
   still holds the last branch's versions.
2. Read the breaking changes: GitHub releases (`gh release list/view -R
   owner/repo`), the CHANGELOG or migration guide in the package, or the docs.
3. Upgrade every member of the group together, migrate the code, verify fully.
4. Can't get it green in reasonable effort? Push it anyway and open it as a
   **draft** (`gh-stack submit -d`), saying what's done and what's left.
5. Open it with `gh-stack submit -t "<title>" --body-file <body>`. Title
   `chore(deps)!: upgrade <family> to v<line>`. Body: the breaking changes
   that matter here, the code changes made, verification, risk, and this line:
   _"Close this PR without merging to defer <family> v<line>. The sweep skips
   it until a newer line ships."_ Do not hand-write the stack: `submit`
   maintains a "Stacked on" footer in every PR body. Still write a merge-order
   line where the repo's conventions want one (evolution-mobile's
   `scripts/my-prs.js` reads "merge after #N").
6. Two siblings that edit the same line (for example, both add an entry to
   `expo.install.exclude`) conflict once the first one merges. Say so in both
   bodies.

### 4. Refresh open sweep PRs

For each open `deps/*` PR in the report: `gh pr view <n> --json mergeable`. If
it conflicts, track it in the run's worktree (`git branch <b> origin/<b>` if
it isn't local, then `gh-stack add <b>`) and run `gh-stack sync`. Sync
rebases it onto its parent, skipping the commits of a parent that was already
squash merged, and pushes with `--force-with-lease`. On a conflict, resolve,
`git add`, `git rebase --continue`, then `gh-stack restack --resume`. For a
lockfile conflict, take the base lockfile and reinstall the PR's target
versions. Verify, and note the refresh in a PR comment.

### 5. Finish

- `git -C <repo> worktree remove <worktree>` (branches stay on the remote and
  locally).
- **Register the stack in Michael's checkout**, so he can land it with
  gh-stack there: from `<repo>`, run `GH_STACK_YES=1 gh-stack add <branch>`
  for each breaking branch, or for the safe branch alone if it has no
  children. It finds the parents from the branches' ancestry, writes only
  metadata, and does not change his current branch or working tree. Confirm
  with `gh-stack stacks --json` that **every branch shows its PR number**.
  Stack files are per worktree, so the PRs reach his checkout through the
  `ghstack-pr` git config the worktree's `submit` wrote, which `add` reads
  (gh-stack ≥ 0.19.6). A `"pr": null` there breaks the landing: `merge --base`
  refuses with "has no PR", and `sync` can't see the safe batch merge, so it
  replays its squashed commits. If you see one, say so in the final message:
  the fix is `gh-stack update-prs` run from a branch of that stack, which you
  must not check out in his working copy. **Never try to repair it with
  `gh-stack delete --keep-branch` + `add`** in his checkout: `delete` wipes the
  branch's `ghstack-pr` config, `add` drops PR numbers that `update-prs`
  adopted elsewhere, and every cycle leaves an empty stack plus a `-2`/`-3`
  suffixed copy behind (gh-stack 0.19.9, kiliman/gh-stack#67; anima sweep
  2026-11-08). Report the `null` and move on: step 6 lands from a fresh
  worktree, where `add` + `update-prs` adopt the numbers anyway. `submit`
  can also miss writing `ghstack-pr` for the last sibling it creates, so check
  `git config --get-regexp 'branch\.deps/.*ghstack-pr'` before registering.
  Even with that config present, `add` can still register the last sibling
  as `"pr": null` (nutwords sweep 2026-11-08: `ghstack-pr 270` was set and
  #270 still came up null after `add`). Same treatment: report it, don't
  repair it in his checkout.
- **How to land it**, for the final message: one line saying the PRs land one
  at a time, safe batch first, and that you can do it when he asks (step 6).
  If he merges on GitHub himself, `gh-stack sync` afterwards moves the
  breaking siblings (gh-stack ≥ 0.19.7), but GitHub's squash subject keeps
  the `(N/M)` that gh-stack adds to PR titles unless he edits it.
- Final message: one short list of PR links (safe batch first), what was held
  back or deferred, and anything Michael needs to decide. Michael reads this in
  the session, so make it the summary he'd want with his coffee.

### 6. Landing the stack (when Michael asks you to merge)

Needs gh-stack ≥ 0.19.8 (`gh-stack --version`). Since 0.19.7, a merged batch
with several breaking siblings gets every sibling re-rooted onto the default
branch, each as its own stack (kiliman/gh-stack#60). Since 0.19.8, gh-stack's
squash commits leave out the `(N/M)` it adds to PR titles (#62). On an older
version, stop and say so rather than landing by hand.

1. **Check before merging.** `gh pr view <n> --json mergeable,mergeStateStatus`
   for each PR, then `git log --stat <old base>..origin/<default>` to see what
   landed since the sweep. If any of it touches a breaking PR's area (a build
   plugin beside a bundler-plugin upgrade, say), that PR gets a targeted check
   at step 4.
2. **Work in a fresh worktree**, never Michael's checkout: `git -C <repo>
   worktree add <repo>.worktrees/land-<date> <safe branch>`, then `gh-stack
   add <b>` for each breaking branch. `gh-stack stacks --json` must show every
   PR number; `gh-stack update-prs` adopts any `"pr": null`. A stack an older
   gh-stack already wedged ("exactly one root branch; found N") is repaired by
   `gh-stack doctor`, which splits it.
3. **Land the safe batch.** On the safe branch, `gh-stack merge --base`. It
   squash-merges the batch, re-roots every breaking sibling onto the default
   branch (pushing each and retargeting its PR), and leaves one stack per
   sibling. If a re-root stops on a conflict: resolve, `git rebase
   --continue`, and re-run `gh-stack merge --base` (not `restack`).
4. **Land each sibling in turn**, advisory fixers first:
   1. Check out the sibling and run `gh-stack sync`, which moves it onto
      whatever merged before it (a no-op for the first). Then `bun install
      --frozen-lockfile`. A text-merged lockfile that no longer matches the
      manifests fails here.
   2. Run the full verify (step 2.4), plus the step-1 targeted check.
   3. `gh-stack merge --base`. Run it as `GH_STACK_YES=1 timeout 300
      gh-stack merge --base > <log> 2>&1 < /dev/null`, from a fresh Bash call.
      Three times on 2026-11-08, the call made right after a long verify hung
      until the tool timeout and the log file was never created: the tmux
      wrapper stuck before the command started. When that happens, check
      `gh pr view <n> --json state` (it was still open each time) and run it
      again. "Could not sync main" at the end is expected: `main` is checked
      out in Michael's working copy.
   4. **A UI dependency (layout, components, CSS) gets a live check before
      it merges**, through the real gateway, not a standalone harness: merge,
      `anima watchdog reload`, then DOMINATRIX `eval` on the page for element
      rects and `document.scrollingElement.scrollHeight`, plus a screenshot.
      Be ready to revert in one commit. dockview v8 (#91) passed a harness
      and every test, then broke `/chat` live (the SPA bundle drops CSS that
      isn't imported through `packages/ui/src/styles/index.css`, plus an
      overlay and theme regression), and was reverted the same hour (anima
      #150).
5. **Expect a lockfile conflict in `sync` from the second sibling on.**
   1. `git checkout --ours bun.lock` (during a rebase, *ours* is the new base)
      and `bun install` to re-resolve this PR's manifest changes on top.
   2. Diff the result against the branch's pre-rebase lockfile. Only packages
      from the siblings that already merged may differ. Trace any other
      changed line before trusting the lockfile.
   3. `git add bun.lock`, `GIT_EDITOR=true git rebase --continue`, then
      `gh-stack restack --resume`.
6. **Clean up.**
   - Remove the worktree.
   - In Michael's checkout, drop the stack registered at step 5 with
     `gh-stack delete --keep-branch`, leaves before the batch. This is
     metadata only.
   - Delete the local `deps/*` branches with the `deleting-local-branches`
     skill, and their remote branches with `git push origin --delete` (merged
     PRs only).
   - Tell him what is now merged but not deployed (the repo's own deploy
     check, e.g. `git log origin/release..origin/main` in nutwords).

## Ecosystem notes

- **anima's root `bun run build` is not an unattended check.** It runs
  `bun run --filter '*' build`, which includes `xcodebuild` (menubar),
  `cargo tauri build` (desktop) and the watchdog's codesign step; it hung past
  10 minutes in the 2026-11-08 sweep. Build the JS workspaces one by one
  instead (`clients/{code-server-bridge,dominatrix,vscode}`, `packages/{ui,shared,cli,gateway}`,
  every `extensions/*` with a `build` script), and run `bun run prepush` by
  hand: `gh-stack submit` pushes don't show the hook's output. The root
  typecheck skips `clients/dominatrix` (#144): run its own `bun run typecheck`
  when a change touches it.
- **Canary tests that pin a dependency's output** (anima's
  `extensions/dominatrix/src/transpile.test.ts` checks Babel's `for..of`
  helper) are meant to fail on a minor bump. Fix the patch so it matches
  the new output's shape, rather than holding the update back.
- **Expo:** never bump `expo-*` packages one by one. An SDK upgrade is one PR
  (`expo` group): `npx expo install expo@^<line>` then `npx expo install --fix`
  and `npx expo-doctor`. Put `jest-expo` in the same PR even though it has its
  own group in the report.
  - In the safe batch, finish with `CI=1 npx expo install --check`. A patch
    that the report calls safe can still be one Expo's table pins exactly
    (`react-native-worklets` 0.13.0 on SDK 58), and taking it would need an
    `expo.install.exclude` entry. Hold it back until Expo's table moves
    (in evolution-mobile that is policy; see below).
  - Run `expo-doctor` and `expo install` with `CI=1`. Without it,
    `npx expo-doctor` sat for over 5 minutes in the unattended run.
  - `--fix` writes `~` ranges back on packages the repo pins exactly (patched
    ones in evolution-mobile): pin them again, then regenerate their patches
    under the new version.
  - Diff the lockfile for packages that were **added**, not just bumped. In
    evolution-mobile, `react-native-nitro-modules` 0.37.1 → 0.37.2 added
    `nitro-core`, a new package with its own native sources, in a patch
    release. A native restructure under the camera stack was held for a
    device pass.
- **evolution-mobile: the root packages drive everything under them**
  (Michael, 2026-11-08). It is a React Native app, and the big packages
  (Expo, React Native, VisionCamera) are tested and supported with the
  versions they bring, so don't run ahead of them:
  - **Track Expo.** Packages in Expo's version table move when Expo moves
    them (`npx expo install --fix`), not before. React and react-dom stay at
    the version React Native's renderer ships with: never bump them alone,
    even for a patch. The same goes for table-pinned packages like
    `react-native-worklets`. The seven `expo.install.exclude` packages are
    the deliberate exceptions, and they move as direct dependencies.
  - **Companions move with their parent.** `react-native-nitro-modules` and
    `react-native-nitro-image` move only with a `react-native-vision-camera`
    bump, at the versions it asks for (and claudia-scan with it, for CameraX;
    see the repo's CLAUDE.md).
  - **Transitive dependencies are left to their parents**, unless the update
    fixes a security issue or a critical bug that reaches us. No overrides to
    bump them otherwise. Report anything held this way under "Held back" so
    it's on record, but it needs no decision from Michael.
  - Direct dependencies outside those groups update normally. In a native
    release (0.10) a native bump can merge when approved.
  - Dev tooling still cooling in the window just waits for next week's sweep.
- **`@types/vscode`** must not exceed the `engines.vscode` range, or packaging
  the extension fails. Hold it back and say why.
- **`@types/node`** should match the Node major the project runs on
  (`.tool-versions`, `.nvmrc`, `engines`). Hold back a newer major.
- **Formatter or linter bumps** reformat files. Keep that diff in its own
  commit, so the review stays readable.
- **Monorepos with catalogs** (Bun): bump the catalog entry, not each workspace.
- **Bun workspaces without catalogs: a root `bun update` updates only the
  root's own dependencies.** The workspaces' direct dependencies (and the
  transitive security fixes under them) stay put. Run `bun update -r` as well
  (nutwords 2026-11-08: the root run moved 2 direct deps, `-r` moved 20 more,
  including the Sentry line that fixed glob/minimatch).
- **A security fix only hours short of the window:** compare its exact publish
  time (`npm view <pkg> time --json`) with now. If it clears within the
  session, wait and let `bun update` take it normally rather than adding an
  exemption. Say so in the PR, because the report will have listed it as cooling.
- **A safe update that breaks the typecheck because of a type we lean on
  structurally** (nutwords: `Database = PgliteDatabase`, with the Neon client
  passed in; PGlite 0.5.5 added `rowCount?: number`): hold it back with an
  **exact** pin (`bun add -d pkg@<old>` writes one), or next week's in-range
  update re-breaks it. File the real fix as an issue, link it, and lift the pin there.

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
