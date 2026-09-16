import { getConfig } from "../lib/config.js";
import { githubBearer, verifyGitHubOidc } from "../lib/github-oidc.js";
import { commitSync, previewSync } from "../lib/sync.js";
import { methodNotAllowed, sendError } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const claims = await verifyGitHubOidc(githubBearer(req));
    const requestedMode = req.body?.mode === "commit" ? "commit" : "preview";
    const mode = claims.event_name === "schedule" ? "commit" : requestedMode;
    const result = mode === "commit" ? await commitSync(getConfig()) : await previewSync(getConfig());
    return res.status(result.ok ? 200 : 207).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}
