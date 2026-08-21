import { PublicError, requestJson } from "./http.js";

const BASE_URL = "https://pos.pages.fm/api/v1";

function arraysIn(payload) {
  return [
    payload?.data?.data,
    payload?.data?.items,
    payload?.data?.variations,
    payload?.data?.warehouses,
    payload?.data,
    payload?.items,
    payload?.variations,
    payload?.warehouses
  ];
}

export function extractPancakeItems(payload) {
  return arraysIn(payload).find(Array.isArray) || [];
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function variationSku(variation) {
  return [variation?.custom_id, variation?.display_id, variation?.keyword]
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
}

export function variationId(variation) {
  return variation?.id ?? variation?.variation_id ?? null;
}

export function selectPancakeWarehouse(warehouses, configuredId = "") {
  if (configuredId) {
    const selected = warehouses.find((warehouse) => normalize(warehouse.id ?? warehouse.warehouse_id) === normalize(configuredId));
    if (!selected) throw new PublicError("Không tìm thấy kho Pancake theo PANCAKE_WAREHOUSE_ID.", { code: "PANCAKE_WAREHOUSE_NOT_FOUND", status: 409 });
    return selected;
  }
  if (warehouses.length === 1) return warehouses[0];
  if (warehouses.length === 0) throw new PublicError("Pancake không có kho.", { code: "PANCAKE_WAREHOUSE_NOT_FOUND", status: 409 });
  throw new PublicError("Pancake có nhiều kho; hãy cấu hình PANCAKE_WAREHOUSE_ID.", { code: "PANCAKE_WAREHOUSE_AMBIGUOUS", status: 409 });
}

function totalPages(payload) {
  const values = [payload?.total_pages, payload?.data?.total_pages, payload?.meta?.total_pages];
  const found = values.find((value) => Number.isFinite(Number(value)));
  return found === undefined ? 1 : Math.max(1, Number(found));
}

export class PancakeClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  url(path, query = {}) {
    const url = new URL(`${BASE_URL}/shops/${encodeURIComponent(this.config.pancakeShopId)}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set("api_key", this.config.pancakeApiKey);
    return url.toString();
  }

  async listWarehouses() {
    const payload = await requestJson(this.url("/warehouses"), {
      fetchImpl: this.fetchImpl, endpoint: "Pancake danh sách kho"
    });
    return extractPancakeItems(payload);
  }

  async listVariations() {
    const all = [];
    for (let page = 1; ; page += 1) {
      const payload = await requestJson(this.url("/products/variations", { page_number: page, page_size: 100 }), {
        fetchImpl: this.fetchImpl, endpoint: "Pancake danh sách variation"
      });
      all.push(...extractPancakeItems(payload));
      if (page >= totalPages(payload)) break;
    }
    return all;
  }

  createProduct(product) {
    return requestJson(this.url("/products"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: { product },
      fetchImpl: this.fetchImpl,
      endpoint: "Pancake tạo sản phẩm"
    });
  }

  updateQuantities(rows) {
    return requestJson(this.url("/variations/update_quantity"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: { is_actual_remain_quantity: true, variations_warehouses: rows },
      fetchImpl: this.fetchImpl,
      endpoint: "Pancake cập nhật tồn kho"
    });
  }
}
