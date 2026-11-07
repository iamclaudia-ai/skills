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

## Read-only, always

The CLI only sends `GET`. **Any write (restart a device, block or kick a client, change a channel, SSID, VLAN or any other setting) needs Michael's explicit OK first**, and v1 doesn't implement writes at all. If a fix needs a config change, tell Michael what you'd change and why, and let him do it in the UniFi app or approve a separate change.

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
- Unnamed clients show their vendor (OUI) or MAC. `wlan0` clients are usually smart plugs and other ESP-based gadgets.
- Client `↓/↑` is the client's download/upload (the AP's or switch port's tx is the client's download).

## Network facts (Nov 2026)

- **Networks:** Default (untagged, 192.168.1.0/24, SSID `volcanictech`, 2.4+5+6 GHz), IoT (VLAN 2, 192.168.2.0/24, SSID `volcanictech-iot`, 2.4 GHz only), Guest (VLAN 3, 192.168.3.0/24), One-Click VPN. mDNS on for all; IGMP snooping off.
- Nearly every gadget is still on Default. Michael's plan: add an IoT-5 (5 GHz) SSID for the streaming devices and move the gadgets off Default. He's holding off until the vesuvius UDP-leak investigation finishes, so **don't push config changes**.
- **Wired:** vesuvius `.14` (USW Ultra port 6), anima-sedes `.157` (port 5), panarea `.44` (port 4, 100 Mbps), Living-Room Apple TV `.55` (router port 2). The switch uplinks to router port 1; router port 4 is the 2.5G WAN (MediaCom).
- Personal devices belong on `volcanictech` at 5/6 GHz. Phones on the IoT SSID get stuck on 2.4 GHz (this happened to Michael's iPhone once: IoT setup apps sometimes need the phone on 2.4 GHz while pairing). Michael turned off auto-join for the IoT SSID.

## Notes

- Each command makes 1-5 GETs through the cloud and takes a few seconds.
- The sweep's "personal device" check matches names (iPhone, iPad, Mac, Pixel, Galaxy, Watch, and the house Macs). Update `isPersonal()` in `scripts/unifi.ts` if new devices show up under other names.
- A 401 from `api.ui.com` means the key was revoked or rotated: ask Michael for a new Site Manager key (unifi.ui.com → API).
