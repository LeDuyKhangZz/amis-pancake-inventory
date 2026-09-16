import { createPublicKey, verify } from "node:crypto";
import { PublicError } from "./http.js";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "amis-pancake-inventory-sync";
const REPOSITORY = "LeDuyKhangZz/amis-pancake-inventory";
const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/inventory-sync.yml@refs/heads/main`;
const JWKS_URL = `${ISSUER}/.well-known/jwks`;

function decodePart(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new PublicError("GitHub token không hợp lệ.", { status: 401, code: "GITHUB_TOKEN_INVALID" });
  }
}

function timingClaimsAreValid(payload, nowSeconds) {
  return Number.isFinite(payload.iat) && Number.isFinite(payload.exp)
    && payload.iat <= nowSeconds + 60 && payload.exp >= nowSeconds - 60;
}

export async function verifyGitHubOidc(token, {
  fetchImpl = globalThis.fetch,
  nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new PublicError("GitHub token không hợp lệ.", { status: 401, code: "GITHUB_TOKEN_INVALID" });
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new PublicError("GitHub token không hợp lệ.", { status: 401, code: "GITHUB_TOKEN_INVALID" });

  const response = await fetchImpl(JWKS_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new PublicError("Không xác minh được GitHub token.", { status: 503, code: "GITHUB_OIDC_UNAVAILABLE" });
  const jwks = await response.json();
  const jwk = jwks?.keys?.find((item) => item.kid === header.kid && item.kty === "RSA");
  if (!jwk) throw new PublicError("GitHub token không hợp lệ.", { status: 401, code: "GITHUB_TOKEN_INVALID" });
  const validSignature = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  const validClaims = validSignature
    && payload.iss === ISSUER
    && payload.aud === AUDIENCE
    && payload.repository === REPOSITORY
    && payload.ref === "refs/heads/main"
    && payload.job_workflow_ref === WORKFLOW_REF
    && ["schedule", "workflow_dispatch"].includes(payload.event_name)
    && timingClaimsAreValid(payload, nowSeconds);
  if (!validClaims) throw new PublicError("GitHub token không được phép.", { status: 401, code: "GITHUB_TOKEN_UNAUTHORIZED" });
  return payload;
}

export function githubBearer(req) {
  const match = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new PublicError("Thiếu GitHub token.", { status: 401, code: "GITHUB_TOKEN_MISSING" });
  return match[1];
}
