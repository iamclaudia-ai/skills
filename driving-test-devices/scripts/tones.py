#!/usr/bin/env python3
"""Find bursts of one tone in a WAV recording, to tell whether a device's sound was heard.

Usage: python3 -I tones.py <recording.wav> [frequency_hz=2093]

A 5 ms window counts when the tone's energy (Goertzel) is over a threshold AND five times
the energy at two side frequencies, so speech, a door or a cough can't pass for a beep.
Prints each burst's start (s), how long it is audible, its "core" (windows above a quarter
of its peak, which trims the room's echo), and its peak. Durations include echo: compare
bursts with each other, not with the clip's length.
"""
import math, struct, sys, wave

path = sys.argv[1]
freq = float(sys.argv[2]) if len(sys.argv) > 2 else 2093.0
w = wave.open(path)
n, r = w.getnframes(), w.getframerate()
if w.getsampwidth() != 2 or w.getnchannels() != 1:
    sys.exit('expects 16-bit mono (rec.swift writes that)')
d = struct.unpack('<%dh' % n, w.readframes(n))
win = r // 200  # 5 ms


def goertzel(seg, f):
    k = 2 * math.cos(2 * math.pi * f / r)
    s1 = s2 = 0.0
    for x in seg:
        s0 = x + k * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(max(s1 * s1 + s2 * s2 - k * s1 * s2, 0)) / len(seg)


def tone(seg):
    main = goertzel(seg, freq)
    side = max(goertzel(seg, freq * 0.76), goertzel(seg, freq * 1.24))
    return main if main > 5 * side else 0.0


p = [tone(d[i:i + win]) for i in range(0, n - win, win)]
noise = sorted(p)[len(p) // 2] or 0.3
thresh = max(noise * 8, 5)
print('%.1f s at %d Hz; looking for %.0f Hz. noise %.1f, threshold %.1f, peak %.1f'
      % (n / r, r, freq, noise, thresh, max(p)))
i = 0
while i < len(p):
    if p[i] > thresh:
        j = i
        while j < len(p) and (p[j] > thresh or any(q > thresh for q in p[j:j + 4])):
            j += 1
        seg = p[i:j]
        core = sum(1 for q in seg if q > max(seg) / 4) * 5
        print('burst at %.3fs, audible %3d ms, core %3d ms, peak %.0f'
              % (i * 0.005, (j - i) * 5, core, max(seg)))
        i = j
    else:
        i += 1
