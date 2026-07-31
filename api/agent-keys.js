import { createAgentKey, listAgentKeys, AgentKeyStoreError } from "../lib/agentKeyStore.js";
import { getJsonBody, requireAgentKeyAdmin } from "../lib/agentKeyAdmin.js";
import { getAgentShareUrls } from "../lib/agentShare.js";

export default async function handler(req, res) {
  if (!requireAgentKeyAdmin(req, res, ["GET", "POST"])) {
    return;
  }

  try {
    if (req.method === "GET") {
      res.status(200).json({ keys: await listAgentKeys() });
      return;
    }

    const body = getJsonBody(req.body);
    const created = await createAgentKey({ label: body?.label });
    const urls = getAgentShareUrls(req, created.token);

    res.status(201).json({
      key: created.key,
      mcpUrl: urls.mcp,
    });
  } catch (error) {
    res.status(error instanceof AgentKeyStoreError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "Could not manage agent links.",
    });
  }
}
