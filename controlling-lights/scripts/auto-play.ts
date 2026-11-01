#!/usr/bin/env bun
/**
 * Auto-Play DIY Scene Rotation
 *
 * Advances to the next scene in a playlist JSON file each time it's called.
 * Tracks state in a .state file next to the playlist JSON.
 *
 * Usage:
 *   bun scripts/auto-play.ts <playlist.json>           # Advance to next scene
 *   bun scripts/auto-play.ts <playlist.json> --status   # Show current state
 *   bun scripts/auto-play.ts <playlist.json> --reset    # Reset to first scene
 *   bun scripts/auto-play.ts <playlist.json> --list     # List all scenes
 */

import "./env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

const API_BASE = "https://openapi.api.govee.com/router/api/v1";
const API_KEY = process.env.GOVEE_API_KEY;

if (!API_KEY) {
  console.error("Error: GOVEE_API_KEY environment variable is required");
  process.exit(1);
}

// ── Types ────────────────────────────────────────────

interface PlaylistScene {
  name: string;
  value: number;
}

interface Playlist {
  name: string;
  device: string;
  interval: number;
  scenes: PlaylistScene[];
}

interface PlaylistState {
  lastIndex: number;
  lastScene: string;
  lastPlayed: string;
  playCount: number;
  /** The resolved light, so a run skips the device-list request. */
  device?: GoveeDevice & { filter: string };
}

interface GoveeDevice {
  sku: string;
  device: string;
  deviceName: string;
  type: string;
}

// ── Load playlist ────────────────────────────────────

const [playlistPath, ...flags] = process.argv.slice(2);

if (!playlistPath || playlistPath === "--help") {
  console.log(`Auto-Play DIY Scene Rotation

Usage:
  bun scripts/auto-play.ts <playlist.json>           Advance to next scene
  bun scripts/auto-play.ts <playlist.json> --status   Show current state
  bun scripts/auto-play.ts <playlist.json> --reset    Reset to first scene
  bun scripts/auto-play.ts <playlist.json> --list     List all scenes`);
  process.exit(0);
}
// SKILL_DIR is injected by `anima skills run`. Falls back to the script's own
// directory (one level up from scripts/) for direct invocation.
const skillsPath = process.env.SKILL_DIR ?? resolve(import.meta.dirname ?? __dirname, "..");
const resolvedPath = resolve(skillsPath, playlistPath);
if (!existsSync(resolvedPath)) {
  console.error(`Playlist not found: ${resolvedPath}`);
  process.exit(1);
}

const playlist: Playlist = JSON.parse(readFileSync(resolvedPath, "utf-8"));
const statePath = resolve(dirname(resolvedPath), `.${basename(resolvedPath, ".json")}.state`);

if (playlist.scenes.length === 0) {
  console.error("Playlist has no scenes");
  process.exit(1);
}

// ── State management ─────────────────────────────────

function loadState(): PlaylistState {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {
      // Corrupted state, start fresh
    }
  }
  return { lastIndex: -1, lastScene: "", lastPlayed: "", playCount: 0 };
}

function saveState(state: PlaylistState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// ── Govee API (with timeouts and retries) ────────────

// A light on weak Wi-Fi drops off Govee's cloud for a few seconds at a time
// (Govee says "Device is offline"), and a request can hang outright. Every
// request gets its own timeout, and transient failures are retried with
// backoff until DEADLINE_MS, so a blip doesn't fail the run but a light that
// stays unreachable still does. The scheduler retries the whole run on top.
const REQUEST_TIMEOUT_MS = 10_000;
// Govee's device list is slow (20–30s at times), so it gets longer, and the
// resolved device is cached in the state file so normal runs never ask.
const DEVICE_LIST_TIMEOUT_MS = 30_000;
const DEADLINE_MS = 45_000;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000];
const startedAt = Date.now();

/** A failure worth retrying: network error, timeout, rate limit, 5xx, light offline. */
class TransientError extends Error {}

async function api<T>(path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Govee-API-Key": API_KEY!, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new TransientError(err instanceof Error ? err.message : String(err));
  }
  if (res.status === 429 || res.status >= 500) throw new TransientError(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
      const outOfTime = Date.now() - startedAt + delay + REQUEST_TIMEOUT_MS > DEADLINE_MS;
      if (!(err instanceof TransientError) || outOfTime) throw err;
      console.error(`… ${label}: ${err.message}, retrying in ${delay / 1000}s`);
      await Bun.sleep(delay);
    }
  }
}

// ── Device resolution ────────────────────────────────

async function getDevices(): Promise<GoveeDevice[]> {
  const result = await api<{ data: GoveeDevice[] }>(
    "/user/devices",
    undefined,
    DEVICE_LIST_TIMEOUT_MS,
  );
  return result.data.filter((d) => d.type === "devices.types.light");
}

function matchDevice(devices: GoveeDevice[], filter: string): GoveeDevice {
  const lower = filter.toLowerCase();
  const match = devices.find(
    (d) => d.deviceName.toLowerCase().includes(lower) || d.sku.toLowerCase().includes(lower),
  );
  if (!match) {
    console.error(`No device matching "${filter}". Available:`);
    for (const d of devices) {
      console.error(`  - ${d.deviceName} (${d.sku})`);
    }
    process.exit(1);
  }
  return match;
}

/** The playlist's light, from the state file when it was already resolved for this filter. */
async function resolveDevice(state: PlaylistState): Promise<GoveeDevice> {
  if (state.device && state.device.filter === playlist.device) return state.device;
  const devices = await withRetries("device list", getDevices);
  return matchDevice(devices, playlist.device);
}

// ── Commands ─────────────────────────────────────────

const flag = flags[0];

if (flag === "--status") {
  const state = loadState();
  console.log(`Playlist: ${playlist.name}`);
  console.log(`Scenes:   ${playlist.scenes.length}`);
  console.log(`Device:   ${playlist.device}`);
  if (state.lastIndex === -1) {
    console.log(`Status:   Not started`);
  } else {
    console.log(`Current:  [${state.lastIndex + 1}/${playlist.scenes.length}] ${state.lastScene}`);
    console.log(`Played:   ${state.lastPlayed}`);
    console.log(`Total:    ${state.playCount} plays`);
  }
  process.exit(0);
}

if (flag === "--reset") {
  saveState({ lastIndex: -1, lastScene: "", lastPlayed: "", playCount: 0 });
  console.log(`Reset "${playlist.name}" to beginning`);
  process.exit(0);
}

if (flag === "--list") {
  const state = loadState();
  console.log(`${playlist.name} — ${playlist.scenes.length} scenes:\n`);
  for (let i = 0; i < playlist.scenes.length; i++) {
    const marker = i === state.lastIndex ? " ◀ current" : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${playlist.scenes[i].name}${marker}`);
  }
  process.exit(0);
}

// ── Advance to next scene ────────────────────────────

const state = loadState();
const nextIndex = (state.lastIndex + 1) % playlist.scenes.length;
const scene = playlist.scenes[nextIndex];

const device = await resolveDevice(state).catch((err: unknown) => {
  console.error(`✗ Could not find the light: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

async function setScene(): Promise<void> {
  const result = await api<{ code: number; msg: string }>("/device/control", {
    requestId: `autoplay-${Date.now()}`,
    payload: {
      sku: device.sku,
      device: device.device,
      capability: {
        type: "devices.capabilities.dynamic_scene",
        instance: "diyScene",
        value: scene.value,
      },
    },
  });
  if (result.code === 200) return;
  if (/offline/i.test(result.msg)) throw new TransientError(`${device.deviceName} offline`);
  throw new Error(result.msg);
}

try {
  await withRetries("set scene", setScene);
} catch (err) {
  // Forget the cached device on a hard failure, so the next run looks it up again.
  if (!(err instanceof TransientError)) saveState({ ...state, device: undefined });
  console.error(`✗ Failed to set scene: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const newState: PlaylistState = {
  lastIndex: nextIndex,
  lastScene: scene.name,
  lastPlayed: new Date().toISOString(),
  playCount: state.playCount + 1,
  device: {
    sku: device.sku,
    device: device.device,
    deviceName: device.deviceName,
    type: device.type,
    filter: playlist.device,
  },
};
saveState(newState);

const took = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `✓ [${nextIndex + 1}/${playlist.scenes.length}] ${scene.name} → ${device.deviceName} (${took}s)`,
);
