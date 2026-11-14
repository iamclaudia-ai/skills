#!/usr/bin/env python3
"""Upload the local screenshots a PR body references, and point the body at them.

    pr-screenshots.py <pr-number>

Run from the repo root (my gh wrapper picks the account from the current directory), after the PR
body is up with images referenced by local path, either form:

    <img src="./tmp/task/phone-390.png" width="260" alt="Phone, 390">
    ![Desktop, 1280](./tmp/task/desktop.png)

It reads the PR's *live* body (so a gh-stack footer survives), uploads every referenced local file
with `gh pr edit --attach` (gh 2.98+; GitHub's own user-attachments storage, the same as dragging an
image into the web editor), and rewrites each reference to the uploaded URL.

Why the second pass: `--attach` rewrites markdown `![](./file)` references itself, but it leaves an
HTML `<img src="./file">` alone and appends the image as `![name](url)` at the end instead. `<img>`
is what sets a width, so phone and desktop shots can sit side by side in a table. This swaps the
appended URLs into the matching `<img>` tags (matched by file name, so names must be unique within
one PR body) and deletes the appended copies.
"""
import os
import re
import subprocess
import sys
import tempfile

ATTACHED = re.compile(r"!\[([^\]]*)\]\((https://github\.com/user-attachments/assets/[^)\s]+)\)")
VIDEO = (".mp4", ".mov")
LOCAL = re.compile(r"""(?:src="|\]\()(\./[^")\s]+\.(?:png|jpe?g|gif|webp|mp4|mov))""")


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def body_of(pr: str) -> str:
    return gh("pr", "view", pr, "--json", "body", "--jq", ".body")


def save(pr: str, body: str, attach: list[str] = ()) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(body)
    try:
        gh("pr", "edit", pr, "--body-file", f.name, *[a for p in attach for a in ("--attach", p)])
    finally:
        os.unlink(f.name)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pr = sys.argv[1]
    body = body_of(pr)
    paths = list(dict.fromkeys(LOCAL.findall(body)))
    if not paths:
        sys.exit(f"PR #{pr}'s body references no local images (./path.png); nothing to upload.")
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        sys.exit("not found (run from the repo root?): " + ", ".join(missing))
    stems = [os.path.splitext(os.path.basename(p))[0] for p in paths]
    if len(set(stems)) != len(stems):
        sys.exit("two images share a file name; rename them so each can be matched back")

    # Upload with alt text = file stem, so each appended copy can be matched to its <img>. gh refuses alt text
    # on a video ("cannot set alt text on video"), and rewrites a video's ![](./clip.mp4) to a bare URL itself.
    save(pr, body, [p if p.endswith(VIDEO) else f"{p}#{s}" for p, s in zip(paths, stems)])

    body = body_of(pr)
    for alt, url in ATTACHED.findall(body):
        tag = re.compile(r'src="\./[^"]*?/?' + re.escape(alt) + r'\.\w+"')
        if tag.search(body):
            body = tag.sub(f'src="{url}"', body, count=1)
            body = re.sub(r"\n*!\[" + re.escape(alt) + r"\]\(" + re.escape(url) + r"\)", "", body)
    left = LOCAL.findall(body)
    save(pr, body)
    for p in paths:
        print(f"uploaded {p}")
    if left:
        sys.exit("still pointing at local files: " + ", ".join(left))


if __name__ == "__main__":
    main()
