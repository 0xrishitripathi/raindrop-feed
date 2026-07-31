import { hasAccess, isAccessControlEnabled } from "../../lib/accessControl.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Only GET requests are supported." });
    return;
  }

  res.status(200).json({
    authenticated: hasAccess(req),
    accessEnabled: isAccessControlEnabled(),
  });
}
