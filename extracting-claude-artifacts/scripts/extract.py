"""Extract a claude.ai artifact from a HAR into a folder that runs locally.

Usage: extract.py <capture.har> <out-folder> [--version <v>]

Writes:
  index.html  the page exactly as claude.ai served it (frame runtime included)
  run.html    the same page with the frame runtime stripped, so it runs standalone
  <files>     every sibling file the frame served under the same version, at its relative path

When the HAR holds several versions of the frame, the last one loaded wins unless --version picks
one (see `list`). Refuses to write into a non-empty folder.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from har_artifacts import body_bytes, fail, frame_location, load_entries, strip_runtime

argv = sys.argv[1:]
version_wanted = None
if "--version" in argv:
    index = argv.index("--version")
    if index + 1 >= len(argv):
        fail("--version needs a value")
    version_wanted = argv[index + 1]
    del argv[index : index + 2]
if len(argv) != 2:
    fail("usage: extract <capture.har> <out-folder> [--version <v>]")

har_path, out_dir = argv
out_dir = os.path.abspath(out_dir)
if os.path.isdir(out_dir) and os.listdir(out_dir):
    fail(f"{out_dir} is not empty; pick a new folder")

pages = []
files = {}
for entry in load_entries(har_path):
    location = frame_location(entry["request"]["url"])
    if not location:
        continue
    host, version, path = location
    if version_wanted and version != version_wanted:
        continue
    body = body_bytes(entry)
    if body is None:
        continue
    if path == "":
        pages.append((host, version, body))
    else:
        files.setdefault((host, version), {})[path] = body

if not pages:
    detail = f" for version {version_wanted}" if version_wanted else ""
    fail(f"no artifact page (_f/<version>/) with a body in this HAR{detail}; run `list` to see what's there")

host, version, page = pages[-1]
siblings = files.get((host, version), {})

os.makedirs(out_dir, exist_ok=True)
html = page.decode("utf-8")
with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as out:
    out.write(html)

standalone, stripped = strip_runtime(html)
with open(os.path.join(out_dir, "run.html"), "w", encoding="utf-8") as out:
    out.write(standalone)

for path, body in siblings.items():
    target = os.path.normpath(os.path.join(out_dir, path))
    if not target.startswith(out_dir + os.sep) or os.path.basename(target) in ("index.html", "run.html"):
        print(f"skipped unsafe or clashing path: {path}")
        continue
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "wb") as out:
        out.write(body)

print(f"frame {host.split('.')[0]}  version {version}  ->  {out_dir}")
print(f"  index.html  {len(page):,} B")
print(f"  run.html    {len(standalone.encode('utf-8')):,} B" + ("" if stripped else "  (no frame-runtime block found; identical to index.html)"))
for path, body in sorted(siblings.items()):
    print(f"  {path}  {len(body):,} B")
if len(pages) > 1:
    print(f"note: the HAR held {len(pages)} page loads; used the last one. Pass --version to choose.")

tag_reference = r'<(?:script|link|img|source|iframe)\b[^>]*?\s(?:src|href)=["\']?(?!https?:|//|data:|blob:|#|mailto:)([\w./-]+)'
referenced = set(re.findall(tag_reference, standalone))
missing = sorted(ref for ref in referenced if not os.path.exists(os.path.join(out_dir, ref.split("?")[0])))
if missing:
    print("warning: run.html references local files the HAR did not capture:")
    for ref in missing:
        print(f"  {ref}")
if "window.claude" in standalone:
    print("note: the page calls window.claude.* (artifact capabilities); those calls fail standalone.")
