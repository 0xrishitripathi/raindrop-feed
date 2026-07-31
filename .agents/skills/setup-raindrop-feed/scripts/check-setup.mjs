#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const envFlag = args.indexOf("--env-file");
const envFile = resolve(envFlag >= 0 ? args[envFlag + 1] || ".env.local" : ".env.local");
const requireFullSetup = args.includes("--full");
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function parseEnv(source) {
  const values = new Map();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return values;
}

for (const file of ["package.json", "package-lock.json", ".env.example", ".gitignore", "vercel.json"]) {
  check(existsSync(resolve(file)), `Missing ${file}`);
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
check(nodeMajor >= 22, `Node.js 22 or newer is required; found ${process.versions.node}`);

if (existsSync(resolve(".gitignore"))) {
  const ignore = readFileSync(resolve(".gitignore"), "utf8");
  check(ignore.split(/\r?\n/).includes(".vercel"), ".gitignore must ignore .vercel");
  check(ignore.split(/\r?\n/).includes(".env.*"), ".gitignore must ignore .env.* files");
}

for (const sensitivePath of [".env", ".env.local", ".vercel/project.json"]) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", sensitivePath], { stdio: "ignore" });
    failures.push(`${sensitivePath} is tracked by Git`);
  } catch {
    // Expected: sensitive local files must not be tracked.
  }
}

if (existsSync(envFile)) {
  const env = parseEnv(readFileSync(envFile, "utf8"));
  for (const key of ["RAINDROP_TOKEN", "APP_ACCESS_PASSWORD"]) {
    const value = env.get(key) || "";
    check(Boolean(value), `${key} is missing from ${envFile}`);
    check(!/^(your_|choose-|replace-|example)/i.test(value), `${key} still contains a placeholder value`);
  }

  const password = env.get("APP_ACCESS_PASSWORD") || "";
  check(password.length >= 16, "APP_ACCESS_PASSWORD must contain at least 16 characters");

  if (!env.get("GEMINI_API_KEY")) warnings.push("Gemini labeling is disabled (optional)");

  const hasUpstash = Boolean(env.get("UPSTASH_REDIS_REST_URL") && env.get("UPSTASH_REDIS_REST_TOKEN"));
  if (requireFullSetup) check(hasUpstash, "Upstash Redis is missing; permanent MCP links will not work");
  else if (!hasUpstash) warnings.push("Upstash Redis is not configured yet");
} else if (requireFullSetup) {
  failures.push(`Environment file not found: ${envFile}`);
} else {
  warnings.push("No local environment file checked; run again with --env-file after linking Vercel");
}

for (const warning of warnings) console.log(`WARN: ${warning}`);
for (const failure of failures) console.error(`FAIL: ${failure}`);

if (failures.length) process.exit(1);
console.log("OK: setup checks passed without exposing secret values");
