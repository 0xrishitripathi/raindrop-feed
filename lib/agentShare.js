import { AgentKeyStoreError, authenticateAgentToken, consumeAgentRequest } from "./agentKeyStore.js";

export async function requireAgentShare(req, res, token, { methods, activity }) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    res.status(405).json({ error: `Only ${methods.join(" or ")} requests are supported.` });
    return null;
  }

  try {
    const key = await authenticateAgentToken(token);

    if (activity) {
      await consumeAgentRequest(key, activity);
    }
    return key;
  } catch (error) {
    res.status(error instanceof AgentKeyStoreError ? error.status : 503).json({
      error: error instanceof Error ? error.message : "Could not verify this agent link.",
    });
    return null;
  }
}

export function getAgentShareOrigin(req, token) {
  return `${getRequestOrigin(req)}/agent/${token}`;
}

export function getRequestOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const protocol = req.headers["x-forwarded-proto"] || (host === "localhost" ? "http" : "https");
  return `${protocol}://${host}`;
}

export function getAgentShareUrls(req, token) {
  const base = getAgentShareOrigin(req, token);
  return {
    base,
    home: base,
    llms: `${base}/llms.txt`,
    context: `${base}/context`,
    bookmark: `${base}/bookmark/{id}`,
    tags: `${base}/tags`,
    actions: `${base}/actions`,
    mcp: `${base}/mcp`,
  };
}
