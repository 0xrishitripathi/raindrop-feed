import { authenticatePassword, createAccessSession, isAccessControlEnabled } from "../../lib/accessControl.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Only POST requests are supported." });
    return;
  }

  if (!isAccessControlEnabled()) {
    res.status(409).json({ error: "Password access is not configured for this deployment." });
    return;
  }

  const password = getPassword(req.body);

  if (!authenticatePassword(password)) {
    res.status(401).json({ error: "Incorrect password." });
    return;
  }

  res.setHeader("Set-Cookie", createAccessSession(req));
  res.status(200).json({ authenticated: true });
}

function getPassword(body) {
  if (body && typeof body === "object") {
    return body.password;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body).password;
    } catch {
      return "";
    }
  }

  return "";
}
