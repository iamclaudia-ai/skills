---
name: landing-cursor-pr-batches
description: "MUST be used when working through a large batch of bot-authored PRs (Cursor's app/cursor CVE and dependency fixes, Dependabot-style security PRs, cursor/bug-report PRs): triaging and claiming them, finding duplicates across waves and picking keepers, reviewing CVE fixes (alerts vs resolved versions, reachability, cross-major bumps, interacting packages, bundle budgets, CI flakes), grouping approved PRs into integration or split PRs that land with REAL merge commits so every bot PR is marked merged, verifying the regenerated lockfile, arming auto-merge safely on a stack, and cleaning up afterwards (squash-merged by mistake, bot rebased heads after we merged, stragglers to close, an app deleted mid-flight). Triggers on: cursor PRs, CVE PRs, app/cursor, bot PRs, dependency PRs, security PRs, Dependabot PRs, batch of PRs, mob on PRs, work through the PRs, duplicate PRs, duplicates, close duplicates, keeper, integration branch, combine PRs, group PRs, split into PRs, merge commit not squash, merge them all, land the CVE fixes, lockfile conflicts, pnpm-workspace overrides, verify lockfile, auto-merge the stack, squash merged by mistake, rebased after merge, PR not marked merged, close stragglers."
---

# Landing Cursor PR batches

Cursor (and bots like it) open dozens of small PRs at once, in waves that duplicate each other, and every one of them
edits the same shared files (`pnpm-workspace.yaml` overrides, `pnpm-lock.yaml`). Merged one at a time, each merge
conflicts the rest. This skill is the playbook from landing 50 of them in beehiiv/swarm (Nov 9-10, 2026): triage,
review, combine into a few PRs whose merge commits mark every bot PR merged, and clean up what goes wrong.

Most of it is general; the swarm-specific facts are in their own section.

## When to use

- Someone asks the team to "mob on" or "work through" a pile of Cursor/bot PRs.
- Two or more bot PRs fix the same package and you need to pick one.
- Approved bot PRs need landing together because they conflict with each other.
- A group PR landed wrong (squashed, merged into a stack branch) or bot PRs stayed open after their fix landed.

## Scripts

Run them **from the repo root** (they use git there), with `$S` pointing at this skill's `scripts/`. They are not
runner commands, because the anima runner would set cwd to the skill directory. Every script takes a **work dir**,
for example `./tmp/cursor-cve`, which holds `prs.json` and `merged-heads.json`. Keep a `NOTES.md` there too.

```bash
S=~/.claude/skills/landing-cursor-pr-batches/scripts
```

| Script | What it does |
|---|---|
| `snapshot-prs.py <work> [--author app/cursor] [--state open] [--search ...]` | Lists the batch into `prs.json`, fetches every `refs/pull/N/head`, and computes file lists from git |
| `find-duplicates.py <work>` | Groups PRs by the packages they actually change (branch name, override keys, dependency specifiers) |
| `compare-prs.sh <ecosystem> <package> <PR...>` | Shows open alerts and first patched versions, main's resolved versions, and per PR: state, CI, failures, resolved versions and the non-lockfile diff |
| `prod-reach.sh <PR:package...>` | Lists which workspace projects reach each package through prod dependencies (coarse; used for grouping) |
| `merge-heads.py <work> <PR...>` | Merges each head unchanged with `--no-ff`; auto-resolves lockfile=ours and overrides=union; records head and base |
| `verify-lock.py <work> [PR...]` | Checks that each PR's removed lockfile versions are still gone and its added ones are present or superseded; `LOCKFILE=` for the mutation test |
| `verify-group-swarm.sh <work> <label> [PR...]` | swarm only: regenerates the lockfile, runs verify-lock, a frozen install, both Orchid builds and the bundle budget |
| `compare-trees.py <refA> <refB>` | Compares overrides, patches and lockfile packages between two builds |
| `check-heads.py <work> [PR...]` | Reports bot heads that moved since we merged them, and merged heads missing from HEAD |
| `resolve-side.py ours\|theirs <file>` | Resolves every conflict hunk in a file to one side |
| `arm-merge.sh <PR> [base]` | Arms auto-merge as a **MERGE** commit, but only if base is main, the PR is approved and has no open threads; replaces an existing SQUASH |
| `watch-pr.sh <PR>` | Under the Monitor tool: one event per state, base, auto-merge or failing-check change; exits on merge |
| `after-merge.py <work> <group PR> <PR...> [--close]` | Requires 2 parents on the merge commit, then accounts for every included PR and closes the ones verified as landed |

## The rules (learned the hard way)

1. **Never push to the bot's branches.** Read them, merge their heads unchanged, close them with a comment. Their branch is theirs.
2. **Land with real merge commits, never squash.** GitHub marks a PR merged when its *head commit* becomes reachable
   from the base branch. A merge commit carries every included head; a squash drops them all, and every bot PR stays
   open. A merge commit also keeps each fix traceable in history, which a 50-PR squash doesn't.
3. **The GitHub UI remembers the last merge method.** A teammate who squashed another PR will squash this one too.
   Arm auto-merge yourself with `arm-merge.sh`. `gh pr merge --merge --auto` does **not** replace an existing squash
   request; the script goes through GraphQL `enablePullRequestAutoMerge(mergeMethod: MERGE)` and prints the method.
4. **Never arm auto-merge on a stacked child.** Its base is the parent's branch, so it merges *into that branch* the
   moment CI passes. Merge bottom-up. After each one lands, confirm the next PR retargeted to main
   (`delete_branch_on_merge` does that), then arm it.
5. **Verify every merge by its parents, never its subject.** `git rev-list --parents -n1 <sha>` must show 2 parents.
   A squash of a merge-built branch still gets GitHub's "Merge pull request #N" title. `after-merge.py` checks this first.
6. **Record what you merged, with its base, at merge time** (`merge-heads.py` does). Bots rebase their branches after
   you merge them; the recorded SHA is the only proof of what landed. Once a head is on main,
   `merge-base(main, head)` is the head itself, so a PR's diff can't be recomputed afterwards.
7. **A CI rerun reuses the old merge ref.** To test against a newer main, merge `origin/main` into your branch (a normal
   merge, no force-push). In swarm, approvals survive pushes (`dismiss_stale_reviews=false`); check `reviewDecision` anyway.
8. **Drafts are fine.** Cursor drafts PRs it calls ready for review. A draft PR's head landing still marks it merged
   (confirmed: #33805 was a draft). Marking our own PRs ready and requesting reviewers stays with Michael.
9. **Ask before scope changes others own:** closing someone's PR, holding a PR out of the batch, posting in Slack. Do
   say what you'd recommend.

## Phase 1: Inventory and claim

1. `snapshot-prs.py ./tmp/<task>`. Separate CVE PRs (`cve/*` branches, `fix(cve)` titles) from product fixes
   (`cursor/bug-report-*`). Product fixes need a normal review by their area's owners, so ask before starting them.
2. Agree in the thread how people claim PRs (in swarm: the **Assignee** field) and assign yourself as you go, in
   batches of about 10, so teammates don't duplicate work.

## Phase 2: Duplicates and keepers

`find-duplicates.py` finds the groups; `compare-prs.sh npm <pkg> <PR...>` compares within one. Cursor ran several
waves (Oct 23, Nov 3 `cve/dependabot-NNN` with free-form titles, Nov 9 `cve/npm-<pkg>` "patch N X advisories"), so most
packages have 2-30 PRs.

- **Keeper:** the PR that clears **every open alert** for the package (`fix=` versions vs what it resolves) across
  **every manifest**. Some PRs fix only the client or only Orchid. Then: green and ready beats draft or red; on a tie,
  pick the newer one, whose advisory comment is usually fuller. Carry anything good from the loser, such as a test.
- **Obsolete:** if main already resolves fixed versions and the package has 0 open alerts, close the PR as already fixed.
- **Stale baggage:** older waves sometimes carry a cherry-pick of an unrelated commit that has since landed. If the diff
  still shows it, prefer the clean PR.
- Close each loser with a comment naming the keeper, and say why.

## Phase 3: Review each keeper

- **Versions:** every alert's first patched version is resolved, and no vulnerable copy is left in the lockfile.
  If an advisory has **no patched release** in that major, the bot overrides to the next major. Check what that
  major breaks against what our consumers actually call (named exports, CLI use, ESM-only vs `require`).
- **Reachability:** is it production code or build/dev/test tooling? Use `pnpm why --prod` (`prod-reach.sh`), then
  read the actual call sites. That decides how hard to review and which group the PR joins.
- **Interacting packages:** some fixes are only safe together. Example: glob 10 with minimatch 11 silently returns
  `[]` for wildcards, so the minimatch fix had to land after the glob fix removed every glob@10. When a pairing smells
  risky, build a tiny repro (a control run plus the new versions).
- **Patches to framework internals:** check whether the patched path is even reachable. The turbo-stream fix patched
  Remix single fetch, which no app turns on, so it was dropped: carrying patches against dead code adds risk with no protection.
- **Bundle budget failures:** don't assume "main was already over". Compare the budget at the PR's merge base with
  its measurement, and measure the dependency's own delta (`esbuild --minify | gzip -9`).
- **CI failures:** read the logs before calling it a flake. Known flakes: the 15-minute "Run Playwright tests" step
  timeout with every test passing; a browser session that never connects ("no tests ran"); a test reading a hover color
  because the pointer was left over the element. Rerun only the failed jobs (`gh run rerun <run> --failed`, after the
  run completes).
- Approve with a short body that states the evidence; save bodies under `<work>/reviews/`. Sign with `Claudia 💙`.
  Confirm `reviewDecision` registered.

## Phase 4: Group and build

Serial merging means one lockfile regeneration and one CI run per PR, with a conflict every time. Instead:

1. **Group by where the code runs**, so a regression after deploy points at one group and can be reverted alone:
   e.g. Ruby gems (independent, from main) | build/dev/test tooling | Node server runtime | browser runtime | framework
   (riskiest, on top). Four or five groups is what the team asked for; one 50-PR PR scared reviewers.
2. Stack the npm groups (each shares the lockfile with the one below): `main <- tooling <- server <- browser <- framework`.
   The Ruby group branches from main on its own.
3. Per group branch: `merge-heads.py <work> <PRs>`. Resolution rules: lockfile = ours (regenerate once at the end);
   overrides = union with their advisory comments kept, then fix any duplicate key by keeping the stricter value;
   `package.json` specifiers = the higher; bundle budget = set once from a measurement; `Gemfile.lock` = re-run
   `bundle lock` and confirm it reproduces byte for byte. **rerere** may replay an old resolution, so check the content.
4. Regenerate the lockfile once (`pnpm install --no-frozen-lockfile`), then `verify-lock.py`. Run the mutation test
   once: `LOCKFILE=<main's lockfile>` must fail every PR.
5. Frozen install, builds, bundle budget (swarm: `verify-group-swarm.sh`). A fresh resolve can drift `^` ranges to a
   newer patch than the one reviewed; pin it back (`pnpm add pkg@x.y.z`, then restore the `^` in package.json and in
   the lockfile importer's `specifier:`). `compare-trees.py` against the earlier build proves nothing else moved.
6. Before pushing: `check-heads.py`. Open draft PRs. The body is a TL;DR, a "merge with Create a merge commit, never
   squash" warning, the stack position, what to watch per group, the verification, and a table of included PRs with
   the head SHA merged.

## Phase 5: Land

For each group, bottom-up:

1. `check-heads.py <work> <group PRs>`. If a head moved and the group is still unmerged, see recovery recipe B.
2. Confirm base is main and CI is green on a run that includes current main. Then `arm-merge.sh <PR>`, and watch it
   with `watch-pr.sh` under Monitor. Coverage jobs aren't required checks in swarm: UNSTABLE still auto-merges.
3. After it lands: `after-merge.py <work> <group PR> <its PRs>`. It needs 2 parents; review the list, then rerun with
   `--close` to close the stragglers whose fix is verified on main.
4. The next PR retargets to main. Merge `origin/main` into it (fresh CI; resolve the lockfile by regenerating),
   rerun its verification, then arm it.
5. Watch main CI afterwards and post a short wrap-up in the thread (what landed, what closed and why), signed `Claudia 💙`.

## Recovery recipes

**A. A group PR was squash-merged into its parent branch** (one parent, "Merge pull request" subject). Content is
fine; history lost the bot heads. Merge the child's **original tip** into the parent branch with a real merge,
resolve every conflict to ours, and require the tree to be byte-identical (`git diff --cached <before>` empty).
Check that all heads are ancestors (`check-heads.py`), then push normally. If auto-merge was armed as squash, disable
it and re-arm (`arm-merge.sh`).

**B. The bot rebased a PR after we merged its head.** If the group hasn't landed and the rebased head adds nothing
(`git merge-tree --write-tree HEAD <new>`: no change outside the lockfile; empty conflict hunks count as nothing),
merge the new head too, keep our lockfile, and confirm the tree is unchanged. GitHub then marks it merged. After
landing, `after-merge.py --close` closes those whose recorded head is on main and whose current head adds nothing;
anything else it flags for a human. Cursor rebases whenever main moves under it, so expect a wave after each group lands.

**C. Drop a PR from a group** (a reviewer's call, or it turned out unreachable). Rebuild the group branch from its
parent without it and `git push --force-with-lease=<branch>:<old sha>` (your own branch only). Do **not** revert it:
a reverted merge still puts the head in history, so GitHub would mark the dropped PR merged. Close it with the reason.

**D. Main deletes something the batch touched** (an app removal). Take the deletion (`git rm`), regenerate the
lockfile, and expect `verify-lock.py` to report "missing" for packages whose only consumer was the deleted app.

**E. A merged group's later child needs main.** Merge `origin/main` in (no rebase, no force), regenerate the
lockfile if it conflicts, re-measure the bundle budget against main's newer limit, and keep main's budget prose,
adding one dated line.

## swarm specifics (beehiiv)

- `main` requires `pr-ci-result` and `Prototype Label Check`, 1 approval, `strict=false`, `dismiss_stale_reviews=false`,
  `require_extra_approval_for_unattributed_changes=true`; merge and squash are both allowed; `delete_branch_on_merge=true`.
- `pnpm` and `bundle install` need `doppler run --` (`@beehiiv/ui` is private on npmjs; gems from rubygems.pkg.github.com).
  Use `HUSKY=0` and `--no-verify` for your own merge commits: the pre-commit hook runs a pnpm install.
- `apps/orchid-v2/bundle-budget.json` caps total client JS; set it once per group from `bundle-report.mjs --check` in a
  CI-equivalent shell on the pinned Node, and add a dated sentence to its `//` history.
- Orchid apps are Remix 2 (single fetch off everywhere); the React Router 8 migration retires Remix-internal advisories.
- **The Docker images don't install the workspace the way dev and CI do.** They `pnpm deploy` from a generated
  workspace file, so an override or pin in `pnpm-workspace.yaml` can be missing from the image even though every check
  passed. The Nov 2026 batch took Orchid down on staging this way (two copies of React Router; fixed by #34287). Before
  a group that touches an image's dependencies lands, check what the image will actually get with the
  `debugging-swarm-docker-images` skill.
- Every PR from main can fail on main-wide breakage (a cop-count spec, once); check whether main itself is red first.
- Michael marks PRs ready and requests reviewers; PRs are created as drafts.

## Tooling traps

- `gh pr list --json statusCheckRollup` or `files` on ~90 PRs returns 502/504 from GraphQL. Snapshot lean, compute
  files from git, and fetch CI per PR.
- Fetch `refs/pull/N/head`, not the branch: merged bot branches get deleted.
- dcg blocks `git branch -f`, `git checkout <ref> -- <path>` built from shell variables, `git diff A..B` (use three dots
  or a space), python heredocs containing `subprocess.run`, and `>` redirects to `$VAR` paths. Use the scripts or Edit.
- A turn-end snapshot hook briefly holds `index.lock`; the scripts retry.
- Python 3.15 removed `load_module`; use `importlib.util` (the scripts share `batch_common.py` instead).
