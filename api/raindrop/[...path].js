import { requireAccess } from "../../lib/accessControl.js";
import { labelBookmarks, BookmarkAssistantError } from "../../lib/bookmarkAssistant.js";
import { pathFromCatchAll, proxyRaindrop } from "../../lib/raindropProxy.js";

export default async function handler(req, res) {
  const path = pathFromCatchAll(req);

  if (path === "labels") {
    await handleLabels(req, res);
    return;
  }

  await proxyRaindrop(req, res, path, {
    excludeQueryKeys: ["path"],
  });
}

async function handleLabels(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Only POST requests are supported." });
    return;
  }

  if (!requireAccess(req, res)) {
    return;
  }

  const body = getBody(req.body);

  try {
    res.status(200).json(await labelBookmarks(body?.bookmarkIds));
  } catch (error) {
    res.status(error instanceof BookmarkAssistantError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "The labeler could not label this bookmark.",
    });
  }
}

function getBody(body) {
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
