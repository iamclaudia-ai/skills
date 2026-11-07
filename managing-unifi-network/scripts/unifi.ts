#!/usr/bin/env bun
/**
 * Read-only UniFi Network CLI, through UniFi's cloud connector.
 *
 * The key is a Site Manager (cloud) key, so the local console rejects it with a 401.
 * Every call goes through:
 *   https://api.ui.com/v1/connector/consoles/<hostId>/proxy/network/<path>
 * with the header X-API-KEY. Both the official `integration/v1/*` API and the
 * legacy `api/s/<site>/{stat,rest,get}/*` endpoints work behind it.
 *
 * This tool only ever sends GET. Writes (restart a device, block a client,
 * change config) need Michael's explicit OK and are deliberately not built.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.ui.com";
const SITE = process.env.UNIFI_SITE ?? "default";
const SECRETS_FILE = process.env.UNIFI_SECRETS_FILE ?? join(homedir(), "dotfiles/secrets/apikeys.sh");
// vesuvius keeps Anima at ~/Projects/iamclaudia-ai/anima, Sedes at ~/Projects/anima.
const ANIMA_ENV =
  [process.env.ANIMA_REPO, join(homedir(), "Projects/iamclaudia-ai/anima"), join(homedir(), "Projects/anima")]
    .filter((dir): dir is string => Boolean(dir))
    .map((dir) => join(dir, ".env"))
    .find((p) => existsSync(p)) ?? join(homedir(), "Projects/iamclaudia-ai/anima/.env");
const CACHE_DIR = join(homedir(), ".cache/unifi");
const HOST_CACHE = join(CACHE_DIR, "host.json");
const SKILL_DIR = process.env.SKILL_DIR ?? join(import.meta.dir, "..");
const KNOWN_STATE = join(SKILL_DIR, "known-state.json");

// Thresholds the sweep flags.
const AIRTIME_BUSY = 60; // % channel utilization
const SATISFACTION_LOW = 70; // UniFi's 0-100 experience score
const SIGNAL_WEAK = -75; // dBm
const RETRIES_HIGH = 25; // % of Wi-Fi tx attempts retried

type Json = Record<string, unknown>;
type Row = Record<string, string | number>;

// ───────────────────────────── key + host ─────────────────────────────

/** Env first, then source apikeys.sh in a subshell, then Anima's .env. Never printed. */
function loadKey(): string {
  if (process.env.UNIFI_API_KEY) return process.env.UNIFI_API_KEY;
  if (existsSync(SECRETS_FILE)) {
    const out = Bun.spawnSync(
      ["bash", "-c", 'source "$1" >/dev/null 2>&1; printf %s "${UNIFI_API_KEY:-}"', "_", SECRETS_FILE],
      { stdout: "pipe", stderr: "ignore" },
    );
    const key = out.stdout.toString().trim();
    if (key) return key;
  }
  if (existsSync(ANIMA_ENV)) {
    const line = readFileSync(ANIMA_ENV, "utf-8")
      .split("\n")
      .find((l) => /^\s*(export\s+)?UNIFI_API_KEY=/.test(l));
    if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  }
  die(
    `UNIFI_API_KEY not found (checked env, ${SECRETS_FILE}, ${ANIMA_ENV}).\n` +
      "Create a Site Manager API key at unifi.ui.com → API, and store it in one of those.",
  );
}

const KEY = loadKey();

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-API-KEY": KEY, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) die(`GET ${url.replace(API, "")} → ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    die(`GET ${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/** The one write path. Only `rename` calls it, and only with --yes. */
async function sendJson(method: "PUT", url: string, body: Json): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { "X-API-KEY": KEY, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) die(`${method} ${url.replace(API, "")} → ${res.status} ${res.statusText}\n${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

interface HostInfo {
  id: string;
  name: string;
}

/** The console running the Network app. Cached; UNIFI_HOST_ID overrides; `hosts --refresh` re-resolves. */
async function resolveHost(refresh = false): Promise<HostInfo> {
  if (process.env.UNIFI_HOST_ID) return { id: process.env.UNIFI_HOST_ID, name: "(UNIFI_HOST_ID)" };
  if (!refresh && existsSync(HOST_CACHE)) {
    try {
      return JSON.parse(readFileSync(HOST_CACHE, "utf-8")) as HostInfo;
    } catch {
      // fall through and re-resolve
    }
  }
  const hosts = await listHosts();
  const consoles = hosts.filter((h) => h.network);
  if (consoles.length === 0) die("No console with the Network app found on this UniFi account.");
  if (consoles.length > 1)
    console.error(`Several consoles found; using ${consoles[0].name}. Set UNIFI_HOST_ID to pick another.`);
  const host = { id: consoles[0].id, name: consoles[0].name };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(HOST_CACHE, JSON.stringify(host, null, 2));
  return host;
}

interface HostSummary {
  id: string;
  name: string;
  state: string;
  version: string;
  network: boolean;
  ip: string;
}

async function listHosts(): Promise<HostSummary[]> {
  const body = (await getJson(`${API}/v1/hosts`)) as { data: Json[] };
  return body.data.map((h) => {
    const rs = (h.reportedState ?? {}) as Json;
    const controllers = (rs.controllers ?? []) as Json[];
    return {
      id: String(h.id),
      name: String(rs.name ?? rs.hostname ?? h.id),
      state: String(rs.state ?? "?"),
      version: String(rs.version ?? "?"),
      network: controllers.some((c) => c.name === "network" && c.state === "active"),
      ip: String(rs.ip ?? h.ipAddress ?? ""),
    };
  });
}

let hostPromise: Promise<HostInfo> | undefined;
async function networkUrl(path: string): Promise<string> {
  hostPromise ??= resolveHost();
  const host = await hostPromise;
  const clean = path.replace(/^\/+/, "").replace(/^proxy\/network\//, "");
  return `${API}/v1/connector/consoles/${encodeURIComponent(host.id)}/proxy/network/${clean}`;
}

async function network(path: string): Promise<unknown> {
  return getJson(await networkUrl(path));
}

/** Legacy endpoints wrap results as { meta, data: [...] }. */
async function legacy(path: string): Promise<Json[]> {
  const body = (await network(`api/s/${SITE}/${path}`)) as { data?: Json[] };
  return body.data ?? [];
}

// ───────────────────────────── helpers ─────────────────────────────

function die(msg: string): never {
  console.error(`unifi: ${msg}`);
  process.exit(1);
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

function dur(seconds: unknown): string {
  const s = num(seconds);
  if (s === undefined) return "-";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d${h}h` : h ? `${h}h${m}m` : `${m}m`;
}

function ago(epochSeconds: unknown): string {
  const t = num(epochSeconds);
  return t ? `${dur(Date.now() / 1000 - t)} ago` : "never";
}

/** bytes/s → human rate. */
function rate(bps: unknown): string {
  const b = num(bps);
  if (b === undefined) return "-";
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB/s`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} kB/s`;
  return `${b.toFixed(0)} B/s`;
}

/** kbps (UniFi link rates) → Mbps. */
const mbps = (kbps: unknown): string => (num(kbps) === undefined ? "-" : `${Math.round(num(kbps)! / 1000)}`);

const BAND: Record<string, string> = { ng: "2.4G", na: "5G", "6e": "6G" };
const band = (radio: unknown): string => BAND[String(radio)] ?? String(radio ?? "-");

const STATE: Record<number, string> = {
  0: "offline",
  1: "online",
  2: "pending",
  4: "upgrading",
  5: "provisioning",
  6: "heartbeat-missed",
  7: "adopting",
  9: "adopt-failed",
  10: "isolated",
  11: "isolated",
};

/** Client download/upload in bytes/s. The AP or switch "tx" is the client's download. */
const down = (c: Json): unknown => (c.is_wired ? c["wired-tx_bytes-r"] : c["tx_bytes-r"]);
const up = (c: Json): unknown => (c.is_wired ? c["wired-rx_bytes-r"] : c["rx_bytes-r"]);

function clientName(c: Json): string {
  return String(c.name || c.hostname || c.oui || c.mac);
}

/** Phones, laptops and tablets: the devices that belong on the main 5/6 GHz network. */
function isPersonal(c: Json): boolean {
  return /iphone|ipad|macbook|\bmac\b|pixel|galaxy|watch|vesuvius|panarea|rainier|sedes/i.test(
    `${c.name ?? ""} ${c.hostname ?? ""}`,
  );
}

function table(rows: Row[], cols?: string[]): void {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  const keys = cols ?? Object.keys(rows[0]);
  const width = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? "").length)));
  const line = (vals: string[]) => "  " + vals.map((v, i) => v.padEnd(width[i])).join("  ").trimEnd();
  console.log(line(keys));
  console.log(line(width.map((w) => "─".repeat(w))));
  for (const r of rows) console.log(line(keys.map((k) => String(r[k] ?? ""))));
}

interface KnownState {
  expectedOffline?: Record<string, string>;
}
function knownState(): KnownState {
  try {
    return JSON.parse(readFileSync(KNOWN_STATE, "utf-8")) as KnownState;
  } catch {
    return {};
  }
}

/** Never print credentials, even from `raw`. */
const SECRET_KEY = /^x_|passphrase|password|secret|psk|private_preshared|token$|authkey/i;
function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Json).map(([k, val]) => [k, SECRET_KEY.test(k) ? "<redacted>" : redact(val)]),
    );
  }
  return v;
}

// ───────────────────────────── data ─────────────────────────────

async function fetchAll() {
  const [health, devices, clients, networks, wlans] = await Promise.all([
    legacy("stat/health"),
    legacy("stat/device"),
    legacy("stat/sta"),
    legacy("rest/networkconf"),
    legacy("rest/wlanconf"),
  ]);
  return { health, devices, clients, networks, wlans };
}

interface RadioRow {
  device: string;
  radio: string;
  band: string;
  channel: string;
  width: string;
  airtime: number | undefined;
  selfTx: number | undefined;
  selfRx: number | undefined;
  stations: number;
  retryPct: number | undefined;
  txPower: string;
}

function radios(dev: Json): RadioRow[] {
  const conf = new Map(((dev.radio_table ?? []) as Json[]).map((r) => [r.name, r]));
  return ((dev.radio_table_stats ?? []) as Json[]).map((s) => {
    const c = (conf.get(s.name) ?? {}) as Json;
    const tx = num(s.tx_packets);
    const retries = num(s.tx_retries);
    return {
      device: String(dev.name),
      radio: String(s.name),
      band: band(s.radio),
      channel: String(s.channel ?? c.channel ?? "-"),
      width: c.ht ? `${c.ht}MHz` : "-",
      airtime: num(s.cu_total),
      selfTx: num(s.cu_self_tx),
      selfRx: num(s.cu_self_rx),
      stations: num(s.num_sta) ?? 0,
      retryPct: tx && retries !== undefined ? Math.round((retries / (tx + retries)) * 100) : undefined,
      txPower: s.tx_power === undefined || s.tx_power === null ? "-" : `${s.tx_power}dBm`,
    };
  });
}

// ───────────────────────────── commands ─────────────────────────────

async function cmdHosts(refresh: boolean, json: boolean) {
  const hosts = await listHosts();
  if (json) return console.log(JSON.stringify(hosts, null, 2));
  table(hosts.map((h) => ({ name: h.name, state: h.state, version: h.version, network: h.network ? "yes" : "no", ip: h.ip, id: h.id })));
  const host = await resolveHost(refresh);
  console.log(`\nUsing: ${host.name} (cached in ${HOST_CACHE})`);
}

async function cmdHealth(json: boolean) {
  const [health, devices] = await Promise.all([legacy("stat/health"), legacy("stat/device")]);
  if (json) return console.log(JSON.stringify(redact({ health }), null, 2));
  const sub = (name: string) => health.find((s) => s.subsystem === name) ?? {};
  const wan = sub("wan");
  const www = sub("www");
  const wlan = sub("wlan");
  const lan = sub("lan");
  const gwStats = (wan["gw_system-stats"] ?? {}) as Json;
  const gw = devices.find((d) => d.type === "udm" || d.type === "ugw" || d.type === "uxg");
  const wan1 = (gw?.wan1 ?? {}) as Json;
  const uptime = ((gw?.uptime_stats ?? {}) as Json).WAN as Json | undefined;

  console.log(`Gateway  ${wan.gw_name ?? "?"}  v${wan.gw_version ?? "?"}  CPU ${gwStats.cpu ?? "?"}%  mem ${gwStats.mem ?? "?"}%  up ${dur(gwStats.uptime)}`);
  console.log(
    `WAN      ${wan.status}  ${wan.isp_name ?? ""}  ${wan.wan_ip ?? ""}  link ${wan1.speed ?? "?"}Mbps  ↓ ${rate(wan["rx_bytes-r"])}  ↑ ${rate(wan["tx_bytes-r"])}`,
  );
  console.log(
    `Internet ${www.status}  latency ${www.latency ?? "?"}ms  drops ${www.drops ?? 0}` +
      (uptime ? `  availability ${Number(uptime.availability).toFixed(2)}%` : "") +
      (www.speedtest_lastrun ? `  last speedtest ${ago(www.speedtest_lastrun)}` : ""),
  );
  if (uptime?.monitors) {
    const all = [...((uptime.alerting_monitors ?? []) as Json[]), ...((uptime.monitors ?? []) as Json[])];
    const mons = [...new Map(all.map((m) => [m.target, m])).values()];
    console.log(`         monitors: ${mons.map((m) => `${m.target} ${m.latency_average}ms ${m.availability}%`).join(" · ")}`);
  }
  console.log(
    `Wi-Fi    ${wlan.status}  APs ${wlan.num_ap ?? 0} up / ${wlan.num_disconnected ?? 0} down  clients ${wlan.num_user ?? 0} (+${wlan.num_iot ?? 0} IoT, ${wlan.num_guest ?? 0} guest)  ↓ ${rate(wlan["tx_bytes-r"])}  ↑ ${rate(wlan["rx_bytes-r"])}`,
  );
  console.log(`LAN      ${lan.status}  switches ${lan.num_sw ?? 0}  wired clients ${lan.num_user ?? 0}  disconnected ${lan.num_disconnected ?? 0}`);
}

async function cmdDevices(json: boolean, ports: boolean) {
  const devices = await legacy("stat/device");
  if (json) return console.log(JSON.stringify(redact(devices), null, 2));
  const known = knownState().expectedOffline ?? {};
  table(
    devices.map((d) => {
      const sys = (d["system-stats"] ?? {}) as Json;
      const state = STATE[num(d.state) ?? -1] ?? String(d.state);
      return {
        name: String(d.name),
        model: String(d.model),
        state: state === "offline" && known[String(d.name)] ? "offline (expected)" : state,
        ip: String(d.ip ?? ""),
        uptime: d.state === 1 ? dur(d.uptime) : `seen ${ago(d.last_seen)}`,
        cpu: sys.cpu ? `${sys.cpu}%` : "-",
        mem: sys.mem ? `${sys.mem}%` : "-",
        clients: num(d.num_sta) ?? 0,
        version: String(d.version ?? ""),
      };
    }),
  );

  const live = devices.filter((d) => d.state === 1);
  const allRadios = live.flatMap(radios);
  if (allRadios.length) {
    console.log("\nRadios");
    table(
      allRadios.map((r) => ({
        device: r.device,
        band: r.band,
        ch: r.channel,
        width: r.width,
        airtime: r.airtime === undefined ? "-" : `${r.airtime}%${r.airtime >= AIRTIME_BUSY ? " ⚠" : ""}`,
        "self tx/rx": `${r.selfTx ?? "-"}/${r.selfRx ?? "-"}%`,
        "other": r.airtime === undefined ? "-" : `${Math.max(0, r.airtime - (r.selfTx ?? 0) - (r.selfRx ?? 0))}%`,
        stations: r.stations,
        retries: r.retryPct === undefined ? "-" : `${r.retryPct}%`,
        power: r.txPower,
      })),
    );
  }

  for (const d of live) {
    const table_ = ((d.port_table ?? []) as Json[]).filter((p) => ports || p.up);
    if (!table_.length) continue;
    console.log(`\nPorts: ${d.name}${ports ? "" : " (up only; --ports for all)"}`);
    table(
      table_.map((p) => ({
        port: num(p.port_idx) ?? String(p.ifname ?? ""),
        name: String(p.name ?? ""),
        up: p.up ? "up" : "down",
        speed: p.up ? `${p.speed}${p.full_duplex ? "" : " half"}` : "-",
        uplink: p.is_uplink ? "yes" : "",
        poe: num(p.poe_power) ? `${p.poe_power}W` : "",
        "rx/tx": `${rate(p["rx_bytes-r"])} / ${rate(p["tx_bytes-r"])}`,
        errors: `${num(p.rx_errors) ?? 0}/${num(p.tx_errors) ?? 0}`,
        drops: `${num(p.rx_dropped) ?? 0}/${num(p.tx_dropped) ?? 0}`,
      })),
    );
  }

  const offline = devices.filter((d) => d.state !== 1);
  for (const d of offline) {
    const why = known[String(d.name)];
    console.log(`\n${why ? "ℹ" : "⚠"} ${d.name} is ${STATE[num(d.state) ?? -1] ?? d.state}, last seen ${ago(d.last_seen)}${why ? ` — expected: ${why}` : ""}`);
  }
}

async function cmdClients(args: string[], json: boolean) {
  const [clients, devices] = await Promise.all([legacy("stat/sta"), legacy("stat/device")]);
  if (json) return console.log(JSON.stringify(redact(clients), null, 2));
  const devName = new Map(devices.map((d) => [d.mac, String(d.name)]));
  const opt = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const filterNet = opt("--network")?.toLowerCase();
  const filterBand = opt("--band")?.toLowerCase();
  const sort = opt("--sort") ?? "traffic";
  const wiredOnly = args.includes("--wired");
  const wifiOnly = args.includes("--wifi");

  let rows = clients
    .filter((c) => !filterNet || String(c.network ?? "").toLowerCase() === filterNet || String(c.essid ?? "").toLowerCase() === filterNet)
    .filter((c) => !filterBand || band(c.radio).toLowerCase().startsWith(filterBand.replace(/ghz|g$/i, "")))
    .filter((c) => (!wiredOnly || c.is_wired) && (!wifiOnly || !c.is_wired));

  const traffic = (c: Json) => (num(down(c)) ?? 0) + (num(up(c)) ?? 0);
  const sorters: Record<string, (a: Json, b: Json) => number> = {
    traffic: (a, b) => traffic(b) - traffic(a),
    signal: (a, b) => (num(a.signal) ?? 0) - (num(b.signal) ?? 0),
    satisfaction: (a, b) => (num(a.satisfaction) ?? 100) - (num(b.satisfaction) ?? 100),
    name: (a, b) => clientName(a).localeCompare(clientName(b)),
  };
  rows = rows.sort(sorters[sort] ?? sorters.traffic);

  table(
    rows.map((c) => ({
      name: clientName(c).slice(0, 28),
      ip: String(c.ip ?? c.last_ip ?? ""),
      network: String(c.network ?? ""),
      via: c.is_wired
        ? `${devName.get(c.sw_mac) ?? c.last_uplink_name ?? "wired"} p${c.sw_port ?? "?"}`
        : `${String(c.essid ?? "")} ${band(c.radio)} ch${c.channel ?? "?"}`,
      signal: c.is_wired ? "" : `${c.signal ?? "?"}dBm`,
      "tx/rx Mbps": c.is_wired ? `${c.wired_rate_mbps ?? "?"} wired` : `${mbps(c.tx_rate)}/${mbps(c.rx_rate)}`,
      sat: num(c.satisfaction) === undefined ? "" : String(c.satisfaction),
      retries: c.is_wired ? "" : `${num(c.wifi_tx_retries_percentage) ?? "-"}%`,
      "↓/↑": `${rate(down(c))} / ${rate(up(c))}`,
      uptime: dur(c.uptime),
    })),
  );
  const wifi = rows.filter((c) => !c.is_wired);
  const byBand = Object.entries(
    wifi.reduce<Record<string, number>>((acc, c) => ((acc[band(c.radio)] = (acc[band(c.radio)] ?? 0) + 1), acc), {}),
  )
    .map(([b, n]) => `${b} ${n}`)
    .join(", ");
  console.log(`\n${rows.length} clients: ${rows.length - wifi.length} wired, ${wifi.length} Wi-Fi (${byBand || "none"})`);
}

async function cmdNetworks(json: boolean) {
  const [networks, wlans, clients] = await Promise.all([legacy("rest/networkconf"), legacy("rest/wlanconf"), legacy("stat/sta")]);
  if (json) return console.log(JSON.stringify(redact(networks), null, 2));
  const lans = networks.filter((n) => n.purpose !== "wan");
  table(
    lans.map((n) => ({
      name: String(n.name),
      purpose: String(n.purpose),
      vlan: n.vlan_enabled ? String(n.vlan) : n.purpose === "remote-user-vpn" ? "-" : "untagged",
      subnet: String(n.ip_subnet ?? ""),
      dhcp: n.dhcpd_enabled ? `${n.dhcpd_start ?? ""}-${String(n.dhcpd_stop ?? "").split(".").pop()}` : "-",
      mdns: n.mdns_enabled === undefined ? "-" : n.mdns_enabled ? "on" : "off",
      igmp: n.igmp_snooping === undefined ? "-" : n.igmp_snooping ? "on" : "off",
      ssids: wlans.filter((w) => w.networkconf_id === n._id).map((w) => w.name).join(", "),
      clients: clients.filter((c) => c.network_id === n._id || c.network === n.name).length,
    })),
  );
}

async function cmdWlans(json: boolean) {
  const [networks, wlans, clients] = await Promise.all([legacy("rest/networkconf"), legacy("rest/wlanconf"), legacy("stat/sta")]);
  if (json) return console.log(JSON.stringify(redact(wlans), null, 2));
  const netName = new Map(networks.map((n) => [n._id, String(n.name)]));
  table(
    wlans.map((w) => ({
      ssid: String(w.name),
      enabled: w.enabled ? "yes" : "no",
      network: netName.get(w.networkconf_id) ?? String(w.networkconf_id),
      bands: ((w.wlan_bands ?? [w.wlan_band]) as string[]).join("+"),
      security: `${w.security}/${w.wpa_mode}${w.wpa3_support ? "+wpa3" : ""}`,
      hidden: w.hide_ssid ? "yes" : "",
      guest: w.is_guest ? "yes" : "",
      iot: w.enhanced_iot ? "enhanced" : "",
      mlo: w.mlo_enabled ? "on" : "",
      clients: clients.filter((c) => c.essid === w.name).length,
    })),
  );
}

interface Finding {
  level: "⚠" | "ℹ";
  text: string;
}

async function cmdSweep(json: boolean) {
  const { health, devices, clients, networks } = await fetchAll();
  const known = knownState().expectedOffline ?? {};
  const findings: Finding[] = [];
  const add = (level: Finding["level"], text: string) => findings.push({ level, text });

  // Subsystems
  for (const s of health) {
    if (s.status && s.status !== "ok" && s.subsystem !== "wlan") add("⚠", `${s.subsystem} status is ${s.status}`);
  }
  const www = health.find((s) => s.subsystem === "www") ?? {};
  if ((num(www.latency) ?? 0) > 80) add("⚠", `Internet latency ${www.latency}ms (normal here is ~30ms)`);

  // Devices
  for (const d of devices) {
    if (d.state === 1) continue;
    const why = known[String(d.name)];
    if (why) add("ℹ", `${d.name} offline (last seen ${ago(d.last_seen)}) — expected: ${why}`);
    else add("⚠", `${d.name} (${d.model}) is ${STATE[num(d.state) ?? -1] ?? d.state}, last seen ${ago(d.last_seen)}`);
  }
  const unexpectedOffline = devices.filter((d) => d.state !== 1 && !known[String(d.name)]);
  const wlan = health.find((s) => s.subsystem === "wlan");
  if (wlan?.status && wlan.status !== "ok" && unexpectedOffline.length === 0)
    add("ℹ", `Wi-Fi status reads "${wlan.status}" only because of the expected-offline AP above`);
  else if (wlan?.status && wlan.status !== "ok") add("⚠", `wlan status is ${wlan.status}`);

  for (const d of devices.filter((x) => x.state === 1)) {
    const sys = (d["system-stats"] ?? {}) as Json;
    if ((num(sys.cpu) ?? 0) > 80) add("⚠", `${d.name} CPU ${sys.cpu}%`);
    if ((num(sys.mem) ?? 0) > 90) add("⚠", `${d.name} memory ${sys.mem}%`);
    for (const r of radios(d)) {
      if ((r.airtime ?? 0) >= AIRTIME_BUSY) {
        const own = (r.selfTx ?? 0) + (r.selfRx ?? 0);
        add(
          "⚠",
          `${r.device} ${r.band} ch${r.channel} airtime ${r.airtime}% (own traffic ${own}%, neighbors/noise ${Math.max(0, r.airtime! - own)}%), ${r.stations} stations`,
        );
      }
      // A short-window counter that swings a lot between reads, so a note, not a warning.
      if ((r.retryPct ?? 0) >= RETRIES_HIGH)
        add("ℹ", `${r.device} ${r.band} radio retries ${r.retryPct}% right now (short-window counter, swings between reads)`);
    }
    for (const p of (d.port_table ?? []) as Json[]) {
      if (!p.up) continue;
      const errs = (num(p.rx_errors) ?? 0) + (num(p.tx_errors) ?? 0);
      if (errs > 100) add("⚠", `${d.name} port ${p.port_idx} (${p.name}) has ${errs} errors`);
      if (p.full_duplex === false) add("⚠", `${d.name} port ${p.port_idx} (${p.name}) is half duplex`);
      if (!p.is_uplink && num(p.speed) && num(p.speed)! < 1000 && num(p.speed)! > 0)
        add("ℹ", `${d.name} port ${p.port_idx} (${p.name}) linked at ${p.speed} Mbps`);
    }
  }

  // Clients
  const isMain = (c: Json) => String(c.network ?? "") === "Default" || c.network_id === networks.find((n) => n.name === "Default")?._id;
  for (const c of clients.filter((x) => !x.is_wired)) {
    const name = clientName(c);
    if (isPersonal(c) && !isMain(c)) add("⚠", `${name} (personal device) is on ${c.network}/${c.essid}, not the main network`);
    else if (isPersonal(c) && c.radio === "ng") add("⚠", `${name} (personal device) is on 2.4 GHz (signal ${c.signal}dBm)`);
    const sat = num(c.satisfaction);
    if (sat !== undefined && sat >= 0 && sat < SATISFACTION_LOW)
      add("⚠", `${name} satisfaction ${sat} (${band(c.radio)}, signal ${c.signal}dBm, retries ${c.wifi_tx_retries_percentage ?? "?"}%)`);
    else if ((num(c.signal) ?? 0) < SIGNAL_WEAK) add("ℹ", `${name} weak signal ${c.signal}dBm on ${band(c.radio)}`);
    else if ((num(c.wifi_tx_retries_percentage) ?? 0) >= RETRIES_HIGH) add("ℹ", `${name} retries ${c.wifi_tx_retries_percentage}% on ${band(c.radio)}`);
  }

  if (json) return console.log(JSON.stringify(findings, null, 2));

  const wan = health.find((s) => s.subsystem === "wan") ?? {};
  const wifi = clients.filter((c) => !c.is_wired);
  const bands = ["ng", "na", "6e"].map((b) => `${band(b)} ${wifi.filter((c) => c.radio === b).length}`).join(" · ");
  console.log(
    `UniFi sweep · ${new Date().toLocaleString()}\n` +
      `WAN ${wan.status} (${wan.isp_name ?? "?"}), latency ${www.latency ?? "?"}ms · ` +
      `${devices.filter((d) => d.state === 1).length}/${devices.length} devices online · ` +
      `${clients.length} clients (${clients.length - wifi.length} wired, ${bands})\n`,
  );
  const warn = findings.filter((f) => f.level === "⚠");
  const info = findings.filter((f) => f.level === "ℹ");
  if (!findings.length) console.log("✅ Nothing to flag.");
  for (const f of [...warn, ...info]) console.log(`${f.level} ${f.text}`);
  console.log(`\n${warn.length} warning(s), ${info.length} note(s)`);
}

async function cmdRaw(path: string | undefined) {
  if (!path) die("usage: unifi raw <path>   e.g. raw api/s/default/stat/health  or  raw integration/v1/sites");
  const body = path.startsWith("/v1/") || path.startsWith("v1/") ? await getJson(`${API}/${path.replace(/^\//, "")}`) : await network(path);
  console.log(JSON.stringify(redact(body), null, 2));
}

/**
 * Set a client's display name (its alias in UniFi). The only write this CLI makes.
 * Without --yes it prints what it would do and changes nothing.
 */
async function cmdRename(mac: string | undefined, name: string | undefined, yes: boolean) {
  if (!mac || name === undefined) die('usage: unifi rename <mac> "<name>" [--yes]   (name "" clears it)');
  const want = mac.toLowerCase();
  const users = await legacy("rest/user");
  const user = users.find((u) => String(u.mac).toLowerCase() === want);
  if (!user) die(`no client with MAC ${mac} (see: unifi raw api/s/default/rest/user)`);
  const current = String(user.name ?? "") || `(unnamed; hostname ${user.hostname ?? "-"})`;
  if (String(user.name ?? "") === name) return console.log(`${mac}: already "${name}"`);
  if (!yes) return console.log(`would rename ${mac}: ${current} → "${name}"   (rerun with --yes to apply)`);
  await sendJson("PUT", await networkUrl(`api/s/${SITE}/rest/user/${user._id}`), { name });
  const after = (await legacy("rest/user")).find((u) => String(u.mac).toLowerCase() === want);
  if (String(after?.name ?? "") !== name) die(`PUT succeeded but the name reads "${after?.name ?? ""}"`);
  console.log(`renamed ${mac}: ${current} → "${name}"`);
}

const ipToInt = (ip: string): number => ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);

/** The LAN network whose subnet ("192.168.1.1/24") contains this IP. */
function networkFor(ip: string, networks: Json[]): Json | undefined {
  return networks.find((n) => {
    const [gw, bits] = String(n.ip_subnet ?? "").split("/");
    if (!gw || !bits) return false;
    const mask = bits === "0" ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
    return ((ipToInt(gw) & mask) >>> 0) === ((ipToInt(ip) & mask) >>> 0);
  });
}

/**
 * Reserve an address for a client (UniFi's "Fixed IP"; a DHCP reservation, the device stays on DHCP).
 * A write: only with Michael's OK, and nothing changes without --yes. "off" removes the reservation.
 */
async function cmdFixedIp(mac: string | undefined, ip: string | undefined, yes: boolean) {
  if (!mac || !ip || !(ip === "off" || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)))
    die("usage: unifi fixed-ip <mac> <ip|off> [--yes]");
  const want = mac.toLowerCase();
  const [users, networks] = await Promise.all([legacy("rest/user"), legacy("rest/networkconf")]);
  const user = users.find((u) => String(u.mac).toLowerCase() === want);
  if (!user) die(`no client with MAC ${mac}`);
  const label = String(user.name || user.hostname || mac);
  const current = user.use_fixedip ? `fixed ${user.fixed_ip}` : `dynamic (last ${user.last_ip ?? "?"})`;

  let body: Json;
  if (ip === "off") {
    if (!user.use_fixedip) return console.log(`${label}: already dynamic`);
    body = { use_fixedip: false };
  } else {
    if (user.use_fixedip && user.fixed_ip === ip) return console.log(`${label}: already fixed at ${ip}`);
    const net = networkFor(ip, networks);
    if (!net) die(`${ip} isn't in any LAN subnet`);
    const taken = users.find((u) => u.use_fixedip && u.fixed_ip === ip && String(u.mac).toLowerCase() !== want);
    if (taken) die(`${ip} is already reserved for ${taken.name || taken.hostname || taken.mac}`);
    if (user.last_ip && user.last_ip !== ip)
      console.log(`note: ${label} currently has ${user.last_ip}; it moves to ${ip} on its next DHCP renewal`);
    body = { use_fixedip: true, fixed_ip: ip, network_id: net._id };
  }
  const target = ip === "off" ? "dynamic" : `fixed ${ip}`;
  if (!yes) return console.log(`would set ${label}: ${current} → ${target}   (rerun with --yes to apply)`);
  await sendJson("PUT", await networkUrl(`api/s/${SITE}/rest/user/${user._id}`), body);
  const after = (await legacy("rest/user")).find((u) => String(u.mac).toLowerCase() === want);
  const ok = ip === "off" ? !after?.use_fixedip : after?.use_fixedip === true && after?.fixed_ip === ip;
  if (!ok) die(`PUT succeeded but the reservation reads use_fixedip=${after?.use_fixedip} fixed_ip=${after?.fixed_ip}`);
  console.log(`set ${label}: ${current} → ${target}`);
}

const FINGERPRINT_CACHE = join(CACHE_DIR, "fingerprints.json");

/** UniFi's device-type catalog (id → name), cached for a week. */
async function deviceTypes(): Promise<Record<string, string>> {
  try {
    const cached = JSON.parse(readFileSync(FINGERPRINT_CACHE, "utf-8")) as { at: number; types: Record<string, string> };
    if (Date.now() - cached.at < 7 * 86400_000) return cached.types;
  } catch {
    // fetch below
  }
  const body = (await network("v2/api/fingerprint_devices/0")) as { dev_ids: Record<string, { name: string }> };
  const types = Object.fromEntries(Object.entries(body.dev_ids).map(([id, v]) => [id, v.name]));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(FINGERPRINT_CACHE, JSON.stringify({ at: Date.now(), types }));
  return types;
}

async function cmdTypes(query: string | undefined) {
  if (!query) die('usage: unifi types "<search>"   e.g. types "galaxy s25"');
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const hits = Object.entries(await deviceTypes()).filter(([, name]) => re.test(name));
  table(hits.slice(0, 40).map(([id, name]) => ({ id, name })));
  if (hits.length > 40) console.log(`  … ${hits.length - 40} more; narrow the search`);
}

/** The current type a client shows, from the v2 clients API. */
async function currentType(mac: string): Promise<{ id?: number; override: boolean } | undefined> {
  const active = (await network("v2/api/site/default/clients/active?includeTrafficUsage=false")) as Json[];
  const c = active.find((x) => String(x.mac).toLowerCase() === mac);
  if (!c) return undefined;
  const fp = (c.fingerprint ?? {}) as Json;
  return { id: num(fp.dev_id_override) ?? num(fp.dev_id), override: Boolean(fp.has_override) };
}

/**
 * Override the device type UniFi guessed for a client (the icon and model it shows).
 * A write: only with Michael's OK, and nothing changes without --yes.
 */
async function cmdSetType(mac: string | undefined, typeId: string | undefined, yes: boolean) {
  if (!mac || !typeId || !/^\d+$/.test(typeId)) die('usage: unifi set-type <mac> <type-id> [--yes]   (find ids with: unifi types "<search>")');
  const want = mac.toLowerCase();
  const types = await deviceTypes();
  const typeName = types[typeId];
  if (!typeName) die(`unknown type id ${typeId}`);
  const user = (await legacy("rest/user")).find((u) => String(u.mac).toLowerCase() === want);
  if (!user) die(`no client with MAC ${mac}`);
  const label = String(user.name || user.hostname || mac);
  const before = await currentType(want);
  const beforeName = !before
    ? "(unknown, client offline)"
    : before.id === undefined
      ? "(no guess)"
      : (types[String(before.id)] ?? `#${before.id}`);
  if (!yes) return console.log(`would set ${label}: ${beforeName} → ${typeName} (#${typeId})   (rerun with --yes to apply)`);
  // rest/user accepts dev_id_override but ignores it; the v2 station endpoint is what the app uses.
  const saved = (await sendJson("PUT", await networkUrl(`v2/api/site/default/station/${want}/fingerprint_override`), {
    mac: want,
    dev_id_override: Number(typeId),
  })) as Json;
  if (num(saved.dev_id_override) !== Number(typeId)) die(`PUT returned dev_id_override ${saved.dev_id_override}`);
  console.log(`set ${label}: ${beforeName} → ${typeName} (#${typeId})`);
}

// ───────────────────────────── main ─────────────────────────────

const HELP = `unifi — read-only UniFi Network CLI (cloud connector, GET only)

Commands:
  sweep                 one-shot health check that flags anything wrong
  health                WAN / internet / Wi-Fi / LAN status, gateway CPU + mem, latency
  devices [--ports]     gateway, switches, APs: state, radios (channel, airtime, retries), switch ports
  clients [filters]     every client: network, SSID, band, signal, rates, satisfaction, throughput, port
                        --network <name|ssid>  --band 2.4|5|6  --wired  --wifi
                        --sort traffic|signal|satisfaction|name  (default traffic)
  networks              networks/VLANs: subnet, DHCP, mDNS, IGMP snooping, SSIDs, client count
  wlans                 SSIDs: network, bands, security, client count
  hosts [--refresh]     consoles on the account; --refresh re-resolves the cached host id
  raw <path>            GET any path under the Network proxy (api/s/default/..., integration/v1/...)
                        or a Site Manager path (v1/hosts, v1/devices). Secrets are always redacted.

Writes (only with Michael's explicit OK):
  rename <mac> "<name>" [--yes]
                        set a client's display name; without --yes it only shows the change
  set-type <mac> <type-id> [--yes]
                        override the device type UniFi guessed (icon + model)
  fixed-ip <mac> <ip|off> [--yes]
                        reserve an address for a client (DHCP reservation; "off" removes it)
  types "<search>"      search UniFi's device-type catalog for a type id (read-only)

Add --json to any read command for machine-readable output.`;

const [cmd, ...rest] = process.argv.slice(2);
const json = rest.includes("--json");

switch (cmd) {
  case "sweep":
    await cmdSweep(json);
    break;
  case "health":
    await cmdHealth(json);
    break;
  case "devices":
    await cmdDevices(json, rest.includes("--ports"));
    break;
  case "clients":
    await cmdClients(rest, json);
    break;
  case "networks":
    await cmdNetworks(json);
    break;
  case "wlans":
    await cmdWlans(json);
    break;
  case "hosts":
    await cmdHosts(rest.includes("--refresh"), json);
    break;
  case "rename": {
    const positional = rest.filter((a) => a !== "--yes" && a !== "--json");
    await cmdRename(positional[0], positional[1], rest.includes("--yes"));
    break;
  }
  case "fixed-ip": {
    const positional = rest.filter((a) => a !== "--yes" && a !== "--json");
    await cmdFixedIp(positional[0], positional[1], rest.includes("--yes"));
    break;
  }
  case "types":
    await cmdTypes(rest.filter((a) => a !== "--json").join(" ") || undefined);
    break;
  case "set-type": {
    const positional = rest.filter((a) => a !== "--yes" && a !== "--json");
    await cmdSetType(positional[0], positional[1], rest.includes("--yes"));
    break;
  }
  case "raw":
    await cmdRaw(rest.find((a) => !a.startsWith("--")));
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;
  default:
    die(`unknown command "${cmd}"\n\n${HELP}`);
}
