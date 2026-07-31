import { AgentFeedError, getAgentCollections, getRawAgentBookmark, updateAgentBookmark } from "./agentFeed.js";

const MAX_TAGS_PER_REQUEST = 30;
const MAX_TAG_LENGTH = 80;

export async function applyAgentAction(body) {
  const action = body && typeof body === "object" ? body.action : "";
  const bookmarkId = parseBookmarkId(body?.bookmarkId);

  if (action === "update_tags") {
    return updateTags(bookmarkId, body);
  }

  if (action === "move_bookmark") {
    return moveBookmark(bookmarkId, body?.collectionId);
  }

  throw new AgentFeedError("Supported actions are update_tags and move_bookmark.", 400);
}

async function updateTags(bookmarkId, body) {
  const addTags = parseTags(body.addTags, "addTags");
  const removeTags = parseTags(body.removeTags, "removeTags");

  if (addTags.length === 0 && removeTags.length === 0) {
    throw new AgentFeedError("Provide at least one tag to add or remove.", 400);
  }

  const bookmark = await getRawAgentBookmark(bookmarkId);
  const currentTags = Array.isArray(bookmark.tags) ? bookmark.tags.filter((tag) => typeof tag === "string") : [];
  const removals = new Set(removeTags.map(normalizeTagKey));
  const nextTags = currentTags.filter((tag) => !removals.has(normalizeTagKey(tag)));
  const existing = new Set(nextTags.map(normalizeTagKey));

  for (const tag of addTags) {
    if (!existing.has(normalizeTagKey(tag))) {
      nextTags.push(tag);
      existing.add(normalizeTagKey(tag));
    }
  }

  const updated = await updateAgentBookmark(bookmarkId, { tags: nextTags });

  return {
    action: "update_tags",
    bookmark: { id: updated._id, tags: Array.isArray(updated.tags) ? updated.tags : nextTags },
    audit: { bookmarkId, addTags, removeTags },
  };
}

async function moveBookmark(bookmarkId, collectionIdValue) {
  const collectionId = parseCollectionId(collectionIdValue);
  const collections = await getAgentCollections();

  if (!collections[collectionId]) {
    throw new AgentFeedError("Choose an existing collection from the agent's collection list.", 400);
  }

  const updated = await updateAgentBookmark(bookmarkId, { collection: { $id: collectionId } });

  return {
    action: "move_bookmark",
    bookmark: {
      id: updated._id,
      collection: { id: collectionId, title: collections[collectionId] },
    },
    audit: { bookmarkId, collectionId },
  };
}

function parseBookmarkId(value) {
  const id = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AgentFeedError("bookmarkId must be a positive bookmark ID.", 400);
  }

  return id;
}

function parseCollectionId(value) {
  const id = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AgentFeedError("collectionId must be an existing collection ID.", 400);
  }

  return id;
}

function parseTags(value, field) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value) || value.length > MAX_TAGS_PER_REQUEST) {
    throw new AgentFeedError(`${field} must contain at most ${MAX_TAGS_PER_REQUEST} tag names.`, 400);
  }

  const seen = new Set();
  const tags = [];

  for (const candidate of value) {
    if (typeof candidate !== "string") {
      throw new AgentFeedError(`${field} must contain only text tags.`, 400);
    }

    const tag = candidate.trim();
    const key = normalizeTagKey(tag);

    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

function normalizeTagKey(tag) {
  return tag.trim().toLocaleLowerCase();
}
