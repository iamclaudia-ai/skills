---
name: controlling-caseta-lights
description: "MUST be used when you need to control or check Michael's Lutron Caseta devices: turn wall switches, dimmers, ceiling lights or fans on/off, dim them, set fan speed, run scenes, read what the bridge thinks each device is doing, or add, pair, reset or troubleshoot Caseta switches and the Smart Bridge. Talks LEAP to the Caseta Smart Bridge from Anima Sedes (forwards over ssh from other machines). Triggers on: caseta, lutron, smart bridge, wall switch, light switch, dimmer, office light, ceiling fan, fan speed, pico remote, turn off the office light, turn on the bedroom light, dim the lights, is the light on, switch not responding, pair a switch, add a switch, factory reset switch, LEAP, pylutron."
---

# Controlling Caseta Lights

Michael's house uses **Lutron Caseta** wall switches and dimmers (the house is old two-wire wiring with no neutrals, and Caseta's no-neutral dimmers work there). They talk 434 MHz Clear Connect radio to the **Caseta Smart Bridge 2** (L-BDG2-WH), which I control over its local LEAP API.

For the Govee TV backlight and curtain lights, use `controlling-lights` instead.

## When to Use

- Michael asks to turn a Caseta light/switch/fan on, off, dim it, or set fan speed
- "Is the office light on?" or checking what the bridge knows
- A new switch is being installed or added, or a switch stops responding

## Available Commands

Invoked through the anima skills runner. One command, `caseta`:

```bash
anima skills run controlling-caseta-lights caseta status            # every device, type, area, level
anima skills run controlling-caseta-lights caseta status --json
anima skills run controlling-caseta-lights caseta off office
anima skills run controlling-caseta-lights caseta on office          # 100%
anima skills run controlling-caseta-lights caseta on office 40       # dimmers: 1-100
anima skills run controlling-caseta-lights caseta level office 25
anima skills run controlling-caseta-lights caseta toggle office
anima skills run controlling-caseta-lights caseta fan "office fan" medium   # off|low|medium|medium-high|high
anima skills run controlling-caseta-lights caseta scenes
anima skills run controlling-caseta-lights caseta scene "Good Night"
```

`<device>` is the device id or words that all appear in its name (case-insensitive, `_` counts as a space). Several matches are refused with the list; add `--all` to act on all of them (e.g. `off bedroom --all`).

**Where it runs:** the script only talks to the bridge on **Anima Sedes**, which holds the bridge's client certificate. On any other machine (vesuvius), it forwards the same arguments over `ssh anima-sedes`, so the command line is identical everywhere.

## The Rule: The Bridge's State Is a Belief, Not Proof

Every result prints `(the bridge's belief, not proof: confirm by eye)`. Take that literally. The level the bridge reports is what it *believes*, and it updates that the moment it sends a command, whether or not the switch heard it. On Nov 7 a "verified" toggle showed 0 → 100 → 0 while the light never moved: the switch wasn't really joined.

- **Never tell Michael a light changed because the bridge says so.** Say what I sent, and ask him to confirm (or confirm another way).
- A healthy switch **reports physical paddle presses back** to the bridge. If he toggles by hand and `status` doesn't follow, that switch isn't talking to the bridge: see Troubleshooting.

## Devices (as of 2026-11-07)

| id | Name | Type | Notes |
| -- | ---- | ---- | ----- |
| 1 | Smart Bridge 2 | L-BDG2-WH | `192.168.1.202` (fixed IP), wired, USW Ultra port 3, MAC d4:e9:5e:16:9a:4d |
| 2 | Living Room / Repeater | PD-REP-WH | Extends Clear Connect range |
| 3 | Office / Ceiling Fan Light | PD-6WCL-XX (WallDimmer), zone 1 | Working end to end |

Michael is installing more switches through the house. Run `status` for the current list, and update this table when devices are added.

## Adding or Fixing a Switch (Michael does this in the Lutron app)

1. **Factory reset the switch** if it was ever paired before: triple tap **fast** (much faster than feels natural; a slow triple tap does nothing), then follow the app's reset steps.
2. In the **Lutron app**, add the device and **finish the flow, including the final Done**. Until Done, the bridge lists the device but the switch neither obeys nor reports. This was the Nov 7 gremlin.
3. Then test: ask Michael to toggle the paddle, run `status` and check it followed. Then send `off`/`on` and have him confirm by eye.

Clear Connect range is about **30 ft** through walls. A switch that pairs (up close) but won't respond once mounted is a range problem: the Living Room repeater or moving the bridge helps.

## Troubleshooting

- **Timeout connecting** → is the bridge on the LAN? Check with `managing-unifi-network` (`unifi clients` / known MAC above). It was once unplugged for weeks.
- **Device missing from `status`** → it isn't paired with the bridge (the Nov 7 office switch: the app showed "two devices", which were the bridge and the repeater).
- **Running from vesuvius directly fails ("No route to host")** → macOS Local Network privacy blocks Claude sessions there from LAN hosts (anima #135). That's why everything goes through Sedes.

## Setup Facts (Sedes)

- Venv `~/lutron/venv` with `pylutron-caseta` 0.26 (Python 3.9). Run it as **`/usr/bin/python3` with `PYTHONPATH=~/lutron/venv/lib/python3.9/site-packages`**: the venv's own `python` binary hangs (a Local Network prompt nobody answers). `scripts/caseta.sh` does this. Keep `caseta.py` Python 3.9 compatible.
- Client certs: `~/.config/pylutron_caseta/192.168.1.202{.key,.crt,-bridge.crt}`. Made by `~/lutron/venv/bin/lap-pair 192.168.1.202`, which waits for a **single short press** of the black button on the back of the bridge (a long hold can factory-reset it). Re-pair only if the certs are lost or the bridge is reset.
- Pairing over ssh: run `lap-pair` in the **foreground** (a `nohup` background job dies when ssh closes) and text Michael with `anima notify send` once it's listening, so he presses the button then and not before.
- Never name a Python script `inspect.py` (it shadows the stdlib module asyncio needs).
- `CASETA_BRIDGE` / `CASETA_SEDES_HOST` override the bridge IP and the ssh host.

## Later

Home Assistant (anima #134) will get the Caseta integration, and the Hey Claudia voice stations (#132) may route through it. Until then, this skill is the control path. Rollout tracking: anima #133.
