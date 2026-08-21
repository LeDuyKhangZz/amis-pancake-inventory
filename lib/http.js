const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ERROR_BODY = 1000;

export class PublicError extends Error {
  constructor(message, { status = 500, code = "INTERNAL_ERROR", details } = {}) {
    super(message);
    this.name = "PublicError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function limitedText(text) {
  return String(text || "")
    .replace(/api_key=[^&\s"']+/gi, "api_key=[REDACTED]")
    .replace(/("?(?:api_key|client_secret|authorization|access_token)"?\s*[:=]\s*"?)[^"&,\s]+/gi, "$1[REDACTED]")
    .slice(0, MAX_ERROR_BODY);
}

export async function requestJson(url, {
  method = "GET",
  headers = {},
  body,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
  retries = 3,
  endpoint = "dịch vụ bên ngoài"
} = {}) {
  const upperMethod = method.toUpperCase();
  const attempts = upperMethod === "GET" ? retries + 1 : 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: upperMethod,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        console.warn(JSON.stringify({
          event: "upstream_http_error",
          endpoint,
          status: response.status,
          attempt: attempt + 1
        }));
        const error = new PublicError(`${endpoint} trả về HTTP ${response.status}.`, {
          status: 502,
          code: "UPSTREAM_HTTP_ERROR"
        });
        if (retryable && attempt + 1 < attempts) {
          await sleep(100 * (2 ** attempt));
          continue;
        }
        throw error;
      }
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw new PublicError(`${endpoint} trả về dữ liệu không phải JSON.`, {
          status: 502,
          code: "UPSTREAM_INVALID_JSON"
        });
      }
    } catch (error) {
      lastError = error;
      if (error instanceof PublicError) throw error;
      const isGetRetry = upperMethod === "GET" && attempt + 1 < attempts;
      if (isGetRetry) {
        await sleep(100 * (2 ** attempt));
        continue;
      }
      const timedOut = error?.name === "AbortError";
      console.warn(JSON.stringify({
        event: timedOut ? "upstream_timeout" : "upstream_network_error",
        endpoint,
        attempt: attempt + 1
      }));
      throw new PublicError(`${endpoint} ${timedOut ? "bị quá thời gian chờ" : "không thể kết nối"}.`, {
        status: 502,
        code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR"
      });
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function safeError(error) {
  if (error instanceof PublicError || error?.name === "ConfigError") {
    return {
      status: Number(error.status) || 500,
      body: {
        ok: false,
        error: {
          code: error.code || "CONFIGURATION_ERROR",
          message: limitedText(error.message),
          ...(error.details ? { details: limitedText(error.details) } : {})
        }
      }
    };
  }
  return {
    status: 500,
    body: { ok: false, error: { code: "INTERNAL_ERROR", message: "Đã xảy ra lỗi nội bộ." } }
  };
}
