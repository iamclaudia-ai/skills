#!/usr/bin/env python3
"""Mark finished reviewer sessions done: resolve every open session in a workspace whose title
starts with "Review #N" or "Re-review #N" when PR #N has merged.

    python3 -I resolve-merged-reviews.py [--cwd <repo root>] [--dry-run]

Run it from the repo (or pass --cwd): the workspace is that folder, and `gh` reads PR #N from
that repo. A session still mid-turn (runtimeStatus "running") is left alone, whatever its PR.
"resolved" hides a session from the default list; it deletes nothing.
"""
import argparse
import json
import os
import re
import subprocess
import sys

TITLE = re.compile(r'^(?:re-)?review #(\d+)\b', re.I)


def anima(*args):
    out = subprocess.run(['anima', 'session', *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out) if out.strip() else None


def sessions(cwd):
    offset = 0
    while True:
        page = anima('list_sessions', '--cwd', cwd, '--limit', '50', '--offset', str(offset))
        yield from page['sessions']
        if not page.get('hasMore'):
            return
        offset += len(page['sessions'])


def pr_state(cwd, number, cache={}):
    if number not in cache:
        out = subprocess.run(['gh', 'pr', 'view', number, '--json', 'state', '--jq', '.state'],
                             cwd=cwd, capture_output=True, text=True)
        cache[number] = out.stdout.strip() or f'unknown ({out.stderr.strip()[:60]})'
    return cache[number]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--cwd', default=os.getcwd(), help='the workspace (repo root); default: here')
    parser.add_argument('--dry-run', action='store_true', help='list what would be resolved, change nothing')
    opts = parser.parse_args()
    cwd = os.path.realpath(opts.cwd)

    resolved = kept = 0
    for s in sessions(cwd):
        match = TITLE.match(s.get('title') or '')
        if not match or s.get('disposition') != 'open':
            continue
        number, short = match.group(1), s['sessionId'][:8]
        state = pr_state(cwd, number)
        if s.get('runtimeStatus') == 'running':
            print(f'keep     {short}  #{number} {state}: still running')
            kept += 1
        elif state != 'MERGED':
            print(f'keep     {short}  #{number} {state}')
            kept += 1
        else:
            if not opts.dry_run:
                anima('set_status', '--sessionId', s['sessionId'], '--disposition', 'resolved')
            print(f'{"would resolve" if opts.dry_run else "resolved"}  {short}  #{number} merged: {s["title"][:70]}')
            resolved += 1
    print(f'{resolved} {"to resolve" if opts.dry_run else "resolved"}, {kept} kept')


if __name__ == '__main__':
    sys.exit(main())
