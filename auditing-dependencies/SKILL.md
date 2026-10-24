---
name: auditing-dependencies
description: "MUST be used when checking a project for security updates, vulnerable dependencies, or supply-chain risk, and when upgrading dependencies in response to an advisory or a security incident. Audits any project (Bun, pnpm, npm, yarn, Ruby, Python, Rust, Swift), applies fixes in order of risk, untangles vulnerabilities stuck behind a parent's pinned range (parent upgrade or override, with a reachability check), sets up a release-age cooling-off window and exempts security fixes from it, flags floating `latest` specifiers and `npx pkg@latest` runs, and checks whether Bun/Node runtimes are missing security releases. Triggers on: security updates, check for vulnerabilities, bun audit, npm audit, pnpm audit, dependency audit, CVE, GHSA, security advisory, vulnerable package, upgrade dependencies, update deps, patch vulnerabilities, supply chain attack, compromised package, hijacked release, minimumReleaseAge, release age, waiting period, cooldown, overrides, resolutions, transitive vulnerability, outdated packages, harden dependencies, rotate after breach, node security release, bun upgrade."
---

# Auditing Dependencies

Find and fix vulnerable dependencies in any project, close the supply-chain
holes that let a hijacked release in, and verify nothing broke. Written after
"Black October" (Oct 2026), when Anima went from 83 advisories (3 critical,
27 high) to zero in one pass.

## When to Use

- A security incident or advisory wave ("update everything", "check for security updates")
- Before or after upgrading dependencies in any project
- An audit reports something stuck behind a dependent's range
- Setting up or tuning a release-age (cooling-off) window
- Checking whether the local Bun/Node runtime is missing a security release

## Available Commands

Invoked through the **anima skills runner**:

- **`posture <project-dir>`**: ecosystems present with the audit command for each,
  the configured release-age window and its excludes, floating `latest`/`*`
  specifiers and `npx|bunx ...@latest` runs in package.json scripts and
  `.husky` hooks, and Bun/Node versions vs latest (Node's index marks
  security releases).
- **`release-age [--window-days N] [--deps a,b] <name@version|name@latest>...`**:
  publish age of npm versions, whether each is blocked by an N-day window
  (default 3), the latest version, and the ranges it declares for the
  `--deps` you name. Use it to see whether a newer parent unblocks a
  vulnerable transitive.

```bash
anima skills run auditing-dependencies posture /abs/path/to/project
anima skills run auditing-dependencies release-age --deps uuid,tinypool typeid-js@latest oxfmt@latest
```

## Workflow

### 1. Posture first

Run `posture`. Note the ecosystems, whether a window exists, floating
specifiers, `@latest` executions, and runtime gaps. Then run each ecosystem's
audit and save the JSON (`bun audit --json`) as the before-picture.

### 2. Release-age window

A window (3 days is the usual choice) means a hijacked release is normally
caught and yanked before any install can pick it up. If the project has none,
add one **before** updating, so the update itself runs under the window.

| Tool | Where | Key | Unit |
| ---- | ----- | --- | ---- |
| Bun | `bunfig.toml` `[install]` | `minimumReleaseAge = 259200` + `minimumReleaseAgeExcludes = [...]` | seconds |
| pnpm | `pnpm-workspace.yaml` | `minimumReleaseAge: 4320` + `minimumReleaseAgeExclude` | minutes |
| Yarn berry | `.yarnrc.yml` | `npmMinimalAgeGate` | duration |

**Security fixes younger than the window** (step 3 tells you which) are
exempted **by exact version**: Bun accepts `"name@1.2.3"` in the excludes, which
exempts that one release and never a future one. Add a comment with the GHSA
and publish date on each exemption. Prune entries once they are older than
the window (`posture` lists them).

### 3. Preview and triage

Bun: `bun audit fix --dry-run`, then `bun audit fix --latest --dry-run`. The
output splits into:

- **fixing**: the fix is within ranges. Safe.
- **`--latest` extras**: a pinned direct dependency needs a bump (for example
  `sharp 0.34 -> 0.35`). Read its changelog.
- **blocked by a dependent's range**: a parent pins the vulnerable version. See step 5.

Run `release-age` on every target version to see which would be blocked by the
window. If a blocked one is a security fix, exempt it as in step 2.

### 4. Apply, lowest risk first

1. `bun update` (all in-range updates). With `exact = true` in bunfig, this
   **rewrites caret ranges in package.json to exact pins**. That is expected
   and tighter.
2. `bun audit fix --latest` (pinned direct dependencies that need a bump).
3. Bump the direct dependencies that parent a blocked transitive (step 5).
4. Pin anything still floating on `"latest"`, `"*"` or `"next"` to the
   version now in the lockfile.

Leave lifecycle scripts blocked (`bun pm untrusted` lists them). Trust one
only if the package really needs a native build.

### 5. Untangle stuck transitives

For each "blocked by a dependent's range":

1. **Does a newer parent fix it?**
   `release-age --deps <vuln-pkg> <parent>@latest`. If the newer parent's range
   admits the fixed version, upgrade the parent. (Example: oxfmt 0.74 moved off
   the vulnerable tinypool. claude-agent-sdk 0.2.141 moved to
   `@anthropic-ai/sdk ^0.93`.)
2. **If not, can we reach the vulnerable code?** Read the advisory's affected
   functions, then grep the parent's `dist` for what it actually imports. With
   Bun the code lives in `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>`.
   (Example: typeid-js only calls uuid's `v7` and `stringify`. The uuid
   advisory is for `v3`/`v5`/`v6` with a buffer, so it is unreachable.)
3. **Override anyway when it is cheap**, so the audit stays clean and its
   signal stays meaningful. Read the fixed major's breaking-change list first.
   Use `"overrides"` in the root package.json (Bun/npm), `pnpm.overrides`, or
   `resolutions` (Yarn). Then smoke-test the parent's code path.
4. If an override is unsafe and the code is unreachable, ignore that one
   advisory (`bun audit --ignore GHSA-...`) and record why in the commit.

### 6. Close the bypasses

- `npx --yes pkg@latest` / `bunx pkg@latest` in scripts or git hooks downloads
  and runs the newest release on every invocation, outside the lockfile and
  the window. Pin the tool as a devDependency and call the binary directly
  (`bun run` puts `node_modules/.bin` on PATH).
- Floating `"latest"` specifiers: pin them.

### 7. Runtimes

`posture` compares local Bun with npm `bun@latest`, and local Node with the
newest release of the same major, listing any **security** releases in
between. Find out how each runtime is installed (`which -a node`: mise, brew,
nvm) before upgrading. Upgrade with the manager that owns it
(`bun upgrade`, `mise use -g node@<ver>`). Look at what else depends on a brew
Node before bumping it. On vesuvius, brew `node@22` backs code-server
(Michael's only remote terminal), and dylib bumps have crash-looped it, so
leave that one to Michael.

### 8. Verify, then ship

- Typecheck, lint, and the **full** test suite, not just the pre-push subset.
  Exclude tests that are known to hang and say so.
- Smoke-test native or changed-major packages directly (for example, resize an
  image with sharp, or generate an ID through the overridden uuid).
- A formatter bump reformats files: review the diff and confirm it is
  whitespace only.
- Regenerate any generated docs that depend on schema libraries (zod).
- Re-run the audit (aim for zero), commit with a conventional `fix(deps):`
  message listing the critical/high items, and push.
- **Restart long-running services** so they actually load the new code
  (`anima watchdog reload` for Anima), then check their health.

## Ecosystem audit commands

| Lockfile | Audit | Fix |
| -------- | ----- | --- |
| `bun.lock` | `bun audit [--json]` | `bun audit fix [--latest] [--dry-run]` |
| `pnpm-lock.yaml` | `pnpm audit` | `pnpm audit --fix` (writes overrides) |
| `package-lock.json` | `npm audit` | `npm audit fix` |
| `Gemfile.lock` | `bundle-audit check --update` | `bundle update <gem>` |
| `uv.lock` / `requirements.txt` | `uvx pip-audit` | bump the pin, `uv lock --upgrade-package <pkg>` |
| `Cargo.lock` | `cargo audit` | `cargo update -p <crate>` |
| any of the above | `osv-scanner scan source -r .` | (scanner only) |

Ask before installing a missing audit tool (`gem install bundler-audit`,
`cargo install cargo-audit`, `brew install osv-scanner`).

## Notes

- Never pipe long-running installs or `git push` through `tail`/`head` under the
  tmux/tokf wrapper. Use `tokf raw last` for full output.
- The dcg guard blocks shell redirects to `$VAR` paths and heredocs into files.
  Use literal paths, or write scratch scripts with the Write tool.
- A release-age window also delays non-security updates by N days. That is the
  point. Do not exempt a package wholesale (`"name"` without `@version`) unless
  you really want every future release of it to skip the window.
- Anima reference run: commits `7be45a2` (audit fixes, window, overrides) and
  `6b5c7e4` (react-doctor pin) in iamclaudia-ai/anima.
