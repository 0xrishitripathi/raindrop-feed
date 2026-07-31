import { isAccessControlEnabled, requireAccess } from "./accessControl.js";

export function requireAgentKeyAdmin(req, res, methods) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");

  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    res.status(405).json({ error: `Only ${methods.join(" or ")} requests are supported.` });
    return false;
  }

  if (!isAccessControlEnabled()) {
    res.status(409).json({ error: "Set APP_ACCESS_PASSWORD before creating an agent link." });
    return false;
  }

  return requireAccess(req, res);
}

export function getJsonBody(body) {
  if (body && typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  return null;
}
