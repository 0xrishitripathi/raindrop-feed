import { proxyRaindrop } from "../../../lib/raindropProxy.js";

export default async function handler(req, res) {
  await proxyRaindrop(req, res, "collections/childrens");
}
