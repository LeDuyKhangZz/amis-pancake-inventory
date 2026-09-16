import { randomUUID } from "node:crypto";
import { getConfig, getMisaWebhookConfig } from "../lib/config.js";
import { PublicError } from "../lib/http.js";
import { commitSync } from "../lib/sync.js";
import { methodNotAllowed, requireAuthorization, sendError } from "./_shared.js";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_KEYS = 30;
const MAX_DEPTH = 3;

function describePayload(value, depth = 0) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      ...(value.length && depth < MAX_DEPTH ? { item: describePayload(value[0], depth + 1) } : {})
    };
  }
  if (typeof value !== "object") return { type: typeof value };

  const keys = Object.keys(value).slice(0, MAX_KEYS);
  const description = { type: "object", keys };
  if (depth < MAX_DEPTH) {
    description.fields = Object.fromEntries(keys.map((key) => [key, describePayload(value[key], depth + 1)]));
  }
  return description;
}

export function createMisaWebhookHandler({ commitImpl = commitSync, configImpl = getConfig } = {}) {
  return async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const { misaWebhookSecret } = getMisaWebhookConfig();
    requireAuthorization(req, misaWebhookSecret);

    const contentLength = Number(req.headers?.["content-length"] || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new PublicError("Webhook payload quá lớn.", { status: 413, code: "PAYLOAD_TOO_LARGE" });
    }

    const requestId = randomUUID();
    console.info(JSON.stringify({
      event: "misa_webhook_received",
      request_id: requestId,
      content_type: String(req.headers?.["content-type"] || ""),
      query_keys: Object.keys(req.query || {}).slice(0, MAX_KEYS),
      payload_shape: describePayload(req.body)
    }));

    // Webhooks can be retried, so only update existing SKU quantities here.
    // Product creation remains in the scheduled/manual sync to avoid duplicates.
    const result = await commitImpl(configImpl(), { createProducts: false });

    return res.status(result.ok ? 200 : 207).json({ ...result, trigger: "misa_webhook", request_id: requestId });
  } catch (error) {
    return sendError(res, error);
  }
  };
}

export default createMisaWebhookHandler();
