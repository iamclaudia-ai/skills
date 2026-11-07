---
name: managing-unifi-network
description: "MUST be used when checking, diagnosing, or reporting on Michael's home network (UniFi Dream Router 7, USW Ultra switch, U7 Pro access point), without his browser. Read-only CLI over UniFi's cloud connector: one-shot sweep that flags problems, WAN/internet health and latency, device state, Wi-Fi radio channels and airtime, switch ports, every client's network/SSID/band/signal/satisfaction/throughput, networks/VLANs, and SSIDs. Triggers on: unifi, home network, wifi slow, network slow, internet slow, is the internet down, wifi check, network sweep, who is on the wifi, connected devices, client list, which band, 2.4 GHz, 5 GHz, 6 GHz, channel utilization, airtime, access point, AP offline, U7 Pro, Dream Router, UDR7, switch port, VLAN, IoT network, SSID, wifi signal, ping spikes, latency, packet loss."
---

# Managing the UniFi Network

Michael's home network runs on UniFi. This skill reads it through UniFi's **cloud connector**, so it works from any machine with the API key, with no browser and no LAN access needed.

## When to Use

- "The network/Wi-Fi/internet feels slow": start with `sweep`, then `health`
- Finding which device is on which network, SSID, band or switch port
- Checking radio channels, airtime (channel utilization) and retries
- Checking whether a device or access point is offline
- Looking at VLANs, mDNS/IGMP settings, or which SSID maps to which network

## Read-only, except names and device types

Every command reads only (`GET`), except **`rename`** (a client's display name) and **`set-type`** (the device type UniFi guessed, which sets its icon and model). Michael asked me to manage both (2026-11-07): change a client once its identity is **confirmed** (MAC vendor, adb/devicectl/WDA, join timing, or Michael telling me), say what I changed, and ask first when it's a guess. Neither changes anything without `--yes`. The UniFi web UI only offers the alias, not the type, so `set-type` is the only way he has to fix a type.

**Every other write (restart a device, block or kick a client, change a channel, SSID, VLAN or any other setting) needs Michael's explicit OK first**, and the CLI doesn't implement any of them. If a fix needs a config change, tell Michael what you'd change and why.

## Available Commands

One runner command, `unifi`, with subcommands:

| Subcommand | Shows |
| --- | --- |
| `sweep` | One-shot check. ⚠ warnings: devices offline unexpectedly, radios ≥60% airtime, phones/laptops on the IoT/guest network or on 2.4 GHz, satisfaction <70, port errors or half duplex, high latency, gateway CPU/mem. ℹ notes: expected-offline devices, weak signals, high retries, ports below gigabit |
| `health` | Gateway CPU/mem/uptime, WAN (ISP, IP, link speed, throughput), internet latency, availability and monitors, Wi-Fi and LAN summary |
| `devices [--ports]` | Each device's state, uptime, CPU/mem; radios (band, channel, width, airtime split into own tx/rx vs other, stations, retries, power); switch ports (speed, PoE, rates, errors, drops). Only up ports unless `--ports` |
| `clients` | Every client: IP, network, SSID + band + channel (or switch + port), signal, link rates, satisfaction, retries, throughput, uptime. Filters: `--network <name or SSID>`, `--band 2.4\|5\|6`, `--wired`, `--wifi`, `--sort traffic\|signal\|satisfaction\|name` |
| `networks` | Networks/VLANs: purpose, VLAN id, subnet, DHCP range, mDNS, IGMP snooping, SSIDs, client count |
| `wlans` | SSIDs: network, bands, security, guest/IoT flags, client count |
| `hosts [--refresh]` | Consoles on the account; `--refresh` re-resolves the cached host id |
| `raw <path>` | GET any path (see below). Secrets are always redacted |
| `rename <mac> "<name>" [--yes]` | Set a client's display name (`PUT rest/user/<id>`), then read it back to confirm. Without `--yes` it only prints the change. `""` clears the name |
| `types "<search>"` | Search UniFi's device-type catalog (`v2/api/fingerprint_devices/0`, ~6,000 types, cached a week) for an id |
| `set-type <mac> <type-id> [--yes]` | Override a client's device type (`PUT v2/api/site/default/station/<mac>/fingerprint_override`). `PUT rest/user` with `dev_id_override` returns 200 but **ignores it**. Verify with the v2 clients endpoint: `fingerprint.has_override`, `model_name` |

Add `--json` to any subcommand for machine-readable output.

```bash
anima skills run managing-unifi-network unifi sweep
anima skills run managing-unifi-network unifi health
anima skills run managing-unifi-network unifi devices --ports
anima skills run managing-unifi-network unifi clients --band 2.4 --sort signal
anima skills run managing-unifi-network unifi clients --network IoT
anima skills run managing-unifi-network unifi networks
anima skills run managing-unifi-network unifi wlans
anima skills run managing-unifi-network unifi raw api/s/default/stat/health
anima skills run managing-unifi-network unifi raw integration/v1/sites
anima skills run managing-unifi-network unifi raw v1/devices
```

Outside Anima, run it directly: `bun ~/.claude/skills/managing-unifi-network/scripts/unifi.ts sweep`.

## How it connects

- **Key:** `UNIFI_API_KEY`, from the environment, else by sourcing `~/dotfiles/secrets/apikeys.sh` in a subshell, else from Anima's `.env` (`~/Projects/iamclaudia-ai/anima` on vesuvius, `~/Projects/anima` on Sedes). Never print it. Sedes has no `apikeys.sh`; her key is in her Anima `.env`. (`UNIFI_SECRETS_FILE` overrides the path.)
- **It's a Site Manager (cloud) key.** The local console (`https://192.168.1.1`) answers **401** to it. Don't try to use it locally.
- **Base URL:** `https://api.ui.com/v1/connector/consoles/<hostId>/proxy/network/<path>`, header `X-API-KEY`. The host id comes from `GET https://api.ui.com/v1/hosts` (the console with an active `network` controller) and is cached in `~/.cache/unifi/host.json`. `UNIFI_HOST_ID` overrides it.
- **Both APIs work through the connector:** the official `integration/v1/*` and the legacy `api/s/default/{stat,rest,get}/*`. The CLI uses the legacy one because it's far richer (radio stats, per-client rates, port counters). Useful legacy paths: `stat/health`, `stat/device`, `stat/sta`, `rest/networkconf`, `rest/wlanconf`, `rest/setting`, `stat/event`, `stat/alarm`.
- `raw` paths starting with `v1/` go to Site Manager itself (`v1/hosts`, `v1/devices`, `v1/sites`).

## Known state (`known-state.json`)

Devices listed under `expectedOffline` show as ℹ "expected", not ⚠. Right now:

- **U7 Pro**: offline because it's being moved to the east side of the house and isn't wired yet. Once it's wired, the Dream Router covers the west and the U7 Pro the east. **Remove it from `known-state.json` when it's back online.** Don't present its absence as a fault.

Also: the Wi-Fi subsystem shows `warning` purely because of that AP.

## Reading the numbers

- **Airtime** (`cu_total`) is the % of time the channel is busy. `self tx/rx` is this AP's own traffic; `other` is neighbors and noise. Above ~60% clients start to feel it. 2.4 GHz is always the busiest band here (20 MHz wide, full of IoT gadgets).
- **Radio retries** is a short-window counter and swings a lot between reads. Look at the trend, not one sample.
- **Satisfaction** is UniFi's 0-100 experience score per client (−1 or blank = not enough data).
- **Signal** in dBm: −30 to −60 great, −60 to −70 fine, below −75 weak.
- iPhones use a private (randomized) Wi-Fi address per network, so several show up as plain `iPhone`. To tell which is which, match the MAC with the phone's Settings → Wi-Fi → ⓘ → Wi-Fi Address, or match the association time (`raw api/s/default/stat/sta`, `assoc_time`) to when it joined. Michael's iPhone on `volcanictech` is `12:cd:72:ef:59:93` (it joined at 14:00 on 2026-11-07, the second his phone left the IoT SSID).
- iOS **rotates** private addresses (about every two weeks), so one phone piles up several `iPhone` entries in `raw api/s/default/rest/user` (every client ever seen, with `first_seen`/`last_seen`). Claudia's iPhone 15 is `.134`: WDA's `ServerURLHere` log line and `wda.py status` give its live IP.
- **UniFi's device-type guesses are mostly wrong here.** `raw "v2/api/site/default/clients/active?includeTrafficUsage=false"` gives `display_name` and `fingerprint` (`model_name`, `has_override`); about 20 clients read "Apple TV 4K" (a Galaxy, a Chromecast, Tuya plugs) and several read "iPhone 15 Pro Max" (panarea's Wi-Fi adapter, an Echo). Don't trust a type without a MAC, hostname, or timing check. Fixing one means a fingerprint override, which is a write: ask Michael first.
- `stat/event` returns 404 through the connector.
- Unnamed clients show their vendor (OUI) or MAC. `wlan0` clients are usually smart plugs and other ESP-based gadgets.
- Client `↓/↑` is the client's download/upload (the AP's or switch port's tx is the client's download).

## Network facts (Nov 2026)

- **Networks:** Default (untagged, 192.168.1.0/24, SSID `volcanictech`, 2.4+5+6 GHz), IoT (VLAN 2, 192.168.2.0/24, SSID `volcanictech-iot`, 2.4 GHz only), Guest (VLAN 3, 192.168.3.0/24), One-Click VPN. mDNS on for all; IGMP snooping off.
- Nearly every gadget is still on Default. Michael's plan: add an IoT-5 (5 GHz) SSID for the streaming devices and move the gadgets off Default. He's holding off until the vesuvius UDP-leak investigation finishes, so **don't push config changes**.
- **Wired:** vesuvius `.14` (USW Ultra port 6), anima-sedes `.157` (port 5), panarea `.44` (port 4, 100 Mbps), Living-Room Apple TV `.55` (router port 2). The switch uplinks to router port 1; router port 4 is the 2.5G WAN (MediaCom).
- **Naming convention** (all applied 2026-11-07): owner + device (`Michael's iPhone`, `Claudia's iPad`), a machine with two links gets `(Wi-Fi)` / `(wired)` (`vesuvius`, `Anima Sedes`, `panarea`), and a device's old IoT-SSID address gets `(IoT address)` so a sweep shows at once if it drifts back there.
- **UniFi's "vendor" column shows the guessed type's maker, not the MAC's.** A Ring device guessed as "Apple TV 4K" shows vendor Apple. Trust the MAC prefix: `18:7f:88` is Ring, `10:bf:67` / `40:f6:bc` / `fc:49:2d` / `58:a8:e8` are Amazon, `c0:95:6d` is Apple (the Apple TVs), `10:d5:61` / `d8:1f:12` / `a0:92:08` are Tuya plugs and sensors. Look up an unknown prefix with `curl -s https://api.macvendors.com/<first 3 octets>`.
- Types set 2026-11-07: Galaxy S25, Pixel 7A, Apple Watch Ultra 3, Mac Mini 2024 (Sedes Wi-Fi), MacBook Pro 16" M3 Max (vesuvius, both links), Dell OptiPlex 7070 Micro (panarea Wi-Fi), Apple iPhone (Lisa's), HP Printer MFP (OfficeJet), BOOX Go Color 7 (closest to the Go 10.3, which isn't in the catalog).
- **Michael's IoT plan:** the IoT SSID exists because the Elgato Key Light kept dropping on 5 GHz and needs 2.4 GHz. New gadgets go on IoT; the streaming devices will get an IoT-5 (5 GHz) SSID; personal devices stay on `volcanictech`.
- **Who's who (checked 2026-11-07):** Michael's iPhone 15 Pro Max `.153`; Claudia's iPhone 15 `.134`, iPad `.244` (`02:e4:d9:aa:85:56`), Galaxy S25 `.185`; Pixel 7a `.26`; Lisa's iPhone `.133` (living room). Living Room Apple TV is wired (`c0:95:6d:5a:44:f3`, router port 2); HP OfficeJet `.23`. Master Bedroom Apple TV (Wi-Fi, `c0:95:6d:6b:45:bb`); Google Home Mini (office, `38:86:f7:0c:d1:2d`, unused); Ring Chime (living room, `18:7f:88:ff:44:86`, the stronger one) and Ring Doorbell Camera (front door, `18:7f:88:cf:0d:30`, weak and retrying: it was near the U7 Pro before that came down); Office DSLR plug (Kasa EP10, `3c:64:cf:93:d6:5d`, the DSLR webcam's Stream Deck power switch).
- **Coverage gap:** the living room and the front door sit behind a couple of walls from the office. The U7 Pro's new spot (or another AP) should cover them.
- **Still to map (Michael's inventory):** five Amazon Echos (Echo Show in the kitchen, Echo Show mini in the office, Echo Dots in his bedroom, the living room and upstairs) = the five Amazon MACs `fc:49:2d:7d:e6:c1` (2.4G −32, likely the office), `10:bf:67:08:b6:e7`, `10:bf:67:88:d2:30`, `40:f6:bc:e0:b3:cd` (the only 2x2 radio, maybe the Show), `58:a8:e8:92:8e:be` (−82, farthest). The upstairs Apple TV is probably `8c:26:aa:de:f6:41` (hostname `Bedroom-South`, last seen Nov 6). The Alexa app shows each Echo's MAC (device → About), which settles them. "Nokia 6" `.135` is the **BOOX Go 10.3** e-ink tablet (confirmed over adb). Macs: vesuvius (MacBook Pro M3 Max, wired `.14` via CalDigit + Wi-Fi `.248` "Mac"), rainier (MacBook Pro 16" 2019, Wi-Fi `.22`), Michael's work MacBook (MDM, name can't change; seen as `MichaelrtersMBP` until Oct 24). panarea = the Windows machine (Dell, wired `.44`, Wi-Fi `.213`).
- Personal devices belong on `volcanictech` at 5/6 GHz. Phones on the IoT SSID get stuck on 2.4 GHz (this happened to Michael's iPhone once: IoT setup apps sometimes need the phone on 2.4 GHz while pairing). Michael turned off auto-join for the IoT SSID.

## Notes

- Each command makes 1-5 GETs through the cloud and takes a few seconds.
- The sweep's "personal device" check matches names (iPhone, iPad, Mac, Pixel, Galaxy, Watch, and the house Macs). Update `isPersonal()` in `scripts/unifi.ts` if new devices show up under other names.
- A 401 from `api.ui.com` means the key was revoked or rotated: ask Michael for a new Site Manager key (unifi.ui.com → API).
