import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/misa-webhook.js";

const SECRET = "test-misa-webhook-secret";

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

async function withSecret(callback) {
  const previous = process.env.MISA_WEBHOOK_SECRET;
  process.env.MISA_WEBHOOK_SECRET = SECRET;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.MISA_WEBHOOK_SECRET;
    else process.env.MISA_WEBHOOK_SECRET = previous;
  }
}

test("MISA webhook chỉ chấp nhận POST", async () => withSecret(async () => {
  const res = mockResponse();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
}));

test("MISA webhook từ chối request thiếu secret", async () => withSecret(async () => {
  const res = mockResponse();
  await handler({ method: "POST", headers: {}, query: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
}));

test("MISA webhook nhận sự kiện hợp lệ nhưng không ghi dữ liệu nhạy cảm vào log", async () => withSecret(async () => {
  const logs = [];
  const originalInfo = console.info;
  console.info = (message) => logs.push(String(message));
  try {
    const res = mockResponse();
    await handler({
      method: "POST",
      headers: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
        "content-length": "120"
      },
      query: {},
      body: {
        event: "inventory.updated",
        data: { product_code: "SECRET-SKU", customer_name: "Sensitive Customer" }
      }
    }, res);

    assert.equal(res.statusCode, 202);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.mode, "probe");
    const serializedLogs = logs.join("\n");
    assert.match(serializedLogs, /product_code/);
    assert.doesNotMatch(serializedLogs, /SECRET-SKU/);
    assert.doesNotMatch(serializedLogs, /Sensitive Customer/);
    assert.doesNotMatch(serializedLogs, new RegExp(SECRET));
  } finally {
    console.info = originalInfo;
  }
}));
