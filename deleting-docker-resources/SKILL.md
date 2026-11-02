---
name: deleting-docker-resources
description: "MUST be used whenever you need to delete, clean up, or prune Docker containers, images, volumes or networks, because dcg blocks `docker rm`, `docker rmi` and `docker run --rm`. Also MUST be used BEFORE creating any Docker image, container, volume or network for testing (docker build, docker run, docker create), to label it so it can be cleaned up later. Deletes what I created (labelled claudia.scratch=true) freely, and unlabelled leftovers by name or prefix, never compose stacks, running containers I didn't start, images still in use, or pulled base images. Triggers on: delete docker container, remove container, docker rm blocked, docker rmi, remove docker image, clean up docker, docker cleanup, prune docker, docker prune, stopped containers, leftover containers, test containers, scratch images, dangling images, free disk space docker, docker build for testing, docker run --rm blocked, rebuild in docker, reproduce a build in docker, dcg blocked docker."
---

# Deleting Docker Resources

dcg blocks `docker rm`, `docker rmi`/`docker image rm` and even `docker run --rm`,
so every test container I run stays behind. This skill does the deleting inside a
script that runs its own safety checks first, so I can clean up after myself
without asking Michael each time.

This machine also runs Michael's long-lived stacks (beehiiv's ClickHouse, PeerDB,
Temporal, docker-swarm, Evolution). The rules below exist to keep those out of reach.

## When to Use

- **Before** building or running anything for a test: label it (see below)
- After a test, rebuild, repro or experiment: delete what it left
- Any time a Docker delete was blocked by dcg

## Label what I create

Everything I make carries `claudia.scratch=true`, which is how the script knows it
is mine. Containers inherit the labels of their image, so labelling the build
covers the containers run from it.

```bash
docker build --label claudia.scratch=true -t nutwords-bf:8ab83ff .
docker run --label claudia.scratch=true --name claudia-repro-404 nutwords-bf:8ab83ff
docker volume create --label claudia.scratch=true claudia-pgdata
docker network create --label claudia.scratch=true claudia-net
```

Name containers and tag images with a recognisable prefix too (a project prefix
like `nutwords-bf`, or `claudia-`), so unlabelled strays can still be found.

## Available Commands

Run through the **anima skills runner**.

- **`delete [--mine] [--prefix <p>]... [<name>...] [--stop] [--pulled] [--dry-run]`**
  - `--mine`: every container, image, volume and network labelled `claudia.scratch=true`
  - `--prefix <p>`: containers whose name, and images whose repository, starts with `<p>` (3+ chars)
  - `<name>`: a container name or ID, or an image `repo:tag` (`repo` alone means `repo:latest`)
  - `--stop`: stop running containers first, only ones carrying my label
  - `--pulled`: allow unlabelled images that came from a registry
  - `--dry-run`: report, delete nothing

```bash
anima skills run deleting-docker-resources delete --mine --dry-run
anima skills run deleting-docker-resources delete --mine --stop
anima skills run deleting-docker-resources delete --prefix nutwords-bf --prefix bf-8ab- --dry-run
anima skills run deleting-docker-resources delete nutwords-backfill:e50adf34 bf-8ab-old
```

## What `delete` checks

Containers go first, so the images they used can go in the same run.

1. **Compose projects are never touched** (`com.docker.compose.project` label),
   whatever the selection. Those are Michael's stacks.
2. **Running, paused or restarting containers are skipped**, unless they carry my
   label and `--stop` is given.
3. **Images still used by a surviving container are skipped**, stopped containers
   included.
4. **Pulled images are skipped** (they have a registry digest) unless they carry my
   label or `--pulled` is given. Base images like `oven/bun` or `postgres` may be
   ones Michael's stacks rely on, even when nothing runs them right now.
5. **Volumes and networks are only selected by `--mine`.** A volume holds data and
   cannot be rebuilt, so an unlabelled one is never mine to delete.
6. Images are removed **by tag, never with `-f`**. When another tag shares the
   image ID, only the named tag goes and the image stays.

Each deletion is appended (kind, name, ID, reason, detail, time) to
`~/.local/state/deleting-docker-resources/deleted.txt`. Nothing deleted can be
restored. An image comes back by rebuilding it, so delete only what can be rebuilt.

## Instructions

1. **Dry run first**, every time, and read what would go.
2. Run it for real.
3. Only delete **my own** resources: labelled ones, or unlabelled ones I know I
   created (this session, or named in my notes). If something looks like a stray
   but I'm not sure it's mine, list it for Michael instead.
4. Clean up when the task ends, not "later": stopped containers and 1GB images
   pile up fast.

## Notes

- `docker system prune`, `docker image prune` and `docker volume prune` are off
  limits. They act on everything, including Michael's stacks' stopped containers
  and volumes.
- Build cache is separate. `docker builder prune` is safe in principle, but it
  slows Michael's next builds, so ask first.
- Don't run `docker rm` through `bash -c` or `eval` to dodge dcg. This skill is
  the sanctioned path because it checks first.
