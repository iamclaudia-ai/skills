#!/usr/bin/env python3
"""Control Lutron Caseta devices over LEAP (pylutron-caseta).

Runs on Python 3.9 (Apple's /usr/bin/python3 on Sedes): no match statements,
no `X | None` annotations.
"""
import argparse
import asyncio
import json
import sys

from pylutron_caseta import (
    FAN_HIGH,
    FAN_LOW,
    FAN_MEDIUM,
    FAN_MEDIUM_HIGH,
    FAN_OFF,
    _LEAP_DEVICE_TYPES,
)
from pylutron_caseta.smartbridge import Smartbridge

FAN_SPEEDS = {
    "off": FAN_OFF,
    "low": FAN_LOW,
    "medium": FAN_MEDIUM,
    "medium-high": FAN_MEDIUM_HIGH,
    "high": FAN_HIGH,
}
DOMAIN_BY_TYPE = {t: domain for domain, types in _LEAP_DEVICE_TYPES.items() for t in types}
SETTLE_SECONDS = 2.0
BELIEF_NOTE = "(the bridge's belief, not proof: confirm by eye)"


def percent(low):
    def parse(text):
        value = int(text)
        if not low <= value <= 100:
            raise argparse.ArgumentTypeError("must be {}-100".format(low))
        return value
    return parse


def domain_of(device):
    return DOMAIN_BY_TYPE.get(device.get("type"), "other")


def is_controllable(device):
    return device.get("zone") is not None and domain_of(device) in ("light", "switch", "fan", "cover")


def display_name(device):
    return device["name"].replace("_", " / ", 1)


def state_text(device):
    domain = domain_of(device)
    if domain == "fan":
        return "fan " + str(device.get("fan_speed"))
    level = device.get("current_state")
    if level is None or level < 0:
        return "-"
    if domain == "switch":
        return "on" if level > 0 else "off"
    return "off" if level == 0 else "on {}%".format(level)


def find_devices(bridge, query, match_all):
    devices = [d for d in bridge.get_devices().values() if is_controllable(d)]
    if query.isdigit():
        hits = [d for d in devices if d["device_id"] == query]
    else:
        tokens = query.lower().replace("_", " ").split()
        hits = [
            d for d in devices
            if all(t in d["name"].lower().replace("_", " ") for t in tokens)
        ]
    if not hits:
        names = ", ".join(display_name(d) for d in devices) or "none"
        sys.exit("No controllable device matches '{}'. Known: {}".format(query, names))
    if len(hits) > 1 and not match_all:
        names = "\n  ".join("{} (id {})".format(display_name(d), d["device_id"]) for d in hits)
        sys.exit("'{}' matches several devices; narrow it, use the id, or add --all:\n  {}".format(query, names))
    return hits


async def connect(args):
    base = "{}/{}".format(args.certs, args.bridge)
    bridge = Smartbridge.create_tls(args.bridge, base + ".key", base + ".crt", base + "-bridge.crt")
    await asyncio.wait_for(bridge.connect(), timeout=20)
    return bridge


def print_status(bridge, as_json):
    devices = sorted(bridge.get_devices().values(), key=lambda d: int(d["device_id"]))
    areas = {k: v.get("name") for k, v in bridge.areas.items()}
    rows = [
        {
            "id": d["device_id"],
            "name": d["name"],
            "area": areas.get(d.get("area")),
            "type": d.get("type"),
            "model": d.get("model"),
            "domain": domain_of(d),
            "zone": d.get("zone"),
            "level": d.get("current_state"),
            "fan_speed": d.get("fan_speed"),
        }
        for d in devices
    ]
    if as_json:
        print(json.dumps(rows, indent=2))
        return
    for r, d in zip(rows, devices):
        flag = "" if is_controllable(d) else "  (not controllable)"
        print("{:>3}  {:<36} {:<12} {:<26} {}{}".format(
            r["id"], display_name(d), state_text(d), "{} {}".format(r["type"], r["model"] or ""), r["area"] or "", flag))
    print(BELIEF_NOTE)


async def run(args):
    bridge = await connect(args)
    try:
        if args.command in ("status", "list"):
            print_status(bridge, args.json)
            return
        if args.command == "scenes":
            for s in bridge.get_scenes().values():
                print("{:>3}  {}".format(s["scene_id"], s["name"]))
            return
        if args.command == "scene":
            scenes = [s for s in bridge.get_scenes().values()
                      if args.target == s["scene_id"] or args.target.lower() in s["name"].lower()]
            if len(scenes) != 1:
                sys.exit("Need exactly one scene matching '{}', found {}".format(args.target, len(scenes)))
            await bridge.activate_scene(scenes[0]["scene_id"])
            print("Activated scene:", scenes[0]["name"])
            return

        targets = find_devices(bridge, args.target, args.all)
        for d in targets:
            dev_id = d["device_id"]
            domain = domain_of(d)
            if args.command == "fan":
                if domain != "fan":
                    sys.exit("{} is not a fan controller".format(display_name(d)))
                await bridge.set_fan(dev_id, FAN_SPEEDS[args.value])
            elif args.command == "on":
                level = 100 if args.value is None else int(args.value)
                await bridge.set_value(dev_id, level if domain == "light" else 100)
            elif args.command == "off":
                await bridge.turn_off(dev_id)
            elif args.command == "toggle":
                if bridge.is_on(dev_id):
                    await bridge.turn_off(dev_id)
                else:
                    await bridge.turn_on(dev_id)
            elif args.command == "level":
                if domain != "light":
                    sys.exit("{} is not dimmable ({})".format(display_name(d), d.get("type")))
                await bridge.set_value(dev_id, int(args.value))
        await asyncio.sleep(SETTLE_SECONDS)
        for d in targets:
            fresh = bridge.get_device_by_id(d["device_id"])
            print("{}: {}".format(display_name(fresh), state_text(fresh)))
        print(BELIEF_NOTE)
    finally:
        await bridge.close()


def main():
    p = argparse.ArgumentParser(prog="caseta", description="Lutron Caseta control over LEAP")
    p.add_argument("--bridge", required=True)
    p.add_argument("--certs", required=True)
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("status", help="every device, its type, area and level")
    s.add_argument("--json", action="store_true")
    s = sub.add_parser("list", help="alias of status")
    s.add_argument("--json", action="store_true")
    sub.add_parser("scenes", help="list bridge scenes")
    s = sub.add_parser("scene", help="activate a scene by id or name")
    s.add_argument("target")
    for name, needs_value, help_ in (
        ("on", False, "turn on (optional level 1-100 for dimmers)"),
        ("off", False, "turn off"),
        ("toggle", False, "flip based on the bridge's current belief"),
        ("level", True, "set a dimmer's level 0-100"),
        ("fan", True, "set a fan speed: " + ", ".join(FAN_SPEEDS)),
    ):
        s = sub.add_parser(name, help=help_)
        s.add_argument("target", help="device id, or words that all appear in its name (e.g. 'office light')")
        if name == "fan":
            s.add_argument("value", choices=list(FAN_SPEEDS))
        elif name == "level":
            s.add_argument("value", type=percent(0), metavar="0-100")
        elif name == "on":
            s.add_argument("value", nargs="?", type=percent(1), metavar="level")
        s.add_argument("--all", action="store_true", help="act on every match instead of refusing")

    args = p.parse_args()
    for attr in ("json", "all"):
        if not hasattr(args, attr):
            setattr(args, attr, False)
    if not hasattr(args, "value"):
        args.value = None
    try:
        asyncio.run(run(args))
    except asyncio.TimeoutError:
        sys.exit("Timed out connecting to the bridge at {} (is it on the LAN? is this a Local Network-blocked process?)".format(args.bridge))


if __name__ == "__main__":
    main()
