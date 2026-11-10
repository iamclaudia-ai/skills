---
name: debugging-swarm-docker-images
description: "MUST be used when a beehiiv swarm Docker image (orchid-v2, orchid-v1, orchid-proxy, tiptap-bridge, utilities, template-builder) breaks after a deploy while dev and CI look fine, when checking what a dependency change will actually put in an image, and when building or running those images locally. Covers why images can differ from the workspace install (pnpm deploy, forceLegacyDeploy, overrides), simulating an image's pnpm deploy without Docker, real docker builds with the Tiptap secret and without uploading Sentry source maps, running the Orchid production server against the staging Swarm API, comparing two node_modules trees, and the dcg traps on the way. Triggers on: orchid down on staging, Unexpected Server Error, every page 500, loaders 200 but pages 500, staging deploy broke, ECS deploy failed, edge never served, image broke after dependency bump, works locally but not in Docker, pnpm deploy, deploy workspace, write-deploy-workspace, pnpm-workspace.deploy.yaml, overrides not applied in Docker, CVE pin not in image, duplicate react-router, two copies of React Router, docker build orchid, run orchid image locally, orchid production build locally, smoke test image, what's in the image, compare node_modules."
---

# Debugging swarm Docker images

The Node images don't run the workspace's `node_modules`. Each Dockerfile builds the app, then runs
`pnpm --filter <app> deploy --prod`, which installs a fresh, app-only `node_modules` for the runtime
stage. Whatever settings `pnpm deploy` sees decide what ships, and that can differ from what CI and
local dev install. Vite dev mode **never** reproduces an image bug: it uses the workspace install.

## When to Use

- A staging deploy breaks something that dev and CI don't show (Orchid's plain-text `Unexpected Server
  Error` on every page while `?_data=root` returns 200 is the classic: a render-only failure).
- Before trusting that a dependency override or CVE pin reached the images.
- Building or running an image locally to prove a fix before it merges.

## The history you need (Nov 10, 2026)

- Until BEE-28543 (swarm#34290), Dockerfiles replaced `pnpm-workspace.yaml` with a `packages:` list plus
  `docker/pnpm-workspace.deploy.yaml`, which had **no** `overrides`, `packageExtensions` or
  `patchedDependencies`. Root pins never reached images. `forceLegacyDeploy` also re-resolves instead of
  following the lockfile (an image had React 19.3.1 against the lockfile's 19.2.4).
- That broke Orchid v2 staging after the React Router 6.30.6 bump: `@remix-run/react@2.17.5` pins Router
  **6.30.4 exactly**, the root override that moved it was dropped, and the image held two Router copies.
  Hotfix swarm#34287; root cause write-up in the swarm repo's `tmp/orchid-rr-500/NOTES.md`.
- After #34290, `docker/write-deploy-workspace.mjs <package dirs>` writes the image workspace from the
  root file. If an image still misbehaves, check first that its Dockerfile calls the script.
- Copying only `overrides` is not enough: the lodash-free overrides need their patches, or the server
  crashes on `Cannot find module 'lodash/noop'`.

## Workflow

Work in a worktree on the commit in question (`git worktree add --detach … origin/main`), with
`pnpm install --frozen-lockfile --prefer-offline --filter '!client'`, as the Dockerfiles do. A
`--filter "orchid-v2..."` install is not enough for the production build (it misses
`@remix-run/node/node_modules/undici`).

1. **Simulate the deploy (fast, no Docker):**
   ```bash
   scripts/simulate-deploy.sh <worktree> <out-dir> <app> <package dirs...>
   # e.g. … ~/…/orchid-rr-500 ./tmp/x/deploy-v2 orchid-v2 apps/orchid-v2 packages/dream-components packages/mock-registry
   ```
   It builds the workspace file the way the Dockerfile does, runs `pnpm deploy`, restores
   `pnpm-workspace.yaml`, and lists the React Router copies. Read the package list from the Dockerfile.
2. **Compare two trees** (shipped vs fixed, before vs after):
   `python3 -I scripts/compare-trees.py <deploy-dir-a> <deploy-dir-b>` prints every package whose versions differ.
3. **Run the Orchid production server on a deploy dir** (needs `pnpm --filter orchid-v2 run build:remix`
   under `doppler run --project orchid-v2 --config staging` first):
   ```bash
   scripts/run-orchid.sh <worktree> <deploy-dir> orchid-v2 3078
   curl -s -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-Host: qa-newsletter.staginghiiv.com" http://127.0.0.1:3078/
   ```
4. **Real image build and container run** for the final proof:
   ```bash
   doppler run --project swarm --config dev -- scripts/build-image.sh <worktree> orchid-v2 <tag>
   scripts/run-orchid-container.sh claudia-deploy-orchid-v2:<tag> orchid-v2 3083
   ```
   Then clean up with the `deleting-docker-resources` skill (`delete --mine --stop`, dry run first).

## Facts and traps

- **Staging hosts:** Orchid's own `SWARM_API` (`swarm-orchid.swarm-staging.hiivinternal.com`) is
  VPC-only. `https://app.staginghiiv.com/api/v1/orchid` serves the same API (401 without credentials).
  The site is picked from `X-Forwarded-Host`. v2 test sites: `qa-newsletter`, `prop-notes`; v1:
  `pollinate-test` (`.staginghiiv.com`). The staging verify step checks `prop-notes` (v2) and `pollinate-test` (v1).
- **Render errors are invisible in prod logs.** pino only logs `failed with status code 500`. Prove a
  cause by fixing it and getting a 200, not by hunting a stack trace.
- **Containers need the Doppler metadata vars.** Orchid's zod env schema requires `DOPPLER_CONFIG`,
  `DOPPLER_ENVIRONMENT`, `DOPPLER_PROJECT`. Pass every name with `-e NAME` under `doppler run` so no
  secret value touches disk. Redis: `redis://host.docker.internal:6379`.
- **Don't upload test source maps.** `pnpm --filter orchid-v* build` and utilities' `pnpm build` upload to
  Sentry. `build-image.sh` builds from a temporary Dockerfile variant that runs only `build:remix` / `tsup`.
  The variant skips `build:routes`, so the Datadog "No Remix routes file" message at runtime is expected.
- **Tiptap secret:** `NPM_TIPTAP_REGISTRY_TOKEN` from Doppler `swarm/dev`, passed with
  `--secret id=npm_tiptap_registry_token,env=NPM_TIPTAP_REGISTRY_TOKEN`.
- **Production promotion copies staging.** `orchid-v2-deploy-prod.yml` is manual and promotes the
  staging image; a failed staging verify step does not block it. When staging is broken, ask people in
  the thread to hold promotions.
- **Leftover deploy dirs in a worktree root break the pre-push hook** (it scans them). Put them in the
  main checkout's `tmp/`.
- **dcg:** no `$VAR` in a redirect target, no redirect onto an existing file (use a new name or `>>`),
  `docker run --rm -d … -e …` trips the rm-force regex (drop `--rm`, clean up with the skill), and
  `pkill -f <pattern>` can match its own shell. Kill by PID from `ps -axo pid,command`.
- **jactionlint** fails on any PR touching workflows while `swarm-deploy-staging.yml` lacks top-level
  `concurrency:` (pre-existing since swarm#34255; not a required check).
