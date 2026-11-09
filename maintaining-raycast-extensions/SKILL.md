---
name: maintaining-raycast-extensions
description: "MUST be used when upgrading, migrating, building, linting or fixing a Raycast extension, especially moving one from Raycast v1 (@raycast/api 1.x) to Raycast 2 (@raycast/api 2.x). Covers what actually changed in API v2 (no removals; Node 26/React 19.3 runtime; Common shortcuts now per-platform and Remove moved to ctrl+D), the new lint rules, ray build vs ray develop, manifest platforms/author checks, and verifying a refactor against live data. Triggers on: raycast extension, upgrade raycast extension, raycast 2, raycast v2, @raycast/api 2, migrate raycast extension, ray build, ray lint, ray develop, raycast lint errors, prefer-common-shortcut, no-ambiguous-platform-shortcut, Keyboard.Shortcut.Common, raycast manifest, raycast platforms Windows, Invalid author raycast, cloned raycast extension, fork raycast extension."
---

# Maintaining Raycast Extensions

Learned upgrading Michael's local fork of kitze's Caddy extension
(`~/Projects/oss/kitze/caddy`) from API 1.103 to 2.11, 2026-11-08.

## When to Use

- Raycast was upgraded to 2.x and a local/dev extension is still on `@raycast/api` 1.x
- `ray build` or `ray lint` fails on an extension
- Forking someone else's extension for personal use

## v1 → v2: what actually changed

There is **no official migration guide because nothing was removed**. The
developer changelog (https://developers.raycast.com/misc/changelog) is the
source of truth; dependabot PR bot comments about "removed exports" are
hallucinated. Real changes:

- **Runtime**: Node 26.12 and React 19.3 once the extension's minimum
  `@raycast/api` is 2.10+. API 2.11 peer-depends on `@types/node` 26.6.5 and
  `@types/react` 19.3.0, so bump those too. The CLI needs Node >= 22.22.2.
- **Shortcuts**: `Keyboard.Shortcut.Common` now carries macOS and Windows
  bindings. On macOS: CopyName ⌘⌥C, CopyPath ⌘⌃C, Pin ⌘., MoveUp/Down ⌘⌥↑/↓,
  and **Remove is ⌃D (was ⌃X)**, RemoveAll ⌃⇧D. New ⌘N and Refresh ⌘R are unchanged.
  The authoritative mapping is in
  `node_modules/@raycast/eslint-plugin/dist/rules/prefer-common-shortcut.js`
  (the API's runtime table isn't greppable).
- **Deprecated**: `environment.commandName` / `commandMode`, replaced by
  `environment.entryPointName` / `entryPointMode` / `entryPointType`.
- Raycast 2 runs on Windows for real, so `"platforms": ["macOS", "Windows"]`
  is a claim. Drop Windows if the code shells out to brew, pgrep, `open`, etc.

## Upgrade recipe

1. Commit any local edits first, so the upgrade is its own commit.
2. **Trial first in a throwaway copy** (rsync excluding node_modules/.git into
   the scratchpad), so you can tell v2 breakage from pre-existing breakage.
3. `bun add @raycast/api@^2 @raycast/utils@^2` and
   `bun add -d @raycast/eslint-config@latest @types/node@<peer> @types/react@<peer>`
   (get the peer versions with `npm view @raycast/api@<ver> peerDependencies`).
4. `./node_modules/.bin/tsc --noEmit`, then the same on the **original** v1
   tree. Errors on both are old bugs, not migration work.
5. `ray lint --fix`, then fix the rest by hand:
   - `@raycast/prefer-common-shortcut`: use `Keyboard.Shortcut.Common.X` when
     the action means X.
   - `@raycast/no-ambiguous-platform-shortcut`: for a non-common action pass
     `{ macOS: {...}, Windows: {...} }`.
   - `MenuBarExtra.Item` takes `shortcut` as `Keyboard.Shortcut` too.
6. `ray build -e dist -o <dir>`. **`-e` is the environment (dev|dist), `-o` the
   output dir.** `ray build` runs a full `tsc` and fails on type errors that
   `ray develop` tolerates, so a fork that "works" in dev may never have built.
7. `bun run dev` once so Raycast 2 registers the dev extension (the v1→v2 app
   migration imports dev extensions, but re-run if it's missing).

## Traps

- **`ray lint` validates `author` against `https://www.raycast.com/api/v1/users/<handle>`**
  (404 means lint error). For a personal fork set it to `kiliman` (exists).
- Refactoring a hand-unrolled search into a recursive one can flip
  first-match vs last-match semantics. **Diff old vs new against live data**:
  `git show HEAD:src/utils.ts > old.ts`, import both into a bun script, and
  compare `JSON.stringify` of the outputs. In Caddy's case, last-match was
  right: path-specific handlers (e.g. a `swarm_rails_paths` snippet to :3000)
  come before the catch-all `handle`, so the last `reverse_proxy` is the site's
  real target.
- A cloned extension's `origin` is the upstream author's repo: commit locally,
  never push.

## Keeping the tooling current (security)

Run the `auditing-dependencies` skill. Raycast-specific findings (Nov 2026):

- Advisories are almost always **dev-only** (eslint, typescript-eslint, the
  `ray` CLI's oclif deps). Raycast provides `@raycast/api` at runtime, so the
  built bundle holds only your code plus `@raycast/utils`. Still fix them.
- **TypeScript ceiling**: typescript-eslint (inside `@raycast/eslint-config`)
  supports only `typescript <6.1`, so use 6.0.x, not 7. **TS 6 defaults
  `types` to `[]`**, so `child_process`, `process`, `console` and `setTimeout`
  stop resolving. Add `"types": ["node"]` to tsconfig.
- ESLint 10 works with `@raycast/eslint-config` 2.2 and drops the vulnerable
  `@eslint/eslintrc` chain (ajv 6, js-yaml, minimatch 3).
- **minimatch GHSA-g3hv-75wg-m249 can't be overridden**: @oclif/core,
  @eslint/config-array and typescript-estree pin `^10`, Bun overrides are
  top-level only, and `filelist` (via @raycast/api → oclif autocomplete → ejs →
  jake) uses `makeRe`/`regexp`/`matchOne`, all removed in minimatch 11. Ignore it
  with an `"audit": "bun audit --ignore GHSA-g3hv-75wg-m249"` script (Bun has no
  config-file ignore list) until the parents move.
- The template's `"publish": "npx @raycast/api@latest publish"` bypasses the
  lockfile. Use `"ray publish"`.
