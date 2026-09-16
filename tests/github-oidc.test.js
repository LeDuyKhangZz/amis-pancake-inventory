import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyGitHubOidc } from "../lib/github-oidc.js";

const now = 2_000_000_000;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });

function token(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com",
    aud: "amis-pancake-inventory-sync",
    repository: "LeDuyKhangZz/amis-pancake-inventory",
    ref: "refs/heads/main",
    job_workflow_ref: "LeDuyKhangZz/amis-pancake-inventory/.github/workflows/inventory-sync.yml@refs/heads/main",
    event_name: "workflow_dispatch",
    iat: now - 10,
    exp: now + 300,
    ...overrides
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [{ ...publicJwk, kid: "test" }] }) });

test("accepts the exact repository workflow identity", async () => {
  const claims = await verifyGitHubOidc(token(), { fetchImpl, nowSeconds: now });
  assert.equal(claims.event_name, "workflow_dispatch");
});

test("rejects another repository", async () => {
  await assert.rejects(verifyGitHubOidc(token({ repository: "attacker/repo" }), { fetchImpl, nowSeconds: now }), /không được phép/);
});

test("rejects an expired token", async () => {
  await assert.rejects(verifyGitHubOidc(token({ exp: now - 100 }), { fetchImpl, nowSeconds: now }), /không được phép/);
});
