import { clearAccessSession } from "../../lib/accessControl.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Only POST requests are supported." });
    return;
  }

  res.setHeader("Set-Cookie", clearAccessSession(req));
  res.status(204).end();
}
