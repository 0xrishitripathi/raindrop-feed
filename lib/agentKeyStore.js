import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

const KEY_IDS_SET = "raindrop-feed:agent-key-ids";
const KEY_PREFIX = "raindrop-feed:agent-key:";
const AUDIT_PREFIX = "raindrop-feed:agent-audit:";
const RATE_LIMIT_PREFIX = "raindrop-feed:agent-rate:";
const MAX_AUDIT_ENTRIES = 50;
const MAX_REQUESTS_PER_MINUTE = 120;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

let redis;

export class AgentKeyStoreError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

export function isAgentKeyStoreConfigured() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );
}

export async function createAgentKey({ label = "Agent link" } = {}) {
  const client = getRedis();
  const id = randomBytes(12).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const record = {
    id,
    label: normalizeLabel(label),
    secretHash: hashSecret(secret),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };

  await client.set(keyName(id), JSON.stringify(record));
  await client.sadd(KEY_IDS_SET, id);

  return {
    key: toKeySummary(record),
    token: `${id}.${secret}`,
  };
}

export async function listAgentKeys() {
  const client = getRedis();
  const ids = await client.smembers(KEY_IDS_SET);
  const records = await Promise.all((Array.isArray(ids) ? ids : []).map((id) => getRecord(client, id)));

  return records
    .filter(Boolean)
    .map(toKeySummary)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function revokeAgentKey(id) {
  const client = getRedis();
  const record = await getRecord(client, id);

  if (!record) {
    throw new AgentKeyStoreError("Agent link not found.", 404);
  }

  if (!record.revokedAt) {
    record.revokedAt = new Date().toISOString();
    await saveRecord(client, record);
    await appendAudit(client, record.id, { type: "revoked" });
  }

  return toKeySummary(record);
}

export async function getAgentAudit(id) {
  const client = getRedis();
  const record = await getRecord(client, id);

  if (!record) {
    throw new AgentKeyStoreError("Agent link not found.", 404);
  }

  const entries = await client.lrange(auditName(id), 0, MAX_AUDIT_ENTRIES - 1);
  return (Array.isArray(entries) ? entries : []).map(parseAuditEntry).filter(Boolean);
}

export async function authenticateAgentToken(token) {
  const match = typeof token === "string" ? token.match(TOKEN_PATTERN) : null;

  if (!match) {
    throw new AgentKeyStoreError("This agent link is invalid or has been revoked.", 401);
  }

  const [, id, secret] = match;
  const client = getRedis();
  const record = await getRecord(client, id);

  if (!record || record.revokedAt || !secureEqual(record.secretHash, hashSecret(secret))) {
    throw new AgentKeyStoreError("This agent link is invalid or has been revoked.", 401);
  }

  return record;
}

export async function consumeAgentRequest(record, activity) {
  const client = getRedis();
  const bucket = Math.floor(Date.now() / 60_000);
  const rateLimitKey = `${RATE_LIMIT_PREFIX}${record.id}:${bucket}`;
  const requestCount = await client.incr(rateLimitKey);

  if (requestCount === 1) {
    await client.expire(rateLimitKey, 60);
  }

  if (requestCount > MAX_REQUESTS_PER_MINUTE) {
    throw new AgentKeyStoreError("This agent link has reached its request limit. Try again in a minute.", 429);
  }

  await recordAgentActivity(record, activity);
}

export async function recordAgentActivity(record, activity) {
  const client = getRedis();
  record.lastUsedAt = new Date().toISOString();
  await saveRecord(client, record);
  await appendAudit(client, record.id, activity);
}

function getRedis() {
  if (!isAgentKeyStoreConfigured()) {
    throw new AgentKeyStoreError(
      "Secure agent links are not configured. Connect an Upstash Redis store to this Vercel project.",
      503,
    );
  }

  if (!redis) {
    redis = Redis.fromEnv();
  }

  return redis;
}

async function getRecord(client, id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(id)) {
    return null;
  }

  const raw = await client.get(keyName(id));

  if (!raw) {
    return null;
  }

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return raw && typeof raw === "object" ? raw : null;
}

function saveRecord(client, record) {
  return client.set(keyName(record.id), JSON.stringify(record));
}

async function appendAudit(client, id, details) {
  const entry = JSON.stringify({ at: new Date().toISOString(), ...details });
  await client.lpush(auditName(id), entry);
  await client.ltrim(auditName(id), 0, MAX_AUDIT_ENTRIES - 1);
}

function parseAuditEntry(entry) {
  if (entry && typeof entry === "object") {
    return entry;
  }

  if (typeof entry === "string") {
    try {
      return JSON.parse(entry);
    } catch {
      return null;
    }
  }

  return null;
}

function keyName(id) {
  return `${KEY_PREFIX}${id}`;
}

function auditName(id) {
  return `${AUDIT_PREFIX}${id}`;
}

function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("base64url");
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeLabel(label) {
  return typeof label === "string" && label.trim() ? label.trim().slice(0, 60) : "Agent link";
}

function toKeySummary(record) {
  return {
    id: record.id,
    label: record.label,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || null,
    revokedAt: record.revokedAt || null,
  };
}
