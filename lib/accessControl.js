import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "rf_access";
const SESSION_VERSION = "v1";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

export function isAccessControlEnabled() {
  return Boolean(getPassword());
}

export function hasAccess(req) {
  const password = getPassword();

  if (!password) {
    return true;
  }

  const session = getCookie(req, COOKIE_NAME);

  if (!session) {
    return false;
  }

  const [version, expiresAt, signature] = session.split(".");

  const expiry = Number(expiresAt);

  if (version !== SESSION_VERSION || !Number.isSafeInteger(expiry) || !signature) {
    return false;
  }

  if (expiry <= Date.now()) {
    return false;
  }

  return secureEqual(signature, signSession(`${version}.${expiresAt}`, password));
}

export function requireAccess(req, res) {
  if (hasAccess(req)) {
    return true;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ error: "Sign in is required to access this feed." });
  return false;
}

export function authenticatePassword(candidate) {
  const password = getPassword();

  return Boolean(password && typeof candidate === "string" && secureEqual(candidate, password));
}

export function createAccessSession(req) {
  const password = getPassword();

  if (!password) {
    return null;
  }

  const expiresAt = String(Date.now() + SESSION_LIFETIME_SECONDS * 1000);
  const value = `${SESSION_VERSION}.${expiresAt}`;
  const secure = isSecureRequest(req) ? "; Secure" : "";

  return `${COOKIE_NAME}=${value}.${signSession(value, password)}; Max-Age=${SESSION_LIFETIME_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function clearAccessSession(req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

function getPassword() {
  const password = process.env.APP_ACCESS_PASSWORD;
  return typeof password === "string" && password.trim() ? password : "";
}

function getCookie(req, name) {
  const header = req.headers.cookie;

  if (!header) {
    return "";
  }

  for (const entry of header.split(";")) {
    const [key, ...value] = entry.trim().split("=");

    if (key === name) {
      return value.join("=");
    }
  }

  return "";
}

function signSession(value, password) {
  return createHmac("sha256", password).update(value).digest("base64url");
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isSecureRequest(req) {
  const protocol = req.headers["x-forwarded-proto"];
  return process.env.VERCEL === "1" || protocol === "https";
}
