---
name: carving-ultrawide-wallpaper
description: "MUST be used when splitting one wide image into per-monitor wallpapers for a multi-display Mac so it spans the desk seamlessly, or when setting a different wallpaper per display from the command line. Carves a prepared canvas into each monitor's true physical window (horizon/edges line up across screens), supports an override for a physically-separated screen like a teleprompter, timestamps outputs to beat the macOS wallpaper cache, and sets each display by id via NSWorkspace. Triggers on: carve wallpaper, split wallpaper, ultrawide wallpaper, panoramic wallpaper, multi-monitor wallpaper, triple monitor wallpaper, span wallpaper across monitors, seamless wallpaper, per-display wallpaper, per-monitor wallpaper, set wallpaper macos, different wallpaper each monitor, slice image for monitors, prompter wallpaper, wallpaper won't change, wallpaper cache."
---

# Carving Ultrawide Wallpaper

Split one wide image into per-monitor files so a multi-display Mac shows **one
seamless scene across the desk** — the horizon and every edge line up where the
monitors meet. First built 2026-10-08 for Michael's triple-monitor + Elgato
prompter setup (a San Francisco night panorama).

## The one idea that makes it seamless

Each monitor is a **window onto one big canvas** at its *true physical position*.
Don't frame each crop as its own composition — resize/crop the canvas **once**
(editorially), then slice each display's rectangle out of it. Because the slices
come from the same canvas at the right offsets, they reassemble perfectly on the
desk, including across monitors of **different sizes** (a half-height center
monitor shows the bottom half of its column; its top edge sits exactly where the
horizon crosses the tall monitors).

The crop for each display is derived from `NSScreen` geometry:

```
canvas size   = arrangement bounding box   (maxX-minX  ×  maxTop-minY)
crop_x        = screen.minX  - arrangement.minX
crop_y        = arrangement.maxY(top) - screen.maxY     # macOS y grows up; image y grows down
crop_w, crop_h= screen.width, screen.height
```

`scripts/displays.swift list` prints this per display, so you never compute it by hand.

## Prerequisites

- **ImageMagick** (`magick`) and **Swift** (Xcode Command Line Tools). macOS only.
- A **prepared canvas** sized to the arrangement bounding box. Framing is a *taste*
  call (where the skyline sits, etc.) — do it in an image editor first. This skill
  slices; it does not make editorial decisions. (Michael preps a `.psd` and exports
  a flattened `.jpg`.)

## Workflow

1. **See the layout** — find the bbox (your canvas size) and each crop:
   ```
   anima skills run carving-ultrawide-wallpaper displays
   ```
2. **Prepare the canvas** at exactly the bbox (e.g. `7680x2880`). Keep the source
   under its own folder, e.g. `~/Pictures/wallpaper/<set>/<image>.jpg`.
3. **Verify the seam** (optional but satisfying) — reconstructs the desk so you can
   eyeball continuity before changing anything:
   ```
   anima skills run carving-ultrawide-wallpaper seam-check ~/Pictures/wallpaper/<set>/<image>.jpg
   ```
4. **Carve + apply**:
   ```
   anima skills run carving-ultrawide-wallpaper apply ~/Pictures/wallpaper/<set>/<image>.jpg
   ```
   Add an override for any physically-separated screen (see below). `--no-set`
   carves only; `--resize` cover-crops a mis-sized canvas (re-crops framing — avoid).

## Physically-separated screens (the prompter case)

A screen whose macOS arrangement says "attached to the top of center" but is really
mounted **with a gap** (inches of air) shouldn't use its seamless position — there's
nothing to be seamless *with*. Center its crop within the region instead, and pick
the slice editorially (Michael added a full moon to the sky so the prompter has a
subject, then framed the moon upper-right). Override by name substring:

```
anima skills run carving-ultrawide-wallpaper apply ~/Pictures/wallpaper/sanfran/aniket-deole-HWK1zd0OxUU-unsplash.jpg \
  "Elgato=1024x600+3600+405"
```

Michael's layout (for reference):

| Role     | Display        | Size       | Crop (from a 7680×2880 canvas) |
| -------- | -------------- | ---------- | ------------------------------- |
| left     | `LG SDQHD (1)` | 2560×2880  | `+0+0`        (bridge)          |
| center   | `J522J23`      | 2560×1440  | `+2560+1440`  (bottom half — horizon at its top edge) |
| right    | `LG SDQHD (2)` | 2560×2880  | `+5120+0`     (skyline + Pyramid) |
| prompter | `Elgato Prom.` | 1024×600   | `1024x600+3600+405` (override — centered-ish, moon upper-right) |

The two LGs are 2560×2880 (LG DUAL UP); the center is 2560×1440 — deliberately
**half the height**, so cursor/windows cross displays with no size jump.

## Gotchas we actually hit

- **macOS caches the wallpaper by file path.** Overwrite a file in place and the old
  image keeps showing. `apply` writes **timestamped filenames** every run (and deletes
  that display's prior timestamps) so the change always takes.
- **`(1)`/`(2)` name suffixes are enumeration order, not physical left/right.** Here
  `(1)` is the *left* monitor. Always map by **position/id**, never the suffix — the
  tools key on `CGDirectDisplayID`.
- **`NSScreen` is the source of truth for size, not `system_profiler`.** `system_profiler`
  reported the center as "5120×2880"; `NSScreen` (what the desktop actually uses) says
  2560×1440 — which is correct and means the crop maps 1:1.
- **Crop, don't resize, per slice.** A `-crop WxH+X+Y` of the big canvas is the whole
  trick. If a result looks like the *entire* scene shrunk into one panel, you resized
  instead of cropped (or you're looking at a **stale QuickLook/preview thumbnail** — a
  fresh filename or `qlmanage -r` clears it).
- **ImageMagick `-annotate` font on fresh macOS:** pass an explicit font, e.g.
  `-font /System/Library/Fonts/Supplemental/Arial.ttf`, or it errors with an empty
  font path.
- **Per-Space:** `setDesktopImageURL` sets the current Space. Re-run if you use several.

## Files

- `scripts/displays.swift` — `list` (geometry + seamless crop + bbox) / `set <id> <file> …`
- `scripts/list-displays.sh` — pretty display table + bbox
- `scripts/seam-check.sh` — reconstruct the desk to verify continuity (preview PNG)
- `scripts/carve-and-apply.sh` — carve (timestamped) + set, with per-screen overrides
