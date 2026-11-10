#!/bin/zsh
# Survey a repo's linked worktrees, and archive-then-remove the finished ones.
#
#   tidy-worktrees.sh survey <main checkout> <owner/repo>
#       one line per linked worktree: branch, PR state, tracked changes, untracked files,
#       notes under tmp/ and packages/*/tmp (git-ignored, so `status` never shows them)
#   tidy-worktrees.sh remove [--commit] <main checkout> <worktree>...
#       copies every tmp/ note and untracked file to <main>/tmp/worktree-archive/<name>/,
#       verifies each copy with cmp, then removes the worktree (--force only when untracked
#       files would block it, and only after they are archived). Without --commit: lists only.
#       Skips any worktree with tracked changes. Branches are left alone: delete them after
#       with the skill's `merged` / `delete` commands.
setopt nullglob
cmd=$1; shift

case $cmd in
survey)
  main=$1 repo=$2
  git -C "$main" worktree list --porcelain |
    awk -v m="$main" '/^worktree /{p=$2} /^branch /{sub("refs/heads/","",$2); if (p != m) print p" "$2}' |
    while read -r wt br; do
      pr=$(gh pr list -R "$repo" --head "$br" --state all --json number,state -q '.[0] | "#\(.number) \(.state)"' 2>/dev/null)
      tracked=$(git -C "$wt" status --porcelain --untracked-files=no | wc -l | tr -d ' ')
      untracked=$(git -C "$wt" ls-files --others --exclude-standard | wc -l | tr -d ' ')
      notes=$(cd "$wt" && find tmp packages/*/tmp -type f 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
      echo "$wt | $br | PR ${pr:-none} | tracked-changes $tracked | untracked $untracked | tmp-files $notes"
    done
  ;;
remove)
  commit=0
  [[ $1 == --commit ]] && { commit=1; shift; }
  main=$1; shift
  archive=$main/tmp/worktree-archive
  for wt in "$@"; do
    name=${wt:t2}; name=${name//\//__}
    if [[ -n $(git -C "$wt" status --porcelain --untracked-files=no) ]]; then
      echo "SKIP $wt: tracked changes"; continue
    fi
    all=( ${(f)"$(cd "$wt" && { find tmp packages/*/tmp -type f 2>/dev/null | grep -v node_modules; git ls-files --others --exclude-standard; } | sort -u)"} )
    # A symlink holds nothing of its own: a worktree's `node_modules` is usually one into the
    # main checkout, and git lists it as untracked (`node_modules/` ignores directories only).
    # cp would follow it and fail on the directory, so links are left out of the archive.
    files=() links=()
    for f in $all; do if [[ -L "$wt/$f" ]]; then links+=$f; else files+=$f; fi; done
    echo "== $wt -> $archive/$name (${#files} files)"
    for f in $files; do echo "   $f"; done
    for f in $links; do echo "   (symlink, not archived) $f -> $(readlink "$wt/$f")"; done
    (( commit )) || continue
    for f in $files; do
      mkdir -p "$archive/$name/${f:h}" && cp -p "$wt/$f" "$archive/$name/$f" || { echo "COPY FAILED $f; keeping $wt"; continue 2; }
    done
    for f in $files; do
      cmp -s "$wt/$f" "$archive/$name/$f" || { echo "VERIFY FAILED $f; keeping $wt"; continue 2; }
    done
    if [[ -n $(git -C "$wt" ls-files --others --exclude-standard) ]]; then
      git -C "$main" worktree remove --force "$wt" && echo "   removed (forced: untracked files archived)"
    else
      git -C "$main" worktree remove "$wt" 2>/dev/null || git -C "$main" worktree remove --force "$wt"
      echo "   removed"
    fi
  done
  ;;
*) echo "usage: tidy-worktrees.sh survey <main> <owner/repo> | remove [--commit] <main> <worktree>..."; exit 2 ;;
esac
