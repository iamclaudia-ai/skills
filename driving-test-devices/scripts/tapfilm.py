#!/usr/bin/env python3
"""
Times a tap on an Android phone from its own screen recording.
Written for evolution-mobile #345 (2026-11-08); see SKILL.md, "Measuring speed on a device".

    tapfilm.py record <name> <x> <y> [--serial S] [--secs 4] [--out DIR]
        screenrecords, taps (x, y) in device pixels ~1.2 s in, pulls DIR/<name>.mp4
        (default ./tmp/tapfilm), then analyses it. Serial defaults to $ANDROID_SERIAL.
    tapfilm.py analyse <file.mp4>...

Turn on show_touches first (adb shell settings put system show_touches 1), so
the tap's own frame is visible: the first change after the still lead-in is
the touch dot. screenrecord only writes a frame when the screen changes, so
each frame's timestamp is a change. The report lists every frame that differs
from the one before (mean absolute difference over a 108x240 grey copy), with
its time from the tap frame. Tap-to-form is the last big change.
"""

import subprocess
import sys
import os
import time
from pathlib import Path

W, H = 108, 240
OUT = Path('tmp/tapfilm')


def timestamps(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries',
         'frame=pts_time', '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True, check=True).stdout
    return [float(line.split(',')[0]) for line in out.split() if line.strip()]


def frames(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-fps_mode', 'passthrough',
         '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', '-'],
        capture_output=True, check=True).stdout
    size = W * H
    return [raw[i:i + size] for i in range(0, len(raw) - size + 1, size)]


def diff(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def analyse(path):
    ts = timestamps(path)
    fs = frames(path)
    n = min(len(ts), len(fs))
    events = []
    for i in range(1, n):
        d = diff(fs[i - 1], fs[i])
        # The tap lands ~1.2 s in; changes before 0.9 s are the lead-in
        # settling (a scroll indicator fading), not the tap.
        if d > 0.05 and ts[i] >= 0.9:
            events.append((ts[i], d, i))
    if not events:
        print(f'{path}: no change')
        return
    # The tap: the first change after the lead-in (the touch dot and the row's
    # press highlight, a small diff), so before and after share one anchor.
    tap = events[0][0]
    print(f'{path}: {n} frames, tap frame at {tap:.3f}s')
    for t, d, i in events:
        print(f'  +{(t - tap) * 1000:6.0f} ms  frame {i:3d}  diff {d:6.2f}')
    big = [e for e in events if e[1] > 1.0]
    if big:
        print(f'  first big change: +{(big[0][0] - tap) * 1000:.0f} ms, '
              f'last big change: +{(big[-1][0] - tap) * 1000:.0f} ms')


def record(name, x, y, serial, secs):
    remote = f'/sdcard/{name}.mp4'
    adb = ['adb', '-s', serial]
    rec = subprocess.Popen(adb + ['shell', 'screenrecord', '--time-limit', str(secs), remote])
    time.sleep(1.2)
    subprocess.run(adb + ['shell', 'input', 'tap', str(x), str(y)], check=True)
    rec.wait()
    OUT.mkdir(parents=True, exist_ok=True)
    local = OUT / f'{name}.mp4'
    subprocess.run(adb + ['pull', remote, str(local)], check=True, capture_output=True)
    subprocess.run(adb + ['shell', 'rm', remote], check=True)
    analyse(local)


if __name__ == '__main__':
    args = sys.argv[1:]
    serial = os.environ.get('ANDROID_SERIAL', '')
    secs = 4
    if '--serial' in args:
        i = args.index('--serial'); serial = args[i + 1]; del args[i:i + 2]
    if '--out' in args:
        i = args.index('--out'); OUT = Path(args[i + 1]); del args[i:i + 2]
    if '--secs' in args:
        i = args.index('--secs'); secs = int(args[i + 1]); del args[i:i + 2]
    if args[0] == 'record':
        record(args[1], int(args[2]), int(args[3]), serial, secs)
    else:
        for p in args[1:]:
            analyse(p)
