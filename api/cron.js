import { getConfig } from "../lib/config.js";
import { commitSync } from "../lib/sync.js";
import { methodNotAllowed, requireAuthorization, sendError } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const config = getConfig();
    requireAuthorization(req, config.cronSecret);
    const result = await commitSync(config);
    return res.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}
