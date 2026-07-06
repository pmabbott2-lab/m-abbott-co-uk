#!/usr/bin/env node
/**
 * Repair .env when APP_BASE_URL was concatenated with the next key (missing newline).
 * Safe to re-run — never prints secret values.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (!existsSync(envPath)) {
  console.error(".env not found");
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");
const lines = raw.split("\n");
let changed = false;
const out = [];

for (let line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    out.push(line);
    continue;
  }

  const eq = trimmed.indexOf("=");
  if (eq === -1) {
    out.push(line);
    continue;
  }

  const key = trimmed.slice(0, eq);
  let val = trimmed.slice(eq + 1);

  if (key === "APP_BASE_URL" && val.includes("TWILIO_")) {
    const idx = val.indexOf("TWILIO_");
    const base = val.slice(0, idx).replace(/\/$/, "");
    const rest = val.slice(idx);
    out.push(`APP_BASE_URL=${base}`);
    out.push(rest);
    changed = true;
    console.log("Fixed corrupted APP_BASE_URL line");
    continue;
  }

  out.push(line);
}

// Ensure file ends with newline
const fixed = out.join("\n").replace(/\n*$/, "\n");
if (fixed !== raw) changed = true;

if (changed) {
  writeFileSync(envPath, fixed, "utf8");
  console.log(".env repaired — restart the site (npm run refresh:site)");
} else {
  console.log(".env looks OK");
}
