import test from "node:test";
import assert from "node:assert/strict";
import { requestJson, safeError } from "../lib/http.js";
import { MisaClient, selectMisaStock } from "../lib/misa.js";
import { PancakeClient, selectPancakeWarehouse } from "../lib/pancake.js";
import { buildPlan, commitSync, normalizeQuantity, previewSync } from "../lib/sync.js";

const config = {
  misaClientId: "test-client",
  misaClientSecret: "test-misa-secret",
  misaStockCode: "",
  pancakeShopId: "test-shop",
  pancakeApiKey: "test-pancake-key",
  pancakeWarehouseId: "",
  syncSecret: "test-sync-secret",
  cronSecret: "test-cron-secret",
  createBatchSize: 25
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function makeFetch(overrides = {}) {
  const state = {
    products: overrides.products || [],
    inventory: overrides.inventory || [],
    misaStocks: overrides.misaStocks || [{ async_id: "misa-stock-1", stock_code: "KT", stock_name: "Kho Tổng", inactive: false }],
    warehouses: overrides.warehouses || [{ id: "warehouse-1", name: "Kho Tổng" }],
    variations: overrides.variations || [],
    calls: [],
    createdBodies: [],
    updateBodies: [],
    nextVariationId: 100
  };

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    state.calls.push({ url, method, body });

    if (url.hostname === "crmconnect.misa.vn" && url.pathname === "/api/v2/Account") {
      return response({ data: { access_token: "fake-access-token" } });
    }
    if (url.hostname === "crmconnect.misa.vn" && url.pathname === "/api/v2/Products") {
      return response({ data: { items: state.products }, total_pages: 1 });
    }
    if (url.hostname === "crmconnect.misa.vn" && url.pathname === "/api/v2/Stocks/product_ledger") {
      return response({ data: { data: state.inventory }, total_pages: 1 });
    }
    if (url.hostname === "crmconnect.misa.vn" && url.pathname === "/api/v2/Stocks") {
      return response({ items: state.misaStocks });
    }
    if (url.hostname === "pos.pages.fm" && url.pathname.endsWith("/warehouses")) {
      return response({ data: state.warehouses });
    }
    if (url.hostname === "pos.pages.fm" && url.pathname.endsWith("/products/variations")) {
      return response({ data: state.variations, total_pages: 1 });
    }
    if (url.hostname === "pos.pages.fm" && url.pathname.endsWith("/products") && method === "POST") {
      state.createdBodies.push(body);
      const created = body.product.variations[0];
      state.variations.push({ id: String(state.nextVariationId++), custom_id: created.custom_id });
      return response({ success: true });
    }
    if (url.hostname === "pos.pages.fm" && url.pathname.endsWith("/variations/update_quantity") && method === "POST") {
      state.updateBodies.push(body);
      return response({ success: true });
    }
    throw new Error(`Unexpected mocked request: ${method} ${url.pathname}`);
  };
  return { fetchImpl, state };
}

test("chuẩn hóa sản phẩm AMIS, trim SKU/tên và bỏ sản phẩm inactive", () => {
  const plan = buildPlan({
    products: [
      { product_code: " AB-R1 ", product_name: " Xe đạp R1 ", inactive: false },
      { product_code: "OFF", product_name: "Không đồng bộ", inactive: true }
    ],
    inventory: [{ product_code: "ab-r1", main_stock_quantity: 15 }],
    variations: [],
    warehouseId: "w1"
  });
  assert.equal(plan.activeProducts, 1);
  assert.equal(plan.create[0].product_code, "AB-R1");
  assert.equal(plan.create[0].payload.name, "Xe đạp R1");
});

test("chuẩn hóa tồn kho số nguyên dạng chuỗi", () => {
  assert.deepEqual(normalizeQuantity("15"), { ok: true, value: 15 });
});

test("tồn kho âm được chặn về 0", () => {
  assert.deepEqual(normalizeQuantity(-3), { ok: true, value: 0 });
});

test("tồn kho số lẻ bị bỏ qua", () => {
  const plan = buildPlan({
    products: [{ product_code: "A", product_name: "A" }],
    inventory: [{ product_code: "A", main_stock_quantity: 1.5 }],
    variations: [], warehouseId: "w1"
  });
  assert.equal(plan.create.length, 0);
  assert.match(plan.skipped[0].reason, /không phải số nguyên/i);
});

test("tự chọn đúng một kho AMIS đang hoạt động", () => {
  const selected = selectMisaStock([
    { stock_code: "OLD", inactive: true },
    { stock_code: "KT", inactive: false }
  ]);
  assert.equal(selected.stock_code, "KT");
});

test("tự chọn đúng một kho Pancake", () => {
  assert.equal(selectPancakeWarehouse([{ id: "w1" }]).id, "w1");
});

test("dừng an toàn khi có nhiều kho mà chưa cấu hình", () => {
  assert.throws(
    () => selectMisaStock([{ stock_code: "A", stock_name: "Kho A" }, { stock_code: "B", stock_name: "Kho B" }]),
    /A - Kho A; B - Kho B.*MISA_STOCK_CODE/
  );
  assert.throws(
    () => selectPancakeWarehouse([{ id: "A", name: "Kho A" }, { id: "B", name: "Kho B" }]),
    /A - Kho A; B - Kho B.*PANCAKE_WAREHOUSE_ID/
  );
});

test("phát hiện SKU Pancake bị trùng không phân biệt hoa thường", () => {
  const plan = buildPlan({
    products: [{ product_code: "AB-R1", product_name: "R1" }],
    inventory: [],
    variations: [{ id: "v1", custom_id: "AB-R1" }, { id: "v2", display_id: " ab-r1 " }],
    warehouseId: "w1"
  });
  assert.equal(plan.update.length, 0);
  assert.match(plan.skipped[0].reason, /trùng trong Pancake/);
});

test("preview không thực hiện POST ghi dữ liệu", async () => {
  const { fetchImpl, state } = makeFetch({ products: [{ product_code: "A", product_name: "Sản phẩm A" }] });
  const result = await previewSync(config, { fetchImpl });
  assert.equal(result.mode, "preview");
  assert.equal(result.plan.create_products, 1);
  const writePosts = state.calls.filter((call) => call.method === "POST" && call.url.pathname !== "/api/v2/Account");
  assert.equal(writePosts.length, 0);
});

test("commit tạo sản phẩm với đúng tên, hai cấp SKU, kho và tồn ban đầu", async () => {
  const { fetchImpl, state } = makeFetch({
    products: [{ product_code: "AB-R1", product_name: "Xe đạp Abraham R1" }],
    inventory: [{ product_code: "AB-R1", main_stock_quantity: 15 }]
  });
  const result = await commitSync(config, { fetchImpl });
  assert.equal(result.result.created, 1);
  const product = state.createdBodies[0].product;
  assert.equal(product.name, "Xe đạp Abraham R1");
  assert.equal(product.custom_id, "AB-R1");
  assert.equal(product.variations.length, 1);
  assert.equal(product.variations[0].custom_id, "AB-R1");
  assert.deepEqual(product.variations[0].variations_warehouses[0], {
    warehouse_id: "warehouse-1", remain_quantity: 15
  });
  assert.equal("retail_price" in product, false);
});

test("commit cập nhật tồn thực tế cho SKU đã tồn tại", async () => {
  const { fetchImpl, state } = makeFetch({
    products: [{ product_code: "AB-R1", product_name: "R1" }],
    inventory: [{ product_code: "AB-R1", main_stock_quantity: 7 }],
    variations: [{ id: "variation-1", custom_id: "ab-r1" }]
  });
  const result = await commitSync(config, { fetchImpl });
  assert.equal(result.result.inventory_updated, 1);
  assert.deepEqual(state.updateBodies[0], {
    is_actual_remain_quantity: true,
    variations_warehouses: [{ variation_id: "variation-1", warehouse_id: "warehouse-1", remain_quantity: 7 }]
  });
});

test("chạy lại không tạo trùng sản phẩm", async () => {
  const { fetchImpl, state } = makeFetch({
    products: [{ product_code: "A-1", product_name: "A" }],
    inventory: [{ product_code: "A-1", main_stock_quantity: 2 }]
  });
  await commitSync(config, { fetchImpl });
  const second = await commitSync(config, { fetchImpl });
  assert.equal(state.createdBodies.length, 1);
  assert.equal(second.result.created, 0);
  assert.equal(second.result.inventory_updated, 1);
});

test("phân trang AMIS bắt đầu từ trang 0 và đi hết trang", async () => {
  const pages = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    pages.push(Number(url.searchParams.get("page")));
    const page = Number(url.searchParams.get("page"));
    return response({ data: { items: [{ product_code: `P${page}` }] }, total_pages: 2 });
  };
  const client = new MisaClient(config, fetchImpl);
  client.token = "fake";
  const products = await client.listProducts();
  assert.deepEqual(pages, [0, 1]);
  assert.equal(products.length, 2);
});

test("phân trang Pancake bắt đầu từ trang 1 và đi hết total_pages", async () => {
  const pages = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page_number"));
    pages.push(page);
    return response({ data: [{ id: `V${page}`, custom_id: `P${page}` }], total_pages: 2 });
  };
  const variations = await new PancakeClient(config, fetchImpl).listVariations();
  assert.deepEqual(pages, [1, 2]);
  assert.equal(variations.length, 2);
});

test("khóa bí mật và URL api_key không xuất hiện trong lỗi công khai", async () => {
  const secret = "a-very-secret-key";
  const fetchImpl = async () => response({ error: `https://example.test/x?api_key=${secret}`, api_key: secret }, 503);
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (message) => logs.push(String(message));
  let caught;
  try {
    await requestJson(`https://example.test/x?api_key=${secret}`, { fetchImpl, retries: 0, endpoint: "Pancake kiểm thử" });
  } catch (error) {
    caught = error;
  } finally {
    console.warn = originalWarn;
  }
  const serialized = `${JSON.stringify(safeError(caught))}\n${logs.join("\n")}`;
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /api_key=/i);
});

test("mã AMIS trùng, thiếu trường và không có dòng tồn đều được xử lý an toàn", () => {
  const plan = buildPlan({
    products: [
      { product_code: "DUP", product_name: "Một" },
      { product_code: " dup ", product_name: "Hai" },
      { product_code: "", product_name: "Thiếu mã" },
      { product_code: "NO-NAME", product_name: "" },
      { product_code: "ZERO", product_name: "Không có ledger" }
    ],
    inventory: [], variations: [], warehouseId: "w1"
  });
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].remain_quantity, 0);
  assert.equal(plan.skipped.length, 4);
});

test("batch cập nhật tồn kho không vượt quá 50 variation", async () => {
  const products = Array.from({ length: 101 }, (_, i) => ({ product_code: `P${i}`, product_name: `P${i}` }));
  const variations = products.map((product, i) => ({ id: `V${i}`, custom_id: product.product_code }));
  const { fetchImpl, state } = makeFetch({ products, variations });
  await commitSync(config, { fetchImpl });
  assert.deepEqual(state.updateBodies.map((body) => body.variations_warehouses.length), [50, 50, 1]);
});
