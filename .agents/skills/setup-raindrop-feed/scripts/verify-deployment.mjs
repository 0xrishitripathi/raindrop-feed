#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const deploymentUrl = args.find((arg) => !arg.startsWith("--"));
const envFlag = args.indexOf("--env-file");
const envFile = resolve(envFlag >= 0 ? args[envFlag + 1] || ".env.local" : ".env.local");

if (!deploymentUrl) {
  console.error("Usage: verify-deployment.mjs <deployment-url> [--env-file .env.local]");
  process.exit(1);
}

if (!existsSync(envFile)) {
  console.error(`Environment file not found: ${envFile}`);
  process.exit(1);
}

function readEnvValue(key) {
  for (const rawLine of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (line.slice(0, separator).trim() !== key) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

const password = readEnvValue("APP_ACCESS_PASSWORD");
if (!password) {
  console.error("APP_ACCESS_PASSWORD is missing; its value was not printed");
  process.exit(1);
}

const origin = new URL(deploymentUrl).origin;
const privateEndpoint = `${origin}/api/raindrop/collections`;

const anonymous = await fetch(privateEndpoint, { redirect: "manual" });
if (anonymous.status !== 401) {
  console.error(`FAIL: anonymous private API returned ${anonymous.status}, expected 401`);
  process.exit(1);
}

const login = await fetch(`${origin}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
  redirect: "manual",
});

if (!login.ok) {
  console.error(`FAIL: password login returned ${login.status}`);
  process.exit(1);
}

const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) {
  console.error("FAIL: password login did not create a session cookie");
  process.exit(1);
}

const authenticated = await fetch(privateEndpoint, { headers: { cookie } });
if (!authenticated.ok) {
  console.error(`FAIL: authenticated Raindrop request returned ${authenticated.status}`);
  process.exit(1);
}

console.log("OK: anonymous access blocked, password login passed, and Raindrop connection succeeded");
