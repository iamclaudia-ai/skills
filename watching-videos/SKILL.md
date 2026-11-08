---
name: watching-videos
description: "MUST be used when you need to watch, understand, summarize or pull information out of a video: an X/Twitter video, YouTube, a screen recording, a local .mp4/.mov, a video in Michael's bookmark archive. Turns it into key frames (scene changes + an even grid, on one contact sheet) and a timestamped transcript (site captions, or local parakeet-mlx / mlx-whisper), then you look at the frames with Read. Also reads small on-screen text (prompts, code, slides) by cropping and enlarging a full-resolution frame. Local and free. Triggers on: watch this video, what's in this video, summarize the video, video transcript, transcribe a video, video frames, key frames, contact sheet, screen recording, tweet video, X video, YouTube video, read the text in the video, prompt shown in a video, download a video, yt-dlp, scene detection, I can't watch videos."
---

# Watching Videos

I can't play video, but I can look at images and read text. `watch.ts` turns a video into both: a contact
sheet of key frames and a timestamped transcript, written to one folder with a `WATCH.md` to read first.

```bash
W=~/.claude/skills/watching-videos/scripts
bun $W/watch.ts https://x.com/user/status/123                  # → ./tmp/videos/123/WATCH.md
bun $W/watch.ts ~/.anima/x-bookmarks/media/<id>/1-video.mp4    # → beside the file, 1-video.watch/
bun $W/watch.ts <url> --quality best --frames 6                # screen recording: full resolution
bun $W/watch.ts <url> --stt whisper                            # non-English speech (Korean, …)
bun $W/watch.ts <url> --from 60 --to 180 --frames 16           # just one stretch, more densely
bun $W/frame.ts <video> 1:05 --crop 0,0,0.5,0.5 --scale 2      # read small text in one frame
```

Then **Read `sheet.jpg`** (frames numbered left to right, top to bottom), Read single frames from `frames/` where
you need detail, and read the transcript in `WATCH.md`. Say what you saw *and* what you couldn't (no audio,
frames between samples).

## What it does

1. **Download** (URLs) with `yt-dlp`: ≤720p by default, plus the site's captions and `info.json` (title, uploader,
   description). Works for X, YouTube and most sites. Re-running reuses the download.
2. **Frames**: ffmpeg's scene score (`--scene`, default 0.3) finds cuts; an even grid of `--frames` (default 12)
   covers static stretches; both merge (a real cut wins over a nearby grid point) and thin evenly to `--frames`.
   Frames are 768 px wide (`--width`); the sheet is 4 across.
3. **Transcript**: captions if the site had them, else local speech-to-text: `parakeet-mlx` (default: fast,
   English and 24 European languages) or `--stt whisper` (`mlx-whisper` large-v3-turbo via `uvx`, any language,
   ~1–2 minutes for a minute of audio, model downloads on first use). `--stt none` skips it.

## Reading small text: frame.ts

Prompts in an editor pane, code, terminal output: the 768 px frames make them a blur. Download at full
resolution (`--quality best`), find the moment in the sheet, then crop the region and enlarge:

- `--crop x,y,w,h` in fractions of the frame (`0.22,0.08,0.25,0.5` = a column starting 22% from the left).
- Crop **narrow enough that the text is legible, then step across** (left half, right half) rather than one wide
  crop: at a ~700 px wide image the model reads monospace text reliably, wider gets lossy.
- First used to recover a whole prompt from @LouisLibre's "Feynman diff explainer" video (2624×1696 source; at
  720p the same text was barely readable).

## Traps

- **vesuvius only for now.** Anima Sedes has the skill linked but not `yt-dlp`, `ffmpeg`, `parakeet-mlx` or `uv`
  (checked 2026-11-07). Install them with Homebrew there before relying on it.
- **Background music becomes "lyrics".** Whisper transcribes a song as if it were speech (the bookmarked
  back-pain video came back as a pop chorus). If the transcript reads like lyrics, the content is visual:
  on-screen text, demonstrations. Say so instead of summarizing the lyrics.
- **No audio track** is common on X (screen recordings, GIFs). The frames are all there is.
- The 720p default halves a 4K screen recording. Use `--quality best` when there's text to read.
- Twelve frames sample a 10-minute talk every 50 s. For long videos, use `--from/--to` on the parts that matter,
  or raise `--frames` (the sheet gets tall; open single frames instead).
- Watching costs context: a sheet is one image, but each extra frame is another. Start with the sheet.
- X videos via yt-dlp need no login for public tweets. For Michael's archived bookmarks, the files are already
  local (`~/.anima/x-bookmarks/media/<tweet id>/`, see browsing-twitter).

## Alternatives considered (2026-11-07)

Several open-source "let Claude watch a video" skills do the same thing (bradautomates/claude-video `/watch`,
claude-real-video, video-analyzer-skill). We built our own small script instead, so it uses parakeet-mlx (already
installed, local), `frame.ts` crop-and-zoom, and the bookmark archive's local files. Gemini can also take a video
directly (`GEMINI_API_KEY` is set) if a model needs to judge motion over time rather than stills; not wired up.
