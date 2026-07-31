const RAINDROP_API_BASE = "https://api.raindrop.io/rest/v1";
const MAX_PAGE_SIZE = 50;

export class AgentFeedError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export function getPaginationParams(query) {
  const page = parseWholeNumber(query.page, 0, 0, Number.MAX_SAFE_INTEGER);
  const perPage = parseWholeNumber(query.perPage ?? query.perpage, MAX_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const search = typeof query.q === "string" ? query.q.trim().slice(0, 240) : "";

  return { page, perPage, search };
}

export async function getAgentContext({ page, perPage, search }) {
  const [raindrops, rootCollections, childCollections] = await Promise.all([
    fetchRaindropJson("raindrops/0", {
      page: String(page),
      perpage: String(perPage),
      sort: "-created",
      ...(search ? { search } : {}),
    }),
    fetchRaindropJson("collections"),
    fetchRaindropJson("collections/childrens"),
  ]);

  const collectionNames = buildCollectionMap([rootCollections, childCollections]);
  const total = typeof raindrops.count === "number" ? raindrops.count : 0;
  const items = Array.isArray(raindrops.items) ? raindrops.items : [];

  return {
    schema: "raindrop-feed-agent-context/v1",
    generatedAt: new Date().toISOString(),
    query: search || null,
    pagination: {
      page,
      perPage,
      total,
      returned: items.length,
      hasMore: items.length === perPage && (total === 0 || (page + 1) * perPage < total),
      nextPage: items.length === perPage && (total === 0 || (page + 1) * perPage < total) ? page + 1 : null,
    },
    collections: Object.entries(collectionNames)
      .map(([id, title]) => ({ id: Number(id), title }))
      .sort((left, right) => left.title.localeCompare(right.title)),
    bookmarks: items.map((item) => normalizeBookmark(item, collectionNames)),
  };
}

export async function getAgentCollections() {
  const [rootCollections, childCollections] = await Promise.all([
    fetchRaindropJson("collections"),
    fetchRaindropJson("collections/childrens"),
  ]);

  return buildCollectionMap([rootCollections, childCollections]);
}

export async function getAgentBookmark(id) {
  const [response, rootCollections, childCollections] = await Promise.all([
    fetchRaindropJson(`raindrop/${encodeURIComponent(id)}`),
    fetchRaindropJson("collections"),
    fetchRaindropJson("collections/childrens"),
  ]);

  if (!response.item) {
    throw new AgentFeedError("Bookmark not found.", 404);
  }

  return {
    schema: "raindrop-feed-agent-bookmark/v1",
    generatedAt: new Date().toISOString(),
    bookmark: normalizeBookmark(response.item, buildCollectionMap([rootCollections, childCollections])),
  };
}

export async function getRawAgentBookmark(id) {
  const response = await fetchRaindropJson(`raindrop/${encodeURIComponent(id)}`);

  if (!response.item) {
    throw new AgentFeedError("Bookmark not found.", 404);
  }

  return response.item;
}

export async function updateAgentBookmark(id, changes) {
  const response = await fetchRaindropJson(`raindrop/${encodeURIComponent(id)}`, {}, {
    method: "PUT",
    body: changes,
  });

  if (!response.item) {
    throw new AgentFeedError("Raindrop did not return the updated bookmark.", 502);
  }

  return response.item;
}

export async function getAgentTags() {
  const response = await fetchRaindropJson("tags/0");
  const tags = Array.isArray(response.items) ? response.items : [];

  return {
    schema: "raindrop-feed-agent-tags/v1",
    generatedAt: new Date().toISOString(),
    tags: tags
      .map((tag) => ({
        name: stringValue(tag._id ?? tag.name ?? tag.title),
        count: typeof tag.count === "number" ? tag.count : null,
      }))
      .filter((tag) => tag.name)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function getAgentOverview() {
  const [page, tags] = await Promise.all([
    getAgentContext({ page: 0, perPage: 1, search: "" }),
    getAgentTags().catch(() => ({ tags: [] })),
  ]);

  return {
    totalBookmarks: page.pagination.total,
    collections: page.collections,
    tags: tags.tags,
  };
}

async function fetchRaindropJson(path, query = {}, options = {}) {
  const token = process.env.RAINDROP_TOKEN;

  if (!token) {
    throw new AgentFeedError("Missing RAINDROP_TOKEN. Add it as a server-side environment variable.", 500);
  }

  const url = new URL(`${RAINDROP_API_BASE}/${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => null);

    if (response.status === 401) {
      throw new AgentFeedError("Raindrop rejected the server-side token.", 401);
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new AgentFeedError("Bookmark not found.", 404);
      }

      throw new AgentFeedError("Raindrop could not provide this feed data.", response.status);
    }

    return payload || {};
  } catch (error) {
    if (error instanceof AgentFeedError) {
      throw error;
    }

    throw new AgentFeedError("Could not reach Raindrop.", 502);
  }
}

function buildCollectionMap(responses) {
  const map = {};

  for (const response of responses) {
    flattenCollections(response.items || [], map);
  }

  return map;
}

function flattenCollections(collections, map) {
  for (const collection of collections) {
    const id = collection._id ?? collection.id;

    if (typeof id === "number" && collection.title) {
      map[id] = collection.title;
    }

    if (Array.isArray(collection.children)) {
      flattenCollections(collection.children, map);
    }

    if (Array.isArray(collection.items)) {
      flattenCollections(collection.items, map);
    }
  }
}

function normalizeBookmark(item, collectionNames) {
  const collectionId = getCollectionId(item.collectionId);
  const excerpt = stringValue(item.excerpt);
  const title = stringValue(item.title) || excerpt || stringValue(item.domain) || "(untitled)";

  return {
    id: item._id,
    title,
    url: stringValue(item.link),
    domain: stringValue(item.domain) || getDomain(item.link),
    excerpt: excerpt || null,
    note: stringValue(item.note) || null,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string") : [],
    collection: {
      id: collectionId || null,
      title: collectionNames[collectionId] || "Unsorted",
    },
    created: stringValue(item.created) || null,
    type: stringValue(item.type) || null,
    important: Boolean(item.important),
    read: Array.isArray(item.tags) && item.tags.some((tag) => typeof tag === "string" && tag.toLowerCase() === "read"),
    cover: stringValue(item.cover) || null,
    highlights: normalizeHighlights(item.highlights),
  };
}

function normalizeHighlights(highlights) {
  if (!Array.isArray(highlights)) {
    return [];
  }

  return highlights
    .filter((highlight) => highlight && typeof highlight === "object")
    .map((highlight) => ({
      text: stringValue(highlight.text) || null,
      note: stringValue(highlight.note) || null,
      color: stringValue(highlight.color) || null,
      created: stringValue(highlight.created) || null,
    }))
    .filter((highlight) => highlight.text || highlight.note);
}

function getCollectionId(collectionId) {
  if (typeof collectionId === "number") {
    return collectionId;
  }

  if (collectionId && typeof collectionId === "object") {
    return collectionId.$id ?? collectionId.oid ?? 0;
  }

  return 0;
}

function getDomain(link) {
  try {
    return typeof link === "string" ? new URL(link).hostname.replace(/^www\\./, "") : "";
  } catch {
    return "";
  }
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseWholeNumber(value, fallback, min, max) {
  const candidate = typeof value === "string" ? Number(value) : NaN;
  const parsed = Number.isSafeInteger(candidate) ? candidate : fallback;
  return Math.min(max, Math.max(min, parsed));
}
