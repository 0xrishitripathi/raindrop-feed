import { requireAccess } from "./accessControl.js";

const RAINDROP_API_BASE = "https://api.raindrop.io/rest/v1";

const passthroughMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function encodePath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function getRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.body == null) {
    return undefined;
  }

  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    return req.body;
  }

  return JSON.stringify(req.body);
}

export function pathFromCatchAll(req) {
  const pathParam = req.query.path;

  if (Array.isArray(pathParam)) {
    return pathParam.map(encodeURIComponent).join("/");
  }

  if (pathParam) {
    return encodePath(pathParam);
  }

  const incomingUrl = new URL(req.url || "", `https://${req.headers.host || "localhost"}`);
  return encodePath(incomingUrl.pathname.replace(/^\/api\/raindrop\/?/, ""));
}

export async function proxyRaindrop(req, res, proxyPath, options = {}) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!passthroughMethods.has(req.method)) {
    res.setHeader("Allow", Array.from(passthroughMethods).join(", "));
    res.status(405).json({ error: "Unsupported method." });
    return;
  }

  if (!requireAccess(req, res)) {
    return;
  }

  const token = process.env.RAINDROP_TOKEN;

  if (!token) {
    res.status(500).json({
      error: "Missing RAINDROP_TOKEN. Add it as a server-side Vercel environment variable.",
    });
    return;
  }

  const incomingUrl = new URL(req.url || "", `https://${req.headers.host || "localhost"}`);
  const upstreamUrl = new URL(`${RAINDROP_API_BASE}/${encodePath(proxyPath)}`);
  const excludedQueryKeys = new Set(options.excludeQueryKeys || []);

  incomingUrl.searchParams.forEach((value, key) => {
    if (!excludedQueryKeys.has(key)) {
      upstreamUrl.searchParams.append(key, value);
    }
  });

  const body = getRequestBody(req);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body,
    });

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await upstreamResponse.json() : await upstreamResponse.text();

    if (upstreamResponse.status === 401) {
      res.status(401).json({
        error: "Raindrop rejected the token. Check RAINDROP_TOKEN in Vercel.",
      });
      return;
    }

    if (!upstreamResponse.ok) {
      res.status(upstreamResponse.status).json({
        error: "Raindrop request failed.",
        status: upstreamResponse.status,
        details: payload,
      });
      return;
    }

    res.status(upstreamResponse.status);

    if (isJson) {
      res.json(payload);
    } else {
      res.send(payload);
    }
  } catch (error) {
    res.status(502).json({
      error: "Could not reach Raindrop.",
      details: error instanceof Error ? error.message : "Unknown proxy error.",
    });
  }
}
