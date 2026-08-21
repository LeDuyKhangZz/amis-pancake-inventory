import { getConfig } from "../lib/config.js";
import { commitSync, previewSync } from "../lib/sync.js";
import { methodNotAllowed, requireAuthorization, sendError } from "./_shared.js";

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ["GET", "POST"]);
  try {
    const config = getConfig();
    requireAuthorization(req, config.syncSecret);
    const result = req.method === "GET" ? await previewSync(config) : await commitSync(config);
    return res.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}
