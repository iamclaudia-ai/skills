#!/usr/bin/env bun
/**
 * Print the key paths of this machine's ~/.anima/anima.json, one per line.
 *
 * Values are elided, so the output is safe to print and compare: only
 * booleans and the model/runtime/profile/mode strings are shown, because
 * those are the settings worth seeing drift in and none of them is secret.
 */

import { homedir } from "node:os";
import { join } from "node:path";

const SHOWN = /(model|runtime|profile|mode)$/i;
const MAX_DEPTH = 4;

const path = process.argv[2] ?? join(homedir(), ".anima/anima.json");
const config = JSON.parse(await Bun.file(path).text()) as unknown;
const lines: string[] = [];

function walk(value: unknown, key: string, depth: number): void {
  if (value && typeof value === "object" && !Array.isArray(value) && depth < MAX_DEPTH) {
    for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}.${k}` : k, depth + 1);
    return;
  }
  const show = typeof value === "boolean" || (typeof value === "string" && SHOWN.test(key));
  lines.push(show ? `${key}=${value}` : key);
}

walk(config, "", 0);
console.log(lines.sort().join("\n"));
