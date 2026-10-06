/**
 * Load GOVEE_API_KEY (and friends) from Anima's .env.
 *
 * Under Anima the key is already in process.env, inherited from the gateway.
 * This fallback covers a bare-terminal `claude`, where nothing has loaded it.
 * The path is named explicitly: this skill lives in its own repo, so walking
 * up from the script no longer leads anywhere meaningful.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_PATH =
  process.env.ANIMA_ENV_FILE ?? join(homedir(), "Projects", "iamclaudia-ai", "anima", ".env");

if (existsSync(ENV_PATH)) {
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Don't override existing env vars
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
