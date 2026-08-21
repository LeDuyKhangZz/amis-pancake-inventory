import { timingSafeEqual } from "node:crypto";
import { safeError, PublicError } from "../lib/http.js";

export function authorized(req, secret) {
  const header = String(req.headers?.authorization || "");
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  return Boolean(secret) && left.length === right.length && timingSafeEqual(left, right);
}

export function requireAuthorization(req, secret) {
  if (!authorized(req, secret)) {
    throw new PublicError("Không được phép.", { status: 401, code: "UNAUTHORIZED" });
  }
}

export function sendError(res, error) {
  const safe = safeError(error);
  return res.status(safe.status).json(safe.body);
}

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  return res.status(405).json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Phương thức không được hỗ trợ." } });
}
