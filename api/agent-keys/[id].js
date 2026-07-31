import { AgentKeyStoreError, revokeAgentKey } from "../../lib/agentKeyStore.js";
import { requireAgentKeyAdmin } from "../../lib/agentKeyAdmin.js";

export default async function handler(req, res) {
  if (!requireAgentKeyAdmin(req, res, ["DELETE"])) {
    return;
  }

  try {
    res.status(200).json({ key: await revokeAgentKey(req.query.id) });
  } catch (error) {
    res.status(error instanceof AgentKeyStoreError ? error.status : 500).json({
      error: error instanceof Error ? error.message : "Could not revoke this agent link.",
    });
  }
}
