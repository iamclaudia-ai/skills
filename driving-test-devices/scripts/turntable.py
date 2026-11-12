#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyserial>=3.5"]
# ///
"""ComXim programmable turntable over USB serial (CH340, 115200 8N1).

Usage: tt.py 'CT+GETPN();' ['CT+GETFWV();' ...]
Sends each command, prints every reply line until CR+OK/CR+ERR (or a
TB_END event when --wait is given). Heartbeat '#' bytes are filtered out.
"""

import argparse
import glob
import sys
import time

import serial


def find_port() -> str:
    ports = glob.glob('/dev/cu.usbserial-*')
    if not ports:
        sys.exit('No /dev/cu.usbserial-* port: is the turntable plugged in?')
    return ports[0]


def read_replies(ser: serial.Serial, until: tuple[str, ...], timeout: float) -> list[str]:
    buf = ''
    out: list[str] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        # The firmware writes its degree sign in GBK (b'\xa1\xe3').
        chunk = ser.read(ser.in_waiting or 1).decode('gbk', errors='replace')
        if not chunk:
            continue
        buf += chunk.replace('#', '')
        while ';' in buf:
            msg, buf = buf.split(';', 1)
            msg = msg.strip()
            if not msg:
                continue
            out.append(msg + ';')
            if any(msg.startswith(u) for u in until):
                return out
    if buf.strip():
        out.append(buf.strip())
    return out


# The tablets on the table are cabled: never more than 180 degrees either way
# from zero (Michael, 2026-11-11). Zero is the cable-neutral position.
LIMIT = 180.0


def offset(ser: serial.Serial) -> float:
    ser.write(b'CT+GETOFFSETANGLE();')
    for r in read_replies(ser, ('CR+OK', 'CR+ERR'), 3.0):
        if r.startswith('OffsetAngle='):
            return float(r.split('=', 1)[1].strip().split('°')[0].split('�')[0].strip())
    sys.exit('No OffsetAngle reply')


def goto(ser: serial.Serial, target: float) -> None:
    """Turn to an absolute angle from zero (+ = clockwise), never crossing +/-LIMIT."""
    if abs(target) > LIMIT:
        sys.exit(f'Refusing {target:+.1f}°: outside ±{LIMIT:.0f}° (cables)')
    here = offset(ser)
    delta = round(target - here, 1)
    if abs(delta) < 0.1:
        print(f'Already at {here:+.1f}°')
        return
    direction = 0 if delta > 0 else 1  # 0 = clockwise (+), 1 = counterclockwise (-)
    start = time.monotonic()
    ser.write(f'CT+TURNSINGLE({direction},{abs(delta)});'.encode())
    replies = read_replies(ser, ('CR+EVENT=TB_END', 'CR+ERR'), 30.0)
    if not any(r.startswith('CR+EVENT=TB_END') for r in replies):
        sys.exit(f'Move did not finish: {replies}')
    print(f'{here:+.1f}° -> {offset(ser):+.1f}° in {time.monotonic() - start:.1f}s')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('commands', nargs='+', help="raw CT commands, or: goto <angle> | where")
    ap.add_argument('--port', default=None)
    ap.add_argument('--wait', action='store_true', help='wait for CR+EVENT=TB_END')
    ap.add_argument('--timeout', type=float, default=3.0)
    args = ap.parse_args()

    with serial.Serial(args.port or find_port(), 115200, timeout=0.1) as ser:
        if args.commands[0] in ('goto', 'where'):
            time.sleep(0.2)
            ser.reset_input_buffer()
            if args.commands[0] == 'where':
                print(f'{offset(ser):+.1f}°')
            else:
                goto(ser, float(args.commands[1]))
            return
        time.sleep(0.2)
        ser.reset_input_buffer()
        for cmd in args.commands:
            if not cmd.endswith(';'):
                cmd += ';'
            ser.write(cmd.encode())
            until = ('CR+EVENT=TB_END', 'CR+ERR') if args.wait else ('CR+OK', 'CR+ERR')
            replies = read_replies(ser, until, args.timeout)
            print(f'> {cmd}')
            for r in replies:
                print(f'  {r}')


if __name__ == '__main__':
    main()
