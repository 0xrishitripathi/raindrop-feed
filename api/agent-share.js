import { applyAgentAction } from "../lib/agentActions.js";
import {
  AgentFeedError,
  getAgentBookmark,
  getAgentCollections,
  getAgentContext,
  getAgentOverview,
  getAgentTags,
  getPaginationParams,
} from "../lib/agentFeed.js";
import { getJsonBody } from "../lib/agentKeyAdmin.js";
import { getAgentShareUrls, getRequestOrigin, requireAgentShare } from "../lib/agentShare.js";
import { recordAgentActivity } from "../lib/agentKeyStore.js";

export default async function handler(req, res) {
  const path = typeof req.query.agentPath === "string" ? req.query.agentPath : "";

  if (path === "home") {
    await sendHome(req, res);
    return;
  }

  if (path === "context") {
    await sendContext(req, res);
    return;
  }

  if (path === "tags") {
    await sendTags(req, res);
    return;
  }

  if (path === "llms") {
    await sendLlms(req, res);
    return;
  }

  if (path === "actions") {
    await applyAction(req, res);
    return;
  }

  if (path === "mcp") {
    await serveMcp(req, res);
    return;
  }

  if (path === "bookmark") {
    await sendBookmark(req, res, req.query.id);
    return;
  }

  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.status(404).json({ error: "Agent endpoint not found." });
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_ICON_PROTOCOL_VERSION = "2025-11-25";

const MCP_TOOLS = [
  {
    name: "search_bookmarks",
    title: "Search bookmarks",
    description: "Find bookmarks by title, URL, note, excerpt, domain, or tag. Use this before answering questions about the library.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search text." },
        page: { type: "integer", minimum: 0, default: 0, description: "Zero-based results page." },
        perPage: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "Bookmarks to return." },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_bookmark",
    title: "Get bookmark details",
    description: "Read one complete bookmark, including its tags, note, collection, highlights, and saved metadata.",
    inputSchema: {
      type: "object",
      properties: { bookmarkId: { type: "integer", minimum: 1 } },
      required: ["bookmarkId"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "list_tags",
    title: "List bookmark tags",
    description: "List every tag currently used in the Raindrop library with its bookmark count.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "list_collections",
    title: "List collections",
    description: "List the Raindrop collections available as destinations when organizing a bookmark.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "update_bookmark_tags",
    title: "Update bookmark tags",
    description: "Add or remove labels on one bookmark. First tell the user exactly which labels will change and obtain their confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        bookmarkId: { type: "integer", minimum: 1 },
        addTags: { type: "array", items: { type: "string" }, maxItems: 30 },
        removeTags: { type: "array", items: { type: "string" }, maxItems: 30 },
      },
      required: ["bookmarkId"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "move_bookmark",
    title: "Move bookmark",
    description: "Move one bookmark to an existing Raindrop collection. First tell the user the bookmark and destination and obtain their confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        bookmarkId: { type: "integer", minimum: 1 },
        collectionId: { type: "integer", minimum: 1 },
      },
      required: ["bookmarkId", "collectionId"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function serveMcp(req, res) {
  if (req.method === "GET") {
    const key = await requireAgentShare(req, res, req.query.token, {
      methods: ["GET"],
      activity: { type: "read", endpoint: "mcp" },
    });

    if (!key) {
      return;
    }

    res.setHeader("Allow", "POST");
    res.status(405).end();
    return;
  }

  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["POST"],
    activity: { type: "read", endpoint: "mcp" },
  });

  if (!key) {
    return;
  }

  const message = getJsonBody(req.body);

  if (!isJsonRpcMessage(message)) {
    sendMcpError(res, null, -32600, "Invalid JSON-RPC request.");
    return;
  }

  if (!Object.hasOwn(message, "id")) {
    res.status(202).end();
    return;
  }

  try {
    const result = await handleMcpMessage(req, message, key);
    res.status(200).json({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    if (error instanceof McpRequestError) {
      sendMcpError(res, message.id, error.code, error.message);
      return;
    }

    sendMcpError(res, message.id, -32603, "The Raindrop MCP server could not complete that request.");
  }
}

async function handleMcpMessage(req, message, key) {
  if (message.method === "initialize") {
    const protocolVersion = getMcpProtocolVersion(message);
    const serverInfo = getMcpServerInfo(req);

    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo,
      // Some MCP clients read server branding from discovery metadata rather
      // than directly from serverInfo during their first connection scan.
      _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
      instructions:
        "Use search_bookmarks before answering library questions. This is a private, live Raindrop library. Ask for explicit user confirmation before changing tags or moving a bookmark. Never claim a bookmark was changed unless the write tool succeeded.",
    };
  }

  if (message.method === "tools/list") {
    return { tools: MCP_TOOLS };
  }

  if (message.method === "tools/call") {
    const params = asObject(message.params);
    const toolName = typeof params?.name === "string" ? params.name : "";
    const args = asObject(params?.arguments) || {};
    const output = await callMcpTool(toolName, args, key);

    if (output && typeof output === "object" && output.isError) {
      return output;
    }

    return {
      content: [{ type: "text", text: getMcpResultSummary(toolName, output) }],
      structuredContent: output,
    };
  }

  throw new McpRequestError(-32601, "Method not found.");
}

function getMcpProtocolVersion(message) {
  return message.params?.protocolVersion === MCP_ICON_PROTOCOL_VERSION ? MCP_ICON_PROTOCOL_VERSION : MCP_PROTOCOL_VERSION;
}

function getMcpServerInfo(req) {
  const origin = getRequestOrigin(req);
  return {
    name: "raindrop-feed",
    title: "Raindrop Feed",
    version: "1.0.0",
    description: "Private Raindrop bookmark search and organization.",
    websiteUrl: origin,
    icons: [
      // No declared size lets compatible clients scale this safe PNG for any UI slot.
      { src: `${origin}/favicon.png`, mimeType: "image/png" },
      { src: `${origin}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
    ],
  };
}

async function callMcpTool(name, args, key) {
  try {
    if (name === "search_bookmarks") {
      return getAgentContext(getMcpPagination(args));
    }

    if (name === "get_bookmark") {
      return getAgentBookmark(requirePositiveId(args.bookmarkId, "bookmarkId"));
    }

    if (name === "list_tags") {
      return getAgentTags();
    }

    if (name === "list_collections") {
      const collections = await getAgentCollections();
      return {
        schema: "raindrop-feed-agent-collections/v1",
        generatedAt: new Date().toISOString(),
        collections: Object.entries(collections)
          .map(([id, title]) => ({ id: Number(id), title }))
          .sort((left, right) => left.title.localeCompare(right.title)),
      };
    }

    if (name === "update_bookmark_tags") {
      const result = await applyAgentAction({
        action: "update_tags",
        bookmarkId: requirePositiveId(args.bookmarkId, "bookmarkId"),
        addTags: args.addTags,
        removeTags: args.removeTags,
      });
      await recordAgentActivity(key, { type: "write", endpoint: "mcp", action: result.action, ...result.audit });
      return { result: "ok", action: result.action, bookmark: result.bookmark };
    }

    if (name === "move_bookmark") {
      const result = await applyAgentAction({
        action: "move_bookmark",
        bookmarkId: requirePositiveId(args.bookmarkId, "bookmarkId"),
        collectionId: requirePositiveId(args.collectionId, "collectionId"),
      });
      await recordAgentActivity(key, { type: "write", endpoint: "mcp", action: result.action, ...result.audit });
      return { result: "ok", action: result.action, bookmark: result.bookmark };
    }
  } catch (error) {
    if (error instanceof AgentFeedError) {
      return {
        isError: true,
        content: [{ type: "text", text: error.message }],
      };
    }

    throw error;
  }

  throw new McpRequestError(-32602, "Unknown tool.");
}

function getMcpPagination(args) {
  const query = typeof args.query === "string" ? args.query : "";
  const page = Number.isSafeInteger(args.page) && args.page >= 0 ? args.page : 0;
  const perPage = Number.isSafeInteger(args.perPage) && args.perPage >= 1 && args.perPage <= 50 ? args.perPage : 20;

  return getPaginationParams({ q: query, page: String(page), perPage: String(perPage) });
}

function requirePositiveId(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new McpRequestError(-32602, `${field} must be a positive integer.`);
  }

  return value;
}

function getMcpResultSummary(toolName, output) {
  if (toolName === "search_bookmarks") {
    return `Returned ${output.pagination?.returned || 0} of ${output.pagination?.total || 0} matching bookmarks.`;
  }

  if (toolName === "get_bookmark") {
    return `Returned bookmark ${output.bookmark?.id || "details"}.`;
  }

  if (toolName === "list_tags") {
    return `Returned ${output.tags?.length || 0} tags.`;
  }

  if (toolName === "list_collections") {
    return `Returned ${output.collections?.length || 0} collections.`;
  }

  return "The Raindrop bookmark library was updated.";
}

function isJsonRpcMessage(value) {
  return Boolean(value && typeof value === "object" && value.jsonrpc === "2.0" && typeof value.method === "string");
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sendMcpError(res, id, code, message) {
  res.status(200).json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

class McpRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function sendHome(req, res) {
  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["GET"],
    activity: { type: "read", endpoint: "home" },
  });

  if (!key) {
    return;
  }

  try {
    const context = await getAgentContext({ page: 0, perPage: 50, search: "" });
    const urls = getAgentShareUrls(req, req.query.token);
    const bookmarkMarkup = context.bookmarks.length
      ? context.bookmarks
          .map(
            (bookmark) => `<article><h2><a href="${escapeHtml(getSafeExternalUrl(bookmark.url))}" rel="noreferrer">${escapeHtml(bookmark.title)}</a></h2><p>${escapeHtml(bookmark.excerpt || bookmark.note || "")}</p><p>${escapeHtml(bookmark.collection.title)}${bookmark.tags.length ? ` / ${escapeHtml(bookmark.tags.join(", "))}` : ""}</p></article>`,
          )
          .join("\n")
      : "<p>No bookmarks in this library yet.</p>";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <meta name="description" content="Private, live Raindrop bookmark library for an AI reader.">
    <link rel="alternate" type="text/markdown" href="${escapeHtml(urls.llms)}" title="AI instructions">
    <title>Private Raindrop Feed</title>
  </head>
  <body>
    <main>
      <h1>Private Raindrop Feed</h1>
      <p>This is a live, private bookmark library shared through a revocable agent link.</p>
      <p><a href="${escapeHtml(urls.llms)}">AI reader instructions</a> / <a href="${escapeHtml(urls.context)}?perPage=50&amp;page=0">Bookmark data</a> / <a href="${escapeHtml(urls.tags)}">Tag index</a></p>
      <p>${context.pagination.total} saved bookmarks. Showing the newest ${context.bookmarks.length}.</p>
      ${bookmarkMarkup}
    </main>
  </body>
</html>`);
  } catch (error) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(error instanceof AgentFeedError ? error.status : 500).send(`<!doctype html><title>Raindrop Feed</title><p>${escapeHtml(error instanceof Error ? error.message : "Could not prepare the bookmark library.")}</p>`);
  }
}

async function sendContext(req, res) {
  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["GET"],
    activity: { type: "read", endpoint: "context" },
  });

  if (!key) {
    return;
  }

  try {
    res.status(200).json(await getAgentContext(getPaginationParams(req.query)));
  } catch (error) {
    sendJsonError(res, error, "Could not prepare bookmark context.");
  }
}

async function sendTags(req, res) {
  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["GET"],
    activity: { type: "read", endpoint: "tags" },
  });

  if (!key) {
    return;
  }

  try {
    res.status(200).json(await getAgentTags());
  } catch (error) {
    sendJsonError(res, error, "Could not prepare the tag index.");
  }
}

async function sendBookmark(req, res, id) {
  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["GET"],
    activity: { type: "read", endpoint: "bookmark", bookmarkId: id },
  });

  if (!key) {
    return;
  }

  try {
    res.status(200).json(await getAgentBookmark(id));
  } catch (error) {
    sendJsonError(res, error, "Could not prepare bookmark context.");
  }
}

async function applyAction(req, res) {
  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["POST"],
    activity: { type: "write_requested", endpoint: "actions" },
  });

  if (!key) {
    return;
  }

  try {
    const body = getJsonBody(req.body);

    if (!body) {
      throw new AgentFeedError("Provide a JSON action body.", 400);
    }

    const result = await applyAgentAction(body);
    await recordAgentActivity(key, { type: "write", endpoint: "actions", action: result.action, ...result.audit });
    res.status(200).json({ result: "ok", action: result.action, bookmark: result.bookmark });
  } catch (error) {
    sendJsonError(res, error, "Could not apply this organizing change.");
  }
}

async function sendLlms(req, res) {
  const key = await requireAgentShare(req, res, req.query.token, {
    methods: ["GET"],
    activity: { type: "read", endpoint: "llms" },
  });

  if (!key) {
    return;
  }

  try {
    const overview = await getAgentOverview();
    const urls = getAgentShareUrls(req, req.query.token);
    const collectionLines = overview.collections.length
      ? overview.collections.map((collection) => `- ${collection.title} (ID: ${collection.id})`).join("\n")
      : "- No collections reported";
    const tagLines = overview.tags.length
      ? overview.tags.map((tag) => `- ${tag.name}${tag.count == null ? "" : ` (${tag.count})`}`).join("\n")
      : "- Use the context endpoint to inspect bookmark tags";

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.status(200).send(`# Raindrop Feed\n\nThis is a private, live bookmark library made available through a revocable agent link. Treat this URL as a secret.\n\n## Read the library\n\n1. Read ${urls.context}?perPage=50&page=0.\n2. Continue with the next page while \`pagination.hasMore\` is true.\n3. Use \`q\` to narrow results, for example: ${urls.context}?q=design&perPage=50&page=0.\n4. Fetch a complete bookmark record from ${urls.bookmark}.\n5. Fetch the complete tag list from ${urls.tags}.\n\nEach record includes titles, URLs, domains, excerpts, notes, tags, collections, dates, covers, and saved highlights.\n\n## Organize the library\n\nUse POST ${urls.actions} with JSON only for these non-destructive actions:\n\n\`{ "action": "update_tags", "bookmarkId": 123, "addTags": ["design"], "removeTags": ["inbox"] }\`\n\n\`{ "action": "move_bookmark", "bookmarkId": 123, "collectionId": 456 }\`\n\nNever delete bookmarks or collections. A move requires an existing collection ID from the current collection list.\n\n## Current scope\n\n- Bookmarks: ${overview.totalBookmarks}\n- Collections:\n${collectionLines}\n- Tags:\n${tagLines}\n`);
  } catch (error) {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.status(error instanceof AgentFeedError ? error.status : 500).send(`# Raindrop Feed\n\n${error instanceof Error ? error.message : "Could not prepare the AI-readable index."}\n`);
  }
}

function sendJsonError(res, error, fallback) {
  res.status(error instanceof AgentFeedError ? error.status : 500).json({
    error: error instanceof Error ? error.message : fallback,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}
